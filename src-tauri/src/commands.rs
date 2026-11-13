//! Comandos chamados pela interface (`invoke`).

use crate::locate::{self, AdbInfo, Candidate};
use crate::parse::{self, Battery, MdnsService, RemoteEntry, Storage};
use crate::runner::{self, RunOpts, RunResult};
use crate::settings::{self, LogEntry, Settings};
use crate::state::AppState;
use crate::{download, files, pty, stream, tracker, update};
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, State};

type St<'a> = State<'a, Arc<AppState>>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitInfo {
    pub adb: Option<AdbInfo>,
    pub checked: Vec<Candidate>,
    pub cli_adb: Option<String>,
    pub settings: Settings,
    pub history: Vec<LogEntry>,
    pub os: String,
    pub data_dir: String,
    pub downloaded_adb: String,
    pub downloaded_exists: bool,
    pub download_url: String,
    pub server_running: bool,
    pub home: String,
}

#[tauri::command]
pub fn app_init(st: St<'_>) -> InitInfo {
    let downloaded = st.downloaded_adb();
    InitInfo {
        adb: st.adb.read().ok().and_then(|a| a.clone()),
        checked: st.checked.lock().map(|c| c.clone()).unwrap_or_default(),
        cli_adb: st.cli_adb.clone(),
        settings: st.settings(),
        history: st.history.lock().map(|h| h.iter().cloned().collect()).unwrap_or_default(),
        os: std::env::consts::OS.to_string(),
        data_dir: st.data_dir.to_string_lossy().to_string(),
        downloaded_exists: downloaded.is_file(),
        downloaded_adb: downloaded.to_string_lossy().to_string(),
        download_url: download::url().to_string(),
        server_running: tracker::server_running(&st),
        home: locate::home_dir().map(|h| h.to_string_lossy().to_string()).unwrap_or_default(),
    }
}

#[tauri::command]
pub fn adb_validate(path: String) -> Result<parse::AdbVersion, String> {
    locate::validate(&path)
}

/// Troca o adb em uso: `mode` "auto", "custom" (com `path`) ou "downloaded".
#[tauri::command]
pub fn adb_use(st: St<'_>, mode: String, path: Option<String>, remember: Option<bool>) -> Result<AdbInfo, String> {
    let custom = path.unwrap_or_default();
    let result = locate::locate(None, &mode, &custom, &st.downloaded_adb());
    if let Ok(mut c) = st.checked.lock() {
        *c = result.checked.clone();
    }
    let info = result.info.ok_or_else(|| "NOT_FOUND".to_string())?;
    if mode == "custom" && info.source != "custom" {
        return Err(locate::validate(&custom).err().unwrap_or_else(|| "NOT_FOUND".into()));
    }
    // Sem "lembrar", vale só nesta execução, como o argumento --adb.
    if remember.unwrap_or(true) {
        let mut s = st.settings.write().map_err(|e| e.to_string())?;
        s.adb_mode = mode;
        s.adb_path = custom;
        settings::save(&st.settings_path, &s)?;
    }
    *st.adb.write().map_err(|e| e.to_string())? = Some(info.clone());
    st.tracker_notify.notify_waiters();
    Ok(info)
}

#[tauri::command]
pub fn settings_save(st: St<'_>, settings: Settings) -> Result<(), String> {
    let restart = {
        let old = st.settings();
        old.server_host != settings.server_host || old.server_port != settings.server_port || old.env != settings.env
    };
    settings::save(&st.settings_path, &settings)?;
    *st.settings.write().map_err(|e| e.to_string())? = settings;
    if restart {
        st.tracker_notify.notify_waiters();
    }
    Ok(())
}

#[tauri::command]
pub async fn adb_run(
    app: AppHandle,
    st: St<'_>,
    args: Vec<String>,
    serial: Option<String>,
    timeout_ms: Option<u64>,
    quiet: Option<bool>,
) -> Result<RunResult, String> {
    runner::run(&app, &st, args, RunOpts { serial, timeout_ms, quiet: quiet.unwrap_or(false) }).await
}

#[tauri::command]
pub async fn adb_run_to_file(app: AppHandle, st: St<'_>, args: Vec<String>, serial: Option<String>, path: String) -> Result<RunResult, String> {
    runner::run_to_file(&app, &st, args, serial, &path).await
}

/// Assíncrono de propósito: o processo é criado pelo tokio, que precisa do runtime
/// (um comando síncrono roda na thread principal, sem reactor, e derruba o app).
#[tauri::command]
pub async fn stream_start(app: AppHandle, st: St<'_>, args: Vec<String>, serial: Option<String>) -> Result<u64, String> {
    stream::start(app, st.inner().clone(), args, serial)
}

#[tauri::command]
pub fn stream_stop(st: St<'_>, id: u64) {
    stream::stop(&st, id)
}

#[tauri::command]
pub fn pty_open(app: AppHandle, st: St<'_>, args: Vec<String>, serial: Option<String>, cols: u16, rows: u16) -> Result<u64, String> {
    pty::open(app, st.inner().clone(), args, serial, cols, rows)
}

#[tauri::command]
pub fn pty_write(st: St<'_>, id: u64, data: String) -> Result<(), String> {
    pty::write(&st, id, &data)
}

#[tauri::command]
pub fn pty_resize(st: St<'_>, id: u64, cols: u16, rows: u16) -> Result<(), String> {
    pty::resize(&st, id, cols, rows)
}

#[tauri::command]
pub fn pty_close(st: St<'_>, id: u64) {
    pty::close(&st, id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub serial: String,
    pub props: BTreeMap<String, String>,
    pub battery: Battery,
    pub wifi_ip: Option<String>,
    pub storage: Option<Storage>,
    pub raw: String,
    pub result: RunResult,
}

/// Resumo do aparelho numa ida só: propriedades, bateria, IP do Wi-Fi e espaço em /data.
#[tauri::command]
pub async fn device_summary(app: AppHandle, st: St<'_>, serial: String, quiet: Option<bool>) -> Result<Summary, String> {
    let script = format!(
        "getprop; echo {s}; dumpsys battery; echo {s}; ip -f inet addr show; echo {s}; df /data",
        s = parse::SECTION
    );
    let r = runner::run(
        &app,
        &st,
        vec!["shell".into(), script],
        RunOpts { serial: Some(serial.clone()), timeout_ms: Some(20_000), quiet: quiet.unwrap_or(true) },
    )
    .await?;
    let parts = parse::split_sections(&r.stdout);
    let get = |i: usize| parts.get(i).map(String::as_str).unwrap_or("");
    let props = parse::parse_getprop(get(0));
    if props.is_empty() && r.code != 0 {
        return Err(runner::last_line(&r.stderr).unwrap_or_else(|| format!("exit {}", r.code)));
    }
    Ok(Summary {
        serial,
        battery: parse::parse_battery(get(1)),
        wifi_ip: parse::pick_wifi_ip(get(2)),
        storage: parse::parse_df(get(3)),
        props,
        raw: r.stdout.clone(),
        result: r,
    })
}

#[tauri::command]
pub async fn mdns_services(app: AppHandle, st: St<'_>, quiet: Option<bool>) -> Result<Vec<MdnsService>, String> {
    let r = runner::run(&app, &st, vec!["mdns".into(), "services".into()], RunOpts { serial: None, timeout_ms: Some(10_000), quiet: quiet.unwrap_or(true) }).await?;
    Ok(parse::parse_mdns(&r.stdout))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteList {
    pub entries: Vec<RemoteEntry>,
    pub result: RunResult,
}

#[tauri::command]
pub async fn remote_list(app: AppHandle, st: St<'_>, serial: String, path: String) -> Result<RemoteList, String> {
    let dir = if path.ends_with('/') { path } else { format!("{}/", path) };
    let r = runner::run(
        &app,
        &st,
        vec!["shell".into(), format!("ls -la {}", parse::sh_quote(&dir))],
        RunOpts { serial: Some(serial), timeout_ms: Some(20_000), quiet: false },
    )
    .await?;
    Ok(RemoteList { entries: parse::parse_ls(&r.stdout), result: r })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageList {
    pub packages: Vec<parse::Package>,
    pub result: RunResult,
}

#[tauri::command]
pub async fn packages_list(app: AppHandle, st: St<'_>, serial: String, filter: String) -> Result<PackageList, String> {
    let mut args = vec!["shell".to_string(), "pm".into(), "list".into(), "packages".into(), "-U".into(), "--show-versioncode".into()];
    match filter.as_str() {
        "user" => args.push("-3".into()),
        "system" => args.push("-s".into()),
        "disabled" => args.push("-d".into()),
        _ => {}
    }
    let r = runner::run(&app, &st, args, RunOpts { serial: Some(serial), timeout_ms: Some(30_000), quiet: false }).await?;
    Ok(PackageList { packages: parse::parse_packages(&r.stdout), result: r })
}

#[tauri::command]
pub fn local_list(path: String) -> Result<Vec<files::LocalEntry>, String> {
    files::list(&path)
}

#[tauri::command]
pub fn local_parent(path: String) -> Option<String> {
    files::parent(&path)
}

#[tauri::command]
pub fn local_roots() -> Vec<String> {
    files::roots()
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn platform_tools_download(app: AppHandle, st: St<'_>) -> Result<String, String> {
    download::download(&app, &st).await
}

#[tauri::command]
pub fn update_info(app: AppHandle, st: St<'_>) -> update::UpdateInfo {
    update::info(&app, &st)
}

#[tauri::command]
pub async fn update_check(app: AppHandle, st: St<'_>) -> Result<update::CheckResult, String> {
    update::check(&app, &st).await
}

#[tauri::command]
pub async fn update_download(app: AppHandle, st: St<'_>) -> Result<(), String> {
    update::download(&app, &st).await
}

#[tauri::command]
pub fn update_cancel(app: AppHandle) {
    update::cancel(&app);
}

#[tauri::command]
pub async fn update_install(app: AppHandle, st: St<'_>) -> Result<(), String> {
    update::install(&app, st.inner().clone()).await
}

#[tauri::command]
pub fn server_status(st: St<'_>) -> bool {
    tracker::server_running(&st)
}

#[tauri::command]
pub async fn server_start(app: AppHandle, st: St<'_>) -> Result<RunResult, String> {
    let r = runner::run(&app, &st, vec!["start-server".into()], RunOpts { serial: None, timeout_ms: Some(30_000), quiet: false }).await?;
    st.tracker_paused.store(false, Ordering::SeqCst);
    st.tracker_notify.notify_waiters();
    Ok(r)
}

#[tauri::command]
pub async fn server_stop(app: AppHandle, st: St<'_>) -> Result<RunResult, String> {
    st.tracker_paused.store(true, Ordering::SeqCst);
    st.tracker_notify.notify_waiters();
    runner::run(&app, &st, vec!["kill-server".into()], RunOpts { serial: None, timeout_ms: Some(30_000), quiet: false }).await
}

#[tauri::command]
pub fn history_clear(st: St<'_>) {
    if let Ok(mut h) = st.history.lock() {
        h.clear();
    }
    settings::save_history(&st.history_path, &[]);
}

#[tauri::command]
pub fn devices_current(st: St<'_>) -> Vec<parse::Device> {
    st.devices.lock().map(|d| d.clone()).unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiIp {
    pub ip: Option<String>,
    pub result: RunResult,
}

/// IP do aparelho na rede, para o `adb connect` depois do `tcpip`.
#[tauri::command]
pub async fn device_wifi_ip(app: AppHandle, st: St<'_>, serial: String) -> Result<WifiIp, String> {
    let r = runner::run(
        &app,
        &st,
        vec!["shell".into(), "ip -f inet addr show".into()],
        RunOpts { serial: Some(serial), timeout_ms: Some(15_000), quiet: false },
    )
    .await?;
    Ok(WifiIp { ip: parse::pick_wifi_ip(&r.stdout), result: r })
}

/// Injetor da tecla WAKEUP para aparelhos sem `input keyevent` (Gertec GPOS760).
/// Fonte e build em resources/wake/.
const WAKE_DEX: &[u8] = include_bytes!("../resources/wake/wake.dex");
const WAKE_DEX_REMOTE: &str = "/data/local/tmp/adbgui-wake.dex";
/// `w` diz se a tela está acesa de verdade: "Dreaming" (protetor de tela) e "Dozing" contam
/// como apagada, senão a captura sai com o protetor. Android antigo sem mWakefulness: mScreenOn.
const AWAKE_FN: &str = r#"w(){ P=$(dumpsys power); case "$P" in *mWakefulness=Awake*) return 0;; *mWakefulness=*) return 1;; *mScreenOn=true*) return 0;; esac; return 1; }"#;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WakeResult {
    /// "awake" (já estava acesa), "woke" (acendeu) ou "asleep" (não acendeu).
    pub state: String,
    pub method: Option<String>,
}

async fn shell_line(app: &AppHandle, st: &AppState, serial: &str, script: String, timeout_ms: u64) -> Result<RunResult, String> {
    runner::run(app, st, vec!["shell".into(), script], RunOpts { serial: Some(serial.to_string()), timeout_ms: Some(timeout_ms), quiet: false }).await
}

/// Acende a tela antes de capturar ou gravar, para a imagem não sair preta.
#[tauri::command]
pub async fn device_wake(app: AppHandle, st: St<'_>, serial: String) -> Result<WakeResult, String> {
    let first = shell_line(
        &app,
        &st,
        &serial,
        format!(
            "{f}; if w; then echo AWAKE; else input keyevent 224 >/dev/null 2>&1; sleep 1; if w; then echo WOKE; else echo ASLEEP; fi; fi",
            f = AWAKE_FN
        ),
        20_000,
    )
    .await?;
    if first.code != 0 && !first.stdout.contains("AWAKE") && !first.stdout.contains("WOKE") && !first.stdout.contains("ASLEEP") {
        return Err(runner::last_line(&first.stderr).unwrap_or_else(|| format!("exit {}", first.code)));
    }
    if first.stdout.contains("AWAKE") {
        return Ok(WakeResult { state: "awake".into(), method: None });
    }
    if first.stdout.contains("WOKE") {
        return Ok(WakeResult { state: "woke".into(), method: Some("input".into()) });
    }
    // Sem `input keyevent`: injeta a tecla pelo InputManager com o .dex embutido.
    let local = st.data_dir.join("adbgui-wake.dex");
    std::fs::create_dir_all(&st.data_dir).map_err(|e| e.to_string())?;
    std::fs::write(&local, WAKE_DEX).map_err(|e| e.to_string())?;
    let push = runner::run(
        &app,
        &st,
        vec!["push".into(), local.to_string_lossy().to_string(), WAKE_DEX_REMOTE.into()],
        RunOpts { serial: Some(serial.clone()), timeout_ms: Some(20_000), quiet: false },
    )
    .await?;
    if push.code != 0 {
        return Ok(WakeResult { state: "asleep".into(), method: None });
    }
    let second = shell_line(
        &app,
        &st,
        &serial,
        format!(
            "{f}; CLASSPATH={d} app_process / Wake 224 >/dev/null 2>&1; sleep 1; if w; then echo WOKE; else echo ASLEEP; fi",
            f = AWAKE_FN,
            d = WAKE_DEX_REMOTE
        ),
        20_000,
    )
    .await?;
    Ok(if second.stdout.contains("WOKE") {
        WakeResult { state: "woke".into(), method: Some("injector".into()) }
    } else {
        WakeResult { state: "asleep".into(), method: None }
    })
}
