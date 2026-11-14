<script lang="ts">
  // Tour da primeira abertura e guia detalhado de cada página: destaca um elemento
  // por vez (escurecendo o resto) com um cartão de explicação ao lado.
  import { tick } from 'svelte';
  import { t } from '../lib/i18n.svelte';
  import { PAGE_GUIDES, TOUR, bodyKey, titleKey, type GuideStep } from '../lib/guides';
  import { app, saveSettings, startTour, toast } from '../lib/state.svelte';
  import type { Key } from '../lib/i18n.svelte';

  const isTour = $derived(app.tour.active && !app.tour.question);
  const steps = $derived<GuideStep[]>(isTour ? TOUR : app.guide.active && app.guide.page ? PAGE_GUIDES[app.guide.page] : []);
  const index = $derived(isTour ? app.tour.step : app.guide.step);
  const step = $derived(steps[index]);
  const pageName = $derived(app.guide.page ? t(`nav.${app.guide.page}` as Key) : '');

  let rect = $state<DOMRect | null>(null);
  let card: HTMLElement | undefined = $state();
  let cardPos = $state({ left: 0, top: 0 });

  async function measure() {
    if (!step) return;
    await tick();
    const el = document.querySelector<HTMLElement>(`[data-guide="${step.target}"]`);
    if (!el) {
      rect = null;
      cardPos = { left: Math.max(16, window.innerWidth / 2 - 180), top: Math.max(16, window.innerHeight / 2 - 120) };
      return;
    }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    await new Promise((r) => requestAnimationFrame(r));
    rect = el.getBoundingClientRect();
    placeCard();
  }

  function placeCard() {
    if (!rect) return;
    const w = card?.offsetWidth ?? 360;
    const h = card?.offsetHeight ?? 200;
    const pad = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left: number;
    let top: number;
    if (rect.right + pad + w < vw && rect.width < vw * 0.4) {
      left = rect.right + pad;
      top = rect.top;
    } else if (rect.bottom + pad + h < vh) {
      left = rect.left;
      top = rect.bottom + pad;
    } else if (rect.top - pad - h > 0) {
      left = rect.left;
      top = rect.top - pad - h;
    } else {
      left = vw / 2 - w / 2;
      top = vh / 2 - h / 2;
    }
    cardPos = { left: Math.min(Math.max(16, left), vw - w - 16), top: Math.min(Math.max(16, top), vh - h - 16) };
  }

  $effect(() => {
    void step;
    void app.page;
    void app.devices.length;
    measure();
  });

  // A tela pode mudar por baixo do guia (aparelho chegando, lista carregando).
  $effect(() => {
    if (!step) return;
    const h = setInterval(() => {
      const el = document.querySelector<HTMLElement>(`[data-guide="${step.target}"]`);
      const r = el?.getBoundingClientRect();
      if (!r && rect) measure();
      else if (r && (!rect || Math.abs(r.top - rect.top) > 1 || Math.abs(r.left - rect.left) > 1 || Math.abs(r.width - rect.width) > 1 || Math.abs(r.height - rect.height) > 1)) {
        rect = r;
        placeCard();
      }
    }, 400);
    return () => clearInterval(h);
  });

  function next() {
    if (isTour) {
      if (app.tour.step < TOUR.length - 1) app.tour.step++;
      else app.tour.question = true;
    } else if (app.guide.step < steps.length - 1) app.guide.step++;
    else app.guide.active = false;
  }
  function back() {
    if (isTour) app.tour.step = Math.max(0, app.tour.step - 1);
    else app.guide.step = Math.max(0, app.guide.step - 1);
  }
  function close() {
    if (isTour) app.tour.question = true;
    else {
      app.guide.active = false;
      toast(t('guide.later', { page: pageName }), 'info');
    }
  }
  function answer(ask: boolean) {
    app.settings.pageGuides = ask ? 'ask' : 'never';
    app.settings.tourDone = true;
    // A página de Aparelhos acabou de ser apresentada no tour.
    if (!app.settings.seenPages.includes('devices')) app.settings.seenPages.push('devices');
    saveSettings();
    app.tour = { active: false, step: 0, question: false, done: true };
    toast(t('tour.done'), 'success', { label: t('tour.again'), run: startTour });
  }
  function onkey(e: KeyboardEvent) {
    if (!step) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') back();
  }
</script>

<svelte:window onresize={measure} onkeydown={onkey} />

{#if step}
  <div class="layer" aria-hidden="true">
    {#if rect}
      <div class="hole" style="left:{rect.left - 6}px;top:{rect.top - 6}px;width:{rect.width + 12}px;height:{rect.height + 12}px"></div>
    {:else}
      <div class="dim"></div>
    {/if}
  </div>
  <div bind:this={card} class="coach" role="dialog" aria-labelledby="coach-t" style="left:{cardPos.left}px;top:{cardPos.top}px">
    <div class="row">
      <span class="count">
        {isTour ? t('tour.counter', { n: index + 1, total: steps.length }) : t('guide.counter', { page: pageName, n: index + 1, total: steps.length })}
      </span>
      <div class="spacer"></div>
      <button type="button" class="skip" onclick={close}>{isTour ? t('tour.skip') : t('guide.close')}</button>
    </div>
    <h2 id="coach-t">{t(titleKey(step))}</h2>
    <p>{t(bodyKey(step))}</p>
    <div class="row">
      {#each steps as _, i (i)}
        <span class="pt" class:on={i === index}></span>
      {/each}
      <div class="spacer"></div>
      {#if index > 0}<button type="button" class="btn" onclick={back}>{t('common.back')}</button>{/if}
      <button type="button" class="btn primary" onclick={next}>{index === steps.length - 1 ? t('common.finish') : t('common.next')}</button>
    </div>
  </div>
{/if}

{#if app.tour.active && app.tour.question}
  <div class="qscrim">
    <div class="q" role="dialog" aria-modal="true" aria-labelledby="q-t">
      <h2 id="q-t">{t('tour.q.t')}</h2>
      <p>{t('tour.q.b')}</p>
      <button type="button" class="btn primary lg" onclick={() => answer(true)}>{t('tour.q.yes')}</button>
      <button type="button" class="btn lg" onclick={() => answer(false)}>{t('tour.q.no')}</button>
      <div class="note">{t('tour.q.note')}</div>
    </div>
  </div>
{/if}

<style>
  .layer {
    position: fixed;
    inset: 0;
    z-index: 70;
    pointer-events: none;
  }
  .hole {
    position: fixed;
    border-radius: 12px;
    box-shadow:
      0 0 0 3px var(--accent),
      0 0 0 9999px var(--scrim);
    transition: all 0.18s ease;
  }
  .dim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
  }
  .coach {
    position: fixed;
    z-index: 75;
    width: 360px;
    max-width: calc(100vw - 32px);
    background: var(--surface);
    border-radius: 14px;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-shadow: 0 16px 40px rgba(15, 23, 42, 0.35);
    border: 1px solid var(--border);
  }
  .count {
    font-size: 12px;
    font-weight: 700;
    color: var(--accent);
  }
  .skip {
    border: 0;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    padding: 4px;
  }
  h2 {
    font-size: 17px;
    font-weight: 700;
  }
  p {
    margin: 0;
    font-size: 14px;
    line-height: 21px;
  }
  .pt {
    width: 8px;
    height: 8px;
    border-radius: 4px;
    background: var(--border-strong);
  }
  .pt.on {
    background: var(--accent);
  }
  .spacer {
    flex: 1 1 auto;
  }
  .qscrim {
    position: fixed;
    inset: 0;
    z-index: 85;
    background: var(--scrim);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  .q {
    width: 100%;
    max-width: 520px;
    background: var(--surface);
    border-radius: 16px;
    padding: 28px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: var(--shadow);
  }
  .q h2 {
    font-size: 20px;
  }
  .note {
    font-size: 12px;
    color: var(--muted);
  }
</style>
