//! Configurações e histórico, em JSON na pasta de dados do app.
//! O Rust só conhece os campos que usa; o resto (guias, favoritos, tema…) passa
//! pelo `extra` e volta intacto para a interface.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// "auto" (procura sozinho), "custom" (adb_path) ou "downloaded" (platform-tools baixado).
    pub adb_mode: String,
    pub adb_path: String,
    pub server_host: String,
    pub server_port: u16,
    pub start_server_on_launch: bool,
    pub stop_server_on_exit: bool,
    pub env: BTreeMap<String, String>,
    pub keep_history: bool,
    /// Fechar a janela só a esconde; o app continua na bandeja.
    pub close_to_tray: bool,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            adb_mode: "auto".into(),
            adb_path: String::new(),
            server_host: "localhost".into(),
            server_port: 5037,
            start_server_on_launch: true,
            stop_server_on_exit: false,
            env: BTreeMap::new(),
            keep_history: true,
            close_to_tray: false,
            extra: serde_json::Map::new(),
        }
    }
}

impl Settings {
    pub fn host(&self) -> String {
        let h = self.server_host.trim();
        if h.is_empty() {
            "localhost".into()
        } else {
            h.into()
        }
    }

    /// Opções globais do servidor, só quando diferentes do padrão.
    pub fn server_args(&self) -> Vec<String> {
        let mut v = Vec::new();
        let h = self.host();
        if h != "localhost" && h != "127.0.0.1" {
            v.push("-H".into());
            v.push(h);
        }
        if self.server_port != 0 && self.server_port != 5037 {
            v.push("-P".into());
            v.push(self.server_port.to_string());
        }
        v
    }

    pub fn env_pairs(&self) -> Vec<(String, String)> {
        self.env
            .iter()
            .filter(|(k, v)| !k.trim().is_empty() && !v.trim().is_empty())
            .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
            .collect()
    }
}

pub fn load(path: &Path) -> Settings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(path: &Path, s: &Settings) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    // Grava num temporário e troca, para um corte de energia não deixar o arquivo pela metade.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: u64,
    pub ts: u64,
    pub cmd: String,
    pub state: String,
    pub code: Option<i32>,
    pub duration_ms: Option<u64>,
    pub error: Option<String>,
}

pub const HISTORY_MAX: usize = 300;

pub fn load_history(path: &Path) -> Vec<LogEntry> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_history(path: &PathBuf, entries: &[LogEntry]) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string(entries) {
        let _ = std::fs::write(path, json);
    }
}
