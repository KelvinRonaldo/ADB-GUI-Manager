// Ações de aparelho usadas pelos cartões, pelos detalhes e pelo menu "⋯".
import { api, copyText, pickSavePath, revealInFolder } from './ipc';
import { t } from './i18n.svelte';
import { classify, type AdbError, type ErrorAction } from './errors';
import { tcpAddress } from './format';
import { startWifiFlow } from './wififlow.svelte';
import { openCapture } from './capture.svelte';
import {
  confirmDialog,
  deviceName,
  findDevice,
  forgetLost,
  markRemoved,
  navigate,
  promptDialog,
  reconnect,
  showError,
  toast,
} from './state.svelte';
import type { RunResult } from './types';

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function safe(s: string): string {
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

/** Mesmo fluxo guiado do aparelho USB novo: IP, tcpip, tirar o cabo, connect. */
export function toWifi(serial: string): void {
  startWifiFlow(serial);
}

/** Acende a tela antes de capturar ou gravar: com ela apagada a imagem sai preta. */
export async function wakeScreen(serial: string): Promise<void> {
  try {
    const w = await api.wake(serial);
    // Recém-acesa: dá tempo de a tela desenhar antes da captura.
    if (w.state === 'woke') await new Promise((r) => setTimeout(r, 900));
    else if (w.state === 'asleep') toast(t('act.wakeFailed', { name: deviceName(serial) }), 'error');
  } catch {
    toast(t('act.wakeFailed', { name: deviceName(serial) }), 'error');
  }
}

export async function screenshot(serial: string): Promise<void> {
  openCapture(serial);
}

export async function screenrecord(serial: string): Promise<void> {
  const v = await promptDialog(t('act.recordTitle'), [{ label: t('act.recordSeconds'), value: '15', type: 'number' }]);
  if (!v) return;
  const secs = Math.min(180, Math.max(1, parseInt(v[0], 10) || 15));
  const name = deviceName(serial);
  const remote = `/sdcard/adbgui-rec-${stamp()}.mp4`;
  await wakeScreen(serial);
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

/**
 * Tirar o aparelho da lista. Wi-Fi, pronto ou offline: `adb disconnect`, sem o app tentar
 * reconectar depois. O que o app só tentava reconectar (perdido): para de tentar.
 * USB não tem a opção: ele sai da lista quando o cabo sai.
 */
export async function removeFromList(serial: string): Promise<void> {
  const name = deviceName(serial);
  const listed = !!findDevice(serial);
  const wifi = !!tcpAddress(serial) || serial.includes('._adb-tls-connect.');
  if (listed && !wifi) return;
  forgetLost(serial);
  if (!listed) {
    toast(t('act.removed', { name }), 'success', undefined, 2500);
    return;
  }
  markRemoved(serial);
  const r = await runReport(['disconnect', serial], null, t('act.removed', { name }));
  if (!r) markRemoved(serial, false);
}
