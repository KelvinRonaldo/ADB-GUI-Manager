//! Download do platform-tools oficial do Google para a pasta de dados do app.
//! Só roda quando o usuário confirma na tela.

use crate::state::AppState;
use futures_util::StreamExt;
use serde::Serialize;
use std::io::Write;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub received: u64,
    pub total: Option<u64>,
    pub phase: String,
}

pub fn url() -> &'static str {
    if cfg!(windows) {
        "https://dl.google.com/android/repository/platform-tools-latest-windows.zip"
    } else if cfg!(target_os = "macos") {
        "https://dl.google.com/android/repository/platform-tools-latest-darwin.zip"
    } else {
        "https://dl.google.com/android/repository/platform-tools-latest-linux.zip"
    }
}

pub async fn download(app: &AppHandle, st: &AppState) -> Result<String, String> {
    std::fs::create_dir_all(&st.data_dir).map_err(|e| e.to_string())?;
    let zip_path = st.data_dir.join("platform-tools.zip.part");
    let resp = reqwest::get(url()).await.map_err(|e| format!("NETWORK: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let total = resp.content_length();
    let mut file = std::fs::File::create(&zip_path).map_err(|e| e.to_string())?;
    let mut received: u64 = 0;
    let mut last_emit = 0u64;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("NETWORK: {}", e))?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        if received - last_emit > 256 * 1024 {
            last_emit = received;
            let _ = app.emit("download", Progress { received, total, phase: "download".into() });
        }
    }
    drop(file);
    let _ = app.emit("download", Progress { received, total, phase: "extract".into() });
    let data_dir = st.data_dir.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let target = data_dir.join("platform-tools");
        if target.exists() {
            std::fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
        }
        let f = std::fs::File::open(data_dir.join("platform-tools.zip.part")).map_err(|e| e.to_string())?;
        let mut z = zip::ZipArchive::new(f).map_err(|e| format!("ZIP: {}", e))?;
        z.extract(&data_dir).map_err(|e| format!("ZIP: {}", e))?;
        let _ = std::fs::remove_file(data_dir.join("platform-tools.zip.part"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for exe in ["adb", "fastboot"] {
                let p = target.join(exe);
                if p.exists() {
                    let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755));
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = app.emit("download", Progress { received, total, phase: "done".into() });
    Ok(st.downloaded_adb().to_string_lossy().to_string())
}
