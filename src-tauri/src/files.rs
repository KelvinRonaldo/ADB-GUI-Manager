//! Lado do computador na tela de arquivos.

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub modified: Option<u64>,
}

pub fn list(path: &str) -> Result<Vec<LocalEntry>, String> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(path).map_err(|e| e.to_string())? {
        let Ok(e) = e else { continue };
        let name = e.file_name().to_string_lossy().to_string();
        let md = e.metadata().ok();
        let is_dir = md.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        out.push(LocalEntry {
            path: e.path().to_string_lossy().to_string(),
            name,
            is_dir,
            size: md.as_ref().filter(|m| m.is_file()).map(|m| m.len()),
            modified: md
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64),
        });
    }
    // Pastas primeiro; dentro de cada grupo, os itens ocultos (.algo) vão para o fim.
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.starts_with('.').cmp(&b.name.starts_with('.')))
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

pub fn parent(path: &str) -> Option<String> {
    Path::new(path).parent().map(|p| p.to_string_lossy().to_string())
}

pub fn roots() -> Vec<String> {
    if cfg!(windows) {
        (b'A'..=b'Z')
            .map(|c| format!("{}:\\", c as char))
            .filter(|d| Path::new(d).exists())
            .collect()
    } else {
        vec!["/".into()]
    }
}
