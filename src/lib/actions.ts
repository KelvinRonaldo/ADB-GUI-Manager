// Ações de aparelho usadas pelos cartões, pelos detalhes e pelo menu "⋯".
import { api, copyText, pickSavePath, revealInFolder } from './ipc';
import { t } from './i18n.svelte';
import { classify, type AdbError, type ErrorAction } from './errors';
import { tcpAddress } from './format';
import {
  addRecent,
  app,
  confirmDialog,
  connectAddress,
  deviceName,
  navigate,
  promptDialog,
  reconnect,
  refreshSummary,
  showError,
  toast,
} from './state.svelte';
import type { RunResult } from './types';

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function safe(s: string): string {
  return s.replace(/[^\w.-]+/g, '_');
}

/** Mostra o erro com as ações que fazem sentido para o aparelho. */
export function reportError(err: AdbError, serial: string | null, retry?: () => void, extra: Partial<Record<ErrorAction, () => void>> = {}): void {
  showError(err, {
    retry,
    reconnect: serial
      ? async () => {
          if (await reconnect(serial)) retry?.();
        }
      : undefined,
    chooseDevice: () => navigate('devices'),
    pairAgain: () => navigate('connect'),
    openSettings: () => navigate('settings'),
    ...extra,
  });
}

/** Roda, avisa o resultado e oferece tentar de novo e reconectar em caso de erro. */
export async function runReport(args: string[], serial: string | null, okText: string, timeoutMs = 60000): Promise<RunResult | null> {
  try {
    const r = await api.run(args, { serial, timeoutMs });
    const err = classify(r);
    if (err) {
      reportError(err, serial, () => runReport(args, serial, okText, timeoutMs));
      return null;
    }
    toast(okText, 'success');
    return r;
  } catch (e) {
    const err = classify(String(e))!;
    reportError(err, serial, () => runReport(args, serial, okText, timeoutMs));
    return null;
  }
}

export async function rebootDevice(serial: string, mode = ''): Promise<void> {
  const name = deviceName(serial);
  const modeLabel = mode || 'Android';
  const c = await confirmDialog({
    title: t('confirm.rebootTitle', { name }),
    text: t('confirm.rebootText', { mode: modeLabel }),
    confirmLabel: t('menu.reboot'),
    danger: true,
    destructive: true,
  });
  if (!c.ok) return;
  await runReport(mode ? ['reboot', mode] : ['reboot'], serial, t('act.rebooting', { name }));
}

export async function adbdRoot(serial: string, root: boolean): Promise<void> {
  const name = deviceName(serial);
  const c = await confirmDialog({ title: t('confirm.rootTitle', { name }), text: t('confirm.rootText'), destructive: true });
  if (!c.ok) return;
  const r = await runReport([root ? 'root' : 'unroot'], serial, t('act.done', { cmd: root ? 'adb root' : 'adb unroot' }));
  if (r && /cannot run as root/i.test(r.stdout + r.stderr)) {
    reportError(classify({ ...r, code: 1 })!, serial);
  }
}

export async function remount(serial: string): Promise<void> {
  const name = deviceName(serial);
  const c = await confirmDialog({ title: t('confirm.remountTitle', { name }), text: t('confirm.remountText'), danger: true, destructive: true });
  if (!c.ok) return;
  await runReport(['remount'], serial, t('act.done', { cmd: 'adb remount' }));
}

export async function toWifi(serial: string): Promise<void> {
  let ip = app.summaries[serial]?.wifiIp;
  if (!ip) {
    await refreshSummary(serial, false);
    ip = app.summaries[serial]?.wifiIp;
  }
  if (!ip) {
    toast(t('act.toWifiNoIp'), 'error');
    return;
  }
  const name = deviceName(serial);
  const r = await runReport(['tcpip', '5555'], serial, t('act.done', { cmd: 'adb tcpip 5555' }));
  if (!r) return;
  await new Promise((res) => setTimeout(res, 2000));
  const address = `${ip}:5555`;
  const { ok, error } = await connectAddress(address);
  if (ok) {
    addRecent(address, name);
    toast(t('act.toWifiDone', { address }), 'success');
  } else if (error) {
    reportError(error, null, () => toWifi(serial));
  }
}

export async function screenshot(serial: string): Promise<void> {
  const path = await pickSavePath(`screenshot-${safe(deviceName(serial))}-${stamp()}.png`, [{ name: 'PNG', extensions: ['png'] }]);
  if (!path) return;
  try {
    const r = await api.runToFile(['exec-out', 'screencap', '-p'], serial, path);
    const err = classify(r);
    if (err) return reportError(err, serial, () => screenshot(serial));
    toast(t('act.screenshotSaved', { path }), 'success', { label: t('common.open'), run: () => revealInFolder(path) });
  } catch (e) {
    reportError(classify(String(e))!, serial, () => screenshot(serial));
  }
}

export async function screenrecord(serial: string): Promise<void> {
  const v = await promptDialog(t('act.recordTitle'), [{ label: t('act.recordSeconds'), value: '15', type: 'number' }]);
  if (!v) return;
  const secs = Math.min(180, Math.max(1, parseInt(v[0], 10) || 15));
  const name = deviceName(serial);
  const remote = `/sdcard/adbgui-rec-${stamp()}.mp4`;
  toast(t('act.recording', { s: secs, name }), 'info', undefined, (secs + 2) * 1000);
  const r = await api.run(['shell', `screenrecord --time-limit ${secs} ${remote}`], { serial, timeoutMs: (secs + 20) * 1000 });
  const err = classify(r);
  if (err) return reportError(err, serial, () => screenrecord(serial));
  const path = await pickSavePath(`screenrecord-${safe(name)}-${stamp()}.mp4`, [{ name: 'MP4', extensions: ['mp4'] }]);
  if (path) {
    const p = await runReport(['pull', remote, path], serial, t('act.recordSaved', { path }), 120000);
    if (p) toast(t('act.recordSaved', { path }), 'success', { label: t('common.open'), run: () => revealInFolder(path) });
  }
  await api.run(['shell', `rm -f ${remote}`], { serial, timeoutMs: 15000, quiet: true }).catch(() => undefined);
}

export async function bugreport(serial: string): Promise<void> {
  const name = deviceName(serial);
  const path = await pickSavePath(`bugreport-${safe(name)}-${stamp()}.zip`, [{ name: 'ZIP', extensions: ['zip'] }]);
  if (!path) return;
  toast(t('act.bugreportRunning', { name }), 'info', undefined, 10000);
  const r = await api.run(['bugreport', path], { serial, timeoutMs: 0 });
  const err = classify(r);
  if (err) return reportError(err, serial, () => bugreport(serial));
  toast(t('act.bugreportSaved', { path }), 'success', { label: t('common.open'), run: () => revealInFolder(path) });
}

export async function copySerial(serial: string): Promise<void> {
  await copyText(serial);
  toast(t('act.serialCopied'), 'success', undefined, 2500);
}

export async function disconnectDevice(serial: string): Promise<void> {
  if (!tcpAddress(serial) && !serial.includes('._adb-tls-connect.')) return;
  await runReport(['disconnect', serial], null, t('act.disconnected', { name: deviceName(serial) }));
}
