// Ponte com o Rust. Fora do Tauri (navegador comum, para ver a interface) usa um
// backend simulado, em mock.ts.
import type {
  AdbInfo,
  Device,
  AdbVersion,
  InitInfo,
  LocalEntry,
  MdnsService,
  Package,
  RemoteEntry,
  RunResult,
  Settings,
  Summary,
} from './types';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, args);
  }
  const m = await import('./mock');
  return m.mockInvoke(cmd, args) as Promise<T>;
}

export async function listen<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
  if (isTauri) {
    const { listen } = await import('@tauri-apps/api/event');
    return listen<T>(event, (e) => cb(e.payload));
  }
  const m = await import('./mock');
  return m.mockListen(event, cb as (p: unknown) => void);
}

export interface RunOptions {
  serial?: string | null;
  timeoutMs?: number;
  quiet?: boolean;
}

export const api = {
  init: () => invoke<InitInfo>('app_init'),
  validate: (path: string) => invoke<AdbVersion>('adb_validate', { path }),
  useAdb: (mode: string, path?: string, remember = true) => invoke<AdbInfo>('adb_use', { mode, path, remember }),
  saveSettings: (settings: Settings) => invoke<void>('settings_save', { settings }),
  run: (args: string[], o: RunOptions = {}) =>
    invoke<RunResult>('adb_run', { args, serial: o.serial ?? null, timeoutMs: o.timeoutMs ?? null, quiet: o.quiet ?? false }),
  runToFile: (args: string[], serial: string | null, path: string) =>
    invoke<RunResult>('adb_run_to_file', { args, serial, path }),
  streamStart: (args: string[], serial: string | null) => invoke<number>('stream_start', { args, serial }),
  streamStop: (id: number) => invoke<void>('stream_stop', { id }),
  ptyOpen: (args: string[], serial: string | null, cols: number, rows: number) =>
    invoke<number>('pty_open', { args, serial, cols, rows }),
  ptyWrite: (id: number, data: string) => invoke<void>('pty_write', { id, data }),
  ptyResize: (id: number, cols: number, rows: number) => invoke<void>('pty_resize', { id, cols, rows }),
  ptyClose: (id: number) => invoke<void>('pty_close', { id }),
  summary: (serial: string, quiet = true) => invoke<Summary>('device_summary', { serial, quiet }),
  mdns: (quiet = true) => invoke<MdnsService[]>('mdns_services', { quiet }),
  remoteList: (serial: string, path: string) =>
    invoke<{ entries: RemoteEntry[]; result: RunResult }>('remote_list', { serial, path }),
  packages: (serial: string, filter: string) =>
    invoke<{ packages: Package[]; result: RunResult }>('packages_list', { serial, filter }),
  localList: (path: string) => invoke<LocalEntry[]>('local_list', { path }),
  localParent: (path: string) => invoke<string | null>('local_parent', { path }),
  localRoots: () => invoke<string[]>('local_roots'),
  writeTextFile: (path: string, content: string) => invoke<void>('write_text_file', { path, content }),
  downloadPlatformTools: () => invoke<string>('platform_tools_download'),
  serverStatus: () => invoke<boolean>('server_status'),
  serverStart: () => invoke<RunResult>('server_start'),
  serverStop: () => invoke<RunResult>('server_stop'),
  historyClear: () => invoke<void>('history_clear'),
  devicesCurrent: () => invoke<Device[]>('devices_current'),
};

export async function pickFiles(opts: { multiple?: boolean; directory?: boolean; filters?: { name: string; extensions: string[] }[]; title?: string } = {}): Promise<string[]> {
  if (!isTauri) {
    return opts.directory ? ['/home/usuario/Downloads'] : ['/home/usuario/Downloads/app-exemplo-1.4.2.apk'];
  }
  const { open } = await import('@tauri-apps/plugin-dialog');
  const r = await open({ multiple: opts.multiple ?? false, directory: opts.directory ?? false, filters: opts.filters, title: opts.title });
  if (!r) return [];
  return Array.isArray(r) ? r : [r];
}

export async function pickSavePath(defaultPath: string, filters?: { name: string; extensions: string[] }[]): Promise<string | null> {
  if (!isTauri) return '/home/usuario/' + defaultPath;
  const { save } = await import('@tauri-apps/plugin-dialog');
  return save({ defaultPath, filters });
}

export async function revealInFolder(path: string): Promise<void> {
  if (!isTauri) return;
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(path);
}

/** Arquivos soltos na janela (APKs na tela de apps, arquivos na tela de arquivos). */
export async function onFileDrop(cb: (paths: string[], over: boolean) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  return getCurrentWebview().onDragDropEvent((e) => {
    const p = e.payload;
    if (p.type === 'drop') cb(p.paths, false);
    else if (p.type === 'enter') cb(p.paths, true);
    else if (p.type === 'leave') cb([], false);
  });
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}
