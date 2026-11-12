<script lang="ts">
  import Icon from './Icon.svelte';
  import { t, type Key } from '../lib/i18n.svelte';
  import type { AdbError, ErrorAction } from '../lib/errors';
  import { copyText } from '../lib/ipc';
  import { toast } from '../lib/state.svelte';

  let {
    error,
    available,
    onaction,
    compact = false,
  }: { error: AdbError; available: (a: ErrorAction) => boolean; onaction: (a: ErrorAction) => void; compact?: boolean } = $props();

  const actions = $derived(error.actions.filter(available));
  const icon = $derived(
    ['deviceNotFound', 'offline'].includes(error.kind) ? 'unplugged' : ['connectRefused', 'connectTimeout', 'connectFailed', 'pairFailed'].includes(error.kind) ? 'wifiOff' : 'alert',
  );

  async function copy() {
    await copyText(error.raw);
    toast(t('common.copied'), 'success', undefined, 2000);
  }
</script>

<div class="ep" class:compact>
  <div class="ic" aria-hidden="true"><Icon name={icon} size={22} stroke={2} /></div>
  <div class="main">
    <h3>{t(`err.${error.kind}.t` as Key)}</h3>
    <p>{t(`err.${error.kind}.b` as Key, error.params)}</p>
    {#if actions.length}
      <div class="row acts">
        {#each actions as a, i (a)}
          <button type="button" class="btn {i === 0 ? 'primary' : 'outline'}" onclick={() => onaction(a)}>{t(`err.act.${a}` as Key)}</button>
        {/each}
      </div>
    {/if}
    <details>
      <summary>{t('common.technicalDetails')}</summary>
      <pre class="term">{error.raw}{error.code !== undefined ? `\n${t('common.exitCode', { code: error.code })}` : ''}</pre>
      <button type="button" class="linkbtn" title={t('err.copyHint')} onclick={copy}>{t('common.copyDetails')}</button>
    </details>
  </div>
</div>

<style>
  .ep {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }
  .ic {
    width: 44px;
    height: 44px;
    border-radius: 22px;
    background: var(--err-bg);
    color: var(--err-fg);
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
  }
  .main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  h3 {
    font-size: 16px;
    font-weight: 700;
  }
  p {
    margin: 0;
    font-size: 14px;
    line-height: 21px;
  }
  .acts {
    margin-top: 4px;
  }
  details {
    font-size: 13px;
  }
  summary {
    cursor: pointer;
    color: var(--muted);
    font-weight: 600;
  }
  pre {
    margin-top: 8px;
    max-height: 220px;
  }
  .linkbtn {
    margin-top: 6px;
    font-size: 12px;
  }
</style>
