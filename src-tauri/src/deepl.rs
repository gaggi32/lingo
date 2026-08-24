//! Thin client for the DeepL v2 REST API.
//!
//! Every call lives here (rather than in the webview) for three reasons: the
//! API key never has to be handed to JavaScript, DeepL sends no CORS headers so
//! a browser fetch would be blocked anyway, and error codes can be translated
//! into sentences a person can act on before they reach the UI.

use serde::{Deserialize, Serialize};

/// Free and Pro keys are served by different hosts. A Free key always carries
/// the `:fx` suffix, which is the only way to tell them apart offline.
const FREE_BASE: &str = "https://api-free.deepl.com/v2";
const PRO_BASE: &str = "https://api.deepl.com/v2";

pub fn base_url(key: &str) -> &'static str {
    if key.trim().ends_with(":fx") {
        FREE_BASE
    } else {
        PRO_BASE
    }
}

/// True for a Free-tier key. The UI labels the usage meter with this.
pub fn is_free_key(key: &str) -> bool {
    key.trim().ends_with(":fx")
}

// ---- Wire types -------------------------------------------------------------

#[derive(Serialize)]
struct TranslateBody<'a> {
    text: [&'a str; 1],
    target_lang: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_lang: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    formality: Option<&'a str>,
}

#[derive(Deserialize)]
struct TranslateResponse {
    translations: Vec<Translation>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct Translation {
    /// Two-letter code DeepL believes the input was written in. Present even
    /// when `source_lang` was supplied explicitly.
    pub detected_source_language: String,
    pub text: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct Usage {
    pub character_count: u64,
    /// Pro keys without a hard cap report a very large number here.
    pub character_limit: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct Language {
    /// Code to send back as `source_lang` / `target_lang`, e.g. "EN-GB".
    pub language: String,
    pub name: String,
    /// Only meaningful for target languages; absent from the source list.
    #[serde(default)]
    pub supports_formality: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Languages {
    pub source: Vec<Language>,
    pub target: Vec<Language>,
}

// ---- Errors -----------------------------------------------------------------

/// Turn an HTTP failure into something worth showing a user. DeepL documents a
/// handful of non-obvious codes (456 for quota, 429 for rate limiting) that
/// would otherwise surface as a bare number.
fn explain(status: u16, body: &str) -> String {
    let detail = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| {
            v.get("message")
                .and_then(|m| m.as_str())
                .map(|s| s.trim().to_owned())
        })
        .filter(|s| !s.is_empty());

    match status {
        401 | 403 => "DeepL rejected this API key. Check it under Settings.".into(),
        404 => "DeepL endpoint not found — the key may be for a different plan.".into(),
        413 | 414 => "That text is too long for a single DeepL request.".into(),
        429 => "DeepL is rate-limiting this key. Give it a moment.".into(),
        456 => "This key has spent its whole character quota for the period.".into(),
        500..=599 => format!("DeepL is unavailable right now (HTTP {status})."),
        _ => match detail {
            Some(m) => format!("DeepL error {status}: {m}"),
            None => format!("DeepL error {status}."),
        },
    }
}

async fn ok_or_explain(res: reqwest::Response) -> Result<reqwest::Response, String> {
    if res.status().is_success() {
        return Ok(res);
    }
    let status = res.status().as_u16();
    let body = res.text().await.unwrap_or_default();
    Err(explain(status, &body))
}

/// Network-level failures (no DNS, no route, TLS refused) read as noise unless
/// they are named for what they are.
fn transport(err: reqwest::Error) -> String {
    if err.is_timeout() {
        "DeepL did not answer in time.".into()
    } else if err.is_connect() {
        "Could not reach DeepL — check the network connection.".into()
    } else {
        format!("Request to DeepL failed: {err}")
    }
}

// ---- Calls ------------------------------------------------------------------

fn auth(key: &str) -> String {
    format!("DeepL-Auth-Key {}", key.trim())
}

async fn post_translate(
    http: &reqwest::Client,
    key: &str,
    text: &str,
    source_lang: Option<&str>,
    target_lang: &str,
    formality: Option<&str>,
) -> Result<Translation, String> {
    let body = TranslateBody {
        text: [text],
        target_lang,
        source_lang,
        formality,
    };

    let res = http
        .post(format!("{}/translate", base_url(key)))
        .header("Authorization", auth(key))
        .json(&body)
        .send()
        .await
        .map_err(transport)?;

    let parsed: TranslateResponse = ok_or_explain(res)
        .await?
        .json()
        .await
        .map_err(|e| format!("Could not read DeepL's reply: {e}"))?;

    parsed
        .translations
        .into_iter()
        .next()
        .ok_or_else(|| "DeepL returned no translation.".to_string())
}

pub async fn translate(
    http: &reqwest::Client,
    key: &str,
    text: &str,
    source_lang: Option<&str>,
    target_lang: &str,
    formality: Option<&str>,
) -> Result<Translation, String> {
    // `formality` is only accepted for some target languages, and DeepL answers
    // with a 400 rather than ignoring it. Ask for the preference, and quietly
    // fall back to neutral when the language pair cannot honour it.
    let wanted = formality.filter(|f| !f.is_empty() && *f != "default");

    match post_translate(http, key, text, source_lang, target_lang, wanted).await {
        Err(e) if wanted.is_some() && e.to_lowercase().contains("formality") => {
            post_translate(http, key, text, source_lang, target_lang, None).await
        }
        other => other,
    }
}

pub async fn usage(http: &reqwest::Client, key: &str) -> Result<Usage, String> {
    let res = http
        .get(format!("{}/usage", base_url(key)))
        .header("Authorization", auth(key))
        .send()
        .await
        .map_err(transport)?;

    ok_or_explain(res)
        .await?
        .json()
        .await
        .map_err(|e| format!("Could not read DeepL's usage reply: {e}"))
}

async fn language_list(
    http: &reqwest::Client,
    key: &str,
    kind: &str,
) -> Result<Vec<Language>, String> {
    let res = http
        .get(format!("{}/languages", base_url(key)))
        .query(&[("type", kind)])
        .header("Authorization", auth(key))
        .send()
        .await
        .map_err(transport)?;

    ok_or_explain(res)
        .await?
        .json()
        .await
        .map_err(|e| format!("Could not read DeepL's language list: {e}"))
}

pub async fn languages(http: &reqwest::Client, key: &str) -> Result<Languages, String> {
    // Sequential rather than joined: two requests, and a shared key that is
    // rate-limited per account. There is nothing to win by racing them.
    let source = language_list(http, key, "source").await?;
    let target = language_list(http, key, "target").await?;
    Ok(Languages { source, target })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_keys_route_to_the_free_host() {
        let free = "12345678-1234-1234-1234-123456789abc:fx";
        assert!(is_free_key(free));
        assert_eq!(base_url(free), FREE_BASE);
        // Keys are pasted, so they arrive with whatever whitespace came along.
        assert_eq!(base_url("  key:fx \n"), FREE_BASE);
    }

    #[test]
    fn everything_else_routes_to_pro() {
        let pro = "12345678-1234-1234-1234-123456789abc";
        assert!(!is_free_key(pro));
        assert_eq!(base_url(pro), PRO_BASE);
    }

    #[test]
    fn documented_status_codes_become_sentences() {
        // 456 is DeepL-specific and means nothing to anyone who has not read
        // the docs, which is the whole reason this mapping exists.
        assert!(explain(456, "").contains("quota"));
        assert!(explain(403, "").contains("API key"));
        assert!(explain(429, "").contains("rate-limiting"));
        assert!(explain(503, "").contains("unavailable"));
    }

    #[test]
    fn unmapped_errors_surface_deepls_own_message() {
        let body = r#"{"message":"Value for 'target_lang' not supported."}"#;
        let out = explain(400, body);
        assert!(out.contains("target_lang"), "{out}");

        // A body that is not JSON must not swallow the status code.
        assert!(explain(400, "<html>").contains("400"));
    }

    #[test]
    fn translation_reads_deepls_wire_format() {
        let body = r#"{"translations":[
            {"detected_source_language":"EN","text":"Guten Morgen"}
        ]}"#;
        let parsed: TranslateResponse = serde_json::from_str(body).unwrap();
        let one = &parsed.translations[0];
        assert_eq!(one.detected_source_language, "EN");
        assert_eq!(one.text, "Guten Morgen");

        // ...and hands the webview camelCase.
        let out = serde_json::to_string(one).unwrap();
        assert!(out.contains("detectedSourceLanguage"), "{out}");
    }

    #[test]
    fn usage_reads_and_re_serialises() {
        let u: Usage =
            serde_json::from_str(r#"{"character_count":1000,"character_limit":500000}"#).unwrap();
        assert_eq!(u.character_count, 1000);
        let out = serde_json::to_string(&u).unwrap();
        assert!(out.contains("characterCount"), "{out}");
    }

    #[test]
    fn source_languages_have_no_formality_field() {
        // /v2/languages?type=source omits supports_formality entirely; the
        // target list includes it. Both must deserialise.
        let src: Language =
            serde_json::from_str(r#"{"language":"EN","name":"English"}"#).unwrap();
        assert!(!src.supports_formality);

        let tgt: Language = serde_json::from_str(
            r#"{"language":"DE","name":"German","supports_formality":true}"#,
        )
        .unwrap();
        assert!(tgt.supports_formality);
    }
}
