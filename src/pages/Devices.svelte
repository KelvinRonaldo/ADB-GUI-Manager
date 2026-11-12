<script lang="ts">
  import TopBar from '../components/TopBar.svelte';
  import DeviceCard from '../components/DeviceCard.svelte';
  import PageGuideOffer from '../components/PageGuideOffer.svelte';
  import Icon from '../components/Icon.svelte';
  import { t } from '../lib/i18n.svelte';
  import { app, navigate } from '../lib/state.svelte';

  let filter = $state<'all' | 'usb' | 'wifi' | 'emulator'>('all');
  const counts = $derived({
    all: app.devices.length,
    usb: app.devices.filter((d) => d.connection === 'usb').length,
    wifi: app.devices.filter((d) => d.connection === 'wifi').length,
    emulator: app.devices.filter((d) => d.connection === 'emulator').length,
  });
  const shown = $derived(app.devices.filter((d) => filter === 'all' || d.connection === filter));
  const lost = $derived(Object.values(app.lost).filter((l) => !app.devices.some((d) => d.serial === l.serial) && (filter === 'all' || filter === 'wifi')));
  const labels = { all: 'devices.all', usb: 'conn.usb', wifi: 'conn.wifi', emulator: 'conn.emulator' } as const;
</script>

<div class="page">
  <TopBar heading={t('devices.title')} sub={t('devices.subtitle', { n: app.devices.length })} />
  <div class="page-body">
    <PageGuideOffer page="devices" />
    <div class="row">
      <div class="seg" role="group" aria-label={t('devices.filterLabel')} data-guide="devices-filters">
        {#each ['all', 'usb', 'wifi', 'emulator'] as const as f (f)}
          <button type="button" aria-pressed={filter === f} onclick={() => (filter = f)}>{t(labels[f])} {counts[f]}</button>
        {/each}
      </div>
      <div class="spacer"></div>
      <label class="check"><input type="checkbox" bind:checked={app.autoRefresh} /> {t('devices.autoRefresh')}</label>
      <button type="button" class="btn primary" data-guide="devices-connect" onclick={() => navigate('connect')}>
        <Icon name="plus" size={16} stroke={2} />
        {t('devices.connect')}
      </button>
    </div>

    {#if shown.length || lost.length}
      <div class="grid" data-guide="tour-devices">
        {#each shown as d, i (d.serial)}
          <DeviceCard device={d} first={i === 0} />
        {/each}
        {#each lost as l (l.serial)}
          <DeviceCard lost={l} />
        {/each}
      </div>
      <button type="button" class="add" onclick={() => navigate('connect')}>
        <Icon name="plus" size={18} stroke={2} />
        {t('devices.addHint')}
      </button>
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
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 16px;
    align-items: stretch;
  }
  .spacer {
    flex: 1 1 auto;
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
  .empty h2 {
    font-size: 17px;
    color: var(--text);
  }
  .empty p {
    margin: 0;
  }
</style>
