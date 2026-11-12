<script lang="ts">
  import Icon from './Icon.svelte';
  import { t, type Key } from '../lib/i18n.svelte';
  import { PAGE_GUIDES } from '../lib/guides';
  import { app, markPageSeen, saveSettings, shouldOfferGuide, startPageGuide, toast } from '../lib/state.svelte';
  import type { Page } from '../lib/types';

  let { page }: { page: Page } = $props();
  const name = $derived(t(`nav.${page}` as Key));
  const count = $derived(PAGE_GUIDES[page]?.length ?? 0);

  function notNow() {
    markPageSeen(page);
    toast(t('guide.later', { page: name }), 'info');
  }
  function never() {
    markPageSeen(page);
    app.settings.pageGuides = 'never';
    saveSettings();
  }
</script>

{#if count && shouldOfferGuide(page)}
  <section class="offer" aria-labelledby="offer-{page}">
    <div class="ic"><Icon name="help" size={20} stroke={2} /></div>
    <div class="txt">
      <h2 id="offer-{page}">{t('guide.offerTitle', { page: name })}</h2>
      <div class="sub">{t('guide.offerText', { n: count })}</div>
    </div>
    <div class="row">
      <button type="button" class="btn primary" onclick={() => startPageGuide(page)}>{t('guide.see')}</button>
      <button type="button" class="btn" onclick={notNow}>{t('guide.notNow')}</button>
      <button type="button" class="linkbtn plain" onclick={never}>{t('guide.never')}</button>
    </div>
  </section>
{/if}

<style>
  .offer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 16px;
    background: var(--accent-soft);
    border: 1px solid var(--accent-border);
    border-radius: 12px;
    padding: 14px 16px;
  }
  .ic {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--accent);
    color: var(--on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .txt {
    flex: 1 1 320px;
    min-width: 0;
  }
  h2 {
    font-size: 15px;
    font-weight: 700;
  }
  .sub {
    font-size: 13px;
    color: var(--muted);
  }
  .plain {
    color: var(--muted);
    font-weight: 500;
    text-decoration: underline;
    font-size: 12px;
  }
</style>
