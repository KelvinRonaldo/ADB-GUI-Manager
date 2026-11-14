<script lang="ts" module>
  export type MoreItem = { icon: string; label: string; onclick: () => void; pressed?: boolean; disabled?: boolean } | { divider: true };
</script>

<script lang="ts">
  // Botão "Mais" do espelho: abre as ações que não cabem na barra ou na coluna.
  // Na barra do app abre para cima, sem cobrir os botões; na coluna abre para a esquerda.
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte';

  let { items, variant = 'bar', onopen }: { items: MoreItem[]; variant?: 'bar' | 'column'; onopen?: (open: boolean) => void } = $props();

  let open = $state(false);
  let btn: HTMLButtonElement | undefined = $state();
  let menuEl: HTMLElement | undefined = $state();
  let pos = $state({ left: 0, top: 0, ready: false });

  function place() {
    if (!btn || !menuEl) return;
    const r = btn.getBoundingClientRect();
    const w = menuEl.offsetWidth;
    const h = menuEl.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 6;
    let left: number;
    let top: number;
    if (variant === 'column') {
      // Ao lado da coluna, alinhado pela base do botão; sem espaço à esquerda, vai para a direita.
      left = r.left - gap - w;
      if (left < 8) left = r.right + gap;
      top = r.bottom - h;
    } else {
      // Acima do botão, alinhado pela direita; sem espaço em cima, vai para baixo.
      left = r.right - w;
      top = r.top - gap - h;
      if (top < 8) top = r.bottom + gap;
    }
    left = Math.min(Math.max(8, left), vw - w - 8);
    top = Math.min(Math.max(8, top), vh - h - 8);
    pos = { left, top, ready: true };
  }

  function setOpen(v: boolean) {
    open = v;
    if (!v) pos = { left: 0, top: 0, ready: false };
    onopen?.(v);
  }

  $effect(() => {
    if (open && menuEl) {
      place();
      requestAnimationFrame(() => menuEl?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus());
    }
  });

  function pick(it: MoreItem) {
    if ('divider' in it) return;
    setOpen(false);
    it.onclick();
  }
  function onWindow(e: MouseEvent) {
    if (open && btn && !btn.contains(e.target as Node) && !(menuEl && menuEl.contains(e.target as Node))) setOpen(false);
  }
  function onkey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btn?.focus();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const all = [...(menuEl?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [])];
      const i = all.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % all.length : (i - 1 + all.length) % all.length;
      all[next]?.focus();
    }
  }
</script>

<svelte:window onclick={onWindow} onresize={() => open && place()} />

<button
  bind:this={btn}
  type="button"
  class={variant === 'column' ? 'col-btn' : 'btn sm'}
  class:on={open}
  aria-label={t('mirror.more')}
  title={t('mirror.more')}
  aria-haspopup="menu"
  aria-expanded={open}
  onclick={() => setOpen(!open)}
>
  <Icon name="more" size={variant === 'column' ? 18 : 14} />{#if variant === 'bar'}{t('mirror.more')}{/if}
</button>
{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={menuEl}
    class="more-menu"
    class:dark={variant === 'column'}
    role="menu"
    tabindex="-1"
    aria-label={t('mirror.more')}
    onkeydown={onkey}
    style="left:{pos.left}px;top:{pos.top}px;visibility:{pos.ready ? 'visible' : 'hidden'}"
  >
    {#each items as it, i (i)}
      {#if 'divider' in it}
        <div class="div" role="separator"></div>
      {:else}
        <button
          type="button"
          role={it.pressed === undefined ? 'menuitem' : 'menuitemcheckbox'}
          class="mi"
          disabled={it.disabled}
          aria-checked={it.pressed}
          onclick={() => pick(it)}
        >
          <Icon name={it.icon} size={15} /><span>{it.label}</span>
          {#if it.pressed}<span class="tick"><Icon name="check" size={14} /></span>{/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .col-btn {
    width: 36px;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: #d5dae2;
    cursor: pointer;
  }
  .col-btn:hover,
  .col-btn.on {
    background: #2c323b;
    color: #fff;
  }
  .btn.on {
    border-color: var(--accent);
    color: var(--accent);
  }
  .more-menu {
    position: fixed;
    z-index: 300;
    min-width: 220px;
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    box-shadow: var(--shadow);
    padding: 6px;
    display: flex;
    flex-direction: column;
  }
  /* Na coluna (janela destacada e tela cheia) o fundo é escuro como a coluna. */
  .more-menu.dark {
    background: #1a1e24;
    color: #e6e8ec;
    border-color: #2c323b;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }
  .mi {
    display: flex;
    align-items: center;
    gap: 9px;
    border: 0;
    background: transparent;
    color: inherit;
    border-radius: 6px;
    padding: 7px 10px;
    text-align: left;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
  }
  .mi:hover:not(:disabled),
  .mi:focus-visible {
    background: var(--surface-3);
    outline: none;
  }
  .dark .mi:hover:not(:disabled),
  .dark .mi:focus-visible {
    background: #2c323b;
  }
  .mi:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .tick {
    margin-left: auto;
    display: inline-flex;
    color: var(--accent);
  }
  .div {
    height: 1px;
    background: var(--surface-3);
    margin: 4px 0;
  }
  .dark .div {
    background: #2c323b;
  }
</style>
