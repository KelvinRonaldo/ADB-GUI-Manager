<script lang="ts">
  import TopBar from '../components/TopBar.svelte';
  import PageGuideOffer from '../components/PageGuideOffer.svelte';
  import ErrorState from '../components/ErrorState.svelte';
  import Icon from '../components/Icon.svelte';
  import Flag from '../components/Flag.svelte';
  import { t, lang } from '../lib/i18n.svelte';
  import { api, listen, pickFiles, revealInFolder } from '../lib/ipc';
  import { classify, type AdbError } from '../lib/errors';
  import { formatBytes } from '../lib/format';
  import { adbChanged, app, applyTheme, checkServer, confirmDialog, restartServer, saveSettings, setLanguage, startTour, toast } from '../lib/state.svelte';
  import type { AdbVersion, DarkPalette, LightPalette, Settings, Theme } from '../lib/types';
  import UpdateError from '../components/UpdateError.svelte';
  import { checkUpdates, openReleases, packageLabel, upd, whenText } from '../lib/update.svelte';

  const lastCheckText = $derived.by(() => {
    const lc = app.settings.updateLastCheck;
    if (!lc) return t('update.never');
    const when = whenText(lc.at);
    return lc.found ? t('update.lastCheckFound', { when, v: lc.found }) : t('update.lastCheckNone', { when });
  });
  const dlPct = $derived(upd.progress?.total ? `${Math.round((upd.progress.received / upd.progress.total) * 100)}%` : '');

  let mode = $state<Settings['adbMode']>(app.settings.adbMode);
  let path = $state(app.settings.adbPath || (app.adb?.source === 'custom' ? app.adb.path : ''));
  let checking = $state(false);
  let valid = $state<AdbVersion | null>(null);
  let invalid = $state('');
  let applyError = $state<AdbError | null>(null);
  let downloading = $state(false);
  let progress = $state<{ received: number; total?: number | null; phase: string } | null>(null);
  let downloadedExists = $state(app.init?.downloadedExists ?? false);
  let serverBusy = $state(false);

  const KNOWN = ['ANDROID_SERIAL', 'ADB_TRACE', 'ADB_VENDOR_KEYS', 'ADB_MDNS_AUTO_CONNECT', 'ADB_MDNS_OPENSCREEN', 'ADB_LIBUSB', 'ANDROID_LOG_TAGS', 'ADB_LOCAL_TRANSPORT_MAX_PORT'];
  const HINTS: Record<string, string> = {
    ANDROID_SERIAL: 'serial',
    ADB_TRACE: 'all, adb, sockets, packets, rwx, usb, sync, sysdeps, transport, jdwp, services, auth, fdevent, shell, incremental',
    ADB_VENDOR_KEYS: '~/.android/vendor-keys',
    ADB_MDNS_AUTO_CONNECT: 'adb-tls-connect,adb-tls-pairing',
    ADB_MDNS_OPENSCREEN: '0 | 1',
    ADB_LIBUSB: '0 | 1',
    ANDROID_LOG_TAGS: '*:I',
    ADB_LOCAL_TRANSPORT_MAX_PORT: '5585',
  };
  let envNames = $state<string[]>([...new Set([...KNOWN, ...Object.keys(app.settings.env)])]);
  let newVar = $state('');

  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const p = path;
    valid = null;
    invalid = '';
    clearTimeout(timer);
    if (mode !== 'custom' || !p.trim()) return;
    timer = setTimeout(async () => {
      checking = true;
      try {
        valid = await api.validate(p.trim());
      } catch (e) {
        invalid = String(e).split(':')[0];
      } finally {
        checking = false;
      }
    }, 300);
  });

  async function applyAdb() {
    applyError = null;
    try {
      adbChanged(await api.useAdb(mode, mode === 'custom' ? path.trim() : undefined, true));
      app.settings.adbMode = mode;
      app.settings.adbPath = mode === 'custom' ? path.trim() : '';
      toast(t('settings.saved'), 'success', undefined, 2000);
    } catch (e) {
      applyError = classify(String(e).replace('NOT_FOUND', 'SPAWN_FAILED: NOT_FOUND'));
    }
  }

  async function download() {
    const c = await confirmDialog({
      title: t('confirm.downloadTitle'),
      text: t('confirm.downloadText', { url: app.init?.downloadUrl ?? '', dir: app.init?.dataDir ?? '' }),
      confirmLabel: t('settings.download'),
    });
    if (!c.ok) return;
    downloading = true;
    const off = await listen<{ received: number; total?: number; phase: string }>('download', (p) => (progress = p));
    try {
      await api.downloadPlatformTools();
      downloadedExists = true;
      mode = 'downloaded';
      await applyAdb();
    } catch (e) {
      toast(t('first.downloadFailed', { error: String(e) }), 'error');
    } finally {
      off();
      downloading = false;
      progress = null;
    }
  }

  async function browse() {
    const f = await pickFiles({ title: t('first.pathLabel') });
    if (f[0]) {
      mode = 'custom';
      path = f[0];
    }
  }

  function setEnv(name: string, value: string) {
    app.settings.env = { ...app.settings.env, [name]: value };
    saveSettings();
  }
  function addVar() {
    const n = newVar.trim().toUpperCase();
    if (!n || envNames.includes(n)) return;
    envNames.push(n);
    newVar = '';
  }

  async function server(action: 'start' | 'stop' | 'restart') {
    serverBusy = true;
    try {
      if (action === 'restart') await restartServer();
      else {
        if (action === 'stop') {
          const c = await confirmDialog({ title: t('confirm.killServerTitle'), text: t('confirm.killServerText'), danger: true, destructive: true, confirmLabel: t('server.stop') });
          if (!c.ok) return;
        }
        const r = action === 'start' ? await api.serverStart() : await api.serverStop();
        const err = classify(r);
        if (err) applyError = err;
      }
    } finally {
      serverBusy = false;
      checkServer();
    }
  }

  function setTheme(th: Theme) {
    app.settings.theme = th;
    applyTheme();
    saveSettings();
  }

  const lightPalettes: LightPalette[] = ['classic', 'lavender', 'sun'];
  const darkPalettes: DarkPalette[] = ['classic', 'forest', 'plum'];
  function paletteName(mode: 'light' | 'dark', id: string): string {
    if (id === 'classic') return mode === 'light' ? t('settings.palette.classic.light') : t('settings.palette.classic.dark');
    const names: Record<string, string> = {
      lavender: t('settings.palette.lavender'),
      sun: t('settings.palette.sun'),
      forest: t('settings.palette.forest'),
      plum: t('settings.palette.plum'),
    };
    return names[id] ?? id;
  }
  function setPalette(mode: 'light' | 'dark', id: string) {
    if (mode === 'light') app.settings.lightTheme = id as LightPalette;
    else app.settings.darkTheme = id as DarkPalette;
    applyTheme();
    saveSettings();
  }

  // "Manter na bandeja" só aparece quando o sistema mostrou o ícone da bandeja.
  let trayOk = $state(false);
  api.trayAvailable().then((v) => (trayOk = v)).catch(() => {});
  function setCloseToTray(v: boolean) {
    app.settings.closeToTray = v;
    saveSettings();
  }
</script>

<div class="page">
  <TopBar heading={t('settings.title')} sub={t('settings.subtitle')} />
  <div class="page-body">
    <PageGuideOffer page="settings" />
    <div class="grid">
      <section class="card sec" data-guide="settings-adb">
        <h2>{t('settings.adb')}</h2>
        <label class="check"><input type="radio" name="mode" value="auto" bind:group={mode} /> {t('settings.mode.auto')}</label>
        <label class="check"><input type="radio" name="mode" value="custom" bind:group={mode} /> {t('settings.mode.custom')}</label>
        <div class="row nowrap indent">
          <input class="input mono grow" aria-label={t('first.pathLabel')} bind:value={path} onfocus={() => (mode = 'custom')} placeholder={app.init?.os === 'windows' ? 'C:\\platform-tools\\adb.exe' : '/usr/bin/adb'} />
          <button type="button" class="btn" onclick={browse}>{t('common.browse')}</button>
        </div>
        {#if mode === 'custom'}
          {#if checking}<div class="indent muted small">{t('settings.validating')}</div>
          {:else if valid}<div class="indent note ok"><strong><Icon name="check" size={13} /> {t('first.valid')}</strong> adb {valid.adbVersion}{valid.toolsVersion ? ` · ${valid.toolsVersion}` : ''}</div>
          {:else if invalid}<div class="indent note bad">{t(`first.invalid.${['empty', 'notFound', 'isDirectory', 'notExecutable', 'notAdb'].includes(invalid) ? invalid : 'notAdb'}` as never)}</div>{/if}
        {/if}
        <label class="check"><input type="radio" name="mode" value="downloaded" bind:group={mode} disabled={!downloadedExists} /> {t('settings.mode.downloaded')}</label>
        <div class="row indent">
          <button type="button" class="btn sm" disabled={downloading} onclick={download}>
            <Icon name="download" size={14} />
            {downloadedExists ? t('settings.update') : t('settings.download')}
          </button>
          {#if downloading && progress}
            <span class="muted small">
              {progress.phase === 'extract'
                ? t('first.extracting')
                : t('first.downloading', { received: formatBytes(progress.received, lang.current), total: progress.total ? formatBytes(progress.total, lang.current) : '?' })}
            </span>
          {/if}
        </div>
        <div class="row">
          <button type="button" class="btn primary" disabled={mode === 'custom' && !valid} onclick={applyAdb}>{t('settings.apply')}</button>
        </div>
        {#if app.adb}<div class="note ok small">{t('settings.inUse', { v: app.adb.version.adbVersion, path: app.adb.path })}</div>{/if}
        {#if applyError}<ErrorState error={applyError} onretry={applyAdb} />{/if}
        <div class="muted small">{app.init?.cliAdb ? t('settings.cliActive', { path: app.init.cliAdb }) : t('settings.cliNote')}</div>
      </section>

      <section class="card sec" data-guide="settings-server">
        <h2>{t('settings.server')}</h2>
        <div class="two">
          <label class="field">{t('settings.host')}<input class="input mono" bind:value={app.settings.serverHost} onchange={saveSettings} /></label>
          <label class="field"
            >{t('settings.port')}<input
              class="input mono"
              type="number"
              min="1"
              max="65535"
              bind:value={app.settings.serverPort}
              onchange={saveSettings}
            /></label
          >
        </div>
        <div class="row">
          <span class="dot" class:off={!app.serverRunning}></span>
          {app.serverRunning ? t('server.running') : t('server.stopped')}
          <div class="spacer"></div>
          <button type="button" class="btn sm" disabled={serverBusy} onclick={() => server('start')}>{t('common.start')}</button>
          <button type="button" class="btn sm" disabled={serverBusy} onclick={() => server('stop')}>{t('common.stop')}</button>
          <button type="button" class="btn sm outline" disabled={serverBusy} onclick={() => server('restart')}>{t('server.restart')}</button>
        </div>
        <label class="check"><input type="checkbox" bind:checked={app.settings.startServerOnLaunch} onchange={saveSettings} /> {t('settings.startOnLaunch')}</label>
        <label class="check"><input type="checkbox" bind:checked={app.settings.stopServerOnExit} onchange={saveSettings} /> {t('settings.stopOnExit')}</label>
      </section>

      <section class="card sec">
        <h2>{t('settings.usbWifi')}</h2>
        <div class="seg" role="group" aria-label={t('settings.usbWifi')}>
          {#each ['auto', 'ask', 'off'] as const as m (m)}
            <button
              type="button"
              aria-pressed={app.settings.usbToWifi === m}
              onclick={() => {
                app.settings.usbToWifi = m;
                saveSettings();
              }}>{t(`settings.usbWifi.${m}`)}</button
            >
          {/each}
        </div>
        <div class="muted small">{t('settings.usbWifiHint')}</div>
        <label class="check"
          >{t('settings.wifiPort')}
          <input class="input tiny" type="number" min="1" max="65535" bind:value={app.settings.wifiPort} onchange={saveSettings} /></label
        >
        {#if app.settings.usbToWifiSkip.length}
          <div class="row">
            <span class="muted small">{t('settings.skipList', { n: app.settings.usbToWifiSkip.length })}</span>
            <button
              type="button"
              class="btn sm"
              onclick={() => {
                app.settings.usbToWifiSkip = [];
                saveSettings();
              }}>{t('settings.skipClear')}</button
            >
          </div>
        {/if}
      </section>

      <section class="card sec" data-guide="settings-env">
        <h2>{t('settings.env')}</h2>
        {#each envNames as name (name)}
          <label class="env">
            <span class="mono">{name}</span>
            <input class="input mono" value={app.settings.env[name] ?? ''} placeholder={HINTS[name] ?? ''} onchange={(e) => setEnv(name, e.currentTarget.value)} />
          </label>
        {/each}
        <div class="row nowrap">
          <input class="input mono grow" placeholder={t('settings.envName')} aria-label={t('settings.envAdd')} bind:value={newVar} onkeydown={(e) => e.key === 'Enter' && addVar()} />
          <button type="button" class="btn sm" onclick={addVar}>{t('settings.envAdd')}</button>
        </div>
        <div class="muted small">{t('settings.envHint')}</div>
      </section>

      <section class="card sec" data-guide="settings-look">
        <h2>{t('settings.look')}</h2>
        <div class="field">
          <span>{t('settings.theme')}</span>
          <div class="seg" role="group" aria-label={t('settings.theme')}>
            {#each ['system', 'light', 'dark'] as const as th (th)}
              <button type="button" aria-pressed={app.settings.theme === th} onclick={() => setTheme(th)}>{t(`settings.theme.${th}`)}</button>
            {/each}
          </div>
          <span class="muted small hint">{t('settings.theme.hint')}</span>
        </div>
        {#each [['light', lightPalettes, app.settings.lightTheme], ['dark', darkPalettes, app.settings.darkTheme]] as const as [mode, list, current] (mode)}
          <div class="field">
            <span id="pal-{mode}">{t(`settings.palette.${mode}`)}</span>
            <div class="palettes" role="radiogroup" aria-labelledby="pal-{mode}">
              {#each list as id (id)}
                {@const cls = id === 'classic' ? `pal-classic-${mode}` : `pal-${id}`}
                <button type="button" class="pal" role="radio" aria-checked={current === id} onclick={() => setPalette(mode, id)}>
                  <span class="mini {cls}" aria-hidden="true">
                    <span class="m-side"><span class="m-logo"></span><span class="m-act"></span><span class="m-line"></span><span class="m-line s"></span></span>
                    <span class="m-main"><span class="m-title"></span><span class="m-card"><span class="m-text"></span><span class="m-btn"></span></span></span>
                  </span>
                  <span class="pal-name">{paletteName(mode, id)}</span>
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </section>

      <section class="card sec">
        <h2>{t('settings.app')}</h2>
        <div class="field">
          <span>{t('settings.language')}</span>
          <div class="seg langs" role="group" aria-label={t('settings.language')}>
            {#each [['pt-BR', 'Português (Brasil)'], ['en-US', 'English (US)']] as const as [code, name] (code)}
              <button type="button" lang={code} aria-pressed={lang.current === code} onclick={() => setLanguage(code)}>
                <Flag lang={code} width={22} />
                {name}
              </button>
            {/each}
          </div>
        </div>
        <label class="check"
          >{t('settings.refreshEvery')}
          <input class="input tiny" type="number" min="10" max="3600" bind:value={app.settings.summaryRefreshSec} onchange={saveSettings} />
          {t('settings.seconds')}</label
        >
        {#if trayOk}
          <div class="field">
            <span>{t('settings.onClose')}</span>
            <div class="seg" role="group" aria-label={t('settings.onClose')}>
              <button type="button" aria-pressed={!app.settings.closeToTray} onclick={() => setCloseToTray(false)}>{t('settings.onClose.quit')}</button>
              <button type="button" aria-pressed={app.settings.closeToTray} onclick={() => setCloseToTray(true)}>{t('settings.onClose.tray')}</button>
            </div>
            {#if app.settings.closeToTray}<span class="muted small hint">{t('settings.onClose.hint')}</span>{/if}
          </div>
        {/if}
        <label class="check"><input type="checkbox" bind:checked={app.settings.keepHistory} onchange={saveSettings} /> {t('settings.keepHistory')}</label>
        <label class="check"><input type="checkbox" bind:checked={app.settings.confirmDestructive} onchange={saveSettings} /> {t('settings.confirmDestructive')}</label>
      </section>

      <section class="card sec" data-guide="settings-guides">
        <h2>{t('settings.guides')}</h2>
        <div class="row"><button type="button" class="btn" onclick={startTour}>{t('settings.replayTour')}</button></div>
        <div class="field">
          <span>{t('settings.pageGuides')}</span>
          <div class="seg" role="group" aria-label={t('settings.pageGuides')}>
            <button
              type="button"
              aria-pressed={app.settings.pageGuides === 'ask'}
              onclick={() => {
                app.settings.pageGuides = 'ask';
                saveSettings();
              }}>{t('settings.pageGuides.ask')}</button
            >
            <button
              type="button"
              aria-pressed={app.settings.pageGuides !== 'ask'}
              onclick={() => {
                app.settings.pageGuides = 'never';
                saveSettings();
              }}>{t('settings.pageGuides.never')}</button
            >
          </div>
        </div>
        <div class="row">
          <button
            type="button"
            class="btn sm"
            onclick={() => {
              app.settings.seenPages = [];
              app.settings.pageGuides = 'ask';
              saveSettings();
              toast(t('settings.guidesReset'), 'success');
            }}>{t('settings.resetGuides')}</button
          >
        </div>
      </section>

      <section class="card sec wide" data-guide="settings-update">
        <h2>{t('settings.aboutUpdates')}</h2>
        <div class="about">
          <div class="col">
            <div class="ver"><strong>ADB GUI Manager</strong> · {t('settings.version', { v: upd.info?.version ?? '…' })}</div>
            <div class="mono muted small">br.com.kelvinronaldo.adbguimanager</div>
            <dl class="facts">
              <dt>{t('update.package')}</dt>
              <dd>{packageLabel(upd.info?.package)}</dd>
              {#if upd.info?.location}
                <dt>{t('update.location')}</dt>
                <dd class="mono small path">{upd.info.location}</dd>
              {/if}
              <dt>{t('settings.dataDir')}</dt>
              <dd class="mono small path">{app.init?.dataDir}</dd>
            </dl>
            <div class="row"><button type="button" class="btn sm" onclick={() => app.init && revealInFolder(app.init.dataDir)}>{t('settings.openDataDir')}</button></div>
          </div>
          <div class="col upd" aria-live="polite">
            <strong class="small-h">{t('update.title')}</strong>
            {#if upd.info && !upd.info.canUpdate}
              <div class="muted small">{t('update.unsupported')}</div>
              <div class="row"><button type="button" class="btn sm outline" onclick={openReleases}>{t('update.act.openRelease')}<Icon name="external" size={14} /></button></div>
            {:else if upd.phase === 'checking'}
              <div class="line accent"><span class="spin"><Icon name="spinner" size={14} /></span>{t('update.checking')}</div>
              <div class="row"><button type="button" class="btn primary" disabled><Icon name="refresh" size={16} />{t('update.checkingBtn')}</button></div>
            {:else if upd.phase === 'uptodate'}
              <div class="line ok"><Icon name="check" size={14} />{t('update.upToDate', { v: upd.info?.version ?? '' })}</div>
              <div class="row"><button type="button" class="btn outline" onclick={checkUpdates}><Icon name="refresh" size={16} />{t('update.checkAgain')}</button></div>
            {:else if upd.phase === 'available'}
              <div class="line accent strong"><Icon name="download" size={14} />{t('update.available', { v: upd.check?.version ?? '' })}</div>
              <div class="row"><button type="button" class="btn primary" onclick={() => (upd.dialog = true)}><Icon name="download" size={16} />{upd.check?.downloaded ? t('update.installReopen') : t('update.downloadInstall')}</button></div>
            {:else if upd.phase === 'downloading'}
              <div class="line accent"><span class="spin"><Icon name="spinner" size={14} /></span>{t('update.downloadingShort', { v: upd.check?.version ?? '', pct: dlPct })}</div>
              <div class="minibar"><div style="width: {upd.progress?.total ? Math.round((upd.progress.received / upd.progress.total) * 100) : 8}%"></div></div>
              <div class="row"><button type="button" class="btn sm" onclick={() => (upd.dialog = true)}>{t('update.seeProgress')}</button></div>
            {:else if upd.phase === 'installing'}
              <div class="line accent"><span class="spin"><Icon name="spinner" size={14} /></span>{t('update.installingShort', { v: upd.check?.version ?? '' })}</div>
            {:else if upd.phase === 'updated' && upd.updated}
              <div class="line ok"><Icon name="check" size={14} />{t('update.updatedLine', { from: upd.updated.from, to: upd.updated.to })}</div>
              <div class="row">
                <button type="button" class="btn outline" onclick={checkUpdates}><Icon name="refresh" size={16} />{t('update.checkBtn')}</button>
                <button type="button" class="btn ghost" onclick={() => (upd.dialog = true)}>{t('update.seeNotes')}</button>
              </div>
            {:else if upd.phase === 'error' && upd.error}
              <UpdateError error={upd.error} />
              {#if !['notFinished', 'interrupted', 'network', 'generic'].includes(upd.error.kind)}
                <div class="row"><button type="button" class="btn sm outline" onclick={checkUpdates}><Icon name="refresh" size={14} />{t('update.checkAgain')}</button></div>
              {/if}
            {:else}
              <div class="muted small">{lastCheckText}</div>
              <div class="row"><button type="button" class="btn primary" onclick={checkUpdates}><Icon name="refresh" size={16} />{t('update.checkBtn')}</button></div>
            {/if}
            <div class="muted small foot">{t('update.footnote')}</div>
          </div>
        </div>
      </section>
    </div>
  </div>
</div>

<style>
  .hint {
    font-weight: 400;
  }
  .palettes {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .pal {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
  }
  .pal:hover {
    border-color: var(--border-strong);
  }
  .pal[aria-checked='true'] {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .pal-name {
    padding: 0 2px;
  }
  .mini {
    display: flex;
    height: 54px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .m-side {
    width: 28%;
    background: var(--side-bg);
    padding: 5px 4px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .m-logo {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: #3ddc84;
    margin-bottom: 2px;
  }
  .m-act {
    height: 4px;
    border-radius: 2px;
    background: var(--side-active);
  }
  .m-line {
    height: 4px;
    width: 75%;
    border-radius: 2px;
    background: var(--side-item);
    opacity: 0.45;
  }
  .m-line.s {
    width: 55%;
  }
  .m-main {
    flex: 1 1 auto;
    padding: 5px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .m-title {
    height: 5px;
    width: 55%;
    border-radius: 2px;
    background: var(--text);
  }
  .m-card {
    flex: 1 1 auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .m-text {
    height: 3px;
    width: 80%;
    border-radius: 2px;
    background: var(--muted);
  }
  .m-btn {
    height: 8px;
    width: 45%;
    border-radius: 3px;
    background: var(--accent);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
    gap: 14px;
    align-items: start;
  }
  .sec {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .sec h2 {
    font-size: 15px;
  }
  .indent {
    margin-left: 26px;
  }
  .nowrap {
    flex-wrap: nowrap;
  }
  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }
  .two {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .note {
    font-size: 12px;
    border-radius: 8px;
    padding: 8px 10px;
  }
  .note.ok {
    background: var(--ok-bg);
    color: var(--ok-fg);
    overflow-wrap: anywhere;
  }
  .note.bad {
    background: var(--err-bg);
    color: var(--err-fg);
  }
  .small {
    font-size: 12px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 4px;
    background: #16a34a;
  }
  .dot.off {
    background: #dc2626;
  }
  .spacer {
    flex: 1 1 auto;
  }
  .env {
    display: grid;
    grid-template-columns: 210px 1fr;
    gap: 8px;
    align-items: center;
    font-size: 12px;
  }
  .env .input {
    height: 32px;
  }
  .langs button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .tiny {
    width: 70px;
    height: 30px;
  }
  .path {
    word-break: break-all;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .about {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 18px;
  }
  .about .col {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    font-size: 13px;
  }
  .ver {
    font-size: 14px;
  }
  .facts {
    margin: 0;
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr);
    row-gap: 6px;
  }
  .facts dt {
    color: var(--muted);
  }
  .facts dd {
    margin: 0;
    min-width: 0;
  }
  .upd {
    padding-left: 18px;
    border-left: 1px solid var(--border);
  }
  .small-h {
    font-size: 13px;
  }
  .line {
    display: flex;
    gap: 8px;
    align-items: center;
    min-height: 20px;
  }
  .line.accent {
    color: var(--accent);
  }
  .line.ok {
    color: var(--ok-fg);
    font-weight: 600;
  }
  .line.strong {
    font-weight: 600;
  }
  .minibar {
    height: 6px;
    border-radius: 3px;
    background: var(--border);
    overflow: hidden;
  }
  .minibar > div {
    height: 100%;
    background: var(--accent);
  }
  .foot {
    line-height: 18px;
  }
</style>
