<script lang="ts">
  // Primeira tela do app: o idioma vem antes de tudo (antes de procurar o adb e do tour).
  // Os textos aparecem nos dois idiomas porque ainda não há escolha.
  import Icon from '../components/Icon.svelte';
  import Flag from '../components/Flag.svelte';
  import { detectLang } from '../lib/i18n.svelte';
  import { setLanguage } from '../lib/state.svelte';
  import type { Lang } from '../lib/types';

  const detected = detectLang();
  const OPTIONS: { lang: Lang; name: string; region: string; hint: string }[] = [
    { lang: 'pt-BR', name: 'Português', region: 'Brasil', hint: 'Continuar em português' },
    { lang: 'en-US', name: 'English', region: 'United States', hint: 'Continue in English' },
  ];
  const ordered = OPTIONS.slice().sort((a, b) => (a.lang === detected ? -1 : b.lang === detected ? 1 : 0));

  function choose(l: Lang) {
    setLanguage(l);
  }

  function autofocus(node: HTMLElement, on: boolean) {
    if (on) queueMicrotask(() => node.focus());
  }
</script>

<div class="wrap">
  <main class="box" aria-labelledby="lang-title">
    <div class="logo"><Icon name="terminalApp" size={28} stroke={2.2} /></div>
    <h1 id="lang-title">
      <span lang="pt-BR">Escolha o idioma</span>
      <span class="sep" aria-hidden="true">·</span>
      <span lang="en">Choose your language</span>
    </h1>
    <div class="opts" role="group" aria-labelledby="lang-title">
      {#each ordered as o (o.lang)}
        <button type="button" class="opt" class:suggested={o.lang === detected} lang={o.lang} use:autofocus={o.lang === detected} onclick={() => choose(o.lang)}>
          <span class="top"><Flag lang={o.lang} width={44} /><span class="code">{o.lang}</span></span>
          <span class="name">{o.name}</span>
          <span class="region">{o.region}</span>
          <span class="hint">{o.hint} <Icon name="right" size={14} stroke={2.2} /></span>
        </button>
      {/each}
    </div>
    <p class="note">
      <span lang="pt-BR">Dá para mudar depois em Configurações.</span>
      <span lang="en">You can change it later in Settings.</span>
    </p>
  </main>
</div>

<style>
  .wrap {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    background: var(--surface-3);
  }
  .box {
    width: 100%;
    max-width: 640px;
    background: var(--surface);
    border-radius: 16px;
    box-shadow: var(--shadow);
    padding: 36px 32px 28px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 22px;
    text-align: center;
  }
  .logo {
    width: 52px;
    height: 52px;
    border-radius: 13px;
    background: #3ddc84;
    color: #10331f;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  h1 {
    font-size: 22px;
    font-weight: 700;
    line-height: 30px;
  }
  .sep {
    color: var(--muted);
    margin: 0 8px;
    font-weight: 400;
  }
  .opts {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 14px;
  }
  .opt {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    text-align: left;
    padding: 18px 18px 16px;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: var(--surface);
    cursor: pointer;
    transition:
      border-color 0.12s,
      background 0.12s;
  }
  .opt:hover,
  .opt:focus-visible {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .opt.suggested {
    border: 2px solid var(--accent);
    padding: 17px 17px 15px;
  }
  .top {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .code {
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    background: var(--surface-3);
    border-radius: 5px;
    padding: 2px 6px;
  }
  .name {
    font-size: 20px;
    font-weight: 700;
    margin-top: 6px;
  }
  .region {
    font-size: 13px;
    color: var(--muted);
  }
  .hint {
    margin-top: 10px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    font-weight: 600;
    color: var(--accent);
  }
  .note {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
</style>
