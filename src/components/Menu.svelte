<script lang="ts" module>
  export interface MenuItem {
    label: string;
    onclick?: () => void;
    danger?: boolean;
    disabled?: boolean;
    children?: MenuItem[];
    divider?: boolean;
  }
</script>

<script lang="ts">
  import Icon from './Icon.svelte';

  let { items, label, size = 36 }: { items: MenuItem[]; label: string; size?: number } = $props();
  let open = $state(false);
  let expanded = $state<string | null>(null);
  let wrap: HTMLElement | undefined = $state();
  let btn: HTMLButtonElement | undefined = $state();
  let menuEl: HTMLElement | undefined = $state();
  // Posição na janela (fixed): o menu sai da área com rolagem e nunca fica atrás da
  // barra lateral nem é cortado. Abre para o lado e para cima ou para baixo conforme o espaço.
  let pos = $state({ left: 0, top: 0, ready: false });

  function place() {
    if (!btn || !menuEl) return;
    const r = btn.getBoundingClientRect();
    const w = menuEl.offsetWidth;
    const h = menuEl.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 6;
    // Não cobre a barra lateral: o limite da esquerda é o começo da área de conteúdo.
    const minLeft = Math.max(8, (btn.closest('main')?.getBoundingClientRect().left ?? 0) + 8);
    let left = r.right - w;
    if (left < minLeft) left = r.left;
    left = Math.min(Math.max(8, left), vw - w - 8);
    let top = r.bottom + gap;
    if (top + h > vh - 8 && r.top - gap - h >= 8) top = r.top - gap - h;
    top = Math.min(Math.max(8, top), vh - h - 8);
    pos = { left, top, ready: true };
  }

  let focusedOnce = false;
  $effect(() => {
    void expanded;
    if (open && menuEl) {
      place();
      if (!focusedOnce) {
        focusedOnce = true;
        // Depois de visível: um elemento escondido não recebe foco.
        requestAnimationFrame(() => menuEl?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
      }
    }
  });

  function onScroll(e: Event) {
    if (open && !(menuEl && menuEl.contains(e.target as Node))) close();
  }

  function close() {
    open = false;
    expanded = null;
    pos = { left: 0, top: 0, ready: false };
    focusedOnce = false;
  }
  function pick(it: MenuItem) {
    if (it.children) {
      expanded = expanded === it.label ? null : it.label;
      return;
    }
    close();
    btn?.focus();
    it.onclick?.();
  }
  function onWindow(e: MouseEvent) {
    if (open && wrap && !wrap.contains(e.target as Node)) close();
  }
  function onkey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      close();
      btn?.focus();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const all = [...(wrap?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
      const i = all.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % all.length : (i - 1 + all.length) % all.length;
      all[next]?.focus();
    }
  }
</script>

<svelte:window onclick={onWindow} onresize={() => open && place()} onscrollcapture={onScroll} />

<div class="mw" bind:this={wrap} onkeydown={onkey} role="presentation">
  <button
    bind:this={btn}
    type="button"
    class="btn icon trigger"
    style="width:{size}px;height:{size}px"
    aria-label={label}
    title={label}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => {
      if (open) close();
      else open = true;
    }}
  >
    <Icon name="more" size={16} />
  </button>
  {#if open}
    <div bind:this={menuEl} class="menu" role="menu" aria-label={label} style="left:{pos.left}px;top:{pos.top}px;visibility:{pos.ready ? 'visible' : 'hidden'}">
      {#each items as it, i (i)}
        {#if it.divider}
          <div class="div" role="separator"></div>
        {:else}
          <button type="button" role="menuitem" class="mi" class:danger={it.danger} disabled={it.disabled} aria-expanded={it.children ? expanded === it.label : undefined} onclick={() => pick(it)}>
            <span>{it.label}</span>
            {#if it.children}<Icon name={expanded === it.label ? 'down' : 'right'} size={14} />{/if}
          </button>
          {#if it.children && expanded === it.label}
            <div class="sub">
              {#each it.children as c, j (j)}
                <button type="button" role="menuitem" class="mi" class:danger={c.danger} disabled={c.disabled} onclick={() => pick(c)}>{c.label}</button>
              {/each}
            </div>
          {/if}
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .mw {
    position: relative;
    display: inline-flex;
    vertical-align: middle;
  }
  .menu {
    position: fixed;
    z-index: 90;
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    min-width: 260px;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    box-shadow: var(--shadow);
    padding: 6px;
    display: flex;
    flex-direction: column;
  }
  .mi {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    border: 0;
    background: transparent;
    border-radius: 6px;
    padding: 8px 10px;
    text-align: left;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
  }
  .mi:hover:not(:disabled),
  .mi:focus-visible {
    background: var(--surface-3);
    outline: none;
  }
  .mi:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .mi.danger {
    color: var(--err-fg);
  }
  .sub {
    display: flex;
    flex-direction: column;
    padding-left: 12px;
    border-left: 2px solid var(--surface-3);
    margin: 2px 0 4px 10px;
  }
  .div {
    height: 1px;
    background: var(--surface-3);
    margin: 4px 0;
  }
</style>
