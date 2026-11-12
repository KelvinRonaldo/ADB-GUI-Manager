<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import TopBar from '../components/TopBar.svelte';
  import PageGuideOffer from '../components/PageGuideOffer.svelte';
  import ErrorState from '../components/ErrorState.svelte';
  import Icon from '../components/Icon.svelte';
  import { t, lang } from '../lib/i18n.svelte';
  import { api, listen, onFileDrop } from '../lib/ipc';
  import { classify, type AdbError } from '../lib/errors';
  import { formatBytes, formatDate } from '../lib/format';
  import { shQuote } from '../lib/shellwords';
  import { app, confirmDialog, deviceName, navigate, promptDialog, targetSerial } from '../lib/state.svelte';
  import { reportError } from '../lib/actions';
  import type { LocalEntry, RemoteEntry } from '../lib/types';

  let { active }: { active: boolean } = $props();
  const serial = $derived(targetSerial());
  const sep = $derived(app.init?.os === 'windows' ? '\\' : '/');

  // ---------- computador ----------
  let localPath = $state('');
  let localInput = $state('');
  let local = $state<LocalEntry[]>([]);
  let localSel = $state<Set<string>>(new Set());
  let localError = $state('');

  async function loadLocal(path = localPath) {
    try {
      local = await api.localList(path);
      localPath = path;
      localInput = path;
      localSel = new Set();
      localError = '';
    } catch (e) {
      localError = String(e);
    }
  }
  async function localUp() {
    const p = await api.localParent(localPath);
    if (p) loadLocal(p);
  }

  // ---------- aparelho ----------
  let remotePath = $state('/sdcard/');
  let remoteInput = $state('/sdcard/');
  let remote = $state<RemoteEntry[]>([]);
  let remoteSel = $state<Set<string>>(new Set());
  let remoteError = $state<AdbError | null>(null);
  let remoteLoading = $state(false);

  const norm = (p: string) => (p.endsWith('/') ? p : p + '/');
  async function loadRemote(path = remotePath) {
    const s = serial;
    if (!s) return;
    remoteLoading = true;
    try {
      const r = await api.remoteList(s, path);
      const err = classify(r.result);
      // ls devolve 1 quando alguma entrada não pode ser lida, mas lista o resto.
      if (err && !r.entries.length) {
        remoteError = err;
        return;
      }
      remoteError = null;
      remote = r.entries;
      remotePath = norm(path);
      remoteInput = remotePath;
      remoteSel = new Set();
    } catch (e) {
      remoteError = classify(String(e));
    } finally {
      remoteLoading = false;
    }
  }
  function remoteUp() {
    const parts = remotePath.replace(/\/+$/, '').split('/');
    parts.pop();
    loadRemote(norm(parts.join('/') || '/'));
  }
  async function newFolder() {
    const v = await promptDialog(t('files.newFolder'), [{ label: t('files.newFolderName'), value: '' }]);
    const name = v?.[0]?.trim();
    if (!name || !serial) return;
    const r = await api.run(['shell', `mkdir -p ${shQuote(remotePath + name)}`], { serial, timeoutMs: 20000 });
    const err = classify(r);
    if (err) return reportError(err, serial, newFolder);
    loadRemote();
  }
  async function del() {
    if (!serial || !remoteSel.size) return;
    const names = [...remoteSel];
    const c = await confirmDialog({ title: t('confirm.deleteTitle'), text: t('confirm.deleteText', { names: names.join(', ') }), danger: true, destructive: true, confirmLabel: t('files.delete') });
    if (!c.ok) return;
    const r = await api.run(['shell', `rm -rf ${names.map((n) => shQuote(remotePath + n)).join(' ')}`], { serial, timeoutMs: 60000 });
    const err = classify(r);
    if (err) return reportError(err, serial, del);
    loadRemote();
  }

  function select(set: Set<string>, name: string, e: MouseEvent): Set<string> {
    const n = new Set(e.ctrlKey || e.metaKey ? set : []);
    if (n.has(name) && (e.ctrlKey || e.metaKey)) n.delete(name);
    else n.add(name);
    return n;
  }

  // ---------- transferências ----------
  let optSync = $state(false);
  let optDry = $state(false);
  let optKeep = $state(true);
  let optZ = $state('');

  interface Transfer {
    key: number;
    pty: number | null;
    label: string;
    pct: number;
    state: 'running' | 'done' | 'failed';
    out: string;
    args: string[];
    serial: string;
    error: AdbError | null;
  }
  let transfers = $state<Transfer[]>([]);
  let tkey = 1;

  async function start(args: string[], label: string, s: string, existing?: Transfer) {
    const tr: Transfer = existing ?? { key: tkey++, pty: null, label, pct: 0, state: 'running', out: '', args, serial: s, error: null };
    if (existing) Object.assign(existing, { pct: 0, state: 'running', out: '', error: null });
    else transfers.unshift(tr);
    try {
      const id = await api.ptyOpen(args, s, 200, 5);
      const cur = transfers.find((x) => x.key === tr.key);
      if (cur) cur.pty = id;
    } catch (e) {
      const cur = transfers.find((x) => x.key === tr.key);
      if (cur) {
        cur.state = 'failed';
        cur.error = classify(String(e));
      }
    }
  }

  function push(paths = localSel.size ? [...localSel].map((n) => localPath.replace(/[\\/]$/, '') + sep + n) : []) {
    const s = serial;
    if (!s || !paths.length) return;
    const z = optZ ? ['-z', optZ] : [];
    const args = ['push', ...(optSync ? ['--sync'] : []), ...(optDry ? ['-n'] : []), ...z, ...paths, remotePath];
    start(args, `${paths.map((p) => p.split(/[\\/]/).pop()).join(', ')} → ${remotePath}`, s);
  }
  function pull() {
    const s = serial;
    if (!s || !remoteSel.size) return;
    const z = optZ ? ['-z', optZ] : [];
    const names = [...remoteSel];
    const args = ['pull', ...(optKeep ? ['-a'] : []), ...z, ...names.map((n) => remotePath + n), localPath];
    start(args, `${names.join(', ')} ← ${remotePath}`, s);
  }

  let offPty: (() => void) | undefined;
  let offExit: (() => void) | undefined;
  let offDrop: (() => void) | undefined;
  onMount(async () => {
    loadLocal(app.init?.home || '/');
    offPty = await listen<{ id: number; data: string }>('pty', (e) => {
      const tr = transfers.find((x) => x.pty === e.id);
      if (!tr) return;
      tr.out = (tr.out + e.data).slice(-4000);
      const all = [...e.data.matchAll(/\[\s*(\d+)%\]/g)];
      if (all.length) tr.pct = Number(all[all.length - 1][1]);
    });
    offExit = await listen<{ id: number; code: number }>('pty-exit', (e) => {
      const tr = transfers.find((x) => x.pty === e.id);
      if (!tr) return;
      const clean = tr.out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '\n');
      if (e.code === 0) {
        tr.state = 'done';
        tr.pct = 100;
        tr.out = clean.trim().split('\n').pop() ?? '';
        loadRemote();
        loadLocal();
      } else {
        tr.state = 'failed';
        tr.error = classify({ id: 0, cmd: `adb -s ${tr.serial} ${tr.args.join(' ')}`, code: e.code, stdout: '', stderr: clean, durationMs: 0, timedOut: false });
      }
    });
    offDrop = await onFileDrop((paths, over) => {
      if (active && !over && paths.length) push(paths);
    });
  });
  onDestroy(() => {
    offPty?.();
    offExit?.();
    offDrop?.();
  });

  let lastSerial = '';
  $effect(() => {
    if (active && serial && serial !== lastSerial) {
      lastSerial = serial;
      loadRemote('/sdcard/');
    }
  });
</script>

<div class="page">
  <TopBar heading={t('files.title')} sub={t('files.subtitle')} />
  <div class="page-body">
    <PageGuideOffer page="files" />
    {#if !serial}
      <div class="card empty">{t('common.chooseDevice')}</div>
    {/if}
    <div class="panes">
      <section class="card pane" aria-label={t('files.computer')} data-guide="files-local">
        <div class="ph">
          <div class="section-title">{t('files.computer')}</div>
          <div class="row nowrap">
            <button type="button" class="btn sm icon" aria-label={t('files.up')} title={t('files.up')} onclick={localUp}><Icon name="arrowUp" size={14} /></button>
            <input
              class="input mono sm grow"
              aria-label={t('files.localPath')}
              bind:value={localInput}
              onkeydown={(e) => e.key === 'Enter' && loadLocal(localInput)}
            />
          </div>
        </div>
        <div class="entries">
          {#if localError}<div class="err small">{localError}</div>{/if}
          {#each local as f (f.path)}
            <button
              type="button"
              class="entry"
              class:sel={localSel.has(f.name)}
              onclick={(e) => (localSel = select(localSel, f.name, e))}
              ondblclick={() => f.isDir && loadLocal(f.path)}
            >
              <Icon name={f.isDir ? 'files' : 'file'} size={16} />
              <span class="nm">{f.name}</span>
              <span class="meta">{f.isDir ? '' : formatBytes(f.size, lang.current)}</span>
              <span class="meta wide">{f.modified ? formatDate(f.modified, lang.current) : ''}</span>
            </button>
          {:else}
            <div class="muted small pad">{t('files.empty')}</div>
          {/each}
        </div>
      </section>

      <div class="mid" data-guide="files-actions">
        <button type="button" class="btn primary" disabled={!serial || !localSel.size} onclick={() => push()}>{t('files.push')}</button>
        <div class="mono muted tiny">push</div>
        <button type="button" class="btn outline" disabled={!serial || !remoteSel.size} onclick={pull}>{t('files.pull')}</button>
        <div class="mono muted tiny">pull</div>
      </div>

      <section class="card pane" aria-label={t('files.device', { name: serial ? deviceName(serial) : '' })} data-guide="files-remote">
        <div class="ph">
          <div class="row nowrap">
            <span class="section-title">{t('files.device', { name: serial ? deviceName(serial) : '—' })}</span>
            <div class="spacer"></div>
            <button type="button" class="linkbtn small" disabled={!serial} onclick={newFolder}>{t('files.newFolder')}</button>
            <button type="button" class="linkbtn small danger" disabled={!remoteSel.size} onclick={del}>{t('files.delete')}</button>
          </div>
          <div class="row nowrap">
            <button type="button" class="btn sm icon" aria-label={t('files.up')} title={t('files.up')} onclick={remoteUp}><Icon name="arrowUp" size={14} /></button>
            <input
              class="input mono sm grow"
              aria-label={t('files.remotePath')}
              bind:value={remoteInput}
              onkeydown={(e) => e.key === 'Enter' && loadRemote(remoteInput)}
            />
            <button type="button" class="btn sm icon" aria-label={t('common.refresh')} title={t('common.refresh')} onclick={() => loadRemote()}><Icon name="refresh" size={14} class={remoteLoading ? 'spin' : ''} /></button>
          </div>
        </div>
        <div class="entries">
          {#if remoteError}
            <div class="pad"><ErrorState error={remoteError} {serial} onretry={() => loadRemote(remoteInput)} /></div>
          {:else}
            {#each remote as f (f.name)}
              <button
                type="button"
                class="entry"
                class:sel={remoteSel.has(f.name)}
                onclick={(e) => (remoteSel = select(remoteSel, f.name, e))}
                ondblclick={() => (f.isDir || f.isLink) && loadRemote(remotePath + f.name + '/')}
              >
                <Icon name={f.isDir || f.isLink ? 'files' : 'file'} size={16} />
                <span class="nm">{f.name}{f.linkTarget ? ` → ${f.linkTarget}` : ''}</span>
                <span class="meta mono">{f.perms}</span>
                <span class="meta">{f.size != null ? formatBytes(f.size, lang.current) : ''}</span>
                <span class="meta wide">{f.modified}</span>
              </button>
            {:else}
              <div class="muted small pad">{remoteLoading ? t('common.loading') : t('files.empty')}</div>
            {/each}
          {/if}
        </div>
      </section>
    </div>

    <div class="bottom">
      <section class="card opts" aria-label={t('files.options')}>
        <span class="section-title full">{t('files.options')}</span>
        <label class="check"><input type="checkbox" bind:checked={optSync} /><span><code>--sync</code> {t('files.optSync')}</span></label>
        <label class="check"><input type="checkbox" bind:checked={optDry} /><span><code>-n</code> {t('files.optDry')}</span></label>
        <label class="check"><input type="checkbox" bind:checked={optKeep} /><span><code>-a</code> {t('files.optKeep')}</span></label>
        <label class="check"
          >{t('files.optCompression')} <code>-z</code>
          <select class="select sm" bind:value={optZ}>
            <option value="">—</option>
            {#each ['any', 'none', 'brotli', 'lz4', 'zstd'] as z (z)}<option value={z}>{z}</option>{/each}
          </select>
        </label>
        <button
          type="button"
          class="btn sm"
          onclick={() => {
            app.commandRequest = 'sync';
            navigate('commands');
          }}>{t('files.syncPartition')}</button
        >
      </section>

      <section class="card trs" aria-label={t('files.transfers')} data-guide="files-transfers">
        <span class="section-title">{t('files.transfers')}</span>
        {#each transfers as tr (tr.key)}
          <div class="tr">
            <div class="row nowrap">
              <span class="lbl">{tr.label}</span>
              <span class="st {tr.state}">
                {tr.state === 'running' ? `${tr.pct}%` : tr.state === 'done' ? t('files.done') : t('files.failed')}
              </span>
            </div>
            {#if tr.state === 'running'}
              <div class="bar"><span style="width:{tr.pct}%"></span></div>
            {:else if tr.state === 'done'}
              <div class="muted tiny mono">{tr.out}</div>
            {:else if tr.error}
              <ErrorState error={tr.error} serial={tr.serial} onretry={() => start(tr.args, tr.label, tr.serial, tr)} />
            {/if}
          </div>
        {:else}
          <div class="muted small">{t('files.noTransfers')}</div>
        {/each}
      </section>
    </div>
  </div>
</div>

<style>
  .panes {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    align-items: stretch;
  }
  @container (min-width: 640px) {
    .panes {
      grid-template-columns: minmax(0, 1fr) 104px minmax(0, 1fr);
    }
  }
  .pane {
    container-type: inline-size;
    min-width: 0;
    display: flex;
    flex-direction: column;
    height: 380px;
  }
  .ph {
    padding: 10px 12px;
    border-bottom: 1px solid var(--surface-3);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .nowrap {
    flex-wrap: nowrap;
  }
  .grow {
    flex: 1 1 auto;
  }
  .input.sm,
  .select.sm {
    height: 30px;
  }
  .entries {
    flex: 1 1 auto;
    overflow: auto;
  }
  .entry {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    border: 0;
    border-bottom: 1px solid var(--surface-3);
    background: transparent;
    text-align: left;
    font-size: 13px;
    cursor: default;
    color: var(--text);
  }
  .entry:hover {
    background: var(--surface-2);
  }
  .entry.sel {
    background: var(--accent-soft);
  }
  .entry :global(svg) {
    color: var(--muted);
    flex: 0 0 auto;
  }
  .nm {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    color: var(--muted);
    font-size: 11.5px;
    flex: 0 0 auto;
    min-width: 60px;
    text-align: right;
  }
  .meta.wide {
    min-width: 116px;
  }
  @container (max-width: 420px) {
    .meta.wide {
      display: none;
    }
  }
  /* Coluna entre os painéis: Enviar, push, Baixar, pull. Empilhado (tela estreita): uma linha. */
  .mid {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: 8px;
  }
  .tiny {
    font-size: 11px;
    text-align: center;
  }
  .bottom {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    align-items: start;
  }
  @container (min-width: 720px) {
    .bottom {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }
  .opts {
    padding: 12px 14px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    align-items: center;
    align-content: flex-start;
  }
  .opts code {
    font-size: 12px;
  }
  .full {
    width: 100%;
  }
  .trs {
    min-width: 0;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 320px;
    overflow: auto;
  }
  .tr {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .lbl {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }
  .st {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
  }
  .st.done {
    color: var(--ok-fg);
  }
  .st.failed {
    color: var(--err-fg);
  }
  .bar {
    height: 6px;
    background: var(--surface-3);
    border-radius: 3px;
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
  }
  .small {
    font-size: 12px;
  }
  .pad {
    padding: 12px;
  }
  .err {
    color: var(--err-fg);
    padding: 12px;
  }
  .danger {
    color: var(--err-fg);
  }
  .spacer {
    flex: 1 1 auto;
  }
  /* Depois da regra base de .mid, para valer sobre ela. */
  @container (max-width: 639px) {
    .mid {
      flex-direction: row;
      justify-content: center;
      align-items: center;
    }
  }
</style>
