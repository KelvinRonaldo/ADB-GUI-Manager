import { describe, expect, it } from 'vitest';
import { ACTION_DOWN, ACTION_UP, avcCodec, keyMsg, parseMessage, scrollMsg, textMsg, touchMsg } from './mirror';

describe('mensagens de controle do scrcpy', () => {
  it('toque tem 32 bytes no formato do servidor', () => {
    const m = touchMsg(ACTION_DOWN, 100, 200, 720, 1600);
    expect(m.length).toBe(32);
    expect(m[0]).toBe(2); // INJECT_TOUCH_EVENT
    expect(m[1]).toBe(ACTION_DOWN);
    expect(m.slice(2, 10)).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe]); // dedo genérico (-2)
    expect(m.slice(10, 14)).toEqual([0, 0, 0, 100]);
    expect(m.slice(14, 18)).toEqual([0, 0, 0, 200]);
    expect(m.slice(18, 22)).toEqual([0x02, 0xd0, 0x06, 0x40]);
    expect(m.slice(22, 24)).toEqual([0xff, 0xff]); // pressão 1.0
    expect(touchMsg(ACTION_UP, 0, 0, 1, 1).slice(22, 24)).toEqual([0, 0]);
  });
  it('rolagem, tecla e texto', () => {
    const s = scrollMsg(10, 20, 720, 1600, 0, 1);
    expect(s.length).toBe(21);
    expect(s[0]).toBe(3);
    expect(s.slice(15, 17)).toEqual([0x08, 0x00]); // 1/16 em ponto fixo de 16 bits
    expect(keyMsg(0, 4)).toEqual([0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(textMsg('ab')).toEqual([1, 0, 0, 0, 2, 97, 98]);
  });
});

describe('vídeo', () => {
  it('codec do WebCodecs vem do SPS', () => {
    const cfg = new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x1f, 0xda, 0, 0, 0, 1, 0x68, 0xce]);
    expect(avcCodec(cfg)).toBe('avc1.42C01F');
    expect(avcCodec(new Uint8Array([0, 0, 1, 0x68]))).toBeNull();
  });
  it('lê sessão e pacote do canal', () => {
    const ses = new Uint8Array([1, 0, 0, 2, 0xd0, 0, 0, 6, 0x40]).buffer;
    expect(parseMessage(ses).session).toEqual({ w: 720, h: 1600 });
    const pk = new Uint8Array([2, 2, 0, 0, 0, 0, 0, 0, 0, 9, 0xaa, 0xbb]).buffer;
    const p = parseMessage(pk).packet!;
    expect(p.key).toBe(true);
    expect(p.config).toBe(false);
    expect(p.pts).toBe(9n);
    expect(Array.from(p.data)).toEqual([0xaa, 0xbb]);
  });
});
