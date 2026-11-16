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
  // Pareamento em dois passos: parear e depois conectar. A porta de conexão muitas vezes só aparece no aparelho
  // depois que a janela "Parear com código" fecha, então ela é pedida (ou achada na rede) só no segundo passo.
  type PStep = 'pair' | 'connect' | 'done';
  let pstep = $state<PStep>('pair');
  let connHost = $state('');
  let connHostLocked = $state(false);
  let connPort = $state('');
  let autoConnect = $state(false);
  let searchUntil = 0;
  let connectedAt = $state('');
  // O adb não pareia sem a porta ("Invalid port") e ainda sai com 0; barra antes de rodar.
  const pairNeedsPort = $derived(pairAddress.trim() !== '' && !/:\d+$/.test(pairAddress.trim()));
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
  let polling = false;

  const isPairSvc = (s: MdnsService) => s.service.startsWith('_adb-tls-pairing');
  const isConnSvc = (s: MdnsService) => s.service.startsWith('_adb-tls-connect');
  const hostOf = (a: string) => a.split(':')[0];
  const portOf = (a: string) => a.split(':')[1] ?? '';
  // Endereço de pareamento anunciado enquanto a janela "Parear com código" está aberta no aparelho.
  const pairOffers = $derived(mdns.filter((s) => isPairSvc(s) && s.name !== qrName && s.address !== pairAddress.trim()).slice(0, 2));
  const connOffers = $derived(
    mdns.filter((s) => isConnSvc(s) && (!connHostLocked || hostOf(s.address) === connHost) && s.address !== `${connHost}:${connPort}`).slice(0, 3),
  );
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
    if (polling) return;
    polling = true;
    try {
      mdns = await api.mdns(true, pstep === 'connect' && connHost ? [connHost] : []);
    } catch {
      mdns = [];
    } finally {
      polling = false;
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
    // Passo 2 logo depois do pareamento: achou a porta de conexão do mesmo IP, conecta sozinho.
    if (pstep === 'connect' && autoConnect && !busy) {
      const svc = mdns.find((s) => isConnSvc(s) && hostOf(s.address) === connHost);
      if (svc) {
        connPort = portOf(svc.address);
        await doConnect();
      } else if (Date.now() > searchUntil) autoConnect = false;
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
      status = '';
      pstep = 'connect';
      connHost = hostOf(address);
      connHostLocked = true;
      connPort = '';
      autoConnect = true;
      searchUntil = Date.now() + 60_000;
    } finally {
      busy = false;
    }
    pollMdns();
  }

  async function doConnect() {
    let host = connHost.trim();
    let port = connPort.trim();
    if (!port && host.includes(':')) [host, port] = [hostOf(host), portOf(host)];
    if (!host || !port) return;
    const address = `${host}:${port}`;
    wifiError = null;
    autoConnect = false;
    busy = true;
    try {
      const { ok, error } = await connectAddress(address);
      if (ok) {
        addRecent(address, address);
        toast(t('connect.connected', { address }), 'success');
        connectedAt = address;
        pstep = 'done';
      } else if (error) fail(error, doConnect);
    } finally {
      busy = false;
    }
  }

  function usePairOffer(s: MdnsService) {
    pairAddress = s.address;
    document.getElementById('pair-code')?.focus();
  }

  function useConnOffer(s: MdnsService) {
    connHost = hostOf(s.address);
    connPort = portOf(s.address);
    doConnect();
  }

  function onlyConnect() {
    wifiError = null;
    autoConnect = false;
    connHostLocked = false;
    connHost = '';
    connPort = '';
    pstep = 'connect';
  }

  function backToPair() {
    wifiError = null;
    autoConnect = false;
    pstep = 'pair';
  }

  function pairAnother() {
    pairAddress = '';
    pairCode = '';
    connHost = '';
    connPort = '';
    connectedAt = '';
    connHostLocked = false;
    backToPair();
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
      backToPair();
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
          <div class="steps">
            <span class="step" class:on={pstep === 'pair'} class:done={pstep !== 'pair'}
              ><i>{#if pstep !== 'pair'}<Icon name="check" size={12} stroke={2.6} />{:else}1{/if}</i>{t('connect.step.pair')}</span
            >
            <span class="bar"></span>
            <span class="step" class:on={pstep === 'connect'} class:done={pstep === 'done'}
              ><i>{#if pstep === 'done'}<Icon name="check" size={12} stroke={2.6} />{:else}2{/if}</i>{t('connect.step.connect')}</span
            >
          </div>
          {#if pstep === 'pair'}
            <div class="pair">
              <form
                class="form"
                onsubmit={(e) => {
                  e.preventDefault();
                  doPair();
                }}
              >
                <div class="muted">{t('connect.pairHint')}</div>
                {#each pairOffers as s (s.address)}
                  <div class="found">
                    <div class="grow"><span class="mono">{s.address}</span> <span class="muted small">· {t('connect.pairOpen')}</span></div>
                    <button type="button" class="btn sm outline" onclick={() => usePairOffer(s)}>{t('connect.use')}</button>
                  </div>
                {/each}
                <div class="two">
                  <label class="field"
                    >{t('connect.pairAddress')}<input class="input mono" class:bad={pairNeedsPort} placeholder="192.168.0.57:37215" aria-invalid={pairNeedsPort} bind:value={pairAddress} />
                    {#if pairNeedsPort}<span class="field-note">{t('connect.pairNeedsPort')}</span>{/if}</label
                  >
                  <label class="field">{t('connect.pairCode')}<input id="pair-code" class="input mono" inputmode="numeric" placeholder="482193" bind:value={pairCode} /></label>
                </div>
                <button type="submit" class="btn primary" disabled={busy || !pairAddress.trim() || pairNeedsPort || !pairCode.trim()}>{t('common.pair')}</button>
                <div class="mono muted small">adb pair {pairAddress || 'HOST:PORT'} {pairCode.replace(/\s/g, '') || 'CODE'}</div>
                <div class="muted small">{t('connect.alreadyPaired')} <button type="button" class="linkbtn" onclick={onlyConnect}>{t('connect.onlyConnect')}</button></div>
              </form>
              <div class="qr">
                <div class="strong small">{t('connect.qrTitle')}</div>
                {#if qrImg}<img src={qrImg} alt={t('connect.qrTitle')} width="160" height="160" />{/if}
                <div class="muted small center">{t('connect.qrHint')}</div>
                <div class="muted small center">{t('connect.qrWaiting')}</div>
                <button type="button" class="linkbtn small" onclick={newQr}>{t('connect.qrNew')}</button>
              </div>
            </div>
          {:else if pstep === 'connect'}
            <form
              class="form"
              onsubmit={(e) => {
                e.preventDefault();
                doConnect();
              }}
            >
              {#if connHostLocked}<div class="banner ok"><Icon name="check" size={16} stroke={2.4} /><span>{t('connect.pairedWith', { host: connHost })}</span></div>{/if}
              {#if autoConnect}<div class="banner info" role="status"><Icon name="spinner" size={16} class="spin" /><span>{t('connect.searchingPort')}</span></div>{/if}
              {#each autoConnect ? [] : connOffers as s (s.address)}
                <div class="found">
                  <div class="grow"><span class="mono">{s.address}</span> <span class="muted small">· {t('connect.onNetwork', { name: s.name })}</span></div>
                  <button type="button" class="btn sm outline" disabled={busy} onclick={() => useConnOffer(s)}>{t('common.connect')}</button>
                </div>
              {/each}
              <div class="two">
                <label class="field">{t('connect.ip')}<input class="input mono" placeholder="192.168.0.42" disabled={connHostLocked} bind:value={connHost} /></label>
                <label class="field"
                  >{t('connect.connectPortField')}<input class="input mono" inputmode="numeric" placeholder={t('connect.connectPortPh')} bind:value={connPort} oninput={() => (autoConnect = false)} /></label
                >
              </div>
              <button type="submit" class="btn primary" disabled={busy || !connHost.trim() || !(connPort.trim() || connHost.includes(':'))}>{t('common.connect')}</button>
              <div class="muted small">{t('connect.connectPortWhere')}</div>
              <div class="mono muted small">adb connect {connHost || 'HOST'}:{connPort || 'PORT'}</div>
              <div class="small"><button type="button" class="linkbtn" onclick={backToPair}>{t('connect.backToPair')}</button></div>
            </form>
          {:else}
            <div class="form">
              <div class="banner ok"><Icon name="check" size={16} stroke={2.4} /><span>{t('connect.connected', { address: connectedAt })}</span></div>
              <div class="mono muted small">adb connect {connectedAt}</div>
              <button type="button" class="btn outline start" onclick={pairAnother}>{t('connect.pairAnother')}</button>
            </div>
          {/if}
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
          <ErrorState error={wifiError} onretry={() => lastAction?.()} handlers={{ pairAgain: () => ((wtab = 'pair'), backToPair()) }} />
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
  .input.bad {
    border-color: var(--err-fg);
  }
  .field-note {
    font-weight: 400;
    color: var(--err-fg);
  }
  .steps {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .step {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
  }
  .step i {
    font-style: normal;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 11.5px;
    font-weight: 700;
    border: 1.5px solid var(--border-strong);
  }
  .step.on {
    color: var(--text);
    font-weight: 600;
  }
  .step.on i {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .step.done i {
    border-color: var(--ok-fg);
    color: var(--ok-fg);
  }
  .steps .bar {
    width: 28px;
    height: 1.5px;
    background: var(--border-strong);
  }
  .banner {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 13px;
  }
  .banner.ok {
    background: var(--ok-bg);
    color: var(--ok-fg);
  }
  .banner.info {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .found {
    display: flex;
    align-items: center;
    gap: 10px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    border-radius: 8px;
    padding: 6px 6px 6px 10px;
    font-size: 12.5px;
  }
  .found .grow {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .start {
    align-self: flex-start;
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
