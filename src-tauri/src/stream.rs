//! Comandos longos com saída ao vivo (logcat, wait-for, bugreport, comandos da linha
//! livre). A saída vai em pedaços pelo evento `stream`; o fim, com o código, em
//! `{kind: "end"}`.

use crate::parse::display_command;
use crate::runner::{full_args, last_line, log_end, log_start, tokio_command};
use crate::state::AppState;
use serde::Serialize;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncRead, AsyncReadExt};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEvent {
    pub id: u64,
    pub kind: String,
    pub data: String,
    pub code: Option<i32>,
}

/// Decodifica o que já forma UTF-8 completo e guarda o resto para o próximo pedaço.
pub fn take_utf8(buf: &mut Vec<u8>) -> String {
    match std::str::from_utf8(buf) {
        Ok(s) => {
            let s = s.to_string();
            buf.clear();
            s
        }
        Err(e) if e.error_len().is_none() => {
            let valid = e.valid_up_to();
            let s = String::from_utf8_lossy(&buf[..valid]).to_string();
            buf.drain(..valid);
            s
        }
        Err(_) => {
            let s = String::from_utf8_lossy(buf).to_string();
            buf.clear();
            s
        }
    }
}

async fn pump<R: AsyncRead + Unpin>(app: AppHandle, id: u64, kind: &'static str, mut r: R) -> String {
    let mut buf = [0u8; 16384];
    let mut carry = Vec::new();
    let mut tail = String::new();
    loop {
        match r.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                carry.extend_from_slice(&buf[..n]);
                let text = take_utf8(&mut carry);
                if !text.is_empty() {
                    tail.push_str(&text);
                    if tail.len() > 4096 {
                        tail = tail[tail.len() - 2048..].to_string();
                    }
                    let _ = app.emit("stream", StreamEvent { id, kind: kind.into(), data: text, code: None });
                }
            }
        }
    }
    tail
}

pub fn start(app: AppHandle, st: Arc<AppState>, args: Vec<String>, serial: Option<String>) -> Result<u64, String> {
    let path = st.adb_path()?;
    let args = full_args(&st, serial.as_deref(), &args);
    let cmd = display_command(&args);
    let id = st.new_id();
    let mut c = tokio_command(&st, &path, &args);
    c.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
    let mut child = c.spawn().map_err(|e| format!("SPAWN_FAILED: {}", e))?;
    log_start(&app, id, &cmd);
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    st.streams.lock().map_err(|e| e.to_string())?.insert(id, tx);
    let out = child.stdout.take();
    let err = child.stderr.take();
    let started = Instant::now();
    tauri::async_runtime::spawn(async move {
        let a1 = app.clone();
        let a2 = app.clone();
        let t_out = tauri::async_runtime::spawn(async move {
            match out {
                Some(o) => pump(a1, id, "out", o).await,
                None => String::new(),
            }
        });
        let t_err = tauri::async_runtime::spawn(async move {
            match err {
                Some(e) => pump(a2, id, "err", e).await,
                None => String::new(),
            }
        });
        let mut stopped = false;
        let status = tokio::select! {
            s = child.wait() => s.ok(),
            _ = rx => {
                stopped = true;
                let _ = child.kill().await;
                child.wait().await.ok()
            }
        };
        let out_tail = t_out.await.unwrap_or_default();
        let err_tail = t_err.await.unwrap_or_default();
        let code = if stopped { 130 } else { status.and_then(|s| s.code()).unwrap_or(-1) };
        if let Ok(mut m) = st.streams.lock() {
            m.remove(&id);
        }
        let error = if code == 0 || stopped { None } else { last_line(&err_tail).or_else(|| last_line(&out_tail)) };
        log_end(&app, &st, id, &cmd, code, started.elapsed().as_millis() as u64, error);
        let _ = app.emit("stream", StreamEvent { id, kind: "end".into(), data: String::new(), code: Some(code) });
    });
    Ok(id)
}

pub fn stop(st: &AppState, id: u64) {
    if let Ok(mut m) = st.streams.lock() {
        if let Some(tx) = m.remove(&id) {
            let _ = tx.send(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::take_utf8;

    #[test]
    fn utf8_split_between_chunks() {
        let bytes = "ação".as_bytes();
        let mut buf = bytes[..2].to_vec();
        assert_eq!(take_utf8(&mut buf), "a");
        assert_eq!(buf.len(), 1);
        buf.extend_from_slice(&bytes[2..]);
        assert_eq!(take_utf8(&mut buf), "ção");
        assert!(buf.is_empty());
    }
}
