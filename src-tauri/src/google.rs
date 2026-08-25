//! Client for the Google Cloud Translation API (v2, "Basic").
//!
//! v2 is the edition that authenticates with a plain API key. v3 wants an OAuth
//! service account and a project id, which is a lot of ceremony for a tray app
//! that translates a sentence at a time — so Lingo asks for a key, sends it as
//! the documented `key` query parameter, and never prints it anywhere a log
//! could pick it up.
//!
//! Compared with the translation memories Lingo used before, Google is a
//! well-behaved API: failures arrive as real HTTP status codes with a stable
//! JSON body, and field types do not shift under you. Two habits still have to
//! be absorbed here so the rest of the app never meets them:
//!
//! * **The reply is HTML-escaped even when you ask for plain text.** An
//!   apostrophe comes back as `&#39;`, an ampersand as `&amp;`. Every answer is
//!   unescaped before it leaves this module.
//! * **Line breaks are not reliably preserved.** A request may carry up to 128
//!   separate strings, so Lingo sends one per line and rejoins them, which
//!   keeps a pasted paragraph looking like a paragraph.
//!
//! Calls live in Rust rather than in the webview so the key stays out of
//! JavaScript entirely: it is read from disk, held in process memory, and sent
//! to Google. No webview ever sees it.

use std::fmt;

use serde::{Deserialize, Serialize};

const TRANSLATE_ENDPOINT: &str = "https://translation.googleapis.com/language/translate/v2";
const LANGUAGES_ENDPOINT: &str =
    "https://translation.googleapis.com/language/translate/v2/languages";

/// Longest text Lingo will send in one translation.
///
/// Google's own per-request ceiling is far higher, but this is a hotkey card
/// that translates as you type against a metered, billable API. Five thousand
/// characters is a long email and a cheap mistake; a novel pasted by accident
/// would be neither.
pub const MAX_TOTAL_CHARS: usize = 5_000;

/// Strings Google will accept in one request. Lingo sends one line per string
/// and falls back to sending the whole text as a single string past this.
const MAX_SEGMENTS: usize = 128;

// ---- Errors -----------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    /// No key, a rejected key, or a key that is not allowed to do this.
    Auth,
    /// The project is over its quota or its rate limit.
    Quota,
    Other,
}

#[derive(Debug, Clone)]
pub struct Error {
    pub kind: ErrorKind,
    pub message: String,
}

impl Error {
    fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    fn other(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Other, message)
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl From<Error> for String {
    fn from(e: Error) -> String {
        e.message
    }
}

// ---- Public shapes ----------------------------------------------------------

pub struct Request<'a> {
    pub text: &'a str,
    /// `None` lets Google detect it.
    pub source: Option<&'a str>,
    pub target: &'a str,
    pub api_key: &'a str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Translation {
    pub text: String,
    /// "" when the source language was pinned rather than detected.
    pub detected_source_language: String,
    /// What Google will bill for: the characters actually sent.
    pub characters: u64,
}

/// One row of Google's supported-language list.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Language {
    /// The code Google wants back, e.g. "de" or "zh-CN".
    pub code: String,
    pub name: String,
}

// ---- Wire types -------------------------------------------------------------

#[derive(Serialize)]
struct TranslatePayload<'a> {
    q: &'a [&'a str],
    target: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<&'a str>,
    /// Plain text, not HTML — Google must not try to preserve markup that is
    /// not there, and must not treat what looks like a tag as one.
    format: &'static str,
}

#[derive(Deserialize)]
struct TranslateReply {
    data: TranslateData,
}

#[derive(Deserialize)]
struct TranslateData {
    #[serde(default)]
    translations: Vec<TranslatedText>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranslatedText {
    #[serde(default)]
    translated_text: String,
    #[serde(default)]
    detected_source_language: String,
}

#[derive(Deserialize)]
struct LanguagesReply {
    data: LanguagesData,
}

#[derive(Deserialize)]
struct LanguagesData {
    #[serde(default)]
    languages: Vec<LanguageRow>,
}

#[derive(Deserialize)]
struct LanguageRow {
    language: String,
    #[serde(default)]
    name: String,
}

#[derive(Deserialize)]
struct ApiErrorReply {
    error: ApiErrorBody,
}

#[derive(Deserialize, Default)]
struct ApiErrorBody {
    #[serde(default)]
    message: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    errors: Vec<ApiErrorItem>,
}

#[derive(Deserialize, Default)]
struct ApiErrorItem {
    #[serde(default)]
    reason: String,
}

// ---- Requests ---------------------------------------------------------------

/// Translate one piece of text.
pub async fn translate(http: &reqwest::Client, req: Request<'_>) -> Result<Translation, Error> {
    let key = req.api_key.trim();
    if key.is_empty() {
        return Err(Error::new(
            ErrorKind::Auth,
            "Add your Google Cloud API key in Settings before translating.",
        ));
    }

    let target = req.target.trim();
    if target.is_empty() {
        return Err(Error::other("Pick a language to translate into."));
    }

    let text = req.text;
    let length = text.chars().count();
    if length == 0 {
        return Err(Error::other("There is nothing to translate."));
    }
    if length > MAX_TOTAL_CHARS {
        return Err(Error::other(format!(
            "That is {length} characters. Lingo translates up to {MAX_TOTAL_CHARS} at a time."
        )));
    }

    // Source and target being the same is a request Google will happily bill
    // for and answer with the input. Catch it here instead.
    let source = req.source.map(str::trim).filter(|s| !s.is_empty());
    if source.is_some_and(|s| s.eq_ignore_ascii_case(target)) {
        return Ok(Translation {
            text: text.to_owned(),
            detected_source_language: String::new(),
            characters: 0,
        });
    }

    let plan = Plan::of(text);
    let sending = plan.to_translate();
    if sending.is_empty() {
        return Err(Error::other("There is nothing to translate."));
    }
    let characters = sending.iter().map(|s| s.chars().count() as u64).sum();

    let payload = TranslatePayload {
        q: &sending,
        target,
        source,
        format: "text",
    };

    let response = http
        .post(TRANSLATE_ENDPOINT)
        .query(&[("key", key)])
        .json(&payload)
        .send()
        .await
        .map_err(transport_error)?;

    let reply: TranslateReply = read(response).await?;
    let translations = reply.data.translations;

    if translations.len() != sending.len() {
        return Err(Error::other(
            "Google returned a different number of translations than Lingo asked for.",
        ));
    }

    let detected = translations
        .iter()
        .map(|t| t.detected_source_language.trim())
        .find(|d| !d.is_empty())
        .unwrap_or_default()
        .to_owned();

    let pieces: Vec<String> = translations
        .into_iter()
        .map(|t| unescape(&t.translated_text))
        .collect();

    Ok(Translation {
        text: plan.rejoin(&pieces),
        detected_source_language: detected,
        characters,
    })
}

/// Everything Google will translate, named in English.
///
/// The languages endpoint is not billed, which makes it the right thing to
/// probe a key with: it proves the key is valid, that the Cloud Translation API
/// is enabled on its project, and that billing is in order — without spending a
/// single character.
pub async fn languages(http: &reqwest::Client, api_key: &str) -> Result<Vec<Language>, Error> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err(Error::new(
            ErrorKind::Auth,
            "Add your Google Cloud API key in Settings first.",
        ));
    }

    let response = http
        .get(LANGUAGES_ENDPOINT)
        .query(&[("key", key), ("target", "en"), ("model", "nmt")])
        .send()
        .await
        .map_err(transport_error)?;

    let reply: LanguagesReply = read(response).await?;

    let mut list: Vec<Language> = reply
        .data
        .languages
        .into_iter()
        .filter(|row| !row.language.trim().is_empty())
        .map(|row| {
            let code = row.language.trim().to_owned();
            // `target=en` should mean every row carries a name, but a code on
            // its own still beats dropping the language.
            let name = match row.name.trim() {
                "" => code.clone(),
                named => named.to_owned(),
            };
            Language { code, name }
        })
        .collect();

    if list.is_empty() {
        return Err(Error::other("Google listed no languages."));
    }

    list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(list)
}

/// Read a reply, turning anything that is not a success into a sentence worth
/// showing the user.
async fn read<T: for<'de> Deserialize<'de>>(response: reqwest::Response) -> Result<T, Error> {
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| Error::other(format!("Google's reply could not be read: {e}")))?;

    if !status.is_success() {
        return Err(api_error(status.as_u16(), &body));
    }

    serde_json::from_str(&body)
        .map_err(|e| Error::other(format!("Google's reply was not in the expected shape: {e}")))
}

fn transport_error(e: reqwest::Error) -> Error {
    if e.is_timeout() {
        Error::other("Google did not answer in time. Try again.")
    } else if e.is_connect() {
        Error::other("Lingo could not reach Google. Check your connection.")
    } else {
        Error::other(format!("The request to Google failed: {e}"))
    }
}

/// Turn a failed HTTP status and its body into an error the user can act on.
///
/// Google's own messages are accurate but written for whoever set the project
/// up ("API key not valid. Please pass a valid API key."), so the common causes
/// get a sentence that says what to do about it, with Google's wording kept for
/// anything unrecognised.
fn api_error(status: u16, body: &str) -> Error {
    let parsed: ApiErrorBody = serde_json::from_str::<ApiErrorReply>(body)
        .map(|r| r.error)
        .unwrap_or_default();

    let reason = parsed
        .errors
        .first()
        .map(|e| e.reason.as_str())
        .unwrap_or_default();
    let google = parsed.message.trim();

    match (status, reason, parsed.status.as_str()) {
        (_, "keyInvalid", _) => Error::new(
            ErrorKind::Auth,
            "Google rejected that API key. Check it was copied whole, with no spaces.",
        ),
        (_, "accessNotConfigured", _) => Error::new(
            ErrorKind::Auth,
            "The Cloud Translation API is not enabled on that key's project. \
             Enable it in the Google Cloud console, then try again.",
        ),
        (_, "keyExpired", _) => Error::new(ErrorKind::Auth, "That API key has expired."),
        (_, "ipRefererBlocked", _) | (_, "forbidden", _) => Error::new(
            ErrorKind::Auth,
            "That key is restricted and will not accept this request. A key used by a \
             desktop app needs no application restriction, and must allow the Cloud \
             Translation API.",
        ),
        (_, "dailyLimitExceeded", _)
        | (_, "userRateLimitExceeded", _)
        | (_, "rateLimitExceeded", _)
        | (429, _, _)
        | (_, _, "RESOURCE_EXHAUSTED") => Error::new(
            ErrorKind::Quota,
            "That project is over its Cloud Translation quota. Check the quota and \
             billing pages in the Google Cloud console.",
        ),
        (401, _, _) | (_, _, "UNAUTHENTICATED") => {
            Error::new(ErrorKind::Auth, "Google would not accept that API key.")
        }
        (403, _, _) | (_, _, "PERMISSION_DENIED") => Error::new(
            ErrorKind::Auth,
            if google.is_empty() {
                "Google refused the request. The key may be restricted, or billing may \
                 not be enabled on its project."
                    .to_owned()
            } else {
                format!("Google refused the request: {google}")
            },
        ),
        (400, _, _) if google.to_lowercase().contains("api key not valid") => Error::new(
            ErrorKind::Auth,
            "Google rejected that API key. Check it was copied whole, with no spaces.",
        ),
        (400, _, _) if google.to_lowercase().contains("invalid value") => {
            Error::other("Google does not translate that language pair.")
        }
        _ if !google.is_empty() => Error::other(format!("Google said: {google}")),
        _ => Error::other(format!("Google answered with HTTP {status}.")),
    }
}

// ---- Line-preserving segmentation -------------------------------------------

/// The text, cut into the lines that get translated and the ones that do not.
///
/// Blank lines carry no words but they carry the shape of the text, and a
/// translation that arrives as one run-on block is a worse answer than the same
/// words with the paragraph breaks left where they were.
struct Plan<'a> {
    lines: Vec<Line<'a>>,
}

enum Line<'a> {
    /// Whitespace only: reproduced exactly, never sent, never billed.
    Blank(&'a str),
    Words(&'a str),
}

impl<'a> Plan<'a> {
    fn of(text: &'a str) -> Self {
        let lines: Vec<Line<'a>> = text
            .split('\n')
            .map(|line| {
                if line.trim().is_empty() {
                    Line::Blank(line)
                } else {
                    Line::Words(line)
                }
            })
            .collect();

        // Past Google's ceiling on strings per request the text goes over
        // whole, which puts Google's own line handling in charge. That is not
        // as tidy — but it is one request rather than a refusal.
        let words = lines.iter().filter(|l| matches!(l, Line::Words(_))).count();
        if words > MAX_SEGMENTS {
            return Self {
                lines: vec![Line::Words(text)],
            };
        }

        Self { lines }
    }

    fn to_translate(&self) -> Vec<&'a str> {
        self.lines
            .iter()
            .filter_map(|l| match l {
                Line::Words(s) => Some(*s),
                Line::Blank(_) => None,
            })
            .collect()
    }

    /// Put the translated lines back where their originals were.
    fn rejoin(&self, translated: &[String]) -> String {
        let mut next = translated.iter();
        let mut out = String::new();
        for (i, line) in self.lines.iter().enumerate() {
            if i > 0 {
                out.push('\n');
            }
            match line {
                Line::Blank(original) => out.push_str(original),
                Line::Words(original) => {
                    out.push_str(next.next().map(String::as_str).unwrap_or(original))
                }
            }
        }
        out
    }
}

// ---- HTML entities ----------------------------------------------------------

/// Undo the escaping Google applies to its answers.
///
/// It escapes regardless of `format`, so `format: "text"` still comes back with
/// `&#39;` where the apostrophe should be. Anything that is not a recognisable
/// entity is left exactly as it arrived — a bare `&` in the source text has to
/// survive the round trip unchanged.
fn unescape(input: &str) -> String {
    if !input.contains('&') {
        return input.to_owned();
    }

    let mut out = String::with_capacity(input.len());
    let mut rest = input;

    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let tail = &rest[amp..];

        // A real entity is short; a `;` further away belongs to something else.
        match tail[1..].find(';').filter(|end| *end <= 10) {
            Some(end) => match decode_entity(&tail[1..=end]) {
                Some(c) => {
                    out.push(c);
                    rest = &tail[end + 2..];
                }
                None => {
                    out.push('&');
                    rest = &tail[1..];
                }
            },
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }

    out.push_str(rest);
    out
}

fn decode_entity(body: &str) -> Option<char> {
    match body {
        "amp" => return Some('&'),
        "lt" => return Some('<'),
        "gt" => return Some('>'),
        "quot" => return Some('"'),
        "apos" => return Some('\''),
        "nbsp" => return Some('\u{a0}'),
        _ => {}
    }

    let digits = body.strip_prefix('#')?;
    let value = match digits.strip_prefix(['x', 'X']) {
        Some(hex) => u32::from_str_radix(hex, 16).ok()?,
        None => digits.parse::<u32>().ok()?,
    };
    char::from_u32(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn google_escapes_its_answers_even_as_plain_text() {
        assert_eq!(unescape("l&#39;h&#xF4;tel"), "l'hôtel");
        assert_eq!(unescape("Tom &amp; Jerry"), "Tom & Jerry");
        assert_eq!(unescape("&quot;so&quot;"), "\"so\"");
        assert_eq!(unescape("a &lt;b&gt; c"), "a <b> c");
    }

    #[test]
    fn text_with_no_entities_is_untouched() {
        assert_eq!(unescape("nothing to do here"), "nothing to do here");
        // A bare ampersand is not an entity and must survive as one.
        assert_eq!(unescape("Fish & chips"), "Fish & chips");
        assert_eq!(unescape("R&D; later"), "R&D; later");
        // A `;` too far away to belong to the `&`.
        assert_eq!(
            unescape("&this is a long stretch; really"),
            "&this is a long stretch; really"
        );
    }

    #[test]
    fn blank_lines_are_kept_and_never_sent() {
        let plan = Plan::of("Hello\n\nWorld");
        assert_eq!(plan.to_translate(), vec!["Hello", "World"]);
        assert_eq!(
            plan.rejoin(&["Hallo".into(), "Welt".into()]),
            "Hallo\n\nWelt"
        );
    }

    #[test]
    fn indentation_on_a_blank_line_is_reproduced_exactly() {
        let plan = Plan::of("one\n   \ntwo");
        assert_eq!(plan.to_translate(), vec!["one", "two"]);
        assert_eq!(
            plan.rejoin(&["eins".into(), "zwei".into()]),
            "eins\n   \nzwei"
        );
    }

    #[test]
    fn a_single_line_stays_a_single_request() {
        let plan = Plan::of("just the one");
        assert_eq!(plan.to_translate().len(), 1);
        assert_eq!(plan.rejoin(&["nur eine".into()]), "nur eine");
    }

    #[test]
    fn too_many_lines_go_over_whole() {
        let text = "x\n".repeat(MAX_SEGMENTS + 1);
        let plan = Plan::of(&text);
        assert_eq!(plan.to_translate(), vec![text.as_str()]);
    }

    #[test]
    fn a_rejected_key_is_an_auth_error_not_a_mystery() {
        let body = r#"{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","errors":[{"message":"API key not valid.","domain":"global","reason":"badRequest"}],"status":"INVALID_ARGUMENT"}}"#;
        let e = api_error(400, body);
        assert_eq!(e.kind, ErrorKind::Auth);
        assert!(e.message.contains("copied whole"), "{}", e.message);
    }

    #[test]
    fn a_project_without_the_api_enabled_says_so() {
        let body = r#"{"error":{"code":403,"message":"Cloud Translation API has not been used in project 1 before or it is disabled.","errors":[{"message":"x","domain":"usageLimits","reason":"accessNotConfigured"}],"status":"PERMISSION_DENIED"}}"#;
        let e = api_error(403, body);
        assert_eq!(e.kind, ErrorKind::Auth);
        assert!(e.message.contains("not enabled"), "{}", e.message);
    }

    #[test]
    fn running_out_of_quota_is_its_own_kind() {
        let body = r#"{"error":{"code":429,"message":"Quota exceeded","errors":[{"reason":"rateLimitExceeded"}],"status":"RESOURCE_EXHAUSTED"}}"#;
        assert_eq!(api_error(429, body).kind, ErrorKind::Quota);
    }

    #[test]
    fn an_unrecognised_failure_still_carries_googles_words() {
        let body = r#"{"error":{"code":500,"message":"Internal error encountered.","status":"INTERNAL"}}"#;
        let e = api_error(500, body);
        assert_eq!(e.kind, ErrorKind::Other);
        assert!(e.message.contains("Internal error"), "{}", e.message);
    }

    #[test]
    fn a_body_that_is_not_json_does_not_panic() {
        let e = api_error(502, "<html>Bad Gateway</html>");
        assert_eq!(e.kind, ErrorKind::Other);
        assert!(e.message.contains("502"), "{}", e.message);
    }
}
