use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub struct TtsEngine {
    rate: Mutex<f64>,
    running: Arc<AtomicBool>,
}

impl TtsEngine {
    pub fn new() -> Self {
        Self { rate: Mutex::new(1.0), running: Arc::new(AtomicBool::new(false)) }
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
        let running = self.running.clone();
        self.running.store(true, Ordering::SeqCst);
        std::thread::spawn(move || {
            let result = speak_platform(&text);
            running.store(false, Ordering::SeqCst);
            result
        });
        Ok(())
    }
    pub fn stop(&self) -> Result<(), String> {
        self.running.store(false, Ordering::SeqCst);
        stop_platform()
    }
}

fn speak_platform(text: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // 使用 PowerShell SAPI 朗读
        let script = format!(
            "$s = New-Object -ComObject SAPI.SpVoice; $s.Rate = 0; $s.Speak('{}')",
            text.replace('\'', "''")
        );
        Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("TTS 启动失败: {e}"))
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("say")
            .arg(text)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("TTS 启动失败: {e}"))
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("espeak")
            .args(["-g", "5", text])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("TTS 启动失败(需要 espeak): {e}"))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = text;
        Err("当前平台不支持 TTS".into())
    }
}

fn stop_platform() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/f", "/im", "powershell.exe"])
            .spawn();
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("pkill").args(["-f", "say"]).spawn();
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("pkill").args(["-f", "espeak"]).spawn();
        Ok(())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Ok(())
    }
}
