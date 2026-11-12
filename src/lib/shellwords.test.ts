import { describe, expect, it } from 'vitest';
import { displayCommand, shQuote, splitArgs, stripAdb } from './shellwords';

describe('splitArgs', () => {
  it('separa por espaço e respeita aspas', () => {
    expect(splitArgs(`shell am start -n "com.x/.Main Activity" 'a b'`)).toEqual([
      'shell',
      'am',
      'start',
      '-n',
      'com.x/.Main Activity',
      'a b',
    ]);
  });
  it('aceita argumento vazio entre aspas', () => {
    expect(splitArgs(`connect ""`)).toEqual(['connect', '']);
  });
  it('barra invertida escapa espaço', () => {
    expect(splitArgs('push my\\ file.txt /sdcard')).toEqual(['push', 'my file.txt', '/sdcard']);
  });
  it('acusa aspas abertas', () => {
    expect(() => splitArgs('shell "abc')).toThrow('UNCLOSED_QUOTE');
  });
  it('tira o adb do começo', () => {
    expect(stripAdb(splitArgs('adb devices -l'))).toEqual(['devices', '-l']);
    expect(stripAdb(splitArgs('C:\\pt\\adb.exe devices'.replace(/\\/g, '/')))).toEqual(['devices']);
  });
});

describe('quoting', () => {
  it('mostra o comando copiável', () => {
    expect(displayCommand(['-s', '7A1B', 'shell', 'getprop; echo x'])).toBe('adb -s 7A1B shell "getprop; echo x"');
  });
  it('protege caminhos do aparelho', () => {
    expect(shQuote('/sdcard/Download')).toBe('/sdcard/Download');
    expect(shQuote("/sdcard/it's.txt")).toBe("'/sdcard/it'\\''s.txt'");
  });
});
