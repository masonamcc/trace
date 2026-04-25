use chrono::Timelike;
use std::collections::HashSet;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, RwLock,
};

mod db;
mod server;
mod watcher;

pub struct AppState {
    pub db: Arc<Mutex<rusqlite::Connection>>,
    pub exclusions: Arc<RwLock<HashSet<String>>>,
    pub paused: Arc<AtomicBool>,
    pub schedule: Arc<RwLock<Option<(u32, u32)>>>, // (start_mins, end_mins) from midnight
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_events(date: String, state: tauri::State<AppState>) -> Vec<db::Event> {
    let conn = state.db.lock().unwrap();
    db::get_events_for_date(&conn, &date).unwrap_or_default()
}

#[tauri::command]
fn clear_recent(minutes: i64, state: tauri::State<AppState>) -> Result<usize, String> {
    let conn = state.db.lock().unwrap();
    db::delete_recent(&conn, minutes).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_older_than(minutes: i64, state: tauri::State<AppState>) -> Result<usize, String> {
    let conn = state.db.lock().unwrap();
    db::delete_older_than(&conn, minutes).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_exclusions(patterns: Vec<String>, state: tauri::State<AppState>) {
    let normalized: HashSet<String> = patterns
        .into_iter()
        .map(|p| p.to_lowercase().trim_start_matches("www.").to_string())
        .collect();
    *state.exclusions.write().unwrap() = normalized;
}

#[tauri::command]
fn set_tracking_paused(paused: bool, state: tauri::State<AppState>) {
    state.paused.store(paused, Ordering::SeqCst);
}

#[tauri::command]
fn set_tracking_schedule(
    start: Option<String>,
    end: Option<String>,
    state: tauri::State<AppState>,
) {
    let parsed = match (start.as_deref(), end.as_deref()) {
        (Some(s), Some(e)) => parse_hhmm(s).zip(parse_hhmm(e)),
        _ => None,
    };
    *state.schedule.write().unwrap() = parsed;
}

#[tauri::command]
async fn get_daily_summary(
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

// ── Helpers ───────────────────────────────────────────────────────────────────

pub fn parse_hhmm(s: &str) -> Option<u32> {
    let mut parts = s.split(':');
    let h: u32 = parts.next()?.parse().ok()?;
    let m: u32 = parts.next()?.parse().ok()?;
    if h > 23 || m > 59 { return None; }
    Some(h * 60 + m)
}

pub fn in_schedule(schedule: &Option<(u32, u32)>) -> bool {
    let Some(&(start, end)) = schedule.as_ref() else { return true; };
    let now = chrono::Local::now();
    let cur = now.hour() * 60 + now.minute();
    if start <= end { cur >= start && cur < end }
    else            { cur >= start || cur < end }  // wraps midnight
}

// ── Prompt ────────────────────────────────────────────────────────────────────

fn build_prompt(events: &[db::Event], date: &str, style: &str) -> String {
    let events_text: String = events.iter().map(|e| {
        let time = e.timestamp.get(11..16).unwrap_or("??:??");
        match e.source.as_str() {
            "chrome" => format!("[{}] Browser: {} | {}", time,
                e.page_title.as_deref().unwrap_or("Unknown page"),
                e.url.as_deref().unwrap_or("")),
            _ => format!("[{}] App: {} | {}", time,
                e.app.as_deref().unwrap_or("Unknown"),
                e.window_title.as_deref().unwrap_or("")),
        }
    }).collect::<Vec<_>>().join("\n");

    let style_instruction = if style.trim().is_empty() { String::new() }
    else { format!("\n\nAdditional style instructions: {}", style.trim()) };

    format!(
        "Here is a computer activity log for {}:\n\n{}\n\n\
        Write exactly 3 short summaries of this person's day. \
        Each must be 1-3 sentences — punchy and social-media-post sized, like a tweet. \
        Cover different angles: e.g. what was built, what was researched, how the day flowed overall. \
        Write in first person.{}\n\n\
        Return ONLY a JSON array of exactly 3 strings, no markdown, no extra text:\n\
        [\"summary one\", \"summary two\", \"summary three\"]",
        date, events_text, style_instruction
    )
}

// ── Providers ─────────────────────────────────────────────────────────────────

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

// ── App setup ─────────────────────────────────────────────────────────────────

pub fn run() {
    let db_path = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("Trace").join("events.db");
    std::fs::create_dir_all(db_path.parent().unwrap()).expect("Failed to create Trace data dir");

    let conn = rusqlite::Connection::open(&db_path).expect("Failed to open database");
    db::init(&conn).expect("Failed to initialize database schema");

    let db          = Arc::new(Mutex::new(conn));
    let exclusions  = Arc::new(RwLock::new(HashSet::<String>::new()));
    let paused      = Arc::new(AtomicBool::new(false));
    let schedule    = Arc::new(RwLock::new(None::<(u32, u32)>));

    watcher::start_watcher(
        Arc::clone(&db), Arc::clone(&exclusions),
        Arc::clone(&paused), Arc::clone(&schedule),
    );

    let db2   = Arc::clone(&db);
    let excl2 = Arc::clone(&exclusions);
    let pau2  = Arc::clone(&paused);
    let sch2  = Arc::clone(&schedule);

    tauri::Builder::default()
        .manage(AppState { db, exclusions, paused, schedule })
        .setup(move |_app| {
            tauri::async_runtime::spawn(server::start_server(db2, excl2, pau2, sch2));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_events, get_daily_summary,
            clear_recent, clear_older_than,
            set_exclusions,
            set_tracking_paused, set_tracking_schedule,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
