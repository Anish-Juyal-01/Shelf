//! Flags an unknown program that stays in the foreground, fullscreen or with sustained 3D GPU use, for a minute. Pure
//! logic: the watcher feeds it one observation per poll.

use std::collections::HashSet;
use std::path::Path;

use crate::platform::{is_same_or_inside, path_key};
use crate::scanning::exes::{is_never_playing, stem};

#[derive(Debug, Clone)]
pub struct DetectorOptions {
    /// How long an unknown program must look like a game before Shelf asks.
    pub sustain_ms: i64,
    /// 3D-engine GPU use that counts as "playing" for windowed games.
    pub gpu_threshold: f64,
}

impl Default for DetectorOptions {
    fn default() -> Self {
        Self { sustain_ms: 60_000, gpu_threshold: 35.0 }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RuntimeCandidate {
    pub pid: u32,
    pub exe_path: String,
    pub fullscreen: bool,
    pub gpu_3d: Option<f64>,
}

/// Programs that go fullscreen or use the GPU without being games (exe stems, lowercase).
const NOT_GAMES: &[&str] = &[
    "explorer", "applicationframehost", "lockapp", "searchhost", "searchapp", "shellexperiencehost", "textinputhost",
    "startmenuexperiencehost", "dwm", "msedgewebview2", "windowsterminal", "conhost", "cmd", "powershell", "pwsh", "vlc",
    "mpc-hc", "mpc-hc64", "mpc-be", "mpc-be64", "potplayer", "potplayermini", "potplayermini64", "mpv", "wmplayer", "video.ui",
    "microsoft.media.player", "netflix", "powerpnt", "acrord32", "acrobat", "photoshop", "afterfx", "adobe premiere pro",
    "lightroom", "davinci resolve", "obs64", "streamlabs obs", "slack", "whatsapp", "whatsapp.root", "telegram", "ms-teams",
    "teams", "zoom", "spotify", "rider64", "pycharm64", "clion64", "webstorm64", "shelf", "shelf-cli", "claude", "chatgpt",
    "nvidia overlay", "nvidia app", "gamebar", "gamebarftserver", "xboxpcapp", "steamwebhelper", "epicwebhelper", "eadesktop",
    "upc", "galaxyclient", "battle.net", "riotclientux", "hoyoplay", "launcher", "parsecd", "moonlight", "sunshine",
    "screenclippinghost", "snippingtool", "magnify", "photos", "microsoft.photos",
];

/// Exes that are never worth asking about: helpers, known apps, Windows itself, and Store apps. (Store games are
/// read by the Xbox reader, so anything unknown under `WindowsApps` is an app — the C# build once asked whether
/// Claude and WhatsApp were games.)
pub fn is_excluded(exe_path: &str) -> bool {
    let name = Path::new(exe_path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if is_never_playing(&name) || NOT_GAMES.contains(&stem(&name).to_lowercase().as_str()) {
        return true;
    }
    if path_key(exe_path).contains(r"\WINDOWSAPPS\") {
        return true;
    }
    let windows = std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into());
    is_same_or_inside(exe_path, &windows)
}

#[derive(Debug, Default)]
pub struct RuntimeDetector {
    o: DetectorOptions,
    suggested: HashSet<String>,
    exe: Option<String>,
    since: i64,
    saw_fullscreen: bool,
    peak_gpu: f64,
    /// GPU readings during this streak, and whether any was below the "playing" threshold.
    gpu_samples: usize,
    gpu_dipped: bool,
}

/// GPU readings needed (one per poll) before "busy the whole time" means anything.
const STRONG_GPU_SAMPLES: usize = 6;

impl RuntimeDetector {
    pub fn new(options: DetectorOptions) -> Self {
        Self { o: options, ..Default::default() }
    }

    fn same(&self, exe: &str) -> bool {
        self.exe.as_deref().is_some_and(|e| e.eq_ignore_ascii_case(exe))
    }

    /// The exe to suggest when one crosses the threshold (once per exe).
    pub fn observe(&mut self, candidate: Option<&RuntimeCandidate>, now: i64) -> Option<String> {
        let qualifies = candidate.is_some_and(|c| c.fullscreen || c.gpu_3d.is_some_and(|g| g >= self.o.gpu_threshold));
        if !qualifies {
            // A missing GPU reading right after switching processes isn't evidence either way; keep the streak.
            if let Some(c) = candidate {
                if self.same(&c.exe_path) && c.gpu_3d.is_none() && !c.fullscreen {
                    return None;
                }
            }
            self.exe = None;
            return None;
        }
        let c = candidate?;
        if !self.same(&c.exe_path) {
            self.exe = Some(c.exe_path.clone());
            self.since = now;
            self.saw_fullscreen = false;
            self.peak_gpu = 0.0;
            self.gpu_samples = 0;
            self.gpu_dipped = false;
        }
        self.saw_fullscreen |= c.fullscreen;
        if let Some(g) = c.gpu_3d {
            self.peak_gpu = self.peak_gpu.max(g);
            self.gpu_samples += 1;
            self.gpu_dipped |= g < self.o.gpu_threshold;
        }
        if now - self.since < self.o.sustain_ms || !self.suggested.insert(c.exe_path.to_lowercase()) {
            return None;
        }
        Some(c.exe_path.clone())
    }

    /// The 3D engine was busy at every reading of the streak (and there were enough readings to say so). On its own,
    /// that's enough to ask; anything weaker also needs game evidence in the program's folder.
    pub fn strong_gpu(&self) -> bool {
        self.gpu_samples >= STRONG_GPU_SAMPLES && !self.gpu_dipped
    }

    /// Why the last suggestion was made, for the Review list.
    pub fn last_signals(&self) -> Vec<String> {
        let secs = self.o.sustain_ms / 1000;
        let mut signals = Vec::new();
        if self.saw_fullscreen {
            signals.push(format!("Ran fullscreen for {secs}s+"));
        }
        if self.strong_gpu() {
            signals.push(format!("Kept the GPU busy for {secs}s+ (peak {:.0}%)", self.peak_gpu));
        }
        signals.push("Seen running, not found by any launcher or scan".into());
        signals
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXE: &str = r"D:\Stuff\Mystery Game\mystery.exe";

    fn c(exe: &str, fullscreen: bool, gpu: Option<f64>) -> RuntimeCandidate {
        RuntimeCandidate { pid: 1, exe_path: exe.into(), fullscreen, gpu_3d: gpu }
    }

    #[test]
    fn fullscreen_for_a_minute_is_suggested_once() {
        let mut d = RuntimeDetector::new(DetectorOptions::default());
        let mut now = 0;
        let mut hit = None;
        while hit.is_none() && now < 100_000 {
            hit = d.observe(Some(&c(EXE, true, None)), now);
            if hit.is_none() {
                now += 5000;
            }
        }
        assert_eq!(hit.as_deref(), Some(EXE));
        assert_eq!(now, 60_000);
        for _ in 0..30 {
            now += 5000;
            assert_eq!(d.observe(Some(&c(EXE, true, None)), now), None);
        }
    }

    #[test]
    fn switching_away_resets_the_clock() {
        let mut d = RuntimeDetector::new(DetectorOptions::default());
        let mut now = 0;
        for _ in 0..10 {
            d.observe(Some(&c(EXE, true, None)), now);
            now += 5000;
        }
        assert_eq!(d.observe(None, now), None); // alt-tabbed to the desktop
        for _ in 0..10 {
            assert_eq!(d.observe(Some(&c(EXE, true, None)), now), None);
            now += 5000;
        }
    }

    #[test]
    fn windowed_needs_sustained_gpu() {
        let mut d = RuntimeDetector::new(DetectorOptions::default());
        let mut hit = None;
        for i in 0..15 {
            hit = hit.or(d.observe(Some(&c(EXE, false, if i == 0 { None } else { Some(80.0) })), i * 5000));
        }
        assert_eq!(hit.as_deref(), Some(EXE));
        assert!(d.last_signals()[0].contains("peak 80%"));

        let mut idle = RuntimeDetector::new(DetectorOptions::default());
        for i in 0..30 {
            assert_eq!(idle.observe(Some(&c(r"D:\x\editor.exe", false, Some(5.0))), i * 5000), None);
        }
    }

    #[test]
    fn exclusions() {
        for (exe, excluded) in [
            (r"C:\Program Files\VideoLAN\VLC\vlc.exe", true),
            (r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe", true),
            (r"C:\Windows\explorer.exe", true),
            (r"C:\Program Files\Microsoft Office\root\Office16\POWERPNT.EXE", true),
            (r"C:\Program Files\WindowsApps\Claude_3.1623.0.0_x64__pzs8sxrjxfjjc\app\claude.exe", true),
            (r"C:\Program Files\WindowsApps\5319275A.WhatsAppDesktop_2.2640.100.0_x64__cv1g1gvanyjgm\WhatsApp.Root.exe", true),
            (r"D:\Games\Mystery\mystery.exe", false),
        ] {
            assert_eq!(is_excluded(exe), excluded, "{exe}");
        }
    }
}
