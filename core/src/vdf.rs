//! Parser for Valve's text KeyValues format, used by `libraryfolders.vdf`, `appmanifest_*.acf` and `localconfig.vdf`.

use std::fmt;

/// A KeyValues node: either a string value or a list of children. Lookups ignore case.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct VdfNode {
    pub value: Option<String>,
    pub children: Vec<(String, VdfNode)>,
}

impl VdfNode {
    pub fn get(&self, key: &str) -> Option<&VdfNode> {
        self.children.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v)
    }

    /// Walks a path of keys: `node.path(&["Software", "Valve", "Steam"])`.
    pub fn path(&self, keys: &[&str]) -> Option<&VdfNode> {
        keys.iter().try_fold(self, |node, k| node.get(k))
    }

    pub fn str(&self, key: &str) -> Option<&str> {
        self.get(key)?.value.as_deref()
    }

    pub fn long(&self, key: &str) -> Option<i64> {
        self.str(key)?.trim().parse().ok()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VdfError(pub String);

impl fmt::Display for VdfError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for VdfError {}

pub fn parse(text: &str) -> Result<VdfNode, VdfError> {
    let chars: Vec<char> = text.chars().collect();
    let mut pos = 0;
    let mut root = VdfNode::default();
    parse_children(&chars, &mut pos, &mut root, true)?;
    Ok(root)
}

/// Reads and parses a file (invalid UTF-8 is replaced, not fatal).
pub fn parse_file(path: impl AsRef<std::path::Path>) -> Result<VdfNode, Box<dyn std::error::Error + Send + Sync>> {
    let bytes = std::fs::read(path)?;
    Ok(parse(&String::from_utf8_lossy(&bytes))?)
}

enum Token {
    Str(String),
    Open,
    Close,
    End,
}

fn parse_children(s: &[char], pos: &mut usize, parent: &mut VdfNode, top_level: bool) -> Result<(), VdfError> {
    loop {
        let key = match next_token(s, pos) {
            Token::End if top_level => return Ok(()),
            Token::End => return Err(VdfError("Unexpected end of VDF: missing '}'".into())),
            Token::Close if top_level => return Err(VdfError(format!("Unexpected '}}' at {pos}"))),
            Token::Close => return Ok(()),
            Token::Open => return Err(VdfError(format!("Unexpected '{{' at {pos}"))),
            Token::Str(k) => k,
        };
        match next_token(s, pos) {
            Token::Str(v) => {
                parent.children.push((key, VdfNode { value: Some(v), children: Vec::new() }));
                skip_conditional(s, pos); // e.g. "flag" "1" [$WIN32]
            }
            Token::Open => {
                let mut child = VdfNode::default();
                parse_children(s, pos, &mut child, false)?;
                parent.children.push((key, child));
            }
            _ => return Err(VdfError(format!("Key '{key}' has no value"))),
        }
    }
}

fn next_token(s: &[char], pos: &mut usize) -> Token {
    skip_whitespace_and_comments(s, pos);
    let Some(&c) = s.get(*pos) else { return Token::End };
    match c {
        '{' => {
            *pos += 1;
            Token::Open
        }
        '}' => {
            *pos += 1;
            Token::Close
        }
        '"' => {
            *pos += 1;
            let mut out = String::new();
            while *pos < s.len() && s[*pos] != '"' {
                if s[*pos] == '\\' && *pos + 1 < s.len() {
                    *pos += 1;
                    out.push(match s[*pos] {
                        'n' => '\n',
                        't' => '\t',
                        'r' => '\r',
                        other => other,
                    });
                } else {
                    out.push(s[*pos]);
                }
                *pos += 1;
            }
            *pos += 1; // closing quote (or end)
            Token::Str(out)
        }
        _ => {
            let start = *pos;
            while *pos < s.len() && !s[*pos].is_whitespace() && !matches!(s[*pos], '{' | '}' | '"') {
                *pos += 1;
            }
            Token::Str(s[start..*pos].iter().collect())
        }
    }
}

fn skip_conditional(s: &[char], pos: &mut usize) {
    let mut p = *pos;
    while p < s.len() && matches!(s[p], ' ' | '\t') {
        p += 1;
    }
    if s.get(p) == Some(&'[') {
        if let Some(end) = s[p..].iter().position(|&c| c == ']') {
            *pos = p + end + 1;
        }
    }
}

fn skip_whitespace_and_comments(s: &[char], pos: &mut usize) {
    while *pos < s.len() {
        let c = s[*pos];
        if c.is_whitespace() || c == '\u{feff}' {
            *pos += 1;
        } else if (c == '/' && s.get(*pos + 1) == Some(&'/')) || c == '#' {
            // Comments, and #include / #base directives (not used by the files Shelf reads): skip the line.
            while *pos < s.len() && s[*pos] != '\n' {
                *pos += 1;
            }
        } else {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nested_keys_case_insensitively() {
        let root = parse(
            r#""AppState"
            {
                "appid"     "620"
                "name"      "Portal 2"
                "UserConfig" { "language" "english" }
            }"#,
        )
        .unwrap();
        let state = root.get("appstate").unwrap();
        assert_eq!(state.str("APPID"), Some("620"));
        assert_eq!(state.str("name"), Some("Portal 2"));
        assert_eq!(state.path(&["UserConfig", "language"]).unwrap().value.as_deref(), Some("english"));
        assert_eq!(state.long("appid"), Some(620));
    }

    #[test]
    fn handles_escapes_comments_and_conditionals() {
        let root = parse(
            r#"// comment line
            "libraryfolders"
            {
                "0"   // trailing comment
                {
                    "path"  "D:\\SteamLibrary"
                    "label" "say \"hi\""
                    "flag"  "1" [$WIN32]
                }
            }"#,
        )
        .unwrap();
        let lib = root.path(&["libraryfolders", "0"]).unwrap();
        assert_eq!(lib.str("path"), Some(r"D:\SteamLibrary"));
        assert_eq!(lib.str("label"), Some("say \"hi\""));
        assert_eq!(lib.str("flag"), Some("1"));
    }

    #[test]
    fn unquoted_tokens_and_empty_blocks() {
        let root = parse("Root { key value\n InstalledDepots { } }").unwrap();
        assert_eq!(root.path(&["Root", "key"]).unwrap().value.as_deref(), Some("value"));
        assert!(root.path(&["Root", "InstalledDepots"]).unwrap().children.is_empty());
    }

    #[test]
    fn missing_close_brace_is_an_error() {
        assert!(parse(r#""a" { "b" "c""#).is_err());
    }
}
