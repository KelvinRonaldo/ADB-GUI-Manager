<script lang="ts">
  // Tela espelhada: o <canvas> do vídeo, com toque, rolagem e teclado indo para o aparelho.
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte';
  import { deviceName } from '../lib/state.svelte';
  import { ACTION_DOWN, ACTION_MOVE, ACTION_UP, KEY, androidKeycode, keyMsg, scrollMsg, textMsg, touchMsg } from '../lib/mirror';
  import type { MirrorSession } from '../lib/mirrorSession.svelte';

  let {
    session,
    onescape,
    ring = true,
  }: {
    session: MirrorSession;
    /** Contorno de foco na tela (fora da tela cheia e da janela destacada). */
    ring?: boolean;
    /** Esc sai da tela cheia em vez de virar Voltar no aparelho. */
    onescape?: () => void;
  } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  $effect(() => {
    session.setCanvas(canvas ?? null);
    return () => session.setCanvas(null);
  });

  export function focus(): void {
    canvas?.focus();
  }

  let pointerDown = false;
  function point(e: PointerEvent | WheelEvent): [number, number] | null {
    const size = session.size;
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
    if (!session.control || e.button > 0) return;
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
    const { w, h } = session.size;
    const [x, y] = p ?? [0, 0];
    session.send(touchMsg(action, Math.min(Math.max(x, 0), w), Math.min(Math.max(y, 0), h), w, h));
    e.preventDefault();
  }
  function onWheel(e: WheelEvent) {
    if (!session.control) return;
    const p = point(e);
    if (!p) return;
    e.preventDefault();
    const v = Math.max(-1, Math.min(1, -e.deltaY / 100));
    const hh = Math.max(-1, Math.min(1, -e.deltaX / 100));
    session.send(scrollMsg(p[0], p[1], session.size.w, session.size.h, hh, v));
  }
  function onKey(e: KeyboardEvent, down: boolean) {
    if (e.key === 'F11') return; // tela cheia: tratada por quem mostra a tela
    if (e.key === 'Escape' && onescape) {
      e.preventDefault();
      e.stopPropagation();
      if (down) onescape();
      return;
    }
    if (!session.control || session.phase !== 'running') return;
    const code = androidKeycode(e.key);
    if (code != null) {
      e.preventDefault();
      session.send(keyMsg(down ? 0 : 1, code));
      return;
    }
    if (down && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      session.send(textMsg(e.key));
    }
  }
</script>

<div class="screen-wrap">
  <canvas
    bind:this={canvas}
    class="screen"
    class:ctl={session.control}
    class:ring
    tabindex="0"
    aria-label={t('mirror.screenLabel', { name: deviceName(session.serial) })}
    onpointerdown={(e) => onPointer(e, ACTION_DOWN)}
    onpointermove={(e) => onPointer(e, ACTION_MOVE)}
    onpointerup={(e) => onPointer(e, ACTION_UP)}
    onpointercancel={(e) => onPointer(e, ACTION_UP)}
    onwheel={onWheel}
    onkeydown={(e) => onKey(e, true)}
    onkeyup={(e) => onKey(e, false)}
    oncontextmenu={(e) => {
      e.preventDefault();
      if (session.control) session.press(KEY.back);
    }}
  ></canvas>
  {#if !session.size.w}<div class="wait"><span class="spin"><Icon name="spinner" size={20} /></span>{t('mirror.waiting')}</div>{/if}
</div>

<style>
  .screen-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    display: flex;
    justify-content: center;
  }
  .screen {
    width: 100%;
    height: 100%;
    object-fit: contain;
    outline: none;
    touch-action: none;
  }
  .screen.ctl {
    cursor: pointer;
  }
  .screen.ring:focus-visible {
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
  .spin {
    display: inline-flex;
  }
</style>
