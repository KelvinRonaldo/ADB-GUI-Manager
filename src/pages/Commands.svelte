<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import TopBar from '../components/TopBar.svelte';
  import PageGuideOffer from '../components/PageGuideOffer.svelte';
  import ErrorState from '../components/ErrorState.svelte';
  import Icon from '../components/Icon.svelte';
  import { t, lang, type Key } from '../lib/i18n.svelte';
  import { api, copyText, listen, pickFiles, pickSavePath } from '../lib/ipc';
  import { CATALOG, GROUPS, buildArgs, findCommand, helpCommands, helpExcerpt, needsDevice, type CommandDef, type L, type Param, type Values } from '../lib/catalog';
  import { streamError, type AdbError } from '../lib/errors';
  import { displayCommand, splitArgs, stripAdb } from '../lib/shellwords';
  import { app, confirmDialog, deviceName, navigate, promptDialog, saveSettings, targetSerial, toast } from '../lib/state.svelte';
  import type { StreamEvent } from '../lib/types';

  let { active }: { active: boolean } = $props();
  const tl = (l: L) => (lang.current === 'pt-BR' ? l.pt : l.en);

  let freeLine = $state('');
  let freeError = $state('');
  let search = $state('');
  let selected = $state<CommandDef>(findCommand('devices')!);
  let variantId = $state('default');
  let values = $state<Values>({});
  let devMode = $state<'target' | 'usb' | 'emu' | 'transport' | 'none'>('none');
  let transportId = $state('');
  let gHost = $state('');
  let gPort = $state('');
  let gAll = $state(false);
  let gSocket = $state('');
  let gOneDevice = $state('');
  let gExitOnWrite = $state(false);

  let helpText = $state('');
  let supported = $state<Set<string>>(new Set());

  let runId = $state<number | null>(null);
  let output = $state('');
  let exitCode = $state<number | null>(null);
  let runError = $state<AdbError | null>(null);
  let lastRun = $state<{ args: string[]; serial: string | null } | null>(null);
  let stoppedByUser = false;

  const serial = $derived(targetSerial());
  const variant = $derived(selected.variants.find((v) => v.id === variantId) ?? selected.variants[0]);

  function select(def: CommandDef) {
    selected = def;
    variantId = def.variants[0].id;
    values = {};
    devMode = needsDevice(def, def.variants[0]) ? 'target' : 'none';
  }

  $effect(() => {
    devMode = needsDevice(selected, variant) ? (devMode === 'none' ? 'target' : devMode) : 'none';
  });

  $effect(() => {
    if (active && app.commandRequest) {
      const def = findCommand(app.commandRequest);
      app.commandRequest = null;
      if (def) select(def);
    }
  });

  const globalArgs = $derived.by(() => {
    const g: string[] = [];
    if (gAll) g.push('-a');
    if (gHost.trim()) g.push('-H', gHost.trim());
    if (gPort.trim()) g.push('-P', gPort.trim());
    if (gSocket.trim()) g.push('-L', gSocket.trim());
    if (gOneDevice.trim()) g.push('--one-device', gOneDevice.trim());
    if (gExitOnWrite) g.push('--exit-on-write-error');
    if (devMode === 'usb') g.push('-d');
    if (devMode === 'emu') g.push('-e');
    if (devMode === 'transport' && transportId.trim()) g.push('-t', transportId.trim());
    return g;
  });
  const runSerial = $derived(devMode === 'target' ? serial : null);
  const built = $derived(buildArgs(selected, variant, values));
  const preview = $derived(displayCommand([...(runSerial ? ['-s', runSerial] : []), ...globalArgs, ...built.args]));

  const groups = $derived(
    GROUPS.map((g) => ({
      id: g,
      cmds: CATALOG.filter((c) => c.group === g && (!search.trim() || c.name.includes(search.trim().toLowerCase()) || tl(c.desc).toLowerCase().includes(search.trim().toLowerCase()))),
    })).filter((g) => g.cmds.length),
  );

  async function loadHelp() {
    try {
      const r = await api.run(['help'], { quiet: true, timeoutMs: 15000 });
      helpText = (r.stdout + '\n' + r.stderr).trim();
      supported = helpCommands(helpText);
    } catch {
      helpText = '';
    }
  }

  let offStream: (() => void) | undefined;
  onMount(async () => {
    loadHelp();
    offStream = await listen<StreamEvent>('stream', (e) => {
      if (e.id !== runId) return;
      if (e.kind === 'end') {
        exitCode = e.code ?? -1;
        runId = null;
        if (exitCode !== 0 && !stoppedByUser && lastRun) {
          const err = streamError(displayCommand([...(lastRun.serial ? ['-s', lastRun.serial] : []), ...lastRun.args]), exitCode, output.slice(-2000));
          runError = err;
        }
        return;
      }
      output = (output + e.data).slice(-1_000_000);
    });
  });
  onDestroy(() => {
    offStream?.();
    if (runId != null) api.streamStop(runId);
  });

  async function execute(args: string[], s: string | null, destructive = false) {
    if (args[0] === 'shell' && !args.slice(1).some((a) => !a.startsWith('-'))) {
      freeError = t('commands.interactive');
      return;
    }
    if (destructive) {
      const c = await confirmDialog({ title: t('confirm.commandTitle'), text: `${t('confirm.commandText')}\n\n${displayCommand([...(s ? ['-s', s] : []), ...args])}`, destructive: true, danger: true });
      if (!c.ok) return;
    }
    if (runId != null) await stop();
    output = '';
    exitCode = null;
    runError = null;
    stoppedByUser = false;
    lastRun = { args, serial: s };
    try {
      runId = await api.streamStart(args, s);
    } catch (e) {
      runError = streamError(displayCommand(args), -1, String(e));
    }
  }

  async function stop() {
    if (runId == null) return;
    stoppedByUser = true;
    await api.streamStop(runId);
  }

  function runForm() {
    if (built.missing.length) return;
    execute([...globalArgs, ...built.args], runSerial, !!selected.destructive || (selected.name === 'logcat' && values.c === true));
  }

  const DESTRUCTIVE = new Set(CATALOG.filter((c) => c.destructive).map((c) => c.name));
  function runFree() {
    freeError = '';
    let args: string[];
    try {
      args = stripAdb(splitArgs(freeLine));
    } catch {
      freeError = t('commands.unclosed');
      return;
    }
    if (!args.length) return;
    const hasDevice = args.some((a) => ['-s', '-d', '-e', '-t'].includes(a));
    const cmd = args.find((a) => !a.startsWith('-'));
    const def = cmd ? findCommand(cmd) : undefined;
    const s = !hasDevice && def && needsDevice(def, def.variants[0]) ? serial : null;
    execute(args, s, !!cmd && DESTRUCTIVE.has(cmd));
  }

  function complete(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      runFree();
      return;
    }
    if (e.key !== 'Tab') return;
    const m = freeLine.match(/^(\s*(?:adb\s+)?(?:-\S+(?:\s+\S+)?\s+)*)(\S*)$/);
    if (!m) return;
    const prefix = m[2];
    const hits = CATALOG.map((c) => c.name).filter((n) => n.startsWith(prefix));
    if (!hits.length) return;
    e.preventDefault();
    let common = hits[0];
    for (const h of hits) while (!h.startsWith(common)) common = common.slice(0, -1);
    freeLine = m[1] + (hits.length === 1 ? hits[0] + ' ' : common);
  }

  async function pick(p: Param) {
    if (p.kind !== 'arg') return;
    if (p.picker === 'save') {
      const r = await pickSavePath(p.id === 'path' ? 'bugreport.zip' : 'adbkey');
      if (r) values[p.id] = r;
    } else {
      const r = await pickFiles({ multiple: p.picker === 'files', directory: p.picker === 'dir' });
      if (r.length) values[p.id] = p.picker === 'files' ? r : r[0];
    }
  }

  async function addFavorite() {
    const v = await promptDialog(t('commands.favorite'), [{ label: t('commands.favoriteName'), value: selected.name }]);
    if (!v) return;
    app.settings.favorites.push({ name: v[0].trim() || selected.name, args: [...globalArgs, ...built.args] });
    saveSettings();
    toast(t('settings.saved'), 'success', undefined, 2000);
  }

  const excerpt = $derived(helpText ? helpExcerpt(helpText, selected.name) : '');
  const groupKey = (g: string) => `commands.g.${g}` as Key;
</script>

<div class="page">
  <TopBar heading={t('commands.title')} sub={t('commands.subtitle')} />
  <div class="page-body">
    <PageGuideOffer page="commands" />
    <div class="free card" data-guide="commands-free">
      <span class="mono pre">$ adb</span>
      <label for="free" class="sr-only">{t('commands.freeLabel')}</label>
      <input id="free" class="fin mono" placeholder={t('commands.freePlaceholder')} bind:value={freeLine} onkeydown={complete} autocomplete="off" spellcheck="false" />
      <button type="button" class="btn primary" onclick={runFree} disabled={!freeLine.trim()}>{t('commands.run')}</button>
    </div>
    {#if freeError}
      <div class="row warn" role="alert">
        <Icon name="info" size={16} />
        {freeError}
        {#if freeError === t('commands.interactive')}<button type="button" class="linkbtn" onclick={() => navigate('shell')}>{t('nav.shell')}</button>{/if}
      </div>
    {/if}

    <div class="cols">
      <nav class="card cat" aria-label={t('commands.catalog')} data-guide="commands-catalog">
        <input class="input" type="search" placeholder={t('commands.searchCmd')} aria-label={t('commands.searchCmd')} bind:value={search} />
        {#if app.settings.favorites.length}
          <div>
            <div class="gh">{t('commands.favorites')}</div>
            {#each app.settings.favorites as f, i (i)}
              <div class="fav">
                <button type="button" class="ci" title={displayCommand(f.args)} onclick={() => (freeLine = f.args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '))}>
                  <Icon name="star" size={12} />
                  {f.name}
                </button>
                <button
                  type="button"
                  class="rm"
                  aria-label={t('common.remove')}
                  onclick={() => {
                    app.settings.favorites.splice(i, 1);
                    saveSettings();
                  }}><Icon name="close" size={12} /></button
                >
              </div>
            {/each}
          </div>
        {/if}
        {#each groups as g (g.id)}
          <div>
            <div class="gh">{t(groupKey(g.id))}</div>
            {#each g.cmds as c (c.name)}
              <button type="button" class="ci" class:on={selected.name === c.name} aria-current={selected.name === c.name ? 'true' : undefined} onclick={() => select(c)}>
                <span class="mono">{c.name}</span>
                {#if helpText && !supported.has(c.name)}<span class="nh" title={t('commands.notInHelp')}>?</span>{/if}
              </button>
            {/each}
          </div>
        {/each}
      </nav>

      <section class="card form" aria-label={selected.name} data-guide="commands-form">
        <div>
          <div class="row">
            <h2 class="mono">{selected.name}</h2>
            {#if helpText && !supported.has(selected.name)}<span class="chip warn">{t('commands.notInHelp')}</span>{/if}
            {#if selected.destructive}<span class="chip err">!</span>{/if}
          </div>
          <div class="muted">{tl(selected.desc)}</div>
          <div class="mono muted small">adb {selected.usage}</div>
        </div>

        {#if selected.variants.length > 1}
          <fieldset class="ops">
            <legend class="section-title">{t('commands.operation')}</legend>
            {#each selected.variants as v (v.id)}
              <label class="op" class:on={variantId === v.id}>
                <input type="radio" name="variant" value={v.id} bind:group={variantId} />
                {tl(v.label)}
                <code>{v.prefix.slice(1).join(' ')}</code>
              </label>
            {/each}
          </fieldset>
        {/if}

        <div class="params">
          {#each variant.params as p (p.id)}
            {#if p.kind === 'flag'}
              <label class="check"><input type="checkbox" checked={values[p.id] === true} onchange={(e) => (values[p.id] = e.currentTarget.checked)} /><span><code>{p.flag}</code> <span class="muted">{tl(p.label)}</span></span></label>
            {:else if p.kind === 'option'}
              <label class="field">
                <span><code>{p.flag}</code> <span class="muted">{tl(p.label)}</span></span>
                {#if p.choices}
                  <select class="select" value={(values[p.id] as string) ?? ''} onchange={(e) => (values[p.id] = e.currentTarget.value)}>
                    {#each p.choices as c (c)}<option value={c}>{c || '—'}</option>{/each}
                  </select>
                {:else}
                  <input class="input mono" placeholder={p.placeholder} value={(values[p.id] as string) ?? ''} oninput={(e) => (values[p.id] = e.currentTarget.value)} />
                {/if}
              </label>
            {:else if p.kind === 'spec'}
              <div class="field">
                <span>{tl(p.label)}{p.required ? ' *' : ''}</span>
                <div class="row nowrap">
                  <select class="select mono" aria-label={`${tl(p.label)} · tipo`} value={(values[`${p.id}Type`] as string) ?? p.types[0]} onchange={(e) => (values[`${p.id}Type`] = e.currentTarget.value)}>
                    {#each p.types as ty (ty)}<option value={ty}>{ty}</option>{/each}
                  </select>
                  <input class="input mono grow" aria-label={tl(p.label)} placeholder={p.placeholder} value={(values[p.id] as string) ?? ''} oninput={(e) => (values[p.id] = e.currentTarget.value)} />
                </div>
              </div>
            {:else}
              <div class="field">
                <span>{tl(p.label)}{p.required ? ' *' : ''}</span>
                {#if p.choices}
                  <select class="select" aria-label={tl(p.label)} value={(values[p.id] as string) ?? p.choices[0]} onchange={(e) => (values[p.id] = e.currentTarget.value)}>
                    {#each p.choices as c (c)}<option value={c}>{c || '—'}</option>{/each}
                  </select>
                {:else}
                  <div class="row nowrap">
                    <input
                      class="input mono grow"
                      aria-label={tl(p.label)}
                      placeholder={p.placeholder}
                      value={Array.isArray(values[p.id]) ? (values[p.id] as string[]).join(' ; ') : ((values[p.id] as string) ?? '')}
                      oninput={(e) => (values[p.id] = e.currentTarget.value)}
                    />
                    {#if p.picker}<button type="button" class="btn" onclick={() => pick(p)}>{t('common.browse')}</button>{/if}
                  </div>
                {/if}
              </div>
            {/if}
          {/each}
        </div>

        <details class="global">
          <summary>{t('commands.global')} <span class="muted">-s · -d · -e · -t · -H · -P · -L · -a · --one-device</span></summary>
          <div class="gg">
            <label class="field"
              >{t('commands.device')}
              <select class="select" bind:value={devMode}>
                <option value="target" disabled={!serial}>{t('commands.dev.target', { name: serial ? deviceName(serial) : '—' })}</option>
                <option value="usb">{t('commands.dev.usb')}</option>
                <option value="emu">{t('commands.dev.emu')}</option>
                <option value="transport">{t('commands.dev.transport')}</option>
                <option value="none">{t('commands.dev.none')}</option>
              </select>
            </label>
            {#if devMode === 'transport'}<label class="field">{t('commands.transportId')}<input class="input mono" bind:value={transportId} /></label>{/if}
            <label class="field">{t('commands.serverHost')}<input class="input mono" placeholder={app.settings.serverHost} bind:value={gHost} /></label>
            <label class="field">{t('commands.serverPort')}<input class="input mono" placeholder={String(app.settings.serverPort)} bind:value={gPort} /></label>
            <label class="field">-L SOCKET<input class="input mono" placeholder="tcp:localhost:5037" bind:value={gSocket} /></label>
            <label class="field">--one-device<input class="input mono" placeholder="SERIAL|USB" bind:value={gOneDevice} /></label>
            <label class="check"><input type="checkbox" bind:checked={gAll} /> <code>-a</code></label>
            <label class="check"><input type="checkbox" bind:checked={gExitOnWrite} /> <code>--exit-on-write-error</code></label>
          </div>
        </details>

        <div class="gen">
          <span class="section-title">{t('commands.generated')}</span>
          <pre class="term">{preview}</pre>
          {#if built.missing.length}<div class="warn small">{t('commands.missing', { fields: built.missing.map(tl).join(', ') })}</div>{/if}
          <div class="row end">
            <button
              type="button"
              class="btn"
              onclick={async () => {
                await copyText(preview);
                toast(t('common.copied'), 'success', undefined, 2000);
              }}>{t('common.copy')}</button
            >
            <button type="button" class="btn" onclick={addFavorite}>{t('commands.favorite')}</button>
            {#if runId != null}
              <button type="button" class="btn danger" onclick={stop}><Icon name="stop" size={12} /> {t('common.stop')}</button>
            {/if}
            <button type="button" class="btn primary" disabled={!!built.missing.length} onclick={runForm}>{t('commands.run')}</button>
          </div>
        </div>
      </section>

      <section class="side" aria-label={t('commands.output')} data-guide="commands-output">
        <div class="out">
          <div class="oh">
            <span>{runId != null ? t('commands.running') : exitCode != null ? t('commands.outputCode', { code: exitCode }) : t('commands.output')}</span>
            {#if runId != null}<Icon name="spinner" size={14} class="spin" />{/if}
            <div class="spacer"></div>
            <button
              type="button"
              class="ob"
              onclick={async () => {
                await copyText(output);
                toast(t('common.copied'), 'success', undefined, 2000);
              }}>{t('common.copy')}</button
            >
            <button type="button" class="ob" onclick={() => (output = '')}>{t('common.clear')}</button>
          </div>
          <pre class="op">{output || (exitCode != null ? t('commands.noOutput') : '')}</pre>
        </div>
        {#if runError}
          <ErrorState error={runError} serial={lastRun?.serial ?? null} onretry={() => lastRun && execute(lastRun.args, lastRun.serial)} />
        {/if}
        <div class="card help">
          <div class="section-title">{t('commands.help')}</div>
          <pre class="mono">{excerpt || `adb ${selected.usage}`}</pre>
          <div class="muted small">{t('commands.helpSource')}</div>
        </div>
      </section>
    </div>
  </div>
</div>

<style>
  .free {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
  }
  .pre {
    font-size: 13px;
    color: var(--muted);
    padding-left: 4px;
  }
  .fin {
    flex: 1 1 auto;
    min-width: 0;
    height: 34px;
    border: 0;
    background: transparent;
    font-size: 13px;
  }
  .fin:focus {
    outline: none;
  }
  .warn {
    color: var(--warn-fg);
    font-size: 13px;
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    align-items: start;
  }
  @container (min-width: 620px) {
    .cols {
      grid-template-columns: 210px minmax(0, 1fr);
    }
    .side {
      grid-column: 1 / -1;
    }
  }
  @container (min-width: 1080px) {
    .cols {
      grid-template-columns: 220px minmax(0, 1fr) 300px;
    }
    .side {
      grid-column: auto;
    }
  }
  .cat {
    min-width: 0;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 560px;
    overflow: auto;
  }
  .gh {
    font-size: 11px;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 4px 6px;
  }
  .ci {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    text-align: left;
    border: 0;
    border-radius: 6px;
    padding: 5px 8px;
    background: transparent;
    font-size: 13px;
    cursor: pointer;
  }
  .ci:hover {
    background: var(--surface-3);
  }
  .ci.on {
    background: var(--accent);
    color: var(--on-accent);
  }
  .nh {
    margin-left: auto;
    font-size: 11px;
    font-weight: 700;
    color: var(--warn-fg);
  }
  .fav {
    display: flex;
  }
  .rm {
    border: 0;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    display: flex;
    align-items: center;
  }
  .form {
    min-width: 0;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .form h2 {
    font-size: 18px;
  }
  .small {
    font-size: 12px;
  }
  .ops {
    border: 0;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .ops legend {
    margin-bottom: 6px;
  }
  .op {
    display: flex;
    gap: 6px;
    align-items: center;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    padding: 7px 10px;
    font-size: 13px;
    cursor: pointer;
  }
  .op.on {
    border: 2px solid var(--accent);
    padding: 6px 9px;
    font-weight: 600;
  }
  .op code {
    font-size: 11px;
    color: var(--muted);
  }
  .params {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 10px 14px;
    align-items: end;
  }
  .params code {
    font-size: 12px;
  }
  .params :global(.field > span) {
    font-weight: 600;
  }
  .nowrap {
    flex-wrap: nowrap;
  }
  .grow {
    flex: 1 1 auto;
  }
  .global {
    border: 1px solid var(--surface-3);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 13px;
  }
  .global summary {
    cursor: pointer;
    font-weight: 600;
  }
  .gg {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 8px;
    margin-top: 8px;
    align-items: end;
  }
  .gen {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-top: 1px solid var(--surface-3);
    padding-top: 12px;
  }
  .gen pre {
    margin: 0;
    font-size: 13px;
  }
  .end {
    justify-content: flex-end;
  }
  .side {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .out {
    background: var(--term-bg);
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    min-height: 200px;
    max-height: 380px;
  }
  .oh {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    color: #9aa1ad;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--term-border);
  }
  .ob {
    border: 0;
    background: transparent;
    color: #c3c8d0;
    font-size: 11px;
    cursor: pointer;
    text-transform: none;
    letter-spacing: 0;
  }
  .op {
    margin: 0;
    flex: 1 1 auto;
    overflow: auto;
    padding: 10px 12px;
    font-family: var(--mono);
    font-size: 12px;
    line-height: 18px;
    color: var(--term-text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .help {
    padding: 12px;
  }
  .help pre {
    margin: 6px 0;
    font-size: 11px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 220px;
    overflow: auto;
  }
  .spacer {
    flex: 1 1 auto;
  }
</style>
