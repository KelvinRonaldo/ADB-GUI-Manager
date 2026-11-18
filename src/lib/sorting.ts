// Ordem da tela Aparelhos. Na lista, clicar no título de uma coluna ordena por ela (de novo, inverte);
// na grade e na simplificada há um seletor só com o nome (A–Z, Z–A).
import type { Device, DevicesSort, DevicesSortKey } from './types';

export interface SortRow {
  serial: string;
  name: string;
  conn: Device['connection'];
  /** Serial mostrado na coluna (o do terminal, quando já lido). */
  id: string;
  battery: number | null;
  ip: string | null;
  /** Fração usada do armazenamento (0–1). */
  storage: number | null;
}

export const DEFAULT_SORT: DevicesSort = { key: 'name', dir: 'asc' };

const CONN_ORDER: Record<Device['connection'], number> = { usb: 0, wifi: 1, emulator: 2 };

/** IPv4 comparável pelos números (192.168.0.9 antes de 192.168.0.10); o resto, como texto. */
function ipKey(ip: string): string {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)/);
  return m ? m.slice(1).map((n) => n.padStart(3, '0')).join('.') : ip;
}

function valueOf(r: SortRow, key: DevicesSortKey): string | number | null {
  switch (key) {
    case 'name':
      return r.name;
    case 'conn':
      return CONN_ORDER[r.conn];
    case 'id':
      return r.id;
    case 'battery':
      return r.battery;
    case 'ip':
      return r.ip ? ipKey(r.ip) : null;
    case 'storage':
      return r.storage;
  }
}

/**
 * Ordena sem mexer na lista recebida. Valor que falta (bateria ainda não lida, sem Wi-Fi) fica sempre
 * no fim, nos dois sentidos; empate desempata pelo nome (A–Z) e pelo serial do adb, para a ordem não pular.
 */
export function sortRows<T extends SortRow>(rows: T[], sort: DevicesSort, locale = 'pt-BR'): T[] {
  const coll = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const cmp = (a: string | number, b: string | number) =>
    typeof a === 'number' && typeof b === 'number' ? a - b : coll.compare(String(a), String(b));
  const sign = sort.dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = valueOf(a, sort.key);
    const vb = valueOf(b, sort.key);
    const missA = va == null || va === '';
    const missB = vb == null || vb === '';
    if (missA !== missB) return missA ? 1 : -1;
    if (!missA) {
      const c = cmp(va!, vb!);
      if (c !== 0) return sign * c;
    }
    return coll.compare(a.name, b.name) || coll.compare(a.serial, b.serial);
  });
}

/** Clique no título da coluna: a mesma coluna inverte; outra começa crescente. */
export function nextSort(cur: DevicesSort, key: DevicesSortKey): DevicesSort {
  if (cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: 'asc' };
}

/** Grade e simplificada ordenam só pelo nome: no sentido salvo, se a ordem salva for pelo nome. */
export function nameSort(cur: DevicesSort): DevicesSort {
  return { key: 'name', dir: cur.key === 'name' ? cur.dir : 'asc' };
}
