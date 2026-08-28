use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

pub struct TtsEngine {
    rate: Mutex<f64>,
    running: Arc<AtomicBool>,
    generation: Arc<AtomicU32>,
    pid: Arc<Mutex<Option<u32>>>,
}

impl Default for TtsEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl TtsEngine {
    pub fn new() -> Self {
        Self {
            rate: Mutex::new(1.0),
            running: Arc::new(AtomicBool::new(false)),
            generation: Arc::new(AtomicU32::new(0)),
            pid: Arc::new(Mutex::new(None)),
        }
    }

    pub fn rate(&self) -> f64 {
        self.rate.lock().map(|r| *r).unwrap_or(1.0)
    }

    pub fn set_rate(&self, rate: f64) {
        let clamped = rate.clamp(0.5, 2.0);
        if let Ok(mut r) = self.rate.lock() {
            *r = clamped;
        }
    }

    pub fn speak(&self, text: &str) -> Result<(), String> {
        if self.running.load(Ordering::SeqCst) {
            self.stop()?;
        }
        let text = text.to_string();
        let rate = self.rate();
        let gen = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let running = self.running.clone();
        let generation = self.generation.clone();
        let pid = self.pid.clone();
        self.running.store(true, Ordering::SeqCst);
        std::thread::spawn(move || {
            // 启动失败（无 TTS 平台）时静默：running/generation 由下方统一复位
            if let Ok(mut child) = speak_platform(&text, rate) {
                if let Ok(mut p) = pid.lock() {
                    *p = Some(child.id());
                }
                let _ = child.wait();
            }
            if generation.load(Ordering::SeqCst) == gen {
                if let Ok(mut p) = pid.lock() {
                    *p = None;
                }
                running.store(false, Ordering::SeqCst);
            }
        });
        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> {
        self.running.store(false, Ordering::SeqCst);
        self.generation.fetch_add(1, Ordering::SeqCst);
        let pid = self.pid.lock().ok().and_then(|p| *p);
        if let Some(pid) = pid {
            if let Ok(mut p) = self.pid.lock() {
                *p = None;
            }
            kill_pid(pid)
        } else {
            Ok(())
        }
    }
}

/// 将 0.5..2.0 的语速倍率映射为 Windows SAPI `SpVoice.Rate` 整数（-10..=10，0 为常速）。
pub fn map_rate(multiplier: f64) -> i32 {
    ((multiplier - 1.0) * 20.0).round().clamp(-10.0, 10.0) as i32
}

/// 将 0.5..2.0 的语速倍率映射为每分钟字数（约 175 wpm 为常速）。
pub fn map_rate_wpm(multiplier: f64) -> u32 {
    (175.0 * multiplier).round().max(1.0) as u32
}

/// 转义文本以安全插入 PowerShell 单引号字符串字面量。
/// 注意：仅覆盖单引号字符串字面量这一种用法（配合 `-EncodedCommand` 使用），
/// 不适用于双引号字符串或需要 `$`/反引号展开的场景。
fn escape_powershell_string(s: &str) -> String {
    // PowerShell 单引号字符串中，单引号通过加倍转义：' → ''
    // （\n/\r/\t 在单引号字符串中合法，由 validate_text_for_tts 把关其他控制字符）
    s.replace('\'', "''")
}

/// 验证文本不包含危险的 PowerShell 控制字符
fn validate_text_for_tts(text: &str) -> Result<(), String> {
    // 拒绝包含特殊控制字符的文本（保留换行和制表符用于朗读）
    for ch in text.chars() {
        if ch.is_control() && ch != '\n' && ch != '\r' && ch != '\t' {
            return Err(format!("文本包含不允许的控制字符: U+{:04X}", ch as u32));
        }
    }
    Ok(())
}

fn speak_platform(text: &str, rate: f64) -> Result<Child, String> {
    // 验证文本安全性
    validate_text_for_tts(text)?;

    #[cfg(target_os = "windows")]
    {
        // 使用 PowerShell SAPI 朗读，语速映射到 SpVoice.Rate（-10..10）
        let rate = map_rate(rate);
        let escaped_text = escape_powershell_string(text);
        // 使用 -EncodedCommand 传递 Base64 编码的脚本，避免命令行注入
        let script = format!(
            "$s = New-Object -ComObject SAPI.SpVoice; $s.Rate = {rate}; $s.Speak('{escaped_text}')"
        );
        // 将脚本编码为 UTF-16LE Base64（PowerShell 要求）
        let encoded = base64_encode_utf16le(&script);
        Command::new("powershell")
            .args(["-NoProfile", "-EncodedCommand", &encoded])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("TTS 启动失败: {e}"))
    }
    #[cfg(target_os = "macos")]
    {
        // say -r <wpm>
        let wpm = map_rate_wpm(rate);
        Command::new("say")
            .arg("-r")
            .arg(wpm.to_string())
            .arg(text)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("TTS 启动失败: {e}"))
    }
    #[cfg(target_os = "linux")]
    {
        // espeak -s <wpm>
        let wpm = map_rate_wpm(rate);
        Command::new("espeak")
            .arg("-s")
            .arg(wpm.to_string())
            .arg(text)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("TTS 启动失败(需要 espeak): {e}"))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = (text, rate);
        Err("当前平台不支持 TTS".into())
    }
}

/// 将字符串编码为 UTF-16LE 并进行 Base64 编码（用于 PowerShell -EncodedCommand）
fn base64_encode_utf16le(s: &str) -> String {
    let utf16: Vec<u16> = s.encode_utf16().collect();
    let bytes: Vec<u8> = utf16
        .iter()
        .flat_map(|&w| w.to_le_bytes())
        .collect();
    // 简单的 Base64 编码（不依赖外部库）
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).map(|&b| b as u32).unwrap_or(0);
        let b2 = chunk.get(2).map(|&b| b as u32).unwrap_or(0);
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

fn kill_pid(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let pid_str = pid.to_string();
        Command::new("taskkill")
            .args(["/f", "/pid", &pid_str])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("停止失败: {e}"))
    }
    #[cfg(target_os = "macos")]
    {
        let pid_str = pid.to_string();
        Command::new("kill")
            .arg(&pid_str)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("停止失败: {e}"))
    }
    #[cfg(target_os = "linux")]
    {
        let pid_str = pid.to_string();
        Command::new("kill")
            .arg(&pid_str)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("停止失败: {e}"))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = pid;
        Ok(())
    }
}
