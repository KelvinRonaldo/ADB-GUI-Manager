// Atualização do próprio app pelas Releases do GitHub. Só busca quando a pessoa pede
// (Configurações → Sobre e atualizações). Confirmado o aviso, baixa, instala e reabre.
import { api, listen, openUrl, revealInFolder } from './ipc';
import { lang, t } from './i18n.svelte';
import { app, saveSettings, toast } from './state.svelte';
import type { PackageKind, UpdateCheck, UpdateInfo, UpdateProgress } from './types';

export const RELEASES_URL = 'https://github.com/KelvinRonaldo/ADB-GUI-Manager/releases/latest';

export type UpdatePhase = 'idle' | 'checking' | 'uptodate' | 'available' | 'downloading' | 'installing' | 'updated' | 'error';

export type UpdateErrorKind =
  | 'network'
  | 'interrupted'
  | 'signature'
  | 'permission'
  | 'auth'
  | 'notFinished'
  | 'noPackage'
  | 'unsupported'
  | 'install'
  | 'generic';

export interface UpdateError {
  kind: UpdateErrorKind;
  raw: string;
}

export const upd = $state({
  info: null as UpdateInfo | null,
  phase: 'idle' as UpdatePhase,
  check: null as UpdateCheck | null,
  progress: null as UpdateProgress | null,
  error: null as UpdateError | null,
  /** Atualização vinda da execução anterior (para "Ver novidades"). */
  updated: null as { from: string; to: string; notes?: string | null } | null,
  dialog: false,
});

/** Converte o código que o Rust devolve (UPDATE_*) no caso mostrado na tela. */
export function classifyUpdateError(e: unknown): UpdateError {
  const raw = String(e);
  const code = raw.match(/UPDATE_[A-Z_]+/)?.[0] ?? '';
  const map: Record<string, UpdateErrorKind> = {
    UPDATE_NETWORK: 'network',
    UPDATE_MANIFEST: 'network',
    UPDATE_INTERRUPTED: 'interrupted',
    UPDATE_SIGNATURE: 'signature',
    UPDATE_PERMISSION: 'permission',
    UPDATE_AUTH: 'auth',
    UPDATE_NO_PACKAGE: 'noPackage',
    UPDATE_UNSUPPORTED: 'unsupported',
    UPDATE_INSTALL: 'install',
  };
  return { kind: map[code] ?? 'generic', raw };
}

export function packageLabel(p: PackageKind | undefined): string {
  return t(`update.pkg.${p ?? 'dev'}` as Parameters<typeof t>[0]);
}

export async function initUpdates(): Promise<void> {
  try {
    upd.info = await api.updateInfo();
  } catch {
    return;
  }
  const li = upd.info.lastInstall;
  if (li?.result === 'updated') {
    upd.updated = { from: li.from, to: li.to, notes: li.notes };
    upd.phase = 'updated';
    toast(t('update.toastUpdated', { v: li.to }), 'success', { label: t('update.seeNotes'), run: () => (upd.dialog = true) }, 8000);
  } else if (li?.result === 'notFinished') {
    upd.check = { available: true, current: upd.info.version, version: li.to, notes: li.notes, downloaded: true, openSessions: 0 };
    upd.phase = 'error';
    upd.error = { kind: 'notFinished', raw: `${li.from} → ${li.to}` };
  }
}

export async function checkUpdates(): Promise<void> {
  if (upd.phase === 'checking' || upd.phase === 'downloading' || upd.phase === 'installing') return;
  upd.phase = 'checking';
  upd.error = null;
  try {
    const c = await api.updateCheck();
    upd.check = c;
    app.settings.updateLastCheck = { at: Date.now(), found: c.available ? (c.version ?? null) : null };
    saveSettings();
    if (c.available) {
      upd.phase = 'available';
      upd.dialog = true;
    } else {
      upd.phase = 'uptodate';
    }
  } catch (e) {
    upd.error = classifyUpdateError(e);
    upd.phase = 'error';
  }
}

/** "Baixar e instalar": baixa (retomando, se já tinha começado), instala e reabre. */
export async function downloadAndInstall(): Promise<void> {
  if (upd.phase === 'downloading' || upd.phase === 'installing') return;
  upd.error = null;
  upd.dialog = true;
  if (!upd.check?.downloaded) {
    upd.phase = 'downloading';
    upd.progress = { received: 0, total: upd.check?.size ?? null, bytesPerSec: 0 };
    const off = await listen<UpdateProgress>('update-progress', (p) => (upd.progress = p));
    try {
      await api.updateDownload();
    } catch (e) {
      off();
      const err = classifyUpdateError(e);
      if (String(e).includes('UPDATE_CANCELED')) {
        upd.phase = 'available';
        upd.progress = null;
        return;
      }
      upd.error = err;
      upd.phase = 'error';
      return;
    }
    off();
    if (upd.check) upd.check.downloaded = true;
  }
  await install();
}

async function install(): Promise<void> {
  upd.phase = 'installing';
  upd.dialog = true;
  try {
    // Dando certo, o app fecha e o novo abre: esta chamada não volta.
    await api.updateInstall();
  } catch (e) {
    upd.error = classifyUpdateError(e);
    upd.phase = 'error';
  }
}

export async function cancelDownload(): Promise<void> {
  await api.updateCancel();
}

export function openReleases(): void {
  openUrl(RELEASES_URL).catch((e) => toast(String(e), 'error'));
}

export function openAppFolder(): void {
  const loc = upd.info?.location;
  if (loc) revealInFolder(loc).catch((e) => toast(String(e), 'error'));
}

/** Ação principal de cada erro (o botão azul). */
export function retryUpdate(): void {
  const k = upd.error?.kind;
  if (k === 'network' || k === 'noPackage' || k === 'generic') checkUpdates();
  else if (k === 'interrupted') downloadAndInstall();
  else if (k === 'notFinished' || k === 'auth' || k === 'install') {
    upd.error = null;
    install();
  } else openReleases();
}

/** "hoje, 09:12", "ontem, 18:40" ou a data. */
export function whenText(at: number, now = Date.now()): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString(lang.current, { hour: '2-digit', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date(now)) - day(d)) / 86400000);
  if (diff === 0) return t('update.today', { time });
  if (diff === 1) return t('update.yesterday', { time });
  return d.toLocaleDateString(lang.current) + ' ' + time;
}

/** Notas da Release em itens (linhas "- " viram lista). */
export function noteLines(notes?: string | null): string[] {
  if (!notes) return [];
  return notes
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*•]\s+/, '').replace(/^#+\s*/, '').trim())
    .filter((l) => l.length > 0);
}
