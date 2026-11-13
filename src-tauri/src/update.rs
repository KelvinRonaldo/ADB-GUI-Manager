//! Atualização do próprio app pelas Releases do GitHub.
//!
//! Só roda quando a pessoa pede (Configurações → Sobre e atualizações). O `latest.json` da
//! Release mais recente diz a versão e, para cada pacote, o link e a assinatura. A busca e o
//! download são daqui (progresso, cancelar, retomar); o plugin oficial confere a assinatura
//! (chave pública no tauri.conf.json, presa à versão) e instala o AppImage, o .deb e o
//! instalador do Windows. O portátil do Windows não tem instalador: o .exe é trocado aqui.

use crate::state::AppState;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const ENDPOINT: &str = "https://github.com/KelvinRonaldo/ADB-GUI-Manager/releases/latest/download/latest.json";
const PENDING_FILE: &str = "update-pending.json";

#[derive(Default)]
pub struct UpdateState {
    current: Mutex<Option<Update>>,
    cancel: AtomicBool,
    busy: AtomicBool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    /// appimage, deb, rpm, nsis, msi, portable ou dev (rodando sem pacote).
    pub package: String,
    pub location: String,
    pub can_update: bool,
    /// Resultado da última instalação, lido ao abrir: `updated` ou `notFinished`.
    pub last_install: Option<LastInstall>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastInstall {
    pub result: String,
    pub from: String,
    pub to: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub available: bool,
    pub current: String,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub date: Option<String>,
    pub size: Option<u64>,
    /// Já baixado e conferido numa tentativa anterior.
    pub downloaded: bool,
    /// Shell, logcat e gravações abertos agora (fecham na instalação).
    pub open_sessions: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    received: u64,
    total: Option<u64>,
    bytes_per_sec: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct Pending {
    from: String,
    to: String,
    file: PathBuf,
    notes: Option<String>,
    raw: serde_json::Value,
}

pub fn package_kind() -> &'static str {
    if cfg!(feature = "portable") {
        return "portable";
    }
    use tauri::utils::config::BundleType;
    match tauri::utils::platform::bundle_type() {
        Some(BundleType::AppImage) => "appimage",
        Some(BundleType::Deb) => "deb",
        Some(BundleType::Rpm) => "rpm",
        Some(BundleType::Nsis) => "nsis",
        Some(BundleType::Msi) => "msi",
        Some(BundleType::App) | Some(BundleType::Dmg) => "macos",
        None => "dev",
    }
}

fn can_update(kind: &str) -> bool {
    match kind {
        "appimage" | "deb" | "rpm" | "nsis" | "msi" => true,
        "portable" => cfg!(windows),
        _ => false,
    }
}

fn location() -> String {
    if let Ok(p) = std::env::var("APPIMAGE") {
        if !p.is_empty() {
            return p;
        }
    }
    std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default()
}

fn update_dir(st: &AppState) -> PathBuf {
    st.data_dir.join("update")
}

/// `ADBGUI_UPDATE_ENDPOINT` troca o endereço do latest.json (teste local). A assinatura
/// continua obrigatória: o endereço não muda o que pode ser instalado.
fn endpoint() -> String {
    std::env::var("ADBGUI_UPDATE_ENDPOINT").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| ENDPOINT.to_string())
}

fn client(timeout: Option<Duration>) -> Result<reqwest::Client, String> {
    let mut b = reqwest::Client::builder().user_agent(format!("ADB-GUI-Manager/{}", env!("CARGO_PKG_VERSION")));
    if let Some(t) = timeout {
        b = b.timeout(t);
    }
    b.connect_timeout(Duration::from_secs(15)).build().map_err(|e| e.to_string())
}

fn updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let mut b = app.updater_builder();
    if cfg!(feature = "portable") {
        b = b.target(format!("{}-portable", tauri_plugin_updater::target().unwrap_or_default()));
    }
    b.build().map_err(|e| format!("UPDATE_UNSUPPORTED: {}", e))
}

fn open_sessions(st: &AppState) -> usize {
    st.streams.lock().map(|m| m.len()).unwrap_or(0) + st.ptys.lock().map(|m| m.len()).unwrap_or(0)
}

fn file_name(u: &Update) -> String {
    let last = u.download_url.path_segments().and_then(|mut s| s.next_back()).unwrap_or("pacote");
    let clean: String = last.chars().map(|c| if c.is_ascii_alphanumeric() || ".-_".contains(c) { c } else { '_' }).collect();
    format!("{}-{}", u.version, clean)
}

/// Arquivo já baixado e com a assinatura certa para esta versão.
fn verified_file(st: &AppState, u: &Update) -> Option<PathBuf> {
    let f = update_dir(st).join(file_name(u));
    let bytes = std::fs::read(&f).ok()?;
    if u.verify(&bytes).is_ok() {
        Some(f)
    } else {
        let _ = std::fs::remove_file(&f);
        None
    }
}

/// Ao abrir: diz se a última instalação terminou. Na versão nova, limpa os arquivos baixados.
pub fn info(app: &AppHandle, st: &AppState) -> UpdateInfo {
    let kind = package_kind();
    let version = app.package_info().version.to_string();
    let dir = update_dir(st);
    let marker = dir.join(PENDING_FILE);
    let mut last_install = None;
    if let Ok(text) = std::fs::read_to_string(&marker) {
        if let Ok(p) = serde_json::from_str::<Pending>(&text) {
            if p.to == version {
                last_install = Some(LastInstall { result: "updated".into(), from: p.from, to: p.to, notes: p.notes });
                let _ = std::fs::remove_dir_all(&dir);
            } else {
                // Instalação não terminou: o arquivo continua para "Instalar de novo".
                if let Ok(u) = updater(app).and_then(|up| up.restore_update(p.raw.clone()).map_err(|e| e.to_string())) {
                    if let Some(u) = u {
                        if let Ok(mut c) = app.state::<UpdateState>().current.lock() {
                            *c = Some(u);
                        }
                    }
                }
                last_install = Some(LastInstall { result: "notFinished".into(), from: p.from, to: p.to, notes: p.notes });
                let _ = std::fs::remove_file(&marker);
            }
        } else {
            let _ = std::fs::remove_file(&marker);
        }
    }
    cleanup_portable_leftover();
    UpdateInfo { version, package: kind.into(), location: location(), can_update: can_update(kind), last_install }
}

pub async fn check(app: &AppHandle, st: &AppState) -> Result<CheckResult, String> {
    let current = app.package_info().version.to_string();
    let kind = package_kind();
    if !can_update(kind) {
        return Err(format!("UPDATE_UNSUPPORTED: {}", kind));
    }
    let resp = client(Some(Duration::from_secs(20)))?
        .get(endpoint())
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("UPDATE_NETWORK: {}", e))?;
    let none = |current: String, st: &AppState| CheckResult {
        available: false,
        current,
        version: None,
        notes: None,
        date: None,
        size: None,
        downloaded: false,
        open_sessions: open_sessions(st),
    };
    // Release sem latest.json (as anteriores à 0.3.0): não há o que instalar.
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(none(current, st));
    }
    if !resp.status().is_success() {
        return Err(format!("UPDATE_NETWORK: HTTP {}", resp.status()));
    }
    let body = resp.bytes().await.map_err(|e| format!("UPDATE_NETWORK: {}", e))?;
    let raw: serde_json::Value = serde_json::from_slice(&body).map_err(|e| format!("UPDATE_MANIFEST: {}", e))?;
    let up = updater(app)?;
    let found = up.restore_update(raw.clone()).map_err(|e| match e {
        tauri_plugin_updater::Error::TargetNotFound(t) => format!("UPDATE_NO_PACKAGE: {}", t),
        tauri_plugin_updater::Error::TargetsNotFound(t) => format!("UPDATE_NO_PACKAGE: {}", t.join(", ")),
        e => format!("UPDATE_MANIFEST: {}", e),
    })?;
    let Some(u) = found else {
        if let Ok(mut c) = app.state::<UpdateState>().current.lock() {
            *c = None;
        }
        return Ok(none(current, st));
    };
    let downloaded = verified_file(st, &u).is_some();
    let size = if downloaded {
        None
    } else {
        match client(Some(Duration::from_secs(8)))?.head(u.download_url.clone()).send().await {
            // Num HEAD o content_length() do reqwest vem 0: lê o cabeçalho.
            Ok(r) if r.status().is_success() => r
                .headers()
                .get(reqwest::header::CONTENT_LENGTH)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
                .filter(|&n| n > 0),
            _ => None,
        }
    };
    let date = raw.get("pub_date").and_then(|v| v.as_str()).map(String::from);
    let result = CheckResult {
        available: true,
        current,
        version: Some(u.version.clone()),
        notes: u.body.clone(),
        date,
        size,
        downloaded,
        open_sessions: open_sessions(st),
    };
    if let Ok(mut c) = app.state::<UpdateState>().current.lock() {
        *c = Some(u);
    }
    Ok(result)
}

fn current_update(app: &AppHandle) -> Result<Update, String> {
    app.state::<UpdateState>()
        .current
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "UPDATE_NONE: busque atualizações de novo".to_string())
}

/// Baixa para a pasta de dados (update/), retomando um .part de uma tentativa anterior.
pub async fn download(app: &AppHandle, st: &AppState) -> Result<(), String> {
    let us = app.state::<UpdateState>();
    if us.busy.swap(true, Ordering::SeqCst) {
        return Err("UPDATE_BUSY".into());
    }
    us.cancel.store(false, Ordering::SeqCst);
    let r = download_inner(app, st, &us).await;
    us.busy.store(false, Ordering::SeqCst);
    r
}

async fn download_inner(app: &AppHandle, st: &AppState, us: &UpdateState) -> Result<(), String> {
    let u = current_update(app)?;
    if verified_file(st, &u).is_some() {
        return Ok(());
    }
    let dir = update_dir(st);
    std::fs::create_dir_all(&dir).map_err(|e| format!("UPDATE_PERMISSION: {}", e))?;
    let file = dir.join(file_name(&u));
    let part = dir.join(format!("{}.part", file_name(&u)));
    let have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    let mut req = client(None)?.get(u.download_url.clone()).header("Accept", "application/octet-stream");
    if have > 0 {
        req = req.header("Range", format!("bytes={}-", have));
    }
    let resp = req.send().await.map_err(|e| format!("UPDATE_INTERRUPTED: {}", e))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("UPDATE_NETWORK: HTTP {}", status));
    }
    let resumed = status == reqwest::StatusCode::PARTIAL_CONTENT;
    let start = if resumed { have } else { 0 };
    let total = resp.content_length().map(|n| n + start);
    let mut out = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(resumed)
        .truncate(!resumed)
        .open(&part)
        .map_err(|e| format!("UPDATE_PERMISSION: {}", e))?;
    let mut received = start;
    let started = Instant::now();
    let mut last = Instant::now() - Duration::from_secs(1);
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if us.cancel.load(Ordering::SeqCst) {
            drop(out);
            let _ = std::fs::remove_file(&part);
            return Err("UPDATE_CANCELED".into());
        }
        let chunk = chunk.map_err(|e| format!("UPDATE_INTERRUPTED: {}", e))?;
        out.write_all(&chunk).map_err(|e| format!("UPDATE_PERMISSION: {}", e))?;
        received += chunk.len() as u64;
        if last.elapsed() >= Duration::from_millis(150) {
            last = Instant::now();
            let secs = started.elapsed().as_secs_f64().max(0.001);
            let bps = ((received - start) as f64 / secs) as u64;
            let _ = app.emit("update-progress", Progress { received, total, bytes_per_sec: bps });
        }
    }
    out.flush().map_err(|e| format!("UPDATE_PERMISSION: {}", e))?;
    drop(out);
    let _ = app.emit("update-progress", Progress { received, total, bytes_per_sec: 0 });
    let bytes = std::fs::read(&part).map_err(|e| e.to_string())?;
    if let Err(e) = u.verify(&bytes) {
        let _ = std::fs::remove_file(&part);
        return Err(format!("UPDATE_SIGNATURE: {}", e));
    }
    std::fs::rename(&part, &file).map_err(|e| format!("UPDATE_PERMISSION: {}", e))?;
    Ok(())
}

pub fn cancel(app: &AppHandle) {
    app.state::<UpdateState>().cancel.store(true, Ordering::SeqCst);
}

/// Instala o que foi baixado e reabre o app. Só volta (com erro) se algo falhar antes de sair.
pub async fn install(app: &AppHandle, st: Arc<AppState>) -> Result<(), String> {
    let u = current_update(app)?;
    let file = verified_file(&st, &u).ok_or_else(|| "UPDATE_NOT_DOWNLOADED".to_string())?;
    let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
    let pending = Pending {
        from: u.current_version.clone(),
        to: u.version.clone(),
        file: file.clone(),
        notes: u.body.clone(),
        raw: u.raw_json.clone(),
    };
    let marker = update_dir(&st).join(PENDING_FILE);
    std::fs::write(&marker, serde_json::to_vec(&pending).unwrap_or_default()).map_err(|e| format!("UPDATE_PERMISSION: {}", e))?;
    let tracker_was_paused = st.tracker_paused.load(Ordering::SeqCst);
    let app2 = app.clone();
    let st2 = st.clone();
    let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
        close_sessions(&st2);
        if package_kind() == "portable" {
            let exe = install_portable(&u, &bytes)?;
            let _ = std::process::Command::new(exe).args(std::env::args_os().skip(1)).spawn();
            app2.exit(0);
            return Ok(());
        }
        // Windows: o plugin abre o instalador (/S /UPDATE /R) e encerra o app; o instalador reabre.
        u.install(&bytes).map_err(install_error)?;
        #[cfg(target_os = "linux")]
        if package_kind() == "appimage" {
            relaunch_appimage();
        }
        app2.restart();
    })
    .await
    .map_err(|e| e.to_string())?;
    if result.is_err() {
        let _ = std::fs::remove_file(&marker);
        // Nada foi trocado: a lista de aparelhos volta a andar.
        if !tracker_was_paused {
            st.tracker_paused.store(false, Ordering::SeqCst);
            st.tracker_notify.notify_waiters();
        }
    }
    result
}

fn install_error(e: tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error as E;
    match e {
        E::Io(ref io) if io.kind() == std::io::ErrorKind::PermissionDenied => format!("UPDATE_PERMISSION: {}", e),
        E::TempDirNotFound | E::TempDirNotOnSameMountPoint => format!("UPDATE_PERMISSION: {}", e),
        E::AuthenticationFailed | E::PackageInstallFailed | E::DebInstallFailed => format!("UPDATE_AUTH: {}", e),
        E::Minisign(_) | E::SignedVersionMismatch { .. } | E::MissingSignedVersion | E::Base64(_) | E::SignatureUtf8(_) => {
            format!("UPDATE_SIGNATURE: {}", e)
        }
        e => format!("UPDATE_INSTALL: {}", e),
    }
}

/// AppImage: abre o arquivo novo sem herdar os descritores do runtime antigo. O
/// `app.restart()` herda o pipe que o runtime usa para saber se o app ainda roda, e o
/// processo da versão antiga (com a montagem dela) ficava parado até a nova fechar.
#[cfg(target_os = "linux")]
fn relaunch_appimage() {
    use std::os::unix::process::CommandExt;
    let Some(path) = std::env::var_os("APPIMAGE").filter(|p| !p.is_empty()) else {
        return;
    };
    let mut cmd = std::process::Command::new(path);
    cmd.args(std::env::args_os().skip(1));
    // SAFETY: só chamadas async-signal-safe (close) entre o fork e o exec.
    unsafe {
        cmd.pre_exec(|| {
            for fd in 3..1024 {
                libc::close(fd);
            }
            Ok(())
        });
    }
    if cmd.spawn().is_ok() {
        // Sem destrutores nem RunEvent::Exit, como o restart (não derruba o servidor do adb).
        std::process::exit(0);
    }
}

/// Encerra shell, logcat, gravações e o `adb track-devices` antes de trocar o app. O reinício
/// sai sem rodar os destrutores, então filho que sobrar fica órfão (e, no AppImage, segura a
/// montagem da versão antiga).
fn close_sessions(st: &AppState) {
    st.tracker_paused.store(true, Ordering::SeqCst);
    st.tracker_notify.notify_waiters();
    crate::pty::close_all(st);
    let ids: Vec<u64> = st.streams.lock().map(|m| m.keys().copied().collect()).unwrap_or_default();
    for id in ids {
        crate::stream::stop(st, id);
    }
    let until = Instant::now() + Duration::from_secs(2);
    while Instant::now() < until
        && (st.tracker_live.load(Ordering::SeqCst) || st.streams.lock().map(|m| !m.is_empty()).unwrap_or(false))
    {
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Portátil: tira o .exe do zip assinado e troca o atual. O Windows deixa renomear o .exe
/// em uso; o antigo fica como .old e é apagado na próxima abertura.
fn install_portable(u: &Update, bytes: &[u8]) -> Result<PathBuf, String> {
    u.verify(bytes).map_err(|e| format!("UPDATE_SIGNATURE: {}", e))?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("UPDATE_INSTALL: pasta do app")?.to_path_buf();
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| format!("UPDATE_INSTALL: {}", e))?;
    let idx = (0..zip.len())
        .find(|&i| zip.by_index(i).map(|f| f.name().to_ascii_lowercase().ends_with(".exe")).unwrap_or(false))
        .ok_or("UPDATE_INSTALL: o pacote não tem o .exe")?;
    let new_path = sibling(&exe, "new");
    {
        let mut entry = zip.by_index(idx).map_err(|e| format!("UPDATE_INSTALL: {}", e))?;
        let mut f = std::fs::File::create(&new_path).map_err(|e| format!("UPDATE_PERMISSION: {} ({})", e, dir.display()))?;
        std::io::copy(&mut entry, &mut f).map_err(|e| format!("UPDATE_PERMISSION: {}", e))?;
    }
    let old_path = sibling(&exe, "old");
    let _ = std::fs::remove_file(&old_path);
    std::fs::rename(&exe, &old_path).map_err(|e| {
        let _ = std::fs::remove_file(&new_path);
        format!("UPDATE_PERMISSION: {}", e)
    })?;
    if let Err(e) = std::fs::rename(&new_path, &exe) {
        let _ = std::fs::rename(&old_path, &exe);
        let _ = std::fs::remove_file(&new_path);
        return Err(format!("UPDATE_PERMISSION: {}", e));
    }
    Ok(exe)
}

fn sibling(exe: &Path, ext: &str) -> PathBuf {
    let mut s = exe.as_os_str().to_os_string();
    s.push(format!(".{}", ext));
    PathBuf::from(s)
}

fn cleanup_portable_leftover() {
    if !cfg!(feature = "portable") {
        return;
    }
    if let Ok(exe) = std::env::current_exe() {
        // O processo antigo pode levar um instante para sair.
        std::thread::spawn(move || {
            for _ in 0..20 {
                let old = sibling(&exe, "old");
                if !old.exists() || std::fs::remove_file(&old).is_ok() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::sibling;
    use std::path::Path;

    #[test]
    fn sibling_appends_extension() {
        assert_eq!(sibling(Path::new("/a/app.exe"), "old"), Path::new("/a/app.exe.old"));
    }
}
