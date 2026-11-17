<script lang="ts">
  import TopBar from '../components/TopBar.svelte';
  import DeviceCard from '../components/DeviceCard.svelte';
  import DeviceRow from '../components/DeviceRow.svelte';
  import PageGuideOffer from '../components/PageGuideOffer.svelte';
  import Icon from '../components/Icon.svelte';
  import { t } from '../lib/i18n.svelte';
  import { app, deviceName, hiddenByUsb, listedDevices, navigate, saveSettings } from '../lib/state.svelte';
  import { serialOf } from '../lib/deviceView';
  import type { DevicesView } from '../lib/types';

  let filter = $state<'all' | 'usb' | 'wifi' | 'emulator'>('all');
  let query = $state('');
  const words = $derived(query.trim().toLowerCase().split(/\s+/).filter(Boolean));
  /** Busca por nome, IP e serial (o do adb e o do terminal); cada palavra precisa aparecer. */
  function matches(serial: string): boolean {
    if (!words.length) return true;
    const s = app.summaries[serial];
    const hay = [deviceName(serial), serial, serialOf(serial), s?.wifiIp].filter(Boolean).join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  }
  // Ligado por USB e Wi-Fi ao mesmo tempo: só o USB aparece; o Wi-Fi volta quando o cabo sai.
  const listed = $derived(listedDevices().filter((d) => matches(d.serial)));
  const counts = $derived({
    all: listed.length,
    usb: listed.filter((d) => d.connection === 'usb').length,
    wifi: listed.filter((d) => d.connection === 'wifi').length,
    emulator: listed.filter((d) => d.connection === 'emulator').length,
  });
  const shown = $derived(listed.filter((d) => filter === 'all' || d.connection === filter));
  const lost = $derived(
    Object.values(app.lost).filter(
      (l) => !app.devices.some((d) => d.serial === l.serial) && !hiddenByUsb(l.serial) && (filter === 'all' || filter === 'wifi') && matches(l.serial),
    ),
  );
  // Entradas Wi-Fi ocultas porque o mesmo aparelho está no USB: avisa em vez de parecer que sumiram.
  const hiddenWifi = $derived(app.devices.filter((d) => d.connection === 'wifi' && hiddenByUsb(d.serial)));
  const showHidden = $derived(hiddenWifi.length > 0 && (filter === 'all' || filter === 'wifi') && !words.length);
  const anyDevice = $derived(app.devices.length > 0 || Object.keys(app.lost).length > 0);
  const hiddenTitle = $derived(
    hiddenWifi.length === 1 ? t('devices.hiddenWifiOne', { name: deviceName(hiddenWifi[0].serial) }) : t('devices.hiddenWifiMany', { n: hiddenWifi.length }),
  );
  const hiddenText = $derived(t(hiddenWifi.length === 1 ? 'devices.hiddenWifiTextOne' : 'devices.hiddenWifiTextMany'));
  const labels = { all: 'devices.all', usb: 'conn.usb', wifi: 'conn.wifi', emulator: 'conn.emulator' } as const;

  const VIEWS = [
    { id: 'grid', icon: 'viewGrid', label: 'devices.viewGrid' },
    { id: 'list', icon: 'viewList', label: 'devices.viewList' },
    { id: 'compact', icon: 'viewCompact', label: 'devices.viewCompact' },
  ] as const;
  const view = $derived<DevicesView>(app.settings.devicesView ?? 'grid');
  function setView(v: DevicesView) {
    if (app.settings.devicesView === v) return;
    app.settings.devicesView = v;
    saveSettings();
  }
</script>

<div class="page">
  <TopBar heading={t('devices.title')} sub={t('devices.subtitle', { n: listed.length })} />
  <div class="page-body">
    <PageGuideOffer page="devices" />
    <div class="row">
      <div class="seg" role="group" aria-label={t('devices.filterLabel')} data-guide="devices-filters">
        {#each ['all', 'usb', 'wifi', 'emulator'] as const as f (f)}
          <button type="button" aria-pressed={filter === f} onclick={() => (filter = f)}>{t(labels[f])} {counts[f]}</button>
        {/each}
      </div>
      <label class="search" data-guide="devices-search">
        <Icon name="search" size={15} />
        <input
          type="search"
          placeholder={t('devices.searchPh')}
          aria-label={t('devices.searchLabel')}
          bind:value={query}
          onkeydown={(e) => {
            if (e.key === 'Escape') query = '';
          }}
        />
      </label>
      <div class="spacer"></div>
      <div class="seg views" role="radiogroup" aria-label={t('devices.viewLabel')} data-guide="devices-view">
        {#each VIEWS as v (v.id)}
          <button type="button" role="radio" aria-checked={view === v.id} title={t(v.label)} onclick={() => setView(v.id)}>
            <Icon name={v.icon} size={15} />
            <span>{t(v.label)}</span>
          </button>
        {/each}
      </div>
      {#if view !== 'compact'}
        <label class="check"><input type="checkbox" bind:checked={app.autoRefresh} /> {t('devices.autoRefresh')}</label>
      {/if}
      <button type="button" class="btn primary" data-guide="devices-connect" onclick={() => navigate('connect')}>
        <Icon name="plus" size={16} stroke={2} />
        {t('devices.connect')}
      </button>
    </div>

    {#if shown.length || lost.length}
      {#if showHidden}
        <div class="hidden-note" role="note">
          <Icon name="connect" size={16} />
          <span><strong>{hiddenTitle}</strong> — {hiddenText}</span>
        </div>
      {/if}
      {#if view === 'grid'}
        <div class="grid" data-guide="tour-devices">
          {#each shown as d, i (d.serial)}
            <DeviceCard device={d} first={i === 0} />
          {/each}
          {#each lost as l (l.serial)}
            <DeviceCard lost={l} />
          {/each}
        </div>
      {:else}
        <div class="dlist-wrap">
          <div class="dlist card {view}" role="table" aria-label={t('devices.title')} data-guide="tour-devices">
            {#if view === 'list'}
              <div class="dhead" role="row">
                <span></span>
                <span role="columnheader">{t('devices.colDevice')}</span>
                <span role="columnheader">{t('devices.colConn')}</span>
                <span role="columnheader">{t('devices.colId')}</span>
                <span role="columnheader" class="h-bat">{t('devices.battery')}</span>
                <span role="columnheader" class="h-ip">{t('devices.colWifi')}</span>
                <span role="columnheader" class="h-sto">{t('devices.storage')}</span>
                <span></span>
              </div>
            {/if}
            {#each shown as d, i (d.serial)}
              <DeviceRow device={d} variant={view} first={i === 0} />
            {/each}
            {#each lost as l (l.serial)}
              <DeviceRow lost={l} variant={view} />
            {/each}
          </div>
        </div>
      {/if}
      <button type="button" class="add" onclick={() => navigate('connect')}>
        <Icon name="plus" size={18} stroke={2} />
        {t('devices.addHint')}
      </button>
    {:else if words.length && anyDevice}
      <div class="card empty">
        <Icon name="search" size={40} stroke={1.4} />
        <h2>{t('devices.searchEmpty', { q: query.trim() })}</h2>
        <p>{t('devices.searchEmptyText')}</p>
        <button type="button" class="btn" onclick={() => (query = '')}>{t('devices.searchClear')}</button>
      </div>
    {:else if showHidden}
      <div class="card empty" data-guide="tour-devices">
        <Icon name="connect" size={40} stroke={1.4} />
        <h2>{hiddenTitle}</h2>
        <p>{hiddenText.charAt(0).toUpperCase() + hiddenText.slice(1)}</p>
        <button type="button" class="btn" onclick={() => (filter = 'usb')}>{t('devices.hiddenWifiShowUsb')}</button>
      </div>
    {:else}
      <div class="card empty" data-guide="tour-devices">
        <Icon name="devices" size={40} stroke={1.4} />
        <h2>{t('devices.emptyTitle')}</h2>
        <p>{t('devices.emptyText')}</p>
        <button type="button" class="btn primary" onclick={() => navigate('connect')}>{t('devices.connect')}</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .views button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 11px;
    cursor: pointer;
  }
  .views button[aria-checked='true'] {
    background: var(--text);
    color: var(--bg);
    font-weight: 600;
  }
  .dlist-wrap {
    container: dlist / inline-size;
  }
  .dlist {
    overflow: hidden;
  }
  .dlist.list {
    --cols: 32px minmax(150px, 1fr) 112px minmax(110px, 150px) 100px 108px 104px 180px;
  }
  .dlist.compact {
    --cols: 10px minmax(120px, 1.5fr) 72px minmax(0, 1fr) minmax(0, 1.5fr) 190px;
  }
  .dlist :global(.drow:first-child) {
    border-top: 0;
  }
  .dhead {
    display: grid;
    grid-template-columns: var(--cols);
    gap: 10px;
    align-items: center;
    padding: 9px 14px;
    background: var(--surface-2);
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 16px;
    align-items: stretch;
  }
  .spacer {
    flex: 1 1 auto;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 1 260px;
    min-width: 160px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 0 10px;
    color: var(--muted);
  }
  .search:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 13px;
    padding: 7px 0;
    outline: none;
  }
  .add {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 60px;
    border: 2px dashed var(--border-strong);
    border-radius: 12px;
    background: transparent;
    color: var(--muted);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }
  .add:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .hidden-note {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
    padding: 10px 14px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--muted);
    font-size: 13px;
  }
  .hidden-note strong {
    color: var(--text);
    font-weight: 600;
  }
  .empty h2 {
    font-size: 17px;
    color: var(--text);
  }
  .empty p {
    margin: 0;
  }

  /* Janela pequena: o seletor fica só com os ícones (o nome aparece ao parar o mouse). */
  @media (max-width: 1180px) {
    .views span {
      display: none;
    }
    .views button {
      padding: 7px 10px;
    }
  }

  /* Depois das regras base: em janela estreita a lista perde colunas (mesmos cortes da DeviceRow). */
  @container dlist (max-width: 940px) {
    .dlist.list {
      --cols: 32px minmax(150px, 1fr) 112px minmax(110px, 150px) 100px 108px 180px;
    }
    .h-sto {
      display: none;
    }
  }
  @container dlist (max-width: 820px) {
    .dlist.list {
      --cols: 32px minmax(140px, 1fr) 112px minmax(100px, 150px) 100px 180px;
    }
    .h-ip {
      display: none;
    }
  }
  @container dlist (max-width: 560px) {
    .dlist.compact {
      --cols: 10px minmax(100px, 1fr) 72px minmax(0, 1fr) 190px;
    }
  }
</style>
