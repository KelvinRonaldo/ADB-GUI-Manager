<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import TopBar from '../components/TopBar.svelte';
  import PageGuideOffer from '../components/PageGuideOffer.svelte';
  import ErrorState from '../components/ErrorState.svelte';
  import Icon from '../components/Icon.svelte';
  import { t } from '../lib/i18n.svelte';
  import { api, listen, pickSavePath } from '../lib/ipc';
  import { classify, streamError, type AdbError } from '../lib/errors';
  import { splitArgs, shQuote } from '../lib/shellwords';
  import { confirmDialog, deviceName, targetSerial, toast } from '../lib/state.svelte';
  import type { StreamEvent } from '../lib/types';

  interface Line {
    n: number;
    raw: string;
    time?: string;
    pid?: string;
    tid?: string;
    level?: string;
    tag?: string;
    msg?: string;
  }
  const LEVELS = ['V', 'D', 'I', 'W', 'E', 'F'];
  const MAX = 20000;
  const SHOW = 2500;
  const RE = /^(\d\d-\d\d\s+\d\d:\d\d:\d\d\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEFSA])\s+(.*?)\s*: (.*)$/;

  let minLevel = $state('V');
  let pkg = $state('');
  let pid = $state('');
  let tags = $state('');
  let regex = $state('');
  let buffer = $state('');
  let paused = $state(false);
  let autoscroll = $state(true);
  let lines = $state.raw<Line[]>([]);
  let streamId = $state<number | null>(null);
  let streamSerial = '';
  let stoppedByUser = false;
  let error = $state<AdbError | null>(null);
  let errTail = '';
  let carry = '';
  let counter = 0;
  let pending: Line[] = [];
  let userPackages = $state<string[]>([]);
  let box: HTMLElement | undefined = $state();

  const serial = $derived(targetSerial());

  function parse(raw: string): Line {
    const m = raw.match(RE);
    if (!m) return { n: counter++, raw };
    return { n: counter++, raw, time: m[1], pid: m[2], tid: m[3], level: m[4], tag: m[5], msg: m[6] };
  }

  function args(): string[] {
    const a = ['logcat', '-v', 'threadtime'];
    if (buffer) a.push('-b', buffer);
    if (pid) a.push(`--pid=${pid}`);
    if (regex.trim()) a.push('-e', regex.trim());
    try {
      a.push(...splitArgs(tags));
    } catch {
      /* aspas abertas: ignora as tags até fechar */
    }
    return a;
  }

  async function start() {
    const s = serial;
    if (!s) return;
    await stop(true);
    error = null;
    errTail = '';
    carry = '';
    stoppedByUser = false;
    streamSerial = s;
    try {
      streamId = await api.streamStart(args(), s);
    } catch (e) {
      error = classify(String(e));
    }
  }

  async function stop(silent = false) {
    if (streamId != null) {
      stoppedByUser = true;
      const id = streamId;
      streamId = null;
      await api.streamStop(id);
    }
    if (!silent) flush();
  }

  function flush() {
    if (!pending.length) return;
    const next = lines.concat(pending);
    pending = [];
    lines = next.length > MAX ? next.slice(next.length - MAX) : next;
    if (autoscroll) tick().then(() => box && (box.scrollTop = box.scrollHeight));
  }

  let flushTimer: ReturnType<typeof setInterval> | undefined;
  let offStream: (() => void) | undefined;
  onMount(async () => {
    offStream = await listen<StreamEvent>('stream', (e) => {
      if (e.id !== streamId) return;
      if (e.kind === 'end') {
        streamId = null;
        if (!stoppedByUser) error = streamError(`adb -s ${streamSerial} logcat`, e.code ?? -1, errTail);
        return;
      }
      if (e.kind === 'err') {
        errTail = (errTail + e.data).slice(-2000);
        return;
      }
      const text = carry + e.data;
      const parts = text.split('\n');
      carry = parts.pop() ?? '';
      for (const p of parts) {
        const raw = p.replace(/\r$/, '');
        if (raw) pending.push(parse(raw));
      }
    });
    flushTimer = setInterval(() => !paused && flush(), 250);
  });
  onDestroy(() => {
    clearInterval(flushTimer);
    offStream?.();
    stop(true);
  });

  // Inicia sozinho no primeiro alvo e reinicia quando o alvo muda.
  let startedFor = '';
  $effect(() => {
    if (serial && serial !== startedFor) {
      startedFor = serial;
      lines = [];
      pid = '';
      pkg = '';
      start();
      api
        .packages(serial, 'user')
        .then((r) => (userPackages = r.packages.map((p) => p.name)))
        .catch(() => undefined);
    }
  });

  async function chooseApp() {
    const s = serial;
    if (!s) return;
    if (!pkg.trim()) {
      pid = '';
      start();
      return;
    }
    const r = await api.run(['shell', `pidof ${shQuote(pkg.trim())}`], { serial: s, timeoutMs: 10000 });
    const p = r.stdout.trim().split(/\s+/)[0];
    if (!p) {
      toast(t('logcat.appNotRunning', { pkg: pkg.trim() }), 'error');
      return;
    }
    pid = p;
    start();
  }

  async function clearDevice() {
    const c = await confirmDialog({ title: t('confirm.logcatClearTitle'), text: t('confirm.logcatClearText'), destructive: true, danger: true, confirmLabel: t('logcat.clearDevice') });
    if (!c.ok || !serial) return;
    const r = await api.run(['logcat', '-c'], { serial, timeoutMs: 15000 });
    const err = classify(r);
    if (err) error = err;
    lines = [];
    pending = [];
  }

  const minIdx = $derived(LEVELS.indexOf(minLevel));
  const shown = $derived.by(() => {
    const out: Line[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < SHOW; i--) {
      const l = lines[i];
      if (l.level && LEVELS.indexOf(l.level) < minIdx) continue;
      out.push(l);
    }
    return out.reverse();
  });

  async function save() {
    const path = await pickSavePath(`logcat-${(serial ? deviceName(serial) : 'adb').replace(/\W+/g, '_')}.txt`, [{ name: 'Texto', extensions: ['txt', 'log'] }]);
    if (!path) return;
    await api.writeTextFile(path, shown.map((l) => l.raw).join('\n') + '\n');
    toast(t('logcat.saved', { path }), 'success');
  }
</script>

<div class="page">
  <TopBar heading={t('logcat.title')} sub={streamId != null ? t('logcat.live', { n: lines.length }) : t('logcat.stopped', { n: lines.length })} />
  <div class="page-body">
    <PageGuideOffer page="logcat" />
    {#if !serial}
      <div class="card empty">{t('common.chooseDevice')}</div>
    {:else}
      <div class="card bar">
        <div class="filters" data-guide="logcat-filters">
          <div class="field">
            <span>{t('logcat.level')}</span>
            <div class="seg" role="group" aria-label={t('logcat.level')}>
              {#each LEVELS as l (l)}
                <button type="button" aria-pressed={minLevel === l} onclick={() => (minLevel = l)}>{l}</button>
              {/each}
            </div>
          </div>
          <label class="field"
            >{t('logcat.app')}
            <input class="input" list="lc-pkgs" placeholder={t('logcat.allApps')} bind:value={pkg} onchange={chooseApp} />
            <datalist id="lc-pkgs">{#each userPackages as p (p)}<option value={p}></option>{/each}</datalist>
          </label>
          <label class="field">{t('logcat.tags')}<input class="input mono" placeholder="ActivityManager:I *:S" bind:value={tags} onchange={start} /></label>
          <label class="field grow">{t('logcat.search')}<input class="input mono" placeholder="erro|exception" bind:value={regex} onchange={start} /></label>
          <label class="field"
            >{t('logcat.buffer')}
            <select class="select" bind:value={buffer} onchange={start}>
              <option value="">main,system,crash</option>
              {#each ['all', 'main', 'system', 'crash', 'radio', 'events', 'kernel'] as b (b)}<option value={b}>{b}</option>{/each}
            </select>
          </label>
        </div>
        <div class="row" data-guide="logcat-actions">
          {#if streamId != null}
            <button type="button" class="btn" onclick={() => stop()}><Icon name="stop" size={12} /> {t('logcat.stop')}</button>
          {:else}
            <button type="button" class="btn primary" onclick={start}><Icon name="play" size={12} /> {t('logcat.start')}</button>
          {/if}
          <button
            type="button"
            class="btn"
            onclick={() => {
              paused = !paused;
              if (!paused) flush();
            }}><Icon name={paused ? 'play' : 'pause'} size={12} /> {paused ? t('logcat.resume') : t('logcat.pause')}</button
          >
          <button type="button" class="btn" onclick={clearDevice}>{t('logcat.clearDevice')}</button>
          <button type="button" class="btn" onclick={save}>{t('logcat.saveAs')}</button>
          <label class="check"><input type="checkbox" bind:checked={autoscroll} /> {t('logcat.autoscroll')}</label>
          <button
            type="button"
            class="btn ghost"
            onclick={() => {
              lines = [];
              pending = [];
            }}>{t('common.clear')}</button
          >
        </div>
      </div>

      {#if error}
        <ErrorState {error} {serial} onretry={start} />
      {/if}

      <section class="card lines" aria-label={t('logcat.lines')} bind:this={box} data-guide="logcat-lines">
        {#each shown as l (l.n)}
          {#if l.level}
            <div class="ln lv-{l.level}">
              <span class="tm">{l.time}</span>
              <span class="pid">{l.pid} {l.tid}</span>
              <span class="lvl">{l.level}</span>
              <span class="tag" title={l.tag}>{l.tag}</span>
              <span class="msg">{l.msg}</span>
            </div>
          {:else}
            <div class="ln plain">{l.raw}</div>
          {/if}
        {:else}
          <div class="muted pad">{streamId != null ? t('logcat.waiting') : ''}</div>
        {/each}
      </section>
      <div class="muted small">{t('logcat.format')}</div>
    {/if}
  </div>
</div>

<style>
  .bar {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: flex-end;
  }
  .field span {
    font-size: 11px;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .filters .field {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 700;
  }
  .filters .field :global(input),
  .filters .field :global(select) {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
    color: var(--text);
    height: 32px;
  }
  .seg button {
    padding: 6px 10px;
    font-family: var(--mono);
  }
  .grow {
    flex: 1 1 160px;
  }
  .lines {
    flex: 1 1 auto;
    min-height: 320px;
    overflow: auto;
    font-family: var(--mono);
    font-size: 12px;
  }
  .ln {
    display: flex;
    gap: 10px;
    padding: 3px 12px;
    border-bottom: 1px solid var(--surface-2);
    align-items: center;
    white-space: nowrap;
  }
  .ln.plain {
    color: var(--muted);
  }
  .tm,
  .pid {
    color: var(--muted);
    flex: 0 0 auto;
  }
  .pid {
    width: 92px;
  }
  .lvl {
    width: 20px;
    text-align: center;
    border-radius: 4px;
    font-weight: 600;
    flex: 0 0 auto;
    background: var(--surface-3);
  }
  .lv-D .lvl {
    background: #e0f2fe;
    color: #075985;
  }
  .lv-I .lvl {
    background: var(--ok-bg);
    color: var(--ok-fg);
  }
  .lv-W .lvl {
    background: var(--warn-bg);
    color: var(--warn-fg);
  }
  .lv-E .lvl,
  .lv-F .lvl {
    background: var(--err-bg);
    color: var(--err-fg);
  }
  :global([data-theme='dark']) .lv-D .lvl {
    background: #0c2d48;
    color: #bae6fd;
  }
  .lv-E,
  .lv-F {
    background: color-mix(in srgb, var(--err-bg) 45%, transparent);
  }
  .tag {
    width: 140px;
    flex: 0 0 auto;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .msg {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pad {
    padding: 12px;
  }
  .small {
    font-size: 12px;
  }
</style>
