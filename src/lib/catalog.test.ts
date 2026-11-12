import { describe, expect, it } from 'vitest';
import { CATALOG, buildArgs, findCommand, helpCommands, helpExcerpt } from './catalog';

const variant = (name: string, id = 'default') => {
  const d = findCommand(name)!;
  return { d, v: d.variants.find((x) => x.id === id)! };
};

describe('catálogo', () => {
  it('nomes únicos e todos com variante', () => {
    const names = CATALOG.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const c of CATALOG) expect(c.variants.length, c.name).toBeGreaterThan(0);
  });
  it('forward com --no-rebind e specs', () => {
    const { d, v } = variant('forward', 'create');
    const b = buildArgs(d, v, { noRebind: true, local: '8080', remote: '8080' });
    expect(b.args).toEqual(['forward', '--no-rebind', 'tcp:8080', 'tcp:8080']);
    expect(b.missing).toEqual([]);
  });
  it('forward para jdwp', () => {
    const { d, v } = variant('forward', 'create');
    expect(buildArgs(d, v, { local: '8700', remote: '4211', remoteType: 'jdwp' }).args).toEqual(['forward', 'tcp:8700', 'jdwp:4211']);
  });
  it('acusa campo obrigatório', () => {
    const { d, v } = variant('pair');
    expect(buildArgs(d, v, { host: '192.168.0.57:37215' }).missing.map((m) => m.en)).toEqual(['Pairing code']);
  });
  it('install com opções e --abi', () => {
    const { d, v } = variant('install');
    expect(buildArgs(d, v, { r: true, g: true, abi: 'arm64-v8a', apk: '/tmp/a b.apk' }).args).toEqual([
      'install',
      '-r',
      '-g',
      '--abi',
      'arm64-v8a',
      '/tmp/a b.apk',
    ]);
  });
  it('push com vários arquivos', () => {
    const { d, v } = variant('push');
    expect(buildArgs(d, v, { sync: true, local: ['/a.txt', '/b c.txt'], remote: '/sdcard/' }).args).toEqual([
      'push',
      '--sync',
      '/a.txt',
      '/b c.txt',
      '/sdcard/',
    ]);
  });
  it('logcat com --pid=, regex e filterspecs', () => {
    const { d, v } = variant('logcat');
    expect(buildArgs(d, v, { v: 'threadtime', pid: '4211', e: 'erro|exc', specs: 'MyTag:V *:S' }).args).toEqual([
      'logcat',
      '-v',
      'threadtime',
      '--pid=4211',
      '-e',
      'erro|exc',
      'MyTag:V',
      '*:S',
    ]);
  });
  it('wait-for monta o nome', () => {
    const { d, v } = variant('wait-for');
    expect(buildArgs(d, v, { transport: 'usb', state: 'device' }).args).toEqual(['wait-for-usb-device']);
  });
  it('shell manda o comando como um argumento só', () => {
    const { d, v } = variant('shell');
    expect(buildArgs(d, v, { x: true, command: 'ls -la /sdcard' }).args).toEqual(['shell', '-x', 'ls -la /sdcard']);
  });
  it('lê o adb help', () => {
    const help = `global options:
 -s SERIAL                use device with given serial
networking:
 connect HOST[:PORT]      connect to a device via TCP/IP [default port=5555]
 forward --list           list all forward socket connections
 forward [--no-rebind] LOCAL REMOTE
     forward socket connection using:
       tcp:<port> (<local> may be "tcp:0" to pick any open port)
 forward --remove LOCAL   remove specific forward socket connection
 wait-for[-TRANSPORT]-STATE
     wait for device to be in the given state
`;
    const s = helpCommands(help);
    expect(s.has('connect')).toBe(true);
    expect(s.has('forward')).toBe(true);
    expect(s.has('wait-for')).toBe(true);
    expect(s.has('pair')).toBe(false);
    const ex = helpExcerpt(help, 'forward');
    expect(ex).toContain('forward --list');
    expect(ex).toContain('tcp:<port>');
    expect(ex).toContain('forward --remove LOCAL');
  });
});
