//! Execução do adb. Todo comando que a interface roda passa por aqui e vira uma
//! entrada no registro de comandos (evento `cmdlog`), com o comando exato,
//! o código de saída e o tempo.

use crate::parse::display_command;
use crate::settings::{LogEntry, HISTORY_MAX};
use crate::state::{now_ms, AppState};
use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub id: u64,
    pub cmd: String,
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    pub timed_out: bool,
}

/// Argumentos completos: opções do servidor, `-s` e o comando.
pub fn full_args(st: &AppState, serial: Option<&str>, args: &[String]) -> Vec<String> {
    let mut v = st.settings().server_args();
    if let Some(s) = serial.filter(|s| !s.is_empty()) {
        v.push("-s".into());
        v.push(s.into());
    }
    v.extend(args.iter().cloned());
    v
}

pub fn tokio_command(st: &AppState, path: &str, args: &[String]) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(path);
    cmd.args(args);
    for (k, v) in st.settings().env_pairs() {
        cmd.env(k, v);
    }
    cmd.stdin(std::process::Stdio::null());
    cmd.kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    cmd
}

pub fn last_line(s: &str) -> Option<String> {
    s.lines().rev().map(str::trim).find(|l| !l.is_empty()).map(|l| l.chars().take(300).collect())
}

pub fn log_start(app: &AppHandle, id: u64, cmd: &str) {
    let e = LogEntry { id, ts: now_ms(), cmd: cmd.into(), state: "running".into(), code: None, duration_ms: None, error: None };
    let _ = app.emit("cmdlog", e);
}

pub fn log_end(app: &AppHandle, st: &AppState, id: u64, cmd: &str, code: i32, duration_ms: u64, error: Option<String>) {
    let e = LogEntry {
        id,
        ts: now_ms(),
        cmd: cmd.into(),
        state: "done".into(),
        code: Some(code),
        duration_ms: Some(duration_ms),
        error,
    };
    let _ = app.emit("cmdlog", e.clone());
    if st.settings().keep_history {
        if let Ok(mut h) = st.history.lock() {
            h.push_back(e);
            while h.len() > HISTORY_MAX {
                h.pop_front();
            }
            let snapshot: Vec<LogEntry> = h.iter().cloned().collect();
            let path = st.history_path.clone();
            std::thread::spawn(move || crate::settings::save_history(&path, &snapshot));
        }
    }
}

pub struct RunOpts {
    pub serial: Option<String>,
    pub timeout_ms: Option<u64>,
    pub quiet: bool,
}

pub async fn run(app: &AppHandle, st: &AppState, args: Vec<String>, opts: RunOpts) -> Result<RunResult, String> {
    let path = st.adb_path()?;
    let args = full_args(st, opts.serial.as_deref(), &args);
    let cmd = display_command(&args);
    let id = st.new_id();
    if !opts.quiet {
        log_start(app, id, &cmd);
    }
    let started = Instant::now();
    let mut c = tokio_command(st, &path, &args);
    c.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
    let child = match c.spawn() {
        Ok(ch) => ch,
        Err(e) => {
            let msg = format!("SPAWN_FAILED: {}", e);
            if !opts.quiet {
                log_end(app, st, id, &cmd, -1, 0, Some(msg.clone()));
            }
            return Err(msg);
        }
    };
    let timeout = opts.timeout_ms.unwrap_or(120_000);
    let fut = child.wait_with_output();
    let (code, stdout, stderr, timed_out) = if timeout == 0 {
        let o = fut.await.map_err(|e| e.to_string())?;
        (o.status.code().unwrap_or(-1), o.stdout, o.stderr, false)
    } else {
        match tokio::time::timeout(Duration::from_millis(timeout), fut).await {
            Ok(r) => {
                let o = r.map_err(|e| e.to_string())?;
                (o.status.code().unwrap_or(-1), o.stdout, o.stderr, false)
            }
            // O futuro some aqui e o processo morre junto (kill_on_drop).
            Err(_) => (-1, Vec::new(), b"TIMEOUT".to_vec(), true),
        }
    };
    let duration_ms = started.elapsed().as_millis() as u64;
    let stdout = String::from_utf8_lossy(&stdout).to_string();
    let stderr = String::from_utf8_lossy(&stderr).to_string();
    if !opts.quiet {
        let err = if code == 0 { None } else { last_line(&stderr).or_else(|| last_line(&stdout)) };
        log_end(app, st, id, &cmd, code, duration_ms, err);
    }
    Ok(RunResult { id, cmd, code, stdout, stderr, duration_ms, timed_out })
}

/// Para comandos que devolvem binário (screencap): grava a saída num arquivo.
pub async fn run_to_file(app: &AppHandle, st: &AppState, args: Vec<String>, serial: Option<String>, path_out: &str) -> Result<RunResult, String> {
    let path = st.adb_path()?;
    let args = full_args(st, serial.as_deref(), &args);
    let cmd = format!("{} > {}", display_command(&args), path_out);
    let id = st.new_id();
    log_start(app, id, &cmd);
    let started = Instant::now();
    let mut c = tokio_command(st, &path, &args);
    c.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
    let out = c.spawn().map_err(|e| e.to_string())?;
    let o = tokio::time::timeout(Duration::from_secs(60), out.wait_with_output())
        .await
        .map_err(|_| "TIMEOUT".to_string())?
        .map_err(|e| e.to_string())?;
    let code = o.status.code().unwrap_or(-1);
    let stderr = String::from_utf8_lossy(&o.stderr).to_string();
    if code == 0 && !o.stdout.is_empty() {
        std::fs::write(path_out, &o.stdout).map_err(|e| format!("WRITE_FAILED: {}", e))?;
    }
    let duration_ms = started.elapsed().as_millis() as u64;
    log_end(app, st, id, &cmd, code, duration_ms, if code == 0 { None } else { last_line(&stderr) });
    Ok(RunResult { id, cmd, code, stdout: format!("{} bytes", o.stdout.len()), stderr, duration_ms, timed_out: false })
}
