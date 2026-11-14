// Sem janela de console no Windows em release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    appimage_gstreamer();
    adb_gui_manager_lib::run()
}

/// No AppImage, a libgstreamer vai junto com o WebKitGTK, mas os plugins não. Ela procura os
/// plugins ao lado dela (dentro do AppImage), não acha nenhum decodificador e o espelhamento
/// diz que o computador não decodifica H.264, mesmo com o gstreamer1.0-libav instalado.
/// Aponta para os plugins do sistema antes de qualquer thread e do WebKit subir.
#[cfg(target_os = "linux")]
fn appimage_gstreamer() {
    use std::path::Path;
    if std::env::var_os("APPIMAGE").is_none() || std::env::var_os("GST_PLUGIN_SYSTEM_PATH_1_0").is_some() {
        return;
    }
    let roots = ["/usr/lib/x86_64-linux-gnu", "/usr/lib64", "/usr/lib", "/usr/lib/aarch64-linux-gnu"];
    let dirs: Vec<String> = roots
        .iter()
        .map(|r| format!("{r}/gstreamer-1.0"))
        .filter(|d| Path::new(d).is_dir())
        .collect();
    if dirs.is_empty() {
        return;
    }
    std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", dirs.join(":"));
    let scanners = roots.iter().flat_map(|r| {
        [
            format!("{r}/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner"),
            format!("{r}/gstreamer-1.0/gst-plugin-scanner"),
        ]
    });
    if let Some(s) = scanners.into_iter().find(|s| Path::new(s).is_file()) {
        std::env::set_var("GST_PLUGIN_SCANNER_1_0", s);
    }
}
