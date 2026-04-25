use axum::{extract::State, http::Method, routing::post, Json, Router};
use std::collections::HashSet;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, RwLock,
};
use tower_http::cors::{Any, CorsLayer};

use crate::{db::{self, Event}, in_schedule};

#[derive(Clone)]
pub struct ServerState {
    pub db:         Arc<Mutex<rusqlite::Connection>>,
    pub exclusions: Arc<RwLock<HashSet<String>>>,
    pub paused:     Arc<AtomicBool>,
    pub schedule:   Arc<RwLock<Option<(u32, u32)>>>,
}

pub async fn start_server(
    db:         Arc<Mutex<rusqlite::Connection>>,
    exclusions: Arc<RwLock<HashSet<String>>>,
    paused:     Arc<AtomicBool>,
    schedule:   Arc<RwLock<Option<(u32, u32)>>>,
) {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::POST, Method::OPTIONS])
        .allow_headers(Any);

    let app = Router::new()
        .route("/event", post(handle_event))
        .layer(cors)
        .with_state(ServerState { db, exclusions, paused, schedule });

    let listener = match tokio::net::TcpListener::bind("127.0.0.1:7734").await {
        Ok(l) => l,
        Err(e) => { eprintln!("Trace HTTP server failed to bind: {e}"); return; }
    };
    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("Trace HTTP server error: {e}");
    }
}

async fn handle_event(State(s): State<ServerState>, Json(event): Json<Event>) -> &'static str {
    if s.paused.load(Ordering::SeqCst) { return "paused"; }
    if !in_schedule(&s.schedule.read().unwrap()) { return "outside_schedule"; }
    if let Some(url) = &event.url {
        if is_excluded_url(url, &s.exclusions.read().unwrap()) { return "blocked"; }
    }
    if let Ok(conn) = s.db.lock() { let _ = db::insert_event(&conn, &event); }
    "ok"
}

fn is_excluded_url(url: &str, exclusions: &HashSet<String>) -> bool {
    let host = url.split("//").nth(1)
        .and_then(|s| s.split('/').next())
        .and_then(|h| h.split(':').next())
        .unwrap_or("").to_lowercase();
    let host = host.trim_start_matches("www.");
    exclusions.iter().any(|p| {
        let p = p.trim_start_matches("www.");
        host == p || host.ends_with(&format!(".{}", p))
    })
}
