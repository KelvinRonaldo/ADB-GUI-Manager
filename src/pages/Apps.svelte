<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import TopBar from '../components/TopBar.svelte';
  import PageGuideOffer from '../components/PageGuideOffer.svelte';
  import ErrorState from '../components/ErrorState.svelte';
  import Menu from '../components/Menu.svelte';
  import Modal from '../components/Modal.svelte';
  import Icon from '../components/Icon.svelte';
  import { t, type Key } from '../lib/i18n.svelte';
  import { api, copyText, onFileDrop, pickFiles, revealInFolder } from '../lib/ipc';
  import { classify, type AdbError } from '../lib/errors';
  import { displayCommand, shQuote } from '../lib/shellwords';
  import { app, confirmDialog, deviceName, promptDialog, readyDevices, targetSerial, textDialog, toast } from '../lib/state.svelte';
  import { reportError, runReport } from '../lib/actions';
  import type { Package } from '../lib/types';

  type Filter = 'user' | 'system' | 'disabled' | 'all';
  let filter = $state<Filter>('user');
  let search = $state('');
  let packages = $state<Package[]>([]);
  let loading = $state(false);
  let listError = $state<AdbError | null>(null);

  const serial = $derived(targetSerial());

  async function load() {
    const s = serial;
    if (!s) return;
    loading = true;
    listError = null;
    try {
      const r = await api.packages(s, filter);
      const err = classify(r.result);
      if (err) listError = err;
      packages = r.packages;
    } catch (e) {
      listError = classify(String(e));
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void serial;
    void filter;
    load();
  });

  const shown = $derived(packages.filter((p) => !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())));

  // ---------- ações por pacote ----------

  const sh = (_pkg: string, cmd: string, ok: string) => runReport(['shell', cmd], serial, ok);

  async function clearData(pkg: string) {
    const c = await confirmDialog({ title: t('confirm.clearDataTitle', { pkg }), text: t('confirm.clearDataText'), danger: true, destructive: true, confirmLabel: t('apps.clearData') });
    if (c.ok) sh(pkg, `pm clear ${shQuote(pkg)}`, t('apps.cleared', { pkg }));
  }

  async function uninstall(pkg: string) {
    const c = await confirmDialog({
      title: t('confirm.uninstallTitle', { pkg }),
      text: t('confirm.uninstallText'),
      danger: true,
      destructive: true,
      confirmLabel: t('apps.uninstall').replace('…', ''),
      check: { label: t('confirm.keepData'), value: false },
    });
    if (!c.ok) return;
    const r = await runReport(c.checked ? ['uninstall', '-k', pkg] : ['uninstall', pkg], serial, t('apps.uninstalled', { pkg }));
    if (r) load();
  }

  async function extract(pkg: string) {
    const s = serial;
    if (!s) return;
    const r = await api.run(['shell', `pm path ${shQuote(pkg)}`], { serial: s, timeoutMs: 20000 });
    const err = classify(r);
    if (err) return reportError(err, s, () => extract(pkg));
    const paths = r.stdout.split('\n').map((l) => l.trim().replace(/^package:/, '')).filter(Boolean);
    const dir = (await pickFiles({ directory: true }))[0];
    if (!dir || !paths.length) return;
    const sep = app.init?.os === 'windows' ? '\\' : '/';
    for (const p of paths) {
      const base = p.split('/').pop() ?? 'base.apk';
      const dest = `${dir}${sep}${paths.length === 1 ? `${pkg}.apk` : `${pkg}-${base}`}`;
      const ok = await runReport(['pull', p, dest], s, t('apps.extracted', { path: dest }), 300000);
      if (!ok) return;
      if (paths.length === 1) toast(t('apps.extracted', { path: dest }), 'success', { label: t('common.open'), run: () => revealInFolder(dest) });
    }
  }

  let perms = $state<{ pkg: string; list: { name: string; granted: boolean }[] } | null>(null);
  async function loadPerms(pkg: string) {
    const r = await api.run(['shell', `dumpsys package ${shQuote(pkg)}`], { serial, timeoutMs: 30000 });
    const err = classify(r);
    if (err) return reportError(err, serial, () => loadPerms(pkg));
    const map = new Map<string, boolean>();
    let inRuntime = false;
    for (const line of r.stdout.split('\n')) {
      if (/runtime permissions:/.test(line)) {
        inRuntime = true;
        continue;
      }
      const m = line.match(/^\s+([\w.]+): granted=(true|false)/);
      if (inRuntime && m) map.set(m[1], m[2] === 'true');
      else if (inRuntime && line.trim() && !m) inRuntime = false;
    }
    perms = { pkg, list: [...map].map(([name, granted]) => ({ name, granted })).sort((a, b) => a.name.localeCompare(b.name)) };
  }
  async function togglePerm(name: string, granted: boolean) {
    if (!perms) return;
    const pkg = perms.pkg;
    const ok = await runReport(['shell', `pm ${granted ? 'revoke' : 'grant'} ${shQuote(pkg)} ${shQuote(name)}`], serial, `${granted ? t('apps.revoke') : t('apps.grant')}: ${name}`);
    if (ok) loadPerms(pkg);
  }

  async function info(pkg: string) {
    const r = await api.run(['shell', `dumpsys package ${shQuote(pkg)}`], { serial, timeoutMs: 30000 });
    const err = classify(r);
    if (err) return reportError(err, serial, () => info(pkg));
    textDialog(t('apps.infoTitle', { pkg }), r.stdout);
  }

  const menuFor = (pkg: string) => [
    { label: t('apps.uninstall'), danger: true, onclick: () => uninstall(pkg) },
    { label: t('apps.extract'), onclick: () => extract(pkg) },
    { label: t('apps.permissions'), onclick: () => loadPerms(pkg) },
    filter === 'disabled'
      ? { label: t('apps.enable'), onclick: () => sh(pkg, `pm enable ${shQuote(pkg)}`, t('apps.enabledDone', { pkg })).then(load) }
      : { label: t('apps.disable'), onclick: () => sh(pkg, `pm disable-user --user 0 ${shQuote(pkg)}`, t('apps.disabledDone', { pkg })).then(load) },
    { label: t('apps.info'), onclick: () => info(pkg) },
    { divider: true, label: '' },
    {
      label: t('apps.copyName'),
      onclick: async () => {
        await copyText(pkg);
        toast(t('common.copied'), 'success', undefined, 2000);
      },
    },
  ];

  // ---------- instalação ----------

  const FLAGS = [
    ['r', '-r', 'apps.flag.r'],
    ['g', '-g', 'apps.flag.g'],
    ['d', '-d', 'apps.flag.d'],
    ['t', '-t', 'apps.flag.t'],
    ['instant', '--instant', 'apps.flag.instant'],
    ['noStreaming', '--no-streaming', 'apps.flag.noStreaming'],
    ['fastdeploy', '--fastdeploy', 'apps.flag.fastdeploy'],
    ['l', '-l', 'apps.flag.l'],
  ] as const;
  let flags = $state<Record<string, boolean>>({ r: true, g: true });
  let abi = $state('');
  let files = $state<string[]>([]);
  let mode = $state<'each' | 'splits' | 'session'>('each');
  let allDevices = $state(false);
  let dragOver = $state(false);
  let installing = $state('');
  let installError = $state<{ error: AdbError; serial: string; retry: () => void } | null>(null);

  const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
  const flagArgs = (extra: string[] = []) => {
    const f: string[] = FLAGS.filter(([id]) => flags[id]).map(([, flag]) => flag);
    for (const x of extra) if (!f.includes(x)) f.push(x);
    if (abi) f.push('--abi', abi);
    return f;
  };
  function commandsFor(extra: string[] = []): string[][] {
    const f = flagArgs(extra);
    if (files.length <= 1 || mode === 'each') return files.map((file) => ['install', ...f, file]);
    return [[mode === 'splits' ? 'install-multiple' : 'install-multi-package', ...f, ...files]];
  }
  const targets = $derived(allDevices ? readyDevices().map((d) => d.serial) : serial ? [serial] : []);
  const preview = $derived(
    files.length && targets.length ? commandsFor().map((c) => displayCommand(['-s', targets[0], ...c.map((a) => (a.length > 60 ? baseName(a) : a))])).join('\n') : '',
  );

  function addFiles(list: string[]) {
    const apks = list.filter((p) => /\.(apk|apks|apex)$/i.test(p));
    files = [...new Set([...files, ...apks])];
  }
  async function choose() {
    addFiles(await pickFiles({ multiple: true, filters: [{ name: 'APK', extensions: ['apk', 'apex'] }] }));
  }

  function packageFrom(text: string): string | null {
    return text.match(/Package ([\w.]+)/)?.[1] ?? text.match(/pkg=([\w.]+)/)?.[1] ?? null;
  }

  async function runInstall(dev: string, args: string[], extra: string[] = []): Promise<boolean> {
    const name = deviceName(dev);
    const file = baseName(args[args.length - 1]);
    installing = t('apps.installing', { file, name });
    try {
      const r = await api.run(args, { serial: dev, timeoutMs: 600000 });
      const err = classify(r, { op: 'install' });
      if (!err) {
        toast(t('apps.installed', { name, file }), 'success');
        return true;
      }
      const retryWith = (flag: string) => () =>
        runInstall(dev, insertFlag(args, flag), [...extra, flag]).then((ok) => {
          if (ok) load();
        });
      const decision = ['versionDowngrade', 'alreadyExists', 'updateIncompatible', 'testOnly'].includes(err.kind);
      if (decision) {
        reportError(err, dev, () => runInstall(dev, args, extra), {
          installDowngrade: retryWith('-d'),
          installReplace: retryWith('-r'),
          installTest: retryWith('-t'),
          uninstallInstall: () => uninstallThenInstall(dev, args, r.stdout + r.stderr),
        });
      } else {
        installError = {
          error: err,
          serial: dev,
          retry: () => {
            installError = null;
            runInstall(dev, args, extra).then((ok) => {
              if (ok) load();
            });
          },
        };
      }
      return false;
    } finally {
      installing = '';
    }
  }

  function insertFlag(args: string[], flag: string): string[] {
    if (args.includes(flag)) return args;
    return [args[0], flag, ...args.slice(1)];
  }

  async function uninstallThenInstall(dev: string, args: string[], output: string) {
    let pkg = packageFrom(output);
    if (!pkg) {
      const v = await promptDialog(t('apps.col.package'), [{ label: t('apps.col.package'), value: '', placeholder: 'com.exemplo.app', mono: true }]);
      pkg = v?.[0]?.trim() || null;
    }
    if (!pkg) return;
    const c = await confirmDialog({ title: t('confirm.uninstallInstallTitle'), text: t('confirm.uninstallInstallText', { pkg }), danger: true });
    if (!c.ok) return;
    const r = await runReport(['uninstall', pkg], dev, t('apps.uninstalled', { pkg }));
    if (r && (await runInstall(dev, args))) load();
  }

  async function install() {
    installError = null;
    if (!files.length || !targets.length) return;
    for (const dev of targets) {
      for (const args of commandsFor()) {
        if (!(await runInstall(dev, args))) return;
      }
    }
    load();
  }

  let offDrop: (() => void) | undefined;
  onMount(async () => {
    offDrop = await onFileDrop((paths, over) => {
      dragOver = over;
      if (!over && paths.length) addFiles(paths);
    });
    if (app.installRequest) {
      app.installRequest = false;
      choose();
    }
  });
  onDestroy(() => offDrop?.());

  const filterLabels: Record<Filter, Key> = { user: 'apps.f.user', system: 'apps.f.system', disabled: 'apps.f.disabled', all: 'apps.f.all' };
</script>

<div class="page">
  <TopBar heading={t('apps.title')} sub={serial ? t('apps.subtitle', { n: packages.length }) : t('common.noTarget')} />
  <div class="page-body">
    <PageGuideOffer page="apps" />
    <div class="cols">
      <section class="list">
        <div class="row" data-guide="apps-search">
          <input class="input grow" type="search" placeholder={t('apps.search')} aria-label={t('apps.searchLabel')} bind:value={search} />
          <div class="seg" role="group" aria-label={t('apps.filterLabel')}>
            {#each ['user', 'system', 'disabled', 'all'] as const as f (f)}
              <button type="button" aria-pressed={filter === f} onclick={() => (filter = f)}>{t(filterLabels[f])}</button>
            {/each}
          </div>
          <button type="button" class="btn icon" aria-label={t('common.refresh')} title={t('common.refresh')} onclick={load}><Icon name="refresh" size={16} class={loading ? 'spin' : ''} /></button>
        </div>

        {#if !serial}
          <div class="card empty">{t('common.chooseDevice')}</div>
        {:else if listError}
          <ErrorState error={listError} {serial} onretry={load} />
        {:else}
          <div class="card tbl" data-guide="apps-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('apps.col.package')}</th>
                  <th scope="col">{t('apps.col.version')}</th>
                  <th scope="col">{t('apps.col.uid')}</th>
                  <th scope="col" class="r">{t('apps.col.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {#each shown as p (p.name)}
                  <tr>
                    <td class="mono pkg">{p.name}</td>
                    <td>{p.versionCode ?? ''}</td>
                    <td class="muted">{p.uid ?? ''}</td>
                    <td class="r acts">
                      <button type="button" class="btn sm" onclick={() => sh(p.name, `monkey -p ${shQuote(p.name)} -c android.intent.category.LAUNCHER 1`, t('apps.opened', { pkg: p.name }))}>{t('apps.open')}</button>
                      <button type="button" class="btn sm" onclick={() => sh(p.name, `am force-stop ${shQuote(p.name)}`, t('apps.stopped', { pkg: p.name }))}>{t('apps.stop')}</button>
                      <button type="button" class="btn sm" onclick={() => clearData(p.name)}>{t('apps.clearData')}</button>
                      <Menu items={menuFor(p.name)} label={t('apps.more')} size={30} />
                    </td>
                  </tr>
                {:else}
                  <tr><td colspan="4" class="muted center">{loading ? t('apps.loading') : t('apps.empty')}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>

      <aside class="card inst" aria-label={t('apps.install')}>
        <h2>{t('apps.install')}</h2>
        <div class="drop" class:over={dragOver} data-guide="apps-drop">
          <Icon name="upload" size={26} />
          <div class="strong">{t('apps.drop')}</div>
          <div class="muted small">{t('apps.dropHint')}</div>
          <button type="button" class="btn sm outline" onclick={choose}>{t('apps.choose')}</button>
        </div>
        {#each files as f (f)}
          <div class="file">
            <span class="mono name" title={f}>{baseName(f)}</span>
            <button type="button" class="btn sm icon ghost" aria-label={t('apps.removeFile')} title={t('apps.removeFile')} onclick={() => (files = files.filter((x) => x !== f))}><Icon name="close" size={14} /></button>
          </div>
        {/each}
        {#if files.length > 1}
          <fieldset class="multi">
            <legend class="section-title">{t('apps.multi')}</legend>
            <label class="check"><input type="radio" bind:group={mode} value="each" /> {t('apps.mode.each')}</label>
            <label class="check"><input type="radio" bind:group={mode} value="splits" /> {t('apps.mode.splits')}</label>
            <label class="check"><input type="radio" bind:group={mode} value="session" /> {t('apps.mode.session')}</label>
          </fieldset>
        {/if}

        <div class="params" data-guide="apps-params">
          <fieldset class="flags">
            <legend class="section-title">{t('apps.params')}</legend>
            {#each FLAGS as [id, flag, key] (id)}
              <label class="check"><input type="checkbox" bind:checked={flags[id]} /><span><code>{flag}</code> <span class="muted">{t(key)}</span></span></label>
            {/each}
          </fieldset>
          <label class="field"
            >{t('apps.abi')}
            <select class="select" bind:value={abi}>
              <option value="">{t('apps.abiAuto')}</option>
              {#each ['arm64-v8a', 'armeabi-v7a', 'armeabi', 'x86_64', 'x86'] as a (a)}<option value={a}>{a}</option>{/each}
            </select>
          </label>
          {#if preview}
            <pre class="term cmd">{preview}</pre>
          {/if}
          <div class="row">
            <button
              type="button"
              class="btn"
              disabled={!preview}
              onclick={async () => {
                await copyText(files.length && targets.length ? commandsFor().map((c) => displayCommand(['-s', targets[0], ...c])).join('\n') : '');
                toast(t('common.copied'), 'success', undefined, 2000);
              }}>{t('apps.copyCommand')}</button
            >
            <button type="button" class="btn primary grow" disabled={!files.length || !targets.length || !!installing} onclick={install}>
              {#if installing}<Icon name="spinner" size={16} class="spin" />{/if}
              {t('apps.installButton')}
            </button>
          </div>
          {#if installing}<div class="muted small" role="status">{installing}</div>{/if}
          {#if !files.length}<div class="muted small">{t('apps.noFiles')}</div>{/if}
          <label class="check"><input type="checkbox" bind:checked={allDevices} /> {t('apps.allDevices')}</label>
        </div>
        {#if installError}
          <ErrorState error={installError.error} serial={installError.serial} onretry={installError.retry} />
        {/if}
      </aside>
    </div>
  </div>
</div>

{#if perms}
  <Modal title={t('apps.permsTitle', { pkg: perms.pkg })} onclose={() => (perms = null)} width={620}>
    {#each perms.list as p (p.name)}
      <div class="perm">
        <span class="mono grow">{p.name}</span>
        <span class="chip {p.granted ? 'ok' : 'neutral'}">{p.granted ? t('apps.granted') : t('apps.denied')}</span>
        <button type="button" class="btn sm" onclick={() => togglePerm(p.name, p.granted)}>{p.granted ? t('apps.revoke') : t('apps.grant')}</button>
      </div>
    {:else}
      <div class="muted">{t('apps.permsEmpty')}</div>
    {/each}
  </Modal>
{/if}

<style>
  .cols {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: flex-start;
  }
  .list {
    flex: 999 1 520px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }
  .tbl {
    overflow: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    min-width: 560px;
  }
  th {
    text-align: left;
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }
  td {
    padding: 7px 12px;
    border-bottom: 1px solid var(--surface-3);
  }
  .pkg {
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .r {
    text-align: right;
  }
  .acts {
    white-space: nowrap;
  }
  .acts :global(.btn),
  .acts :global(.mw) {
    margin-left: 4px;
  }
  .center {
    text-align: center;
    padding: 24px;
  }
  .inst {
    flex: 1 1 360px;
    min-width: 0;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .inst h2 {
    font-size: 15px;
  }
  .drop {
    border: 2px dashed var(--accent-border);
    background: var(--accent-soft);
    border-radius: 10px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    text-align: center;
    color: var(--accent);
  }
  .drop .strong {
    color: var(--text);
  }
  .drop.over {
    border-style: solid;
    border-color: var(--accent);
  }
  .strong {
    font-weight: 600;
    font-size: 13px;
  }
  .small {
    font-size: 12px;
  }
  .file {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--surface-2);
    border-radius: 8px;
    padding: 4px 4px 4px 10px;
  }
  .name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
  }
  legend {
    margin-bottom: 8px;
  }
  .multi {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .params {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .flags {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 8px 12px;
  }
  .flags code {
    font-size: 12px;
    font-weight: 500;
  }
  .cmd {
    margin: 0;
  }
  .perm {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid var(--surface-3);
    font-size: 12px;
  }
</style>
