<script lang="ts">
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte';
  import { app, deviceName, refreshAll, setTarget, startPageGuide } from '../lib/state.svelte';
  import { PAGE_GUIDES } from '../lib/guides';

  let { heading, sub = '' }: { heading: string; sub?: string } = $props();
  let open = $state(false);
  let refreshing = $state(false);
  let btn: HTMLButtonElement | undefined = $state();

  const current = $derived(app.devices.find((d) => d.serial === app.settings.targetSerial));

  async function refresh() {
    refreshing = true;
    try {
      await refreshAll(false);
    } finally {
      refreshing = false;
    }
  }

  function pick(serial: string) {
    setTarget(serial);
    open = false;
    btn?.focus();
  }

  function onWindowClick(e: MouseEvent) {
    if (open && !(e.target as HTMLElement).closest('.target-wrap')) open = false;
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<header class="top">
  <div class="titles">
    <h1>{heading}</h1>
    {#if sub}<div class="sub">{sub}</div>{/if}
  </div>
  <div class="actions">
    <span class="lbl" id="alvo-lbl">{t('top.target')}</span>
    <div class="target-wrap" data-guide="tour-target">
      <button
        bind:this={btn}
        type="button"
        class="target"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby="alvo-lbl"
        onclick={() => (open = !open)}
      >
        {#if current}
          <span class="dot" class:off={current.stateKind !== 'device'}></span>
          <span class="name">{deviceName(current.serial)}</span>
          <span class="chip {current.connection} mini">{t(`conn.${current.connection}`)}</span>
          <span class="mono serial">{current.serial}</span>
        {:else}
          <span class="muted">{app.devices.length ? t('common.noTarget') : t('top.noDevices')}</span>
        {/if}
        <Icon name="down" size={14} />
      </button>
      {#if open}
        <ul class="menu" role="listbox" aria-labelledby="alvo-lbl">
          {#each app.devices as d (d.serial)}
            <li role="option" aria-selected={d.serial === app.settings.targetSerial}>
              <button type="button" disabled={d.stateKind !== 'device'} onclick={() => pick(d.serial)}>
                <span class="dot" class:off={d.stateKind !== 'device'}></span>
                <span class="name">{deviceName(d.serial)}</span>
                <span class="chip {d.connection} mini">{t(`conn.${d.connection}`)}</span>
                <span class="mono serial">{d.serial}</span>
                {#if d.stateKind !== 'device'}<span class="chip warn mini">{d.state}</span>{/if}
              </button>
            </li>
          {:else}
            <li class="none">{t('top.noDevices')}</li>
          {/each}
        </ul>
      {/if}
    </div>
    <button type="button" class="btn icon" aria-label={t('top.refresh')} title={t('top.refresh')} onclick={refresh} disabled={refreshing}>
      <Icon name="refresh" size={16} class={refreshing ? 'spin' : ''} />
    </button>
    {#if PAGE_GUIDES[app.page]?.length}
      <button type="button" class="btn icon" aria-label={t('common.help')} title={t('common.help')} onclick={() => startPageGuide()}>
        <Icon name="help" size={16} />
      </button>
    {/if}
  </div>
</header>

<style>
  .top {
    container-type: inline-size;
    min-height: 64px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
    padding: 10px 24px;
    flex: 0 0 auto;
  }
  .titles {
    flex: 1 1 220px;
    min-width: 0;
  }
  @container (max-width: 860px) {
    .target .serial,
    .lbl {
      display: none;
    }
    .target {
      max-width: 280px;
    }
  }
  h1 {
    font-size: 18px;
    font-weight: 700;
    line-height: 22px;
  }
  .sub {
    font-size: 12px;
    color: var(--muted);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .lbl {
    font-size: 12px;
    color: var(--muted);
    font-weight: 600;
  }
  .target-wrap {
    position: relative;
  }
  .target {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 12px;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: var(--surface);
    cursor: pointer;
    max-width: 420px;
  }
  .name {
    font-weight: 500;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .serial {
    font-size: 12px;
    color: var(--muted);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 4px;
    background: #16a34a;
    flex: 0 0 auto;
  }
  .dot.off {
    background: #d97706;
  }
  .mini {
    font-size: 11px;
    padding: 2px 7px;
    border-radius: 6px;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 30;
    list-style: none;
    margin: 0;
    padding: 6px;
    min-width: 360px;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    box-shadow: var(--shadow);
  }
  .menu button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    border: 0;
    background: transparent;
    padding: 9px 10px;
    border-radius: 7px;
    cursor: pointer;
    text-align: left;
  }
  .menu button:hover:not(:disabled) {
    background: var(--surface-3);
  }
  .menu button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .menu [aria-selected='true'] button {
    background: var(--accent-soft);
  }
  .none {
    padding: 10px;
    color: var(--muted);
    font-size: 13px;
  }
</style>
