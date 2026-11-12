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

  function close() {
    open = false;
    expanded = null;
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

<svelte:window onclick={onWindow} />

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
      open = !open;
      if (open) queueMicrotask(() => wrap?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    }}
  >
    <Icon name="more" size={16} />
  </button>
  {#if open}
    <div class="menu" role="menu" aria-label={label}>
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
  }
  .menu {
    position: absolute;
    z-index: 40;
    top: calc(100% + 6px);
    right: 0;
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
