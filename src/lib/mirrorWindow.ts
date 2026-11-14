// Janela destacada do espelho: só a tela do aparelho e a coluna de teclas. Ela sobe a própria
// sessão (o vídeo vai direto para a janela dela) e avisa a janela principal por eventos.
import { isTauri, listen } from './ipc';
import { t } from './i18n.svelte';
import { deviceName, navigate } from './state.svelte';
import { cap, openCapture } from './capture.svelte';
import { detached, pending } from './mirrorSession.svelte';

export const MIRROR_LABEL = 'mirror';

/** Eventos entre as janelas. */
export const EV_STATE = 'mirror-window'; // { open, serial } — janela destacada abriu ou fechou
export const EV_DOCK = 'mirror-dock'; // { serial } — voltar o espelho para dentro do app
export const EV_DOCK_REQUEST = 'mirror-dock-request'; // a principal pede a volta
export const EV_CAPTURE = 'mirror-capture'; // { serial, onTop } — captura de tela pela principal

export function isMirrorWindow(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('window') === MIRROR_LABEL;
}

export async function emitTo(event: string, payload: unknown): Promise<void> {
  if (!isTauri) return;
  const { emit } = await import('@tauri-apps/api/event');
  await emit(event, payload);
}

/** Tamanho da janela para a tela caber inteira ao lado da coluna, sem faixas. */
export function windowSize(w: number, h: number): { width: number; height: number } {
  const aw = (typeof screen !== 'undefined' && screen.availWidth) || 1280;
  const ah = (typeof screen !== 'undefined' && screen.availHeight) || 800;
  const ratio = w > 0 && h > 0 ? w / h : 9 / 19.5;
  const chrome = { x: 10 + 10 + 46 + 10, y: 10 + 10 };
  let sh: number;
  let sw: number;
  if (ratio <= 1) {
    sh = Math.min(Math.round(ah * 0.85), 960) - chrome.y;
    sw = Math.round(sh * ratio);
  } else {
    sw = Math.min(Math.round(aw * 0.7), 1280) - chrome.x;
    sh = Math.round(sw / ratio);
  }
  return { width: sw + chrome.x, height: Math.max(sh + chrome.y, 360) };
}

/** Abre (ou traz para a frente) a janela destacada do aparelho. */
export async function openDetached(serial: string, w: number, h: number): Promise<void> {
  if (!isTauri) return;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const old = await WebviewWindow.getByLabel(MIRROR_LABEL);
  if (old) {
    await old.unminimize().catch(() => undefined);
    await old.setFocus().catch(() => undefined);
    return;
  }
  const { width, height } = windowSize(w, h);
  const win = new WebviewWindow(MIRROR_LABEL, {
    url: `index.html?window=${MIRROR_LABEL}&serial=${encodeURIComponent(serial)}`,
    title: t('mirror.windowTitle', { name: deviceName(serial) }),
    width,
    height,
    minWidth: 220,
    minHeight: 300,
    center: true,
    focus: true,
    // Conteúdo escuro nos dois temas do app: barra de título escura desde a criação.
    theme: 'dark',
  });
  detached.open = true;
  detached.serial = serial;
  win.once('tauri://error', () => {
    detached.open = false;
    detached.serial = '';
  });
}

/** Traz a janela destacada para a frente. */
export async function focusDetached(): Promise<void> {
  if (!isTauri) return;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const w = await WebviewWindow.getByLabel(MIRROR_LABEL);
  await w?.unminimize().catch(() => undefined);
  await w?.setFocus().catch(() => undefined);
}

async function showMain(): Promise<void> {
  if (!isTauri) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const w = getCurrentWindow();
  await w.show().catch(() => undefined);
  await w.unminimize().catch(() => undefined);
  await w.setFocus().catch(() => undefined);
}

/** Na janela principal: acompanha a janela destacada. */
export async function initMirrorWindowEvents(): Promise<void> {
  await listen<{ open: boolean; serial: string }>(EV_STATE, (p) => {
    detached.open = p.open;
    detached.serial = p.open ? p.serial : '';
  });
  await listen<{ serial: string }>(EV_DOCK, async (p) => {
    detached.open = false;
    detached.serial = '';
    pending.serial = p.serial;
    navigate('mirror');
    await showMain();
  });
  await listen<{ serial: string; onTop?: boolean }>(EV_CAPTURE, async (p) => {
    cap.above = !!p.onTop;
    await showMain();
    openCapture(p.serial);
  });
}
