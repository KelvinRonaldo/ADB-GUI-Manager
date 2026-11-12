use crate::locate::{AdbInfo, Candidate};
use crate::settings::{LogEntry, Settings};
use portable_pty::{ChildKiller, MasterPty};
use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, RwLock};
use tokio::sync::{oneshot, Notify};

pub struct PtyHandle {
    pub writer: Box<dyn Write + Send>,
    pub master: Box<dyn MasterPty + Send>,
    pub killer: Box<dyn ChildKiller + Send + Sync>,
}

pub struct AppState {
    pub adb: RwLock<Option<AdbInfo>>,
    pub checked: Mutex<Vec<Candidate>>,
    pub settings: RwLock<Settings>,
    pub settings_path: PathBuf,
    pub history_path: PathBuf,
    pub data_dir: PathBuf,
    pub history: Mutex<VecDeque<LogEntry>>,
    pub next_id: AtomicU64,
    pub streams: Mutex<HashMap<u64, oneshot::Sender<()>>>,
    pub ptys: Mutex<HashMap<u64, PtyHandle>>,
    pub tracker_paused: AtomicBool,
    pub tracker_notify: Notify,
    pub cli_adb: Option<String>,
}

impl AppState {
    pub fn new_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::SeqCst)
    }

    pub fn settings(&self) -> Settings {
        self.settings.read().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn adb_path(&self) -> Result<String, String> {
        self.adb
            .read()
            .ok()
            .and_then(|a| a.as_ref().map(|i| i.path.clone()))
            .ok_or_else(|| "ADB_NOT_CONFIGURED".to_string())
    }

    pub fn downloaded_adb(&self) -> PathBuf {
        self.data_dir.join("platform-tools").join(crate::locate::ADB_EXE)
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
