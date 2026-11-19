// Reencontrar aparelhos Wi-Fi cujo IP mudou (DHCP do escritório; pedido do Kelvin, 19/11/2026).
//
// O app lembra o aparelho pelos seriais (do terminal e do adb) e pelo MAC do Wi-Fi, e procura nesta ordem:
//   1. mDNS do adb: Android 11+ pareado anuncia "adb-<serial>-…" com o IP e a porta atuais;
//   2. MAC na tabela ARP do PC, depois de uma varredura rápida da sub-rede;
//   3. porta 5555 aberta na sub-rede, conferindo o serial pelo aperto de mão do adb (net.rs).
// Só conecta quando o serial bate. O aperto de mão nunca pede autorização a um aparelho que não conhece o PC.
import { api } from './ipc';
import { t } from './i18n.svelte';
import { SERIAL_PROPS } from './format';
import { app, connectAddress, forgetLost, markRemoved, saveSettings, toast } from './state.svelte';
import type { MdnsService, RecentConnection, RediscoverPath } from './types';

export type StepState = 'wait' | 'run' | 'done' | 'skip' | 'fail';
export interface Step {
  path: RediscoverPath;
  state: StepState;
  text: string;
  done?: number;
  total?: number;
}
export type TargetState = 'searching' | 'found' | 'notFound';

export const search = $state({
  running: false,
  /** Mostrar o painel (fica aberto com o resultado até fechar). */
  open: false,
  steps: [] as Step[],
  /** Endereço antigo → situação na procura atual (ou na última). */
  targets: {} as Record<string, TargetState>,
  subnet: '',
  found: 0,
  total: 0,
});
let stopRequested = false;

const hostOf = (a: string) => a.split(':')[0];
const portOf = (a: string) => parseInt(a.split(':')[1] ?? '', 10) || 5555;
const clean = (v?: string | null) => (v ?? '').trim();
const valid = (v: string) => v !== '' && !/^(unknown|null|none)$/i.test(v) && !/^0+$/.test(v);

/** Seriais que identificam o aparelho, das propriedades lidas (resumo ou aperto de mão). */
export function idsFromProps(props?: Record<string, string> | null): string[] {
  if (!props) return [];
  const out: string[] = [];
  for (const k of SERIAL_PROPS) {
    const v = clean(props[k]);
    if (valid(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/** O aparelho das propriedades é o da conexão guardada? */
export function sameDevice(r: RecentConnection, props: Record<string, string>): boolean {
  const mine = r.ids?.length ? r.ids : r.serial ? [r.serial] : [];
  if (!mine.length) return false;
  return idsFromProps(props).some((id) => mine.includes(id));
}

/** Serviço mDNS "adb-<serial>-<sufixo>" de um dos seriais da conexão guardada. */
export function serviceMatches(r: RecentConnection, s: MdnsService): boolean {
  if (!s.service.startsWith('_adb-tls-connect')) return false;
  const mine = r.ids?.length ? r.ids : r.serial ? [r.serial] : [];
  const name = s.name.toLowerCase();
  return mine.some((id) => id.length >= 4 && (name === `adb-${id.toLowerCase()}` || name.startsWith(`adb-${id.toLowerCase()}-`)));
}

/** Dá para procurar: tem serial ou MAC guardados. */
export function searchable(r: RecentConnection): boolean {
  return !!(r.ids?.length || r.serial || r.mac);
}

/** Guarda serial e MAC de uma conexão de rede que está pronta (chamado quando o resumo chega). */
export async function rememberIdentity(address: string, props: Record<string, string>): Promise<void> {
  const r = app.settings.recentConnections.find((x) => x.address === address);
  if (!r) return;
  const ids = idsFromProps(props);
  let changed = false;
  if (ids.length && ids.join('|') !== (r.ids ?? []).join('|')) {
    r.ids = ids;
    changed = true;
  }
  // O MAC só é lido uma vez (no Windows a leitura roda o "arp -a"); some quando o aparelho é achado por outro caminho.
  if (!r.mac)
    try {
      const mac = (await api.netArp())[hostOf(address)];
      if (mac && mac !== r.mac) {
        r.mac = mac;
        changed = true;
      }
    } catch {
      // Sem tabela ARP: fica só com os seriais.
    }
  if (changed) saveSettings();
}

function setStep(path: RediscoverPath, patch: Partial<Step>) {
  const s = search.steps.find((x) => x.path === path);
  if (s) Object.assign(s, patch);
}

function pending(list: RecentConnection[]): RecentConnection[] {
  return list.filter((r) => search.targets[r.address] === 'searching');
}

/** Achou: desliga o endereço velho, conecta no novo e atualiza a conexão guardada. */
async function adopt(r: RecentConnection, address: string, by: RediscoverPath): Promise<boolean> {
  const old = r.address;
  if (address !== old) {
    markRemoved(old);
    forgetLost(old);
    await api.run(['disconnect', old], { timeoutMs: 8000, quiet: true }).catch(() => undefined);
  }
  const { ok } = await connectAddress(address, true);
  if (!ok) {
    markRemoved(old, false);
    return false;
  }
  const list = app.settings.recentConnections.filter((x) => x.address !== address || x === r);
  const cur = list.find((x) => x === r);
  if (cur) {
    if (address !== old) cur.prevAddress = old;
    cur.address = address;
    cur.foundBy = by;
    // Achado sem ser pelo MAC: o MAC guardado pode ter mudado (MAC aleatório); é lido de novo.
    if (by !== 'arp') cur.mac = undefined;
    cur.foundAt = Date.now();
    cur.at = Date.now();
  }
  app.settings.recentConnections = list;
  saveSettings();
  delete search.targets[old];
  search.targets[address] = 'found';
  search.found++;
  if (address !== old)
    toast(
      t('rd.foundToast', {
        name: r.name,
        address: hostOf(address),
        old: hostOf(old),
      }),
      'success',
    );
  return true;
}

/** Endereço guardado que está conectado agora (nada a procurar). */
function isConnected(r: RecentConnection): boolean {
  return app.devices.some((d) => d.serial === r.address && d.stateKind === 'device');
}

/**
 * Procura os aparelhos guardados que não estão conectados (ou só os `addresses` pedidos).
 * `quiet`: procura de fundo (aparelho que caiu): sem abrir o painel.
 */
export async function rediscover(addresses?: string[], quiet = false): Promise<number> {
  if (search.running) return 0;
  const all = app.settings.recentConnections;
  const list = all.filter((r) => (addresses ? addresses.includes(r.address) : !isConnected(r)) && searchable(r));
  if (!list.length) {
    if (!quiet) toast(t('rd.nothing'), 'info');
    return 0;
  }
  const paths = app.settings.rediscoverPaths ?? ['mdns', 'arp', 'port'];
  stopRequested = false;
  search.running = true;
  search.open = !quiet;
  search.found = 0;
  search.total = list.length;
  search.targets = Object.fromEntries(list.map((r) => [r.address, 'searching' as TargetState]));
  search.steps = (['mdns', 'arp', 'port'] as RediscoverPath[]).map((p) => ({
    path: p,
    state: paths.includes(p) ? 'wait' : 'skip',
    text: '',
  }));
  try {
    // 1. mDNS
    if (paths.includes('mdns')) {
      setStep('mdns', { state: 'run', text: t('rd.mdnsRun') });
      const svcs = await api.mdns(true).catch(() => [] as MdnsService[]);
      let n = 0;
      for (const r of pending(list)) {
        const s = svcs.find((x) => serviceMatches(r, x));
        if (s && (await adopt(r, s.address, 'mdns'))) n++;
      }
      setStep('mdns', { state: 'done', text: t('rd.stepFound', { n }) });
    }
    if (stopRequested || !pending(list).length) return search.found;

    // Varredura (serve ao MAC e à porta): sub-rede do PC + faixas extras.
    const needSweep = paths.includes('arp') || paths.includes('port');
    if (!needSweep) return search.found;
    const net = await api.netInfo().catch(() => ({ localIp: null, subnet: null }));
    const ranges = [net.subnet, ...(app.settings.rediscoverRanges ?? [])].filter((x): x is string => !!x && !!x.trim());
    search.subnet = ranges.join(', ');
    if (!ranges.length) {
      for (const p of ['arp', 'port'] as const) if (paths.includes(p)) setStep(p, { state: 'fail', text: t('rd.noNetwork') });
      return search.found;
    }
    if (paths.includes('arp')) setStep('arp', { state: 'run', text: t('rd.sweeping') });
    if (paths.includes('port')) setStep('port', { state: 'run', text: t('rd.sweeping') });
    const sw = await api.netSweep(ranges, 5555);
    if (stopRequested) return search.found;

    // 2. MAC
    if (paths.includes('arp')) {
      let n = 0;
      for (const r of pending(list)) {
        if (!r.mac) continue;
        const ip = Object.keys(sw.arp).find((k) => sw.arp[k] === r.mac);
        if (!ip) continue;
        const addr = `${ip}:${portOf(r.address)}`;
        // O MAC já identifica o aparelho. O aperto de mão confirma quando responde; aparelho antigo
        // (Android 7, Positivo L3) não responde enquanto outra conexão está aberta nele, e aí vale o MAC.
        // Só desiste se o serial lido for de outro aparelho ou se ele não conhece a chave do PC.
        let ok = true;
        try {
          ok = sameDevice(r, (await api.netIdentify(addr)).props);
        } catch (e) {
          ok = !String(e).includes('NOT_AUTHORIZED');
        }
        if (ok && (await adopt(r, addr, 'arp'))) n++;
      }
      setStep('arp', { state: 'done', text: t('rd.stepFound', { n }) });
    }
    if (stopRequested || !pending(list).length) {
      if (paths.includes('port')) setStep('port', { state: 'skip', text: t('rd.notNeeded') });
      return search.found;
    }

    // 3. Porta 5555: confere o serial de quem respondeu e ainda não está conectado.
    if (paths.includes('port')) {
      const busy = new Set(app.devices.map((d) => hostOf(d.serial)));
      const cands = sw.open.filter((ip) => !busy.has(ip));
      setStep('port', {
        state: 'run',
        text: t('rd.portRun', { open: sw.open.length, scanned: sw.scanned }),
        done: 0,
        total: cands.length,
      });
      let n = 0;
      let i = 0;
      const worker = async () => {
        while (i < cands.length && !stopRequested && pending(list).length) {
          const ip = cands[i++];
          const addr = `${ip}:5555`;
          const id = await api.netIdentify(addr).catch(() => null);
          setStep('port', {
            done: (search.steps.find((s) => s.path === 'port')?.done ?? 0) + 1,
          });
          if (!id) continue;
          const r = pending(list).find((x) => sameDevice(x, id.props));
          if (r && (await adopt(r, addr, 'port'))) n++;
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, cands.length) }, worker));
      setStep('port', { state: 'done', text: t('rd.stepFound', { n }) });
    }
    return search.found;
  } catch (e) {
    for (const s of search.steps) if (s.state === 'run') Object.assign(s, { state: 'fail', text: String(e) });
    return search.found;
  } finally {
    for (const a of Object.keys(search.targets)) if (search.targets[a] === 'searching') search.targets[a] = 'notFound';
    search.running = false;
    if (!quiet || search.found) {
      const missing = search.total - search.found;
      toast(missing ? t('rd.doneSome', { found: search.found, total: search.total }) : t('rd.doneAll', { n: search.found }), missing ? 'info' : 'success');
    }
  }
}

export function stopRediscover(): void {
  stopRequested = true;
}

export function closePanel(): void {
  if (!search.running) search.open = false;
}
