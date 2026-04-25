use crate::{db::{self, Event}, in_schedule};
use chrono::Utc;
use std::collections::HashSet;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, RwLock,
};
use std::time::Duration;

#[cfg(target_os = "windows")]
fn get_active_window() -> Option<(String, String)> {
    use windows::{
        Win32::Foundation::CloseHandle,
        Win32::System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
            PROCESS_QUERY_LIMITED_INFORMATION,
        },
        Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
        },
        core::PWSTR,
    };
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0 == std::ptr::null_mut() { return None; }

        let mut title_buf = vec![0u16; 512];
        let len = GetWindowTextW(hwnd, &mut title_buf);
        if len == 0 { return None; }
        let title = String::from_utf16_lossy(&title_buf[..len as usize]);

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 { return Some(("Unknown".to_string(), title)); }

        let handle = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(h) => h,
            Err(_) => return Some(("Unknown".to_string(), title)),
        };
        let mut path_buf = vec![0u16; 1024];
        let mut size = 1024u32;
        let _ = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(path_buf.as_mut_ptr()), &mut size);
        let _ = CloseHandle(handle);

        let path_str = String::from_utf16_lossy(&path_buf[..size as usize]);
        let app_name = std::path::Path::new(&path_str)
            .file_stem().and_then(|s| s.to_str()).unwrap_or("Unknown").to_string();
        Some((app_name, title))
    }
}

#[cfg(not(target_os = "windows"))]
fn get_active_window() -> Option<(String, String)> { None }

fn is_excluded(app: &str, title: &str, exclusions: &HashSet<String>) -> bool {
    let haystack = format!("{} {}", app, title).to_lowercase();
    exclusions.iter().any(|p| haystack.contains(p))
}

pub fn start_watcher(
    db:         Arc<Mutex<rusqlite::Connection>>,
    exclusions: Arc<RwLock<HashSet<String>>>,
    paused:     Arc<AtomicBool>,
    schedule:   Arc<RwLock<Option<(u32, u32)>>>,
) {
    std::thread::spawn(move || {
        let mut last_key = String::new();
        loop {
            let should_track = !paused.load(Ordering::SeqCst)
                && in_schedule(&schedule.read().unwrap());

            if should_track {
                if let Some((app, title)) = get_active_window() {
                    let excl = exclusions.read().unwrap();
                    if !is_excluded(&app, &title, &excl) {
                        drop(excl);
                        let key = format!("{}|{}", app, title);
                        if key != last_key {
                            last_key = key;
                            let event = Event {
                                id: None,
                                timestamp: Utc::now().to_rfc3339(),
                                source: "desktop".to_string(),
                                app: Some(app),
                                window_title: Some(title),
                                url: None,
                                page_title: None,
                            };
                            if let Ok(conn) = db.lock() {
                                let _ = db::insert_event(&conn, &event);
                            }
                        }
                    }
                }
            } else {
                last_key.clear(); // reset so first event after resume is captured
            }

            std::thread::sleep(Duration::from_secs(5));
        }
    });
}
