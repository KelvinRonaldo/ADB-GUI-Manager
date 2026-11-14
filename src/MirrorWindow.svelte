<script lang="ts">
  // Janela destacada do espelho: só a tela do aparelho e a coluna curta (navegação, volume e "Mais").
  // Sobe a própria sessão; o X da janela para o espelho.
  import { onMount, tick } from 'svelte';
  import MirrorScreen from './components/MirrorScreen.svelte';
  import MirrorColumn from './components/MirrorColumn.svelte';
  import ErrorState from './components/ErrorState.svelte';
  import Toasts from './components/Toasts.svelte';
  import ModalHost from './components/ModalHost.svelte';
  import Icon from './components/Icon.svelte';
  import type { MoreItem } from './components/MirrorMore.svelte';
  import { t } from './lib/i18n.svelte';
  import { api, isTauri, listen } from './lib/ipc';
  import { adoptInit, app, deviceName, loadCurrentDevices } from './lib/state.svelte';
  import { KEY, notificationsMsg, rotateMsg, type Quality } from './lib/mirror';
  import { MirrorSession } from './lib/mirrorSession.svelte';
  import { EV_CAPTURE, EV_DOCK, EV_DOCK_REQUEST, EV_STATE, emitTo, windowSize } from './lib/mirrorWindow';

  const serial = new URLSearchParams(location.search).get('serial') ?? '';
  const s = new MirrorSession();
  let booted = $state(false);
  let bootError = $state('');
  let full = $state(false);
  let onTop = $state(false);
  let chrome = $state(true);
  let menuOpen = false;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let screenRef: MirrorScreen | undefined = $state();
  let closing = $state(false);
  let begun = $state(false);

  async function win() {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return getCurrentWindow();
  }

  function start() {
    begun = true;
    s.start(serial, {
      quality: (app.settings.mirrorQuality as Quality) ?? 'medium',
      maxFps: app.settings.mirrorFps ?? 30,
      control: app.settings.mirrorControl ?? true,
      stayAwake: app.settings.mirrorStayAwake ?? true,
    });
  }

  /** Para o espelho, avisa a janela principal e fecha esta. */
  async function close(dock: boolean) {
    if (closing) return;
    closing = true;
    await s.stop();
    await emitTo(EV_STATE, { open: false, serial });
    if (dock) await emitTo(EV_DOCK, { serial });
    if (isTauri) (await win()).destroy();
  }

  async function setFull(on: boolean) {
    full = on;
    showChrome();
    if (isTauri) await (await win()).setFullscreen(on).catch(() => undefined);
    await tick();
    screenRef?.focus();
  }
  async function toggleTop() {
    onTop = !onTop;
    if (isTauri) await (await win()).setAlwaysOnTop(onTop).catch(() => undefined);
  }
  function showChrome() {
    chrome = true;
    clearTimeout(hideTimer);
    if (full) hideTimer = setTimeout(() => !menuOpen && (chrome = false), 3000);
  }
  function onMenu(open: boolean) {
    menuOpen = open;
    if (!open) showChrome();
  }

  const more = $derived<MoreItem[]>([
    ...(s.control
      ? ([
          { icon: 'power', label: t('mirror.k.power'), onclick: () => s.press(KEY.power) },
          { icon: 'bell', label: t('mirror.k.notifications'), onclick: () => s.send(notificationsMsg()) },
          { icon: 'refresh', label: t('mirror.k.rotate'), onclick: () => s.send(rotateMsg()) },
          { icon: s.screenOff ? 'screenOn' : 'screenOff', label: s.screenOff ? t('mirror.k.screenOn') : t('mirror.k.screenOff'), onclick: () => s.toggleScreen() },
          { divider: true },
        ] as MoreItem[])
      : []),
    { icon: 'camera', label: t('mirror.k.capture'), onclick: () => emitTo(EV_CAPTURE, { serial }) },
    full
      ? { icon: 'exitFullscreen', label: t('mirror.exitFullscreen'), onclick: () => setFull(false) }
      : { icon: 'fullscreen', label: t('mirror.fullscreen'), onclick: () => setFull(true) },
    { icon: 'pin', label: t('mirror.alwaysOnTop'), onclick: toggleTop, pressed: onTop },
    { divider: true },
    { icon: 'dock', label: t('mirror.dock'), onclick: () => close(true) },
  ]);

  function onKey(e: KeyboardEvent) {
    if (e.key === 'F11') {
      e.preventDefault();
      setFull(!full);
    } else if (e.key === 'Escape' && full) {
      e.preventDefault();
      setFull(false);
    }
  }

  // Girou o aparelho: a janela acompanha a proporção da tela (fora da tela cheia).
  let lastRatio = 0;
  $effect(() => {
    const { w, h } = s.size;
    if (!w || !h || full || !isTauri) return;
    const r = w / h;
    if (lastRatio && Math.abs(r - lastRatio) > 0.01) {
      const sz = windowSize(w, h);
      win().then(async (wi) => {
        const { LogicalSize } = await import('@tauri-apps/api/dpi');
        await wi.setSize(new LogicalSize(sz.width, sz.height)).catch(() => undefined);
      });
    }
    lastRatio = r;
  });

  // Título com o nome do aparelho no idioma do app.
  $effect(() => {
    if (!booted) return;
    const title = t('mirror.windowTitle', { name: s.devName || deviceName(serial) });
    document.title = title;
    if (isTauri) win().then((w) => w.setTitle(title).catch(() => undefined));
  });

  onMount(async () => {
    try {
      adoptInit(await api.init());
      await loadCurrentDevices();
      await listen<{ devices: never[]; first: boolean }>('devices', () => loadCurrentDevices());
      booted = true;
    } catch (e) {
      bootError = String(e);
      return;
    }
    await listen(EV_DOCK_REQUEST, () => close(true));
    if (isTauri) {
      (await win()).onCloseRequested(async (e) => {
        e.preventDefault();
        await close(false);
      });
    }
    await emitTo(EV_STATE, { open: true, serial });
    start();
  });
</script>

<svelte:window onkeydown={onKey} />

{#if bootError}
  <div class="msg err">{bootError}</div>
{:else if !booted}
  <div class="msg">ADB GUI Manager…</div>
{:else}
  <div class="win" class:full class:nochrome={full && !chrome} onpointermove={() => full && showChrome()} role="presentation">
    {#if s.phase === 'error' && s.error}
      <div class="err-box"><ErrorState error={s.error} {serial} onretry={start} /></div>
    {:else if s.phase === 'idle' && begun && !closing}
      <div class="ended">
        <Icon name="mirror" size={28} />
        <div>{t('mirror.endedWindow', { name: deviceName(serial) })}</div>
        <div class="row">
          <button type="button" class="btn primary" onclick={start}><Icon name="play" size={15} />{t('mirror.start')}</button>
          <button type="button" class="btn" onclick={() => close(false)}>{t('common.close')}</button>
        </div>
      </div>
    {:else}
      <div class="screen-box" style={s.size.w ? `aspect-ratio:${s.size.w}/${s.size.h}` : ''}>
        <MirrorScreen bind:this={screenRef} session={s} ring={false} onescape={full ? () => setFull(false) : undefined} />
        {#if full}<div class="esc-hint">{t('mirror.escHint')}</div>{/if}
      </div>
      <div class="col-slot"><MirrorColumn session={s} {more} onmenu={onMenu} /></div>
    {/if}
  </div>
{/if}

<Toasts />
<ModalHost />

<style>
  :global(body) {
    overflow: hidden;
  }
  .msg {
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
  }
  .msg.err {
    color: var(--err-fg);
    padding: 24px;
    white-space: pre-wrap;
  }
  .win {
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 10px;
    background: #111418;
    color: #e6e8ec;
    box-sizing: border-box;
  }
  .win.full {
    background: #000;
    padding: 12px;
  }
  .win.nochrome {
    cursor: none;
  }
  .screen-box {
    position: relative;
    height: 100%;
    max-width: calc(100% - 56px);
    flex: 0 1 auto;
    min-width: 0;
    background: #000;
    border-radius: 10px;
    overflow: hidden;
  }
  .full .screen-box {
    border-radius: 0;
  }
  .col-slot {
    align-self: center;
    transition: opacity 0.2s;
  }
  .esc-hint {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(20, 23, 28, 0.85);
    color: #e6e8ec;
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 6px;
    pointer-events: none;
    white-space: nowrap;
    transition: opacity 0.2s;
  }
  .nochrome .col-slot,
  .nochrome .esc-hint {
    opacity: 0;
    pointer-events: none;
  }
  .err-box {
    width: 100%;
    max-height: 100%;
    overflow: auto;
    color: var(--text);
  }
  .ended {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    text-align: center;
    padding: 16px;
    color: #c9d1d9;
  }
  .ended .row {
    display: flex;
    gap: 8px;
  }
</style>
