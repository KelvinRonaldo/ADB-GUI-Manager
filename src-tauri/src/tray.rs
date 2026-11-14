//! Ícone na bandeja do sistema e a opção "Ao fechar a janela: manter na bandeja".
//!
//! Menu: nome do app, Mostrar janela, o alvo atual (só leitura) e Sair. Os textos vêm da
//! interface (`tray_update`), para seguirem o idioma escolhido. Clique no ícone abre a janela.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

/// A bandeja só esconde a janela se o ícone existir; sem ele o app ficaria inacessível.
pub static TRAY_OK: AtomicBool = AtomicBool::new(false);

pub struct TrayItems<R: Runtime> {
    show: MenuItem<R>,
    target: MenuItem<R>,
    quit: MenuItem<R>,
}

pub struct TrayState<R: Runtime>(pub Mutex<Option<TrayItems<R>>>);

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<TrayItems<R>> {
    let title = MenuItem::with_id(app, "title", "ADB GUI Manager", false, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Mostrar janela", true, None::<&str>)?;
    let target = MenuItem::with_id(app, "target", "Sem alvo", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &title,
            &PredefinedMenuItem::separator(app)?,
            &show,
            &target,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("ADB GUI Manager")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(TrayItems { show, target, quit })
}

/// Cria o ícone. No Linux sem a biblioteca do AppIndicator o tray-icon entra em pânico ao
/// carregá-la; aqui isso só desliga a bandeja, o app abre normalmente.
pub fn init<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    let built = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| build(&handle)));
    let items = match built {
        Ok(Ok(items)) => {
            TRAY_OK.store(true, Ordering::SeqCst);
            Some(items)
        }
        Ok(Err(e)) => {
            eprintln!("bandeja indisponível: {e}");
            None
        }
        Err(_) => {
            eprintln!("bandeja indisponível (AppIndicator ausente)");
            None
        }
    };
    app.manage(TrayState(Mutex::new(items)));
}

/// Textos do menu no idioma da interface e o alvo atual.
#[tauri::command]
pub fn tray_update(app: AppHandle, show: String, target: String, quit: String) -> Result<(), String> {
    let st = app.state::<TrayState<tauri::Wry>>();
    let guard = st.0.lock().map_err(|e| e.to_string())?;
    if let Some(items) = guard.as_ref() {
        items.show.set_text(show).map_err(|e| e.to_string())?;
        items.target.set_text(target).map_err(|e| e.to_string())?;
        items.quit.set_text(quit).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// A bandeja existe? A interface só oferece "Manter na bandeja" quando sim.
#[tauri::command]
pub fn tray_available() -> bool {
    TRAY_OK.load(Ordering::SeqCst)
}
