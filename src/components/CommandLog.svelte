<script lang="ts">
  import Icon from './Icon.svelte';
  import { t, lang } from '../lib/i18n.svelte';
  import { app, clearLog, toast } from '../lib/state.svelte';
  import { copyText } from '../lib/ipc';
  import { formatTime } from '../lib/format';

  let box: HTMLDivElement | undefined = $state();
  let stick = true;

  $effect(() => {
    void app.log.length;
    if (box && stick) queueMicrotask(() => box && (box.scrollTop = box.scrollHeight));
  });

  function onScroll() {
    if (!box) return;
    stick = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
  }

  async function copyAll() {
    await copyText(app.log.map((e) => e.cmd).join('\n'));
    toast(t('common.copied'), 'success', undefined, 2000);
  }
  async function copyOne(cmd: string) {
    await copyText(cmd);
    toast(t('common.copied'), 'success', undefined, 2000);
  }
</script>

<section class="log" class:closed={!app.logOpen} aria-label={t('log.title')} data-guide="tour-log">
  <div class="head">
    <h2 class="section-title">{t('log.title')}</h2>
    <span class="hint">{t('log.subtitle')}</span>
    <div class="spacer"></div>
    {#if app.logOpen}
      <button type="button" class="linkbtn" onclick={copyAll}>{t('log.copyAll')}</button>
      <button type="button" class="linkbtn" onclick={clearLog}>{t('common.clear')}</button>
    {/if}
    <button
      type="button"
      class="toggle"
      aria-label={app.logOpen ? t('log.collapse') : t('log.expand')}
      aria-expanded={app.logOpen}
      onclick={() => (app.logOpen = !app.logOpen)}
    >
      <Icon name={app.logOpen ? 'down' : 'up'} size={16} />
    </button>
  </div>
  {#if app.logOpen}
    <div class="rows" bind:this={box} onscroll={onScroll}>
      {#each app.log as e (e.id)}
        <div class="r">
          <span class="time">{formatTime(e.ts, lang.current)}</span>
          <button type="button" class="cmd" title={t('log.copyLine')} onclick={() => copyOne(e.cmd)}>$ {e.cmd}</button>
          {#if e.state === 'running'}
            <span class="code run"><Icon name="spinner" size={12} class="spin" /> {t('log.running')}</span>
          {:else if e.code === 0}
            <span class="code ok"><Icon name="check" size={12} /> 0</span>
          {:else if e.code === 130 && !e.error}
            <span class="code stopped"><Icon name="stop" size={12} /> {t('log.stopped')}</span>
          {:else}
            <span class="code bad" title={e.error ?? ''}><Icon name="close" size={12} /> {e.code}{e.error ? ` ${e.error}` : ''}</span>
          {/if}
          <span class="ms">{e.durationMs != null ? `${e.durationMs} ms` : ''}</span>
        </div>
      {:else}
        <div class="empty-log">{t('log.empty')}</div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .log {
    flex: 0 0 160px;
    height: 160px;
    background: var(--surface);
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
  }
  .log.closed {
    flex-basis: 38px;
    height: 38px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 16px 6px 24px;
    border-bottom: 1px solid var(--surface-3);
    min-height: 38px;
  }
  .hint {
    font-size: 12px;
    color: var(--muted);
  }
  .spacer {
    flex: 1 1 auto;
  }
  .toggle {
    border: 0;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    padding: 4px;
    display: flex;
  }
  .rows {
    flex: 1 1 auto;
    overflow: auto;
    padding: 4px 24px;
    font-family: var(--mono);
    font-size: 12px;
    line-height: 22px;
  }
  .r {
    display: flex;
    gap: 14px;
    white-space: nowrap;
    align-items: center;
  }
  .time {
    color: var(--muted);
  }
  .cmd {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
    border: 0;
    background: transparent;
    padding: 0;
    font: inherit;
    cursor: copy;
  }
  .cmd:hover {
    color: var(--accent);
  }
  .code {
    flex: 0 0 auto;
    font-weight: 500;
    max-width: 360px;
    overflow: hidden;
    text-overflow: ellipsis;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .code.ok {
    color: #15803d;
  }
  :global([data-theme='dark']) .code.ok {
    color: #86efac;
  }
  .code.bad {
    color: var(--err-fg);
  }
  .code.run {
    color: var(--accent);
  }
  .code.stopped {
    color: var(--muted);
  }
  .ms {
    color: var(--muted);
    width: 72px;
    text-align: right;
  }
  .empty-log {
    color: var(--muted);
    font-family: var(--font);
  }
</style>
