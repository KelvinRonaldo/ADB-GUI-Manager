// Captura de tela com prévia: acende a tela, captura para uma pasta temporária do app e
// mostra a imagem com Copiar e Salvar. Fechar a prévia descarta o arquivo.
import { api, pickSavePath, revealInFolder } from './ipc';
import { t } from './i18n.svelte';
import { classify } from './errors';
import { deviceName, toast } from './state.svelte';
import { reportError, safe, stamp, wakeScreen } from './actions';
import type { CaptureInfo } from './types';

export const cap = $state({
  open: false,
  busy: false,
  serial: '',
  name: '',
  path: '',
  info: null as CaptureInfo | null,
  at: 0,
  copied: false,
  savedTo: '',
});

export async function openCapture(serial: string): Promise<void> {
  if (cap.busy) return;
  await discard();
  cap.open = true;
  cap.busy = true;
  cap.serial = serial;
  cap.name = deviceName(serial);
  cap.info = null;
  cap.copied = false;
  cap.savedTo = '';
  try {
    await wakeScreen(serial);
    const path = await api.capturePath(`screenshot-${safe(cap.name)}-${stamp()}.png`);
    const r = await api.runToFile(['exec-out', 'screencap', '-p'], serial, path);
    const err = classify(r);
    if (err) {
      cap.open = false;
      api.captureDiscard(path).catch(() => undefined);
      return reportError(err, serial, () => openCapture(serial));
    }
    cap.path = path;
    cap.info = await api.captureRead(path);
    cap.at = Date.now();
  } catch (e) {
    cap.open = false;
    reportError(classify(String(e))!, serial, () => openCapture(serial));
  } finally {
    cap.busy = false;
  }
}

export async function copyCapture(): Promise<void> {
  if (!cap.path || cap.busy) return;
  try {
    await api.captureCopy(cap.path);
    cap.copied = true;
  } catch (e) {
    toast(t('capture.copyFailed', { error: String(e) }), 'error');
  }
}

export async function saveCapture(): Promise<void> {
  if (!cap.path || cap.busy) return;
  const name = cap.path.split(/[\\/]/).pop() ?? 'screenshot.png';
  const dest = await pickSavePath(name, [{ name: 'PNG', extensions: ['png'] }]);
  if (!dest) return;
  try {
    await api.captureSave(cap.path, dest);
    cap.savedTo = dest;
    toast(t('act.screenshotSaved', { path: dest }), 'success', { label: t('capture.openFolder'), run: () => revealInFolder(dest) });
  } catch (e) {
    toast(t('capture.saveFailed', { error: String(e) }), 'error');
  }
}

async function discard(): Promise<void> {
  if (cap.path) {
    const p = cap.path;
    cap.path = '';
    await api.captureDiscard(p).catch(() => undefined);
  }
}

export async function closeCapture(): Promise<void> {
  if (cap.busy) return;
  cap.open = false;
  cap.info = null;
  await discard();
}
