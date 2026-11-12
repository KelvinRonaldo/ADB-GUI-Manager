<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte';

  let {
    title,
    onclose,
    width = 520,
    children,
    footer,
  }: { title: string; onclose: () => void; width?: number; children: Snippet; footer?: Snippet } = $props();

  let dialog: HTMLElement | undefined = $state();
  const id = `m${Math.random().toString(36).slice(2)}`;

  $effect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = dialog?.querySelector<HTMLElement>('input, select, textarea, button.primary, button');
    first?.focus();
    return () => prev?.focus?.();
  });

  function onkey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onclose();
    }
    if (e.key === 'Tab' && dialog) {
      const f = [...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], summary')].filter((x) => !x.hasAttribute('disabled'));
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && i === f.length - 1) {
        e.preventDefault();
        f[0].focus();
      }
    }
  }
</script>

<div class="scrim" role="presentation" onmousedown={(e) => e.target === e.currentTarget && onclose()}>
  <div bind:this={dialog} class="dialog" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby={id} style="max-width: {width}px" onkeydown={onkey}>
    <header>
      <h2 {id}>{title}</h2>
      <button type="button" class="x" aria-label={t('common.close')} onclick={onclose}><Icon name="close" size={16} /></button>
    </header>
    <div class="body">{@render children()}</div>
    {#if footer}<footer>{@render footer()}</footer>{/if}
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    z-index: 80;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  .dialog {
    width: 100%;
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-radius: 14px;
    box-shadow: var(--shadow);
    border: 1px solid var(--border);
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 18px 20px 6px;
  }
  h2 {
    flex: 1 1 auto;
    font-size: 17px;
    font-weight: 700;
  }
  .x {
    border: 0;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    display: flex;
    padding: 6px;
    border-radius: 6px;
  }
  .x:hover {
    background: var(--surface-3);
  }
  .body {
    padding: 8px 20px 16px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-size: 14px;
    line-height: 21px;
  }
  footer {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    flex-wrap: wrap;
    padding: 12px 20px 18px;
    border-top: 1px solid var(--surface-3);
  }
</style>
