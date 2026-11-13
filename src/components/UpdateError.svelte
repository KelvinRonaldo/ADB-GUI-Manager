<script lang="ts">
  // Um erro da atualização: título, explicação e as ações daquele caso.
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte';
  import { openAppFolder, openReleases, retryUpdate, upd, type UpdateError } from '../lib/update.svelte';

  let { error, compact = false }: { error: UpdateError; compact?: boolean } = $props();
  let showRaw = $state(false);

  const warn = $derived(error.kind === 'permission' || error.kind === 'unsupported' || error.kind === 'noPackage');
  const v = $derived(upd.info?.version ?? '');
  const primary = $derived(
    error.kind === 'network' || error.kind === 'generic'
      ? t('update.act.retry')
      : error.kind === 'interrupted'
        ? t('update.act.resume')
        : error.kind === 'notFinished' || error.kind === 'auth' || error.kind === 'install'
          ? t('update.act.reinstall')
          : null,
  );
</script>

<div class="uerr" class:warn class:compact role="alert">
  <div class="head"><Icon name="alert" size={16} /><strong>{t(`update.err.${error.kind}.t`)}</strong></div>
  <p>{t(`update.err.${error.kind}.b`, { v })}</p>
  <div class="row">
    {#if primary}
      <button type="button" class="btn sm primary" onclick={retryUpdate}><Icon name="refresh" size={14} />{primary}</button>
    {/if}
    {#if error.kind === 'permission'}
      <button type="button" class="btn sm" onclick={openAppFolder}>{t('update.act.openFolder')}</button>
    {/if}
    {#if error.kind !== 'network' && error.kind !== 'interrupted' && error.kind !== 'notFinished'}
      <button type="button" class="btn sm outline" onclick={openReleases}>{t('update.act.openRelease')} ↗</button>
    {/if}
    <button type="button" class="btn sm ghost" aria-expanded={showRaw} onclick={() => (showRaw = !showRaw)}>{t('update.act.details')}</button>
  </div>
  {#if showRaw}<pre class="raw mono">{error.raw}</pre>{/if}
</div>

<style>
  .uerr {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid var(--err-border);
    background: var(--err-bg);
    color: var(--text);
  }
  .uerr.warn {
    border-color: var(--warn-border);
    background: var(--warn-bg);
  }
  .head {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--err-fg);
  }
  .warn .head {
    color: var(--warn-fg);
  }
  p {
    margin: 0;
    font-size: 13px;
    line-height: 19px;
  }
  .row {
    flex-wrap: wrap;
  }
  .raw {
    margin: 0;
    font-size: 11.5px;
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--surface);
    border-radius: 6px;
    padding: 8px;
    max-height: 120px;
    overflow: auto;
  }
</style>
