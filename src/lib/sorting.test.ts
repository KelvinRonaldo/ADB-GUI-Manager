import { describe, expect, it } from 'vitest';
import { nameSort, nextSort, sortRows, type SortRow } from './sorting';

const row = (serial: string, name: string, o: Partial<SortRow> = {}): SortRow => ({
  serial,
  name,
  conn: 'usb',
  id: serial,
  battery: null,
  ip: null,
  storage: null,
  ...o,
});

const names = (rows: SortRow[]) => rows.map((r) => r.name);

describe('ordem da tela Aparelhos', () => {
  const rows = [
    row('c', 'Sunmi P2', { battery: 40, ip: '192.168.0.10', conn: 'wifi', storage: 0.5 }),
    row('a', 'gertec GPOS760', { battery: 90, ip: '192.168.0.9', storage: 0.2 }),
    row('b', 'PAX A910', { conn: 'emulator' }),
    row('d', 'Aparelho 10', { battery: 5 }),
    row('e', 'Aparelho 9', { battery: 5 }),
  ];

  it('nome A–Z e Z–A, sem diferenciar maiúscula e com números na ordem natural', () => {
    expect(names(sortRows(rows, { key: 'name', dir: 'asc' }))).toEqual(['Aparelho 9', 'Aparelho 10', 'gertec GPOS760', 'PAX A910', 'Sunmi P2']);
    expect(names(sortRows(rows, { key: 'name', dir: 'desc' }))).toEqual(['Sunmi P2', 'PAX A910', 'gertec GPOS760', 'Aparelho 10', 'Aparelho 9']);
  });

  it('bateria: quem não tem valor fica no fim nos dois sentidos; empate pelo nome', () => {
    expect(names(sortRows(rows, { key: 'battery', dir: 'asc' }))).toEqual(['Aparelho 9', 'Aparelho 10', 'Sunmi P2', 'gertec GPOS760', 'PAX A910']);
    expect(names(sortRows(rows, { key: 'battery', dir: 'desc' }))).toEqual(['gertec GPOS760', 'Sunmi P2', 'Aparelho 9', 'Aparelho 10', 'PAX A910']);
  });

  it('IP pelos números e conexão na ordem USB, Wi-Fi, emulador', () => {
    expect(names(sortRows(rows, { key: 'ip', dir: 'asc' })).slice(0, 2)).toEqual(['gertec GPOS760', 'Sunmi P2']);
    expect(sortRows(rows, { key: 'conn', dir: 'asc' }).map((r) => r.conn)).toEqual(['usb', 'usb', 'usb', 'wifi', 'emulator']);
  });

  it('não altera a lista recebida', () => {
    const copy = [...rows];
    sortRows(rows, { key: 'name', dir: 'desc' });
    expect(rows).toEqual(copy);
  });

  it('clique no título: mesma coluna inverte, outra começa crescente', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' });
    expect(nextSort({ key: 'name', dir: 'desc' }, 'battery')).toEqual({ key: 'battery', dir: 'asc' });
  });

  it('grade e simplificada usam só o nome', () => {
    expect(nameSort({ key: 'name', dir: 'desc' })).toEqual({ key: 'name', dir: 'desc' });
    expect(nameSort({ key: 'battery', dir: 'desc' })).toEqual({ key: 'name', dir: 'asc' });
  });
});
