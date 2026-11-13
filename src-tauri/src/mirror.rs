//! Espelhamento de tela com o scrcpy-server embutido (resources/scrcpy). O servidor roda no
//! aparelho pelo `app_process`; o vídeo H.264 chega por um túnel `adb forward` e vai para a
//! página por um canal binário (a página decodifica com WebCodecs). Toques e teclas voltam
//! pelo socket de controle do scrcpy.
//!
//! O protocolo é interno do scrcpy e muda entre versões: este código segue o da v5.0.1
//! (doc/develop.md). O servidor recusa versão diferente da que o cliente informa.

use crate::runner::{self, RunOpts};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};

pub const SCRCPY_VERSION: &str = "5.0.1";
const SERVER: &[u8] = include_bytes!("../resources/scrcpy/scrcpy-server-v5.0.1");
const SERVER_REMOTE: &str = "/data/local/tmp/adbgui-scrcpy-server.jar";

/// Mensagens do canal para a página: 1 byte de tipo e o resto.
const MSG_SESSION: u8 = 1; // [w u32][h u32]
const MSG_PACKET: u8 = 2; // [flags u8: 1 = config, 2 = quadro-chave][pts u64][dados]
const MSG_NAME: u8 = 3; // [nome utf-8]

pub struct MirrorHandle {
    pub stop: oneshot::Sender<()>,
    pub control: mpsc::UnboundedSender<Vec<u8>>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MirrorOptions {
    /// Maior lado do vídeo em pixels (0 = tamanho da tela).
    pub max_size: u32,
    /// Bits por segundo do vídeo.
    pub bit_rate: u32,
    pub max_fps: u32,
    /// Mandar toques e teclas para o aparelho.
    pub control: bool,
    /// Manter a tela acesa enquanto espelha.
    pub stay_awake: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MirrorEnded {
    id: u64,
    error: Option<String>,
}

fn scid() -> u32 {
    let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(1);
    (n ^ std::process::id().rotate_left(13)) & 0x7fff_ffff
}

fn free_port() -> Result<u16, String> {
    let l = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    l.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

fn send(ch: &Channel<InvokeResponseBody>, kind: u8, body: &[u8]) -> bool {
    let mut v = Vec::with_capacity(body.len() + 1);
    v.push(kind);
    v.extend_from_slice(body);
    ch.send(InvokeResponseBody::Raw(v)).is_ok()
}

/// Sobe o servidor, abre os sockets e devolve o id; o resto roda numa tarefa até parar.
pub async fn start(
    app: AppHandle,
    st: Arc<AppState>,
    serial: String,
    opts: MirrorOptions,
    channel: Channel<InvokeResponseBody>,
) -> Result<u64, String> {
    let path = st.adb_path()?;
    // 1. Servidor no aparelho.
    let local = st.data_dir.join("adbgui-scrcpy-server.jar");
    std::fs::create_dir_all(&st.data_dir).map_err(|e| e.to_string())?;
    std::fs::write(&local, SERVER).map_err(|e| e.to_string())?;
    let push = runner::run(
        &app,
        &st,
        vec!["push".into(), local.to_string_lossy().to_string(), SERVER_REMOTE.into()],
        RunOpts { serial: Some(serial.clone()), timeout_ms: Some(60_000), quiet: false },
    )
    .await?;
    if push.code != 0 {
        return Err(format!("MIRROR_PUSH: {}", runner::last_line(&push.stderr).unwrap_or_default()));
    }

    // 2. Túnel: o aparelho escuta (forward), o app conecta.
    let scid = scid();
    let socket = format!("localabstract:scrcpy_{:08x}", scid);
    let port = free_port()?;
    let fwd = runner::run(
        &app,
        &st,
        vec!["forward".into(), format!("tcp:{}", port), socket],
        RunOpts { serial: Some(serial.clone()), timeout_ms: Some(20_000), quiet: false },
    )
    .await?;
    if fwd.code != 0 {
        return Err(format!("MIRROR_FORWARD: {}", runner::last_line(&fwd.stderr).unwrap_or_default()));
    }

    // 3. Servidor.
    let mut server_args = vec![
        format!("CLASSPATH={}", SERVER_REMOTE),
        "app_process".into(),
        "/".into(),
        "com.genymobile.scrcpy.Server".into(),
        SCRCPY_VERSION.into(),
        format!("scid={:08x}", scid),
        "log_level=info".into(),
        "tunnel_forward=true".into(),
        "audio=false".into(),
        format!("control={}", opts.control),
        "video_codec=h264".into(),
        format!("max_size={}", opts.max_size),
        format!("video_bit_rate={}", opts.bit_rate.max(500_000)),
        "clipboard_autosync=false".into(),
        "cleanup=true".into(),
    ];
    if opts.max_fps > 0 {
        server_args.push(format!("max_fps={}", opts.max_fps));
    }
    if opts.stay_awake && opts.control {
        server_args.push("stay_awake=true".into());
    }
    let mut args = vec!["shell".to_string()];
    args.extend(server_args);
    let full = runner::full_args(&st, Some(&serial), &args);
    let cmd = crate::parse::display_command(&full);
    let id = st.new_id();
    runner::log_start(&app, id, &cmd);
    let started = Instant::now();
    let mut c = runner::tokio_command(&st, &path, &full);
    c.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
    let mut child = match c.spawn() {
        Ok(ch) => ch,
        Err(e) => {
            let msg = format!("SPAWN_FAILED: {}", e);
            runner::log_end(&app, &st, id, &cmd, -1, 0, Some(msg.clone()));
            remove_forward(&app, &st, &serial, port).await;
            return Err(msg);
        }
    };
    // Saída do servidor (para mostrar o erro dele, se cair).
    let out_lines = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    for pipe in [child.stdout.take().map(|p| Box::new(p) as Box<dyn tokio::io::AsyncRead + Unpin + Send>), child.stderr.take().map(|p| Box::new(p) as Box<dyn tokio::io::AsyncRead + Unpin + Send>)].into_iter().flatten() {
        let lines = out_lines.clone();
        tokio::spawn(async move {
            let mut r = BufReader::new(pipe).lines();
            while let Ok(Some(l)) = r.next_line().await {
                if let Ok(mut v) = lines.lock() {
                    v.push(l);
                    if v.len() > 40 {
                        v.remove(0);
                    }
                }
            }
        });
    }
    let server_output = |lines: &Arc<std::sync::Mutex<Vec<String>>>| lines.lock().map(|v| v.join("\n")).unwrap_or_default();

    // 4. Socket de vídeo: com forward, o servidor manda 1 byte quando está escutando.
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut video = loop {
        if let Ok(Some(status)) = child.try_wait() {
            let out = server_output(&out_lines);
            runner::log_end(&app, &st, id, &cmd, status.code().unwrap_or(-1), started.elapsed().as_millis() as u64, Some(out.clone()));
            remove_forward(&app, &st, &serial, port).await;
            return Err(format!("MIRROR_SERVER: {}", out));
        }
        if Instant::now() > deadline {
            let _ = child.kill().await;
            let out = server_output(&out_lines);
            runner::log_end(&app, &st, id, &cmd, -1, started.elapsed().as_millis() as u64, Some("timeout".into()));
            remove_forward(&app, &st, &serial, port).await;
            return Err(format!("MIRROR_TIMEOUT: {}", out));
        }
        if let Ok(mut s) = TcpStream::connect(("127.0.0.1", port)).await {
            let mut b = [0u8; 1];
            if let Ok(Ok(1)) = tokio::time::timeout(Duration::from_millis(800), s.read(&mut b)).await {
                break s;
            }
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    };
    let _ = video.set_nodelay(true);
    let control = if opts.control {
        match TcpStream::connect(("127.0.0.1", port)).await {
            Ok(s) => {
                let _ = s.set_nodelay(true);
                Some(s)
            }
            Err(e) => {
                let _ = child.kill().await;
                remove_forward(&app, &st, &serial, port).await;
                return Err(format!("MIRROR_CONTROL: {}", e));
            }
        }
    } else {
        None
    };

    // 5. Metadados: nome do aparelho (64 bytes) e o codec (u32).
    let mut name = [0u8; 64];
    let mut codec = [0u8; 4];
    let meta = async {
        video.read_exact(&mut name).await?;
        video.read_exact(&mut codec).await?;
        Ok::<(), std::io::Error>(())
    };
    if let Err(e) = tokio::time::timeout(Duration::from_secs(10), meta).await.map_err(|e| e.to_string()).and_then(|r| r.map_err(|e| e.to_string())) {
        let _ = child.kill().await;
        remove_forward(&app, &st, &serial, port).await;
        return Err(format!("MIRROR_SERVER: {} {}", e, server_output(&out_lines)));
    }
    let end = name.iter().position(|&b| b == 0).unwrap_or(name.len());
    send(&channel, MSG_NAME, &name[..end]);

    let (stop_tx, mut stop_rx) = oneshot::channel::<()>();
    let (ctl_tx, mut ctl_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let mirror_id = st.new_id();
    if let Ok(mut m) = st.mirrors.lock() {
        m.insert(mirror_id, MirrorHandle { stop: stop_tx, control: ctl_tx });
    }

    let st2 = st.clone();
    tokio::spawn(async move {
        // Controle: escreve o que a página manda; lê e descarta o que o aparelho manda.
        let mut ctl_task = None;
        if let Some(sock) = control {
            let (mut rd, mut wr) = sock.into_split();
            ctl_task = Some(tokio::spawn(async move {
                let mut sink = [0u8; 1024];
                loop {
                    tokio::select! {
                        msg = ctl_rx.recv() => match msg {
                            Some(m) => if wr.write_all(&m).await.is_err() { break },
                            None => break,
                        },
                        r = rd.read(&mut sink) => match r {
                            Ok(0) | Err(_) => break,
                            Ok(_) => {}
                        },
                    }
                }
            }));
        }

        let reason: Option<String> = loop {
            let mut hdr = [0u8; 12];
            tokio::select! {
                _ = &mut stop_rx => break None,
                r = video.read_exact(&mut hdr) => {
                    if let Err(e) = r {
                        break Some(e.to_string());
                    }
                }
            }
            let first = u32::from_be_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]);
            if first & 0x8000_0000 != 0 {
                // Sessão nova (início ou rotação): largura e altura.
                send(&channel, MSG_SESSION, &hdr[4..12]);
                continue;
            }
            let pts_flags = u64::from_be_bytes(hdr[0..8].try_into().unwrap_or([0; 8]));
            let size = u32::from_be_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;
            let config = pts_flags & (1 << 62) != 0;
            let key = pts_flags & (1 << 61) != 0;
            let pts = pts_flags & ((1 << 61) - 1);
            let mut body = vec![0u8; 1 + 8 + size];
            body[0] = (config as u8) | ((key as u8) << 1);
            body[1..9].copy_from_slice(&pts.to_be_bytes());
            if let Err(e) = video.read_exact(&mut body[9..]).await {
                break Some(e.to_string());
            }
            if !send(&channel, MSG_PACKET, &body) {
                break None; // a página fechou o canal
            }
        };

        if let Some(t) = ctl_task {
            t.abort();
        }
        let _ = child.kill().await;
        let code = child.wait().await.ok().and_then(|s| s.code()).unwrap_or(0);
        let out = server_output(&out_lines);
        let error = reason.map(|r| if out.trim().is_empty() { r } else { format!("{}\n{}", r, out) });
        runner::log_end(&app, &st2, id, &cmd, if error.is_some() { code.max(1) } else { 0 }, started.elapsed().as_millis() as u64, error.clone());
        remove_forward(&app, &st2, &serial, port).await;
        if let Ok(mut m) = st2.mirrors.lock() {
            m.remove(&mirror_id);
        }
        let _ = app.emit("mirror-ended", MirrorEnded { id: mirror_id, error });
    });
    Ok(mirror_id)
}

async fn remove_forward(app: &AppHandle, st: &AppState, serial: &str, port: u16) {
    let _ = runner::run(
        app,
        st,
        vec!["forward".into(), "--remove".into(), format!("tcp:{}", port)],
        RunOpts { serial: Some(serial.into()), timeout_ms: Some(10_000), quiet: true },
    )
    .await;
}

pub fn control(st: &AppState, id: u64, msg: Vec<u8>) -> Result<(), String> {
    let m = st.mirrors.lock().map_err(|e| e.to_string())?;
    let h = m.get(&id).ok_or("MIRROR_GONE")?;
    h.control.send(msg).map_err(|_| "MIRROR_GONE".to_string())
}

pub fn stop(st: &AppState, id: u64) {
    if let Ok(mut m) = st.mirrors.lock() {
        if let Some(h) = m.remove(&id) {
            let _ = h.stop.send(());
        }
    }
}

pub fn stop_all(st: &AppState) {
    let ids: Vec<u64> = st.mirrors.lock().map(|m| m.keys().copied().collect()).unwrap_or_default();
    for id in ids {
        stop(st, id);
    }
}
