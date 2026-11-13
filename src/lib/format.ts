import type { Device, Summary } from './types';

export function formatBytes(n: number | null | undefined, lang = 'pt-BR'): string {
  if (n == null || isNaN(n)) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = v < 10 && i > 0 ? 1 : 0;
  return `${v.toLocaleString(lang, { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${units[i]}`;
}

export function formatTime(ts: number, lang = 'pt-BR'): string {
  return new Date(ts).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDate(ts: number, lang = 'pt-BR'): string {
  return new Date(ts).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' });
}

function titleCase(s: string): string {
  if (!s) return s;
  if (s === s.toUpperCase() && s.length > 3) return s.charAt(0) + s.slice(1).toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Nome amigável: "Gertec GPOS760", a partir do resumo ou do `devices -l`. */
export function friendlyName(d: Device | null | undefined, s?: Summary | null): string {
  if (!d) return '';
  const p = s?.props ?? {};
  const maker = p['ro.product.manufacturer'] || p['ro.product.brand'] || '';
  const model = (p['ro.product.model'] || d.model || '').replace(/_/g, ' ');
  if (model) {
    const m = titleCase(maker);
    return m && !model.toLowerCase().startsWith(m.toLowerCase()) ? `${m} ${model}` : model;
  }
  return d.serial;
}

/**
 * Serial do terminal, que nem sempre é o que o adb mostra (o GPOS760 aparece no adb como
 * 100950089069061453 e tem serial 5901152448001549). Cada fabricante guarda num lugar;
 * sem nenhum, vale o ro.serialno.
 */
export const SERIAL_PROPS = [
  'persist.sys.device.sn', // Gertec
  'persist.sys.SN', // Gertec
  'ro.sunmi.serial', // Sunmi
  'pax.sp.SN', // PAX
  'ro.fac.sn', // PAX
  'ro.epay.serial', // PAX
  'ro.serialno',
  'ro.boot.serialno',
];

export function terminalSerial(props?: Record<string, string> | null): string | null {
  if (!props) return null;
  for (const k of SERIAL_PROPS) {
    const v = (props[k] ?? '').trim();
    if (v && !/^(unknown|null|none)$/i.test(v) && !/^0+$/.test(v)) return v;
  }
  return null;
}

export function androidLabel(s?: Summary | null): string {
  const p = s?.props;
  if (!p) return '';
  const parts: string[] = [];
  if (p['ro.build.version.release']) parts.push(`Android ${p['ro.build.version.release']}`);
  if (p['ro.build.version.sdk']) parts.push(`API ${p['ro.build.version.sdk']}`);
  const abi = (p['ro.product.cpu.abilist'] || p['ro.product.cpu.abi'] || '').split(',')[0];
  if (abi) parts.push(abi);
  return parts.join(' · ');
}

/** IP:porta de um serial Wi-Fi, ou null (USB, emulador, nome mDNS). */
export function tcpAddress(serial: string): string | null {
  return /^[\w.-]+:\d+$/.test(serial) ? serial : null;
}
