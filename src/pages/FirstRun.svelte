<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { t, lang, type Key } from '../lib/i18n.svelte';
  import { api, isTauri, listen, pickFiles } from '../lib/ipc';
  import { adbChanged, app, confirmDialog } from '../lib/state.svelte';
  import { formatBytes } from '../lib/format';
  import type { AdbVersion } from '../lib/types';

  let mode = $state<'point' | 'download'>('point');
  let path = $state('');
  let remember = $state(true);
  let valid = $state<AdbVersion | null>(null);
  let invalid = $state('');
  let checking = $state(false);
  let downloading = $state(false);
  let progress = $state<{ received: number; total?: number | null; phase: string } | null>(null);
  let downloadError = $state('');

  const exe = $derived(app.init?.os === 'windows' ? 'C:\\platform-tools\\adb.exe' : '/opt/platform-tools/adb');
  const checked = $derived(app.checked.filter((c) => !c.found));

  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const p = path;
    valid = null;
    invalid = '';
    clearTimeout(timer);
    if (!p.trim()) return;
    timer = setTimeout(async () => {
      checking = true;
      try {
        valid = await api.validate(p.trim());
      } catch (e) {
        const reason = String(e).split(':')[0];
        invalid = ['empty', 'notFound', 'isDirectory', 'notExecutable', 'notAdb'].includes(reason) ? reason : 'notAdb';
      } finally {
        checking = false;
      }
    }, 300);
  });

  async function browse() {
    const files = await pickFiles({ title: t('first.pathLabel') });
    if (files[0]) path = files[0];
  }

  async function doContinue() {
    if (mode === 'point') {
      if (!valid) return;
      try {
        adbChanged(await api.useAdb('custom', path.trim(), remember));
      } catch (e) {
        invalid = String(e);
      }
      return;
    }
    const c = await confirmDialog({
      title: t('confirm.downloadTitle'),
      text: t('confirm.downloadText', { url: app.init?.downloadUrl ?? '', dir: app.init?.dataDir ?? '' }),
      confirmLabel: t('settings.download'),
    });
    if (!c.ok) return;
    downloading = true;
    downloadError = '';
    const off = await listen<{ received: number; total?: number; phase: string }>('download', (p) => (progress = p));
    try {
      await api.downloadPlatformTools();
      adbChanged(await api.useAdb('downloaded', undefined, remember));
    } catch (e) {
      downloadError = String(e);
    } finally {
      off();
      downloading = false;
    }
  }

  async function quit() {
    if (!isTauri) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  }
</script>

<div class="wrap">
  <div class="dialog" role="dialog" aria-labelledby="t-first">
    <div class="head">
      <div class="logo"><Icon name="terminalApp" size={24} stroke={2.2} /></div>
      <div>
        <h1 id="t-first">{t('first.title')}</h1>
        <div class="muted">{t('first.subtitle')}</div>
      </div>
    </div>

    {#if checked.length}
      <div class="looked">
        <div class="section-title">{t('first.checked')}</div>
        {#each checked as c, i (i)}
          <div class="lrow">
            <span class="x"><Icon name="close" size={13} /></span>
            <span class="src">{t(`first.src.${c.source}` as Key)}</span>
            <span class="mono p">{c.path}</span>
          </div>
        {/each}
      </div>
    {/if}

    <fieldset>
      <legend>{t('first.how')}</legend>
      <label class="opt" class:sel={mode === 'point'}>
        <input type="radio" name="origem" value="point" bind:group={mode} />
        <span class="body">
          <span class="ttl">{t('first.point')}</span>
          <span class="row">
            <input class="input mono grow" aria-label={t('first.pathLabel')} placeholder={exe} bind:value={path} onfocus={() => (mode = 'point')} />
            <button type="button" class="btn" onclick={browse}>{t('common.browse')}</button>
          </span>
          {#if checking}
            <span class="note muted">{t('settings.validating')}</span>
          {:else if valid}
            <span class="note ok"><strong><Icon name="check" size={13} /> {t('first.valid')}</strong> <span class="mono">Android Debug Bridge version {valid.adbVersion}{valid.toolsVersion ? ` · Version ${valid.toolsVersion}` : ''}</span></span>
          {:else if invalid}
            <span class="note bad">{t(`first.invalid.${invalid}` as Key)}</span>
          {/if}
        </span>
      </label>

      <label class="opt" class:sel={mode === 'download'}>
        <input type="radio" name="origem" value="download" bind:group={mode} />
        <span class="body">
          <span class="ttl">{t('first.download')}</span>
          <span class="muted">{t('first.downloadText')}</span>
          {#if downloading && progress}
            <span class="note muted">
              {progress.phase === 'extract'
                ? t('first.extracting')
                : t('first.downloading', { received: formatBytes(progress.received, lang.current), total: progress.total ? formatBytes(progress.total, lang.current) : '?' })}
            </span>
            {#if progress.total}
              <span class="bar"><span style="width:{Math.round((progress.received / progress.total) * 100)}%"></span></span>
            {/if}
          {/if}
          {#if downloadError}<span class="note bad">{t('first.downloadFailed', { error: downloadError })}</span>{/if}
        </span>
      </label>

      <div class="cli">
        <Icon name="info" size={18} />
        <span class="body">
          <span class="muted">{t('first.cliHint')}</span>
          <code class="term c">adb-gui-manager --adb "{exe}"</code>
        </span>
      </div>
    </fieldset>

    <div class="row foot">
      <label class="check"><input type="checkbox" bind:checked={remember} /> {t('first.remember')}</label>
      <div class="spacer"></div>
      {#if isTauri}<button type="button" class="btn lg" onclick={quit}>{t('first.exit')}</button>{/if}
      <button type="button" class="btn primary lg" disabled={downloading || (mode === 'point' && !valid)} onclick={doContinue}>{t('first.continue')}</button>
    </div>
  </div>
</div>

<style>
  .wrap {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    background: var(--surface-3);
  }
  .dialog {
    width: 100%;
    max-width: 760px;
    background: var(--surface);
    border-radius: 16px;
    box-shadow: var(--shadow);
    padding: 32px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .head {
    display: flex;
    gap: 14px;
    align-items: center;
  }
  .logo {
    width: 44px;
    height: 44px;
    border-radius: 11px;
    background: #3ddc84;
    color: #10331f;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
  }
  h1 {
    font-size: 22px;
  }
  .looked {
    background: var(--surface-2);
    border-radius: 10px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .lrow {
    display: flex;
    gap: 10px;
    font-size: 13px;
    align-items: baseline;
  }
  .x {
    color: var(--err-fg);
    font-weight: 700;
    width: 14px;
  }
  .src {
    color: var(--muted);
    width: 150px;
    flex: 0 0 auto;
  }
  .p {
    font-size: 12px;
    word-break: break-all;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  legend {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 10px;
  }
  .opt {
    display: flex;
    gap: 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px;
    cursor: pointer;
  }
  .opt.sel {
    border: 2px solid var(--accent);
    padding: 13px;
    background: var(--accent-soft);
  }
  .opt input[type='radio'] {
    width: 18px;
    height: 18px;
    margin-top: 2px;
    accent-color: var(--accent);
  }
  .body {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .ttl {
    font-size: 14px;
    font-weight: 600;
  }
  .grow {
    flex: 1 1 auto;
  }
  .note {
    font-size: 12px;
    border-radius: 8px;
    padding: 8px 10px;
  }
  .note.ok {
    background: var(--ok-bg);
    color: var(--ok-fg);
  }
  .note.bad {
    background: var(--err-bg);
    color: var(--err-fg);
  }
  .note.muted {
    padding: 0;
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
  }
  .cli {
    display: flex;
    gap: 12px;
    border: 1px dashed var(--border-strong);
    border-radius: 10px;
    padding: 14px;
    color: var(--muted);
    font-size: 13px;
  }
  .c {
    padding: 6px 8px;
    font-size: 12px;
  }
  .foot {
    gap: 10px;
  }
  .spacer {
    flex: 1 1 auto;
  }
</style>
