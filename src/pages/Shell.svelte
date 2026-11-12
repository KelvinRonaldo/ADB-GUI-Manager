<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import TopBar from '../components/TopBar.svelte';
  import PageGuideOffer from '../components/PageGuideOffer.svelte';
  import Icon from '../components/Icon.svelte';
  import { t } from '../lib/i18n.svelte';
  import { api, listen } from '../lib/ipc';
  import { app, deviceName, promptDialog, readyDevices, saveSettings, targetSerial, textDialog, toast } from '../lib/state.svelte';
  import { classify } from '../lib/errors';
  import { displayCommand } from '../lib/shellwords';

  let { active }: { active: boolean } = $props();

  interface Session {
    key: number;
    pty: number | null;
    serial: string;
    title: string;
    ended: number | null;
  }
  // O terminal (xterm) fica fora do estado reativo: só os dados da aba são $state.
  const terms = new Map<number, { term: Terminal; fit: FitAddon }>();
  let sessions = $state<Session[]>([]);
  let current = $state<number | null>(null);
  let optPty = $state(true);
  let optNoErr = $state(false);
  let optSu = $state(false);
  let skey = 1;
  // Em tela estreita (escala alta), o painel de comandos salvos começa recolhido
  // para o terminal ter mais colunas.
  let showSaved = $state(true);
  let cols: HTMLElement | undefined = $state();

  function toggleSaved() {
    showSaved = !showSaved;
    requestAnimationFrame(fitCurrent);
  }

  const serial = $derived(targetSerial());

  function themeColors() {
    const dark = document.documentElement.dataset.theme === 'dark';
    return { background: dark ? '#0b0d10' : '#16191f', foreground: '#d6dae1', cursor: '#3ddc84', selectionBackground: '#3a4150' };
  }

  async function openSession(s = serial) {
    if (!s) return;
    const key = skey++;
    const n = sessions.filter((x) => x.serial === s).length + 1;
    sessions.push({ key, pty: null, serial: s, title: `${deviceName(s)} · ${n}`, ended: null });
    current = key;
    await tick();
  }

  function attach(node: HTMLElement, session: Session) {
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Cascadia Mono', Consolas, 'DejaVu Sans Mono', monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: themeColors(),
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(node);
    terms.set(session.key, { term, fit });
    requestAnimationFrame(async () => {
      try {
        fit.fit();
      } catch {
        /* sem tamanho ainda */
      }
      const args = ['shell', optPty ? '-t' : '-T', ...(optNoErr ? ['-x'] : [])];
      try {
        const id = await api.ptyOpen(args, session.serial, term.cols, term.rows);
        const s = sessions.find((x) => x.key === session.key);
        if (s) s.pty = id;
        // O tamanho pode ter mudado enquanto a sessão abria; o shell do aparelho
        // precisa do valor final, senão rola a linha para o lado.
        try {
          fit.fit();
        } catch {
          /* oculto */
        }
        api.ptyResize(id, term.cols, term.rows).catch(() => undefined);
        if (optSu) setTimeout(() => api.ptyWrite(id, 'su\r'), 400);
      } catch (e) {
        term.writeln(`\x1b[31m${String(e)}\x1b[0m`);
        const s = sessions.find((x) => x.key === session.key);
        if (s) s.ended = -1;
      }
      term.focus();
    });
    term.onData((d) => {
      const s = sessions.find((x) => x.key === session.key);
      if (s?.pty != null && s.ended == null) api.ptyWrite(s.pty, d).catch(() => undefined);
    });
    term.onResize(({ cols, rows }) => {
      const s = sessions.find((x) => x.key === session.key);
      if (s?.pty != null && s.ended == null) api.ptyResize(s.pty, cols, rows).catch(() => undefined);
    });
    return {
      destroy() {
        term.dispose();
        terms.delete(session.key);
      },
    };
  }

  function closeSession(key: number) {
    const s = sessions.find((x) => x.key === key);
    if (s?.pty != null && s.ended == null) api.ptyClose(s.pty);
    sessions = sessions.filter((x) => x.key !== key);
    if (current === key) current = sessions[sessions.length - 1]?.key ?? null;
  }

  function reopen(key: number) {
    const s = sessions.find((x) => x.key === key);
    if (!s) return;
    closeSession(key);
    openSession(s.serial);
  }

  function fitCurrent() {
    if (current == null) return;
    const x = terms.get(current);
    try {
      x?.fit.fit();
    } catch {
      /* oculto */
    }
    const s = sessions.find((y) => y.key === current);
    if (x && s?.pty != null && s.ended == null) api.ptyResize(s.pty, x.term.cols, x.term.rows).catch(() => undefined);
    x?.term.focus();
  }

  $effect(() => {
    void current;
    if (active) requestAnimationFrame(fitCurrent);
  });

  let offData: (() => void) | undefined;
  let offExit: (() => void) | undefined;
  onMount(async () => {
    if (cols && cols.clientWidth < 900) showSaved = false;
    offData = await listen<{ id: number; data: string }>('pty', (e) => {
      const s = sessions.find((x) => x.pty === e.id);
      if (s) terms.get(s.key)?.term.write(e.data);
    });
    offExit = await listen<{ id: number; code: number }>('pty-exit', (e) => {
      const s = sessions.find((x) => x.pty === e.id);
      if (!s) return;
      s.ended = e.code;
      terms.get(s.key)?.term.writeln(`\r\n\x1b[90m${t('shell.ended', { code: e.code })}\x1b[0m`);
    });
    if (!sessions.length && serial) openSession();
  });
  onDestroy(() => {
    offData?.();
    offExit?.();
    for (const s of sessions) if (s.pty != null && s.ended == null) api.ptyClose(s.pty);
  });

  const activeSession = $derived(sessions.find((s) => s.key === current));

  async function runSaved(cmd: string, e: MouseEvent) {
    if (e.shiftKey) {
      const devs = readyDevices();
      const parts: string[] = [];
      for (const d of devs) {
        const r = await api.run(['shell', cmd], { serial: d.serial, timeoutMs: 30000 });
        const err = classify(r);
        parts.push(`# ${deviceName(d.serial)} (${d.serial}) · ${displayCommand(['-s', d.serial, 'shell', cmd])}\n${(r.stdout + r.stderr).trim()}${err ? `\n[${t('common.exitCode', { code: r.code })}]` : ''}`);
      }
      textDialog(t('shell.allTitle'), parts.join('\n\n'));
      return;
    }
    let s = activeSession;
    if (!s || s.ended != null || s.pty == null) {
      await openSession();
      await new Promise((r) => setTimeout(r, 600));
      s = sessions.find((x) => x.key === current);
    }
    if (s?.pty != null) api.ptyWrite(s.pty, cmd + '\r');
    fitCurrent();
  }

  async function saveCommand() {
    const v = await promptDialog(t('shell.saveTitle'), [
      { label: t('shell.saveName'), value: '' },
      { label: t('shell.saveCmd'), value: '', mono: true, placeholder: 'getprop ro.product.model' },
    ]);
    if (!v || !v[1].trim()) return;
    app.settings.savedCommands.push({ name: v[0].trim() || v[1].trim(), cmd: v[1].trim() });
    saveSettings();
    toast(t('settings.saved'), 'success', undefined, 2000);
  }
  function removeSaved(i: number) {
    app.settings.savedCommands.splice(i, 1);
    saveSettings();
  }
</script>

<svelte:window onresize={() => active && fitCurrent()} />

<div class="page">
  <TopBar heading={t('shell.title')} sub={t('shell.subtitle')} />
  <div class="page-body">
    <PageGuideOffer page="shell" />
    <div class="cols" bind:this={cols}>
      <section class="termbox" aria-label={t('shell.title')}>
        <div class="tabs" role="tablist" aria-label={t('shell.tabs')} data-guide="shell-tabs">
          {#each sessions as s (s.key)}
            <div class="tab" class:on={s.key === current}>
              <button type="button" role="tab" aria-selected={s.key === current} onclick={() => (current = s.key)}>
                {s.title}{s.ended != null ? ' ·  ✕' : ''}
              </button>
              <button type="button" class="close" aria-label={t('shell.closeTab')} title={t('shell.closeTab')} onclick={() => closeSession(s.key)}><Icon name="close" size={12} /></button>
            </div>
          {/each}
          <button type="button" class="add" aria-label={t('shell.new')} title={serial ? t('shell.openFor', { name: deviceName(serial) }) : t('common.chooseDevice')} disabled={!serial} onclick={() => openSession()}><Icon name="plus" size={16} /></button>
          <div class="spacer"></div>
          <label class="opt"><input type="checkbox" bind:checked={optPty} /> <code>-t</code> {t('shell.optPty')}</label>
          <label class="opt"><input type="checkbox" bind:checked={optNoErr} /> <code>-x</code> {t('shell.optNoErr')}</label>
          <label class="opt"><input type="checkbox" bind:checked={optSu} /> {t('shell.optSu')}</label>
          <button type="button" class="savedtoggle" data-guide="shell-saved-toggle" aria-pressed={showSaved} title={t('shell.saved')} onclick={toggleSaved}>
            <Icon name="star" size={14} />
            <span>{t('shell.saved')}</span>
          </button>
        </div>
        <div class="screens" data-guide="shell-term">
          {#each sessions as s (s.key)}
            <div class="screen" hidden={s.key !== current} use:attach={s}></div>
          {/each}
          {#if !sessions.length}
            <div class="none">
              <span>{serial ? t('shell.none') : t('common.chooseDevice')}</span>
              {#if serial}<button type="button" class="btn primary" onclick={() => openSession()}>{t('shell.openFor', { name: deviceName(serial) })}</button>{/if}
            </div>
          {/if}
        </div>
        <div class="foot">
          {#if activeSession?.ended != null}
            <span>{t('shell.ended', { code: activeSession.ended })}</span>
            <button type="button" class="linkbtn" onclick={() => reopen(activeSession!.key)}>{t('shell.reopen')}</button>
          {:else}
            <span>{t('shell.hint')}</span>
          {/if}
        </div>
      </section>

      {#if showSaved}
      <aside class="card saved" aria-label={t('shell.saved')}>
        <div class="row">
          <h2>{t('shell.saved')}</h2>
          <div class="spacer"></div>
          <button type="button" class="linkbtn small" onclick={saveCommand}>{t('shell.saveCurrent')}</button>
        </div>
        {#each app.settings.savedCommands as c, i (i)}
          <div class="sc">
            <button type="button" class="run" onclick={(e) => runSaved(c.cmd, e)} title={c.cmd}>
              <span class="nm">{c.name}</span>
              <span class="mono cmd">{c.cmd}</span>
            </button>
            <button type="button" class="rm" aria-label={t('common.remove')} title={t('common.remove')} onclick={() => removeSaved(i)}><Icon name="close" size={12} /></button>
          </div>
        {/each}
        <div class="muted small">{t('shell.savedHint')}</div>
      </aside>
      {/if}
    </div>
  </div>
</div>

<style>
  .page-body {
    overflow: hidden;
  }
  .cols {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    gap: 16px;
    align-items: stretch;
  }
  .termbox {
    flex: 1 1 auto;
    min-width: 0;
    background: var(--term-bg);
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    min-height: 360px;
  }
  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 8px 0;
    border-bottom: 1px solid var(--term-border);
    flex-wrap: wrap;
  }
  .tab {
    display: flex;
    align-items: center;
    border-radius: 7px 7px 0 0;
  }
  .tab.on {
    background: #23272f;
  }
  .tab button[role='tab'] {
    border: 0;
    background: transparent;
    color: #9aa1ad;
    padding: 8px 6px 8px 12px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }
  .tab.on button[role='tab'] {
    color: #fff;
    font-weight: 600;
  }
  .close {
    border: 0;
    background: transparent;
    color: #9aa1ad;
    padding: 6px 8px 6px 2px;
    cursor: pointer;
    display: flex;
  }
  .add {
    border: 0;
    background: transparent;
    color: #9aa1ad;
    padding: 6px 10px;
    cursor: pointer;
    display: flex;
  }
  .add:disabled {
    opacity: 0.4;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #c3c8d0;
    font-size: 12px;
    padding: 0 6px;
  }
  .opt input {
    accent-color: #3ddc84;
  }
  .screens {
    flex: 1 1 auto;
    min-height: 0;
    position: relative;
  }
  .screen {
    position: absolute;
    inset: 8px 4px 4px 12px;
  }
  .screen[hidden] {
    display: none;
  }
  .none {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
    justify-content: center;
    color: #9aa1ad;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    border-top: 1px solid var(--term-border);
    color: #9aa1ad;
    font-size: 12px;
  }
  .savedtoggle {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 1px solid #3a4150;
    border-radius: 6px;
    background: transparent;
    color: #c3c8d0;
    font-size: 12px;
    padding: 4px 8px;
    margin: 0 4px 4px 6px;
    cursor: pointer;
  }
  .savedtoggle[aria-pressed='true'] {
    background: #23272f;
    color: #fff;
  }
  .saved {
    flex: 0 0 260px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: auto;
  }
  .saved h2 {
    font-size: 14px;
  }
  .sc {
    display: flex;
    align-items: stretch;
    border: 1px solid var(--surface-3);
    border-radius: 8px;
  }
  .run {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
    border: 0;
    background: transparent;
    padding: 8px 10px;
    cursor: pointer;
  }
  .run:hover {
    background: var(--surface-2);
  }
  .nm {
    font-weight: 600;
    font-size: 13px;
  }
  .cmd {
    font-size: 11px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rm {
    border: 0;
    background: transparent;
    color: var(--muted);
    padding: 0 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
  }
  .small {
    font-size: 12px;
  }
  .spacer {
    flex: 1 1 auto;
  }
</style>
