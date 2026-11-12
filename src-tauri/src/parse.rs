//! Interpretação da saída de texto do adb. Tudo aqui é puro (sem processo nem IO),
//! para ser testado com saídas reais copiadas de aparelhos.

use serde::Serialize;
use std::collections::BTreeMap;

/// Chaves que o `adb devices -l` põe depois do estado. O estado pode ter espaços
/// ("no permissions (…)"), então ele vai até a primeira destas chaves.
const DEVICE_KEYS: [&str; 6] = ["usb", "product", "model", "device", "transport_id", "features"];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub serial: String,
    pub state: String,
    pub state_kind: String,
    pub connection: String,
    pub usb: Option<String>,
    pub product: Option<String>,
    pub model: Option<String>,
    pub device: Option<String>,
    pub transport_id: Option<String>,
}

fn is_device_key(token: &str) -> bool {
    match token.split_once(':') {
        Some((k, _)) => DEVICE_KEYS.contains(&k),
        None => false,
    }
}

pub fn state_kind(state: &str) -> &'static str {
    let s = state.trim();
    match s {
        "device" => "device",
        "offline" => "offline",
        "unauthorized" => "unauthorized",
        "authorizing" => "authorizing",
        "connecting" => "connecting",
        "bootloader" => "bootloader",
        "recovery" => "recovery",
        "sideload" | "rescue" => "sideload",
        "host" => "host",
        _ if s.starts_with("no permissions") => "noPermissions",
        _ => "unknown",
    }
}

pub fn connection_kind(serial: &str) -> &'static str {
    if serial.starts_with("emulator-") {
        "emulator"
    } else if serial.contains(':') || serial.contains("._adb-tls-connect.") {
        "wifi"
    } else {
        "usb"
    }
}

/// Uma linha de `adb devices -l` (ou de um bloco do `track-devices -l`).
pub fn parse_device_line(line: &str) -> Option<Device> {
    let line = line.trim_end();
    if line.trim().is_empty() || line.starts_with("List of devices") || line.starts_with('*') {
        return None;
    }
    let mut tokens = line.split_whitespace();
    let serial = tokens.next()?.to_string();
    let rest: Vec<&str> = tokens.collect();
    let split = rest.iter().position(|t| is_device_key(t)).unwrap_or(rest.len());
    let state = rest[..split].join(" ");
    if state.is_empty() {
        return None;
    }
    let mut d = Device {
        state_kind: state_kind(&state).to_string(),
        connection: connection_kind(&serial).to_string(),
        serial,
        state,
        usb: None,
        product: None,
        model: None,
        device: None,
        transport_id: None,
    };
    for t in &rest[split..] {
        if let Some((k, v)) = t.split_once(':') {
            let v = Some(v.to_string());
            match k {
                "usb" => d.usb = v,
                "product" => d.product = v,
                "model" => d.model = v,
                "device" => d.device = v,
                "transport_id" => d.transport_id = v,
                _ => {}
            }
        }
    }
    Some(d)
}

pub fn parse_devices(text: &str) -> Vec<Device> {
    text.lines().filter_map(parse_device_line).collect()
}

/// `track-devices` manda blocos: 4 dígitos hexadecimais com o tamanho e depois o texto.
/// Devolve os blocos completos e quanto do buffer foi consumido.
pub fn split_track_blocks(buf: &[u8]) -> (Vec<String>, usize) {
    let mut out = Vec::new();
    let mut pos = 0;
    while buf.len() >= pos + 4 {
        let hex = match std::str::from_utf8(&buf[pos..pos + 4]) {
            Ok(h) => h,
            Err(_) => break,
        };
        let len = match usize::from_str_radix(hex, 16) {
            Ok(l) => l,
            Err(_) => break,
        };
        if buf.len() < pos + 4 + len {
            break;
        }
        out.push(String::from_utf8_lossy(&buf[pos + 4..pos + 4 + len]).to_string());
        pos += 4 + len;
    }
    (out, pos)
}

/// `getprop`: linhas `[chave]: [valor]`.
pub fn parse_getprop(text: &str) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    for line in text.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix('[') else { continue };
        let Some((key, value)) = rest.split_once("]: [") else { continue };
        let value = value.strip_suffix(']').unwrap_or(value);
        map.insert(key.to_string(), value.to_string());
    }
    map
}

/// `dumpsys battery`: linhas `chave: valor`, com o primeiro nível de recuo.
pub fn parse_key_values(text: &str) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    for line in text.lines() {
        if let Some((k, v)) = line.split_once(':') {
            let k = k.trim();
            if !k.is_empty() && !k.contains("Battery Service state") {
                map.insert(k.to_string(), v.trim().to_string());
            }
        }
    }
    map
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Battery {
    pub level: Option<u32>,
    pub status: Option<String>,
    pub health: Option<String>,
    pub powered: Vec<String>,
    pub voltage_mv: Option<u32>,
    pub temperature_c: Option<f32>,
    pub technology: Option<String>,
}

pub fn parse_battery(text: &str) -> Battery {
    let kv = parse_key_values(text);
    let num = |k: &str| kv.get(k).and_then(|v| v.parse::<i64>().ok());
    let status = num("status").map(|s| {
        match s {
            2 => "charging",
            3 => "discharging",
            4 => "notCharging",
            5 => "full",
            _ => "unknown",
        }
        .to_string()
    });
    let health = num("health").map(|h| {
        match h {
            2 => "good",
            3 => "overheat",
            4 => "dead",
            5 => "overVoltage",
            6 => "failure",
            7 => "cold",
            _ => "unknown",
        }
        .to_string()
    });
    let mut powered = Vec::new();
    for (key, name) in [("AC powered", "ac"), ("USB powered", "usb"), ("Wireless powered", "wireless")] {
        if kv.get(key).map(|v| v == "true").unwrap_or(false) {
            powered.push(name.to_string());
        }
    }
    let level = match (num("level"), num("scale")) {
        (Some(l), Some(s)) if s > 0 && s != 100 => Some(((l * 100) / s) as u32),
        (Some(l), _) => Some(l as u32),
        _ => None,
    };
    Battery {
        level,
        status,
        health,
        powered,
        voltage_mv: num("voltage").map(|v| v as u32),
        temperature_c: num("temperature").map(|t| t as f32 / 10.0),
        technology: kv.get("technology").cloned(),
    }
}

/// Primeiro `inet a.b.c.d/nn` de `ip -f inet addr show <iface>`.
pub fn parse_inet(text: &str) -> Option<String> {
    for line in text.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("inet ") {
            let addr = rest.split_whitespace().next()?;
            return Some(addr.split('/').next()?.to_string());
        }
    }
    None
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Storage {
    pub total_kb: u64,
    pub used_kb: u64,
    pub avail_kb: u64,
}

/// Tamanho do `df` antigo (toolbox, Android 5/6): "5.1G", "625.3M", "512K", "0".
fn human_kb(s: &str) -> Option<u64> {
    let (num, mult) = match s.chars().last()? {
        'K' | 'k' => (&s[..s.len() - 1], 1.0),
        'M' | 'm' => (&s[..s.len() - 1], 1024.0),
        'G' | 'g' => (&s[..s.len() - 1], 1024.0 * 1024.0),
        'T' | 't' => (&s[..s.len() - 1], 1024.0 * 1024.0 * 1024.0),
        _ => (s, 1.0 / 1024.0),
    };
    num.parse::<f64>().ok().map(|v| (v * mult).round() as u64)
}

/// `df <caminho>`. Toybox: blocos de 1K (total, usado, livre). Toolbox antigo:
/// tamanhos com unidade (Size, Used, Free).
pub fn parse_df(text: &str) -> Option<Storage> {
    for line in text.lines().skip(1) {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() >= 4 {
            let n = |s: &str| s.parse::<u64>().ok();
            if let (Some(t), Some(u), Some(a)) = (n(f[1]), n(f[2]), n(f[3])) {
                return Some(Storage { total_kb: t, used_kb: u, avail_kb: a });
            }
            if let (Some(t), Some(u), Some(a)) = (human_kb(f[1]), human_kb(f[2]), human_kb(f[3])) {
                return Some(Storage { total_kb: t, used_kb: u, avail_kb: a });
            }
        }
    }
    None
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MdnsService {
    pub name: String,
    pub service: String,
    pub address: String,
}

pub fn parse_mdns(text: &str) -> Vec<MdnsService> {
    text.lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split(['\t', ' ']).filter(|s| !s.is_empty()).collect();
            if f.len() >= 3 && f[1].starts_with("_adb") {
                Some(MdnsService { name: f[0].into(), service: f[1].into(), address: f[2].into() })
            } else {
                None
            }
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEntry {
    pub name: String,
    pub perms: String,
    pub is_dir: bool,
    pub is_link: bool,
    pub link_target: Option<String>,
    pub size: Option<u64>,
    pub modified: String,
    pub owner: String,
    pub group: String,
}

fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-' && s.chars().filter(|c| c.is_ascii_digit()).count() == 8
}

/// `ls -la` do toybox (e o formato antigo do toolbox, sem contagem de links).
/// O nome é tudo o que vem depois da hora, então nomes com espaço funcionam.
pub fn parse_ls(text: &str) -> Vec<RemoteEntry> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim_end_matches('\r');
        if line.starts_with("total ") || line.trim().is_empty() {
            continue;
        }
        let first = match line.chars().next() {
            Some(c) => c,
            None => continue,
        };
        if !"-dlcbps".contains(first) {
            continue;
        }
        // Posições dos campos, para recuperar o nome com os espaços originais.
        let mut fields: Vec<(usize, &str)> = Vec::new();
        let mut start = None;
        for (i, ch) in line.char_indices() {
            if ch.is_whitespace() {
                if let Some(s) = start.take() {
                    fields.push((s, &line[s..i]));
                }
            } else if start.is_none() {
                start = Some(i);
            }
        }
        if let Some(s) = start {
            fields.push((s, &line[s..]));
        }
        let Some(di) = fields.iter().position(|(_, f)| is_date(f)) else { continue };
        if di + 2 >= fields.len() || di < 3 {
            continue;
        }
        let name_full = &line[fields[di + 2].0..];
        let perms = fields[0].1.to_string();
        let is_link = first == 'l';
        let (name, link_target) = if is_link {
            match name_full.split_once(" -> ") {
                Some((n, t)) => (n.to_string(), Some(t.to_string())),
                None => (name_full.to_string(), None),
            }
        } else {
            (name_full.to_string(), None)
        };
        if name == "." || name == ".." {
            continue;
        }
        let size = fields[di - 1].1.parse::<u64>().ok();
        // Com contagem de links: perms, links, dono, grupo, tamanho. Sem: perms, dono, grupo[, tamanho].
        let (owner, group) = if fields[1].1.chars().all(|c| c.is_ascii_digit()) {
            (fields[2].1.to_string(), fields[3].1.to_string())
        } else {
            (fields[1].1.to_string(), fields[2].1.to_string())
        };
        out.push(RemoteEntry {
            name,
            is_dir: first == 'd',
            is_link,
            link_target,
            size: if first == 'd' { None } else { size },
            modified: format!("{} {}", fields[di].1, fields[di + 1].1),
            perms,
            owner,
            group,
        });
    }
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    out
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    pub name: String,
    pub version_code: Option<String>,
    pub uid: Option<String>,
    pub path: Option<String>,
}

/// `pm list packages [-f] [-U] [--show-versioncode]`.
pub fn parse_packages(text: &str) -> Vec<Package> {
    let mut out = Vec::new();
    for line in text.lines() {
        let Some(rest) = line.trim().strip_prefix("package:") else { continue };
        let mut parts = rest.split_whitespace();
        let Some(first) = parts.next() else { continue };
        let (path, name) = match first.rsplit_once('=') {
            Some((p, n)) if p.starts_with('/') => (Some(p.to_string()), n.to_string()),
            _ => (None, first.to_string()),
        };
        let mut p = Package { name, version_code: None, uid: None, path };
        for t in parts {
            if let Some(v) = t.strip_prefix("versionCode:") {
                p.version_code = Some(v.into());
            } else if let Some(v) = t.strip_prefix("uid:") {
                p.uid = Some(v.into());
            }
        }
        out.push(p);
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdbVersion {
    pub adb_version: String,
    pub tools_version: Option<String>,
    pub installed_as: Option<String>,
}

pub fn parse_version(text: &str) -> Option<AdbVersion> {
    let mut v = AdbVersion::default();
    for line in text.lines() {
        let l = line.trim();
        if let Some(x) = l.strip_prefix("Android Debug Bridge version ") {
            v.adb_version = x.trim().to_string();
        } else if let Some(x) = l.strip_prefix("Version ") {
            v.tools_version = Some(x.trim().to_string());
        } else if let Some(x) = l.strip_prefix("Installed as ") {
            v.installed_as = Some(x.trim().to_string());
        }
    }
    if v.adb_version.is_empty() {
        None
    } else {
        Some(v)
    }
}

/// Aspas para o shell do aparelho: o adb junta os argumentos de `shell` numa linha só.
pub fn sh_quote(s: &str) -> String {
    if !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "/._-+=:@%,".contains(c)) {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}

/// Como o comando aparece no registro: copiável num terminal.
pub fn display_command(args: &[String]) -> String {
    let mut s = String::from("adb");
    for a in args {
        s.push(' ');
        if !a.is_empty() && a.chars().all(|c| c.is_ascii_alphanumeric() || "/._-+=:@%,[]".contains(c)) {
            s.push_str(a);
        } else {
            s.push('"');
            s.push_str(&a.replace('\\', "\\\\").replace('"', "\\\""));
            s.push('"');
        }
    }
    s
}

/// Separador usado para juntar vários comandos do resumo numa ida só ao aparelho.
pub const SECTION: &str = "___ADBGUI_SECTION___";

pub fn split_sections(text: &str) -> Vec<String> {
    text.split(SECTION).map(|s| s.trim_matches(['\r', '\n']).to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEVICES_L: &str = "List of devices attached\n\
0123abcd               device usb:1-5.2 product:msm8916_32 model:GPOS700 device:msm8916_32 transport_id:165\n\
100950089069061453     device usb:1-5.3 product:full_tb8765ap1_bsp_1g model:GPOS760 device:tb8765ap1_bsp_1g transport_id:156\n\
192.168.207.38:33981   device product:lineage_rpi4 model:Raspberry_Pi_4 device:rpi4 transport_id:115\n\
R5CT90XYZ              unauthorized usb:1-4 transport_id:7\n\
0099                   no permissions (missing udev rules? user is in the plugdev group); see [http://developer.android.com/tools/device.html] usb:1-1 transport_id:3\n\
emulator-5554          offline transport_id:9\n\n";

    #[test]
    fn devices_long_format() {
        let d = parse_devices(DEVICES_L);
        assert_eq!(d.len(), 6);
        assert_eq!(d[0].serial, "0123abcd");
        assert_eq!(d[0].model.as_deref(), Some("GPOS700"));
        assert_eq!(d[0].connection, "usb");
        assert_eq!(d[1].transport_id.as_deref(), Some("156"));
        assert_eq!(d[2].connection, "wifi");
        assert_eq!(d[2].usb, None);
        assert_eq!(d[3].state_kind, "unauthorized");
        assert_eq!(d[4].state_kind, "noPermissions");
        assert!(d[4].state.contains("udev"));
        assert_eq!(d[4].usb.as_deref(), Some("1-1"));
        assert_eq!(d[5].connection, "emulator");
        assert_eq!(d[5].state_kind, "offline");
    }

    #[test]
    fn devices_short_format() {
        let d = parse_devices("List of devices attached\nABC\tdevice\nXYZ\tsideload\n");
        assert_eq!(d.len(), 2);
        assert_eq!(d[1].state_kind, "sideload");
    }

    #[test]
    fn mdns_tls_connect_is_wifi() {
        assert_eq!(connection_kind("adb-100950089069061453-AbCdEf._adb-tls-connect._tcp"), "wifi");
    }

    #[test]
    fn track_blocks() {
        let body = "0123abcd\tdevice\n";
        let raw = format!("{:04x}{}{:04x}", body.len(), body, 0);
        let (blocks, used) = split_track_blocks(raw.as_bytes());
        assert_eq!(blocks, vec![body.to_string(), String::new()]);
        assert_eq!(used, raw.len());
        // Bloco incompleto fica para a próxima leitura.
        let partial = format!("{:04x}{}", 20, "abc");
        let (b2, used2) = split_track_blocks(partial.as_bytes());
        assert!(b2.is_empty());
        assert_eq!(used2, 0);
    }

    #[test]
    fn getprop() {
        let m = parse_getprop("[ro.product.model]: [GPOS760]\n[ro.build.version.sdk]: [30]\n[empty]: []\nlixo\n");
        assert_eq!(m.get("ro.product.model").map(String::as_str), Some("GPOS760"));
        assert_eq!(m.get("ro.build.version.sdk").map(String::as_str), Some("30"));
        assert_eq!(m.get("empty").map(String::as_str), Some(""));
        assert_eq!(m.len(), 3);
    }

    #[test]
    fn battery() {
        let b = parse_battery(
            "Current Battery Service state:\n  AC powered: false\n  USB powered: true\n  Wireless powered: false\n  status: 2\n  health: 2\n  present: true\n  level: 100\n  scale: 100\n  voltage: 4101\n  temperature: 311\n  technology: Li-ion\n",
        );
        assert_eq!(b.level, Some(100));
        assert_eq!(b.status.as_deref(), Some("charging"));
        assert_eq!(b.health.as_deref(), Some("good"));
        assert_eq!(b.powered, vec!["usb".to_string()]);
        assert_eq!(b.voltage_mv, Some(4101));
        assert_eq!(b.temperature_c, Some(31.1));
    }

    #[test]
    fn inet_and_df() {
        let ip = "33: wlan0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500\n    inet 192.168.207.86/24 brd 192.168.207.255 scope global wlan0\n";
        assert_eq!(parse_inet(ip).as_deref(), Some("192.168.207.86"));
        assert_eq!(parse_inet("Device \"wlan0\" does not exist."), None);
        let df = "Filesystem      1K-blocks    Used Available Use% Mounted on\n/dev/block/dm-9   4978656 1678772   3290608  34% /data/user/0\n";
        assert_eq!(parse_df(df), Some(Storage { total_kb: 4978656, used_kb: 1678772, avail_kb: 3290608 }));
        // Android 5.1 (GPOS700): toolbox com unidades.
        let old = "Filesystem               Size     Used     Free   Blksize\n/data                    5.1G   625.3M     4.5G   4096\n";
        let s = parse_df(old).unwrap();
        assert_eq!(s.total_kb, (5.1f64 * 1024.0 * 1024.0).round() as u64);
        assert_eq!(s.used_kb, (625.3f64 * 1024.0).round() as u64);
    }

    #[test]
    fn mdns() {
        let s = parse_mdns("List of discovered mdns services\nadb-7A1B-xyz\t_adb-tls-pairing._tcp\t192.168.0.57:37215\nadb-P2-0042\t_adb-tls-connect._tcp\t192.168.0.42:41235\n");
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].service, "_adb-tls-pairing._tcp");
        assert_eq!(s[1].address, "192.168.0.42:41235");
    }

    #[test]
    fn ls_toybox() {
        let out = "total 84\n\
drwxrwx--- 2 root everybody  3488 2024-06-12 00:45 Alarms\n\
-rw-rw---- 1 root everybody 8601234 2026-11-12 10:41 bug report.zip\n\
lrwxrwxrwx 1 root root 21 2009-01-01 00:00 sdcard -> /storage/self/primary\n\
drwxrwx--- 5 root everybody  3488 2024-06-12 00:45 .\n";
        let e = parse_ls(out);
        assert_eq!(e.len(), 3);
        assert_eq!(e[0].name, "Alarms");
        assert!(e[0].is_dir);
        assert_eq!(e[0].size, None);
        let bug = e.iter().find(|x| x.name == "bug report.zip").unwrap();
        assert_eq!(bug.size, Some(8601234));
        assert_eq!(bug.modified, "2026-11-12 10:41");
        let link = e.iter().find(|x| x.is_link).unwrap();
        assert_eq!(link.name, "sdcard");
        assert_eq!(link.link_target.as_deref(), Some("/storage/self/primary"));
    }

    #[test]
    fn ls_toolbox_without_links() {
        let e = parse_ls("drwxrwx--- root     sdcard_r          2016-01-01 00:00 Download\n-rw-rw---- root sdcard_r 1024 2016-01-01 00:00 a.txt\n");
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].owner, "root");
        assert_eq!(e[1].size, Some(1024));
    }

    #[test]
    fn packages() {
        let p = parse_packages("package:br.com.aditum.smartpostef versionCode:3000000 uid:10095\npackage:/data/app/x-1/base.apk=com.x versionCode:1 uid:10033\n");
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].name, "br.com.aditum.smartpostef");
        assert_eq!(p[0].version_code.as_deref(), Some("3000000"));
        assert_eq!(p[1].name, "com.x");
        assert_eq!(p[1].path.as_deref(), Some("/data/app/x-1/base.apk"));
    }

    #[test]
    fn version() {
        let v = parse_version("Android Debug Bridge version 1.0.41\nVersion 34.0.4-debian\nInstalled as /usr/lib/android-sdk/platform-tools/adb\n").unwrap();
        assert_eq!(v.adb_version, "1.0.41");
        assert_eq!(v.tools_version.as_deref(), Some("34.0.4-debian"));
        assert!(parse_version("bash: adb: not found").is_none());
    }

    #[test]
    fn quoting() {
        assert_eq!(sh_quote("/sdcard/Download"), "/sdcard/Download");
        assert_eq!(sh_quote("/sdcard/my file's.txt"), "'/sdcard/my file'\\''s.txt'");
        let cmd = display_command(&["-s".into(), "7A1B".into(), "shell".into(), "getprop; echo x".into()]);
        assert_eq!(cmd, "adb -s 7A1B shell \"getprop; echo x\"");
    }

    #[test]
    fn sections() {
        let t = format!("a\n{}\nb\r\n{}\n", SECTION, SECTION);
        assert_eq!(split_sections(&t), vec!["a", "b", ""]);
    }
}
