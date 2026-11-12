//! Lista de aparelhos ao vivo com `adb track-devices -l`: o servidor manda um bloco a
//! cada mudança, sem consulta periódica. Se o processo cai (servidor parado, adb
//! trocado), recomeça; enquanto o servidor estiver parado pelo usuário, espera.

use crate::parse::{parse_devices, split_track_blocks};
use crate::runner::{full_args, tokio_command};
use crate::state::AppState;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;

pub fn spawn(app: AppHandle, st: Arc<AppState>) {
    tauri::async_runtime::spawn(async move {
        loop {
            let path = match st.adb_path() {
                Ok(p) if !st.tracker_paused.load(Ordering::SeqCst) => p,
                _ => {
                    tokio::select! {
                        _ = st.tracker_notify.notified() => {},
                        _ = tokio::time::sleep(Duration::from_millis(1000)) => {},
                    }
                    continue;
                }
            };
            let args = full_args(&st, None, &["track-devices".to_string(), "-l".to_string()]);
            let mut c = tokio_command(&st, &path, &args);
            c.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null());
            let mut child = match c.spawn() {
                Ok(ch) => ch,
                Err(_) => {
                    tokio::time::sleep(Duration::from_millis(2000)).await;
                    continue;
                }
            };
            let _ = app.emit("server", serde_json::json!({ "running": true }));
            let mut out = match child.stdout.take() {
                Some(o) => o,
                None => continue,
            };
            let mut acc: Vec<u8> = Vec::new();
            let mut buf = [0u8; 8192];
            loop {
                tokio::select! {
                    r = out.read(&mut buf) => {
                        match r {
                            Ok(0) | Err(_) => break,
                            Ok(n) => {
                                acc.extend_from_slice(&buf[..n]);
                                let (blocks, used) = split_track_blocks(&acc);
                                acc.drain(..used);
                                if let Some(last) = blocks.last() {
                                    let _ = app.emit("devices", parse_devices(last));
                                }
                            }
                        }
                    }
                    _ = st.tracker_notify.notified() => break,
                }
            }
            let _ = child.kill().await;
            let _ = app.emit("devices", Vec::<crate::parse::Device>::new());
            let _ = app.emit("server", serde_json::json!({ "running": false }));
            tokio::time::sleep(Duration::from_millis(1200)).await;
        }
    });
}

pub fn server_running(st: &AppState) -> bool {
    use std::net::{TcpStream, ToSocketAddrs};
    let s = st.settings();
    let host = if s.host() == "localhost" { "127.0.0.1".to_string() } else { s.host() };
    let addr = format!("{}:{}", host, if s.server_port == 0 { 5037 } else { s.server_port });
    match addr.to_socket_addrs() {
        Ok(mut it) => it
            .next()
            .map(|a| TcpStream::connect_timeout(&a, Duration::from_millis(300)).is_ok())
            .unwrap_or(false),
        Err(_) => false,
    }
}
