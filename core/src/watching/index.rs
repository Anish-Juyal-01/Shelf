//! Maps a running exe to a game: an exact known exe first, otherwise "the exe lives inside a game's install folder" (so
//! store games work without knowing which of their exes is the game). Crash handlers, anti-cheat bootstrappers and
//! other helper exes never count as playing.

use std::collections::HashMap;
use std::path::Path;

use crate::platform::path_key;
use crate::scanning::exes::is_never_playing;

#[derive(Debug, Default)]
pub struct GameIndex {
    exes: HashMap<String, i64>,
    /// Install folder keys ending in `\`, longest first (a mod folder inside a game wins over the game).
    roots: Vec<(String, i64)>,
}

impl GameIndex {
    /// `exes`: exe path keys → game id; `installs`: install folder → game id.
    pub fn new(exes: impl IntoIterator<Item = (String, i64)>, installs: impl IntoIterator<Item = (String, i64)>) -> Self {
        let mut roots: Vec<(String, i64)> = installs
            .into_iter()
            .filter(|(p, _)| !p.trim().is_empty())
            .map(|(p, id)| (path_key(&p), id))
            .filter(|(k, _)| k.len() > 3) // never a whole drive
            .map(|(k, id)| (if k.ends_with('\\') { k } else { k + "\\" }, id))
            .collect();
        roots.sort_by_key(|r| std::cmp::Reverse(r.0.len()));
        Self { exes: exes.into_iter().collect(), roots }
    }

    pub fn len(&self) -> usize {
        self.roots.len()
    }

    pub fn is_empty(&self) -> bool {
        self.roots.is_empty()
    }

    pub fn match_exe(&self, exe_path: Option<&str>) -> Option<i64> {
        let exe = exe_path.filter(|e| !e.is_empty())?;
        // Launchers, anti-cheat and helpers never count as playing, even if a launcher record named one (VALORANT is
        // started through the Riot Client, which then runs all day).
        let name = Path::new(exe).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if is_never_playing(&name) {
            return None;
        }
        let key = path_key(exe);
        if let Some(&id) = self.exes.get(&key) {
            return Some(id);
        }
        self.roots.iter().find(|(prefix, _)| key.starts_with(prefix.as_str())).map(|r| r.1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches() {
        let index = GameIndex::new(
            [(r"D:\ELSEWHERE\LAUNCH.EXE".to_string(), 7), (r"C:\RIOT GAMES\RIOT CLIENT\RIOTCLIENTSERVICES.EXE".to_string(), 1)],
            [(r"C:\Games\Hades".to_string(), 1), (r"C:\Games\Hades\Mods\BigMod".to_string(), 2), (r"C:\".to_string(), 3)],
        );
        for (exe, game) in [
            (Some(r"C:\Games\Hades\x64\Hades.exe"), Some(1)),
            (Some(r"c:\games\hades\Hades.exe"), Some(1)),
            (Some(r"C:\Games\Hades\Mods\BigMod\mod.exe"), Some(2)),
            (Some(r"D:\Elsewhere\launch.exe"), Some(7)),
            (Some(r"C:\Games\HadesII\Hades2.exe"), None),
            (Some(r"C:\Games\Hades\UnityCrashHandler64.exe"), None),
            (Some(r"C:\Games\Hades\EasyAntiCheat_EOS_Setup.exe"), None),
            (Some(r"C:\Windows\explorer.exe"), None),
            (Some(r"C:\Riot Games\Riot Client\RiotClientServices.exe"), None),
            (Some(r"C:\Program Files\Riot Vanguard\vgc.exe"), None),
            // Anything that ships next to a game but isn't it: a store helper, anti-cheat.
            (Some(r"C:\Games\Hades\EpicWebHelper.exe"), None),
            (Some(r"C:\Games\Hades\FACEIT.exe"), None),
            (None, None),
        ] {
            assert_eq!(index.match_exe(exe), game, "{exe:?}");
        }
    }
}
