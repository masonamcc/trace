use base64::Engine;
use hmac::{Hmac, Mac};
use sha1::Sha1;
use std::collections::HashSet;
use std::sync::atomic::Ordering;

use crate::{db, AppState};

type HmacSha1 = Hmac<Sha1>;

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_events(date: String, state: tauri::State<AppState>) -> Vec<db::Event> {
    let conn = state.db.lock().unwrap();
    db::get_events_for_date(&conn, &date).unwrap_or_default()
}

#[tauri::command]
pub fn clear_recent(minutes: i64, state: tauri::State<AppState>) -> Result<usize, String> {
    let conn = state.db.lock().unwrap();
    db::delete_recent(&conn, minutes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_older_than(minutes: i64, state: tauri::State<AppState>) -> Result<usize, String> {
    let conn = state.db.lock().unwrap();
    db::delete_older_than(&conn, minutes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_exclusions(patterns: Vec<String>, state: tauri::State<AppState>) {
    let normalized: HashSet<String> = patterns
        .into_iter()
        .map(|p| p.to_lowercase().trim_start_matches("www.").to_string())
        .collect();
    *state.exclusions.write().unwrap() = normalized;
}

#[tauri::command]
pub fn set_tracking_paused(paused: bool, state: tauri::State<AppState>) {
    state.paused.store(paused, Ordering::SeqCst);
}

#[tauri::command]
pub fn set_tracking_schedule(
    start: Option<String>,
    end: Option<String>,
    state: tauri::State<AppState>,
) {
    let parsed = match (start.as_deref(), end.as_deref()) {
        (Some(s), Some(e)) => crate::parse_hhmm(s).zip(crate::parse_hhmm(e)),
        _ => None,
    };
    *state.schedule.write().unwrap() = parsed;
}

#[tauri::command]
pub async fn get_daily_summary(
    date: String,
    api_key: String,
    style: String,
    provider: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let events = {
        let conn = state.db.lock().unwrap();
        db::get_events_for_date(&conn, &date).unwrap_or_default()
    };
    if events.is_empty() {
        return Ok(vec!["No activity recorded for this date.".to_string()]);
    }
    let prompt = build_prompt(&events, &date, &style);
    match provider.as_str() {
        "openai"  => call_openai_compat(&prompt, &api_key, "https://api.openai.com/v1", "gpt-4o").await,
        "gemini"  => call_gemini(&prompt, &api_key).await,
        "grok"    => call_openai_compat(&prompt, &api_key, "https://api.x.ai/v1", "grok-2-1212").await,
        "mistral" => call_openai_compat(&prompt, &api_key, "https://api.mistral.ai/v1", "mistral-small-latest").await,
        _         => call_anthropic(&prompt, &api_key).await,
    }
}

#[tauri::command]
pub async fn get_thread_posts(
    date: String,
    api_key: String,
    style: String,
    provider: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let events = {
        let conn = state.db.lock().unwrap();
        db::get_events_for_date(&conn, &date).unwrap_or_default()
    };
    if events.is_empty() {
        return Ok(vec!["No activity recorded for this date.".to_string()]);
    }
    let prompt = build_thread_prompt(&events, &date, &style);
    match provider.as_str() {
        "openai"  => call_openai_compat(&prompt, &api_key, "https://api.openai.com/v1", "gpt-4o").await,
        "gemini"  => call_gemini(&prompt, &api_key).await,
        "grok"    => call_openai_compat(&prompt, &api_key, "https://api.x.ai/v1", "grok-2-1212").await,
        "mistral" => call_openai_compat(&prompt, &api_key, "https://api.mistral.ai/v1", "mistral-small-latest").await,
        _         => call_anthropic(&prompt, &api_key).await,
    }
}

#[tauri::command]
pub async fn post_to_x(
    text: String,
    consumer_key: String,
    consumer_secret: String,
    access_token: String,
    access_token_secret: String,
    community_id: Option<String>,
) -> Result<String, String> {
    let ck  = consumer_key.trim().to_string();
    let cs  = consumer_secret.trim().to_string();
    let at  = access_token.trim().to_string();
    let ats = access_token_secret.trim().to_string();

    let mut body = serde_json::json!({ "text": text });
    if let Some(cid) = community_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        body["community_id"] = serde_json::json!(cid);
    }
    send_tweet(&body, &ck, &cs, &at, &ats).await
}

#[tauri::command]
pub async fn post_thread_to_x(
    texts: Vec<String>,
    consumer_key: String,
    consumer_secret: String,
    access_token: String,
    access_token_secret: String,
    community_id: Option<String>,
) -> Result<(), String> {
    let ck  = consumer_key.trim().to_string();
    let cs  = consumer_secret.trim().to_string();
    let at  = access_token.trim().to_string();
    let ats = access_token_secret.trim().to_string();
    let cid = community_id.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);

    let mut reply_to: Option<String> = None;
    for (index, text) in texts.iter().enumerate() {
        let mut body = serde_json::json!({ "text": text });
        if index == 0 {
            if let Some(ref community) = cid {
                body["community_id"] = serde_json::json!(community);
            }
        }
        if let Some(ref parent_id) = reply_to {
            body["reply"] = serde_json::json!({ "in_reply_to_tweet_id": parent_id });
        }
        let tweet_id = send_tweet(&body, &ck, &cs, &at, &ats).await?;
        reply_to = Some(tweet_id);
    }
    Ok(())
}

// ── X / OAuth helpers ─────────────────────────────────────────────────────────

fn percent_encode(s: &str) -> String {
    let mut out = String::new();
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            b => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn oauth_sign(method: &str, url: &str, params: &[(&str, &str)], consumer_secret: &str, token_secret: &str) -> String {
    let mut sorted = params.to_vec();
    sorted.sort_by_key(|(k, _)| *k);
    let param_string = sorted.iter()
        .map(|(k, v)| format!("{}={}", percent_encode(k), percent_encode(v)))
        .collect::<Vec<_>>()
        .join("&");
    let base = format!("{}&{}&{}", percent_encode(method), percent_encode(url), percent_encode(&param_string));
    let key = format!("{}&{}", percent_encode(consumer_secret), percent_encode(token_secret));
    let mut mac = HmacSha1::new_from_slice(key.as_bytes()).expect("HMAC accepts any key length");
    mac.update(base.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes())
}

async fn send_tweet(
    body: &serde_json::Value,
    consumer_key: &str,
    consumer_secret: &str,
    access_token: &str,
    access_token_secret: &str,
) -> Result<String, String> {
    use rand::Rng;
    let url = "https://api.x.com/2/tweets";
    let nonce: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        .to_string();

    let params = [
        ("oauth_consumer_key",     consumer_key),
        ("oauth_nonce",            nonce.as_str()),
        ("oauth_signature_method", "HMAC-SHA1"),
        ("oauth_timestamp",        timestamp.as_str()),
        ("oauth_token",            access_token),
        ("oauth_version",          "1.0"),
    ];
    let sig = oauth_sign("POST", url, &params, consumer_secret, access_token_secret);
    let auth = format!(
        "OAuth oauth_consumer_key=\"{}\",oauth_nonce=\"{}\",oauth_signature=\"{}\",oauth_signature_method=\"HMAC-SHA1\",oauth_timestamp=\"{}\",oauth_token=\"{}\",oauth_version=\"1.0\"",
        percent_encode(consumer_key), percent_encode(&nonce),
        percent_encode(&sig), &timestamp, percent_encode(access_token),
    );

    let resp = reqwest::Client::new()
        .post(url)
        .header("Authorization", auth)
        .json(body)
        .send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let err = resp.text().await.unwrap_or_default();
        return Err(format!("X API error: {}", err));
    }
    let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data["data"]["id"].as_str().unwrap_or("").to_string())
}

// ── Prompt builders ───────────────────────────────────────────────────────────

fn format_events(events: &[db::Event]) -> String {
    events.iter().map(|event| {
        let time = event.timestamp.get(11..16).unwrap_or("??:??");
        match event.source.as_str() {
            "chrome" => format!("[{}] Browser: {} | {}", time,
                event.page_title.as_deref().unwrap_or("Unknown page"),
                event.url.as_deref().unwrap_or("")),
            _ => format!("[{}] App: {} | {}", time,
                event.app.as_deref().unwrap_or("Unknown"),
                event.window_title.as_deref().unwrap_or("")),
        }
    }).collect::<Vec<_>>().join("\n")
}

fn build_prompt(events: &[db::Event], date: &str, style: &str) -> String {
    let events_text = format_events(events);
    let style_instruction = if style.trim().is_empty() { String::new() }
    else { format!("\n\nAdditional style instructions: {}", style.trim()) };

    format!(
        "Here is a computer activity log for {}:\n\n{}\n\n\
        Write exactly 3 short summaries of this person's day. \
        Each must be 1-3 sentences — punchy and social-media-post sized, like a tweet. \
        Cover different angles: e.g. what was built, what was researched, how the day flowed overall. \
        Write in first person. Do NOT use relative time-of-day phrases like \"this morning\", \
        \"this afternoon\", or \"tonight\".{}\n\n\
        Return ONLY a JSON array of exactly 3 strings, no markdown, no extra text:\n\
        [\"summary one\", \"summary two\", \"summary three\"]",
        date, events_text, style_instruction
    )
}

fn build_thread_prompt(events: &[db::Event], date: &str, style: &str) -> String {
    let events_text = format_events(events);
    let style_instruction = if style.trim().is_empty() { String::new() }
    else { format!("\n\nAdditional style instructions: {}", style.trim()) };

    format!(
        "Here is a computer activity log for {}:\n\n{}\n\n\
        Write a Twitter/X thread of 3-5 posts about this person's day. \
        Each post must be under 280 characters. \
        Be specific and detailed — name the actual apps, files, topics, problems solved, \
        or things built. Each post should cover a distinct task or area of work. \
        Write in first person. Do NOT use relative time-of-day phrases like \"this morning\", \
        \"this afternoon\", or \"tonight\".{}\n\n\
        Return ONLY a JSON array of strings (one per thread post), no markdown, no extra text.",
        date, events_text, style_instruction
    )
}

// ── AI provider callers ───────────────────────────────────────────────────────

async fn call_anthropic(prompt: &str, api_key: &str) -> Result<Vec<String>, String> {
    let resp = reqwest::Client::new()
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": "claude-sonnet-4-6", "max_tokens": 512,
            "messages": [{"role": "user", "content": prompt}]
        }))
        .send().await.map_err(|e| e.to_string())?;
    let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(parse_card_array(data["content"][0]["text"].as_str().unwrap_or("[]")))
}

async fn call_openai_compat(prompt: &str, api_key: &str, base_url: &str, model: &str) -> Result<Vec<String>, String> {
    let resp = reqwest::Client::new()
        .post(format!("{}/chat/completions", base_url))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": model, "max_tokens": 512,
            "messages": [{"role": "user", "content": prompt}]
        }))
        .send().await.map_err(|e| e.to_string())?;
    let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(parse_card_array(data["choices"][0]["message"]["content"].as_str().unwrap_or("[]")))
}

async fn call_gemini(prompt: &str, api_key: &str) -> Result<Vec<String>, String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={}",
        api_key
    );
    let resp = reqwest::Client::new()
        .post(&url)
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "contents": [{"role": "user", "parts": [{"text": prompt}]}]
        }))
        .send().await.map_err(|e| e.to_string())?;
    let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(parse_card_array(data["candidates"][0]["content"]["parts"][0]["text"].as_str().unwrap_or("[]")))
}

fn parse_card_array(text: &str) -> Vec<String> {
    if let Ok(v) = serde_json::from_str::<Vec<String>>(text.trim()) { return v; }
    if let (Some(s), Some(e)) = (text.find('['), text.rfind(']')) {
        if let Ok(v) = serde_json::from_str::<Vec<String>>(&text[s..=e]) { return v; }
    }
    vec![text.trim().to_string()]
}
