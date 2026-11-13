// O que o cartão (grade) e as linhas (lista e lista simplificada) mostram de um aparelho.
// Fica num lugar só para as três visualizações dizerem e fazerem a mesma coisa.
import type { MenuItem } from '../components/Menu.svelte';
import * as act from './actions';
import { lang, t } from './i18n.svelte';
import { formatBytes, tcpAddress, terminalSerial } from './format';
import { app, navigate, setTarget } from './state.svelte';
import type { Device, StateKind, Summary } from './types';

export type ViewKind = StateKind | 'lost';
export type Tone = 'usb' | 'wifi' | 'emulator' | 'warn' | 'err' | 'neutral';

export function batteryText(s?: Summary | null): string {
  const b = s?.battery;
  if (b?.level == null) return '';
  if (b.status === 'charging') return t('devices.batteryCharging', { n: b.level });
  if (b.status === 'full') return t('devices.batteryFull', { n: b.level });
  return t('devices.batteryLevel', { n: b.level });
}

export function storageText(s?: Summary | null, short = false): string {
  const st = s?.storage;
  if (!st) return '';
  const used = formatBytes(st.usedKb * 1024, lang.current);
  const total = formatBytes(st.totalKb * 1024, lang.current);
  return t(short ? 'devices.storageShort' : 'devices.storageUsed', { used, total });
}

/**
 * Serial do terminal para mostrar. Sem o resumo lido ainda: o do adb, se for USB (no Wi-Fi o
 * "serial" do adb é o endereço e não serve).
 */
export function serialOf(serial: string, s?: Summary | null): string | null {
  return terminalSerial((s ?? app.summaries[serial])?.props) ?? (isWifiSerial(serial) ? null : serial);
}

export function isWifiSerial(serial: string): boolean {
  return !!tcpAddress(serial) || serial.includes('._adb-tls-connect.');
}

export function toneOf(kind: ViewKind, conn: Device['connection']): Tone {
  if (kind === 'device') return conn;
  if (kind === 'unauthorized' || kind === 'noPermissions' || kind === 'authorizing' || kind === 'connecting') return 'warn';
  if (kind === 'lost' || kind === 'offline') return 'err';
  return 'neutral';
}

export function iconOf(kind: ViewKind, conn: Device['connection']): string {
  if (kind === 'unauthorized' || kind === 'noPermissions') return 'lock';
  if (kind === 'lost') return 'wifiOff';
  return conn === 'wifi' ? 'connect' : 'devices';
}

/** Classe da etiqueta de estado (chip). */
export function stateChip(kind: ViewKind, tone: Tone): string {
  if (kind === 'device') return 'ok';
  return tone === 'err' ? 'err' : tone === 'warn' ? 'warn' : 'neutral';
}

export function openShell(serial: string): void {
  setTarget(serial);
  navigate('shell');
}

export function openInstall(serial: string): void {
  setTarget(serial);
  app.installRequest = true;
  navigate('apps');
}

/**
 * Menu ⋯ do aparelho pronto. Nas listas, `lead` traz antes o que no cartão é botão
 * (usar como alvo, shell, instalar APK), para nenhuma visualização perder ação.
 */
export function deviceMenu(serial: string, lead: MenuItem[] = []): MenuItem[] {
  const wifi = isWifiSerial(serial);
  return [
    ...lead,
    ...(lead.length ? [{ divider: true, label: '' }] : []),
    {
      label: t('menu.reboot'),
      children: [
        { label: t('menu.rebootSystem'), onclick: () => act.rebootDevice(serial) },
        { label: t('menu.rebootBootloader'), onclick: () => act.rebootDevice(serial, 'bootloader') },
        { label: t('menu.rebootRecovery'), onclick: () => act.rebootDevice(serial, 'recovery') },
        { label: t('menu.rebootSideload'), onclick: () => act.rebootDevice(serial, 'sideload') },
        { label: t('menu.rebootFastboot'), onclick: () => act.rebootDevice(serial, 'fastboot') },
      ],
    },
    { label: t('menu.toWifi'), onclick: () => act.toWifi(serial), disabled: wifi },
    { label: t('menu.screenshot'), onclick: () => act.screenshot(serial) },
    { label: t('menu.screenrecord'), onclick: () => act.screenrecord(serial) },
    { label: t('menu.bugreport'), onclick: () => act.bugreport(serial) },
    { label: t('menu.root'), onclick: () => act.adbdRoot(serial, true) },
    { label: t('menu.unroot'), onclick: () => act.adbdRoot(serial, false) },
    { label: t('menu.remount'), onclick: () => act.remount(serial) },
    { divider: true, label: '' },
    { label: t('menu.copySerial'), onclick: () => act.copySerial(serialOf(serial) ?? serial) },
    ...(serialOf(serial) && serialOf(serial) !== serial ? [{ label: t('menu.copyAdbId'), onclick: () => act.copySerial(serial) }] : []),
    ...(wifi ? [{ label: t('menu.disconnect'), danger: true, onclick: () => act.disconnectDevice(serial) }] : []),
  ];
}
