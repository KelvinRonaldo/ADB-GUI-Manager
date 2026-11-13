<script lang="ts">
  // Espelhamento da tela pelo scrcpy-server embutido: vídeo decodificado aqui (WebCodecs),
  // toques, rolagem e teclas voltam para o aparelho.
  import { onDestroy, onMount } from 'svelte';
  import TopBar from '../components/TopBar.svelte';
  import PageGuideOffer from '../components/PageGuideOffer.svelte';
  import ErrorState from '../components/ErrorState.svelte';
  import Icon from '../components/Icon.svelte';
  import { t } from '../lib/i18n.svelte';
  import { api, isTauri, listen, mirrorStart } from '../lib/ipc';
  import { classify, type AdbError } from '../lib/errors';
  import { app, deviceName, findDevice, saveSettings, targetSerial } from '../lib/state.svelte';
  import { serialOf } from '../lib/deviceView';
  import { wakeScreen } from '../lib/actions';
  import {
    ACTION_DOWN,
    ACTION_MOVE,
    ACTION_UP,
    KEY,
    QUALITY,
    androidKeycode,
    avcCodec,
    displayPowerMsg,
    keyMsg,
    notificationsMsg,
    parseMessage,
    resetVideoMsg,
    rotateMsg,
    scrollMsg,
    textMsg,
    touchMsg,
    type Quality,
  } from '../lib/mirror';

  type Phase = 'idle' | 'starting' | 'running' | 'error';

  const serial = $derived(targetSerial());
  const ready = $derived(!!serial && findDevice(serial)?.stateKind === 'device');

  let phase = $state<Phase>('idle');
  let error = $state<AdbError | null>(null);
  let mirrorId = $state<number | null>(null);
  let mirrorSerial = $state('');
  let devName = $state('');
  let size = $state({ w: 0, h: 0 });
  let fps = $state(0);
  let screenOff = $state(false);

  let quality = $state<Quality>((app.settings.mirrorQuality as Quality) ?? 'medium');
  let maxFps = $state<number>(app.settings.mirrorFps ?? 30);
  let control = $state<boolean>(app.settings.mirrorControl ?? true);
  let stayAwake = $state<boolean>(app.settings.mirrorStayAwake ?? true);

  let canvas: HTMLCanvasElement | undefined = $state();
  let ctx: CanvasRenderingContext2D | null = null;
  let decoder: VideoDecoder | null = null;
  let config: Uint8Array | null = null;
  let codec = '';
  let needKey = true;
  let lastReset = 0;
  let lastFrameAt = 0;
  let lastPacketAt = 0;
  let frames = 0;
  let fpsTimer: ReturnType<typeof setInterval> | undefined;

  const hasWebCodecs = typeof window !== 'undefined' && 'VideoDecoder' in window;

  function decoderError(raw: string): AdbError {
    return { kind: 'mirrorDecoder', code: 0, cmd: '', raw, actions: ['retry'], params: { os: app.init?.os ?? '' } };
  }

  function saveOpts() {
    app.settings.mirrorQuality = quality;
    app.settings.mirrorFps = maxFps;
    app.settings.mirrorControl = control;
    app.settings.mirrorStayAwake = stayAwake;
    saveSettings();
  }

  function resetDecoder() {
    try {
      decoder?.close();
    } catch {
      /* já fechado */
    }
    decoder = null;
    ctx = null;
    config = null;
    codec = '';
    needKey = true;
  }

  function makeDecoder(c: string) {
    resetDecoder();
    codec = c;
    decoder = new VideoDecoder({
      output: (frame) => {
        if (canvas) {
          if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
            canvas.width = frame.displayWidth;
            canvas.height = frame.displayHeight;
          }
          // O <canvas> é recriado a cada início: o contexto tem de ser o do canvas atual.
          if (ctx?.canvas !== canvas) ctx = canvas.getContext('2d');
          ctx?.drawImage(frame, 0, 0);
        }
        frames++;
        lastFrameAt = Date.now();
        frame.close();
      },
      error: (e) => fail(decoderError(String(e))),
    });
    decoder.configure({ codec: c, optimizeForLatency: true });
  }

  function onData(buf: ArrayBuffer) {
    const m = parseMessage(buf);
    if (m.name !== undefined) {
      devName = m.name;
      return;
    }
    if (m.session) {
      size = m.session;
      phase = 'running';
      return;
    }
    const p = m.packet;
    if (!p) return;
    lastPacketAt = Date.now();
    if (p.config) {
      const c = avcCodec(p.data);
      if (!c) return fail(decoderError('SPS não encontrado no pacote de configuração'));
      const keep = codec === c && decoder;
      if (!keep) makeDecoder(c);
      config = p.data.slice();
      needKey = true;
      return;
    }
    if (!decoder || decoder.state !== 'configured') return;
    if (needKey && !p.key) return;
    let data = p.data;
    if (p.key && config) {
      // No formato Annex B o quadro-chave leva o SPS/PPS na frente.
      const merged = new Uint8Array(config.length + data.length);
      merged.set(config);
      merged.set(data, config.length);
      data = merged;
    }
    needKey = false;
    // Atrasou demais: pede um recomeço do vídeo e descarta até o quadro-chave que ele traz.
    // Sem pedir, a espera pode ser eterna: há encoder (MTK do L400) que só manda quadro-chave
    // quando a imagem muda muito. Sem controle não há como pedir: segue decodificando tudo.
    if (decoder.decodeQueueSize > 30 && !p.key && control && Date.now() - lastReset > 2000) {
      lastReset = Date.now();
      needKey = true;
      send(resetVideoMsg());
      return;
    }
    try {
      decoder.decode(new EncodedVideoChunk({ type: p.key ? 'key' : 'delta', timestamp: Number(p.pts), data }));
    } catch (e) {
      fail(decoderError(String(e)));
    }
  }

  async function start() {
    const s = serial;
    if (!s || phase === 'starting' || phase === 'running') return;
    if (!hasWebCodecs) return fail(decoderError('VideoDecoder indisponível'));
    try {
      const sup = await VideoDecoder.isConfigSupported({ codec: 'avc1.42E01F', optimizeForLatency: true });
      if (!sup.supported) return fail(decoderError('H.264 sem suporte no VideoDecoder'));
    } catch (e) {
      return fail(decoderError(String(e)));
    }
    saveOpts();
    error = null;
    phase = 'starting';
    mirrorSerial = s;
    devName = '';
    size = { w: 0, h: 0 };
    screenOff = false;
    lastFrameAt = 0;
    lastPacketAt = 0;
    resetDecoder();
    try {
      // Tela apagada vira vídeo preto; sem controle, nada a acenderia depois.
      await wakeScreen(s);
      const q = QUALITY[quality];
      mirrorId = await mirrorStart(s, { maxSize: q.maxSize, bitRate: q.bitRate, maxFps, control, stayAwake }, onData);
      // Sem o Tauri (prévia no navegador) não há vídeo: mostra a área como se estivesse rodando.
      if (!isTauri) {
        size = { w: 720, h: 1600 };
        phase = 'running';
      }
      frames = 0;
      clearInterval(fpsTimer);
      fpsTimer = setInterval(() => {
        fps = frames;
        frames = 0;
        // Chega vídeo mas nenhum quadro sai há 3 s (esperando um quadro-chave que não vem):
        // pede um recomeço do vídeo ao servidor.
        const now = Date.now();
        if (control && lastFrameAt && now - lastPacketAt < 1500 && now - lastFrameAt > 3000 && now - lastReset > 3000) {
          lastReset = now;
          needKey = true;
          send(resetVideoMsg());
        }
      }, 1000);
      canvas?.focus();
    } catch (e) {
      fail(classify(String(e))!);
    }
  }

  function fail(e: AdbError) {
    error = e;
    phase = 'error';
    stop(false);
  }

  async function stop(toIdle = true) {
    clearInterval(fpsTimer);
    const id = mirrorId;
    mirrorId = null;
    resetDecoder();
    if (toIdle) phase = 'idle';
    if (id != null) await api.mirrorStop(id).catch(() => undefined);
  }

  function send(msg: number[]) {
    if (mirrorId == null || !control) return;
    api.mirrorControl(mirrorId, msg).catch(() => undefined);
  }

  // ---------- toque e teclado ----------
  let pointerDown = false;
  function point(e: PointerEvent | WheelEvent): [number, number] | null {
    if (!canvas || !size.w) return null;
    const r = canvas.getBoundingClientRect();
    // O canvas mantém a proporção dentro do retângulo (object-fit: contain).
    const scale = Math.min(r.width / size.w, r.height / size.h);
    const vw = size.w * scale;
    const vh = size.h * scale;
    const x = (e.clientX - r.left - (r.width - vw) / 2) / scale;
    const y = (e.clientY - r.top - (r.height - vh) / 2) / scale;
    if (x < 0 || y < 0 || x > size.w || y > size.h) return null;
    return [x, y];
  }
  function onPointer(e: PointerEvent, action: number) {
    if (!control || e.button > 0) return;
    if (action === ACTION_MOVE && !pointerDown) return;
    const p = point(e);
    if (!p && action !== ACTION_UP) return;
    if (action === ACTION_DOWN) {
      pointerDown = true;
      canvas?.setPointerCapture(e.pointerId);
      canvas?.focus();
    }
    if (action === ACTION_UP) {
      if (!pointerDown) return;
      pointerDown = false;
    }
    const [x, y] = p ?? [0, 0];
    send(touchMsg(action, Math.min(Math.max(x, 0), size.w), Math.min(Math.max(y, 0), size.h), size.w, size.h));
    e.preventDefault();
  }
  function onWheel(e: WheelEvent) {
    if (!control) return;
    const p = point(e);
    if (!p) return;
    e.preventDefault();
    const v = Math.max(-1, Math.min(1, -e.deltaY / 100));
    const h = Math.max(-1, Math.min(1, -e.deltaX / 100));
    send(scrollMsg(p[0], p[1], size.w, size.h, h, v));
  }
  function onKey(e: KeyboardEvent, down: boolean) {
    if (!control || phase !== 'running') return;
    const code = androidKeycode(e.key);
    if (code != null) {
      e.preventDefault();
      send(keyMsg(down ? 0 : 1, code));
      return;
    }
    if (down && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      send(textMsg(e.key));
    }
  }
  function press(code: number) {
    send(keyMsg(0, code));
    send(keyMsg(1, code));
    canvas?.focus();
  }
  function toggleScreen() {
    screenOff = !screenOff;
    send(displayPowerMsg(!screenOff));
  }

  // O alvo mudou durante o espelho: para (o espelho é de um aparelho só).
  $effect(() => {
    if (mirrorId != null && serial !== mirrorSerial) stop();
  });

  let offEnded: (() => void) | undefined;
  onMount(async () => {
    offEnded = await listen<{ id: number; error: string | null }>('mirror-ended', (e) => {
      if (e.id !== mirrorId) return;
      mirrorId = null;
      clearInterval(fpsTimer);
      resetDecoder();
      if (e.error) {
        error = classify(`MIRROR_SERVER: ${e.error}`);
        phase = 'error';
      } else phase = 'idle';
    });
  });
  onDestroy(() => {
    offEnded?.();
    stop();
  });

  const target = $derived(serial ? findDevice(serial) : undefined);
</script>

<div class="page">
  <TopBar heading={t('mirror.title')} sub={t('mirror.subtitle')} />
  <div class="page-body">
    <PageGuideOffer page="mirror" />
    <section class="card opts" data-guide="mirror-options">
      <div class="row">
        <label class="field">
          <span class="muted small">{t('mirror.quality')}</span>
          <select class="select sm" bind:value={quality} disabled={phase === 'starting' || phase === 'running'}>
            {#each Object.keys(QUALITY) as q (q)}<option value={q}>{t(`mirror.q.${q}` as Parameters<typeof t>[0])}</option>{/each}
          </select>
        </label>
        <label class="field">
          <span class="muted small">{t('mirror.fps')}</span>
          <select class="select sm" bind:value={maxFps} disabled={phase === 'starting' || phase === 'running'}>
            {#each [15, 30, 60] as f (f)}<option value={f}>{f}</option>{/each}
          </select>
        </label>
        <label class="check"><input type="checkbox" bind:checked={control} disabled={phase === 'starting' || phase === 'running'} />{t('mirror.control')}</label>
        <label class="check"><input type="checkbox" bind:checked={stayAwake} disabled={!control || phase === 'starting' || phase === 'running'} />{t('mirror.stayAwake')}</label>
        <div class="spacer"></div>
        {#if phase === 'running' || phase === 'starting'}
          <button type="button" class="btn" onclick={() => stop()}><Icon name="stop" size={15} />{t('mirror.stop')}</button>
        {:else}
          <button type="button" class="btn primary" disabled={!ready} onclick={start}><Icon name="play" size={15} />{t('mirror.start')}</button>
        {/if}
      </div>
      <div class="muted small status">
        {#if !serial}
          {t('common.chooseDevice')}
        {:else if phase === 'starting'}
          <span class="spin"><Icon name="spinner" size={13} /></span>{t('mirror.starting', { name: deviceName(serial) })}
        {:else if phase === 'running'}
          {t('mirror.running', { name: devName || deviceName(mirrorSerial), serial: serialOf(mirrorSerial) ?? mirrorSerial, w: size.w, h: size.h, fps })}
        {:else if !ready}
          {t('mirror.notReady', { name: deviceName(serial), state: target?.state ?? '' })}
        {:else}
          {t('mirror.idle', { name: deviceName(serial) })}
        {/if}
      </div>
    </section>

    {#if phase === 'error' && error}
      <ErrorState {error} serial={mirrorSerial || serial} onretry={start} />
    {/if}

    <div class="stage" class:on={phase === 'running' || phase === 'starting'} data-guide="mirror-screen">
      {#if phase === 'running' || phase === 'starting'}
        <div class="screen-wrap">
          <canvas
            bind:this={canvas}
            class="screen"
            class:ctl={control}
            tabindex="0"
            aria-label={t('mirror.screenLabel', { name: deviceName(mirrorSerial) })}
            onpointerdown={(e) => onPointer(e, ACTION_DOWN)}
            onpointermove={(e) => onPointer(e, ACTION_MOVE)}
            onpointerup={(e) => onPointer(e, ACTION_UP)}
            onpointercancel={(e) => onPointer(e, ACTION_UP)}
            onwheel={onWheel}
            onkeydown={(e) => onKey(e, true)}
            onkeyup={(e) => onKey(e, false)}
            oncontextmenu={(e) => {
              e.preventDefault();
              if (control) press(KEY.back);
            }}
          ></canvas>
          {#if !size.w}<div class="wait"><span class="spin"><Icon name="spinner" size={20} /></span>{t('mirror.waiting')}</div>{/if}
        </div>
        {#if control}
          <div class="keys" role="toolbar" aria-label={t('mirror.keys')}>
            <button type="button" class="btn sm" onclick={() => press(KEY.back)} title={t('mirror.k.backHint')}><Icon name="left" size={14} />{t('mirror.k.back')}</button>
            <button type="button" class="btn sm" onclick={() => press(KEY.home)}>{t('mirror.k.home')}</button>
            <button type="button" class="btn sm" onclick={() => press(KEY.appSwitch)}>{t('mirror.k.recents')}</button>
            <span class="sep"></span>
            <button type="button" class="btn sm" onclick={() => press(KEY.volumeDown)}>{t('mirror.k.volDown')}</button>
            <button type="button" class="btn sm" onclick={() => press(KEY.volumeUp)}>{t('mirror.k.volUp')}</button>
            <button type="button" class="btn sm" onclick={() => press(KEY.power)}><Icon name="power" size={14} />{t('mirror.k.power')}</button>
            <span class="sep"></span>
            <button type="button" class="btn sm" onclick={() => send(notificationsMsg())}>{t('mirror.k.notifications')}</button>
            <button type="button" class="btn sm" onclick={() => send(rotateMsg())}><Icon name="refresh" size={14} />{t('mirror.k.rotate')}</button>
            <button type="button" class="btn sm" aria-pressed={screenOff} onclick={toggleScreen}>{screenOff ? t('mirror.k.screenOn') : t('mirror.k.screenOff')}</button>
          </div>
          <div class="muted small hint">{t('mirror.hint')}</div>
        {/if}
      {:else if phase !== 'error'}
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
  .check {
    height: 30px;
  }
  .check {
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
  .stage {
    flex: 1 1 auto;
    min-height: 320px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .screen-wrap {
    position: relative;
    flex: 1 1 auto;
    width: 100%;
    min-height: 300px;
    display: flex;
    justify-content: center;
    background: var(--term-bg);
    border-radius: 12px;
    overflow: hidden;
  }
  .screen {
    width: 100%;
    height: 100%;
    max-height: calc(100vh - 330px);
    min-height: 300px;
    object-fit: contain;
    outline: none;
    touch-action: none;
  }
  .screen.ctl {
    cursor: pointer;
  }
  .screen:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .wait {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: #c9d1d9;
    font-size: 13px;
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
