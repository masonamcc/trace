use chrono::Timelike;
use std::collections::HashSet;
use std::sync::{
    atomic::AtomicBool,
    Arc, Mutex, RwLock,
};

mod command;
mod db;
mod server;
mod watcher;

use command::{
    get_events, get_daily_summary, get_thread_posts,
    clear_recent, clear_older_than,
    set_exclusions,
    set_tracking_paused, set_tracking_schedule,
    post_to_x, post_thread_to_x,
};

pub struct AppState {
    pub db: Arc<Mutex<rusqlite::Connection>>,
    pub exclusions: Arc<RwLock<HashSet<String>>>,
    pub paused: Arc<AtomicBool>,
    pub schedule: Arc<RwLock<Option<(u32, u32)>>>,
}

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
    else            { cur >= start || cur < end }
}

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
            get_events, get_daily_summary, get_thread_posts,
            clear_recent, clear_older_than,
            set_exclusions,
            set_tracking_paused, set_tracking_schedule,
            post_to_x, post_thread_to_x,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
