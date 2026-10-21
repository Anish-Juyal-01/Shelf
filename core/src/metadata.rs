//! Art Shelf couldn't find on disk, looked up on the web. Two sources, both optional:
//!
//! - Steam (no key): the store's search finds the game's app id by title (or the install already knows it), and the
//!   cover, hero and logo come from Steam's image CDN.
//! - SteamGridDB (free API key): community art for any game — Steam or not — including square icons.
//!
//! Only the game's title (or Steam app id) is sent. A title only counts as a match when it's the same game after
//! cleaning (editions and punctuation aside), so a wrong cover is much less likely than no cover.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::Value;

use crate::art::ArtKind;
use crate::model::SourceKind;
use crate::naming;
use crate::platform::now_ms;
use crate::storage::art_cache::{ArtCache, WebLookup};
use crate::storage::library::LibraryStore;

pub const STEAM_CDN: &str = "https://cdn.cloudflare.steamstatic.com/steam/apps";
pub const STEAM_SEARCH: &str = "https://store.steampowered.com/api/storesearch/";
pub const STEAM_GRID_DB: &str = "https://www.steamgriddb.com/api/v2";
const MAX_BYTES: usize = 15 * 1024 * 1024;

/// A finished HTTP exchange (any status). `Err` is reserved for "couldn't talk to the server at all".
pub struct Response {
    pub status: u16,
    pub body: Vec<u8>,
}

/// GET over HTTPS, behind a trait so tests can answer without a network.
pub trait Http: Send + Sync {
    fn get(&self, url: &str, bearer: Option<&str>) -> Result<Response, String>;
}

/// The real client: 20 s timeout, bodies capped at 15 MB.
pub struct UreqHttp {
    agent: ureq::Agent,
}

impl UreqHttp {
    pub fn new(user_agent: &str) -> Self {
        Self { agent: ureq::AgentBuilder::new().timeout(Duration::from_secs(20)).user_agent(user_agent).build() }
    }
}

impl Http for UreqHttp {
    fn get(&self, url: &str, bearer: Option<&str>) -> Result<Response, String> {
        let mut req = self.agent.get(url);
        if let Some(b) = bearer {
            req = req.set("Authorization", &format!("Bearer {b}"));
        }
        match req.call() {
            Ok(res) => {
                let status = res.status();
                let mut body = Vec::new();
                res.into_reader().take(MAX_BYTES as u64 + 1).read_to_end(&mut body).map_err(|e| e.to_string())?;
                Ok(Response { status, body })
            }
            Err(ureq::Error::Status(status, _)) => Ok(Response { status, body: Vec::new() }),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Image {
    pub bytes: Vec<u8>,
    pub ext: &'static str,
}

/// What was found. `failed` means the network let us down (try again later, don't remember a miss).
#[derive(Debug, Default)]
pub struct WebResult {
    pub art: BTreeMap<ArtKind, Image>,
    pub matched: Option<String>,
    pub failed: bool,
}

pub struct WebArt<'a> {
    http: &'a dyn Http,
    grid_key: Option<String>,
}

/// Server trouble (rate limit, outage, no connection): the whole lookup is a failure, not a miss.
struct Trouble;

impl<'a> WebArt<'a> {
    pub fn new(http: &'a dyn Http, steam_grid_db_key: Option<&str>) -> Self {
        Self { http, grid_key: steam_grid_db_key.map(str::trim).filter(|k| !k.is_empty()).map(String::from) }
    }

    pub fn has_steam_grid_db(&self) -> bool {
        self.grid_key.is_some()
    }

    pub fn fetch(&self, title: &str, steam_app_id: Option<&str>, want: &BTreeSet<ArtKind>) -> WebResult {
        let mut r = WebResult::default();
        if self.fetch_into(title, steam_app_id, want, &mut r).is_err() {
            r.failed = true;
        }
        r
    }

    fn fetch_into(&self, title: &str, steam_app_id: Option<&str>, want: &BTreeSet<ArtKind>, r: &mut WebResult) -> Result<(), Trouble> {
        let app_id = match steam_app_id {
            Some(id) => Some(id.to_string()),
            None => self.find_steam_app(title)?,
        };
        if let Some(id) = &app_id {
            r.matched = Some(format!("steam:{id}"));
            let cdn = |f: &str| format!("{STEAM_CDN}/{id}/{f}");
            if want.contains(&ArtKind::Cover) {
                self.try_urls(r, ArtKind::Cover, &[cdn("library_600x900_2x.jpg"), cdn("library_600x900.jpg")])?;
            }
            if want.contains(&ArtKind::Hero) {
                self.try_urls(r, ArtKind::Hero, &[cdn("library_hero.jpg")])?;
            }
            if want.contains(&ArtKind::Logo) {
                self.try_urls(r, ArtKind::Logo, &[cdn("logo.png")])?;
            }
        }
        if self.grid_key.is_some() && want.iter().any(|k| !r.art.contains_key(k)) {
            let mut game = None;
            if let Some(id) = &app_id {
                game = self.grid_game_by_steam(id)?;
            }
            if game.is_none() {
                game = self.grid_search(title)?;
            }
            if let Some(game) = game {
                r.matched.get_or_insert_with(|| format!("sgdb:{game}"));
                let missing: Vec<ArtKind> = want.iter().copied().filter(|k| !r.art.contains_key(k)).collect();
                for kind in missing {
                    if let Some(url) = self.grid_url(kind, &game)? {
                        self.try_urls(r, kind, &[url])?;
                    }
                }
            }
        }
        Ok(())
    }

    /// Steam's store search, keeping only a result that's the same game by name.
    fn find_steam_app(&self, title: &str) -> Result<Option<String>, Trouble> {
        let Some(json) = self.get_json(&format!("{STEAM_SEARCH}?term={}&l=english&cc=US", escape(title)), false)? else { return Ok(None) };
        let want = match_key(title);
        Ok(json["items"].as_array().into_iter().flatten().find(|i| i["name"].as_str().is_some_and(|n| match_key(n) == want)).and_then(|i| id_text(&i["id"])))
    }

    fn grid_game_by_steam(&self, app_id: &str) -> Result<Option<String>, Trouble> {
        Ok(self.get_json(&format!("{STEAM_GRID_DB}/games/steam/{app_id}"), true)?.and_then(|j| id_text(&j["data"]["id"])))
    }

    fn grid_search(&self, title: &str) -> Result<Option<String>, Trouble> {
        let Some(json) = self.get_json(&format!("{STEAM_GRID_DB}/search/autocomplete/{}", escape(title)), true)? else { return Ok(None) };
        let want = match_key(title);
        Ok(json["data"].as_array().into_iter().flatten().find(|g| g["name"].as_str().is_some_and(|n| match_key(n) == want)).and_then(|g| id_text(&g["id"])))
    }

    fn grid_url(&self, kind: ArtKind, game: &str) -> Result<Option<String>, Trouble> {
        let path = match kind {
            ArtKind::Cover => format!("grids/game/{game}?dimensions=600x900,342x482,660x930&types=static"),
            ArtKind::Hero => format!("heroes/game/{game}?types=static"),
            ArtKind::Logo => format!("logos/game/{game}?types=static&mimes=image/png"),
            ArtKind::Icon => format!("icons/game/{game}?types=static&mimes=image/png"),
        };
        let Some(json) = self.get_json(&format!("{STEAM_GRID_DB}/{path}"), true)? else { return Ok(None) };
        Ok(json["data"].as_array().into_iter().flatten().filter_map(|a| a["url"].as_str()).find(|u| u.starts_with("https://")).map(String::from))
    }

    fn try_urls(&self, r: &mut WebResult, kind: ArtKind, urls: &[String]) -> Result<(), Trouble> {
        for url in urls {
            let res = self.http.get(url, None).map_err(|_| Trouble)?;
            if res.status != 200 || res.body.is_empty() || res.body.len() > MAX_BYTES {
                continue;
            }
            if let Some(ext) = sniff(&res.body) {
                r.art.insert(kind, Image { bytes: res.body, ext });
                return Ok(());
            }
        }
        Ok(())
    }

    fn get_json(&self, url: &str, grid: bool) -> Result<Option<Value>, Trouble> {
        let bearer = if grid { self.grid_key.as_deref() } else { None };
        let res = self.http.get(url, bearer).map_err(|_| Trouble)?;
        if res.status == 429 || res.status >= 500 {
            return Err(Trouble);
        }
        if !(200..300).contains(&res.status) {
            return Ok(None);
        }
        Ok(serde_json::from_slice(&res.body).ok())
    }
}

fn id_text(v: &Value) -> Option<String> {
    match v {
        Value::Number(n) => Some(n.to_string()),
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

/// Percent-encoding like .NET's `Uri.EscapeDataString`: everything but unreserved characters.
fn escape(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// The file type from its first bytes — only real images get saved, whatever the server says.
pub fn sniff(b: &[u8]) -> Option<&'static str> {
    if b.len() < 12 {
        None
    } else if b[0] == 0xFF && b[1] == 0xD8 {
        Some(".jpg")
    } else if b.starts_with(b"\x89PNG") {
        Some(".png")
    } else if b.starts_with(b"RIFF") && &b[8..12] == b"WEBP" {
        Some(".webp")
    } else if b.starts_with(&[0, 0, 1, 0]) {
        Some(".ico")
    } else {
        None
    }
}

const EDITION_WORDS: &[&str] = &[
    "game of the year", "goty", "definitive", "deluxe", "complete", "ultimate", "gold", "premium", "standard", "remastered", "anniversary",
    "director's cut", "edition",
];

/// A title's identity for matching search results: the name key without edition words.
pub fn match_key(title: &str) -> String {
    let mut s = format!(" {} ", naming::clean(title).to_lowercase());
    for w in EDITION_WORDS {
        s = s.replace(&format!(" {w} "), " ");
    }
    naming::key(&s)
}

/// Fills the gaps in every installed game's art from the web, never replacing what was found on disk. Each game is
/// looked up at most once a week, unless a SteamGridDB key has been added since; a network failure isn't remembered,
/// so it simply tries again next time.
pub struct WebArtSync<'a> {
    pub library: &'a LibraryStore,
    pub cache: &'a ArtCache,
    pub web: WebArt<'a>,
    /// Pause between games, to stay polite to the services.
    pub pace: Duration,
}

pub const RETRY_AFTER_MS: i64 = 7 * 24 * 3600 * 1000;

#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct SyncSummary {
    pub looked: usize,
    pub images: usize,
    pub failed: usize,
}

impl WebArtSync<'_> {
    pub fn run(&self, now: impl Fn() -> i64, mut on_game: impl FnMut(&str, usize), cancel: &AtomicBool) -> rusqlite::Result<SyncSummary> {
        let mut s = SyncSummary::default();
        for g in self.library.games(true)?.into_iter().filter(|g| g.installed) {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let want: BTreeSet<ArtKind> = ArtKind::ALL.into_iter().filter(|&k| !self.cache.has(g.id, k)).collect();
            if want.is_empty() {
                continue;
            }
            if let Some(mark) = self.cache.web_mark(g.id) {
                if now() - mark.tried < RETRY_AFTER_MS && (mark.with_grid || !self.web.has_steam_grid_db()) {
                    continue;
                }
            }
            let app_id = self
                .library
                .installs_for(g.id)?
                .into_iter()
                .filter(|i| i.source == SourceKind::Steam)
                .filter_map(|i| i.launch_uri.and_then(|u| u.rsplit('/').next().map(String::from)))
                .find(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()));
            let r = self.web.fetch(&g.title, app_id.as_deref(), &want);
            s.looked += 1;
            for (&kind, img) in &r.art {
                if self.cache.write(g.id, kind, img.ext, &img.bytes).is_ok() {
                    s.images += 1;
                }
            }
            if r.failed {
                s.failed += 1;
            } else {
                let _ = self.cache.mark_web(g.id, &WebLookup { tried: now(), matched: r.matched.clone(), with_grid: self.web.has_steam_grid_db() });
            }
            on_game(&g.title, r.art.len());
            if !self.pace.is_zero() {
                std::thread::sleep(self.pace);
            }
        }
        Ok(s)
    }
}

/// `now_ms` as a clock for [`WebArtSync::run`].
pub fn system_clock() -> i64 {
    now_ms()
}
