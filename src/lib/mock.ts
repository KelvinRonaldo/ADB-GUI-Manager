// Backend simulado para abrir a interface num navegador comum (sem Tauri).
// Serve para ver e revisar as telas; nada aqui fala com um adb de verdade.
import type { Device, InitInfo, LogEntry, RunResult } from './types';

type Cb = (p: unknown) => void;
const listeners = new Map<string, Set<Cb>>();
function emit(event: string, payload: unknown) {
  listeners.get(event)?.forEach((cb) => cb(payload));
}

export function mockListen(event: string, cb: Cb): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(cb);
  return () => listeners.get(event)?.delete(cb);
}

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
let adbOk = !params.has('noadb');
let nextId = 1;
let settings: Record<string, unknown> = params.has('fresh') ? {} : { tourDone: !params.has('tour'), pageGuides: params.has('guides') ? 'ask' : 'never' };

let DEVICES: Device[] = [
  { serial: '7A1B2C3D', state: 'device', stateKind: 'device', connection: 'usb', usb: '1-4', product: 'GPOS760', model: 'GPOS760', device: 'GPOS760', transportId: '3' },
  { serial: '192.168.0.42:5555', state: 'device', stateKind: 'device', connection: 'wifi', product: 'P2', model: 'P2', device: 'P2', transportId: '5' },
  { serial: 'R5CT90XYZ', state: 'unauthorized', stateKind: 'unauthorized', connection: 'usb', usb: '1-5', transportId: '7' },
  // ?many: outros estados, para ver as três visualizações da lista.
  ...(params.has('many')
    ? ([
        { serial: 'DX8K0042', state: 'recovery', stateKind: 'recovery', connection: 'usb', usb: '1-7', product: 'DX8000', model: 'DX8000', transportId: '8' },
        { serial: '192.168.0.90:5555', state: 'offline', stateKind: 'offline', connection: 'wifi', transportId: '9' },
        { serial: 'emulator-5554', state: 'device', stateKind: 'device', connection: 'emulator', product: 'sdk_gphone64', model: 'sdk_gphone64_x86_64', transportId: '10' },
      ] as Device[])
    : []),
];

// Para testar o fluxo USB → Wi-Fi no navegador: __mockPlugUsb() liga um aparelho USB novo.
// Depois do tcpip, o "cabo sai" sozinho em 4 s; o connect põe o aparelho Wi-Fi na lista.
const NEW_USB: Device = { serial: 'NEWUSB01', state: 'device', stateKind: 'device', connection: 'usb', usb: '1-6', product: 'GPOS760', model: 'GPOS760', device: 'GPOS760', transportId: '11' };
const NEW_IP = '192.168.0.77';
let failConnect = false;
let updateCanceled = false;
const MOCK_NOTES = '- Atualização dentro do app, pelas Releases do GitHub\n- Correção: a versão no Sobre mostrava 0.1.0';
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__mockPlugUsb = (fail = false) => {
    failConnect = fail;
    DEVICES = [...DEVICES.filter((d) => d.serial !== NEW_USB.serial && d.serial !== `${NEW_IP}:5555`), NEW_USB];
    emit('devices', { devices: DEVICES, first: false });
  };
}

const PROPS: Record<string, Record<string, string>> = {
  '7A1B2C3D': {
    'ro.product.manufacturer': 'Gertec',
    'ro.product.brand': 'Gertec',
    'ro.product.model': 'GPOS760',
    'ro.product.device': 'GPOS760',
    'ro.serialno': '7A1B2C3D',
    'ro.build.version.release': '10',
    'ro.build.version.sdk': '29',
    'ro.build.version.security_patch': '2023-05-05',
    'ro.build.display.id': 'GPOS760_3.9.3',
    'ro.product.cpu.abilist': 'arm64-v8a,armeabi-v7a',
    'ro.debuggable': '0',
    'ro.sf.lcd_density': '320',
  },
  '192.168.0.42:5555': {
    'ro.product.manufacturer': 'SUNMI',
    'ro.product.model': 'P2',
    'ro.serialno': 'P2-0042',
    'ro.build.version.release': '11',
    'ro.build.version.sdk': '30',
    'ro.build.version.security_patch': '2023-02-01',
    'ro.build.display.id': 'P2_A11_2.4.1',
    'ro.product.cpu.abilist': 'armeabi-v7a',
    'ro.debuggable': '0',
    'ro.sf.lcd_density': '320',
  },
};

const HELP = `Android Debug Bridge version 1.0.41
Version 35.0.2

global options:
 -a                       listen on all network interfaces, not just localhost
 -d                       use USB device (error if multiple devices connected)
 -e                       use TCP/IP device (error if multiple TCP/IP devices available)
 -s SERIAL                use device with given serial (overrides $ANDROID_SERIAL)
 -t ID                    use device with given transport id
 -H                       name of adb server host [default=localhost]
 -P                       port of adb server [default=5037]

general commands:
 devices [-l]             list connected devices (-l for long output)
 help                     show this help message
 version                  show version num

networking:
 connect HOST[:PORT]      connect to a device via TCP/IP [default port=5555]
 disconnect [HOST[:PORT]]
     disconnect from given TCP/IP device [default port=5555], or all
 pair HOST[:PORT] [PAIRING CODE]
     pair with a device for secure TCP/IP communication
 forward --list           list all forward socket connections
 forward [--no-rebind] LOCAL REMOTE
     forward socket connection using:
       tcp:<port> (<local> may be "tcp:0" to pick any open port)
       localabstract:<unix domain socket name>
       jdwp:<process pid> (remote only)
 forward --remove LOCAL   remove specific forward socket connection
 forward --remove-all     remove all forward socket connections
 mdns check               check if mdns discovery is available
 mdns services            list all discovered services

file transfer:
 push [--sync] [-z ALGORITHM] [-Z] [-n] LOCAL... REMOTE
     copy local files/directories to device
 pull [-a] [-z ALGORITHM] [-Z] REMOTE... LOCAL
     copy files/dirs from device

shell:
 shell [-e ESCAPE] [-n] [-Tt] [-x] [COMMAND...]
     run remote shell command (interactive shell if no command given)

app installation (see also \`adb shell cmd package help\`):
 install [-lrtsdg] [--instant] PACKAGE
     push a single package to the device and install it
 uninstall [-k] APPLICATION_ID
     remove this APPLICATION_ID from the device

scripting:
 wait-for[-TRANSPORT]-STATE...
     wait for device to be in a given state
 get-state                print offline | bootloader | device
 reboot [bootloader|recovery|sideload|sideload-auto-reboot]
 tcpip PORT               restart adbd listening on TCP on PORT

internal debugging:
 start-server             ensure that there is a server running
 kill-server              kill the server if it is running
 reconnect                kick connection from host side to force reconnect
`;

function strip(args: string[]): { serial: string | null; rest: string[] } {
  const a = [...args];
  let serial: string | null = null;
  const i = a.indexOf('-s');
  if (i >= 0) {
    serial = a[i + 1];
    a.splice(i, 2);
  }
  return { serial, rest: a };
}

function display(args: string[]): string {
  return ['adb', ...args.map((x) => (/^[\w/.:@%,=+-]+$/.test(x) ? x : `"${x}"`))].join(' ');
}

function output(rest: string[], serial: string | null): { code: number; stdout: string; stderr: string } {
  const c = rest.join(' ');
  const props = PROPS[serial ?? ''] ?? PROPS['7A1B2C3D'];
  if (rest[0] === 'devices')
    return { code: 0, stdout: 'List of devices attached\n' + DEVICES.map((d) => `${d.serial}\t${d.state}`).join('\n') + '\n', stderr: '' };
  if (rest[0] === 'help') return { code: 0, stdout: HELP, stderr: '' };
  if (rest[0] === 'version') return { code: 0, stdout: 'Android Debug Bridge version 1.0.41\nVersion 35.0.2\nInstalled as /usr/bin/adb\n', stderr: '' };
  if (rest[0] === 'connect') {
    if (rest[1] === `${NEW_IP}:5555`) {
      if (failConnect) return { code: 0, stdout: `failed to connect to ${rest[1]}: Connection refused\n`, stderr: '' };
      setTimeout(() => {
        DEVICES = [...DEVICES.filter((d) => d.serial !== rest[1]), { ...NEW_USB, serial: rest[1], connection: 'wifi', usb: null, transportId: '12' }];
        emit('devices', { devices: DEVICES, first: false });
      }, 300);
    }
    return { code: 0, stdout: `connected to ${rest[1]}\n`, stderr: '' };
  }
  if (rest[0] === 'tcpip') {
    if (serial === NEW_USB.serial) {
      setTimeout(() => {
        DEVICES = DEVICES.filter((d) => d.serial !== NEW_USB.serial);
        emit('devices', { devices: DEVICES, first: false });
      }, 4000);
    }
    return { code: 0, stdout: `restarting in TCP mode port: ${rest[1]}\n`, stderr: '' };
  }
  if (rest[0] === 'disconnect') return { code: 0, stdout: `disconnected ${rest[1] ?? 'everything'}\n`, stderr: '' };
  if (rest[0] === 'pair') return { code: 0, stdout: `Successfully paired to ${rest[1]} [guid=adb-XYZ]\n`, stderr: '' };
  if (rest[0] === 'mdns') return { code: 0, stdout: 'List of discovered mdns services\n', stderr: '' };
  if (rest[0] === 'wait-for-device') return { code: 0, stdout: '', stderr: '' };
  if (rest[0] === 'root') return { code: 0, stdout: 'adbd cannot run as root in production builds\n', stderr: '' };
  if (rest[0] === 'shell') {
    if (c.includes('getprop') && !c.includes('getprop ')) return { code: 0, stdout: Object.entries(props).map(([k, v]) => `[${k}]: [${v}]`).join('\n'), stderr: '' };
    if (c.includes('getprop ')) return { code: 0, stdout: (props[rest[rest.length - 1].split(' ').pop()!] ?? '') + '\n', stderr: '' };
    if (c.includes('dumpsys battery')) return { code: 0, stdout: 'Current Battery Service state:\n  AC powered: false\n  USB powered: true\n  status: 2\n  health: 2\n  level: 82\n  scale: 100\n  voltage: 4105\n  temperature: 310\n  technology: Li-ion\n', stderr: '' };
    if (c.includes('df')) return { code: 0, stdout: 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/block/dm-9  11G  5.1G  5.9G  47% /data\n', stderr: '' };
    if (c.includes('wm size')) return { code: 0, stdout: 'Physical size: 720x1280\n', stderr: '' };
    if (c.includes('wm density')) return { code: 0, stdout: 'Physical density: 320\n', stderr: '' };
    if (c.includes('ip ')) return { code: 0, stdout: '33: wlan0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500\n    inet 192.168.0.57/24 brd 192.168.0.255 scope global wlan0\n', stderr: '' };
    if (c.includes('ps ')) return { code: 0, stdout: 'USER  PID  PPID  NAME\nroot  1  0  init\nu0_a112  4211  580  br.com.aditum.smartpostef\n', stderr: '' };
    if (c.includes('pm path')) return { code: 0, stdout: 'package:/data/app/~~x/com.exemplo.loja-1/base.apk\n', stderr: '' };
    if (c.includes('dumpsys package')) return { code: 0, stdout: 'Packages:\n  Package [com.exemplo.loja] (abc):\n    versionCode=42 minSdk=24 targetSdk=33\n    versionName=1.4.2\n    runtime permissions:\n      android.permission.CAMERA: granted=true\n      android.permission.ACCESS_FINE_LOCATION: granted=false\n', stderr: '' };
    if (c.includes('pidof')) return { code: 0, stdout: '4211\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  }
  if (rest[0]?.startsWith('install')) {
    if (c.includes('antigo')) return { code: 1, stdout: 'Performing Streamed Install\n', stderr: 'adb: failed to install antigo.apk: Failure [INSTALL_FAILED_VERSION_DOWNGRADE: Downgrade detected]\n' };
    return { code: 0, stdout: 'Performing Streamed Install\nSuccess\n', stderr: '' };
  }
  return { code: 0, stdout: '', stderr: '' };
}

function log(id: number, cmd: string, state: 'running' | 'done', code?: number, ms?: number, error?: string) {
  const e: LogEntry = { id, ts: Date.now(), cmd, state, code, durationMs: ms, error };
  emit('cmdlog', e);
}

const streams = new Map<number, ReturnType<typeof setInterval>>();
const ptys = new Map<number, string>();

const TAGS = ['SmartPosTef', 'Network', 'Payment', 'ActivityManager', 'Printer'];
function logcatLine(): string {
  const d = new Date();
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  const lvl = ['D', 'D', 'I', 'I', 'W', 'E', 'V'][Math.floor(Math.random() * 7)];
  const tag = TAGS[Math.floor(Math.random() * TAGS.length)];
  const msgs = ['Carregando tabelas EMV: 38 registros', 'POST /v1/tef/init 200 em 412 ms', 'Pronto para vender', 'Pouco papel', 'erro ao ler cartão: tempo esgotado', 'Start proc 4211:br.com.aditum.smartpostef'];
  const msg = msgs[Math.floor(Math.random() * msgs.length)];
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}  4211  4230 ${lvl} ${tag}: ${msg}\n`;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mockInvoke(cmd: string, a: Record<string, unknown> = {}): Promise<unknown> {
  switch (cmd) {
    case 'app_init': {
      setTimeout(() => emit('devices', { devices: adbOk ? DEVICES : [], first: true }), 400);
      const info: InitInfo = {
        adb: adbOk ? { path: '/usr/bin/adb', source: 'path', version: { adbVersion: '1.0.41', toolsVersion: '35.0.2', installedAs: '/usr/bin/adb' } } : null,
        checked: [
          { source: 'path', path: 'adb', found: adbOk },
          { source: 'ANDROID_HOME', path: '$ANDROID_HOME/platform-tools/adb', found: false },
          { source: 'ANDROID_SDK_ROOT', path: '$ANDROID_SDK_ROOT/platform-tools/adb', found: false },
          { source: 'sdkDefault', path: '/home/usuario/Android/Sdk/platform-tools/adb', found: false },
          { source: 'downloaded', path: '/home/usuario/.local/share/br.com.kelvinronaldo.adbguimanager/platform-tools/adb', found: false },
        ],
        cliAdb: null,
        settings,
        history: [],
        os: 'linux',
        dataDir: '/home/usuario/.local/share/br.com.kelvinronaldo.adbguimanager',
        downloadedAdb: '/home/usuario/.local/share/br.com.kelvinronaldo.adbguimanager/platform-tools/adb',
        downloadedExists: false,
        downloadUrl: 'https://dl.google.com/android/repository/platform-tools-latest-linux.zip',
        serverRunning: true,
        home: '/home/usuario',
      };
      return info;
    }
    case 'adb_validate': {
      const p = String(a.path ?? '');
      if (!p) throw 'empty';
      if (!p.includes('adb')) throw 'notFound';
      return { adbVersion: '1.0.41', toolsVersion: '35.0.2', installedAs: p };
    }
    case 'adb_use':
      adbOk = true;
      setTimeout(() => emit('devices', { devices: DEVICES, first: true }), 300);
      return { path: String(a.path || '/usr/bin/adb'), source: String(a.mode), version: { adbVersion: '1.0.41', toolsVersion: '35.0.2' } };
    case 'settings_save':
      settings = a.settings as Record<string, unknown>;
      return null;
    case 'adb_run': {
      const args = (a.args as string[]) ?? [];
      const full = a.serial ? ['-s', String(a.serial), ...args] : args;
      const { serial, rest } = strip(full);
      const id = nextId++;
      const c = display(full);
      if (!a.quiet) log(id, c, 'running');
      await wait(120 + Math.random() * 200);
      const o = output(rest, serial);
      if (!a.quiet) log(id, c, 'done', o.code, 140, o.code ? o.stderr.trim().split('\n').pop() : undefined);
      const r: RunResult = { id, cmd: c, code: o.code, stdout: o.stdout, stderr: o.stderr, durationMs: 140, timedOut: false };
      return r;
    }
    case 'adb_run_to_file': {
      const id = nextId++;
      const c = display([...(a.serial ? ['-s', String(a.serial)] : []), ...((a.args as string[]) ?? [])]) + ' > ' + a.path;
      log(id, c, 'running');
      await wait(300);
      log(id, c, 'done', 0, 300);
      return { id, cmd: c, code: 0, stdout: '183422 bytes', stderr: '', durationMs: 300, timedOut: false };
    }
    case 'stream_start': {
      const id = nextId++;
      const args = (a.args as string[]) ?? [];
      const c = display([...(a.serial ? ['-s', String(a.serial)] : []), ...args]);
      log(id, c, 'running');
      if (args[0] === 'logcat') {
        const h = setInterval(() => emit('stream', { id, kind: 'out', data: logcatLine() + (Math.random() > 0.6 ? logcatLine() : '') }), 350);
        streams.set(id, h);
      } else {
        setTimeout(() => {
          const { serial, rest } = strip(a.serial ? ['-s', String(a.serial), ...args] : args);
          const o = output(rest, serial);
          if (o.stdout) emit('stream', { id, kind: 'out', data: o.stdout });
          if (o.stderr) emit('stream', { id, kind: 'err', data: o.stderr });
          emit('stream', { id, kind: 'end', data: '', code: o.code });
          log(id, c, 'done', o.code, 400);
        }, 400);
      }
      return id;
    }
    case 'stream_stop': {
      const id = Number(a.id);
      clearInterval(streams.get(id));
      streams.delete(id);
      emit('stream', { id, kind: 'end', data: '', code: 130 });
      return null;
    }
    case 'pty_open': {
      const id = nextId++;
      const args = (a.args as string[]) ?? [];
      const c = display([...(a.serial ? ['-s', String(a.serial)] : []), ...args]);
      log(id, c, 'running');
      ptys.set(id, '');
      if (args[0] === 'push' || args[0] === 'pull') {
        let pct = 0;
        const h = setInterval(() => {
          pct += 17;
          if (pct >= 100) {
            clearInterval(h);
            emit('pty', { id, data: `\r${args[args.length - 2]}: 1 file pushed, 0 skipped. 12.4 MB/s (62914560 bytes in 4.8s)\r\n` });
            emit('pty-exit', { id, code: 0 });
            log(id, c, 'done', 0, 4800);
          } else emit('pty', { id, data: `\r[ ${pct}%] ${args[args.length - 1]}` });
        }, 400);
      } else {
        setTimeout(() => emit('pty', { id, data: 'GPOS760:/ $ ' }), 200);
      }
      return id;
    }
    case 'pty_write': {
      const id = Number(a.id);
      const data = String(a.data);
      let buf = ptys.get(id) ?? '';
      for (const ch of data) {
        if (ch === '\r') {
          emit('pty', { id, data: '\r\n' });
          const o = output(['shell', buf], null);
          if (o.stdout) emit('pty', { id, data: o.stdout.replace(/\n/g, '\r\n') });
          emit('pty', { id, data: 'GPOS760:/ $ ' });
          buf = '';
        } else if (ch === '\x7f') {
          if (buf) {
            buf = buf.slice(0, -1);
            emit('pty', { id, data: '\b \b' });
          }
        } else {
          buf += ch;
          emit('pty', { id, data: ch });
        }
      }
      ptys.set(id, buf);
      return null;
    }
    case 'pty_resize':
      return null;
    case 'pty_close':
      emit('pty-exit', { id: Number(a.id), code: 130 });
      return null;
    case 'device_summary': {
      const serial = String(a.serial);
      await wait(200);
      return {
        serial,
        props: PROPS[serial] ?? PROPS['7A1B2C3D'],
        battery: { level: serial.includes(':') ? 47 : 82, status: serial.includes(':') ? 'discharging' : 'charging', health: 'good', powered: serial.includes(':') ? [] : ['usb'], voltageMv: 4105, temperatureC: 31, technology: 'Li-ion' },
        wifiIp: serial.includes(':') ? '192.168.0.42' : '192.168.0.57',
        storage: { totalKb: 16 * 1024 * 1024, usedKb: serial.includes(':') ? 9.8 * 1024 * 1024 : 5.1 * 1024 * 1024, availKb: 6 * 1024 * 1024 },
        raw: Object.entries(PROPS[serial] ?? {}).map(([k, v]) => `[${k}]: [${v}]`).join('\n'),
        result: { id: 0, cmd: '', code: 0, stdout: '', stderr: '', durationMs: 120, timedOut: false },
      };
    }
    case 'mdns_services':
      return [
        { name: 'adb-7A1B2C3D-xyz', service: '_adb-tls-pairing._tcp', address: '192.168.0.57:37215' },
        { name: 'adb-P2-0042', service: '_adb-tls-connect._tcp', address: '192.168.0.42:41235' },
      ];
    case 'remote_list': {
      const id = nextId++;
      const c = `adb -s ${a.serial} shell "ls -la ${a.path}"`;
      log(id, c, 'running');
      await wait(150);
      log(id, c, 'done', 0, 150);
      return {
        entries: [
          { name: 'Aditum', perms: 'drwxrwx---', isDir: true, isLink: false, size: null, modified: '2026-11-10 09:12', owner: 'root', group: 'everybody' },
          { name: 'Download', perms: 'drwxrwx---', isDir: true, isLink: false, size: null, modified: '2026-11-12 10:41', owner: 'root', group: 'everybody' },
          { name: 'bugreport-2026-11-12.zip', perms: '-rw-rw----', isDir: false, isLink: false, size: 8601234, modified: '2026-11-12 10:41', owner: 'root', group: 'everybody' },
          { name: 'screen-104210.png', perms: '-rw-rw----', isDir: false, isLink: false, size: 412000, modified: '2026-11-12 10:42', owner: 'root', group: 'everybody' },
          { name: 'tabelas.json', perms: '-rw-rw----', isDir: false, isLink: false, size: 98304, modified: '2026-11-11 17:02', owner: 'root', group: 'everybody' },
        ],
        result: { id, cmd: c, code: 0, stdout: '', stderr: '', durationMs: 150, timedOut: false },
      };
    }
    case 'packages_list': {
      const id = nextId++;
      const c = `adb -s ${a.serial} shell pm list packages -U --show-versioncode`;
      log(id, c, 'running');
      await wait(200);
      log(id, c, 'done', 0, 200);
      return {
        packages: [
          { name: 'br.com.aditum.smartpostef', versionCode: '3000001', uid: '10112' },
          { name: 'com.android.chrome', versionCode: '599311', uid: '10087' },
          { name: 'com.exemplo.loja', versionCode: '42', uid: '10120' },
          { name: 'com.gertec.gedi', versionCode: '210', uid: '1000' },
          { name: 'com.whatsapp', versionCode: '232076', uid: '10101' },
          { name: 'org.mozilla.firefox', versionCode: '2015983', uid: '10115' },
        ],
        result: { id, cmd: c, code: 0, stdout: '', stderr: '', durationMs: 200, timedOut: false },
      };
    }
    case 'local_list':
      return [
        { name: 'antigos', path: '/home/usuario/Downloads/antigos', isDir: true },
        { name: 'SmartPosTef-LD-GPOS760-3.0.1-debug.apk', path: '/home/usuario/Downloads/SmartPosTef-LD-GPOS760-3.0.1-debug.apk', isDir: false, size: 62914560, modified: Date.now() },
        { name: 'SmartPosTef-LD-P2-3.0.1-debug.apk', path: '/home/usuario/Downloads/SmartPosTef-LD-P2-3.0.1-debug.apk', isDir: false, size: 61865984, modified: Date.now() },
        { name: 'config.json', path: '/home/usuario/Downloads/config.json', isDir: false, size: 4096, modified: Date.now() },
      ];
    case 'local_parent': {
      const p = String(a.path);
      const i = p.lastIndexOf('/');
      return i > 0 ? p.slice(0, i) : '/';
    }
    case 'local_roots':
      return ['/'];
    case 'write_text_file':
      return null;
    case 'platform_tools_download':
      for (let i = 1; i <= 5; i++) {
        await wait(250);
        emit('download', { received: i * 1500000, total: 7500000, phase: 'download' });
      }
      emit('download', { received: 7500000, total: 7500000, phase: 'extract' });
      await wait(300);
      return '/home/usuario/.local/share/br.com.kelvinronaldo.adbguimanager/platform-tools/adb';
    // Atualização do app. ?update=none|neterr|interrupt|sig|perm, ?pkg=deb|portable|dev,
    // ?updated (acabou de reabrir na versão nova), ?notfinished.
    case 'update_info': {
      const pkg = params.get('pkg') ?? 'appimage';
      return {
        version: params.has('updated') ? '0.3.0' : '0.2.1',
        package: pkg,
        location: pkg === 'portable' ? 'C:\\Ferramentas\\ADB-GUI-Manager\\adb-gui-manager.exe' : pkg === 'deb' ? '/usr/bin/adb-gui-manager' : '/home/usuario/Aplicativos/ADB-GUI-Manager.AppImage',
        canUpdate: pkg !== 'dev',
        lastInstall: params.has('updated')
          ? { result: 'updated', from: '0.2.1', to: '0.3.0', notes: MOCK_NOTES }
          : params.has('notfinished')
            ? { result: 'notFinished', from: '0.2.1', to: '0.3.0', notes: MOCK_NOTES }
            : null,
      };
    }
    case 'update_check': {
      await wait(900);
      const u = params.get('update');
      if (u === 'neterr') throw new Error('UPDATE_NETWORK: error sending request for url (https://github.com/…/latest.json): connection timed out');
      if (u === 'none') return { available: false, current: '0.2.1', downloaded: false, openSessions: 0 };
      return { available: true, current: '0.2.1', version: '0.3.0', notes: MOCK_NOTES, date: '2026-11-13T12:00:00Z', size: 86_000_000, downloaded: false, openSessions: 2 };
    }
    case 'update_download': {
      updateCanceled = false;
      const total = 86_000_000;
      const u = params.get('update');
      for (let i = 1; i <= 20; i++) {
        await wait(200);
        if (updateCanceled) throw new Error('UPDATE_CANCELED');
        if (u === 'interrupt' && i === 8) throw new Error('UPDATE_INTERRUPTED: connection reset by peer');
        emit('update-progress', { received: (total * i) / 20, total, bytesPerSec: 6_500_000 });
      }
      if (u === 'sig') throw new Error('UPDATE_SIGNATURE: the signature does not match');
      return null;
    }
    case 'update_cancel':
      updateCanceled = true;
      return null;
    case 'update_install': {
      await wait(1800);
      if (params.get('update') === 'perm') throw new Error('UPDATE_PERMISSION: Permission denied (os error 13)');
      // "Reabre" o app na versão nova.
      location.search = '?updated';
      await wait(10_000);
      return null;
    }
    case 'server_status':
      return true;
    case 'server_start':
    case 'server_stop': {
      const id = nextId++;
      const c = cmd === 'server_start' ? 'adb start-server' : 'adb kill-server';
      log(id, c, 'running');
      await wait(200);
      log(id, c, 'done', 0, 200);
      return { id, cmd: c, code: 0, stdout: '', stderr: '', durationMs: 200, timedOut: false };
    }
    case 'history_clear':
      return null;
    case 'devices_current':
      return adbOk ? DEVICES : [];
    case 'device_wake': {
      const id = nextId++;
      const c = `adb -s ${a.serial} shell "if dumpsys power | grep -qE '…'; then echo AWAKE; else input keyevent 224 …"`;
      log(id, c, 'running');
      await wait(300);
      log(id, c, 'done', 0, 300);
      return { state: 'woke', method: 'input' };
    }
    case 'device_wifi_ip': {
      const id = nextId++;
      const c = `adb -s ${a.serial} shell "ip -f inet addr show"`;
      log(id, c, 'running');
      await wait(250);
      log(id, c, 'done', 0, 250);
      const ip = a.serial === NEW_USB.serial ? NEW_IP : a.serial === '7A1B2C3D' ? '192.168.0.57' : '192.168.0.42';
      return { ip, result: { id, cmd: c, code: 0, stdout: '', stderr: '', durationMs: 250, timedOut: false } };
    }
  }
  throw new Error(`mock: comando desconhecido ${cmd}`);
}
