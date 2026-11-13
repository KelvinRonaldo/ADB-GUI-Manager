// Passar um aparelho do USB para o Wi-Fi, do jeito que se faz à mão:
// lê o IP, roda `adb tcpip PORTA`, roda `adb connect IP:PORTA` e confirma que ele
// apareceu pronto na lista. Não espera o cabo sair: só avisa que ele já pode sair. Começa sozinho quando um aparelho é
// ligado por USB com o app aberto (Configurações › Aparelho novo por USB), e também
// pelo cartão, pelos detalhes e pela tela Conectar.
import { api } from './ipc';
import { classify, type AdbError } from './errors';
import { t } from './i18n.svelte';
import { terminalSerial } from './format';
import { addRecent, app, deviceName, findDevice, saveSettings, setTarget } from './state.svelte';

export type StepId = 'ip' | 'tcpip' | 'connect';
export type StepState = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface WifiFlow {
  serial: string;
  name: string;
  port: number;
  auto: boolean;
  phase: 'ask' | 'run' | 'done' | 'failed';
  steps: Record<StepId, StepState>;
  ip: string;
  status: string;
  error: AdbError | null;
  /** Mensagem final de sucesso. */
  result: string;
  /** O passo onde parou, para "tentar de novo" continuar dali. */
  failedAt: StepId | null;
}

export const flow = $state({ current: null as WifiFlow | null, queue: [] as { serial: string; auto: boolean }[] });

const CONNECT_TRIES = 6;
let runId = 0;
/** Aparelhos que acabaram de passar pelo fluxo: o USB some e volta no tcpip e não deve recomeçar. */
const handled = new Map<string, number>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function freshSteps(): Record<StepId, StepState> {
  return { ip: 'pending', tcpip: 'pending', connect: 'pending' };
}

/** Passou pelo fluxo há pouco: tirar o cabo dele agora é esperado, não um aparelho perdido. */
export function recentlyHandled(serial: string): boolean {
  const last = handled.get(serial);
  return !!last && Date.now() - last < 10 * 60_000;
}

export function isFlowSerial(serial: string): boolean {
  return flow.current?.serial === serial;
}

/** Abre o fluxo. `ask`: mostra a pergunta antes (modo "Perguntar" ou outro já rodando). */
export function startWifiFlow(serial: string, opts: { auto?: boolean; ask?: boolean; port?: number } = {}): void {
  if (flow.current && flow.current.phase === 'run') {
    // Já tem um rodando (são poucos segundos): este entra na fila, que aparece na janela.
    if (flow.current.serial !== serial && !flow.queue.some((q) => q.serial === serial)) flow.queue.push({ serial, auto: !!opts.auto });
    return;
  }
  flow.current = {
    serial,
    name: deviceName(serial),
    port: opts.port ?? (app.settings.wifiPort || 5555),
    auto: !!opts.auto,
    phase: opts.ask ? 'ask' : 'run',
    steps: freshSteps(),
    ip: '',
    status: '',
    error: null,
    result: '',
    failedAt: null,
  };
  if (!opts.ask) run('ip');
}

/** Chamado pela lista de aparelhos quando um USB novo fica pronto com o app aberto. */
export function onUsbReady(serial: string): void {
  const mode = app.settings.usbToWifi;
  if (mode === 'off' || app.settings.usbToWifiSkip.includes(serial)) return;
  const last = handled.get(serial);
  if (last && Date.now() - last < HOLD_MS) return;
  if (flow.current?.serial === serial || flow.queue.some((q) => q.serial === serial)) return;
  startWifiFlow(serial, { auto: mode === 'auto', ask: mode === 'ask' });
}

export function confirmAsk(): void {
  const f = flow.current;
  if (!f) return;
  f.phase = 'run';
  run('ip');
}

export function skipDevice(): void {
  const f = flow.current;
  if (!f) return;
  if (!app.settings.usbToWifiSkip.includes(f.serial)) {
    app.settings.usbToWifiSkip.push(f.serial);
    saveSettings();
  }
  close();
}

const HOLD_MS = 90_000;
const SHORT_HOLD_MS = 8_000;

export function close(): void {
  runId++;
  const f = flow.current;
  // Depois de um sucesso, ignora o aparelho por um tempo (o USB volta quando o adbd
  // reinicia). Depois de falha ou cancelamento, só pelos segundos do reinício: religar
  // o cabo recomeça o processo.
  if (f) handled.set(f.serial, f.phase === 'done' ? Date.now() : Date.now() - (HOLD_MS - SHORT_HOLD_MS));
  flow.current = null;
  const next = flow.queue.shift();
  if (next) setTimeout(() => startWifiFlow(next.serial, { auto: next.auto, ask: app.settings.usbToWifi === 'ask' }), 300);
}

export function retry(): void {
  const f = flow.current;
  if (!f) return;
  const from = f.failedAt ?? 'ip';
  f.error = null;
  f.phase = 'run';
  run(from);
}

export function restart(): void {
  const f = flow.current;
  if (!f) return;
  f.steps = freshSteps();
  f.error = null;
  f.phase = 'run';
  f.ip = '';
  run('ip');
}

function fail(f: WifiFlow, step: StepId, error: AdbError | null, status = '') {
  f.steps[step] = 'error';
  f.phase = 'failed';
  f.failedAt = step;
  f.error = error;
  f.status = status;
}

async function run(from: StepId): Promise<void> {
  const my = ++runId;
  const f = flow.current;
  if (!f) return;
  const alive = () => my === runId && flow.current === f;
  const order: StepId[] = ['ip', 'tcpip', 'connect'];
  const address = () => `${f.ip}:${f.port}`;

  for (const step of order.slice(order.indexOf(from))) {
    if (!alive()) return;
    if (f.steps[step] === 'skipped' || f.steps[step] === 'done') continue;
    f.steps[step] = 'running';

    if (step === 'ip') {
      f.status = t('wifi.readingIp');
      try {
        const r = await api.wifiIp(f.serial);
        if (!alive()) return;
        const err = classify(r.result);
        if (err) return fail(f, 'ip', err);
        if (!r.ip) return fail(f, 'ip', null, t('wifi.noIp'));
        f.ip = r.ip;
      } catch (e) {
        return fail(f, 'ip', classify(String(e)));
      }
      // Já está no Wi-Fi com esse endereço: não precisa mexer no adbd.
      const existing = findDevice(address());
      if (existing?.stateKind === 'device') {
        f.steps = { ip: 'done', tcpip: 'skipped', connect: 'done' };
        f.phase = 'done';
        f.result = t('wifi.alreadyWifi', { name: f.name, address: address() });
        if (app.settings.targetSerial === f.serial) setTarget(address());
        return;
      }
    }

    if (step === 'tcpip') {
      f.status = t('wifi.step.tcpip', { port: f.port });
      try {
        const r = await api.run(['tcpip', String(f.port)], { serial: f.serial, timeoutMs: 20000 });
        if (!alive()) return;
        const err = classify(r);
        if (err) return fail(f, 'tcpip', err);
      } catch (e) {
        return fail(f, 'tcpip', classify(String(e)));
      }
      // O adbd reinicia: o USB some e volta em poucos segundos; o connect espera isso.
      await sleep(2500);
    }

    if (step === 'connect') {
      let lastErr: AdbError | null = null;
      for (let i = 1; i <= CONNECT_TRIES; i++) {
        if (!alive()) return;
        f.status = t('wifi.connecting', { address: address(), n: i, max: CONNECT_TRIES });
        try {
          const r = await api.run(['connect', address()], { timeoutMs: 15000 });
          if (!alive()) return;
          lastErr = classify(r, { op: 'connect', address: address() });
        } catch (e) {
          lastErr = classify(String(e));
        }
        if (!lastErr) {
          // Confirma pela lista: "connected to" ainda pode virar offline.
          for (let w = 0; w < 20 && alive(); w++) {
            const d = findDevice(address());
            if (d?.stateKind === 'device') break;
            await sleep(500);
          }
          const d = findDevice(address());
          if (d?.stateKind === 'device') break;
          lastErr = classify({ id: 0, cmd: `adb connect ${address()}`, code: 1, stdout: '', stderr: d ? `device ${d.state}` : 'device offline', durationMs: 0, timedOut: false });
        }
        await sleep(2000);
      }
      if (!alive()) return;
      if (lastErr) return fail(f, 'connect', lastErr, t('wifi.failed', { address: address() }));
    }

    f.steps[step] = 'done';
  }

  if (!alive()) return;
  f.phase = 'done';
  f.status = '';
  addRecent(address(), f.name, terminalSerial(app.summaries[f.serial]?.props));
  const wasTarget = app.settings.targetSerial === f.serial || !findDevice(app.settings.targetSerial);
  if (wasTarget) setTarget(address());
  f.result = t('wifi.done', { name: f.name, address: address() }) + (wasTarget ? ' ' + t('wifi.doneTarget') : '');
  handled.set(f.serial, Date.now());
}
