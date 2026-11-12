//! Onde está o adb: argumento `--adb`, escolha salva, cópia baixada, PATH, ANDROID_HOME,
//! ANDROID_SDK_ROOT e as pastas padrão do SDK. Cada lugar olhado volta para a tela de
//! primeira execução, encontrado ou não.

use crate::parse::{parse_version, AdbVersion};
use serde::Serialize;
use std::path::{Path, PathBuf};

pub const ADB_EXE: &str = if cfg!(windows) { "adb.exe" } else { "adb" };

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub source: String,
    pub path: String,
    pub found: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdbInfo {
    pub path: String,
    pub source: String,
    pub version: AdbVersion,
}

fn sdk_platform_tools(root: &str) -> PathBuf {
    Path::new(root).join("platform-tools").join(ADB_EXE)
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// Lugares onde procurar, em ordem, sem contar o argumento e a escolha salva.
pub fn auto_candidates(downloaded: &Path) -> Vec<(String, PathBuf)> {
    let mut v: Vec<(String, PathBuf)> = Vec::new();
    v.push(("downloaded".into(), downloaded.to_path_buf()));
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let p = dir.join(ADB_EXE);
            if p.is_file() {
                v.push(("path".into(), p));
                break;
            }
        }
        if !v.iter().any(|(s, _)| s == "path") {
            v.push(("path".into(), PathBuf::from(ADB_EXE)));
        }
    }
    for var in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        match std::env::var(var) {
            Ok(root) if !root.trim().is_empty() => v.push((var.to_string(), sdk_platform_tools(&root))),
            _ => v.push((var.to_string(), PathBuf::from(format!("${}/platform-tools/{}", var, ADB_EXE)))),
        }
    }
    if cfg!(windows) {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            v.push(("sdkDefault".into(), sdk_platform_tools(&format!("{}\\Android\\Sdk", local))));
        }
    } else if let Some(home) = home_dir() {
        let home = home.to_string_lossy().to_string();
        v.push(("sdkDefault".into(), sdk_platform_tools(&format!("{}/Android/Sdk", home))));
        if cfg!(target_os = "macos") {
            v.push(("sdkDefault".into(), sdk_platform_tools(&format!("{}/Library/Android/sdk", home))));
        }
    }
    v
}

/// Roda `adb version` no caminho e devolve a versão, ou o motivo de não servir.
pub fn validate(path: &str) -> Result<AdbVersion, String> {
    let p = Path::new(path);
    if path.trim().is_empty() {
        return Err("empty".into());
    }
    if p.is_dir() {
        return Err("isDirectory".into());
    }
    if !p.exists() {
        return Err("notFound".into());
    }
    let mut cmd = std::process::Command::new(p);
    cmd.arg("version");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().map_err(|e| format!("notExecutable: {}", e))?;
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    parse_version(&text).ok_or_else(|| "notAdb".into())
}

pub struct LocateResult {
    pub info: Option<AdbInfo>,
    pub checked: Vec<Candidate>,
}

pub fn locate(cli: Option<&str>, mode: &str, custom: &str, downloaded: &Path) -> LocateResult {
    let mut checked = Vec::new();
    let try_one = |source: &str, path: &Path, checked: &mut Vec<Candidate>| -> Option<AdbInfo> {
        let s = path.to_string_lossy().to_string();
        let ok = path.is_file().then(|| validate(&s).ok()).flatten();
        checked.push(Candidate { source: source.into(), path: s.clone(), found: ok.is_some() });
        ok.map(|version| AdbInfo { path: s, source: source.into(), version })
    };
    if let Some(c) = cli {
        if let Some(i) = try_one("cli", Path::new(c), &mut checked) {
            return LocateResult { info: Some(i), checked };
        }
    }
    if mode == "custom" && !custom.trim().is_empty() {
        if let Some(i) = try_one("custom", Path::new(custom), &mut checked) {
            return LocateResult { info: Some(i), checked };
        }
    }
    let mut cands = auto_candidates(downloaded);
    if mode != "downloaded" {
        // A cópia baixada só vem primeiro quando foi escolhida; senão fica por último.
        let d = cands.remove(0);
        cands.push(d);
    }
    for (source, path) in cands {
        if let Some(i) = try_one(&source, &path, &mut checked) {
            return LocateResult { info: Some(i), checked };
        }
    }
    LocateResult { info: None, checked }
}
