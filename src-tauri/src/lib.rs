mod commands;
mod download;
mod files;
mod locate;
mod parse;
mod pty;
mod runner;
mod settings;
mod state;
mod stream;
mod tracker;

use state::AppState;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex, RwLock};
use tauri::Manager;
use tokio::sync::Notify;

/// `--adb <caminho>` ou `--adb=<caminho>`: vale só nesta execução.
fn cli_adb() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    let mut it = args.iter().skip(1);
    while let Some(a) = it.next() {
        if a == "--adb" {
            return it.next().cloned();
        }
        if let Some(p) = a.strip_prefix("--adb=") {
            return Some(p.to_string());
        }
    }
    None
}

/// Pasta de dados da versão portátil, ao lado do executável.
#[cfg(feature = "portable")]
fn portable_base() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let base = exe.parent()?.join("adb-gui-manager-data");
    std::fs::create_dir_all(&base).ok()?;
    Some(base)
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(feature = "portable")]
            let portable = portable_base();
            #[cfg(not(feature = "portable"))]
            let portable: Option<std::path::PathBuf> = None;
            // Portátil numa pasta somente leitura: cai para o perfil do usuário em vez de não abrir.
            let (config_dir, data_dir) = match &portable {
                Some(base) => (base.join("config"), base.join("data")),
                None => (app.path().app_config_dir()?, app.path().app_data_dir()?),
            };
            let settings_path = config_dir.join("settings.json");
            let history_path = data_dir.join("history.json");
            let settings = settings::load(&settings_path);
            let history: VecDeque<_> = settings::load_history(&history_path).into_iter().collect();
            // Os ids continuam depois do histórico, para uma entrada nova não ocupar o lugar de uma antiga.
            let first_id = history.iter().map(|e| e.id).max().unwrap_or(0) + 1;
            let cli = cli_adb();
            let downloaded = data_dir.join("platform-tools").join(locate::ADB_EXE);
            let found = locate::locate(cli.as_deref(), &settings.adb_mode, &settings.adb_path, &downloaded);
            let state = Arc::new(AppState {
                adb: RwLock::new(found.info),
                checked: Mutex::new(found.checked),
                settings: RwLock::new(settings),
                settings_path,
                history_path,
                data_dir,
                history: Mutex::new(history),
                next_id: AtomicU64::new(first_id),
                streams: Mutex::new(HashMap::new()),
                ptys: Mutex::new(HashMap::new()),
                pty_closing: Mutex::new(HashSet::new()),
                tracker_paused: AtomicBool::new(false),
                tracker_notify: Notify::new(),
                cli_adb: cli,
                devices: Mutex::new(Vec::new()),
            });
            // Sem "iniciar o servidor ao abrir" e com o servidor parado, não sobe sozinho.
            if !state.settings().start_server_on_launch && !tracker::server_running(&state) {
                state.tracker_paused.store(true, std::sync::atomic::Ordering::SeqCst);
            }
            tracker::spawn(app.handle().clone(), state.clone());
            app.manage(state);
            #[cfg(feature = "portable")]
            create_portable_window(app, portable.as_deref())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_init,
            commands::adb_validate,
            commands::adb_use,
            commands::settings_save,
            commands::adb_run,
            commands::adb_run_to_file,
            commands::stream_start,
            commands::stream_stop,
            commands::pty_open,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_close,
            commands::device_summary,
            commands::mdns_services,
            commands::remote_list,
            commands::packages_list,
            commands::local_list,
            commands::local_parent,
            commands::local_roots,
            commands::write_text_file,
            commands::platform_tools_download,
            commands::server_status,
            commands::server_start,
            commands::server_stop,
            commands::history_clear,
            commands::devices_current,
            commands::device_wifi_ip,
        ])
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o ADB GUI Manager");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(st) = handle.try_state::<Arc<AppState>>() {
                pty::close_all(&st);
                if st.settings().stop_server_on_exit {
                    if let Ok(path) = st.adb_path() {
                        let mut args = st.settings().server_args();
                        args.push("kill-server".into());
                        let mut c = std::process::Command::new(path);
                        c.args(args);
                        #[cfg(windows)]
                        {
                            use std::os::windows::process::CommandExt;
                            c.creation_flags(0x0800_0000);
                        }
                        let _ = c.output();
                    }
                }
            }
        }
    });
}

/// A versão portátil cria a janela aqui (o tauri.portable.conf.json põe `create: false`),
/// para o perfil do WebView2 (cache, armazenamento local) ficar na pasta portátil também.
#[cfg(feature = "portable")]
fn create_portable_window(app: &tauri::App, base: Option<&std::path::Path>) -> tauri::Result<()> {
    let Some(config) = app.config().app.windows.first().cloned() else {
        return Ok(());
    };
    if app.get_webview_window(&config.label).is_some() {
        return Ok(());
    }
    let mut builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?;
    if let Some(base) = base {
        builder = builder.data_directory(base.join("webview"));
    }
    builder.build()?;
    Ok(())
}
