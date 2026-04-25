use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Event {
    pub id: Option<i64>,
    pub timestamp: String,
    pub source: String,
    pub app: Option<String>,
    pub window_title: Option<String>,
    pub url: Option<String>,
    pub page_title: Option<String>,
}

pub fn init(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS events (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp     TEXT NOT NULL,
            source        TEXT NOT NULL,
            app           TEXT,
            window_title  TEXT,
            url           TEXT,
            page_title    TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_timestamp ON events(timestamp);",
    )
}

pub fn insert_event(conn: &Connection, event: &Event) -> Result<()> {
    conn.execute(
        "INSERT INTO events (timestamp, source, app, window_title, url, page_title)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            event.timestamp,
            event.source,
            event.app,
            event.window_title,
            event.url,
            event.page_title,
        ],
    )?;
    Ok(())
}

// Delete events FROM the last N minutes (manual clear).
pub fn delete_recent(conn: &Connection, minutes: i64) -> Result<usize> {
    Ok(conn.execute(
        "DELETE FROM events WHERE timestamp >= datetime('now', ?1)",
        [format!("-{} minutes", minutes)],
    )?)
}

// Delete events OLDER than N minutes (auto-clear / retention).
pub fn delete_older_than(conn: &Connection, minutes: i64) -> Result<usize> {
    Ok(conn.execute(
        "DELETE FROM events WHERE timestamp < datetime('now', ?1)",
        [format!("-{} minutes", minutes)],
    )?)
}

pub fn get_events_for_date(conn: &Connection, date: &str) -> Result<Vec<Event>> {
    let mut stmt = conn.prepare(
        "SELECT id, timestamp, source, app, window_title, url, page_title
         FROM events
         WHERE date(timestamp) = ?1
         ORDER BY timestamp ASC",
    )?;

    let events = stmt
        .query_map([date], |row| {
            Ok(Event {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                source: row.get(2)?,
                app: row.get(3)?,
                window_title: row.get(4)?,
                url: row.get(5)?,
                page_title: row.get(6)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(events)
}
