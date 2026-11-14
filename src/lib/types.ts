export type StateKind =
  | 'device'
  | 'offline'
  | 'unauthorized'
  | 'authorizing'
  | 'connecting'
  | 'bootloader'
  | 'recovery'
  | 'sideload'
  | 'host'
  | 'noPermissions'
  | 'unknown';

export interface Device {
  serial: string;
  state: string;
  stateKind: StateKind;
  connection: 'usb' | 'wifi' | 'emulator';
  usb?: string | null;
  product?: string | null;
  model?: string | null;
  device?: string | null;
  transportId?: string | null;
}

export interface Battery {
  level?: number | null;
  status?: string | null;
  health?: string | null;
  powered: string[];
  voltageMv?: number | null;
  temperatureC?: number | null;
  technology?: string | null;
}

export interface Storage {
  totalKb: number;
  usedKb: number;
  availKb: number;
}

export interface RunResult {
  id: number;
  cmd: string;
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface Summary {
  serial: string;
  props: Record<string, string>;
  battery: Battery;
  wifiIp?: string | null;
  storage?: Storage | null;
  raw: string;
  result: RunResult;
}

export interface LogEntry {
  id: number;
  ts: number;
  cmd: string;
  state: 'running' | 'done';
  code?: number | null;
  durationMs?: number | null;
  error?: string | null;
}

export interface AdbVersion {
  adbVersion: string;
  toolsVersion?: string | null;
  installedAs?: string | null;
}

export interface AdbInfo {
  path: string;
  source: string;
  version: AdbVersion;
}

export interface Candidate {
  source: string;
  path: string;
  found: boolean;
}

export interface MdnsService {
  name: string;
  service: string;
  address: string;
}

export interface RemoteEntry {
  name: string;
  perms: string;
  isDir: boolean;
  isLink: boolean;
  linkTarget?: string | null;
  size?: number | null;
  modified: string;
  owner: string;
  group: string;
}

export interface LocalEntry {
  name: string;
  path: string;
  isDir: boolean;
  size?: number | null;
  modified?: number | null;
}

export interface Package {
  name: string;
  versionCode?: string | null;
  uid?: string | null;
  path?: string | null;
}

export interface RecentConnection {
  address: string;
  name: string;
  at: number;
  /** Serial do terminal (etiqueta), quando já se conhece. */
  serial?: string;
}

export interface SavedCommand {
  name: string;
  cmd: string;
}

export interface Favorite {
  name: string;
  args: string[];
}

export type Theme = 'system' | 'light' | 'dark';
/** Paletas: três claras e três escuras ("classic" é a original de cada modo). */
export type LightPalette = 'classic' | 'lavender' | 'sun';
export type DarkPalette = 'classic' | 'forest' | 'plum';
/** Como a lista de aparelhos aparece: cartões, linhas com os mesmos dados ou só o essencial. */
export type DevicesView = 'grid' | 'list' | 'compact';
export type Lang = 'pt-BR' | 'en-US';

export interface Settings {
  adbMode: 'auto' | 'custom' | 'downloaded';
  adbPath: string;
  serverHost: string;
  serverPort: number;
  startServerOnLaunch: boolean;
  stopServerOnExit: boolean;
  env: Record<string, string>;
  keepHistory: boolean;
  theme: Theme;
  lightTheme: LightPalette;
  darkTheme: DarkPalette;
  /** Fechar a janela só a esconde; o app continua na bandeja. */
  closeToTray: boolean;
  language: Lang | '';
  summaryRefreshSec: number;
  confirmDestructive: boolean;
  tourDone: boolean;
  pageGuides: 'unset' | 'ask' | 'never';
  seenPages: string[];
  recentConnections: RecentConnection[];
  savedCommands: SavedCommand[];
  favorites: Favorite[];
  targetSerial: string;
  /** Aparelho ligado por USB com o app aberto: passa para Wi-Fi sozinho, pergunta ou nada. */
  usbToWifi: 'auto' | 'ask' | 'off';
  wifiPort: number;
  /** Seriais que o usuário pediu para não passar sozinhos. */
  usbToWifiSkip: string[];
  devicesView: DevicesView;
  /** Espelhamento: qualidade (low/medium/high/original), fps e controle. */
  mirrorQuality: string;
  mirrorFps: number;
  mirrorControl: boolean;
  mirrorStayAwake: boolean;
  /** Última busca de atualização (só a que a pessoa pediu). */
  updateLastCheck: { at: number; found: string | null } | null;
}

export interface InitInfo {
  adb: AdbInfo | null;
  checked: Candidate[];
  cliAdb: string | null;
  settings: Partial<Settings>;
  history: LogEntry[];
  os: string;
  dataDir: string;
  downloadedAdb: string;
  downloadedExists: boolean;
  downloadUrl: string;
  serverRunning: boolean;
  home: string;
}

export interface StreamEvent {
  id: number;
  kind: 'out' | 'err' | 'end';
  data: string;
  code?: number | null;
}

export type Page =
  | 'devices'
  | 'details'
  | 'connect'
  | 'apps'
  | 'files'
  | 'shell'
  | 'logcat'
  | 'mirror'
  | 'commands'
  | 'settings';

// ---------- atualização do app ----------

export type PackageKind = 'appimage' | 'deb' | 'rpm' | 'nsis' | 'msi' | 'portable' | 'macos' | 'dev';

export interface UpdateInfo {
  version: string;
  package: PackageKind;
  location: string;
  canUpdate: boolean;
  lastInstall: { result: 'updated' | 'notFinished'; from: string; to: string; notes?: string | null } | null;
}

export interface UpdateCheck {
  available: boolean;
  current: string;
  version?: string | null;
  notes?: string | null;
  date?: string | null;
  size?: number | null;
  downloaded: boolean;
  openSessions: number;
}

export interface UpdateProgress {
  received: number;
  total?: number | null;
  bytesPerSec: number;
}

// ---------- captura de tela ----------

export interface CaptureInfo {
  dataUrl: string;
  width: number;
  height: number;
  size: number;
}
