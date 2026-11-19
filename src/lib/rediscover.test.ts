import { describe, expect, it } from 'vitest';
import { idsFromProps, sameDevice, searchable, serviceMatches } from './rediscover.svelte';
import type { RecentConnection } from './types';

const rec = (o: Partial<RecentConnection>): RecentConnection => ({
  address: '192.168.0.57:5555',
  name: 'GPOS720',
  at: 0,
  ...o,
});

describe('reencontrar aparelhos pelo serial', () => {
  it('junta os seriais das propriedades, sem vazios nem repetidos', () => {
    expect(
      idsFromProps({
        'persist.sys.customerSN': '5811012502001097',
        'ro.serialno': '573c062c',
        'ro.boot.serialno': '573c062c',
        'pax.sp.SN': 'unknown',
      }),
    ).toEqual(['5811012502001097', '573c062c']);
    expect(idsFromProps(null)).toEqual([]);
  });

  it('é o mesmo aparelho quando qualquer serial bate', () => {
    const r = rec({ ids: ['5811012502001097', '573c062c'] });
    expect(sameDevice(r, { 'ro.serialno': '573c062c' })).toBe(true);
    expect(sameDevice(r, { 'ro.serialno': 'outro' })).toBe(false);
    expect(
      sameDevice(rec({ serial: '5811012502001097' }), {
        'persist.sys.customerSN': '5811012502001097',
      }),
    ).toBe(true);
    expect(sameDevice(rec({}), { 'ro.serialno': '573c062c' })).toBe(false);
  });

  it('casa o serviço mDNS adb-<serial>-<sufixo> só na porta de conexão', () => {
    const r = rec({ ids: ['PB1SP39E70207'] });
    expect(
      serviceMatches(r, {
        name: 'adb-PB1SP39E70207-aBc12',
        service: '_adb-tls-connect._tcp',
        address: '192.168.0.42:41235',
      }),
    ).toBe(true);
    expect(
      serviceMatches(r, {
        name: 'adb-PB1SP39E70207-aBc12',
        service: '_adb-tls-pairing._tcp',
        address: '192.168.0.42:37215',
      }),
    ).toBe(false);
    expect(
      serviceMatches(r, {
        name: 'adb-PB1SP39E702070-x',
        service: '_adb-tls-connect._tcp',
        address: '192.168.0.42:41235',
      }),
    ).toBe(false);
  });

  it('só procura quem tem serial ou MAC guardado', () => {
    expect(searchable(rec({}))).toBe(false);
    expect(searchable(rec({ mac: '3c:2e:ff:01:02:9a' }))).toBe(true);
    expect(searchable(rec({ serial: 'X' }))).toBe(true);
  });
});
