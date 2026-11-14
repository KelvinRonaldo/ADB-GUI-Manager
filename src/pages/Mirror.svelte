<script lang="ts">
  // Espelhamento da tela pelo scrcpy-server embutido: vídeo decodificado aqui (WebCodecs),
  // toques, rolagem e teclas voltam para o aparelho. Também em tela cheia e numa janela destacada.
  import { onDestroy, tick } from 'svelte';
  import TopBar from '../components/TopBar.svelte';
  import PageGuideOffer from '../components/PageGuideOffer.svelte';
  import ErrorState from '../components/ErrorState.svelte';
  import Icon from '../components/Icon.svelte';
  import MirrorScreen from '../components/MirrorScreen.svelte';
  import MirrorColumn from '../components/MirrorColumn.svelte';
  import MirrorMore, { type MoreItem } from '../components/MirrorMore.svelte';
  import { t } from '../lib/i18n.svelte';
  import { isTauri } from '../lib/ipc';
  import { app, deviceName, findDevice, saveSettings, setTarget, targetSerial } from '../lib/state.svelte';
  import { serialOf } from '../lib/deviceView';
  import { KEY, QUALITY, notificationsMsg, rotateMsg, type Quality } from '../lib/mirror';
  import { MirrorSession, detached, pending } from '../lib/mirrorSession.svelte';
  import { EV_DOCK_REQUEST, emitTo, focusDetached, openDetached } from '../lib/mirrorWindow';
  import { openCapture } from '../lib/capture.svelte';

  const serial = $derived(targetSerial());
  const ready = $derived(!!serial && findDevice(serial)?.stateKind === 'device');

  const s = new MirrorSession();
  const active = $derived(s.phase === 'running' || s.phase === 'starting');

  let quality = $state<Quality>((app.settings.mirrorQuality as Quality) ?? 'medium');
  let maxFps = $state<number>(app.settings.mirrorFps ?? 30);
  let control = $state<boolean>(app.settings.mirrorControl ?? true);
  let stayAwake = $state<boolean>(app.settings.mirrorStayAwake ?? true);

  function saveOpts() {
    app.settings.mirrorQuality = quality;
    app.settings.mirrorFps = maxFps;
    app.settings.mirrorControl = control;
    app.settings.mirrorStayAwake = stayAwake;
    saveSettings();
  }

  function start() {
    if (!serial || detached.open) return;
    saveOpts();
    s.start(serial, { quality, maxFps, control, stayAwake });
  }

  // ---------- tela cheia ----------
  let full = $state(false);
  let chrome = $state(true);
  let menuOpen = false;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let screenRef: MirrorScreen | undefined = $state();

  async function setWindowFullscreen(on: boolean) {
    if (!isTauri) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow()
      .setFullscreen(on)
      .catch(() => undefined);
  }
  async function enterFull() {
    if (!active || full) return;
    full = true;
    showChrome();
    await setWindowFullscreen(true);
    await tick();
    screenRef?.focus();
  }
  async function exitFull() {
    if (!full) return;
    full = false;
    clearTimeout(hideTimer);
    chrome = true;
    await setWindowFullscreen(false);
    await tick();
    screenRef?.focus();
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
  // O espelho parou (erro, aparelho saiu): sai da tela cheia.
  $effect(() => {
    if (full && !active) exitFull();
  });

  /** Leva o nó para o <body> enquanto ativo: a página tem contenção de layout e prenderia o `fixed`. */
  function portal(node: HTMLElement, on: boolean) {
    const mark = document.createComment('mirror-stage');
    node.before(mark);
    const apply = (v: boolean) => {
      if (v && node.parentNode !== document.body) document.body.appendChild(node);
      if (!v && mark.parentNode && node.previousSibling !== mark) mark.after(node);
    };
    apply(on);
    return {
      update: apply,
      destroy() {
        mark.remove();
        if (node.parentNode === document.body) node.remove();
      },
    };
  }

  // ---------- ações ----------
  async function capture() {
    const sr = s.serial;
    if (full) await exitFull();
    openCapture(sr);
  }
  async function detach() {
    const sr = s.serial;
    const { w, h } = s.size;
    if (full) await exitFull();
    saveOpts();
    await s.stop();
    await openDetached(sr, w, h);
  }

  const barMore = $derived<MoreItem[]>([
    { icon: 'camera', label: t('mirror.k.capture'), onclick: capture },
    { icon: 'detach', label: t('mirror.detach'), onclick: detach, disabled: !isTauri },
    { icon: 'fullscreen', label: t('mirror.fullscreen'), onclick: enterFull },
  ]);
  const fullMore = $derived<MoreItem[]>([
    ...(s.control
      ? ([
          { icon: 'power', label: t('mirror.k.power'), onclick: () => s.press(KEY.power) },
          { icon: 'bell', label: t('mirror.k.notifications'), onclick: () => s.send(notificationsMsg()) },
          { icon: 'refresh', label: t('mirror.k.rotate'), onclick: () => s.send(rotateMsg()) },
          { icon: s.screenOff ? 'screenOn' : 'screenOff', label: s.screenOff ? t('mirror.k.screenOn') : t('mirror.k.screenOff'), onclick: () => s.toggleScreen() },
          { divider: true },
        ] as MoreItem[])
      : []),
    { icon: 'camera', label: t('mirror.k.capture'), onclick: capture },
    { icon: 'exitFullscreen', label: t('mirror.exitFullscreen'), onclick: exitFull },
  ]);

  function onWindowKey(e: KeyboardEvent) {
    if (e.key === 'F11' && active) {
      e.preventDefault();
      if (full) exitFull();
      else enterFull();
    } else if (e.key === 'Escape' && full) {
      e.preventDefault();
      exitFull();
    }
  }

  // O alvo mudou durante o espelho: para (o espelho é de um aparelho só).
  $effect(() => {
    if (s.mirrorId != null && serial !== s.serial) s.stop();
  });

  // Voltou da janela destacada (pelo Mais dela ou pelo botão daqui): retoma aqui o espelho do
  // mesmo aparelho. Vale com a página já aberta, por isso não fica só na montagem.
  $effect(() => {
    const p = pending.serial;
    if (!p || detached.open) return;
    pending.serial = '';
    if (findDevice(p)?.stateKind !== 'device') return;
    if (targetSerial() !== p) setTarget(p);
    tick().then(start);
  });
  onDestroy(() => {
    clearTimeout(hideTimer);
    if (full) setWindowFullscreen(false);
    s.dispose();
  });

  const target = $derived(serial ? findDevice(serial) : undefined);
</script>

<svelte:window onkeydown={onWindowKey} />

<div class="page">
  <TopBar heading={t('mirror.title')} sub={t('mirror.subtitle')} />
  <div class="page-body">
    <PageGuideOffer page="mirror" />
    <section class="card opts" class:compact={active} data-guide="mirror-options">
      <div class="row">
        {#if active}
          <div class="muted small status grow">
            {#if s.phase === 'starting'}
              <span class="spin"><Icon name="spinner" size={13} /></span>{t('mirror.starting', { name: deviceName(s.serial) })}
            {:else}
              {t('mirror.running', { name: s.devName || deviceName(s.serial), serial: serialOf(s.serial) ?? s.serial, w: s.size.w, h: s.size.h, fps: s.fps })}
            {/if}
          </div>
          <span class="chip muted small">{t(`mirror.q.${quality}` as Parameters<typeof t>[0]).split(' · ')[0]} · {maxFps} fps</span>
          <button type="button" class="btn" onclick={() => s.stop()}><Icon name="stop" size={15} />{t('mirror.stop')}</button>
        {:else}
          <label class="field">
            <span class="muted small">{t('mirror.quality')}</span>
            <select class="select sm" bind:value={quality}>
              {#each Object.keys(QUALITY) as q (q)}<option value={q}>{t(`mirror.q.${q}` as Parameters<typeof t>[0])}</option>{/each}
            </select>
          </label>
          <label class="field">
            <span class="muted small">{t('mirror.fps')}</span>
            <select class="select sm" bind:value={maxFps}>
              {#each [15, 30, 60] as f (f)}<option value={f}>{f}</option>{/each}
            </select>
          </label>
          <label class="check"><input type="checkbox" bind:checked={control} />{t('mirror.control')}</label>
          <label class="check"><input type="checkbox" bind:checked={stayAwake} disabled={!control} />{t('mirror.stayAwake')}</label>
          <div class="spacer"></div>
          <button type="button" class="btn primary" disabled={!ready || detached.open} onclick={start}><Icon name="play" size={15} />{t('mirror.start')}</button>
        {/if}
      </div>
      {#if !active}
        <div class="muted small status">
          {#if !serial}
            {t('common.chooseDevice')}
          {:else if !ready}
            {t('mirror.notReady', { name: deviceName(serial), state: target?.state ?? '' })}
          {:else}
            {t('mirror.idle', { name: deviceName(serial) })}
          {/if}
        </div>
      {/if}
    </section>

    {#if s.phase === 'error' && s.error}
      <ErrorState error={s.error} serial={s.serial || serial} onretry={start} />
    {/if}

    {#if detached.open}
      <section class="card elsewhere">
        <Icon name="detach" size={22} />
        <div class="grow">{t('mirror.detachedHere', { name: deviceName(detached.serial) })}</div>
        <button type="button" class="btn" onclick={focusDetached}>{t('mirror.showWindow')}</button>
        <button type="button" class="btn primary" onclick={() => emitTo(EV_DOCK_REQUEST, {})}><Icon name="dock" size={15} />{t('mirror.dock')}</button>
      </section>
    {/if}

    <div class="stage" class:on={active} data-guide="mirror-screen">
      {#if active}
        <div class="view" class:full class:nochrome={full && !chrome} use:portal={full} onpointermove={() => full && showChrome()} role="presentation">
          <div class="screen-box" style={s.size.w ? `aspect-ratio:${s.size.w}/${s.size.h}` : ''}>
            <MirrorScreen bind:this={screenRef} session={s} ring={!full} onescape={full ? exitFull : undefined} />
            {#if full}<div class="esc-hint">{t('mirror.escHint')}</div>{/if}
          </div>
          {#if full}
            <div class="col-slot"><MirrorColumn session={s} more={fullMore} onmenu={onMenu} /></div>
          {/if}
        </div>
        <div class="keys" role="toolbar" aria-label={t('mirror.keys')}>
          {#if s.control}
            <button type="button" class="btn sm" onclick={() => s.press(KEY.back)} title={t('mirror.k.backHint')}><Icon name="left" size={14} />{t('mirror.k.back')}</button>
            <button type="button" class="btn sm" onclick={() => s.press(KEY.home)}>{t('mirror.k.home')}</button>
            <button type="button" class="btn sm" onclick={() => s.press(KEY.appSwitch)}>{t('mirror.k.recents')}</button>
            <span class="sep"></span>
            <button type="button" class="btn sm" onclick={() => s.press(KEY.volumeDown)}>{t('mirror.k.volDown')}</button>
            <button type="button" class="btn sm" onclick={() => s.press(KEY.volumeUp)}>{t('mirror.k.volUp')}</button>
            <button type="button" class="btn sm" onclick={() => s.press(KEY.power)}><Icon name="power" size={14} />{t('mirror.k.power')}</button>
            <span class="sep"></span>
            <button type="button" class="btn sm" onclick={() => s.send(notificationsMsg())}>{t('mirror.k.notifications')}</button>
            <button type="button" class="btn sm" onclick={() => s.send(rotateMsg())}><Icon name="refresh" size={14} />{t('mirror.k.rotate')}</button>
            <button type="button" class="btn sm" aria-pressed={s.screenOff} onclick={() => s.toggleScreen()}>{s.screenOff ? t('mirror.k.screenOn') : t('mirror.k.screenOff')}</button>
            <span class="sep"></span>
          {/if}
          <MirrorMore items={barMore} />
        </div>
        {#if s.control}<div class="muted small hint">{t('mirror.hint')}</div>{/if}
      {:else if s.phase !== 'error' && !detached.open}
        <div class="empty muted">
          <Icon name="devices" size={28} />
          <div>{ready ? t('mirror.emptyReady') : t('mirror.empty')}</div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .page-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
  }
  .opts {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .opts.compact {
    padding: 8px 12px;
  }
  .field {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
  }
  .opts > .row {
    align-items: flex-end;
    gap: 12px 16px;
  }
  .opts.compact > .row {
    align-items: center;
    gap: 10px;
  }
  .check {
    height: 30px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 18px;
  }
  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }
  .chip {
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 3px 10px;
    white-space: nowrap;
  }
  .elsewhere {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
  }
  .stage {
    flex: 1 1 0;
    min-height: 360px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .view {
    flex: 1 1 0;
    min-height: 300px;
    width: 100%;
    display: flex;
    justify-content: center;
  }
  .screen-box {
    position: relative;
    flex: 0 1 auto;
    height: 100%;
    max-width: 100%;
    min-width: 0;
    background: var(--term-bg);
    border-radius: 12px;
    overflow: hidden;
  }
  /* Tela cheia: só a tela do aparelho e, colada nela, a coluna curta. */
  .view.full {
    position: fixed;
    inset: 0;
    z-index: 250;
    min-height: 0;
    padding: 12px;
    gap: 12px;
    align-items: center;
    background: #000;
  }
  .view.full .screen-box {
    max-width: calc(100% - 64px);
    background: #000;
    border-radius: 0;
  }
  .view.full.nochrome {
    cursor: none;
  }
  .col-slot {
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
  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
  }
  .sep {
    width: 1px;
    height: 24px;
    background: var(--border);
    margin: 0 4px;
    align-self: center;
  }
  .hint {
    text-align: center;
  }
  .empty {
    margin: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    text-align: center;
    max-width: 420px;
  }
  .spin {
    display: inline-flex;
  }
</style>
