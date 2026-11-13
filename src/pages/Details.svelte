<script lang="ts">
  import TopBar from '../components/TopBar.svelte';
  import PageGuideOffer from '../components/PageGuideOffer.svelte';
  import ErrorState from '../components/ErrorState.svelte';
  import Menu from '../components/Menu.svelte';
  import Icon from '../components/Icon.svelte';
  import { t, lang, type Key } from '../lib/i18n.svelte';
  import { api, copyText, pickSavePath } from '../lib/ipc';
  import { classify, type AdbError } from '../lib/errors';
  import { androidLabel, formatBytes, friendlyName } from '../lib/format';
  import { app, findDevice, navigate, refreshSummary, setTarget, toast } from '../lib/state.svelte';
  import * as act from '../lib/actions';
  import { serialOf } from '../lib/deviceView';

  type Tab = 'summary' | 'props' | 'battery' | 'network' | 'storage' | 'screen' | 'processes' | 'raw';
  const TABS: Tab[] = ['summary', 'props', 'battery', 'network', 'storage', 'screen', 'processes', 'raw'];
  const CMDS: Partial<Record<Tab, string>> = {
    battery: 'dumpsys battery',
    network: 'ip addr',
    storage: 'df -h',
    screen: 'wm size; wm density',
    processes: 'ps -A -o PID,PPID,USER,RSS,NAME 2>/dev/null || ps',
  };

  const serial = $derived(app.detailsSerial || app.settings.targetSerial);
  const device = $derived(findDevice(serial));
  const summary = $derived(app.summaries[serial]);
  let tab = $state<Tab>('summary');
  let outputs = $state<Record<string, { text: string; loading: boolean; error: AdbError | null }>>({});
  let verbose = $state<string[]>([]);
  let filter = $state('');
  let propFilter = $state('');

  function addVerbose(cmd: string, text: string) {
    verbose.push(`$ ${cmd}\n${text.trimEnd()}\n`);
  }

  let loadedFor = '';
  $effect(() => {
    if (!device || device.stateKind !== 'device' || loadedFor === serial) return;
    loadedFor = serial;
    outputs = {};
    verbose = [];
    tab = 'summary';
    loadSummary();
  });

  async function loadSummary() {
    await refreshSummary(serial, false);
    const s = app.summaries[serial];
    const line = [serial, device?.state, device?.usb ? `usb:${device.usb}` : '', device?.product ? `product:${device.product}` : '', device?.model ? `model:${device.model}` : '', device?.transportId ? `transport_id:${device.transportId}` : '']
      .filter(Boolean)
      .join(' ');
    addVerbose('adb devices -l', line);
    if (s) addVerbose(s.result.cmd || `adb -s ${serial} shell getprop`, s.raw);
  }

  async function runTab(which: Tab, force = false) {
    const cmd = CMDS[which];
    if (!cmd || (outputs[which] && !force)) return;
    outputs[which] = { text: '', loading: true, error: null };
    try {
      const r = await api.run(['shell', cmd], { serial, timeoutMs: 30000 });
      const err = classify(r);
      outputs[which] = { text: r.stdout || r.stderr, loading: false, error: err };
      addVerbose(r.cmd, r.stdout + r.stderr);
    } catch (e) {
      outputs[which] = { text: '', loading: false, error: classify(String(e)) };
    }
  }

  $effect(() => {
    if (device?.stateKind === 'device') runTab(tab);
  });

  const p = $derived(summary?.props ?? {});
  const blocks = $derived.by(() => {
    const b = summary?.battery;
    const st = summary?.storage;
    return [
      {
        title: 'details.sec.identification',
        items: [
          ['details.f.manufacturer', p['ro.product.manufacturer']],
          ['details.f.model', p['ro.product.model']],
          ['details.f.serial', serialOf(serial, summary) ?? ''],
          ['details.f.adbId', serial],
          ['details.f.product', p['ro.product.name'] || device?.product],
        ],
      },
      {
        title: 'details.sec.system',
        items: [
          ['details.f.android', p['ro.build.version.release'] ? `${p['ro.build.version.release']} · API ${p['ro.build.version.sdk']}` : ''],
          ['details.f.build', p['ro.build.display.id']],
          ['details.f.patch', p['ro.build.version.security_patch']],
          ['details.f.root', p['ro.debuggable'] === '1' ? t('details.f.rootYes') : p['ro.debuggable'] ? t('details.f.rootNo') : ''],
        ],
      },
      {
        title: 'details.sec.hardware',
        items: [
          ['details.f.abi', (p['ro.product.cpu.abilist'] || p['ro.product.cpu.abi'] || '').replace(/,/g, ', ')],
          ['details.f.density', p['ro.sf.lcd_density'] ? `${p['ro.sf.lcd_density']} dpi` : ''],
          ['details.f.battery', b?.level != null ? `${b.level}%${b.voltageMv ? ` · ${(b.voltageMv / 1000).toFixed(2)} V` : ''}${b.temperatureC != null ? ` · ${b.temperatureC} °C` : ''}` : ''],
          ['details.f.storage', st ? t('details.storageFree', { free: formatBytes(st.availKb * 1024, lang.current), total: formatBytes(st.totalKb * 1024, lang.current) }) : ''],
        ],
      },
      {
        title: 'details.sec.connection',
        items: [
          ['details.f.transport', [device?.connection?.toUpperCase(), device?.usb ? `usb:${device.usb}` : '', device?.transportId ? `id ${device.transportId}` : ''].filter(Boolean).join(' · ')],
          ['details.f.wifi', summary?.wifiIp ?? t('devices.noWifi')],
          ['details.f.state', device?.state],
        ],
      },
    ] as { title: Key; items: [Key, string | null | undefined][] }[];
  });
  const propList = $derived(
    Object.entries(p).filter(([k, v]) => !propFilter || k.toLowerCase().includes(propFilter.toLowerCase()) || v.toLowerCase().includes(propFilter.toLowerCase())),
  );
  const verboseText = $derived.by(() => {
    const all = verbose.join('\n');
    if (!filter.trim()) return all;
    const f = filter.toLowerCase();
    return all
      .split('\n')
      .filter((l) => l.startsWith('$ ') || l.toLowerCase().includes(f))
      .join('\n');
  });

  async function exportTxt() {
    const path = await pickSavePath(`${friendlyName(device, summary).replace(/\W+/g, '_')}-detalhes.txt`, [{ name: 'Texto', extensions: ['txt'] }]);
    if (!path) return;
    await api.writeTextFile(path, verbose.join('\n'));
    toast(t('details.exported', { path }), 'success');
  }

  const rebootItems = $derived([
    { label: t('menu.rebootSystem'), onclick: () => act.rebootDevice(serial) },
    { label: t('menu.rebootBootloader'), onclick: () => act.rebootDevice(serial, 'bootloader') },
    { label: t('menu.rebootRecovery'), onclick: () => act.rebootDevice(serial, 'recovery') },
    { label: t('menu.rebootSideload'), onclick: () => act.rebootDevice(serial, 'sideload') },
    { label: t('menu.rebootFastboot'), onclick: () => act.rebootDevice(serial, 'fastboot') },
  ]);
  const tabLabel = (x: Tab) => (x === 'props' ? t('details.tab.props', { n: Object.keys(p).length }) : t(`details.tab.${x}` as Key));
</script>

<div class="page">
  <TopBar heading={device ? friendlyName(device, summary) : t('nav.devices')} sub={device ? [serialOf(serial, summary) ?? serial, device.connection.toUpperCase(), androidLabel(summary)].filter(Boolean).join(' · ') : ''} />
  <div class="page-body">
    <PageGuideOffer page="details" />
    <div class="row">
      <button type="button" class="linkbtn" onclick={() => navigate('devices')}><Icon name="left" size={14} />{t('details.back')}</button>
      <div class="spacer"></div>
      {#if device?.stateKind === 'device'}
        <div class="row" data-guide="details-actions">
          <span class="reboot"><span class="muted small">{t('details.reboot')}</span><Menu items={rebootItems} label={t('details.reboot')} size={34} /></span>
          <button type="button" class="btn" onclick={() => act.screenshot(serial)}>{t('menu.screenshot')}</button>
          {#if device.connection === 'usb'}<button type="button" class="btn" onclick={() => act.toWifi(serial)}>{t('connect.usbButton')}</button>{/if}
          <button
            type="button"
            class="btn"
            onclick={() => {
              setTarget(serial);
              navigate('logcat');
            }}>{t('nav.logcat')}</button
          >
          <button
            type="button"
            class="btn primary"
            onclick={() => {
              setTarget(serial);
              navigate('shell');
            }}>{t('details.openShell')}</button
          >
        </div>
      {/if}
    </div>

    {#if !device}
      <div class="card empty">{t('details.none')}</div>
    {:else if device.stateKind !== 'device'}
      <div class="card empty">{t('details.notReady', { state: device.state })}</div>
    {:else}
      <div class="tabs" role="tablist" aria-label={t('details.tabs')} data-guide="details-tabs">
        {#each TABS as x (x)}
          <button type="button" role="tab" aria-selected={tab === x} class:on={tab === x} onclick={() => (tab = x)}>{tabLabel(x)}</button>
        {/each}
      </div>

      <div class="cols">
        <div class="left">
          {#if tab === 'summary'}
            {#if app.summaryErrors[serial] && !summary}
              <ErrorState error={classify(app.summaryErrors[serial])!} {serial} onretry={loadSummary} />
            {:else}
              <div class="blocks">
                {#each blocks as b (b.title)}
                  <section class="card blk">
                    <h2 class="section-title">{t(b.title)}</h2>
                    <dl>
                      {#each b.items as [k, v] (k)}
                        <dt>{t(k)}</dt>
                        <dd>{v || '—'}</dd>
                      {/each}
                    </dl>
                  </section>
                {/each}
              </div>
            {/if}
          {:else if tab === 'props'}
            <input class="input" type="search" placeholder={t('details.filter')} aria-label={t('details.filterLabel')} bind:value={propFilter} />
            <div class="card tbl">
              <table>
                <thead><tr><th scope="col">{t('details.key')}</th><th scope="col">{t('details.value')}</th></tr></thead>
                <tbody>
                  {#each propList as [k, v] (k)}
                    <tr><td class="mono">{k}</td><td class="mono">{v}</td></tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else if tab === 'raw'}
            <pre class="term tall">{verbose.join('\n')}</pre>
          {:else}
            {@const o = outputs[tab]}
            <div class="row">
              <span class="mono muted small">adb -s {serial} shell "{CMDS[tab]}"</span>
              <div class="spacer"></div>
              <button type="button" class="btn sm" onclick={() => runTab(tab, true)}>{t('common.refresh')}</button>
            </div>
            {#if !o || o.loading}
              <div class="muted">{t('common.loading')}</div>
            {:else if o.error}
              <ErrorState error={o.error} {serial} onretry={() => runTab(tab, true)} />
            {:else}
              <pre class="term tall">{o.text}</pre>
            {/if}
          {/if}
        </div>

        <section class="verbose" aria-label={t('details.verbose')} data-guide="details-verbose">
          <div class="vhead">
            <span class="vt">{t('details.verbose')}</span>
            <div class="spacer"></div>
            <input type="search" class="vin" placeholder={t('details.filter')} aria-label={t('details.filterLabel')} bind:value={filter} />
            <button
              type="button"
              class="vbtn"
              onclick={async () => {
                await copyText(verboseText);
                toast(t('common.copied'), 'success', undefined, 2000);
              }}>{t('common.copy')}</button
            >
            <button type="button" class="vbtn" onclick={exportTxt}>{t('details.export')}</button>
          </div>
          <pre class="vout">{verboseText}</pre>
        </section>
      </div>
    {/if}
  </div>
</div>

<style>
  .spacer {
    flex: 1 1 auto;
  }
  .small {
    font-size: 12px;
  }
  .reboot {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .tabs button {
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    padding: 9px 12px;
    font-weight: 500;
    font-size: 13px;
    color: var(--muted);
    margin-bottom: -1px;
    cursor: pointer;
  }
  .tabs button.on {
    border-bottom-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    align-items: stretch;
  }
  @container (min-width: 760px) {
    .cols {
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    }
  }
  .left {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .blocks {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 12px;
  }
  .blk {
    padding: 12px 14px;
  }
  .blk h2 {
    margin-bottom: 8px;
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: 100px 1fr;
    row-gap: 5px;
    font-size: 13px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .tbl {
    overflow: auto;
    max-height: 420px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  th {
    text-align: left;
    color: var(--muted);
    font-weight: 600;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--surface);
  }
  td {
    padding: 6px 12px;
    border-bottom: 1px solid var(--surface-3);
    overflow-wrap: anywhere;
  }
  .tall {
    max-height: 440px;
    min-height: 200px;
  }
  .verbose {
    min-width: 0;
    background: var(--term-bg);
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    min-height: 420px;
    max-height: 560px;
  }
  .vhead {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--term-border);
    flex-wrap: wrap;
  }
  .vt {
    font-size: 12px;
    font-weight: 700;
    color: #e6e8ec;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .vin {
    width: 180px;
    height: 30px;
    border: 1px solid #3a4150;
    border-radius: 6px;
    background: #1f2329;
    color: #e6e8ec;
    padding: 0 8px;
    font-size: 12px;
  }
  .vbtn {
    height: 30px;
    padding: 0 10px;
    border: 1px solid #3a4150;
    border-radius: 6px;
    background: transparent;
    color: #e6e8ec;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }
  .vbtn:hover {
    background: #2a303a;
  }
  .vout {
    margin: 0;
    flex: 1 1 auto;
    overflow: auto;
    padding: 12px;
    font-family: var(--mono);
    font-size: 12px;
    line-height: 19px;
    color: var(--term-text);
    white-space: pre;
  }
</style>
