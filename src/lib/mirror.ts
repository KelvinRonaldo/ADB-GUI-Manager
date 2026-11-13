// Protocolo do scrcpy 5.0.1 do lado do app: mensagens de controle (toque, rolagem, teclas)
// e leitura do vídeo H.264 que o Rust repassa. Ver src-tauri/src/mirror.rs.

/** Tipos das mensagens que chegam do Rust pelo canal. */
export const MSG_SESSION = 1;
export const MSG_PACKET = 2;
export const MSG_NAME = 3;

// Tipos das mensagens de controle (ControlMessage.java).
const TYPE_INJECT_KEYCODE = 0;
const TYPE_INJECT_TEXT = 1;
const TYPE_INJECT_TOUCH_EVENT = 2;
const TYPE_INJECT_SCROLL_EVENT = 3;
const TYPE_EXPAND_NOTIFICATION_PANEL = 5;
const TYPE_SET_DISPLAY_POWER = 10;
const TYPE_ROTATE_DEVICE = 11;

/** Toque de dedo genérico (o servidor injeta como toque na tela, não como mouse). */
const POINTER_ID_GENERIC_FINGER = -2n;

export const ACTION_DOWN = 0;
export const ACTION_UP = 1;
export const ACTION_MOVE = 2;

export const KEY = {
  home: 3,
  back: 4,
  power: 26,
  volumeUp: 24,
  volumeDown: 25,
  appSwitch: 187,
  menu: 82,
  enter: 66,
  del: 67,
  forwardDel: 112,
  tab: 61,
  escape: 111,
  dpadUp: 19,
  dpadDown: 20,
  dpadLeft: 21,
  dpadRight: 22,
  moveHome: 122,
  moveEnd: 123,
  pageUp: 92,
  pageDown: 93,
} as const;

/** Tecla do navegador → keycode do Android (só as que não viram texto). */
export function androidKeycode(key: string): number | null {
  const map: Record<string, number> = {
    Enter: KEY.enter,
    Backspace: KEY.del,
    Delete: KEY.forwardDel,
    Tab: KEY.tab,
    Escape: KEY.back,
    ArrowUp: KEY.dpadUp,
    ArrowDown: KEY.dpadDown,
    ArrowLeft: KEY.dpadLeft,
    ArrowRight: KEY.dpadRight,
    Home: KEY.moveHome,
    End: KEY.moveEnd,
    PageUp: KEY.pageUp,
    PageDown: KEY.pageDown,
  };
  return map[key] ?? null;
}

class Writer {
  private buf: DataView;
  private bytes: Uint8Array;
  private pos = 0;
  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.buf = new DataView(this.bytes.buffer);
  }
  u8(v: number) {
    this.buf.setUint8(this.pos, v);
    this.pos += 1;
    return this;
  }
  u16(v: number) {
    this.buf.setUint16(this.pos, v);
    this.pos += 2;
    return this;
  }
  i16(v: number) {
    this.buf.setInt16(this.pos, v);
    this.pos += 2;
    return this;
  }
  i32(v: number) {
    this.buf.setInt32(this.pos, v);
    this.pos += 4;
    return this;
  }
  i64(v: bigint) {
    this.buf.setBigInt64(this.pos, v);
    this.pos += 8;
    return this;
  }
  raw(b: Uint8Array) {
    this.bytes.set(b, this.pos);
    this.pos += b.length;
    return this;
  }
  done(): number[] {
    return Array.from(this.bytes);
  }
}

/** Toque: posição em pixels do vídeo e o tamanho do vídeo (o servidor converte para a tela). */
export function touchMsg(action: number, x: number, y: number, w: number, h: number): number[] {
  return new Writer(32)
    .u8(TYPE_INJECT_TOUCH_EVENT)
    .u8(action)
    .i64(POINTER_ID_GENERIC_FINGER)
    .i32(Math.round(x))
    .i32(Math.round(y))
    .u16(w)
    .u16(h)
    .u16(action === ACTION_UP ? 0 : 0xffff)
    .i32(0)
    .i32(0)
    .done();
}

/** Rolagem: vScroll/hScroll em "cliques" (o servidor multiplica por 16). */
export function scrollMsg(x: number, y: number, w: number, h: number, hScroll: number, vScroll: number): number[] {
  const fx = (v: number) => Math.max(-0x8000, Math.min(0x7fff, Math.round((v / 16) * 0x8000)));
  return new Writer(21)
    .u8(TYPE_INJECT_SCROLL_EVENT)
    .i32(Math.round(x))
    .i32(Math.round(y))
    .u16(w)
    .u16(h)
    .i16(fx(hScroll))
    .i16(fx(vScroll))
    .i32(0)
    .done();
}

export function keyMsg(action: number, keycode: number, metaState = 0): number[] {
  return new Writer(14).u8(TYPE_INJECT_KEYCODE).u8(action).i32(keycode).i32(0).i32(metaState).done();
}

export function textMsg(text: string): number[] {
  const b = new TextEncoder().encode(text).slice(0, 300);
  return new Writer(5 + b.length).u8(TYPE_INJECT_TEXT).i32(b.length).raw(b).done();
}

export function rotateMsg(): number[] {
  return [TYPE_ROTATE_DEVICE];
}

export function notificationsMsg(): number[] {
  return [TYPE_EXPAND_NOTIFICATION_PANEL];
}

/** Liga ou desliga a tela do aparelho; o espelho continua. */
export function displayPowerMsg(on: boolean): number[] {
  return [TYPE_SET_DISPLAY_POWER, on ? 1 : 0];
}

/** Codec do WebCodecs a partir do SPS no pacote de configuração (Annex B): avc1.PPCCLL. */
export function avcCodec(config: Uint8Array): string | null {
  for (let i = 0; i + 4 < config.length; i++) {
    const sc3 = config[i] === 0 && config[i + 1] === 0 && config[i + 2] === 1;
    if (!sc3) continue;
    const nal = i + 3;
    if ((config[nal] & 0x1f) === 7 && nal + 3 < config.length) {
      const hex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
      return `avc1.${hex(config[nal + 1])}${hex(config[nal + 2])}${hex(config[nal + 3])}`;
    }
  }
  return null;
}

export interface Packet {
  config: boolean;
  key: boolean;
  pts: bigint;
  data: Uint8Array;
}

/** Lê uma mensagem do canal. */
export function parseMessage(buf: ArrayBuffer): { session?: { w: number; h: number }; packet?: Packet; name?: string } {
  const v = new DataView(buf);
  const kind = v.getUint8(0);
  if (kind === MSG_SESSION) return { session: { w: v.getUint32(1), h: v.getUint32(5) } };
  if (kind === MSG_NAME) return { name: new TextDecoder().decode(new Uint8Array(buf, 1)) };
  if (kind === MSG_PACKET) {
    const flags = v.getUint8(1);
    return { packet: { config: (flags & 1) !== 0, key: (flags & 2) !== 0, pts: v.getBigUint64(2), data: new Uint8Array(buf, 10) } };
  }
  return {};
}

/** Qualidade do espelho: maior lado, bits por segundo. */
export const QUALITY = {
  low: { maxSize: 800, bitRate: 2_000_000 },
  medium: { maxSize: 1280, bitRate: 4_000_000 },
  high: { maxSize: 1920, bitRate: 8_000_000 },
  original: { maxSize: 0, bitRate: 8_000_000 },
} as const;
export type Quality = keyof typeof QUALITY;
