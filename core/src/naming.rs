//! Turns folder and exe names like `Hollow_Knight_v1.5.78 [FitGirl Repack]` into `Hollow Knight`, and gives every
//! title a key so the same game spelled differently by two launchers is recognised as one.

use std::sync::LazyLock;

use fancy_regex::Regex;
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

/// Release groups, repackers and distribution tags that never belong in a title.
const GROUPS: &str = concat!(
    "FitGirl|DODI|ElAmigos|El Amigos|CODEX|EMPRESS|RUNE|TENOKE|PLAZA|SKIDROW|RELOADED|CPY|FLT|FLT-?Fairlight|DARKSiDERS|HOODLUM|",
    r"Razor1911|GOLDBERG|P2P|KaOs|xatab|Chovka|R\.G\. ?Mechanics|R\.G\.|Mechanics|SiMPLEX|PROPHET|TiNYiSO|DOGE|ANOMALY|",
    r"I_KnoW|Kaos|GOG|Steam ?Rip|SteamRIP|Repack|Repacked|Portable|Pre-?Installed|Cracked|Crack|MULTi\d*|Multi ?\d+|",
    "x64|x86|64-?bit|32-?bit|Win64|Win32|DRM-?Free|Free Download|Online Fix|OnlineFix"
);

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("valid pattern")
}

static SHIPPING: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)-Win(64|32)-Shipping$"));
static BRACKETS: LazyLock<Regex> = LazyLock::new(|| re(r"\[[^\]]*\]|\([^)]*\)|\{[^}]*\}"));
/// v1.2.3, version 1.05, Build 12345, Update 4, rev123, and bare dotted versions like 1.4.4.9.
static VERSION: LazyLock<Regex> = LazyLock::new(|| {
    re(r"(?i)(?<![\p{L}\d])(v\s?\d+(\.\d+)*[a-z]?|version\s?\d+(\.\d+)*|build\s?\d+(\.\d+)*|update\s?\d+(\.\d+)*|rev\s?\d+|\d+\.\d+\.\d+(\.\d+)*)(?![\p{L}\d])")
});
static WORD_DOTS: LazyLock<Regex> = LazyLock::new(|| re(r"(?<=[\p{L}\d])\.(?=[\p{L}\d])"));
static GROUP_TAG: LazyLock<Regex> = LazyLock::new(|| re(&format!(r"(?i)(?<![\p{{L}}\d])({GROUPS})(?![\p{{L}}\d])")));
/// A dangling " - " or "-" left after removing a tag at the end.
static TRAILING_DASH: LazyLock<Regex> = LazyLock::new(|| re(r"(\s*[-–]\s*)+$"));
static CAMEL: LazyLock<Regex> = LazyLock::new(|| re(r"(?<=\p{Ll})(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})"));
static LETTER_DIGIT: LazyLock<Regex> = LazyLock::new(|| re(r"(?<=\p{L}{2})(?=\d)"));
static SPACES: LazyLock<Regex> = LazyLock::new(|| re(r"\s+"));

fn sub(r: &Regex, s: &str, with: &str) -> String {
    r.replace_all(s, with).into_owned()
}

pub fn clean(raw: &str) -> String {
    let raw = raw.trim();
    if raw.is_empty() {
        return String::new();
    }
    let mut s = raw.to_string();
    if s.len() > 4 && s.get(s.len() - 4..).is_some_and(|t| t.eq_ignore_ascii_case(".exe")) {
        s.truncate(s.len() - 4);
    }
    s = sub(&SHIPPING, &s, "");
    // Everything in brackets is tags: [FitGirl Repack], (2018), {GOG}, (v1.2).
    s = sub(&BRACKETS, &s, " ");
    // Separators: underscores always; dots when they join words (not inside version numbers, handled next).
    s = s.replace('_', " ");
    s = sub(&VERSION, &s, " ");
    s = sub(&WORD_DOTS, &s, " ");
    s = sub(&GROUP_TAG, &s, " ");
    s = sub(&VERSION, &s, " ");
    s = sub(&TRAILING_DASH, &s, "");
    s = split_camel(&s);
    s = sub(&SPACES, &s, " ");
    let s = s.trim_matches(|c| matches!(c, ' ' | '-' | '–' | ':' | ',' | '.' | '+' | '&'));
    let s = fix_case(s);
    if s.is_empty() { raw.to_string() } else { s }
}

/// Edition labels that only clutter a title on a shelf (the game is the same). Longer labels first, so
/// "Digital Deluxe Edition" goes as a whole rather than leaving "Digital".
const EDITIONS: &[&str] = &[
    "Game of the Year", "Digital Deluxe", "GOTY", "Deluxe", "Definitive", "Complete", "Ultimate", "Gold", "Standard",
    "Premium", "Champions", "Collector's", "Enhanced", "Legendary", "Special", "Anniversary",
];

/// The name to show: the title as the launcher spells it, minus a trailing edition label
/// ("Sekiro Shadows Die Twice GOTY Edition" → "Sekiro Shadows Die Twice"). Identity ([`key`]) is unaffected.
pub fn display(title: &str) -> String {
    let s = title.trim();
    let lower = s.to_lowercase();
    for e in EDITIONS {
        let tail = format!(" {} edition", e.to_lowercase());
        if lower.len() > tail.len() && lower.ends_with(&tail) {
            let cut = s.len() - tail.len();
            if s.is_char_boundary(cut) {
                return s[..cut].trim_end_matches([' ', '-', '–', ':', ',']).to_string();
            }
        }
    }
    s.to_string()
}

/// Key for de-duplication: lower-case letters and digits only, accents, trademark signs and a leading "the" dropped.
pub fn key(title: &str) -> String {
    let s = clean(title).to_lowercase().replace('&', "and");
    let s = s.strip_prefix("the ").unwrap_or(&s);
    s.nfd().filter(|c| c.is_alphanumeric() && !is_combining_mark(*c)).collect()
}

fn split_camel(s: &str) -> String {
    // Only for squashed names (HollowKnight, Cyberpunk2077); anything with spaces already is left alone.
    if s.contains(' ') || s.chars().count() < 4 {
        return s.to_string();
    }
    let s = sub(&CAMEL, s, " ");
    sub(&LETTER_DIGIT, &s, " ")
}

const ROMAN: &[&str] = &["II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII"];
const SMALL_WORDS: &[&str] = &["of", "the", "and", "a", "an", "in", "on", "to", "for", "at", "or"];

/// ALL CAPS and all-lower-case names get Title Case (keeping Roman numerals and short acronyms).
fn fix_case(s: &str) -> String {
    let letters: Vec<char> = s.chars().filter(|c| c.is_alphabetic()).collect();
    if letters.is_empty() {
        return s.to_string();
    }
    let all_upper = letters.iter().all(|c| c.is_uppercase());
    let all_lower = letters.iter().all(|c| c.is_lowercase());
    if !all_upper && !all_lower {
        return s.to_string();
    }
    s.split(' ')
        .enumerate()
        .map(|(i, w)| {
            if w.is_empty() {
                String::new()
            } else if ROMAN.iter().any(|r| r.eq_ignore_ascii_case(w)) {
                w.to_uppercase()
            } else if all_upper && w.chars().count() <= 3 {
                w.to_string() // short all-caps words are usually acronyms (GTA, FEZ, DLC)
            } else if i > 0 && SMALL_WORDS.iter().any(|x| x.eq_ignore_ascii_case(w)) {
                w.to_lowercase()
            } else {
                let mut c = w.chars();
                let first = c.next().unwrap();
                first.to_uppercase().chain(c.as_str().to_lowercase().chars()).collect()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans() {
        let cases = [
            ("Hollow_Knight_v1.5.78 [FitGirl Repack]", "Hollow Knight"),
            ("F1 22 Champions Edition MULTi11 - ElAmigos version 1.05", "F1 22 Champions Edition"),
            ("Sekiro Shadows Die Twice GOTY Edition", "Sekiro Shadows Die Twice GOTY Edition"),
            ("Cyberpunk.2077.v2.1-GOG", "Cyberpunk 2077"),
            ("Baldurs.Gate.3.Build.12345-TENOKE", "Baldurs Gate 3"),
            ("Red Dead Redemption 2 [DODI Repack]", "Red Dead Redemption 2"),
            ("The Witcher 3 Wild Hunt - Complete Edition v4.04", "The Witcher 3 Wild Hunt - Complete Edition"),
            ("Terraria v1.4.4.9", "Terraria"),
            ("Disco Elysium The Final Cut (GOG)", "Disco Elysium The Final Cut"),
            ("Celeste (2018)", "Celeste"),
            ("HollowKnight.exe", "Hollow Knight"),
            ("Stray-Win64-Shipping.exe", "Stray"),
            ("Cyberpunk2077.exe", "Cyberpunk 2077"),
            ("DOOMEternal", "DOOM Eternal"),
            ("hades", "Hades"),
            ("SEKIRO", "Sekiro"),
            ("GTA V", "GTA V"),
            ("STAR WARS JEDI FALLEN ORDER", "Star Wars Jedi Fallen Order"),
            ("dark_souls_iii", "Dark Souls III"),
            ("Lies of P Deluxe Edition (v1.2.0.0 + DLC) [FitGirl Repack]", "Lies of P Deluxe Edition"),
            ("Elden Ring - Update 1.10", "Elden Ring"),
            ("Hogwarts.Legacy.Deluxe.Edition-EMPRESS", "Hogwarts Legacy Deluxe Edition"),
            ("Portal 2", "Portal 2"),
            ("F1 22", "F1 22"),
            ("Half-Life", "Half-Life"),
            ("Plants vs. Zombies GOTY", "Plants vs. Zombies GOTY"),
            ("DaVinci_Resolve_21.1.1_Windows", "DaVinci Resolve Windows"),
        ];
        for (raw, expected) in cases {
            assert_eq!(clean(raw), expected, "clean({raw:?})");
        }
    }

    #[test]
    fn never_returns_empty_for_non_empty_input() {
        assert_eq!(clean("[FitGirl Repack]"), "[FitGirl Repack]");
        assert_eq!(clean("   "), "");
    }

    #[test]
    fn keys_match_across_spellings() {
        for (a, b) in [
            ("Sekiro™: Shadows Die Twice - GOTY Edition", "Sekiro Shadows Die Twice GOTY Edition"),
            ("The Witcher 3", "Witcher 3"),
            ("Ori & the Blind Forest", "Ori and the Blind Forest"),
            ("Pokémon", "Pokemon"),
        ] {
            assert_eq!(key(a), key(b), "{a:?} vs {b:?}");
        }
    }

    #[test]
    fn display_drops_edition_labels() {
        for (raw, expected) in [
            ("Sekiro Shadows Die Twice GOTY Edition", "Sekiro Shadows Die Twice"),
            ("F1 22 Champions Edition", "F1 22"),
            ("Lies of P Deluxe Edition", "Lies of P"),
            ("Cyberpunk 2077 - Ultimate Edition", "Cyberpunk 2077"),
            ("Battlefield 2042 Digital Deluxe Edition", "Battlefield 2042"),
            ("The Witcher 3: Wild Hunt Game of the Year Edition", "The Witcher 3: Wild Hunt"),
            ("Disco Elysium - The Final Cut", "Disco Elysium - The Final Cut"),
            ("Dark Souls Remastered", "Dark Souls Remastered"),
            ("Deluxe Edition", "Deluxe Edition"),
            ("VALORANT", "VALORANT"),
        ] {
            assert_eq!(display(raw), expected, "display({raw:?})");
        }
    }
}
