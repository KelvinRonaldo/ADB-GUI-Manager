import { describe, expect, it } from 'vitest';
import { classify } from './errors';
import type { RunResult } from './types';

const r = (cmd: string, code: number, stdout = '', stderr = '', timedOut = false): RunResult => ({
  id: 1,
  cmd,
  code,
  stdout,
  stderr,
  durationMs: 10,
  timedOut,
});

describe('classify', () => {
  it('sucesso não é erro', () => {
    expect(classify(r('adb devices -l', 0, 'List of devices attached\n'))).toBeNull();
  });
  it('aparelho sumiu no meio da instalação', () => {
    const e = classify(r('adb -s 7A1B install -r a.apk', 1, 'Performing Streamed Install\n', "adb: device '7A1B' not found\n"))!;
    expect(e.kind).toBe('deviceNotFound');
    expect(e.actions).toContain('reconnect');
    expect(e.actions).toContain('retry');
  });
  it('downgrade oferece -d e desinstalar', () => {
    const e = classify(
      r('adb install a.apk', 1, 'Performing Streamed Install\n', 'adb: failed to install a.apk: Failure [INSTALL_FAILED_VERSION_DOWNGRADE: Downgrade detected]\n'),
    )!;
    expect(e.kind).toBe('versionDowngrade');
    expect(e.installCode).toBe('INSTALL_FAILED_VERSION_DOWNGRADE');
    expect(e.actions).toEqual(['installDowngrade', 'uninstallInstall']);
  });
  it('adb antigo sai com 0 mesmo com Failure', () => {
    const e = classify(r('adb install a.apk', 0, 'Failure [INSTALL_FAILED_TEST_ONLY]\n'))!;
    expect(e.kind).toBe('testOnly');
  });
  it('código de instalação desconhecido vira installFailed com o código', () => {
    const e = classify(r('adb install a.apk', 1, '', 'Failure [INSTALL_FAILED_CONFLICTING_PROVIDER]'))!;
    expect(e.kind).toBe('installFailed');
    expect(e.params.code).toBe('INSTALL_FAILED_CONFLICTING_PROVIDER');
  });
  it('parse failed vira APK inválido', () => {
    expect(classify(r('adb install a.apk', 1, '', 'Failure [INSTALL_PARSE_FAILED_NOT_APK]'))!.kind).toBe('invalidApk');
  });
  it('connect falhou com saída 0', () => {
    const e = classify(r('adb connect 192.168.0.42:5555', 0, 'failed to connect to 192.168.0.42:5555: Connection refused\n'))!;
    expect(e.kind).toBe('connectRefused');
    expect(e.params.address).toBe('192.168.0.42:5555');
  });
  it('connect bem-sucedido não é erro', () => {
    expect(classify(r('adb connect 192.168.0.42:5555', 0, 'connected to 192.168.0.42:5555\n'))).toBeNull();
    expect(classify(r('adb disconnect 192.168.0.42:5555', 0, 'disconnected 192.168.0.42:5555\n'))).toBeNull();
  });
  it('pareamento com código errado', () => {
    const e = classify(r('adb pair 192.168.0.57:37215 123456', 1, 'Failed: Unable to start pairing client.\n'))!;
    expect(e.kind).toBe('pairFailed');
  });
  it('não autorizado, offline e mais de um aparelho', () => {
    expect(classify(r('adb shell ls', 1, '', 'adb: device unauthorized.\nThis adb server\'s $ADB_VENDOR_KEYS is not set'))!.kind).toBe('unauthorized');
    expect(classify(r('adb shell ls', 1, '', 'adb: device offline'))!.kind).toBe('offline');
    expect(classify(r('adb shell ls', 1, '', 'adb: more than one device/emulator'))!.kind).toBe('moreThanOne');
  });
  it('tempo esgotado', () => {
    expect(classify(r('adb shell sleep 999', -1, '', 'TIMEOUT', true))!.kind).toBe('timeout');
  });
  it('servidor não sobe', () => {
    expect(classify(r('adb start-server', 1, '', 'error: could not install *smartsocket* listener: cannot bind to 127.0.0.1:5037'))!.kind).toBe('serverStart');
  });
  it('arquivos', () => {
    expect(classify(r('adb shell ls /data', 1, '', 'ls: /data: Permission denied'))!.kind).toBe('permissionDenied');
    expect(classify(r('adb pull /x', 1, '', "adb: error: failed to stat remote object '/x': No such file or directory"))!.kind).toBe('noSuchFile');
    expect(classify(r('adb root', 1, 'adbd cannot run as root in production builds\n'))!.kind).toBe('notRoot');
  });
  it('erro desconhecido cai no genérico com tentar de novo', () => {
    const e = classify(r('adb shell false', 1))!;
    expect(e.kind).toBe('generic');
    expect(e.actions).toEqual(['retry']);
  });
});

describe('abrir app', () => {
  it('sem atividade de abertura vira noLaunchActivity', () => {
    expect(classify(r('adb shell monkey -p x 1', 252, '** No activities found to run, monkey aborted.'))?.kind).toBe('noLaunchActivity');
    expect(classify(r('adb shell "for c in ..."', 1, 'ADBGUI_NO_ACTIVITY'))?.kind).toBe('noLaunchActivity');
  });
});
