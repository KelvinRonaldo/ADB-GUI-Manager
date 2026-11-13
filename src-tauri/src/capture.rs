//! Captura de tela com prévia: o PNG do `adb exec-out screencap -p` vai para uma pasta
//! temporária do app (captures/), a interface mostra, e a pessoa copia e/ou salva.
//! Fechar a prévia apaga o arquivo.

use crate::state::AppState;
use base64::Engine;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureInfo {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub size: u64,
}

fn dir(st: &AppState) -> PathBuf {
    st.data_dir.join("captures")
}

/// Caminho temporário para a próxima captura (a pasta é limpa ao abrir o app).
pub fn temp_path(st: &AppState, name: &str) -> Result<String, String> {
    let d = dir(st);
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let clean: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || "-_.".contains(c) { c } else { '_' }).collect();
    Ok(d.join(clean).display().to_string())
}

/// Só aceita arquivos da pasta de capturas: os comandos abaixo apagam e copiam.
fn inside(st: &AppState, path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path).canonicalize().map_err(|e| e.to_string())?;
    let d = dir(st).canonicalize().map_err(|e| e.to_string())?;
    if p.starts_with(&d) {
        Ok(p)
    } else {
        Err("CAPTURE_PATH: fora da pasta de capturas".into())
    }
}

/// Largura e altura do cabeçalho IHDR do PNG.
pub fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    const SIG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    if bytes.len() < 24 || bytes[..8] != SIG || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let w = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let h = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    Some((w, h))
}

pub fn read(st: &AppState, path: &str) -> Result<CaptureInfo, String> {
    let p = inside(st, path)?;
    let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
    let (width, height) = png_size(&bytes).ok_or("CAPTURE_NOT_PNG: o aparelho não devolveu uma imagem PNG")?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(CaptureInfo { data_url: format!("data:image/png;base64,{}", b64), width, height, size: bytes.len() as u64 })
}

pub fn copy(app: &AppHandle, st: &AppState, path: &str) -> Result<(), String> {
    let p = inside(st, path)?;
    let img = tauri::image::Image::from_path(&p).map_err(|e| e.to_string())?;
    app.clipboard().write_image(&img).map_err(|e| format!("CLIPBOARD: {}", e))
}

pub fn save(st: &AppState, path: &str, dest: &str) -> Result<(), String> {
    let p = inside(st, path)?;
    std::fs::copy(&p, dest).map(|_| ()).map_err(|e| e.to_string())
}

pub fn discard(st: &AppState, path: &str) {
    if let Ok(p) = inside(st, path) {
        let _ = std::fs::remove_file(p);
    }
}

/// Sobras de uma execução anterior (app fechado com a prévia aberta).
pub fn cleanup(st: &AppState) {
    let _ = std::fs::remove_dir_all(dir(st));
}

#[cfg(test)]
mod tests {
    use super::png_size;

    #[test]
    fn reads_png_dimensions() {
        let mut b = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
        b.extend_from_slice(b"IHDR");
        b.extend_from_slice(&720u32.to_be_bytes());
        b.extend_from_slice(&1280u32.to_be_bytes());
        assert_eq!(png_size(&b), Some((720, 1280)));
        assert_eq!(png_size(b"not a png at all, really"), None);
    }
}
