<script lang="ts">
  import TopBar from '../components/TopBar.svelte';
  import PageGuideOffer from '../components/PageGuideOffer.svelte';
  import ErrorState from '../components/ErrorState.svelte';
  import Icon from '../components/Icon.svelte';
  import { t, lang } from '../lib/i18n.svelte';
  import { api, listen, pickFiles, revealInFolder } from '../lib/ipc';
  import { classify, type AdbError } from '../lib/errors';
  import { formatBytes } from '../lib/format';
  import { adbChanged, app, applyTheme, checkServer, confirmDialog, restartServer, saveSettings, setLanguage, startTour, toast } from '../lib/state.svelte';
  import type { AdbVersion, Settings, Theme } from '../lib/types';

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
          {:else if valid}<div class="indent note ok"><strong>{t('first.valid')}</strong> adb {valid.adbVersion}{valid.toolsVersion ? ` · ${valid.toolsVersion}` : ''}</div>
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

      <section class="card sec">
        <h2>{t('settings.app')}</h2>
        <div class="field">
          <span>{t('settings.theme')}</span>
          <div class="seg" role="group" aria-label={t('settings.theme')}>
            {#each ['system', 'light', 'dark'] as const as th (th)}
              <button type="button" aria-pressed={app.settings.theme === th} onclick={() => setTheme(th)}>{t(`settings.theme.${th}`)}</button>
            {/each}
          </div>
        </div>
        <label class="field"
          >{t('settings.language')}
          <select class="select narrow" value={lang.current} onchange={(e) => setLanguage(e.currentTarget.value as Settings['language'])}>
            <option value="pt-BR">Português (Brasil)</option>
            <option value="en-US">English (US)</option>
          </select>
        </label>
        <label class="check"
          >{t('settings.refreshEvery')}
          <input class="input tiny" type="number" min="10" max="3600" bind:value={app.settings.summaryRefreshSec} onchange={saveSettings} />
          {t('settings.seconds')}</label
        >
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

      <section class="card sec">
        <h2>{t('settings.about')}</h2>
        <div>ADB GUI Manager · {t('settings.version', { v: '0.1.0' })}</div>
        <div class="mono muted small">br.com.kelvinronaldo.adbguimanager</div>
        <div class="field">
          <span>{t('settings.dataDir')}</span>
          <div class="row nowrap">
            <span class="mono small grow path">{app.init?.dataDir}</span>
            <button type="button" class="btn sm" onclick={() => app.init && revealInFolder(app.init.dataDir)}>{t('settings.openDataDir')}</button>
          </div>
        </div>
      </section>
    </div>
  </div>
</div>

<style>
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
  .narrow {
    width: 240px;
  }
  .tiny {
    width: 70px;
    height: 30px;
  }
  .path {
    word-break: break-all;
  }
</style>
