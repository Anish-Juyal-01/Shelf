//! Decides whether a folder is a game root, from its own files and one level of subfolders. Every point added or
//! taken away is recorded as a human-readable signal, so the Review list can explain itself.

use std::path::Path;
use std::sync::LazyLock;

use fancy_regex::Regex;

use super::exes;
use super::listing::{DirListing, FileEntry};
use crate::naming;
use crate::platform::{format_bytes, normalize, MB};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum VerdictKind {
    #[default]
    None,
    Game,
    /// A downloaded installer or repack that hasn't been installed (setup.exe + big .bin files). A storage leftover.
    Installer,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct FolderVerdict {
    pub kind: VerdictKind,
    pub score: i32,
    pub signals: Vec<String>,
    pub title: Option<String>,
    pub launch_exe: Option<String>,
    pub play_exes: Vec<String>,
    /// Bytes seen while classifying (the folder's files plus one level down). A lower bound of the real size.
    pub seen_bytes: u64,
}

impl FolderVerdict {
    fn add(&mut self, points: i32, why: impl AsRef<str>) {
        self.score += points;
        self.signals.push(if points >= 0 { format!("+{points} {}", why.as_ref()) } else { format!("{points} {}", why.as_ref()) });
    }
}

#[derive(Debug, Clone)]
pub struct ClassifierOptions {
    /// Game-data archives (.pak, .bundle…) at least this big count as a strong signal.
    pub large_data_bytes: u64,
    /// Scores at or above this go straight to the library.
    pub library_threshold: i32,
    /// Scores between this and `library_threshold` go to the Review list; below are dropped.
    pub review_threshold: i32,
    /// How many subfolders to peek into when adding up data sizes.
    pub max_peek_dirs: usize,
}

impl Default for ClassifierOptions {
    fn default() -> Self {
        Self { large_data_bytes: 200 * MB, library_threshold: 70, review_threshold: 35, max_peek_dirs: 16 }
    }
}

const ARCHIVE_EXTENSIONS: &[&str] = &[
    "pak", "ucas", "utoc", "bundle", "assets", "ress", "resource", "arc", "pck", "rpa", "rpyc", "vpk", "wad", "forge", "rpf",
    "big", "cpk", "bdt", "bhd", "archive", "xp3", "gcf", "bsa", "ba2", "esm", "wpk", "bk2", "bik", "usm", "awb", "acb", "fsb",
    "bnk", "wem", "xwb", "pkg", "sga", "dat0", "rgssad", "rgss2a", "rgss3a", "obb", "cache", "tiger", "toc", "sb", "cas", "dz",
    "mpk", "gpk", "upk", "u", "umap",
];

const MIDDLEWARE: &[&str] = &[
    "fmod", "fmodex", "fmodstudio", "bink2w64", "binkw32", "binkw64", "physx", "amd_ags", "nvngx_dlss", "xinput1_3", "d3dx9_",
    "openal32", "ffx_fsr", "discord_game_sdk", "sl.interposer", "oo2core", "oo2net", "wwise", "aksoundengine", "libfmod", "sdl2",
    "gameoverlayrenderer", "nvlowlatency", "gfsdk_", "phonon", "criware", "cri_", "mono-2.0", "havok",
];

const EXE_SUBFOLDERS: &[&str] =
    &["bin", "bin64", r"bin\x64", r"bin\win64", r"bin\win_x64", "x64", "win64", r"binaries\win64", "game", r"game\bin\win64"];

const GENERIC_FOLDER_NAMES: &[&str] = &[
    "bin", "bin64", "x64", "x86", "win64", "win32", "binaries", "release", "content", "app", "files", "game", "data", "common",
    "build", "windows", "windowsnoeditor", "pc", "live",
];

const LAYOUT_FOLDER_NAMES: &[&str] =
    &["bin", "bin64", "bin32", "x64", "x86", "win64", "win32", "win_x64", "binaries", "retail", "release", "shipping"];

fn re(p: &str) -> Regex {
    Regex::new(p).expect("valid pattern")
}

static GAMES_FOLDER: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?i)^(my ?)?(games?|jeux|spiele|juegos|giochi|jogos|repacks?|steamlibrary|epic ?games|gog ?games|xboxgames)$"));
/// Hash or GUID folder names (launcher caches, Xbox content ids) say nothing about the game.
static HASH_NAME: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?i)^(\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?|[0-9a-f]{16,})$"));
static REPACK_NAME: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?i)fitgirl|dodi|elamigos|repack|codex|empress|tenoke|rune|plaza|skidrow|gog|multi\d|v\d+\.\d"));
static UNLIKELY_MAIN: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?i)launcher|config|settings|editor|server|tool|benchmark|crash|report|setup|unins|modmanager|sdk|test"));
static SETUP_EXE: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)^(setup|install|installer)([-_ ].*)?$|.*[-_ ]setup$"));
static INSTALLER_PAYLOAD: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)\.(bin|cab|dat|7z|zip|rar)$|^fg-\d+|^setup-\d+|^data\d*"));

fn m(r: &Regex, s: &str) -> bool {
    r.is_match(s).unwrap_or(false)
}

fn in_list(list: &[&str], s: &str) -> bool {
    list.iter().any(|x| x.eq_ignore_ascii_case(s))
}

fn file_name(path: &str) -> String {
    Path::new(path).file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default()
}

fn join(dir: &str, name: &str) -> String {
    Path::new(dir).join(name).to_string_lossy().into_owned()
}

pub fn evaluate_path(path: &str, options: &ClassifierOptions) -> FolderVerdict {
    match DirListing::try_read(path) {
        Some(listing) => evaluate(&listing, options),
        None => FolderVerdict::default(),
    }
}

pub fn evaluate(root: &DirListing, options: &ClassifierOptions) -> FolderVerdict {
    // Folders that hold this folder's exes: itself plus common layouts (bin\x64, Binaries\Win64…).
    let mut exe_dirs: Vec<DirListing> = vec![root.clone()];
    for sub in EXE_SUBFOLDERS {
        let first = sub.split('\\').next().unwrap();
        if !root.has_dir(first) {
            continue;
        }
        if let Some(l) = DirListing::try_read(join(&root.path, sub)) {
            if l.files.iter().any(|f| exes::is_exe(&f.name)) {
                exe_dirs.push(l);
            }
        }
    }

    // (index into exe_dirs, file)
    let all_exes: Vec<(usize, &FileEntry)> =
        exe_dirs.iter().enumerate().flat_map(|(i, d)| d.files.iter().filter(|f| exes::is_exe(&f.name)).map(move |f| (i, f))).collect();
    let game_exes: Vec<(usize, &FileEntry)> = all_exes.iter().copied().filter(|(_, f)| !exes::is_noise(&f.name)).collect();

    let mut v = FolderVerdict::default();
    if game_exes.is_empty() {
        let names: Vec<&str> = all_exes.iter().map(|(_, f)| f.name.as_str()).collect();
        return if is_installer(root, &names, &mut v) { v } else { FolderVerdict::default() };
    }

    let files: Vec<&FileEntry> = exe_dirs.iter().flat_map(|d| d.files.iter()).collect();
    let has = |name: &str| files.iter().any(|f| f.name.eq_ignore_ascii_case(name));
    let starts = |prefix: &str| files.iter().any(|f| f.name.to_lowercase().starts_with(&prefix.to_lowercase()));

    // Peek one level down for data sizes (Unity *_Data, Data*.bdt folders, Content\Paks…).
    let mut nearby: Vec<FileEntry> = root.files.clone();
    for d in root.dirs.iter().take(options.max_peek_dirs) {
        if d.name.eq_ignore_ascii_case("locales") {
            continue;
        }
        if let Some(l) = DirListing::try_read(join(&root.path, &d.name)) {
            nearby.extend(l.files);
        }
    }
    v.seen_bytes = nearby.iter().map(|f| f.len).sum();

    // --- Engines ---
    if has("UnityPlayer.dll") {
        v.add(45, "Unity engine (UnityPlayer.dll)");
    }
    if has("GameAssembly.dll") {
        v.add(10, "IL2CPP build (GameAssembly.dll)");
    }
    if game_exes.iter().any(|(i, f)| exe_dirs[*i].has_dir(&format!("{}_Data", exes::stem(&f.name)))) {
        v.add(20, "Unity data folder (<exe>_Data)");
    }

    let (shipping, paks) = find_shipping_exes(root);
    nearby.extend(paks);
    if !shipping.is_empty() || game_exes.iter().any(|(_, f)| f.name.to_lowercase().contains("-shipping")) {
        v.add(45, "Unreal shipping build (*-Shipping.exe)");
    } else if root.has_dir("Engine") {
        v.add(25, "Unreal/CryEngine layout (Engine folder)");
    }

    if game_exes.iter().any(|(i, f)| exe_dirs[*i].has_file(&format!("{}.pck", exes::stem(&f.name)))) {
        v.add(45, "Godot game (.pck beside exe)");
    }
    if has("data.win") {
        v.add(45, "GameMaker game (data.win)");
    }
    if root.has_dir("renpy") {
        v.add(45, "Ren'Py game");
    }
    if starts("Game.rgss") || has("RGSS301.dll") || has("RGSS104E.dll") || (root.has_dir("www") && has("nw.dll")) {
        v.add(40, "RPG Maker game");
    }
    if has("MonoGame.Framework.dll") || has("FNA.dll") || starts("Microsoft.Xna.Framework") {
        v.add(40, "XNA/MonoGame/FNA game");
    }
    if has("love.dll") {
        v.add(35, "LÖVE game");
    }
    let source_bin = root.has_dir("bin") && DirListing::try_read(join(&root.path, "bin")).is_some_and(|b| b.has_file("engine.dll"));
    if nearby.iter().any(|f| f.name.to_lowercase().ends_with(".vpk")) || source_bin {
        v.add(35, "Source engine game");
    }

    // --- Store / DRM fingerprints ---
    if has("steam_api64.dll") || has("steam_api.dll") {
        v.add(25, "Steamworks (steam_api)");
    }
    if has("steam_emu.ini") || has("steam_appid.txt") || has("cream_api.ini") || files.iter().any(|f| f.name.to_lowercase().ends_with(".cdx")) {
        v.add(10, "Steam emulator / app id file");
    }
    if starts("goggame-") || root.files.iter().any(|f| f.name.to_lowercase().starts_with("goggame-")) {
        v.add(30, "GOG game (goggame-*.info)");
    }
    if has("EOSSDK-Win64-Shipping.dll") || has("EOSSDK-Win32-Shipping.dll") {
        v.add(15, "Epic Online Services SDK");
    }
    if has("uplay_r1_loader64.dll") || has("upc_r2_loader64.dll") || has("uplay_r2_loader64.dll") {
        v.add(25, "Ubisoft Connect SDK");
    }

    let middleware = files
        .iter()
        .filter(|f| {
            let n = f.name.to_lowercase();
            n.ends_with(".dll") && MIDDLEWARE.iter().any(|m| n.starts_with(m))
        })
        .count() as i32;
    if middleware > 0 {
        v.add((middleware * 10).min(25), format!("Game middleware ({middleware} libraries: audio, video, physics, upscaling…)"));
    }
    if game_exes.iter().any(|(_, f)| exes::is_known_game(&f.name)) {
        v.add(60, "Known game exe");
    }

    // --- Data size ---
    let archive_bytes: u64 = nearby.iter().filter(|f| is_game_archive(&f.name)).map(|f| f.len).sum();
    let large = options.large_data_bytes;
    if archive_bytes >= large * 10 {
        v.add(35, format!("Large game data files ({})", format_bytes(archive_bytes as i64)));
    } else if archive_bytes >= large {
        v.add(25, format!("Game data files ({})", format_bytes(archive_bytes as i64)));
    } else if v.seen_bytes >= large * 10 {
        v.add(20, format!("Large folder beside the exe ({}+)", format_bytes(v.seen_bytes as i64)));
    } else if v.seen_bytes as f64 >= large as f64 * 2.5 {
        v.add(15, format!("Sizeable folder beside the exe ({}+)", format_bytes(v.seen_bytes as i64)));
    }

    // --- Context ---
    if in_games_folder(&root.path) {
        v.add(15, "Inside a Games folder");
    }
    if m(&REPACK_NAME, &file_name(&root.path)) {
        v.add(15, "Repack/release name");
    }

    // --- Things that aren't games ---
    if root.has_dir("resources") && (root.has_file("chrome_100_percent.pak") || root.has_file("v8_context_snapshot.bin")) {
        v.add(-60, "Electron app (Chromium runtime)");
    } else if has("libcef.dll") && v.score < options.library_threshold {
        v.add(-15, "Embedded browser (CEF)");
    }
    if has("Qt5Core.dll") || has("Qt6Core.dll") {
        v.add(-15, "Qt desktop app");
    }
    if game_exes.iter().any(|(_, f)| exes::is_known_app(&f.name)) {
        v.add(-80, "Known non-game program");
    }

    v.score = v.score.clamp(0, 100);
    v.kind = if v.score >= options.review_threshold { VerdictKind::Game } else { VerdictKind::None };

    pick_exes(root, &exe_dirs, &game_exes, &shipping, &mut v);
    v.title = Some(pick_title(&root.path, v.launch_exe.as_deref()));
    v
}

/// Unreal layout: `<Game>\Binaries\Win64\<Game>-Win64-Shipping.exe` beside an Engine folder. Also returns the pak files.
fn find_shipping_exes(root: &DirListing) -> (Vec<String>, Vec<FileEntry>) {
    let mut result = Vec::new();
    let mut paks = Vec::new();
    if !root.has_dir("Engine") {
        return (result, paks);
    }
    for d in root.dirs.iter().filter(|d| !d.name.eq_ignore_ascii_case("Engine")) {
        let bin = Path::new(&root.path).join(&d.name).join("Binaries").join("Win64");
        let Some(l) = DirListing::try_read(&bin) else { continue };
        result.extend(
            l.files
                .iter()
                .filter(|f| exes::is_exe(&f.name) && f.name.to_lowercase().contains("-shipping"))
                .map(|f| bin.join(&f.name).to_string_lossy().into_owned()),
        );
        // Unreal keeps its data two levels down: <Game>\Content\Paks.
        if let Some(p) = DirListing::try_read(Path::new(&root.path).join(&d.name).join("Content").join("Paks")) {
            paks.extend(p.files);
        }
    }
    (result, paks)
}

fn pick_exes(root: &DirListing, exe_dirs: &[DirListing], game_exes: &[(usize, &FileEntry)], shipping: &[String], v: &mut FolderVerdict) {
    let folder_key = naming::key(&file_name(&root.path));
    let largest = game_exes.iter().map(|(_, f)| f.len).max().unwrap_or(0);
    let mut ranked: Vec<(String, i32)> = game_exes
        .iter()
        .map(|(i, f)| {
            let stem = exes::stem(&f.name);
            let key = naming::key(stem);
            let mut score = 0;
            if key.len() >= 3 && folder_key.len() >= 3 && (folder_key.starts_with(&key) || key.starts_with(&folder_key)) {
                score += 4;
            }
            if exe_dirs[*i].has_dir(&format!("{stem}_Data")) {
                score += 4;
            }
            if *i == 0 {
                score += 2; // in the root folder itself
            }
            if f.len == largest {
                score += 1;
            }
            if m(&UNLIKELY_MAIN, stem) {
                score -= 3;
            }
            if exes::is_known_game(&f.name) {
                score += 5;
            }
            (join(&exe_dirs[*i].path, &f.name), score)
        })
        .collect();
    ranked.sort_by_key(|(_, s)| std::cmp::Reverse(*s)); // stable: ties keep listing order
    v.launch_exe = ranked.first().map(|(p, _)| p.clone());
    v.play_exes.extend(ranked.into_iter().map(|(p, _)| p));
    for s in shipping {
        if !v.play_exes.iter().any(|e| e.eq_ignore_ascii_case(s)) {
            v.play_exes.push(s.clone());
        }
    }
}

/// The game folder for an exe: its own folder, or a parent when the exe sits in a layout folder such as `bin` or
/// `Binaries\Win64`.
pub fn install_root_for(exe: &str) -> String {
    let norm = normalize(exe);
    let mut dir = Path::new(&norm).parent().map(|p| p.to_path_buf()).unwrap_or_default();
    for _ in 0..3 {
        let name = dir.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
        let Some(parent) = dir.parent() else { break };
        if !in_list(LAYOUT_FOLDER_NAMES, &name) {
            break;
        }
        dir = parent.to_path_buf();
    }
    // Unreal: <Root>\<Game>\Binaries\Win64 → <Root> when an Engine folder sits beside <Game>.
    if let Some(up) = dir.parent() {
        if up.join("Engine").is_dir() && dir.join("Binaries").is_dir() {
            dir = up.to_path_buf();
        }
    }
    dir.to_string_lossy().into_owned()
}

pub fn title_for(root: &str, exe: Option<&str>) -> String {
    pick_title(root, exe)
}

fn pick_title(path: &str, launch_exe: Option<&str>) -> String {
    let folder = file_name(path);
    if let Some(exe) = launch_exe {
        if m(&HASH_NAME, &folder) {
            return naming::clean(&file_name(exe));
        }
    }
    if in_list(GENERIC_FOLDER_NAMES, &folder) {
        let parent = Path::new(path).parent().map(|p| file_name(&p.to_string_lossy())).unwrap_or_default();
        if !parent.is_empty() && !in_list(GENERIC_FOLDER_NAMES, &parent) && !is_games_folder_name(&parent) {
            return naming::clean(&parent);
        }
        if let Some(exe) = launch_exe {
            return naming::clean(&file_name(exe));
        }
    }
    naming::clean(&folder)
}

fn is_installer(root: &DirListing, exe_names: &[&str], v: &mut FolderVerdict) -> bool {
    let Some(setup) = exe_names.iter().find(|n| m(&SETUP_EXE, exes::stem(n))) else { return false };
    let payload: u64 = root.files.iter().filter(|f| m(&INSTALLER_PAYLOAD, &f.name)).map(|f| f.len).sum();
    let fitgirl = root.has_dir("MD5") || root.files.iter().any(|f| f.name.to_lowercase().starts_with("fg-"));
    if payload < 50 * MB && !fitgirl {
        return false;
    }
    v.kind = VerdictKind::Installer;
    v.score = 60;
    v.seen_bytes = root.files.iter().map(|f| f.len).sum();
    v.signals.push(format!("Installer with {} of packed data (not installed)", format_bytes(payload as i64)));
    v.title = Some(naming::clean(&file_name(&root.path)));
    v.launch_exe = Some(join(&root.path, setup));
    true
}

pub fn is_game_archive(name: &str) -> bool {
    let lower = name.to_lowercase();
    let Some(ext) = Path::new(&lower).extension().map(|e| e.to_string_lossy().into_owned()) else { return false };
    if !ARCHIVE_EXTENSIONS.contains(&ext.as_str()) {
        return false;
    }
    // Chromium/Electron/CEF ship .pak files too.
    !(lower.starts_with("chrome") || lower == "resources.pak" || lower.starts_with("cef") || lower.starts_with("devtools"))
}

/// Whether any folder above this one (not the folder itself) is a "Games" folder.
pub fn in_games_folder(path: &str) -> bool {
    let norm = normalize(path);
    let parts: Vec<&str> = norm.split('\\').filter(|p| !p.is_empty()).collect();
    parts.iter().take(parts.len().saturating_sub(1)).any(|p| is_games_folder_name(p))
}

pub fn is_games_folder_name(name: &str) -> bool {
    m(&GAMES_FOLDER, name)
}
