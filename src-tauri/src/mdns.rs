//! Busca mDNS própria para as portas da depuração por Wi-Fi (Android 11+).
//!
//! O `adb mdns services` depende de como o adb foi compilado: o do Debian/Ubuntu não acha nada, mesmo com o
//! aparelho anunciando na rede. Aqui a pergunta vai direto para a rede, por dois caminhos:
//! - porta efêmera ("legacy unicast", RFC 6762 §6.7): o aparelho responde direto para ela, sem disputar a 5353
//!   com o avahi/Bonjour; também pergunta direto ao IP do aparelho quando ele é conhecido;
//! - a própria 5353 compartilhada, para ouvir as respostas que vão para o grupo.
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket as StdUdp};
use std::time::Duration;

use futures_util::future::join_all;
use socket2::{Domain, Protocol, Socket, Type};
use tokio::net::UdpSocket;
use tokio::time::{timeout_at, Instant};

use crate::parse::MdnsService;

const GROUP: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 251);
const PORT: u16 = 5353;
const SERVICES: [&str; 2] = ["_adb-tls-connect._tcp.local", "_adb-tls-pairing._tcp.local"];
const PTR: u16 = 12;
const SRV: u16 = 33;
const A: u16 = 1;

/// Pergunta PTR pelos serviços do adb. `unicast` liga o bit QU (resposta direta).
pub fn build_query(unicast: bool) -> Vec<u8> {
    let mut q = vec![0u8; 12];
    q[5] = SERVICES.len() as u8;
    for name in SERVICES {
        for label in name.split('.').filter(|l| !l.is_empty()) {
            q.push(label.len() as u8);
            q.extend_from_slice(label.as_bytes());
        }
        q.push(0);
        q.extend_from_slice(&PTR.to_be_bytes());
        q.extend_from_slice(&[if unicast { 0x80 } else { 0 }, 1]);
    }
    q
}

fn read_name(buf: &[u8], mut pos: usize) -> Option<(String, usize)> {
    let mut labels: Vec<String> = Vec::new();
    let mut end = None;
    let mut jumps = 0;
    loop {
        let len = *buf.get(pos)? as usize;
        if len == 0 {
            pos += 1;
            break;
        }
        if len & 0xC0 == 0xC0 {
            let ptr = ((len & 0x3F) << 8) | *buf.get(pos + 1)? as usize;
            end.get_or_insert(pos + 2);
            jumps += 1;
            if jumps > 32 {
                return None;
            }
            pos = ptr;
            continue;
        }
        if len & 0xC0 != 0 {
            return None;
        }
        labels.push(String::from_utf8_lossy(buf.get(pos + 1..pos + 1 + len)?).into_owned());
        pos += 1 + len;
    }
    Some((labels.join("."), end.unwrap_or(pos)))
}

fn be16(buf: &[u8], i: usize) -> Option<u16> {
    Some(u16::from_be_bytes([*buf.get(i)?, *buf.get(i + 1)?]))
}

/// Registros juntados de várias respostas; nomes guardados em minúsculas.
#[derive(Default, Debug)]
pub struct Records {
    /// serviço → instâncias (com a grafia original, para exibir).
    ptr: Vec<(String, String)>,
    /// instância → (alvo, porta)
    srv: HashMap<String, (String, u16)>,
    /// alvo → IPv4
    a: HashMap<String, Ipv4Addr>,
    /// instância → IP de quem respondeu (quando o A não vem junto)
    from: HashMap<String, Ipv4Addr>,
}

impl Records {
    /// Lê uma resposta mDNS. Pacotes que não são respostas são ignorados.
    pub fn add_packet(&mut self, buf: &[u8], src: Option<Ipv4Addr>) -> Option<()> {
        if be16(buf, 2)? & 0x8000 == 0 {
            return Some(());
        }
        let qd = be16(buf, 4)? as usize;
        let rr = be16(buf, 6)? as usize + be16(buf, 8)? as usize + be16(buf, 10)? as usize;
        let mut pos = 12;
        for _ in 0..qd {
            pos = read_name(buf, pos)?.1 + 4;
        }
        for _ in 0..rr {
            let (name, p) = read_name(buf, pos)?;
            let ty = be16(buf, p)?;
            let rdlen = be16(buf, p + 8)? as usize;
            let rd = p + 10;
            buf.get(rd..rd + rdlen)?;
            let key = name.to_ascii_lowercase();
            match ty {
                PTR => {
                    let (inst, _) = read_name(buf, rd)?;
                    if !self.ptr.iter().any(|(s, i)| *s == key && i.eq_ignore_ascii_case(&inst)) {
                        self.ptr.push((key, inst));
                    }
                }
                SRV if rdlen >= 7 => {
                    let port = be16(buf, rd + 4)?;
                    let (target, _) = read_name(buf, rd + 6)?;
                    if let Some(ip) = src {
                        self.from.insert(key.clone(), ip);
                    }
                    self.srv.insert(key, (target.to_ascii_lowercase(), port));
                }
                A if rdlen == 4 => {
                    self.a.insert(key, Ipv4Addr::new(buf[rd], buf[rd + 1], buf[rd + 2], buf[rd + 3]));
                }
                _ => {}
            }
            pos = rd + rdlen;
        }
        Some(())
    }

    /// Serviços resolvidos (com IP e porta), no mesmo formato do `adb mdns services`.
    pub fn services(&self) -> Vec<MdnsService> {
        let mut out: Vec<MdnsService> = Vec::new();
        for (svc, inst) in &self.ptr {
            if !SERVICES.contains(&svc.as_str()) {
                continue;
            }
            let ik = inst.to_ascii_lowercase();
            let Some((target, port)) = self.srv.get(&ik) else { continue };
            let Some(ip) = self.a.get(target).or_else(|| self.from.get(&ik)) else { continue };
            let service = svc.trim_end_matches(".local").to_string();
            let name = inst.split("._adb").next().unwrap_or(inst).to_string();
            let address = format!("{ip}:{port}");
            if !out.iter().any(|s| s.service == service && s.address == address) {
                out.push(MdnsService { name, service, address });
            }
        }
        out
    }
}

/// IPv4 da interface que sai para a rede (nenhum pacote é enviado).
fn local_ip(toward: Option<Ipv4Addr>) -> Option<Ipv4Addr> {
    let s = StdUdp::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    s.connect((toward.unwrap_or(Ipv4Addr::new(8, 8, 8, 8)), 53)).ok()?;
    match s.local_addr().ok()? {
        SocketAddr::V4(a) if !a.ip().is_unspecified() => Some(*a.ip()),
        _ => None,
    }
}

fn udp(shared: bool, iface: Option<Ipv4Addr>) -> std::io::Result<UdpSocket> {
    let s = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    if shared {
        s.set_reuse_address(true)?;
        #[cfg(all(unix, not(any(target_os = "solaris", target_os = "illumos"))))]
        let _ = s.set_reuse_port(true);
    }
    if let Some(i) = iface {
        let _ = s.set_multicast_if_v4(&i);
    }
    let _ = s.set_multicast_ttl_v4(255);
    let _ = s.set_multicast_loop_v4(false);
    s.bind(&SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, if shared { PORT } else { 0 }).into())?;
    if shared {
        s.join_multicast_v4(&GROUP, &iface.unwrap_or(Ipv4Addr::UNSPECIFIED))?;
    }
    s.set_nonblocking(true)?;
    UdpSocket::from_std(s.into())
}

async fn ask(sock: UdpSocket, query: Vec<u8>, dests: Vec<SocketAddr>, wait: Duration) -> Vec<(Vec<u8>, Option<Ipv4Addr>)> {
    let start = Instant::now();
    let deadline = start + wait;
    let resend = start + wait / 2;
    let mut resent = false;
    for d in &dests {
        let _ = sock.send_to(&query, d).await;
    }
    let mut got = Vec::new();
    let mut buf = vec![0u8; 9000];
    loop {
        let until = if resent { deadline } else { resend.min(deadline) };
        match timeout_at(until, sock.recv_from(&mut buf)).await {
            Ok(Ok((n, from))) => {
                let ip = match from {
                    SocketAddr::V4(a) => Some(*a.ip()),
                    _ => None,
                };
                got.push((buf[..n].to_vec(), ip));
            }
            Ok(Err(_)) => {}
            Err(_) if !resent && Instant::now() < deadline => {
                resent = true;
                for d in &dests {
                    let _ = sock.send_to(&query, d).await;
                }
            }
            Err(_) => break,
        }
    }
    got
}

/// Procura os serviços do adb na rede por `wait`. `targets`: IPs que também recebem a pergunta direto.
pub async fn browse(targets: &[Ipv4Addr], wait: Duration) -> Vec<MdnsService> {
    let iface = local_ip(targets.first().copied());
    let group = SocketAddr::from((GROUP, PORT));
    let mut jobs = Vec::new();
    if let Ok(s) = udp(false, iface) {
        let mut dests = vec![group];
        dests.extend(targets.iter().map(|ip| SocketAddr::from((*ip, PORT))));
        jobs.push(ask(s, build_query(true), dests, wait));
    }
    if let Ok(s) = udp(true, iface) {
        jobs.push(ask(s, build_query(false), vec![group], wait));
    }
    let mut recs = Records::default();
    for (pkt, src) in join_all(jobs).await.into_iter().flatten() {
        let _ = recs.add_packet(&pkt, src);
    }
    recs.services()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn name(out: &mut Vec<u8>, n: &str) {
        for l in n.split('.') {
            out.push(l.len() as u8);
            out.extend_from_slice(l.as_bytes());
        }
        out.push(0);
    }
    fn rr(out: &mut Vec<u8>, owner: &[u8], ty: u16, rdata: &[u8]) {
        out.extend_from_slice(owner);
        out.extend_from_slice(&ty.to_be_bytes());
        out.extend_from_slice(&[0x80, 1, 0, 0, 0, 120]);
        out.extend_from_slice(&(rdata.len() as u16).to_be_bytes());
        out.extend_from_slice(rdata);
    }

    /// Resposta como a do Android: PTR na resposta, SRV e A nos adicionais, com ponteiros de compressão.
    fn android_reply(with_a: bool) -> Vec<u8> {
        let mut p = vec![0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, if with_a { 2 } else { 1 }];
        let svc_at = p.len() as u8;
        let mut svc = Vec::new();
        name(&mut svc, "_adb-tls-connect._tcp.local");
        // PTR: dono = serviço (escrito por extenso), dado = "adb-…" + ponteiro para o serviço
        let mut inst = vec![27];
        inst.extend_from_slice(b"adb-10000000cd0b8d4d-Y80Gbf");
        inst.extend_from_slice(&[0xC0, svc_at]);
        rr(&mut p, &svc, PTR, &inst);
        let inst_at = (p.len() - inst.len()) as u8;
        // SRV: dono = ponteiro para a instância; alvo = Android-68.local
        let mut srv = vec![0, 0, 0, 0];
        srv.extend_from_slice(&43429u16.to_be_bytes());
        let mut host = Vec::new();
        name(&mut host, "Android-68.local");
        srv.extend_from_slice(&host);
        rr(&mut p, &[0xC0, inst_at], SRV, &srv);
        if with_a {
            rr(&mut p, &host, A, &[192, 168, 207, 38]);
        }
        p
    }

    #[test]
    fn resolve_ptr_srv_e_a_com_compressao() {
        let mut r = Records::default();
        r.add_packet(&android_reply(true), Some(Ipv4Addr::new(10, 0, 0, 1))).unwrap();
        let s = r.services();
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].name, "adb-10000000cd0b8d4d-Y80Gbf");
        assert_eq!(s[0].service, "_adb-tls-connect._tcp");
        assert_eq!(s[0].address, "192.168.207.38:43429");
    }

    #[test]
    fn sem_registro_a_usa_quem_respondeu() {
        let mut r = Records::default();
        r.add_packet(&android_reply(false), Some(Ipv4Addr::new(192, 168, 207, 38))).unwrap();
        assert_eq!(r.services()[0].address, "192.168.207.38:43429");
    }

    #[test]
    fn ignora_perguntas_e_pacotes_quebrados() {
        let mut r = Records::default();
        r.add_packet(&build_query(true), None).unwrap();
        assert!(r.services().is_empty());
        let mut cut = android_reply(true);
        cut.truncate(cut.len() - 3);
        let _ = r.add_packet(&cut, None);
        let mut loop_ptr = vec![0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0];
        loop_ptr.extend_from_slice(&[0xC0, 12]);
        assert!(r.add_packet(&loop_ptr, None).is_none());
    }

    #[test]
    fn pergunta_tem_os_dois_servicos() {
        let q = build_query(true);
        assert_eq!(be16(&q, 4), Some(2));
        let (n, _) = read_name(&q, 12).unwrap();
        assert_eq!(n, "_adb-tls-connect._tcp.local");
    }
}

#[cfg(test)]
mod rede {
    /// Só pergunta na rede local e imprime o que achou: `cargo test rede_real -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn rede_real() {
        let targets: Vec<std::net::Ipv4Addr> = std::env::var("MDNS_ALVO").ok().and_then(|t| t.parse().ok()).into_iter().collect();
        for s in super::browse(&targets, std::time::Duration::from_millis(1500)).await {
            println!("{}\t{}\t{}", s.name, s.service, s.address);
        }
    }
}
