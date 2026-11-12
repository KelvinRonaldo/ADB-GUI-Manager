<script lang="ts">
  // Uma linha da lista de aparelhos. "list" tem os mesmos dados do cartão em colunas;
  // "compact" só o essencial (estado, nome, conexão, serial) e o aviso quando não está pronto.
  import Icon from './Icon.svelte';
  import Menu, { type MenuItem } from './Menu.svelte';
  import { t, type Key } from '../lib/i18n.svelte';
  import { androidLabel, friendlyName } from '../lib/format';
  import {
    batteryText,
    deviceMenu,
    iconOf,
    openInstall,
    openShell,
    stateChip,
    storageText,
    toneOf,
    type ViewKind,
  } from '../lib/deviceView';
  import {
    app,
    clock,
    MAX_RETRIES,
    forgetLost,
    navigate,
    openDetails,
    reconnect,
    refreshAll,
    refreshSummary,
    restartServer,
    retryLost,
    setTarget,
    textDialog,
    type LostDevice,
  } from '../lib/state.svelte';
  import * as act from '../lib/actions';
  import type { Device } from '../lib/types';

  let {
    device,
    lost,
    variant,
    first = false,
  }: { device?: Device; lost?: LostDevice; variant: 'list' | 'compact'; first?: boolean } = $props();

  const serial = $derived(device?.serial ?? lost?.serial ?? '');
  const summary = $derived(app.summaries[serial]);
  const isTarget = $derived(!!device && app.settings.targetSerial === serial && device.stateKind === 'device');
  const conn = $derived(device?.connection ?? 'wifi');
  const kind = $derived<ViewKind>(lost ? 'lost' : device!.stateKind);
  const tone = $derived(toneOf(kind, conn));
  const ready = $derived(kind === 'device');
  let busy = $state(false);

  const name = $derived(
    kind === 'unauthorized'
      ? t('devices.unauthorizedTitle')
      : kind === 'noPermissions'
        ? t('devices.noPermTitle')
        : lost
          ? lost.name
          : friendlyName(device, summary),
  );
  const sub = $derived(kind === 'unauthorized' ? t('devices.unauthorizedSub') : androidLabel(summary));
  const stateLabel = $derived(kind === 'lost' ? t('state.lost') : t(`state.${kind}` as Key));

  /** Aviso de uma linha para quem não está pronto. */
  const message = $derived.by(() => {
    switch (kind) {
      case 'device':
        return '';
      case 'unauthorized':
        return t('devices.msgUnauthorized');
      case 'noPermissions':
        return t('devices.msgNoPerm');
      case 'lost':
        if (!lost) return '';
        if (lost.busy) return t('act.reconnecting', { name: lost.name });
        if (lost.gaveUp) return t('devices.gaveUp', { max: MAX_RETRIES });
        return t('devices.autoRetry', {
          s: Math.max(0, Math.ceil((lost.nextAt - clock.now) / 1000)),
          n: lost.attempts + 1,
          max: MAX_RETRIES,
        });
      case 'bootloader':
      case 'recovery':
      case 'sideload':
        return t('devices.msgMode', { mode: device?.state ?? kind });
      default:
        return t('devices.msgOffline');
    }
  });

  async function doReconnect() {
    busy = true;
    try {
      if (lost) await retryLost(serial);
      else await reconnect(serial);
    } finally {
      busy = false;
    }
  }

  /** Ação principal de quem não está pronto: a mesma do cartão. */
  const primary = $derived.by((): { label: string; cls: string; run: () => void } | null => {
    switch (kind) {
      case 'device':
        return null;
      case 'unauthorized':
        return { label: t('common.retry'), cls: 'danger', run: () => refreshAll(false) };
      case 'noPermissions':
        return { label: t('server.restart'), cls: 'primary', run: restartServer };
      case 'lost':
        return { label: t('devices.reconnectNow'), cls: 'primary', run: doReconnect };
      case 'bootloader':
      case 'recovery':
      case 'sideload':
        return { label: `${t('menu.reboot')} · ${t('menu.rebootSystem')}`, cls: '', run: () => act.rebootDevice(serial) };
      default:
        return { label: t('common.reconnect'), cls: 'primary', run: doReconnect };
    }
  });

  /** O que no cartão é botão e na linha não cabe vai para o ⋯. */
  const menu = $derived.by((): MenuItem[] => {
    switch (kind) {
      case 'device': {
        const lead: MenuItem[] = [];
        if (!isTarget) lead.push({ label: t('devices.useAsTarget'), onclick: () => setTarget(serial) });
        if (variant === 'compact') {
          lead.push({ label: t('devices.shell'), onclick: () => openShell(serial) });
          lead.push({ label: t('devices.installApk'), onclick: () => openInstall(serial) });
        }
        return deviceMenu(serial, lead);
      }
      case 'unauthorized':
        return [
          { label: t('devices.noDialog'), onclick: () => textDialog(t('devices.noDialog'), t('devices.noDialogHelp')) },
          { label: t('menu.copySerial'), onclick: () => act.copySerial(serial) },
        ];
      case 'noPermissions':
        return [
          { label: t('devices.howToFix'), onclick: () => textDialog(t('devices.noPermTitle'), t('devices.noPermText')) },
          { label: t('menu.copySerial'), onclick: () => act.copySerial(serial) },
        ];
      case 'lost':
        return [
          { label: t('devices.pairAgain'), onclick: () => navigate('connect') },
          { label: t('common.forget'), onclick: () => forgetLost(serial) },
        ];
      default:
        return [
          { label: t('common.retry'), onclick: () => refreshAll(false) },
          { label: t('menu.copySerial'), onclick: () => act.copySerial(serial) },
        ];
    }
  });
</script>

<div
  class="drow {variant} tone-{tone}"
  class:target={isTarget}
  role="row"
  data-guide={first ? 'devices-card' : undefined}
>
  {#if variant === 'compact'}
    <span class="dot {stateChip(kind, tone)}" role="img" aria-label={stateLabel} title={stateLabel}></span>
  {:else}
    <div class="ic {tone}" aria-hidden="true"><Icon name={iconOf(kind, conn)} size={17} /></div>
  {/if}

  <div class="name" role="cell">
    <div class="line">
      {#if ready}
        <button type="button" class="nm link" title={t('devices.details')} onclick={() => openDetails(serial)}>{name}</button>
      {:else}
        <span class="nm" title={name}>{name}</span>
      {/if}
      {#if isTarget}<span class="badge">{t('devices.targetBadge')}</span>{/if}
    </div>
    {#if variant === 'list' && (sub || !ready)}
      <div class="sub" title={sub}>{sub || serial}</div>
    {/if}
  </div>

  <div class="conn" role="cell">
    <span class="chip sm {conn}">{t(`conn.${conn}` as Key)}</span>
    {#if variant === 'list'}<span class="chip sm {stateChip(kind, tone)}">{stateLabel}</span>{/if}
  </div>

  <div class="id mono" role="cell" title={serial}>{serial}</div>

  {#if variant === 'list'}
    {#if ready && summary}
      <div class="c-bat" role="cell">{batteryText(summary) || '—'}</div>
      <div class="c-ip mono" role="cell" class:muted={!summary.wifiIp}>{summary.wifiIp ?? t('devices.noWifi')}</div>
      <div class="c-sto" role="cell">{storageText(summary, true) || '—'}</div>
    {:else if ready && app.summaryErrors[serial]}
      <div class="msg muted" role="cell">
        {t('devices.readFailed')}
        <button type="button" class="linkbtn" onclick={() => refreshSummary(serial, false)}>{t('common.retry')}</button>
      </div>
    {:else if ready}
      <div class="msg muted" role="cell">{t('devices.reading')}</div>
    {:else}
      <div class="msg {tone}" role="cell" title={message}>{message}</div>
    {/if}
  {:else}
    <div class="msg {tone}" role="cell" title={message ? `${stateLabel} · ${message}` : ''}>
      {#if message}{stateLabel} · {message}{/if}
    </div>
  {/if}

  <div class="acts" role="cell" data-guide={first ? 'devices-card-actions' : undefined}>
    {#if ready && variant === 'list'}
      <button type="button" class="btn sm outline" onclick={() => openDetails(serial)}>{t('devices.details')}</button>
      <button type="button" class="btn sm icon" title={t('devices.shell')} aria-label={t('devices.shell')} onclick={() => openShell(serial)}>
        <Icon name="shell" size={15} />
      </button>
      <button type="button" class="btn sm icon" title={t('devices.installApk')} aria-label={t('devices.installApk')} onclick={() => openInstall(serial)}>
        <Icon name="download" size={15} />
      </button>
    {:else if ready}
      <button type="button" class="linkbtn det" onclick={() => openDetails(serial)}>{t('devices.details')}</button>
    {:else if primary}
      <button type="button" class="btn sm {primary.cls}" disabled={busy || !!lost?.busy} onclick={primary.run}>{primary.label}</button>
    {/if}
    <Menu items={menu} label={t('devices.more')} size={30} />
  </div>
</div>

<style>
  .drow {
    display: grid;
    grid-template-columns: var(--cols);
    gap: 10px;
    align-items: center;
    padding: 9px 14px;
    border-top: 1px solid var(--surface-3);
    background: var(--surface);
    min-width: 0;
  }
  .drow.compact {
    padding: 0 12px 0 14px;
    min-height: 44px;
  }
  .drow.target {
    background: var(--accent-soft);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .drow > * {
    min-width: 0;
  }
  .ic {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--usb-bg);
    color: var(--usb-fg);
  }
  .ic.wifi {
    background: var(--wifi-bg);
    color: var(--wifi-fg);
  }
  .ic.emulator {
    background: var(--emu-bg);
    color: var(--emu-fg);
  }
  .ic.warn {
    background: var(--warn-bg);
    color: var(--warn-fg);
  }
  .ic.err {
    background: var(--err-bg);
    color: var(--err-fg);
  }
  .ic.neutral {
    background: var(--surface-3);
    color: var(--muted);
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--muted);
  }
  .dot.ok {
    background: #16a34a;
  }
  .dot.warn {
    background: #d97706;
  }
  .dot.err {
    background: #dc2626;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .nm {
    font-size: 14px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .compact .nm {
    font-weight: 600;
  }
  .nm.link {
    border: 0;
    background: transparent;
    padding: 0;
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }
  .nm.link:hover {
    color: var(--accent);
    text-decoration: underline;
  }
  .badge {
    flex: 0 0 auto;
    font-size: 10.5px;
    font-weight: 700;
    color: var(--usb-fg);
    background: var(--usb-bg);
    border-radius: 6px;
    padding: 2px 6px;
  }
  .sub {
    font-size: 11.5px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .conn {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip.sm {
    font-size: 11px;
    padding: 2px 8px;
  }
  .id {
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .c-bat,
  .c-sto {
    font-size: 13px;
  }
  .c-ip {
    font-size: 12px;
  }
  .msg {
    grid-column: span 3;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .compact .msg {
    grid-column: auto;
    font-size: 12.5px;
  }
  .msg.warn {
    color: var(--warn-fg);
  }
  .msg.err {
    color: var(--err-fg);
  }
  .acts {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
  }
  .det {
    padding: 0 6px;
    font-size: 13px;
  }

  /* Janela estreita: somem primeiro armazenamento e IP; na simplificada, o serial. */
  @container dlist (max-width: 940px) {
    .list .c-sto {
      display: none;
    }
    .list .msg {
      grid-column: span 2;
    }
  }
  @container dlist (max-width: 820px) {
    .list .c-ip {
      display: none;
    }
    .list .msg {
      grid-column: span 1;
    }
  }
  @container dlist (max-width: 560px) {
    .compact .id {
      display: none;
    }
  }
</style>
