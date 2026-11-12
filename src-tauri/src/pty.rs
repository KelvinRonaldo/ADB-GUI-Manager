//! Terminal de verdade (PTY) para `adb shell` interativo e para push/pull, que só
//! mostram o progresso quando a saída é um terminal.

use crate::parse::display_command;
use crate::runner::{full_args, log_end, log_start};
use crate::state::{AppState, PtyHandle};
use crate::stream::take_utf8;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::io::Read;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyEvent {
    pub id: u64,
    pub data: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyExit {
    pub id: u64,
    pub code: i32,
}

pub fn open(app: AppHandle, st: Arc<AppState>, args: Vec<String>, serial: Option<String>, cols: u16, rows: u16) -> Result<u64, String> {
    let path = st.adb_path()?;
    let args = full_args(&st, serial.as_deref(), &args);
    let cmd = display_command(&args);
    let id = st.new_id();
    let pair = native_pty_system()
        .openpty(PtySize { rows: rows.max(5), cols: cols.max(20), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("PTY_FAILED: {}", e))?;
    let mut builder = CommandBuilder::new(&path);
    builder.args(&args);
    for (k, v) in st.settings().env_pairs() {
        builder.env(k, v);
    }
    let mut child = pair.slave.spawn_command(builder).map_err(|e| format!("SPAWN_FAILED: {}", e))?;
    drop(pair.slave);
    let killer = child.clone_killer();
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    st.ptys
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, PtyHandle { writer, master: pair.master, killer });
    log_start(&app, id, &cmd);

    let app_r = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut carry = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    carry.extend_from_slice(&buf[..n]);
                    let data = take_utf8(&mut carry);
                    if !data.is_empty() {
                        let _ = app_r.emit("pty", PtyEvent { id, data });
                    }
                }
            }
        }
    });

    let started = Instant::now();
    std::thread::spawn(move || {
        let code = child.wait().map(|s| s.exit_code() as i32).unwrap_or(-1);
        // No Windows o leitor só termina quando o lado mestre fecha.
        std::thread::sleep(std::time::Duration::from_millis(150));
        if let Ok(mut m) = st.ptys.lock() {
            m.remove(&id);
        }
        log_end(&app, &st, id, &cmd, code, started.elapsed().as_millis() as u64, None);
        let _ = app.emit("pty-exit", PtyExit { id, code });
    });
    Ok(id)
}

pub fn write(st: &AppState, id: u64, data: &str) -> Result<(), String> {
    let mut m = st.ptys.lock().map_err(|e| e.to_string())?;
    let h = m.get_mut(&id).ok_or("PTY_CLOSED")?;
    h.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    h.writer.flush().map_err(|e| e.to_string())
}

pub fn resize(st: &AppState, id: u64, cols: u16, rows: u16) -> Result<(), String> {
    let m = st.ptys.lock().map_err(|e| e.to_string())?;
    let h = m.get(&id).ok_or("PTY_CLOSED")?;
    h.master
        .resize(PtySize { rows: rows.max(5), cols: cols.max(20), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

pub fn close(st: &AppState, id: u64) {
    if let Ok(mut m) = st.ptys.lock() {
        if let Some(h) = m.get_mut(&id) {
            let _ = h.killer.kill();
        }
    }
}

pub fn close_all(st: &AppState) {
    if let Ok(mut m) = st.ptys.lock() {
        for h in m.values_mut() {
            let _ = h.killer.kill();
        }
        m.clear();
    }
}
