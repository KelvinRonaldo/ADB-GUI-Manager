<script lang="ts">
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte';
  import { app, dismissToast } from '../lib/state.svelte';
</script>

<div class="toasts" aria-live="polite">
  {#each app.toasts as x (x.id)}
    <div class="toast {x.kind}" role="status">
      <span class="kind" aria-hidden="true"><Icon name={x.kind === 'error' ? 'alert' : x.kind === 'success' ? 'check' : 'info'} size={16} /></span>
      <span class="text">{x.text}</span>
      {#if x.action}
        <button
          type="button"
          class="act"
          onclick={() => {
            x.action?.();
            dismissToast(x.id);
          }}>{x.actionLabel}</button
        >
      {/if}
      <button type="button" class="x" aria-label={t('common.close')} onclick={() => dismissToast(x.id)}><Icon name="close" size={14} /></button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 244px;
    bottom: 176px;
    z-index: 60;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: min(560px, calc(100vw - 260px));
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 12px;
    background: #1f2329;
    color: #fff;
    border-radius: 12px;
    padding: 10px 10px 10px 14px;
    font-size: 13px;
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.25);
  }
  :global([data-theme='dark']) .toast {
    background: #e6e8ec;
    color: #111418;
  }
  .kind {
    display: flex;
    color: #93c5fd;
  }
  .toast.error .kind {
    color: #fca5a5;
  }
  .toast.success .kind {
    color: #86efac;
  }
  :global([data-theme='dark']) .toast .kind {
    color: #1d4ed8;
  }
  :global([data-theme='dark']) .toast.error .kind {
    color: #b91c1c;
  }
  :global([data-theme='dark']) .toast.success .kind {
    color: #15803d;
  }
  .text {
    flex: 1 1 auto;
    overflow-wrap: anywhere;
  }
  .act {
    border: 0;
    background: transparent;
    color: #93c5fd;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  :global([data-theme='dark']) .act {
    color: #1d4ed8;
  }
  .x {
    border: 0;
    background: transparent;
    color: inherit;
    opacity: 0.7;
    cursor: pointer;
    display: flex;
    padding: 4px;
  }
</style>
