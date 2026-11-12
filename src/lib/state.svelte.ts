import { api, listen } from './ipc';
import { detectLang, lang, t } from './i18n.svelte';
import { friendlyName, tcpAddress } from './format';
import { classify, type AdbError, type ErrorAction } from './errors';
import { PAGE_GUIDES, TOUR } from './guides';
import type { AdbInfo, Candidate, Device, InitInfo, LogEntry, Page, Settings, Summary } from './types';
import { isFlowSerial, onUsbReady, recentlyHandled } from './wififlow.svelte';

export const DEFAULT_SETTINGS: Settings = {
  adbMode: 'auto',
  adbPath: '',
  serverHost: 'localhost',
  serverPort: 5037,
  startServerOnLaunch: true,
  stopServerOnExit: false,
  env: {},
  keepHistory: true,
  theme: 'system',
  language: '',
  summaryRefreshSec: 60,
  confirmDestructive: true,
  tourDone: false,
  pageGuides: 'unset',
  seenPages: [],
  recentConnections: [],
  savedCommands: [
    { name: 'Versão do Android', cmd: 'getprop ro.build.version.release' },
    { name: 'Apps do usuário', cmd: 'pm list packages -3' },
    { name: 'Bateria', cmd: 'dumpsys battery' },
    { name: 'Tela: ligar/desligar', cmd: 'input keyevent 26' },
    { name: 'Abrir Configurações', cmd: 'am start -a android.settings.SETTINGS' },
    { name: 'IP do Wi-Fi', cmd: 'ip -f inet addr show wlan0' },
  ],
  favorites: [],
  targetSerial: '',
  usbToWifi: 'auto',
  wifiPort: 5555,
  usbToWifiSkip: [],
  devicesView: 'grid',
};

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
  actionLabel?: string;
  action?: () => void;
}

export type Modal =
  | {
      kind: 'confirm';
      title: string;
      text: string;
      confirmLabel?: string;
      danger?: boolean;
      check?: { label: string; value: boolean };
      resolve: (r: { ok: boolean; checked: boolean }) => void;
    }
  | {
      kind: 'prompt';
      title: string;
      fields: { label: string; value: string; placeholder?: string; mono?: boolean; type?: string }[];
      confirmLabel?: string;
      resolve: (v: string[] | null) => void;
    }
  | { kind: 'error'; error: AdbError; handlers: Partial<Record<ErrorAction, () => void>> }
  | { kind: 'text'; title: string; text: string };

export interface LostDevice {
  serial: string;
  name: string;
  attempts: number;
  nextAt: number;
  gaveUp: boolean;
  busy: boolean;
}

export const MAX_RETRIES = 3;
const RETRY_EVERY_MS = 5000;

export const app = $state({
  booted: false,
  init: null as InitInfo | null,
  adb: null as AdbInfo | null,
  checked: [] as Candidate[],
  settings: structuredClone(DEFAULT_SETTINGS) as Settings,
  devices: [] as Device[],
  devicesLoaded: false,
  summaries: {} as Record<string, Summary>,
  summaryErrors: {} as Record<string, string>,
  lost: {} as Record<string, LostDevice>,
  page: 'devices' as Page,
  detailsSerial: '' as string,
  serverRunning: true,
  autoRefresh: true,
  log: [] as LogEntry[],
  logOpen: true,
  toasts: [] as Toast[],
  modal: null as Modal | null,
  tour: { active: false, step: 0, question: false, done: false },
  guide: { active: false, page: null as Page | null, step: 0 },
  /** Comando que outra tela pediu para abrir em "Todos os comandos". */
  commandRequest: null as string | null,
  /** APKs pedidos por outra tela (Instalar APK no cartão). */
  installRequest: false,
});

export const clock = $state({ now: Date.now() });

// ---------- configurações ----------

let saveTimer: ReturnType<typeof setTimeout> | undefined;
export function saveSettings(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api.saveSettings($state.snapshot(app.settings) as Settings).catch((e) => toast(String(e), 'error'));
  }, 300);
}

export function applyTheme(): void {
  const s = app.settings.theme;
  const dark = s === 'dark' || (s === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function setLanguage(l: Settings['language']): void {
  app.settings.language = l;
  lang.current = l || detectLang();
  document.documentElement.lang = lang.current;
  saveSettings();
}

// ---------- avisos e diálogos ----------

let toastId = 1;
export function toast(text: string, kind: Toast['kind'] = 'info', action?: { label: string; run: () => void }, ms = 6000): void {
  const id = toastId++;
  app.toasts.push({ id, kind, text, actionLabel: action?.label, action: action?.run });
  if (app.toasts.length > 4) app.toasts.shift();
  setTimeout(() => dismissToast(id), action ? ms + 4000 : ms);
}

export function dismissToast(id: number): void {
  const i = app.toasts.findIndex((x) => x.id === id);
  if (i >= 0) app.toasts.splice(i, 1);
}

export function confirmDialog(opts: {
  title: string;
  text: string;
  confirmLabel?: string;
  danger?: boolean;
  destructive?: boolean;
  check?: { label: string; value: boolean };
}): Promise<{ ok: boolean; checked: boolean }> {
  if (opts.destructive && !app.settings.confirmDestructive && !opts.check) return Promise.resolve({ ok: true, checked: false });
  return new Promise((resolve) => {
    app.modal = { kind: 'confirm', ...opts, resolve };
  });
}

export function promptDialog(title: string, fields: Extract<Modal, { kind: 'prompt' }>['fields'], confirmLabel?: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    app.modal = { kind: 'prompt', title, fields, confirmLabel, resolve };
  });
}

export function showError(error: AdbError, handlers: Partial<Record<ErrorAction, () => void>> = {}): void {
  app.modal = { kind: 'error', error, handlers };
}

export function textDialog(title: string, text: string): void {
  app.modal = { kind: 'text', title, text };
}

export function closeModal(): void {
  app.modal = null;
}

// ---------- navegação e guias ----------

export function navigate(page: Page): void {
  app.page = page;
  if (app.guide.active && app.guide.page !== page) app.guide.active = false;
}

export function openDetails(serial: string): void {
  app.detailsSerial = serial;
  navigate('details');
}

export function startTour(): void {
  navigate('devices');
  app.tour = { active: true, step: 0, question: false, done: false };
}

export function startPageGuide(page: Page = app.page): void {
  if (!PAGE_GUIDES[page]?.length) return;
  markPageSeen(page);
  app.guide = { active: true, page, step: 0 };
}

export function markPageSeen(page: Page): void {
  if (!app.settings.seenPages.includes(page)) {
    app.settings.seenPages.push(page);
    saveSettings();
  }
}

export function shouldOfferGuide(page: Page): boolean {
  return (
    app.settings.tourDone &&
    app.settings.pageGuides === 'ask' &&
    !app.settings.seenPages.includes(page) &&
    !app.tour.active &&
    !(app.guide.active && app.guide.page === page)
  );
}

export const tourLength = TOUR.length;

// ---------- aparelhos ----------

export function readyDevices(): Device[] {
  return app.devices.filter((d) => d.stateKind === 'device');
}

export function findDevice(serial: string): Device | undefined {
  return app.devices.find((d) => d.serial === serial);
}

export function deviceName(serial: string): string {
  const d = findDevice(serial);
  if (d) return friendlyName(d, app.summaries[serial]);
  return app.lost[serial]?.name ?? serial;
}

export function target(): Device | undefined {
  const d = findDevice(app.settings.targetSerial);
  return d && d.stateKind === 'device' ? d : undefined;
}

export function targetSerial(): string | null {
  return target()?.serial ?? null;
}

export function setTarget(serial: string): void {
  if (app.settings.targetSerial === serial) return;
  app.settings.targetSerial = serial;
  saveSettings();
}

export async function refreshSummary(serial: string, quiet = true): Promise<void> {
  try {
    const s = await api.summary(serial, quiet);
    app.summaries[serial] = s;
    delete app.summaryErrors[serial];
  } catch (e) {
    app.summaryErrors[serial] = String(e);
  }
}

export async function refreshAll(quiet = false): Promise<void> {
  if (!quiet) await api.run(['devices', '-l'], { timeoutMs: 15000 }).catch(() => undefined);
  await Promise.all(readyDevices().map((d) => refreshSummary(d.serial, true)));
}

function ensureTarget(): void {
  if (target()) return;
  const first = readyDevices()[0];
  if (first) setTarget(first.serial);
}

/** `first`: primeira lista depois de conectar ao servidor (ao abrir ou depois de reiniciar):
 * os aparelhos dela já estavam ligados, então não disparam avisos nem o Wi-Fi automático. */
function onDevices(list: Device[], first = false): void {
  const before = new Map(app.devices.map((d) => [d.serial, d]));
  const initial = !app.devicesLoaded || first;
  app.devices = list;
  app.devicesLoaded = true;
  const now = new Set(list.map((d) => d.serial));

  for (const d of list) {
    const prev = before.get(d.serial);
    if (d.stateKind === 'device' && (!prev || prev.stateKind !== 'device' || !app.summaries[d.serial])) {
      refreshSummary(d.serial);
    }
    const becameReady = d.stateKind === 'device' && (!prev || prev.stateKind !== 'device');
    if (app.lost[d.serial] && d.stateKind === 'device') {
      delete app.lost[d.serial];
      toast(t('act.reconnected', { name: deviceName(d.serial) }), 'success');
    } else if (!initial && becameReady && d.connection === 'usb' && app.settings.usbToWifi !== 'off' && !app.settings.usbToWifiSkip.includes(d.serial)) {
      // USB novo com o app aberto: o resumo chega antes do nome, então espera um pouco.
      setTimeout(() => onUsbReady(d.serial), 1200);
    } else if (!initial && !prev && d.stateKind === 'device') {
      toast(t('act.deviceArrived', { name: friendlyName(d) }), 'info');
    }
  }

  // Um aparelho pronto que sumiu: Wi-Fi tenta voltar sozinho; USB só avisa.
  if (!initial && app.serverRunning) {
    for (const [serial, prev] of before) {
      if (now.has(serial) || prev.stateKind !== 'device' || isFlowSerial(serial) || recentlyHandled(serial)) continue;
      const name = friendlyName(prev, app.summaries[serial]);
      if (tcpAddress(serial)) {
        app.lost[serial] = { serial, name, attempts: 0, nextAt: Date.now() + RETRY_EVERY_MS, gaveUp: false, busy: false };
        toast(t('act.deviceLost', { name }), 'error', { label: t('common.reconnect'), run: () => retryLost(serial) });
      } else {
        toast(t('act.deviceGone', { name }), 'error', { label: t('common.reconnect'), run: () => reconnectUsb(serial, name) });
      }
    }
  }
  ensureTarget();
}

export async function connectAddress(address: string, quiet = false): Promise<{ ok: boolean; error: AdbError | null }> {
  const r = await api.run(['connect', address], { timeoutMs: 20000, quiet });
  const err = classify(r, { op: 'connect', address });
  return { ok: !err, error: err };
}

export async function retryLost(serial: string): Promise<boolean> {
  const l = app.lost[serial];
  if (l) {
    l.busy = true;
    l.attempts++;
  }
  await api.run(['disconnect', serial], { timeoutMs: 10000, quiet: true }).catch(() => undefined);
  const { ok, error } = await connectAddress(serial);
  const cur = app.lost[serial];
  if (ok) {
    delete app.lost[serial];
    return true;
  }
  if (cur) {
    cur.busy = false;
    cur.nextAt = Date.now() + RETRY_EVERY_MS;
    if (cur.attempts >= MAX_RETRIES) cur.gaveUp = true;
  }
  return !error;
}

export function forgetLost(serial: string): void {
  delete app.lost[serial];
}

export async function reconnectUsb(serial: string, name = deviceName(serial)): Promise<boolean> {
  toast(t('act.reconnecting', { name }), 'info');
  await api.run(['reconnect', 'offline'], { timeoutMs: 15000 }).catch(() => undefined);
  const r = await api.run(['wait-for-device'], { serial, timeoutMs: 30000 });
  if (r.code === 0) {
    toast(t('act.reconnected', { name }), 'success');
    refreshSummary(serial);
    return true;
  }
  return false;
}

/** Reconectar um aparelho, por Wi-Fi ou USB. Devolve se voltou. */
export async function reconnect(serial: string): Promise<boolean> {
  if (tcpAddress(serial)) {
    if (!app.lost[serial]) {
      app.lost[serial] = { serial, name: deviceName(serial), attempts: 0, nextAt: Date.now() + 999999, gaveUp: false, busy: false };
    }
    const ok = await retryLost(serial);
    if (ok) delete app.lost[serial];
    return ok;
  }
  return reconnectUsb(serial);
}

export function addRecent(address: string, name: string): void {
  const list = app.settings.recentConnections.filter((r) => r.address !== address);
  list.unshift({ address, name, at: Date.now() });
  app.settings.recentConnections = list.slice(0, 12);
  saveSettings();
}

// ---------- registro ----------

function onLog(e: LogEntry): void {
  const i = app.log.findIndex((x) => x.id === e.id);
  if (i >= 0) app.log[i] = e;
  else {
    app.log.push(e);
    if (app.log.length > 500) app.log.splice(0, app.log.length - 500);
  }
}

export async function clearLog(): Promise<void> {
  app.log = [];
  await api.historyClear().catch(() => undefined);
}

// ---------- servidor ----------

export async function checkServer(): Promise<void> {
  app.serverRunning = await api.serverStatus().catch(() => false);
}

export async function restartServer(): Promise<void> {
  await api.serverStop().catch(() => undefined);
  const r = await api.serverStart();
  const err = classify(r);
  if (err) showError(err, { restartServer: () => restartServer(), retry: () => restartServer() });
  else toast(t('server.restarted'), 'success');
  await checkServer();
}

// ---------- início ----------

export function adoptInit(init: InitInfo): void {
  app.init = init;
  app.adb = init.adb;
  app.checked = init.checked;
  app.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(init.settings as Partial<Settings>) } as Settings;
  app.log = init.history ?? [];
  app.serverRunning = init.serverRunning;
  lang.current = app.settings.language || detectLang();
  document.documentElement.lang = lang.current;
  applyTheme();
}

let started = false;
export async function boot(): Promise<void> {
  // Escutar antes de pedir o estado: o primeiro bloco do track-devices pode já ter
  // passado, então a lista atual vem por devices_current logo em seguida.
  if (!started) {
    started = true;
    await listen<{ devices: Device[]; first: boolean }>('devices', (e) => onDevices(e.devices, e.first));
    await listen<LogEntry>('cmdlog', onLog);
    await listen<{ running: boolean }>('server', (p) => (app.serverRunning = p.running));
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
    setInterval(tick, 1000);
    setInterval(checkServer, 5000);
  }
  const init = await api.init();
  adoptInit(init);
  app.booted = true;
  if (init.adb) await loadCurrentDevices();
}

export async function loadCurrentDevices(): Promise<void> {
  const list = await api.devicesCurrent().catch(() => [] as Device[]);
  if (list.length || !app.devicesLoaded) onDevices(list, true);
}

let lastSummaryRefresh = Date.now();
function tick(): void {
  clock.now = Date.now();
  for (const l of Object.values(app.lost)) {
    if (!l.gaveUp && !l.busy && l.attempts < MAX_RETRIES && clock.now >= l.nextAt) retryLost(l.serial);
  }
  const every = Math.max(10, app.settings.summaryRefreshSec || 60) * 1000;
  if (app.autoRefresh && clock.now - lastSummaryRefresh >= every) {
    lastSummaryRefresh = clock.now;
    // A lista simplificada não mostra bateria, IP nem armazenamento: só o alvo segue atualizado.
    const compact = app.settings.devicesView === 'compact';
    for (const d of readyDevices()) {
      if (!compact || d.serial === app.settings.targetSerial) refreshSummary(d.serial);
    }
  }
}

/** Depois de escolher ou trocar o adb (primeira execução, configurações). */
export function adbChanged(info: AdbInfo): void {
  app.adb = info;
  setTimeout(loadCurrentDevices, 1500);
}
