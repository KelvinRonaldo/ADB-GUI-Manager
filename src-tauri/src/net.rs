//! Reencontrar aparelhos Wi-Fi depois que o DHCP troca o IP (pedido do Kelvin, 19/11/2026).
//!
//! Três peças, usadas pela tela Conectar na ordem mDNS → MAC → porta 5555:
//! - `sweep`: testa a porta do adb em toda a sub-rede. O teste em si já faz o PC perguntar o MAC de
//!   cada endereço vivo (ARP), então a mesma varredura serve aos caminhos do MAC e da porta;
//! - `arp_table`: a tabela ARP do PC (IP → MAC);
//! - `identify`: aperto de mão do protocolo do adb com a chave deste PC, que lê as propriedades de
//!   serial do aparelho sem conectar o servidor do adb a ele. Se o aparelho não conhece a chave, para
//!   ali: nunca manda a chave pública, então nenhum aparelho de terceiros mostra "Permitir depuração".
use std::collections::BTreeMap;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket as StdUdp};
use std::time::Duration;

use futures_util::stream::{self, StreamExt};
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

/// Sub-rede /24 da interface que sai para a rede (nenhum pacote é enviado para descobrir).
pub fn local_subnet() -> Option<(Ipv4Addr, String)> {
    let s = StdUdp::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    s.connect((Ipv4Addr::new(8, 8, 8, 8), 53)).ok()?;
    match s.local_addr().ok()? {
        SocketAddr::V4(a) if !a.ip().is_unspecified() => {
            let o = a.ip().octets();
            Some((*a.ip(), format!("{}.{}.{}.0/24", o[0], o[1], o[2])))
        }
        _ => None,
    }
}

/// Endereços de uma faixa "a.b.c.d/nn" (de /16 a /32; maior que /16 é recusado para não varrer demais).
pub fn hosts(cidr: &str) -> Result<Vec<Ipv4Addr>, String> {
    let (ip, bits) = match cidr.trim().split_once('/') {
        Some((i, b)) => (i, b.parse::<u32>().map_err(|_| format!("faixa inválida: {cidr}"))?),
        None => (cidr.trim(), 32),
    };
    let ip: Ipv4Addr = ip.parse().map_err(|_| format!("faixa inválida: {cidr}"))?;
    if !(16..=32).contains(&bits) {
        return Err(format!("faixa grande demais (use /16 a /32): {cidr}"));
    }
    let mask = if bits == 0 { 0 } else { u32::MAX << (32 - bits) };
    let net = u32::from(ip) & mask;
    let size = 1u64 << (32 - bits);
    if size <= 2 {
        return Ok((0..size as u32).map(|i| Ipv4Addr::from(net + i)).collect());
    }
    // Sem o endereço da rede nem o de broadcast.
    Ok((1..(size - 1) as u32).map(|i| Ipv4Addr::from(net + i)).collect())
}

/// Testa a porta em cada endereço, `limit` de cada vez. Devolve os que aceitaram a conexão.
pub async fn sweep(ips: Vec<Ipv4Addr>, port: u16, wait: Duration, limit: usize) -> Vec<Ipv4Addr> {
    let mut open: Vec<Ipv4Addr> = stream::iter(ips)
        .map(|ip| async move {
            match timeout(wait, TcpStream::connect(SocketAddrV4::new(ip, port))).await {
                Ok(Ok(_)) => Some(ip),
                _ => None,
            }
        })
        .buffer_unordered(limit)
        .filter_map(|x| async move { x })
        .collect()
        .await;
    open.sort();
    open
}

/// Tabela ARP do PC: IP → MAC em minúsculas com ":". Entradas incompletas ficam de fora.
pub async fn arp_table() -> BTreeMap<String, String> {
    #[cfg(target_os = "linux")]
    {
        let txt = tokio::fs::read_to_string("/proc/net/arp").await.unwrap_or_default();
        return parse_proc_arp(&txt);
    }
    #[cfg(not(target_os = "linux"))]
    {
        let mut cmd = tokio::process::Command::new("arp");
        cmd.arg(if cfg!(windows) { "-a" } else { "-an" });
        cmd.stdin(std::process::Stdio::null());
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000);
        let out = match timeout(Duration::from_secs(10), cmd.output()).await {
            Ok(Ok(o)) => String::from_utf8_lossy(&o.stdout).into_owned(),
            _ => String::new(),
        };
        parse_arp_a(&out)
    }
}

pub fn parse_proc_arp(txt: &str) -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    for line in txt.lines().skip(1) {
        let f: Vec<&str> = line.split_whitespace().collect();
        // IP address, HW type, Flags, HW address, Mask, Device. Flags 0x0 = incompleta.
        if f.len() >= 4 && f[2] != "0x0" {
            if let Some(mac) = norm_mac(f[3]) {
                m.insert(f[0].to_string(), mac);
            }
        }
    }
    m
}

/// `arp -a` do Windows ("192.168.0.71  3c-2e-ff-01-02-9a  dinâmico") e `arp -an` do macOS
/// ("? (192.168.0.71) at 3c:2e:ff:1:2:9a on en0").
#[cfg_attr(target_os = "linux", allow(dead_code))]
pub fn parse_arp_a(txt: &str) -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    for line in txt.lines() {
        let words: Vec<&str> = line.split_whitespace().map(|w| w.trim_matches(|c| c == '(' || c == ')')).collect();
        let ip = words.iter().find(|w| w.parse::<Ipv4Addr>().is_ok());
        let mac = words.iter().find_map(|w| norm_mac(w));
        if let (Some(ip), Some(mac)) = (ip, mac) {
            m.insert(ip.to_string(), mac);
        }
    }
    m
}

/// MAC em minúsculas com ":" e dois dígitos por parte. Recusa vazio, broadcast e multicast.
pub fn norm_mac(s: &str) -> Option<String> {
    let parts: Vec<&str> = s.split(|c| c == ':' || c == '-').collect();
    if parts.len() != 6 || parts.iter().any(|p| p.is_empty() || p.len() > 2 || !p.chars().all(|c| c.is_ascii_hexdigit())) {
        return None;
    }
    let mac = parts.iter().map(|p| format!("{:0>2}", p.to_ascii_lowercase())).collect::<Vec<_>>().join(":");
    if mac == "00:00:00:00:00:00" || mac == "ff:ff:ff:ff:ff:ff" || mac.starts_with("01:00:5e") {
        return None;
    }
    Some(mac)
}

// ---------- aperto de mão do adb ----------

const A_CNXN: u32 = 0x4e58_4e43;
const A_AUTH: u32 = 0x4854_5541;
const A_OPEN: u32 = 0x4e45_504f;
const A_OKAY: u32 = 0x5941_4b4f;
const A_WRTE: u32 = 0x4554_5257;
const A_CLSE: u32 = 0x4553_4c43;
const AUTH_TOKEN: u32 = 1;
const AUTH_SIGNATURE: u32 = 2;
const VERSION: u32 = 0x0100_0001;
const MAX_DATA: u32 = 256 * 1024;

/// Propriedades lidas no aperto de mão: as de serial (mesma lista da tela) e o modelo.
pub const PROPS: [&str; 12] = [
    "persist.sys.device.sn",
    "persist.sys.SN",
    "persist.sys.customerSN",
    "ro.sunmi.serial",
    "pax.sp.SN",
    "ro.fac.sn",
    "ro.epay.serial",
    "ro.serialno",
    "ro.boot.serialno",
    "ro.product.manufacturer",
    "ro.product.model",
    "ro.product.device",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub address: String,
    pub props: BTreeMap<String, String>,
}

fn packet(cmd: u32, arg0: u32, arg1: u32, data: &[u8]) -> Vec<u8> {
    let sum: u32 = data.iter().map(|b| *b as u32).sum();
    let mut v = Vec::with_capacity(24 + data.len());
    for x in [cmd, arg0, arg1, data.len() as u32, sum, cmd ^ 0xffff_ffff] {
        v.extend_from_slice(&x.to_le_bytes());
    }
    v.extend_from_slice(data);
    v
}

async fn read_packet(s: &mut TcpStream) -> std::io::Result<(u32, u32, u32, Vec<u8>)> {
    let mut h = [0u8; 24];
    s.read_exact(&mut h).await?;
    let w = |i: usize| u32::from_le_bytes([h[i], h[i + 1], h[i + 2], h[i + 3]]);
    let (cmd, a0, a1, len, magic) = (w(0), w(4), w(8), w(12), w(20));
    if magic != cmd ^ 0xffff_ffff || len > MAX_DATA * 4 {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "não é o adb"));
    }
    let mut data = vec![0u8; len as usize];
    s.read_exact(&mut data).await?;
    Ok((cmd, a0, a1, data))
}

/// Chave privada do adb deste usuário (a mesma que os aparelhos já autorizaram).
fn load_key() -> Result<rsa::RsaPrivateKey, String> {
    use rsa::pkcs1::DecodeRsaPrivateKey;
    use rsa::pkcs8::DecodePrivateKey;
    let dir = std::env::var_os("ANDROID_USER_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })?;
            Some(std::path::PathBuf::from(home).join(".android"))
        })
        .ok_or("sem pasta .android")?;
    let pem = std::fs::read_to_string(dir.join("adbkey")).map_err(|e| format!("chave do adb não encontrada: {e}"))?;
    rsa::RsaPrivateKey::from_pkcs8_pem(&pem)
        .or_else(|_| rsa::RsaPrivateKey::from_pkcs1_pem(&pem))
        .map_err(|e| format!("chave do adb ilegível: {e}"))
}

/// Lê as propriedades de serial do aparelho em `address` (ip:porta) pelo protocolo do adb.
/// Erro "NOT_AUTHORIZED": o aparelho não conhece a chave deste PC (nada aparece na tela dele).
pub async fn identify(address: &str, wait: Duration) -> Result<Identity, String> {
    let key = load_key()?;
    let addr = address.to_string();
    timeout(wait, async move {
        let mut s = TcpStream::connect(&addr).await.map_err(|e| e.to_string())?;
        s.write_all(&packet(A_CNXN, VERSION, MAX_DATA, b"host::\0")).await.map_err(|e| e.to_string())?;
        let mut signed = false;
        loop {
            let (cmd, a0, _, data) = read_packet(&mut s).await.map_err(|e| e.to_string())?;
            match cmd {
                A_CNXN => break,
                A_AUTH if a0 == AUTH_TOKEN && !signed => {
                    let sig = key
                        .sign(rsa::Pkcs1v15Sign::new::<sha1::Sha1>(), &data)
                        .map_err(|e| format!("assinatura: {e}"))?;
                    s.write_all(&packet(A_AUTH, AUTH_SIGNATURE, 0, &sig)).await.map_err(|e| e.to_string())?;
                    signed = true;
                }
                // Recusou a assinatura: pararia aqui pedindo a chave pública (o que abre o diálogo). Não pede.
                A_AUTH => return Err("NOT_AUTHORIZED".to_string()),
                _ => {}
            }
        }
        let script = PROPS.iter().map(|p| format!("echo {p}=$(getprop {p})")).collect::<Vec<_>>().join(";");
        let open = format!("shell:{script}\0");
        s.write_all(&packet(A_OPEN, 1, 0, open.as_bytes())).await.map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        loop {
            let (cmd, a0, _, data) = read_packet(&mut s).await.map_err(|e| e.to_string())?;
            match cmd {
                A_WRTE => {
                    out.extend_from_slice(&data);
                    s.write_all(&packet(A_OKAY, 1, a0, &[])).await.map_err(|e| e.to_string())?;
                }
                A_CLSE => break,
                _ => {}
            }
        }
        let mut props = BTreeMap::new();
        for line in String::from_utf8_lossy(&out).lines() {
            if let Some((k, v)) = line.trim().split_once('=') {
                if !v.trim().is_empty() {
                    props.insert(k.to_string(), v.trim().to_string());
                }
            }
        }
        Ok(Identity { address: addr, props })
    })
    .await
    .map_err(|_| "tempo esgotado".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn faixas() {
        assert_eq!(hosts("192.168.0.0/24").unwrap().len(), 254);
        assert_eq!(hosts("192.168.0.77/24").unwrap()[0], Ipv4Addr::new(192, 168, 0, 1));
        assert_eq!(hosts("10.0.5.9").unwrap(), vec![Ipv4Addr::new(10, 0, 5, 9)]);
        assert!(hosts("10.0.0.0/8").is_err());
        assert!(hosts("abc/24").is_err());
    }

    #[test]
    fn arp_linux() {
        let t = "IP address       HW type     Flags       HW address            Mask     Device\n\
                 192.168.0.71     0x1         0x2         3c:2e:ff:01:02:9a     *        wlp2s0\n\
                 192.168.0.80     0x1         0x0         00:00:00:00:00:00     *        wlp2s0\n";
        let m = parse_proc_arp(t);
        assert_eq!(m.get("192.168.0.71").map(String::as_str), Some("3c:2e:ff:01:02:9a"));
        assert!(!m.contains_key("192.168.0.80"));
    }

    #[test]
    fn arp_windows_e_mac() {
        let t = "Interface: 192.168.0.10 --- 0x7\n  Internet Address      Physical Address      Type\n  192.168.0.71          3c-2e-ff-01-02-9a     dynamic\n  192.168.0.255         ff-ff-ff-ff-ff-ff     static\n";
        let m = parse_arp_a(t);
        assert_eq!(m.get("192.168.0.71").map(String::as_str), Some("3c:2e:ff:01:02:9a"));
        assert!(!m.contains_key("192.168.0.255"));
        let mac = parse_arp_a("? (192.168.0.71) at 3c:2e:ff:1:2:9a on en0 ifscope [ethernet]");
        assert_eq!(mac.get("192.168.0.71").map(String::as_str), Some("3c:2e:ff:01:02:9a"));
    }

    #[test]
    fn pacote_do_adb() {
        let p = packet(A_CNXN, VERSION, MAX_DATA, b"host::\0");
        assert_eq!(&p[0..4], b"CNXN");
        assert_eq!(p.len(), 24 + 7);
        assert_eq!(u32::from_le_bytes([p[20], p[21], p[22], p[23]]), A_CNXN ^ 0xffff_ffff);
    }

    /// Contra um aparelho real: `NET_ADDR=192.168.0.71:5555 cargo test --lib aperto_real -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn aperto_real() {
        let addr = std::env::var("NET_ADDR").expect("NET_ADDR");
        let r = identify(&addr, Duration::from_secs(5)).await;
        println!("{r:?}");
        assert!(r.is_ok());
    }

    /// Varredura real: `cargo test --lib varredura_real -- --ignored --nocapture` (usa a /24 do PC).
    #[tokio::test]
    #[ignore]
    async fn varredura_real() {
        let (_, net) = local_subnet().expect("sem rede");
        let t = std::time::Instant::now();
        let open = sweep(hosts(&net).unwrap(), 5555, Duration::from_millis(600), 128).await;
        let arp = arp_table().await;
        println!("{net}: {} com 5555 em {:?}; ARP com {} entradas", open.len(), t.elapsed(), arp.len());
        for ip in &open {
            let id = identify(&format!("{ip}:5555"), Duration::from_secs(4)).await;
            println!("{ip} mac={:?} -> {:?}", arp.get(&ip.to_string()), id.map(|i| i.props.get("ro.product.model").cloned()));
        }
    }
}
