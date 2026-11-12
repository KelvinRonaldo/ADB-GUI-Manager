// Todos os comandos do adb (platform-tools 34/35), com os parâmetros de cada um.
// A tela "Todos os comandos" monta o formulário a partir daqui e gera os argumentos.
import { splitArgs } from './shellwords';

export interface L {
  pt: string;
  en: string;
}

export type GroupId = 'general' | 'network' | 'files' | 'shell' | 'apps' | 'debug' | 'security' | 'scripting' | 'server';

interface ParamBase {
  id: string;
  label: L;
}

export type Param =
  | (ParamBase & { kind: 'flag'; flag: string })
  | (ParamBase & { kind: 'option'; flag: string; placeholder?: string; choices?: string[]; joined?: boolean })
  | (ParamBase & {
      kind: 'arg';
      required?: boolean;
      placeholder?: string;
      choices?: string[];
      picker?: 'file' | 'files' | 'dir' | 'save';
      /** O valor vira vários argumentos (lista de arquivos, filterspecs). */
      split?: boolean;
    })
  | (ParamBase & { kind: 'spec'; types: string[]; required?: boolean; placeholder?: string });

export interface Variant {
  id: string;
  label: L;
  prefix: string[];
  params: Param[];
  device?: boolean;
  build?: (v: Values) => string[];
}

export interface CommandDef {
  name: string;
  group: GroupId;
  desc: L;
  usage: string;
  variants: Variant[];
  /** Precisa de um aparelho (-s). Padrão: sim. */
  device?: boolean;
  /** Pode rodar por muito tempo (saída ao vivo, botão Parar). */
  stream?: boolean;
  destructive?: boolean;
}

export type Values = Record<string, string | boolean | string[] | undefined>;

const l = (pt: string, en: string): L => ({ pt, en });
const flag = (id: string, f: string, label: L): Param => ({ id, kind: 'flag', flag: f, label });
const opt = (id: string, f: string, label: L, extra: Partial<Extract<Param, { kind: 'option' }>> = {}): Param => ({
  id,
  kind: 'option',
  flag: f,
  label,
  ...extra,
});
const arg = (id: string, label: L, extra: Partial<Extract<Param, { kind: 'arg' }>> = {}): Param => ({ id, kind: 'arg', label, ...extra });
const one = (name: string, params: Param[] = [], extra: Partial<Variant> = {}): Variant[] => [
  { id: 'default', label: l('Executar', 'Run'), prefix: [name], params, ...extra },
];

const ALGOS = ['any', 'none', 'brotli', 'lz4', 'zstd'];
const LOCAL_SPECS = ['tcp', 'localabstract', 'localreserved', 'localfilesystem', 'dev', 'vsock', 'acceptfd'];
const REMOTE_SPECS = ['tcp', 'localabstract', 'localreserved', 'localfilesystem', 'dev', 'jdwp', 'vsock'];
const REVERSE_SPECS = ['tcp', 'localabstract', 'localreserved', 'localfilesystem'];

const installFlags = (): Param[] => [
  flag('r', '-r', l('substituir app existente', 'replace existing app')),
  flag('t', '-t', l('permitir APK de teste', 'allow test packages')),
  flag('d', '-d', l('permitir downgrade', 'allow version code downgrade')),
  flag('g', '-g', l('conceder todas as permissões', 'grant all runtime permissions')),
  flag('l', '-l', l('forward-lock', 'forward-lock')),
  flag('instant', '--instant', l('app instantâneo', 'instant app')),
  flag('noStreaming', '--no-streaming', l('enviar e depois instalar', 'push then install')),
  flag('streaming', '--streaming', l('instalar por streaming', 'streaming install')),
  flag('fastdeploy', '--fastdeploy', l('fast deploy (só o que mudou)', 'fast deploy (only changed parts)')),
  flag('noFastdeploy', '--no-fastdeploy', l('sem fast deploy', 'no fast deploy')),
  flag('forceAgent', '--force-agent', l('sempre instalar o agente', 'always push the agent')),
  flag('dateCheckAgent', '--date-check-agent', l('atualizar agente se mais novo (data)', 'update agent if newer (date)')),
  flag('versionCheckAgent', '--version-check-agent', l('atualizar agente se versão diferente', 'update agent if version differs')),
  flag('localAgent', '--local-agent', l('agente local (ANDROID_PRODUCT_OUT)', 'local agent (ANDROID_PRODUCT_OUT)')),
  opt('abi', '--abi', l('forçar ABI', 'override ABI'), { choices: ['', 'arm64-v8a', 'armeabi-v7a', 'armeabi', 'x86_64', 'x86'] }),
];

export const GROUPS: GroupId[] = ['general', 'network', 'files', 'shell', 'apps', 'debug', 'security', 'scripting', 'server'];

export const CATALOG: CommandDef[] = [
  // Geral
  {
    name: 'devices',
    group: 'general',
    device: false,
    desc: l('Lista os aparelhos conectados.', 'List connected devices.'),
    usage: 'devices [-l]',
    variants: one('devices', [flag('l', '-l', l('formato longo', 'long output'))]),
  },
  { name: 'version', group: 'general', device: false, desc: l('Versão do adb.', 'Show adb version.'), usage: 'version', variants: one('version') },
  { name: 'help', group: 'general', device: false, desc: l('Ajuda completa do adb.', 'Full adb help.'), usage: 'help', variants: one('help') },
  {
    name: 'features',
    group: 'general',
    desc: l('Recursos do aparelho conhecidos pelo adb.', 'Device features known to adb.'),
    usage: 'features',
    variants: one('features'),
  },
  {
    name: 'host-features',
    group: 'general',
    device: false,
    desc: l('Recursos do servidor adb.', 'adb server features.'),
    usage: 'host-features',
    variants: one('host-features'),
  },

  // Rede
  {
    name: 'connect',
    group: 'network',
    device: false,
    desc: l('Conecta a um aparelho por TCP/IP (porta padrão 5555).', 'Connect to a device via TCP/IP (default port 5555).'),
    usage: 'connect HOST[:PORT]',
    variants: one('connect', [arg('host', l('HOST[:PORTA]', 'HOST[:PORT]'), { required: true, placeholder: '192.168.0.42:5555' })]),
  },
  {
    name: 'disconnect',
    group: 'network',
    device: false,
    desc: l('Desconecta um aparelho TCP/IP, ou todos.', 'Disconnect a TCP/IP device, or all of them.'),
    usage: 'disconnect [HOST[:PORT]]',
    variants: one('disconnect', [arg('host', l('HOST[:PORTA] (vazio = todos)', 'HOST[:PORT] (empty = all)'), { placeholder: '192.168.0.42:5555' })]),
  },
  {
    name: 'pair',
    group: 'network',
    device: false,
    desc: l('Pareia com um aparelho para a depuração por Wi-Fi (Android 11+).', 'Pair with a device for wireless debugging (Android 11+).'),
    usage: 'pair HOST[:PORT] [PAIRING CODE]',
    variants: one('pair', [
      arg('host', l('HOST:PORTA de pareamento', 'pairing HOST:PORT'), { required: true, placeholder: '192.168.0.57:37215' }),
      arg('code', l('Código de pareamento', 'Pairing code'), { required: true, placeholder: '482193' }),
    ]),
  },
  {
    name: 'forward',
    group: 'network',
    desc: l('Encaminha uma porta deste computador para o aparelho.', 'Forward a port from this computer to the device.'),
    usage: 'forward --list | [--no-rebind] LOCAL REMOTE | --remove LOCAL | --remove-all',
    variants: [
      {
        id: 'create',
        label: l('Criar', 'Create'),
        prefix: ['forward'],
        params: [
          flag('noRebind', '--no-rebind', l('falhar se a porta já estiver em uso', 'fail if the port is already in use')),
          { id: 'local', kind: 'spec', label: l('LOCAL (computador)', 'LOCAL (computer)'), types: LOCAL_SPECS, required: true, placeholder: '8080' },
          { id: 'remote', kind: 'spec', label: l('REMOTE (aparelho)', 'REMOTE (device)'), types: REMOTE_SPECS, required: true, placeholder: '8080' },
        ],
      },
      { id: 'list', label: l('Listar', 'List'), prefix: ['forward', '--list'], params: [], device: false },
      {
        id: 'remove',
        label: l('Remover', 'Remove'),
        prefix: ['forward', '--remove'],
        params: [{ id: 'local', kind: 'spec', label: l('LOCAL', 'LOCAL'), types: LOCAL_SPECS, required: true, placeholder: '8080' }],
      },
      { id: 'removeAll', label: l('Remover todos', 'Remove all'), prefix: ['forward', '--remove-all'], params: [] },
    ],
  },
  {
    name: 'reverse',
    group: 'network',
    desc: l('Encaminha uma porta do aparelho para este computador.', 'Reverse-forward a device port to this computer.'),
    usage: 'reverse --list | [--no-rebind] REMOTE LOCAL | --remove REMOTE | --remove-all',
    variants: [
      {
        id: 'create',
        label: l('Criar', 'Create'),
        prefix: ['reverse'],
        params: [
          flag('noRebind', '--no-rebind', l('falhar se a porta já estiver em uso', 'fail if the port is already in use')),
          { id: 'remote', kind: 'spec', label: l('REMOTE (aparelho)', 'REMOTE (device)'), types: REVERSE_SPECS, required: true, placeholder: '8081' },
          { id: 'local', kind: 'spec', label: l('LOCAL (computador)', 'LOCAL (computer)'), types: REVERSE_SPECS, required: true, placeholder: '8081' },
        ],
      },
      { id: 'list', label: l('Listar', 'List'), prefix: ['reverse', '--list'], params: [] },
      {
        id: 'remove',
        label: l('Remover', 'Remove'),
        prefix: ['reverse', '--remove'],
        params: [{ id: 'remote', kind: 'spec', label: l('REMOTE', 'REMOTE'), types: REVERSE_SPECS, required: true, placeholder: '8081' }],
      },
      { id: 'removeAll', label: l('Remover todos', 'Remove all'), prefix: ['reverse', '--remove-all'], params: [] },
    ],
  },
  {
    name: 'mdns',
    group: 'network',
    device: false,
    desc: l('Descoberta de aparelhos na rede (mDNS).', 'Device discovery on the network (mDNS).'),
    usage: 'mdns check | mdns services',
    variants: [
      { id: 'services', label: l('Serviços', 'Services'), prefix: ['mdns', 'services'], params: [] },
      { id: 'check', label: l('Verificar', 'Check'), prefix: ['mdns', 'check'], params: [] },
    ],
  },

  // Arquivos
  {
    name: 'push',
    group: 'files',
    stream: true,
    desc: l('Copia arquivos do computador para o aparelho.', 'Copy local files to the device.'),
    usage: 'push [--sync] [-z ALGORITHM] [-Z] [-n] LOCAL... REMOTE',
    variants: one('push', [
      flag('sync', '--sync', l('só arquivos mais novos que os do aparelho', 'only files newer than the device copy')),
      flag('n', '-n', l('simular (não envia)', 'dry run')),
      flag('Z', '-Z', l('sem compressão', 'no compression')),
      opt('z', '-z', l('compressão', 'compression'), { choices: ['', ...ALGOS] }),
      arg('local', l('LOCAL (arquivos ou pastas)', 'LOCAL (files or folders)'), { required: true, picker: 'files', split: true }),
      arg('remote', l('REMOTE (destino no aparelho)', 'REMOTE (destination on the device)'), { required: true, placeholder: '/sdcard/Download/' }),
    ]),
  },
  {
    name: 'pull',
    group: 'files',
    stream: true,
    desc: l('Copia arquivos do aparelho para o computador.', 'Copy device files to this computer.'),
    usage: 'pull [-a] [-z ALGORITHM] [-Z] REMOTE... LOCAL',
    variants: one('pull', [
      flag('a', '-a', l('manter data e modo', 'keep timestamp and mode')),
      flag('Z', '-Z', l('sem compressão', 'no compression')),
      opt('z', '-z', l('compressão', 'compression'), { choices: ['', ...ALGOS] }),
      arg('remote', l('REMOTE (no aparelho)', 'REMOTE (on the device)'), { required: true, placeholder: '/sdcard/Download/arquivo.txt', split: true }),
      arg('local', l('LOCAL (pasta de destino)', 'LOCAL (destination folder)'), { picker: 'dir' }),
    ]),
  },
  {
    name: 'sync',
    group: 'files',
    stream: true,
    desc: l('Sincroniza uma build local ($ANDROID_PRODUCT_OUT) com o aparelho.', 'Sync a local build ($ANDROID_PRODUCT_OUT) to the device.'),
    usage: 'sync [-l] [-z ALGORITHM] [-Z] [all|data|odm|oem|product|system|system_ext|vendor]',
    variants: one('sync', [
      flag('l', '-l', l('só listar o que seria copiado', 'list only')),
      flag('Z', '-Z', l('sem compressão', 'no compression')),
      opt('z', '-z', l('compressão', 'compression'), { choices: ['', ...ALGOS] }),
      arg('partition', l('Partição', 'Partition'), { choices: ['', 'all', 'data', 'odm', 'oem', 'product', 'system', 'system_ext', 'vendor'] }),
    ]),
  },

  // Shell
  {
    name: 'shell',
    group: 'shell',
    stream: true,
    desc: l('Roda um comando no aparelho (sem comando: shell interativo).', 'Run a command on the device (no command: interactive shell).'),
    usage: 'shell [-e ESCAPE] [-n] [-Tt] [-x] [COMMAND...]',
    variants: one('shell', [
      opt('e', '-e', l('caractere de escape (none desliga)', 'escape character (none disables)'), { placeholder: '~' }),
      flag('n', '-n', l('não ler o stdin', 'do not read stdin')),
      flag('T', '-T', l('sem pseudo-terminal', 'disable pty')),
      flag('t', '-t', l('forçar pseudo-terminal', 'force pty')),
      flag('x', '-x', l('sem stderr separado', 'disable remote exit codes and stdout/stderr separation')),
      arg('command', l('COMANDO', 'COMMAND'), { required: true, placeholder: 'getprop ro.build.version.release' }),
    ]),
  },
  {
    name: 'emu',
    group: 'shell',
    desc: l('Comando no console do emulador.', 'Run an emulator console command.'),
    usage: 'emu COMMAND',
    variants: one('emu', [arg('command', l('COMANDO', 'COMMAND'), { required: true, placeholder: 'avd name', split: true })]),
  },

  // Apps
  {
    name: 'install',
    group: 'apps',
    stream: true,
    desc: l('Instala um APK.', 'Install a package.'),
    usage: 'install [-lrtsdg] [--instant] PACKAGE',
    variants: one('install', [...installFlags(), arg('apk', l('APK', 'APK'), { required: true, picker: 'file' })]),
  },
  {
    name: 'install-multiple',
    group: 'apps',
    stream: true,
    desc: l('Instala vários APKs de um mesmo app (splits).', 'Install multiple APKs of one app (splits).'),
    usage: 'install-multiple [-lrtsdpg] [--instant] PACKAGE...',
    variants: one('install-multiple', [
      ...installFlags(),
      flag('p', '-p', l('instalação parcial (atualização de splits)', 'partial application install')),
      arg('apks', l('APKs', 'APKs'), { required: true, picker: 'files', split: true }),
    ]),
  },
  {
    name: 'install-multi-package',
    group: 'apps',
    stream: true,
    desc: l('Instala vários apps numa sessão atômica.', 'Install several apps in one atomic session.'),
    usage: 'install-multi-package [-lrtsdpg] [--instant] PACKAGE...',
    variants: one('install-multi-package', [
      ...installFlags(),
      flag('p', '-p', l('instalação parcial', 'partial application install')),
      arg('apks', l('APKs', 'APKs'), { required: true, picker: 'files', split: true }),
    ]),
  },
  {
    name: 'uninstall',
    group: 'apps',
    destructive: true,
    desc: l('Remove um app do aparelho.', 'Remove an app from the device.'),
    usage: 'uninstall [-k] APPLICATION_ID',
    variants: one('uninstall', [
      flag('k', '-k', l('manter dados e cache', 'keep data and cache')),
      arg('pkg', l('Pacote', 'Package'), { required: true, placeholder: 'com.exemplo.app' }),
    ]),
  },

  // Depuração
  {
    name: 'bugreport',
    group: 'debug',
    stream: true,
    desc: l('Gera um bugreport zipado.', 'Write a zipped bugreport.'),
    usage: 'bugreport [PATH]',
    variants: one('bugreport', [arg('path', l('Caminho (arquivo ou pasta)', 'Path (file or folder)'), { picker: 'save' })]),
  },
  {
    name: 'jdwp',
    group: 'debug',
    stream: true,
    desc: l('Lista os processos com transporte JDWP (fica aberto até parar).', 'List processes with a JDWP transport (runs until stopped).'),
    usage: 'jdwp',
    variants: one('jdwp'),
  },
  {
    name: 'logcat',
    group: 'debug',
    stream: true,
    desc: l('Mostra o log do aparelho.', 'Show the device log.'),
    usage: 'logcat [options] [filterspecs]',
    variants: one('logcat', [
      opt('v', '-v', l('formato', 'format'), {
        choices: ['', 'brief', 'long', 'process', 'raw', 'tag', 'thread', 'threadtime', 'time', 'color', 'epoch', 'monotonic', 'uid', 'usec', 'UTC', 'year', 'zone'],
      }),
      opt('b', '-b', l('buffer', 'buffer'), { choices: ['', 'main', 'system', 'radio', 'events', 'crash', 'kernel', 'default', 'all'] }),
      flag('d', '-d', l('despejar e sair', 'dump and exit')),
      flag('c', '-c', l('limpar o log (apaga no aparelho)', 'clear the log (erases on the device)')),
      opt('t', '-t', l('últimas N linhas', 'last N lines'), { placeholder: '200' }),
      opt('T', '-T', l('desde a hora', 'since time'), { placeholder: "'11-12 10:00:00.000'" }),
      opt('pid', '--pid', l('só o PID', 'only this PID'), { joined: true, placeholder: '4211' }),
      opt('e', '-e', l('regex', 'regex'), { placeholder: 'erro|exception' }),
      opt('m', '-m', l('parar depois de N linhas', 'quit after N lines'), { placeholder: '100' }),
      arg('specs', l('filterspecs', 'filterspecs'), { placeholder: 'ActivityManager:I *:S', split: true }),
    ]),
  },
  {
    name: 'sideload',
    group: 'debug',
    stream: true,
    destructive: true,
    desc: l('Instala um pacote OTA pelo recovery (modo sideload).', 'Sideload an OTA package through recovery.'),
    usage: 'sideload OTAPACKAGE',
    variants: one('sideload', [arg('ota', l('Pacote OTA (.zip)', 'OTA package (.zip)'), { required: true, picker: 'file' })]),
  },

  // Segurança
  {
    name: 'disable-verity',
    group: 'security',
    destructive: true,
    desc: l('Desliga o dm-verity (builds userdebug).', 'Disable dm-verity (userdebug builds).'),
    usage: 'disable-verity',
    variants: one('disable-verity'),
  },
  {
    name: 'enable-verity',
    group: 'security',
    destructive: true,
    desc: l('Religa o dm-verity.', 'Re-enable dm-verity.'),
    usage: 'enable-verity',
    variants: one('enable-verity'),
  },
  {
    name: 'keygen',
    group: 'security',
    device: false,
    desc: l('Gera um par de chaves do adb.', 'Generate an adb key pair.'),
    usage: 'keygen FILE',
    variants: one('keygen', [arg('file', l('Arquivo da chave', 'Key file'), { required: true, picker: 'save' })]),
  },

  // Script
  {
    name: 'wait-for',
    group: 'scripting',
    stream: true,
    desc: l('Espera o aparelho chegar a um estado.', 'Wait for the device to reach a state.'),
    usage: 'wait-for[-TRANSPORT]-STATE',
    variants: [
      {
        id: 'default',
        label: l('Executar', 'Run'),
        prefix: [],
        params: [
          arg('transport', l('Transporte', 'Transport'), { choices: ['any', 'usb', 'local'] }),
          arg('state', l('Estado', 'State'), { choices: ['device', 'recovery', 'rescue', 'sideload', 'bootloader', 'disconnect'] }),
        ],
        build: (v) => [`wait-for-${(v.transport as string) || 'any'}-${(v.state as string) || 'device'}`],
      },
    ],
  },
  { name: 'get-state', group: 'scripting', desc: l('Estado do aparelho.', 'Print the device state.'), usage: 'get-state', variants: one('get-state') },
  { name: 'get-serialno', group: 'scripting', desc: l('Serial do aparelho.', 'Print the serial number.'), usage: 'get-serialno', variants: one('get-serialno') },
  { name: 'get-devpath', group: 'scripting', desc: l('Caminho do aparelho no sistema.', 'Print the device path.'), usage: 'get-devpath', variants: one('get-devpath') },
  {
    name: 'remount',
    group: 'scripting',
    destructive: true,
    desc: l('Remonta as partições como graváveis.', 'Remount partitions read-write.'),
    usage: 'remount [-R]',
    variants: one('remount', [flag('R', '-R', l('reiniciar sozinho se preciso', 'reboot automatically if needed'))]),
  },
  {
    name: 'reboot',
    group: 'scripting',
    destructive: true,
    desc: l('Reinicia o aparelho.', 'Reboot the device.'),
    usage: 'reboot [bootloader|recovery|sideload|sideload-auto-reboot|fastboot]',
    variants: one('reboot', [arg('mode', l('Modo', 'Mode'), { choices: ['', 'bootloader', 'recovery', 'sideload', 'sideload-auto-reboot', 'fastboot'] })]),
  },
  { name: 'root', group: 'scripting', destructive: true, desc: l('Reinicia o adbd como root.', 'Restart adbd with root.'), usage: 'root', variants: one('root') },
  { name: 'unroot', group: 'scripting', destructive: true, desc: l('Reinicia o adbd sem root.', 'Restart adbd without root.'), usage: 'unroot', variants: one('unroot') },
  { name: 'usb', group: 'scripting', desc: l('Volta o adbd a escutar no USB.', 'Restart adbd listening on USB.'), usage: 'usb', variants: one('usb') },
  {
    name: 'tcpip',
    group: 'scripting',
    desc: l('Faz o adbd escutar em TCP na porta.', 'Restart adbd listening on TCP on the port.'),
    usage: 'tcpip PORT',
    variants: one('tcpip', [arg('port', l('Porta', 'Port'), { required: true, placeholder: '5555' })]),
  },

  // Servidor
  { name: 'start-server', group: 'server', device: false, desc: l('Inicia o servidor.', 'Start the server.'), usage: 'start-server', variants: one('start-server') },
  {
    name: 'kill-server',
    group: 'server',
    device: false,
    destructive: true,
    desc: l('Para o servidor.', 'Kill the server.'),
    usage: 'kill-server',
    variants: one('kill-server'),
  },
  {
    name: 'reconnect',
    group: 'server',
    device: false,
    desc: l('Reconecta pelo lado do servidor, do aparelho ou os offline.', 'Reconnect from the host side, the device side or offline devices.'),
    usage: 'reconnect | reconnect device | reconnect offline',
    variants: [
      { id: 'host', label: l('Servidor', 'Host'), prefix: ['reconnect'], params: [], device: true },
      { id: 'device', label: l('Aparelho', 'Device'), prefix: ['reconnect', 'device'], params: [], device: true },
      { id: 'offline', label: l('Offline', 'Offline'), prefix: ['reconnect', 'offline'], params: [] },
    ],
  },
  { name: 'attach', group: 'server', desc: l('Reconecta um aparelho USB desanexado.', 'Attach a detached USB device.'), usage: 'attach', variants: one('attach') },
  { name: 'detach', group: 'server', desc: l('Desanexa um aparelho USB do servidor.', 'Detach a USB device from the server.'), usage: 'detach', variants: one('detach') },
];

export function findCommand(name: string): CommandDef | undefined {
  return CATALOG.find((c) => c.name === name);
}

export function needsDevice(def: CommandDef, variant: Variant): boolean {
  return variant.device ?? def.device ?? true;
}

export interface Built {
  args: string[];
  missing: L[];
}

export function buildArgs(_def: CommandDef, variant: Variant, values: Values): Built {
  const missing: L[] = [];
  if (variant.build) return { args: variant.build(values), missing };
  const args = [...variant.prefix];
  for (const p of variant.params) {
    const v = values[p.id];
    if (p.kind === 'flag') {
      if (v === true) args.push(p.flag);
    } else if (p.kind === 'option') {
      const s = typeof v === 'string' ? v.trim() : '';
      if (s) {
        if (p.joined) args.push(`${p.flag}=${s}`);
        else args.push(p.flag, s);
      }
    } else if (p.kind === 'spec') {
      const val = typeof values[p.id] === 'string' ? (values[p.id] as string).trim() : '';
      const type = (values[`${p.id}Type`] as string) || p.types[0];
      if (val) args.push(`${type}:${val}`);
      else if (p.required) missing.push(p.label);
    } else {
      let list: string[] = [];
      if (Array.isArray(v)) list = v.filter((x) => x !== '');
      else if (typeof v === 'string' && v.trim() !== '') {
        if (p.split) {
          try {
            list = splitArgs(v);
          } catch {
            list = [v.trim()];
          }
        } else list = [p.picker ? v : v.trim()];
      }
      if (list.length) args.push(...list);
      else if (p.required) missing.push(p.label);
    }
  }
  return { args, missing };
}

/** Comandos que o `adb help` instalado lista (para marcar os que ele não conhece). */
export function helpCommands(help: string): Set<string> {
  const found = new Set<string>();
  for (const def of CATALOG) {
    const re = new RegExp(`^\\s+${def.name.replace(/[-]/g, '\\-')}(\\b|\\[|$)`, 'm');
    if (re.test(help)) found.add(def.name);
  }
  return found;
}

/** O trecho do `adb help` sobre um comando: a linha dele e as que vêm mais recuadas. */
export function helpExcerpt(help: string, name: string): string {
  const lines = help.split(/\r?\n/);
  const re = new RegExp(`^(\\s+)${name.replace(/[-]/g, '\\-')}(\\b|\\[|$)`);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    const indent = m[1].length;
    out.push(lines[i].trimEnd());
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      const ind = line.length - line.trimStart().length;
      if (line.trim() === '' || ind <= indent) break;
      out.push(line.trimEnd());
    }
    out.push('');
  }
  return out.join('\n').trim();
}
