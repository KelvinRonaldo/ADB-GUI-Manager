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
  | 'commands'
  | 'settings';
