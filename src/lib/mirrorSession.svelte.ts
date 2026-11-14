// Sessão de espelhamento: sobe o scrcpy-server, decodifica o vídeo (WebCodecs) num <canvas> e
// manda toques e teclas. A mesma sessão serve à página do app, à tela cheia e à janela destacada.
import { api, isTauri, listen, mirrorStart } from './ipc';
import { classify, type AdbError } from './errors';
import { app } from './state.svelte';
import { wakeScreen } from './actions';
import {
  QUALITY,
  avcCodec,
  displayPowerMsg,
  keyMsg,
  parseMessage,
  resetVideoMsg,
  type Quality,
} from './mirror';

export type Phase = 'idle' | 'starting' | 'running' | 'error';

export interface SessionOptions {
  quality: Quality;
  maxFps: number;
  control: boolean;
  stayAwake: boolean;
}

const hasWebCodecs = typeof window !== 'undefined' && 'VideoDecoder' in window;

function decoderError(raw: string): AdbError {
  return { kind: 'mirrorDecoder', code: 0, cmd: '', raw, actions: ['retry'], params: { os: app.init?.os ?? '' } };
}

export class MirrorSession {
  phase = $state<Phase>('idle');
  error = $state<AdbError | null>(null);
  mirrorId = $state<number | null>(null);
  serial = $state('');
  devName = $state('');
  size = $state({ w: 0, h: 0 });
  fps = $state(0);
  screenOff = $state(false);
  control = $state(true);

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private decoder: VideoDecoder | null = null;
  private config: Uint8Array | null = null;
  private codec = '';
  private needKey = true;
  private lastReset = 0;
  private lastFrameAt = 0;
  private lastPacketAt = 0;
  private frames = 0;
  private fpsTimer: ReturnType<typeof setInterval> | undefined;
  private offEnded: (() => void) | undefined;
  private disposed = false;

  constructor() {
    listen<{ id: number; error: string | null }>('mirror-ended', (e) => {
      if (e.id !== this.mirrorId) return;
      this.mirrorId = null;
      clearInterval(this.fpsTimer);
      this.resetDecoder();
      if (e.error) {
        this.error = classify(`MIRROR_SERVER: ${e.error}`);
        this.phase = 'error';
      } else this.phase = 'idle';
    }).then((off) => {
      if (this.disposed) off();
      else this.offEnded = off;
    });
  }

  get active(): boolean {
    return this.phase === 'starting' || this.phase === 'running';
  }

  /** O <canvas> onde o vídeo é desenhado. Trocou de canvas: pede um quadro novo ao aparelho. */
  setCanvas(c: HTMLCanvasElement | null): void {
    if (c === this.canvas) return;
    this.canvas = c;
    this.ctx = null;
    if (c && this.phase === 'running') this.requestKeyFrame();
  }

  private requestKeyFrame(): void {
    if (!this.control || this.mirrorId == null) return;
    this.lastReset = Date.now();
    this.needKey = true;
    this.send(resetVideoMsg());
  }

  private resetDecoder(): void {
    try {
      this.decoder?.close();
    } catch {
      /* já fechado */
    }
    this.decoder = null;
    this.ctx = null;
    this.config = null;
    this.codec = '';
    this.needKey = true;
  }

  private makeDecoder(c: string): void {
    this.resetDecoder();
    this.codec = c;
    this.decoder = new VideoDecoder({
      output: (frame) => {
        const canvas = this.canvas;
        if (canvas) {
          if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
            canvas.width = frame.displayWidth;
            canvas.height = frame.displayHeight;
          }
          // O <canvas> é recriado a cada início: o contexto tem de ser o do canvas atual.
          if (this.ctx?.canvas !== canvas) this.ctx = canvas.getContext('2d');
          this.ctx?.drawImage(frame, 0, 0);
        }
        this.frames++;
        this.lastFrameAt = Date.now();
        frame.close();
      },
      error: (e) => this.fail(decoderError(String(e))),
    });
    this.decoder.configure({ codec: c, optimizeForLatency: true });
  }

  private onData(buf: ArrayBuffer): void {
    const m = parseMessage(buf);
    if (m.name !== undefined) {
      this.devName = m.name;
      return;
    }
    if (m.session) {
      this.size = m.session;
      this.phase = 'running';
      return;
    }
    const p = m.packet;
    if (!p) return;
    this.lastPacketAt = Date.now();
    if (p.config) {
      const c = avcCodec(p.data);
      if (!c) return this.fail(decoderError('SPS não encontrado no pacote de configuração'));
      const keep = this.codec === c && this.decoder;
      if (!keep) this.makeDecoder(c);
      this.config = p.data.slice();
      this.needKey = true;
      return;
    }
    const decoder = this.decoder;
    if (!decoder || decoder.state !== 'configured') return;
    if (this.needKey && !p.key) return;
    let data = p.data;
    if (p.key && this.config) {
      // No formato Annex B o quadro-chave leva o SPS/PPS na frente.
      const merged = new Uint8Array(this.config.length + data.length);
      merged.set(this.config);
      merged.set(data, this.config.length);
      data = merged;
    }
    this.needKey = false;
    // Atrasou demais: pede um recomeço do vídeo e descarta até o quadro-chave que ele traz.
    // Sem pedir, a espera pode ser eterna: há encoder (MTK do L400) que só manda quadro-chave
    // quando a imagem muda muito. Sem controle não há como pedir: segue decodificando tudo.
    if (decoder.decodeQueueSize > 30 && !p.key && this.control && Date.now() - this.lastReset > 2000) {
      this.requestKeyFrame();
      return;
    }
    try {
      decoder.decode(new EncodedVideoChunk({ type: p.key ? 'key' : 'delta', timestamp: Number(p.pts), data }));
    } catch (e) {
      this.fail(decoderError(String(e)));
    }
  }

  async start(serial: string, o: SessionOptions): Promise<void> {
    if (!serial || this.active) return;
    if (!hasWebCodecs) return this.fail(decoderError('VideoDecoder indisponível'));
    try {
      const sup = await VideoDecoder.isConfigSupported({ codec: 'avc1.42E01F', optimizeForLatency: true });
      if (!sup.supported) return this.fail(decoderError('H.264 sem suporte no VideoDecoder'));
    } catch (e) {
      return this.fail(decoderError(String(e)));
    }
    this.error = null;
    this.phase = 'starting';
    this.serial = serial;
    this.control = o.control;
    this.devName = '';
    this.size = { w: 0, h: 0 };
    this.screenOff = false;
    this.lastFrameAt = 0;
    this.lastPacketAt = 0;
    this.resetDecoder();
    try {
      // Tela apagada vira vídeo preto; sem controle, nada a acenderia depois.
      await wakeScreen(serial);
      const q = QUALITY[o.quality] ?? QUALITY.medium;
      this.mirrorId = await mirrorStart(
        serial,
        { maxSize: q.maxSize, bitRate: q.bitRate, maxFps: o.maxFps, control: o.control, stayAwake: o.stayAwake },
        (b) => this.onData(b),
      );
      if (this.disposed) return void this.stop();
      // Sem o Tauri (prévia no navegador) não há vídeo: mostra a área como se estivesse rodando.
      if (!isTauri) {
        this.size = { w: 720, h: 1600 };
        this.phase = 'running';
      }
      this.frames = 0;
      clearInterval(this.fpsTimer);
      this.fpsTimer = setInterval(() => {
        this.fps = this.frames;
        this.frames = 0;
        // Chega vídeo mas nenhum quadro sai há 3 s (esperando um quadro-chave que não vem):
        // pede um recomeço do vídeo ao servidor.
        const now = Date.now();
        if (this.control && this.lastFrameAt && now - this.lastPacketAt < 1500 && now - this.lastFrameAt > 3000 && now - this.lastReset > 3000) {
          this.requestKeyFrame();
        }
      }, 1000);
      this.canvas?.focus();
    } catch (e) {
      this.fail(classify(String(e))!);
    }
  }

  fail(e: AdbError): void {
    this.error = e;
    this.phase = 'error';
    this.stop(false);
  }

  async stop(toIdle = true): Promise<void> {
    clearInterval(this.fpsTimer);
    const id = this.mirrorId;
    this.mirrorId = null;
    this.resetDecoder();
    if (toIdle) this.phase = 'idle';
    if (id != null) await api.mirrorStop(id).catch(() => undefined);
  }

  send(msg: number[]): void {
    if (this.mirrorId == null || !this.control) return;
    api.mirrorControl(this.mirrorId, msg).catch(() => undefined);
  }

  /** Aperta e solta uma tecla do aparelho. */
  press(code: number): void {
    this.send(keyMsg(0, code));
    this.send(keyMsg(1, code));
    this.canvas?.focus();
  }

  toggleScreen(): void {
    this.screenOff = !this.screenOff;
    this.send(displayPowerMsg(!this.screenOff));
  }

  dispose(): void {
    this.disposed = true;
    this.offEnded?.();
    this.stop();
  }
}

/** Janela destacada aberta (vista da janela principal). */
export const detached = $state({ open: false, serial: '' });
/** Pedido para a página começar o espelho ao abrir (volta da janela destacada). */
export const pending = $state({ serial: '' });
