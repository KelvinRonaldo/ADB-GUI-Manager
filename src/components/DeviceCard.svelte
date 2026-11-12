<script lang="ts">
  import Icon from './Icon.svelte';
  import Menu, { type MenuItem } from './Menu.svelte';
  import { t, lang, type Key } from '../lib/i18n.svelte';
  import { androidLabel, formatBytes, friendlyName, tcpAddress } from '../lib/format';
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

  let { device, lost, first = false }: { device?: Device; lost?: LostDevice; first?: boolean } = $props();

  const serial = $derived(device?.serial ?? lost?.serial ?? '');
  const summary = $derived(app.summaries[serial]);
  const isTarget = $derived(!!device && app.settings.targetSerial === serial && device.stateKind === 'device');
  const conn = $derived(device?.connection ?? 'wifi');
  const kind = $derived(lost ? 'lost' : device!.stateKind);
  let busy = $state(false);

  const battery = $derived.by(() => {
    const b = summary?.battery;
    if (b?.level == null) return '';
    if (b.status === 'charging') return t('devices.batteryCharging', { n: b.level });
    if (b.status === 'full') return t('devices.batteryFull', { n: b.level });
    return t('devices.batteryLevel', { n: b.level });
  });
  const storage = $derived.by(() => {
    const s = summary?.storage;
    if (!s) return '';
    return t('devices.storageUsed', { used: formatBytes(s.usedKb * 1024, lang.current), total: formatBytes(s.totalKb * 1024, lang.current) });
  });
  const keyPath = $derived(app.init?.os === 'windows' ? '%USERPROFILE%\\.android\\adbkey.pub' : '~/.android/adbkey.pub');

  async function doReconnect() {
    busy = true;
    try {
      if (lost) await retryLost(serial);
      else await reconnect(serial);
    } finally {
      busy = false;
    }
  }

  const menu = $derived.by((): MenuItem[] => {
    if (!device) return [];
    const wifi = !!tcpAddress(serial) || serial.includes('._adb-tls-connect.');
    return [
      {
        label: t('menu.reboot'),
        children: [
          { label: t('menu.rebootSystem'), onclick: () => act.rebootDevice(serial) },
          { label: t('menu.rebootBootloader'), onclick: () => act.rebootDevice(serial, 'bootloader') },
          { label: t('menu.rebootRecovery'), onclick: () => act.rebootDevice(serial, 'recovery') },
          { label: t('menu.rebootSideload'), onclick: () => act.rebootDevice(serial, 'sideload') },
          { label: t('menu.rebootFastboot'), onclick: () => act.rebootDevice(serial, 'fastboot') },
        ],
      },
      { label: t('menu.toWifi'), onclick: () => act.toWifi(serial), disabled: wifi },
      { label: t('menu.screenshot'), onclick: () => act.screenshot(serial) },
      { label: t('menu.screenrecord'), onclick: () => act.screenrecord(serial) },
      { label: t('menu.bugreport'), onclick: () => act.bugreport(serial) },
      { label: t('menu.root'), onclick: () => act.adbdRoot(serial, true) },
      { label: t('menu.unroot'), onclick: () => act.adbdRoot(serial, false) },
      { label: t('menu.remount'), onclick: () => act.remount(serial) },
      { divider: true, label: '' },
      { label: t('menu.copySerial'), onclick: () => act.copySerial(serial) },
      ...(wifi ? [{ label: t('menu.disconnect'), danger: true, onclick: () => act.disconnectDevice(serial) }] : []),
    ];
  });

  const iconName = $derived(kind === 'unauthorized' || kind === 'noPermissions' ? 'lock' : kind === 'lost' ? 'wifiOff' : conn === 'wifi' ? 'connect' : 'devices');
  const tone = $derived(
    kind === 'device' ? conn : kind === 'unauthorized' || kind === 'noPermissions' || kind === 'authorizing' || kind === 'connecting' ? 'warn' : ['lost', 'offline'].includes(kind) ? 'err' : 'neutral',
  );
</script>

<article class="card dc tone-{tone}" class:target={isTarget} data-guide={first ? 'devices-card' : undefined}>
  <div class="head">
    <div class="ic {tone}"><Icon name={iconName} size={22} /></div>
    <div class="titles">
      {#if kind === 'unauthorized'}
        <h2>{t('devices.unauthorizedTitle')}</h2>
        <div class="sub">{t('devices.unauthorizedSub')}</div>
      {:else if kind === 'noPermissions'}
        <h2>{t('devices.noPermTitle')}</h2>
        <div class="sub mono">{serial}</div>
      {:else}
        <h2>{lost ? lost.name : friendlyName(device, summary)}</h2>
        <div class="sub">{androidLabel(summary) || serial}</div>
      {/if}
    </div>
    {#if isTarget}<span class="badge">{t('devices.targetBadge')}</span>{/if}
  </div>

  <div class="row chips">
    <span class="chip {conn}">{t(`conn.${conn}` as Key)}</span>
    <span class="chip {kind === 'device' ? 'ok' : tone === 'err' ? 'err' : tone === 'warn' ? 'warn' : 'neutral'}">
      {kind === 'lost' ? t('state.lost') : t(`state.${kind}` as Key)}
    </span>
  </div>

  {#if kind === 'device'}
    <dl>
      <dt>{conn === 'usb' || conn === 'emulator' ? t('devices.serial') : t('devices.address')}</dt>
      <dd class="mono">{serial}</dd>
      {#if summary}
        <dt>{t('devices.battery')}</dt>
        <dd>{battery || '—'}</dd>
        <dt>{t('devices.wifi')}</dt>
        <dd class="mono">{summary.wifiIp ?? t('devices.noWifi')}</dd>
        <dt>{t('devices.storage')}</dt>
        <dd>{storage || '—'}</dd>
      {:else if app.summaryErrors[serial]}
        <dt></dt>
        <dd class="muted">
          {t('devices.readFailed')}
          <button type="button" class="linkbtn" onclick={() => refreshSummary(serial, false)}>{t('common.retry')}</button>
        </dd>
      {:else}
        <dt></dt>
        <dd class="muted">{t('devices.reading')}</dd>
      {/if}
    </dl>
    <div class="row acts" data-guide={first ? 'devices-card-actions' : undefined}>
      <button type="button" class="btn outline" onclick={() => openDetails(serial)}>{t('devices.details')}</button>
      <button
        type="button"
        class="btn"
        onclick={() => {
          setTarget(serial);
          navigate('shell');
        }}>{t('devices.shell')}</button
      >
      <button
        type="button"
        class="btn"
        onclick={() => {
          setTarget(serial);
          app.installRequest = true;
          navigate('apps');
        }}>{t('devices.installApk')}</button
      >
      {#if !isTarget}
        <button type="button" class="btn ghost" onclick={() => setTarget(serial)}>{t('devices.useAsTarget')}</button>
      {/if}
      <Menu items={menu} label={t('devices.more')} />
    </div>
  {:else if kind === 'unauthorized'}
    <p>{t('devices.unauthorizedText')}</p>
    <dl>
      <dt>{t('devices.serial')}</dt>
      <dd class="mono">{serial}</dd>
      <dt>{t('devices.rsaKey')}</dt>
      <dd class="mono">{keyPath}</dd>
    </dl>
    <div class="row acts">
      <button type="button" class="btn danger" onclick={() => refreshAll(false)}>{t('common.retry')}</button>
      <button type="button" class="btn" onclick={() => textDialog(t('devices.noDialog'), t('devices.noDialogHelp'))}>{t('devices.noDialog')}</button>
    </div>
  {:else if kind === 'noPermissions'}
    <p>{t('devices.noPermText')}</p>
    <div class="row acts">
      <button type="button" class="btn primary" onclick={restartServer}>{t('server.restart')}</button>
    </div>
  {:else if kind === 'lost' && lost}
    <p>{t('devices.lostText', { address: serial })}</p>
    <div class="muted small">
      {#if lost.busy}
        {t('act.reconnecting', { name: lost.name })}
      {:else if lost.gaveUp}
        {t('devices.gaveUp', { max: MAX_RETRIES })}
      {:else}
        {t('devices.autoRetry', { s: Math.max(0, Math.ceil((lost.nextAt - clock.now) / 1000)), n: lost.attempts + 1, max: MAX_RETRIES })}
      {/if}
    </div>
    <div class="row acts">
      <button type="button" class="btn primary" disabled={busy || lost.busy} onclick={doReconnect}>{t('devices.reconnectNow')}</button>
      <button type="button" class="btn" onclick={() => navigate('connect')}>{t('devices.pairAgain')}</button>
      <button type="button" class="btn ghost" onclick={() => forgetLost(serial)}>{t('common.forget')}</button>
    </div>
  {:else if kind === 'bootloader' || kind === 'recovery' || kind === 'sideload'}
    <p>{t('devices.modeText', { mode: device?.state ?? kind })}</p>
    <div class="row acts">
      <button type="button" class="btn" onclick={() => act.rebootDevice(serial)}>{t('menu.reboot')} · {t('menu.rebootSystem')}</button>
    </div>
  {:else}
    <p>{t('devices.offlineText')}</p>
    <dl>
      <dt>{t('devices.serial')}</dt>
      <dd class="mono">{serial}</dd>
    </dl>
    <div class="row acts">
      <button type="button" class="btn primary" disabled={busy} onclick={doReconnect}>{t('common.reconnect')}</button>
      <button type="button" class="btn" onclick={() => refreshAll(false)}>{t('common.retry')}</button>
    </div>
  {/if}
</article>

<style>
  .dc {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    position: relative;
  }
  .dc.target {
    border: 2px solid var(--accent);
    padding: 15px;
  }
  .dc.tone-warn {
    border-color: var(--warn-border);
  }
  .dc.tone-err {
    border-color: var(--err-border);
  }
  .head {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .ic {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
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
  .titles {
    flex: 1 1 auto;
    min-width: 0;
  }
  h2 {
    font-size: 16px;
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .sub {
    font-size: 12px;
    color: var(--muted);
  }
  .badge {
    font-size: 11px;
    font-weight: 700;
    color: var(--usb-fg);
    background: var(--usb-bg);
    border-radius: 6px;
    padding: 3px 8px;
  }
  .chips {
    gap: 6px;
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: 92px 1fr;
    row-gap: 6px;
    font-size: 13px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  dd.mono {
    font-size: 12px;
  }
  p {
    margin: 0;
    font-size: 13px;
    line-height: 19px;
  }
  .small {
    font-size: 12px;
  }
  .acts {
    margin-top: auto;
  }
</style>
