//! Windows integration: one Shelf per user session, and "Start with Windows" as a sign-in task.

use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE};
use windows_sys::Win32::System::Threading::{CreateEventW, CreateMutexW, SetEvent, WaitForSingleObject, INFINITE};

/// Started at sign-in: stay in the tray.
pub const MINIMIZED_ARG: &str = "--minimized";

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Holds the session-wide mutex for as long as Shelf runs.
pub struct SingleInstance {
    _mutex: HANDLE,
    event: HANDLE,
}

// The handles are plain kernel object handles, usable from any thread.
unsafe impl Send for SingleInstance {}
unsafe impl Sync for SingleInstance {}

impl SingleInstance {
    /// `None` when Shelf is already running (after asking it to show its window, unless `activate_existing` is
    /// false). A copy pointed at its own data folder (`SHELF_DATA_DIR`) is a separate instance, so it can run next to
    /// the real one.
    pub fn acquire(activate_existing: bool) -> Option<Self> {
        let suffix = std::env::var("SHELF_DATA_DIR")
            .ok()
            .filter(|d| !d.is_empty())
            .map(|d| {
                use sha2::Digest;
                let full = std::path::absolute(&d).unwrap_or_else(|_| PathBuf::from(&d));
                let hash = sha2::Sha256::digest(full.to_string_lossy().to_lowercase().as_bytes());
                format!(".{}", hash.iter().take(6).map(|b| format!("{b:02X}")).collect::<String>())
            })
            .unwrap_or_default();
        let mutex_name = wide(&format!(r"Local\Shelf.Rust.SingleInstance.v1{suffix}"));
        let event_name = wide(&format!(r"Local\Shelf.Rust.Activate.v1{suffix}"));
        unsafe {
            let mutex = CreateMutexW(std::ptr::null(), 1, mutex_name.as_ptr());
            let existed = GetLastError() == ERROR_ALREADY_EXISTS;
            let event = CreateEventW(std::ptr::null(), 0, 0, event_name.as_ptr());
            if existed {
                if activate_existing && !event.is_null() {
                    SetEvent(event);
                }
                CloseHandle(event);
                CloseHandle(mutex);
                return None;
            }
            Some(Self { _mutex: mutex, event })
        }
    }

    /// Calls `on_activate` (on a background thread) whenever another launch asks for the window.
    pub fn listen(&'static self, on_activate: impl Fn() + Send + 'static) {
        std::thread::spawn(move || loop {
            if unsafe { WaitForSingleObject(self.event, INFINITE) } != 0 {
                break;
            }
            on_activate();
        });
    }
}

/// "Start with Windows" as a per-user Task Scheduler task with a sign-in trigger (no admin rights). Explorer's Run key
/// can skip newly added apps for days; a sign-in task runs reliably. The task is the one the C# build made ("Shelf"),
/// so the setting carries over — but it only counts as on when it starts this exe.
pub struct Startup {
    cached: Mutex<Option<(Instant, bool)>>,
}

impl Startup {
    pub fn new() -> Self {
        Self { cached: Mutex::new(None) }
    }

    fn exe() -> String {
        std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()
    }

    fn schtasks(args: &[&str]) -> std::io::Result<std::process::Output> {
        Command::new("schtasks.exe").args(args).creation_flags(CREATE_NO_WINDOW).output()
    }

    pub fn is_enabled(&self) -> bool {
        let mut c = self.cached.lock().unwrap();
        if let Some((at, v)) = *c {
            if at.elapsed() < Duration::from_secs(30) {
                return v;
            }
        }
        let v = Self::read();
        *c = Some((Instant::now(), v));
        v
    }

    fn read() -> bool {
        let Ok(out) = Self::schtasks(&["/Query", "/TN", "Shelf", "/XML"]) else { return false };
        if !out.status.success() {
            return false;
        }
        let xml = decode(&out.stdout);
        let command = between(&xml, "<Command>", "</Command>").map(unescape).unwrap_or_default();
        let disabled = between(&xml, "<Settings>", "</Settings>").is_some_and(|s| s.contains("<Enabled>false</Enabled>"));
        !disabled && command.trim_matches('"').eq_ignore_ascii_case(&Self::exe())
    }

    pub fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        *self.cached.lock().unwrap() = None;
        if !enabled {
            let _ = Self::schtasks(&["/Delete", "/TN", "Shelf", "/F"]);
            return Ok(());
        }
        let user = format!("{}\\{}", std::env::var("USERDOMAIN").unwrap_or_default(), std::env::var("USERNAME").unwrap_or_default());
        let xml = task_xml(&user, &Self::exe());
        let file = std::env::temp_dir().join(format!("shelf-task-{}.xml", std::process::id()));
        // schtasks wants the file in the encoding its declaration names: UTF-16 with a BOM.
        let bytes: Vec<u8> = [0xFF, 0xFE].into_iter().chain(xml.encode_utf16().flat_map(|u| u.to_le_bytes())).collect();
        std::fs::write(&file, bytes).map_err(|e| e.to_string())?;
        let out = Self::schtasks(&["/Create", "/TN", "Shelf", "/XML", &file.to_string_lossy(), "/F"]);
        let _ = std::fs::remove_file(&file);
        match out {
            Ok(o) if o.status.success() => Ok(()),
            Ok(o) => Err(format!("Couldn't create the sign-in task: {}", decode(&o.stderr).trim())),
            Err(e) => Err(format!("Couldn't create the sign-in task: {e}")),
        }
    }
}

/// schtasks prints in UTF-16 or the console code page depending on how it's called; take either.
fn decode(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && (bytes.starts_with(&[0xFF, 0xFE]) || bytes.iter().skip(1).step_by(2).take(16).all(|&b| b == 0)) {
        let units: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        String::from_utf16_lossy(&units).trim_start_matches('\u{feff}').to_string()
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

fn between<'a>(s: &'a str, a: &str, b: &str) -> Option<&'a str> {
    let start = s.find(a)? + a.len();
    Some(&s[start..start + s[start..].find(b)?])
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

fn task_xml(user: &str, exe: &str) -> String {
    let (u, x) = (escape(user), escape(exe));
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>Shelf</Author>
    <Description>Starts Shelf in the notification area when you sign in, so game time is counted. Turn it off in Shelf: Settings, Start with Windows.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>{u}</UserId></LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author"><UserId>{u}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec><Command>{x}</Command><Arguments>{MINIMIZED_ARG}</Arguments></Exec>
  </Actions>
</Task>
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_xml_escapes_and_reads_back() {
        let xml = task_xml(r"PC\Anish & co", r"C:\Apps\Shelf <x>\shelf.exe");
        assert!(xml.contains(r"<UserId>PC\Anish &amp; co</UserId>"));
        assert_eq!(between(&xml, "<Command>", "</Command>").map(unescape).as_deref(), Some(r"C:\Apps\Shelf <x>\shelf.exe"));
        assert!(xml.contains("<Arguments>--minimized</Arguments>"));
        let utf16: Vec<u8> = xml.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        assert_eq!(decode(&utf16), xml);
    }
}
