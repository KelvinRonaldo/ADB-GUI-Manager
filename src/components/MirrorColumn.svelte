<script lang="ts">
  // Coluna curta ao lado da tela (janela destacada e tela cheia): navegação, volume e "Mais".
  import Icon from './Icon.svelte';
  import MirrorMore, { type MoreItem } from './MirrorMore.svelte';
  import { t } from '../lib/i18n.svelte';
  import { KEY } from '../lib/mirror';
  import type { MirrorSession } from '../lib/mirrorSession.svelte';

  let { session, more, onmenu }: { session: MirrorSession; more: MoreItem[]; onmenu?: (open: boolean) => void } = $props();

  const keys = [
    { icon: 'back', label: 'mirror.k.back', code: KEY.back },
    { icon: 'home', label: 'mirror.k.home', code: KEY.home },
    { icon: 'recents', label: 'mirror.k.recents', code: KEY.appSwitch },
  ] as const;
  const vol = [
    { icon: 'volUp', label: 'mirror.k.volUp', code: KEY.volumeUp },
    { icon: 'volDown', label: 'mirror.k.volDown', code: KEY.volumeDown },
  ] as const;
</script>

<div class="col" role="toolbar" aria-orientation="vertical" aria-label={t('mirror.keys')}>
  {#if session.control}
    {#each keys as k (k.icon)}
      <button type="button" class="cb" title={t(k.label)} aria-label={t(k.label)} onclick={() => session.press(k.code)}><Icon name={k.icon} size={18} /></button>
    {/each}
    <span class="sep"></span>
    {#each vol as k (k.icon)}
      <button type="button" class="cb" title={t(k.label)} aria-label={t(k.label)} onclick={() => session.press(k.code)}><Icon name={k.icon} size={18} /></button>
    {/each}
    <span class="sep"></span>
  {/if}
  <MirrorMore items={more} variant="column" onopen={onmenu} />
</div>

<style>
  .col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 4px;
    background: #1a1e24;
    border: 1px solid #2c323b;
    border-radius: 12px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  }
  .cb {
    width: 36px;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: #d5dae2;
    cursor: pointer;
  }
  .cb:hover {
    background: #2c323b;
    color: #fff;
  }
  .cb:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .sep {
    width: 22px;
    height: 1px;
    background: #2c323b;
    margin: 3px 0;
  }
</style>
