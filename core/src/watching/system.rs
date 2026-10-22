//! The real machine for the watcher: running processes (Toolhelp snapshot), the foreground window, per-process GPU
//! use (the "GPU Engine" counters Task Manager shows), and a program's own icon for art. Least-privilege reads only:
//! process paths come from `PROCESS_QUERY_LIMITED_INFORMATION`, nothing is injected or hooked, so anti-cheat has
//! nothing to object to.

use std::collections::HashMap;
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE, RECT};
use windows_sys::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetMonitorInfoW, GetObjectW, MonitorFromWindow, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
    DIB_RGB_COLORS, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
use windows_sys::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW, PdhOpenQueryW, PDH_FMT_COUNTERVALUE_ITEM_W,
    PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY, PDH_MORE_DATA,
};
use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, GetDesktopWindow, GetForegroundWindow, GetIconInfo, GetShellWindow, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId, IsZoomed,
    PrivateExtractIconsW, GWL_STYLE,
    HICON, ICONINFO,
};

use super::{ForegroundProbe, ForegroundWindow, GpuSampler, ProcInfo, ProcessSource};

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn from_wide(buf: &[u16]) -> String {
    String::from_utf16_lossy(&buf[..buf.iter().position(|&c| c == 0).unwrap_or(buf.len())])
}

/// Running processes. A full path is looked up once per new process and cached while that pid keeps its exe name.
#[derive(Default)]
pub struct Win32Processes {
    paths: HashMap<u32, (String, Option<String>)>,
}

impl ProcessSource for Win32Processes {
    fn snapshot(&mut self) -> Vec<ProcInfo> {
        let mut list = Vec::with_capacity(400);
        let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snap.is_null() || snap == INVALID_HANDLE_VALUE {
            return list;
        }
        let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut seen = Vec::new();
        let mut ok = unsafe { Process32FirstW(snap, &mut entry) } != 0;
        while ok {
            let pid = entry.th32ProcessID;
            if pid > 4 {
                seen.push(pid);
                let name = from_wide(&entry.szExeFile);
                let cached = match self.paths.get(&pid) {
                    Some(c) if c.0 == name => c.1.clone(),
                    _ => {
                        let path = query_path(pid);
                        self.paths.insert(pid, (name.clone(), path.clone()));
                        path
                    }
                };
                list.push(ProcInfo { pid, name, path: cached });
            }
            ok = unsafe { Process32NextW(snap, &mut entry) } != 0;
        }
        unsafe { CloseHandle(snap) };
        if self.paths.len() > seen.len() {
            self.paths.retain(|pid, _| seen.contains(pid));
        }
        list
    }
}

fn query_path(pid: u32) -> Option<String> {
    let h: HANDLE = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if h.is_null() {
        return None;
    }
    let mut buf = [0u16; 1024];
    let mut size = buf.len() as u32;
    let ok = unsafe { QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut size) } != 0;
    unsafe { CloseHandle(h) };
    ok.then(|| String::from_utf16_lossy(&buf[..size as usize]))
}

/// The foreground window's process, and whether it's fullscreen the way games are (exclusive fullscreen or
/// borderless): covering the whole monitor *without* being a maximized app window. A maximized window can cover the
/// monitor too (frameless apps, an auto-hiding taskbar), so maximized windows and windows with a title bar or a
/// resizable frame don't count.
pub struct Win32Foreground;

const WS_CAPTION: u32 = 0x00C0_0000;
const WS_THICKFRAME: u32 = 0x0004_0000;

/// `window` and `monitor` as (left, top, right, bottom).
pub fn is_game_fullscreen(window: (i32, i32, i32, i32), monitor: (i32, i32, i32, i32), maximized: bool, style: u32) -> bool {
    let covers = window.0 <= monitor.0 && window.1 <= monitor.1 && window.2 >= monitor.2 && window.3 >= monitor.3;
    covers && !maximized && style & WS_CAPTION != WS_CAPTION && style & WS_THICKFRAME == 0
}

impl ForegroundProbe for Win32Foreground {
    fn current(&self) -> Option<ForegroundWindow> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_null() || hwnd == GetShellWindow() || hwnd == GetDesktopWindow() {
                return None;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid == 0 {
                return None;
            }
            let mut r: RECT = std::mem::zeroed();
            let mut fullscreen = false;
            if GetWindowRect(hwnd, &mut r) != 0 {
                let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
                let mut info: MONITORINFO = std::mem::zeroed();
                info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
                if !monitor.is_null() && GetMonitorInfoW(monitor, &mut info) != 0 {
                    let m = info.rcMonitor;
                    let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
                    fullscreen = is_game_fullscreen((r.left, r.top, r.right, r.bottom), (m.left, m.top, m.right, m.bottom), IsZoomed(hwnd) != 0, style);
                }
            }
            Some(ForegroundWindow { pid, fullscreen })
        }
    }
}

/// Per-process GPU use via PDH. Only one process is watched at a time — the foreground candidate — so it stays cheap.
pub struct PdhGpu {
    query: PDH_HQUERY,
    counter: PDH_HCOUNTER,
    pid: Option<u32>,
    available: bool,
}

// The PDH handles are only used from the watcher thread that owns this value.
unsafe impl Send for PdhGpu {}

impl Default for PdhGpu {
    fn default() -> Self {
        Self { query: null_mut(), counter: null_mut(), pid: None, available: true }
    }
}

impl PdhGpu {
    fn close(&mut self) {
        if !self.query.is_null() {
            unsafe { PdhCloseQuery(self.query) };
        }
        self.query = null_mut();
        self.counter = null_mut();
        self.pid = None;
    }

    fn read_sum(&self) -> Option<f64> {
        let (mut size, mut count) = (0u32, 0u32);
        let status = unsafe { PdhGetFormattedCounterArrayW(self.counter, PDH_FMT_DOUBLE, &mut size, &mut count, null_mut()) };
        if status != PDH_MORE_DATA || size == 0 {
            return (status == 0).then_some(0.0);
        }
        let n = (size as usize).div_ceil(std::mem::size_of::<PDH_FMT_COUNTERVALUE_ITEM_W>());
        let mut items: Vec<PDH_FMT_COUNTERVALUE_ITEM_W> = vec![Default::default(); n];
        if unsafe { PdhGetFormattedCounterArrayW(self.counter, PDH_FMT_DOUBLE, &mut size, &mut count, items.as_mut_ptr()) } != 0 {
            return None;
        }
        let sum: f64 = items
            .iter()
            .take(count as usize)
            .filter(|i| i.FmtValue.CStatus <= 1)
            .map(|i| unsafe { i.FmtValue.Anonymous.doubleValue })
            .sum();
        Some(sum.min(100.0))
    }
}

impl GpuSampler for PdhGpu {
    fn sample(&mut self, pid: u32) -> Option<f64> {
        if !self.available {
            return None;
        }
        if self.pid != Some(pid) {
            self.close();
            if unsafe { PdhOpenQueryW(std::ptr::null(), 0, &mut self.query) } != 0 {
                self.available = false;
                return None;
            }
            let path = wide(&format!(r"\GPU Engine(pid_{pid}_*engtype_3D)\Utilization Percentage"));
            if unsafe { PdhAddEnglishCounterW(self.query, path.as_ptr(), 0, &mut self.counter) } != 0 {
                self.close();
                self.available = false;
                return None;
            }
            self.pid = Some(pid);
            unsafe { PdhCollectQueryData(self.query) }; // first sample: rates need two
            return None;
        }
        if unsafe { PdhCollectQueryData(self.query) } != 0 {
            return None;
        }
        self.read_sum()
    }

    fn available(&self) -> bool {
        self.available
    }
}

impl Drop for PdhGpu {
    fn drop(&mut self) {
        self.close();
    }
}

/// A program's own icon at `size` px (or the largest it has), as straight RGBA pixels. Reads the exe's resources
/// only. `None` for exes without an icon of their own (Windows' generic one is no use as art).
pub fn exe_icon_rgba(exe: &str, size: i32) -> Option<(u32, u32, Vec<u8>)> {
    let path = wide(exe);
    let mut icon: HICON = null_mut();
    let mut id = 0u32;
    let n = unsafe { PrivateExtractIconsW(path.as_ptr(), 0, size, size, &mut icon, &mut id, 1, 0) };
    if n == 0 || n == u32::MAX || icon.is_null() {
        return None;
    }
    let pixels = icon_pixels(icon);
    unsafe { DestroyIcon(icon) };
    let (w, h, rgba) = pixels?;
    // Mostly transparent: no real icon.
    let opaque = rgba.chunks_exact(4).step_by(37).filter(|p| p[3] > 16).count();
    (opaque >= 4).then_some((w, h, rgba))
}

fn icon_pixels(icon: HICON) -> Option<(u32, u32, Vec<u8>)> {
    unsafe {
        let mut info: ICONINFO = std::mem::zeroed();
        if GetIconInfo(icon, &mut info) == 0 {
            return None;
        }
        let result = (|| {
            if info.hbmColor.is_null() {
                return None; // monochrome icon
            }
            let mut bmp: BITMAP = std::mem::zeroed();
            if GetObjectW(info.hbmColor, std::mem::size_of::<BITMAP>() as i32, &mut bmp as *mut _ as *mut _) == 0 {
                return None;
            }
            let (w, h) = (bmp.bmWidth, bmp.bmHeight);
            if w <= 0 || h <= 0 || w > 1024 || h > 1024 {
                return None;
            }
            let bgra = dib(info.hbmColor, w, h)?;
            let mut rgba = Vec::with_capacity(bgra.len());
            let has_alpha = bgra.chunks_exact(4).any(|p| p[3] != 0);
            // Old icons without alpha: the AND mask says which pixels are transparent.
            let mask = if has_alpha { None } else { dib(info.hbmMask, w, h) };
            for (i, p) in bgra.chunks_exact(4).enumerate() {
                let a = if has_alpha {
                    p[3]
                } else {
                    match &mask {
                        Some(m) if m[i * 4] != 0 => 0,
                        _ => 255,
                    }
                };
                // GDI gives premultiplied BGRA; PNG wants straight RGBA.
                let un = |c: u8| if a == 0 { 0 } else { ((c as u32 * 255 + a as u32 / 2) / a as u32).min(255) as u8 };
                let (r, g, b) = if has_alpha { (un(p[2]), un(p[1]), un(p[0])) } else { (p[2], p[1], p[0]) };
                rgba.extend_from_slice(&[r, g, b, a]);
            }
            Some((w as u32, h as u32, rgba))
        })();
        if !info.hbmColor.is_null() {
            DeleteObject(info.hbmColor);
        }
        if !info.hbmMask.is_null() {
            DeleteObject(info.hbmMask);
        }
        result
    }
}

/// A bitmap as top-down 32-bit BGRA.
unsafe fn dib(bitmap: windows_sys::Win32::Graphics::Gdi::HBITMAP, w: i32, h: i32) -> Option<Vec<u8>> {
    let mut bi: BITMAPINFO = std::mem::zeroed();
    bi.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: w,
        biHeight: -h,
        biPlanes: 1,
        biBitCount: 32,
        ..std::mem::zeroed()
    };
    let mut buf = vec![0u8; (w * h * 4) as usize];
    let dc = GetDC(null_mut());
    let lines = GetDIBits(dc, bitmap, 0, h as u32, buf.as_mut_ptr() as *mut _, &mut bi, DIB_RGB_COLORS);
    ReleaseDC(null_mut(), dc);
    (lines == h).then_some(buf)
}

/// The icon as PNG bytes, ready for the art cache.
pub fn exe_icon_png(exe: &str) -> Option<Vec<u8>> {
    let (w, h, rgba) = exe_icon_rgba(exe, 256)?;
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().ok()?;
        writer.write_image_data(&rgba).ok()?;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONITOR: (i32, i32, i32, i32) = (0, 0, 1920, 1080);
    const WS_POPUP: u32 = 0x8000_0000;
    const WS_OVERLAPPEDWINDOW: u32 = 0x00CF_0000;

    #[test]
    fn only_game_style_windows_count_as_fullscreen() {
        // Exclusive fullscreen / borderless game: a popup window over the whole monitor.
        assert!(is_game_fullscreen(MONITOR, MONITOR, false, WS_POPUP));
        // A maximized app (frameless or with an auto-hiding taskbar) covers the monitor too, but isn't a game.
        assert!(!is_game_fullscreen((-8, -8, 1928, 1088), MONITOR, true, WS_OVERLAPPEDWINDOW));
        assert!(!is_game_fullscreen(MONITOR, MONITOR, true, WS_POPUP | WS_THICKFRAME));
        // A resizable or captioned window sized to the screen by hand.
        assert!(!is_game_fullscreen(MONITOR, MONITOR, false, WS_POPUP | WS_THICKFRAME));
        assert!(!is_game_fullscreen(MONITOR, MONITOR, false, WS_OVERLAPPEDWINDOW));
        // Not covering the monitor at all.
        assert!(!is_game_fullscreen((0, 0, 1280, 720), MONITOR, false, WS_POPUP));
    }
}
