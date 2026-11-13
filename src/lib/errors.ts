// Cada falha do adb vira um caso com título, explicação e ações (tentar de novo,
// reconectar…). A saída original sempre acompanha, para "Detalhes técnicos".
import type { RunResult } from './types';

export type ErrorKind =
  | 'timeout'
  | 'adbMissing'
  | 'spawn'
  | 'deviceNotFound'
  | 'unauthorized'
  | 'offline'
  | 'moreThanOne'
  | 'noPermissions'
  | 'connectRefused'
  | 'connectTimeout'
  | 'connectFailed'
  | 'pairFailed'
  | 'serverStart'
  | 'serverVersion'
  | 'versionDowngrade'
  | 'alreadyExists'
  | 'updateIncompatible'
  | 'insufficientStorage'
  | 'noMatchingAbis'
  | 'testOnly'
  | 'olderSdk'
  | 'invalidApk'
  | 'duplicatePermission'
  | 'userRestricted'
  | 'verificationFailure'
  | 'installFailed'
  | 'permissionDenied'
  | 'noSuchFile'
  | 'notDebuggable'
  | 'mirrorServer'
  | 'mirrorDecoder'
  | 'runAsUnknown'
  | 'readOnly'
  | 'notRoot'
  | 'unknownCommand'
  | 'noLaunchActivity'
  | 'streamEnded'
  | 'generic';

export type ErrorAction =
  | 'reconnect'
  | 'retry'
  | 'chooseDevice'
  | 'restartServer'
  | 'pairAgain'
  | 'openSettings'
  | 'installDowngrade'
  | 'installReplace'
  | 'installTest'
  | 'uninstallInstall';

export type Op = 'connect' | 'pair' | 'install' | 'generic';

export interface AdbError {
  kind: ErrorKind;
  code: number;
  cmd: string;
  raw: string;
  actions: ErrorAction[];
  params: Record<string, string | number>;
  installCode?: string;
}

export interface ClassifyContext {
  op?: Op;
  address?: string;
  port?: number;
}

const INSTALL: Record<string, [ErrorKind, ErrorAction[]]> = {
  INSTALL_FAILED_VERSION_DOWNGRADE: ['versionDowngrade', ['installDowngrade', 'uninstallInstall']],
  INSTALL_FAILED_ALREADY_EXISTS: ['alreadyExists', ['installReplace']],
  INSTALL_FAILED_UPDATE_INCOMPATIBLE: ['updateIncompatible', ['uninstallInstall']],
  INSTALL_FAILED_SHARED_USER_INCOMPATIBLE: ['updateIncompatible', ['uninstallInstall']],
  INSTALL_FAILED_INSUFFICIENT_STORAGE: ['insufficientStorage', ['retry']],
  INSTALL_FAILED_MEDIA_UNAVAILABLE: ['insufficientStorage', ['retry']],
  INSTALL_FAILED_NO_MATCHING_ABIS: ['noMatchingAbis', []],
  INSTALL_FAILED_TEST_ONLY: ['testOnly', ['installTest']],
  INSTALL_FAILED_OLDER_SDK: ['olderSdk', []],
  INSTALL_FAILED_INVALID_APK: ['invalidApk', []],
  INSTALL_FAILED_DUPLICATE_PERMISSION: ['duplicatePermission', []],
  INSTALL_FAILED_USER_RESTRICTED: ['userRestricted', ['retry']],
  INSTALL_FAILED_VERIFICATION_FAILURE: ['verificationFailure', ['retry']],
  INSTALL_FAILED_VERIFICATION_TIMEOUT: ['verificationFailure', ['retry']],
  INSTALL_FAILED_ABORTED: ['userRestricted', ['retry']],
};

function addressFrom(cmd: string): string | undefined {
  const m = cmd.match(/\b(?:connect|pair|disconnect)\s+"?([\w.:[\]-]+)/);
  if (m) return m[1];
  const s = cmd.match(/-s\s+"?([\w.:-]+)/);
  return s?.[1];
}

/** Devolve null quando não houve erro. `connect` e `install` antigos saem com 0 mesmo falhando. */
export function classify(input: RunResult | string, ctx: ClassifyContext = {}): AdbError | null {
  const r: RunResult =
    typeof input === 'string'
      ? { id: 0, cmd: '', code: -1, stdout: '', stderr: input, durationMs: 0, timedOut: input.includes('TIMEOUT') }
      : input;
  const text = `${r.stderr}\n${r.stdout}`;
  const low = text.toLowerCase();
  const op = ctx.op ?? (/\binstall(-multiple|-multi-package)?\b/.test(r.cmd) ? 'install' : /\bpair\b/.test(r.cmd) ? 'pair' : /\bconnect\b/.test(r.cmd) && !/\bdisconnect\b/.test(r.cmd) ? 'connect' : 'generic');
  const installCode = text.match(/\b(INSTALL_(?:FAILED|PARSE_FAILED)_[A-Z_]+)\b/)?.[1];
  const connectFailed = op === 'connect' && /(failed to connect|cannot connect|unable to connect|failed to authenticate|connection refused)/.test(low);
  const pairFailed = op === 'pair' && /(failed|error|wrong password|protocol fault|unable)/.test(low) && !/successfully paired/.test(low);
  const installFailed = !!installCode || (op === 'install' && /failure \[|failed to install/.test(low));
  if (r.code === 0 && !r.timedOut && !connectFailed && !pairFailed && !installFailed) return null;

  const address = ctx.address ?? addressFrom(r.cmd) ?? '';
  const base = { code: r.code, cmd: r.cmd, raw: [r.cmd, r.stdout.trim(), r.stderr.trim()].filter(Boolean).join('\n'), installCode };
  const make = (kind: ErrorKind, actions: ErrorAction[], params: Record<string, string | number> = {}): AdbError => ({
    ...base,
    kind,
    actions,
    params: { code: r.code, address, port: ctx.port ?? 5037, ...params },
  });

  if (r.timedOut || r.stderr.trim() === 'TIMEOUT') return make('timeout', ['retry', 'reconnect']);
  if (text.includes('ADB_NOT_CONFIGURED')) return make('adbMissing', ['openSettings']);
  if (text.includes('SPAWN_FAILED')) return make('spawn', ['openSettings', 'retry']);
  if (installCode) {
    const [kind, actions] = INSTALL[installCode] ?? (installCode.startsWith('INSTALL_PARSE_FAILED') ? ['invalidApk', []] : ['installFailed', ['retry']]);
    return make(kind as ErrorKind, actions as ErrorAction[], { code: installCode });
  }
  if (/more than one (device|emulator)/.test(low)) return make('moreThanOne', ['chooseDevice']);
  if (/unauthorized/.test(low)) return make('unauthorized', ['retry', 'chooseDevice']);
  if (/no permissions|insufficient permissions/.test(low)) return make('noPermissions', ['retry', 'restartServer']);
  if (/device offline|error: device offline/.test(low)) return make('offline', ['reconnect', 'retry']);
  if (/device '.*' not found|device not found|no devices\/emulators found|device still connecting|no devices found/.test(low))
    return make('deviceNotFound', ['reconnect', 'retry', 'chooseDevice']);
  if (op === 'pair' && pairFailed) return make('pairFailed', ['pairAgain', 'retry']);
  if (/cannot bind|could not install \*smartsocket\*|failed to start daemon|daemon still not running|cannot connect to daemon/.test(low))
    return make('serverStart', ['restartServer', 'openSettings']);
  if (/doesn't match this client|server version .*doesn.t match/.test(low)) return make('serverVersion', ['restartServer']);
  if (/connection refused/.test(low)) return make('connectRefused', ['retry', 'pairAgain']);
  if (/timed out|no route to host|network is unreachable/.test(low)) return make('connectTimeout', ['retry']);
  if (connectFailed) return make('connectFailed', ['retry', 'pairAgain']);
  if (installFailed) return make('installFailed', ['retry'], { code: 'Failure' });
  if (/adbd cannot run as root in production builds/.test(low)) return make('notRoot', []);
  if (/MIRROR_(SERVER|TIMEOUT|PUSH|FORWARD|CONTROL)/.test(text)) return make('mirrorServer', ['retry', 'reconnect']);
  if (/run-as: package not debuggable|is not debuggable/.test(low)) return make('notDebuggable', []);
  if (/run-as: unknown package/.test(low)) return make('runAsUnknown', ['retry']);
  if (/read-only file system/.test(low)) return make('readOnly', []);
  if (/permission denied/.test(low)) return make('permissionDenied', ['retry']);
  if (/no such file or directory|does not exist/.test(low)) return make('noSuchFile', ['retry']);
  if (/unknown command|unknown option|unrecognized option/.test(low)) return make('unknownCommand', []);
  if (/no activities found to run|monkey aborted|adbgui_no_activity/.test(low)) return make('noLaunchActivity', []);
  return make('generic', ['retry']);
}

/** Um erro de stream (logcat, wait-for) que terminou sem ter sido parado pela pessoa. */
export function streamError(cmd: string, code: number, tail: string): AdbError {
  const e = classify({ id: 0, cmd, code: code || 1, stdout: '', stderr: tail, durationMs: 0, timedOut: false });
  if (e && e.kind !== 'generic') return e;
  return { kind: 'streamEnded', code, cmd, raw: [cmd, tail.trim()].filter(Boolean).join('\n'), actions: ['retry', 'reconnect'], params: { code } };
}
