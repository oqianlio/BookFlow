use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

pub struct TtsEngine {
    rate: Mutex<f64>,
    running: Arc<AtomicBool>,
    generation: Arc<AtomicU32>,
    pid: Arc<Mutex<Option<u32>>>,
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
        *self.rate.lock().unwrap()
    }
    pub fn set_rate(&self, rate: f64) {
        let clamped = rate.clamp(0.5, 2.0);
        *self.rate.lock().unwrap() = clamped;
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
            match speak_platform(&text, rate) {
                Ok(mut child) => {
                    *pid.lock().unwrap() = Some(child.id());
                    let _ = child.wait();
                }
                Err(_) => {}
            }
            if generation.load(Ordering::SeqCst) == gen {
                *pid.lock().unwrap() = None;
                running.store(false, Ordering::SeqCst);
            }
        });
        Ok(())
    }
    pub fn stop(&self) -> Result<(), String> {
        self.running.store(false, Ordering::SeqCst);
        self.generation.fetch_add(1, Ordering::SeqCst);
        let pid = *self.pid.lock().unwrap();
        if let Some(pid) = pid {
            *self.pid.lock().unwrap() = None;
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

fn speak_platform(text: &str, rate: f64) -> Result<Child, String> {
    #[cfg(target_os = "windows")]
    {
        // 使用 PowerShell SAPI 朗读，语速映射到 SpVoice.Rate（-10..10）
        let rate = map_rate(rate);
        let script = format!(
            "$s = New-Object -ComObject SAPI.SpVoice; $s.Rate = {rate}; $s.Speak('{}')",
            text.replace('\'', "''")
        );
        Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
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
