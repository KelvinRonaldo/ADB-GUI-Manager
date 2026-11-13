<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import QRCode from 'qrcode';
  import TopBar from '../components/TopBar.svelte';
  import PageGuideOffer from '../components/PageGuideOffer.svelte';
  import ErrorState from '../components/ErrorState.svelte';
  import Icon from '../components/Icon.svelte';
  import { t, lang } from '../lib/i18n.svelte';
  import { api, listen } from '../lib/ipc';
  import { classify, type AdbError } from '../lib/errors';
  import { formatDate } from '../lib/format';
  import { addRecent, app, connectAddress, deviceName, readyDevices, restartServer, saveSettings, toast } from '../lib/state.svelte';
  import { runReport } from '../lib/actions';
  import { startWifiFlow } from '../lib/wififlow.svelte';
  import type { MdnsService, StreamEvent } from '../lib/types';

  type WTab = 'pair' | 'usb' | 'ip';
  let wtab = $state<WTab>('pair');

  // USB
  let waitId = $state<number | null>(null);
  let waitDone = $state(false);

  // Wi-Fi
  let pairAddress = $state('');
  let pairCode = $state('');
  let connectPort = $state('');
  let status = $state('');
  let busy = $state(false);
  let wifiError = $state<AdbError | null>(null);
  let lastAction: (() => void) | null = null;
  let usbSerial = $state('');
  let usbPort = $state(String(app.settings.wifiPort || 5555));
  let ipAddress = $state('');

  // QR
  let qrName = $state('');
  let qrPass = $state('');
  let qrImg = $state('');
  let qrBusy = false;

  let mdns = $state<MdnsService[]>([]);
  let poll: ReturnType<typeof setInterval> | undefined;
  let offStream: (() => void) | undefined;

  const usbDevices = $derived(readyDevices().filter((d) => d.connection === 'usb'));

  function rand(n: number, chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') {
    const a = new Uint32Array(n);
    crypto.getRandomValues(a);
    return [...a].map((x) => chars[x % chars.length]).join('');
  }

  async function newQr() {
    qrName = `ADB_GUI_${rand(6)}`;
    qrPass = rand(10);
    qrImg = await QRCode.toDataURL(`WIFI:T:ADB;S:${qrName};P:${qrPass};;`, { margin: 1, width: 300 });
  }

  async function pollMdns() {
    try {
      mdns = await api.mdns(true);
    } catch {
      mdns = [];
    }
    // QR: o aparelho anuncia o serviço de pareamento com o nome do código lido.
    const svc = mdns.find((s) => s.service.startsWith('_adb-tls-pairing') && s.name === qrName);
    if (svc && !qrBusy && wtab === 'pair') {
      qrBusy = true;
      status = t('connect.qrFound');
      await doPair(svc.address, qrPass);
      await newQr();
      qrBusy = false;
    }
  }

  onMount(async () => {
    await newQr();
    pollMdns();
    poll = setInterval(pollMdns, 2500);
    offStream = await listen<StreamEvent>('stream', (e) => {
      if (e.id === waitId && e.kind === 'end') {
        waitDone = e.code === 0;
        waitId = null;
      }
    });
    if (!usbSerial && usbDevices[0]) usbSerial = usbDevices[0].serial;
  });
  onDestroy(() => {
    clearInterval(poll);
    offStream?.();
    if (waitId != null) api.streamStop(waitId);
  });

  async function waitUsb() {
    waitDone = false;
    waitId = await api.streamStart(['wait-for-usb-device'], null);
  }
  function cancelWait() {
    if (waitId != null) api.streamStop(waitId);
    waitId = null;
  }

  function fail(err: AdbError, retry: () => void) {
    wifiError = err;
    lastAction = retry;
    status = '';
  }

  async function finishConnect(address: string, name = address) {
    const { ok, error } = await connectAddress(address);
    if (ok) {
      addRecent(address, name);
      toast(t('connect.connected', { address }), 'success');
      status = '';
      return true;
    }
    if (error) fail(error, () => finishConnect(address, name));
    return false;
  }

  async function doPair(address = pairAddress.trim(), code = pairCode.replace(/\s/g, '')) {
    wifiError = null;
    busy = true;
    status = t('connect.pairing');
    try {
      const r = await api.run(['pair', address, code], { timeoutMs: 30000 });
      const err = classify(r, { op: 'pair', address });
      if (err) return fail(err, () => doPair(address, code));
      status = t('connect.paired');
      const host = address.split(':')[0];
      if (connectPort.trim()) {
        await finishConnect(`${host}:${connectPort.trim()}`);
        return;
      }
      // A porta de conexão aparece no mDNS logo depois do pareamento.
      for (let i = 0; i < 8; i++) {
        const list = await api.mdns(true).catch(() => [] as MdnsService[]);
        const svc = list.find((s) => s.service.startsWith('_adb-tls-connect') && s.address.split(':')[0] === host);
        if (svc) {
          await finishConnect(svc.address, svc.name);
          return;
        }
        await new Promise((res) => setTimeout(res, 1500));
      }
      status = t('connect.connectPortHint');
    } finally {
      busy = false;
    }
  }

  function doUsbToWifi() {
    if (usbSerial) startWifiFlow(usbSerial, { port: parseInt(usbPort, 10) || app.settings.wifiPort || 5555 });
  }

  async function doIp(address = ipAddress.trim()) {
    wifiError = null;
    if (!address) return;
    busy = true;
    try {
      await finishConnect(address.includes(':') ? address : `${address}:5555`);
    } finally {
      busy = false;
    }
  }

  function forget(address: string) {
    app.settings.recentConnections = app.settings.recentConnections.filter((r) => r.address !== address);
    saveSettings();
  }

  function useMdns(s: MdnsService) {
    if (s.service.startsWith('_adb-tls-pairing')) {
      wtab = 'pair';
      pairAddress = s.address;
      document.getElementById('pair-code')?.focus();
    } else {
      doIp(s.address);
    }
  }
</script>

<div class="page">
  <TopBar heading={t('connect.title')} sub={t('connect.subtitle')} />
  <div class="page-body">
    <PageGuideOffer page="connect" />
    <div class="cols">
      <section class="card box usb" data-guide="connect-usb">
        <div class="ttl"><Icon name="usb" size={22} /><h2>{t('connect.usb')}</h2></div>
        <ol>
          <li>{t('connect.step1')}</li>
          <li>{t('connect.step2')}</li>
          <li>{t('connect.step3')}</li>
        </ol>
        {#if waitId != null}
          <div class="waiting">
            <Icon name="spinner" size={20} stroke={2.4} class="spin" />
            <div class="grow">
              <div class="strong">{t('connect.waiting')}</div>
              <div class="mono muted small">adb wait-for-usb-device</div>
            </div>
            <button type="button" class="btn sm" onclick={cancelWait}>{t('common.cancel')}</button>
          </div>
        {:else}
          <button type="button" class="btn outline" onclick={waitUsb}>{t('connect.waitButton')}</button>
          {#if waitDone}<div class="chip ok">{t('connect.waitDone')}</div>{/if}
        {/if}
        <details>
          <summary>{t('connect.trouble')}</summary>
          <ul>
            <li>{t('connect.troubleMode')}</li>
            <li><button type="button" class="linkbtn" onclick={() => runReport(['reconnect', 'offline'], null, t('act.done', { cmd: 'adb reconnect offline' }))}>{t('connect.reconnectOffline')}</button> <span class="mono muted small">adb reconnect offline</span></li>
            <li><button type="button" class="linkbtn" onclick={restartServer}>{t('server.restart')}</button> <span class="mono muted small">kill-server + start-server</span></li>
            <li>{t('connect.troubleDrivers')}</li>
          </ul>
        </details>
      </section>

      <section class="card box wifi" data-guide="connect-wifi">
        <div class="ttl"><Icon name="connect" size={22} /><h2>{t('connect.wifi')}</h2><span class="muted small">{t('connect.wifiHint')}</span></div>
        <div class="seg" role="tablist" aria-label={t('connect.tabsLabel')}>
          <button type="button" role="tab" aria-selected={wtab === 'pair'} onclick={() => (wtab = 'pair')}>{t('connect.tab.pair')}</button>
          <button type="button" role="tab" aria-selected={wtab === 'usb'} onclick={() => (wtab = 'usb')}>{t('connect.tab.usb')}</button>
          <button type="button" role="tab" aria-selected={wtab === 'ip'} onclick={() => (wtab = 'ip')}>{t('connect.tab.ip')}</button>
        </div>

        {#if wtab === 'pair'}
          <div class="pair">
            <form
              class="form"
              onsubmit={(e) => {
                e.preventDefault();
                doPair();
              }}
            >
              <div class="muted">{t('connect.pairHint')}</div>
              <div class="two">
                <label class="field">{t('connect.pairAddress')}<input class="input mono" placeholder="192.168.0.57:37215" bind:value={pairAddress} /></label>
                <label class="field">{t('connect.pairCode')}<input id="pair-code" class="input mono" inputmode="numeric" placeholder="482193" bind:value={pairCode} /></label>
              </div>
              <label class="field">{t('connect.connectPort')}<input class="input mono" inputmode="numeric" placeholder="41235" bind:value={connectPort} /></label>
              <button type="submit" class="btn primary" disabled={busy || !pairAddress.trim() || !pairCode.trim()}>{t('common.pair')}</button>
              <div class="mono muted small">adb pair {pairAddress || 'HOST:PORT'} {pairCode.replace(/\s/g, '') || 'CODE'} → adb connect …</div>
            </form>
            <div class="qr">
              <div class="strong small">{t('connect.qrTitle')}</div>
              {#if qrImg}<img src={qrImg} alt={t('connect.qrTitle')} width="160" height="160" />{/if}
              <div class="muted small center">{t('connect.qrHint')}</div>
              <div class="muted small center">{t('connect.qrWaiting')}</div>
              <button type="button" class="linkbtn small" onclick={newQr}>{t('connect.qrNew')}</button>
            </div>
          </div>
        {:else if wtab === 'usb'}
          <div class="form">
            <div class="muted">{t('connect.usbHint')}</div>
            {#if usbDevices.length}
              <div class="two">
                <label class="field"
                  >{t('connect.usbDevice')}
                  <select class="select" bind:value={usbSerial}>
                    {#each usbDevices as d (d.serial)}
                      <option value={d.serial}>{deviceName(d.serial)} · {d.serial}{app.summaries[d.serial]?.wifiIp ? ` · ${app.summaries[d.serial]?.wifiIp}` : ''}</option>
                    {/each}
                  </select>
                </label>
                <label class="field">{t('connect.port')}<input class="input mono" inputmode="numeric" bind:value={usbPort} /></label>
              </div>
              <button type="button" class="btn primary" disabled={busy || !usbSerial} onclick={doUsbToWifi}>{t('connect.usbButton')}</button>
              <div class="mono muted small">adb -s {usbSerial} tcpip {usbPort} → adb connect {app.summaries[usbSerial]?.wifiIp ?? 'IP'}:{usbPort}</div>
            {:else}
              <div class="muted">{t('connect.noUsb')}</div>
            {/if}
          </div>
        {:else}
          <form
            class="form"
            onsubmit={(e) => {
              e.preventDefault();
              doIp();
            }}
          >
            <div class="muted">{t('connect.ipHint')}</div>
            <label class="field">{t('connect.hostPort')}<input class="input mono" placeholder="192.168.0.42:5555" bind:value={ipAddress} /></label>
            <button type="submit" class="btn primary" disabled={busy || !ipAddress.trim()}>{t('common.connect')}</button>
            <div class="mono muted small">adb connect {ipAddress || 'HOST:PORT'}</div>
          </form>
        {/if}

        {#if status}<div class="status" role="status"><Icon name="spinner" size={16} class={busy ? 'spin' : ''} /> {status}</div>{/if}
        {#if wifiError}
          <ErrorState error={wifiError} onretry={() => lastAction?.()} handlers={{ pairAgain: () => ((wtab = 'pair'), (wifiError = null)) }} />
        {/if}

        <div class="lists">
          <div class="list" data-guide="connect-mdns">
            <h3 class="section-title">{t('connect.mdns')}</h3>
            {#each mdns as s (s.name + s.service)}
              <div class="li">
                <div class="grow">
                  <div class="strong">{s.name}</div>
                  <div class="mono muted small">{s.service} · {s.address}</div>
                </div>
                <button type="button" class="btn sm outline" onclick={() => useMdns(s)}>{s.service.startsWith('_adb-tls-pairing') ? t('common.pair') : t('common.connect')}</button>
              </div>
            {:else}
              <div class="muted small">{t('connect.mdnsEmpty')}</div>
            {/each}
          </div>
          <div class="list" data-guide="connect-recent">
            <h3 class="section-title">{t('connect.recent')}</h3>
            {#each app.settings.recentConnections as r (r.address)}
              <div class="li">
                <div class="grow">
                  <div class="strong">{r.name}{#if r.serial}<span class="mono muted small sn">{t('connect.recentSerial', { serial: r.serial })}</span>{/if}</div>
                  <div class="mono muted small addr"><span>{r.address}</span><span>{formatDate(r.at, lang.current)}</span></div>
                </div>
                <button type="button" class="btn sm" disabled={busy} onclick={() => doIp(r.address)}>{t('common.connect')}</button>
                <button type="button" class="btn sm icon ghost" aria-label={t('connect.forgetLabel')} title={t('connect.forgetLabel')} onclick={() => forget(r.address)}><Icon name="close" size={14} /></button>
              </div>
            {:else}
              <div class="muted small">{t('connect.recentEmpty')}</div>
            {/each}
          </div>
        </div>
      </section>
    </div>
  </div>
</div>

<style>
  /* Endereço e data: na janela estreita a data desce inteira, sem separador solto. */
  .addr {
    display: flex;
    flex-wrap: wrap;
    column-gap: 12px;
  }
  .addr span {
    white-space: nowrap;
  }
  .sn {
    margin-left: 8px;
    font-weight: 400;
    white-space: nowrap;
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  @container (min-width: 720px) {
    .cols {
      grid-template-columns: minmax(0, 0.75fr) minmax(0, 1.6fr);
    }
  }
  .box {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .usb,
  .wifi {
    min-width: 0;
    container-type: inline-size;
  }
  .ttl {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--accent);
  }
  .wifi .ttl {
    color: var(--wifi-fg);
  }
  .ttl h2 {
    font-size: 16px;
    color: var(--text);
  }
  ol,
  ul {
    margin: 0;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
    line-height: 19px;
  }
  ul {
    margin-top: 8px;
  }
  .waiting {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--surface-2);
    border-radius: 10px;
    padding: 12px;
    color: var(--accent);
  }
  .waiting .grow {
    color: var(--text);
  }
  details {
    font-size: 13px;
  }
  summary {
    cursor: pointer;
    font-weight: 600;
    color: var(--accent);
  }
  .pair {
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
  }
  .form {
    flex: 1 1 240px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 13px;
  }
  .two {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .qr {
    flex: 0 0 180px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    border-left: 1px solid var(--surface-3);
    padding-left: 18px;
  }
  .qr img {
    border-radius: 8px;
    border: 1px solid var(--border-strong);
    background: #fff;
    padding: 4px;
  }
  .center {
    text-align: center;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--accent);
  }
  .lists {
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
    border-top: 1px solid var(--surface-3);
    padding-top: 14px;
  }
  .list {
    flex: 1 1 260px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .list h3 {
    margin-bottom: 4px;
  }
  .li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    border-bottom: 1px solid var(--surface-3);
  }
  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }
  .strong {
    font-weight: 600;
    font-size: 13px;
  }
  .small {
    font-size: 12px;
  }
</style>
