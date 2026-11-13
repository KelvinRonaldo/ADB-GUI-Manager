<script lang="ts">
  // Aviso de versão nova, progresso do download, instalação e novidades depois de reabrir.
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import UpdateError from './UpdateError.svelte';
  import { lang, t } from '../lib/i18n.svelte';
  import { formatBytes } from '../lib/format';
  import { cancelDownload, downloadAndInstall, noteLines, openReleases, upd } from '../lib/update.svelte';

  const c = $derived(upd.check);
  const busy = $derived(upd.phase === 'downloading' || upd.phase === 'installing');
  const title = $derived(
    upd.phase === 'updated' ? t('update.dlgUpdated', { v: upd.updated?.to ?? '' }) : busy || (upd.phase === 'error' && c?.available) ? t('update.dlgUpdating') : t('update.dlgAvailable'),
  );
  const step = $derived(upd.phase === 'installing' ? 2 : 0);
  const pct = $derived(upd.progress?.total ? Math.min(100, Math.round((upd.progress.received / upd.progress.total) * 100)) : null);
  const left = $derived(
    upd.progress?.total && upd.progress.bytesPerSec > 0 ? Math.max(1, Math.round((upd.progress.total - upd.progress.received) / upd.progress.bytesPerSec)) : null,
  );
  const date = $derived(c?.date ? new Date(c.date).toLocaleDateString(lang.current) : null);
  const notes = $derived(noteLines(upd.phase === 'updated' ? upd.updated?.notes : c?.notes));
  const steps = $derived([t('update.step.download'), t('update.step.verify'), t('update.step.install'), t('update.step.reopen')]);

  function close() {
    // Durante a instalação o app vai fechar sozinho; não há o que fechar.
    if (upd.phase === 'installing') return;
    upd.dialog = false;
  }
</script>

<Modal {title} onclose={close} closable={upd.phase !== 'installing'} width={upd.phase === 'downloading' || upd.phase === 'installing' ? 600 : 540}>
  {#if upd.phase === 'updated'}
    {#if notes.length}
      <ul class="notes">{#each notes as n, i (i)}<li>{n}</li>{/each}</ul>
    {/if}
    <button type="button" class="btn sm ghost link" onclick={openReleases}>{t('update.fullRelease')} ↗</button>
  {:else if upd.phase === 'downloading' || upd.phase === 'installing'}
    <div class="progress-grid">
      <ol class="steps">
        {#each steps as s, i (i)}
          <li class:done={i < step} class:cur={i === step}>
            <span class="mark" aria-hidden="true">
              {#if i < step}<Icon name="check" size={13} />{:else if i === step}<span class="spin"><Icon name="spinner" size={13} /></span>{:else}{i + 1}{/if}
            </span>{s}
          </li>
        {/each}
      </ol>
      {#if upd.phase === 'downloading'}
        <div class="col">
          <div class="between"><strong>{t('update.downloadingTitle', { v: c?.version ?? '' })}</strong><span>{pct != null ? `${pct}%` : ''}</span></div>
          <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct ?? undefined}><div style="width: {pct ?? 8}%"></div></div>
          <div class="between muted small">
            <span>
              {#if upd.progress?.total}{t('update.ofSize', { a: formatBytes(upd.progress.received, lang.current), b: formatBytes(upd.progress.total, lang.current) })}{:else if upd.progress}{formatBytes(upd.progress.received, lang.current)}{/if}
              {#if upd.progress?.bytesPerSec}· {t('update.speed', { s: formatBytes(upd.progress.bytesPerSec, lang.current) })}{/if}
            </span>
            <span>{left != null ? t('update.remaining', { n: left }) : ''}</span>
          </div>
          <div class="muted small">{t('update.keepUsing')}</div>
        </div>
      {:else}
        <div class="col">
          <div class="ok small"><Icon name="check" size={14} />{t('update.verified')}</div>
          <div class="installing"><span class="spin"><Icon name="spinner" size={15} /></span>{t('update.installingTitle', { v: c?.version ?? '' })}</div>
          <div>{t('update.installingText')}</div>
          {#if upd.info?.package === 'deb'}<div class="muted small">{t('update.installingDeb')}</div>{/if}
        </div>
      {/if}
    </div>
  {:else}
    {#if c?.available}
      <div class="versions">
        <div>
          <div>{t('update.youHave', { v: c.current })}</div>
          <div class="new">{t('update.newVersion', { v: c.version ?? '' })}</div>
        </div>
        <dl>
          {#if date}<dt>{t('update.published')}</dt><dd>{date}</dd>{/if}
          {#if c.downloaded}<dt>{t('update.downloadSize')}</dt><dd>{t('update.alreadyDownloaded')}</dd>
          {:else if c.size}<dt>{t('update.downloadSize')}</dt><dd>{formatBytes(c.size, lang.current)}</dd>{/if}
        </dl>
      </div>
      {#if notes.length}
        <div>
          <div class="h">{t('update.whatsNew')}</div>
          <ul class="notes">{#each notes as n, i (i)}<li>{n}</li>{/each}</ul>
          <button type="button" class="btn sm ghost link" onclick={openReleases}>{t('update.fullRelease')} ↗</button>
        </div>
      {/if}
    {/if}
    {#if upd.phase === 'error' && upd.error}
      <UpdateError error={upd.error} />
    {:else if c?.available}
      <div class="before">
        <strong>{t('update.beforeTitle')}</strong>
        <span>{c.openSessions > 0 ? t('update.beforeSessions', { n: c.openSessions }) : t('update.beforeText')}{#if upd.info?.package === 'deb'}{' '}{t('update.debPassword')}{/if}</span>
      </div>
      <div>{c.downloaded ? t('update.questionDownloaded', { v: c.version ?? '' }) : t('update.question', { v: c.version ?? '' })}</div>
    {/if}
  {/if}

  {#snippet footer()}
    {#if upd.phase === 'updated'}
      <button type="button" class="btn primary" onclick={close}>{t('common.close')}</button>
    {:else if upd.phase === 'downloading'}
      <button type="button" class="btn" onclick={cancelDownload}>{t('update.cancelDownload')}</button>
      <button type="button" class="btn primary" onclick={close}>{t('update.continueUsing')}</button>
    {:else if upd.phase === 'installing'}
      <span class="muted small">{t('update.noCancel')}</span>
    {:else if upd.phase === 'available'}
      <button type="button" class="btn" onclick={close}>{t('update.notNow')}</button>
      <button type="button" class="btn primary" onclick={downloadAndInstall}><Icon name="download" size={16} />{c?.downloaded ? t('update.installReopen') : t('update.downloadInstall')}</button>
    {:else}
      <button type="button" class="btn" onclick={close}>{t('common.close')}</button>
    {/if}
  {/snippet}
</Modal>

<style>
  .versions {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--accent-soft);
    font-size: 13px;
  }
  .new {
    font-size: 20px;
    font-weight: 700;
    color: var(--accent);
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: auto auto;
    column-gap: 10px;
    row-gap: 3px;
    font-size: 12px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
  }
  .h {
    font-weight: 700;
    margin-bottom: 6px;
  }
  .notes {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    line-height: 19px;
  }
  .link {
    padding: 0;
    margin-top: 6px;
  }
  .before {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--warn-bg);
    color: var(--warn-fg);
    font-size: 13px;
    line-height: 19px;
  }
  .before strong {
    flex: 0 0 auto;
  }
  .progress-grid {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    gap: 22px;
    align-items: start;
    font-size: 13px;
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    color: var(--muted);
  }
  .steps li {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .steps li.done {
    color: var(--text);
  }
  .steps li.cur {
    color: var(--accent);
    font-weight: 700;
  }
  .mark {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1.5px solid var(--border-strong);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    flex: 0 0 auto;
  }
  .done .mark {
    border-color: transparent;
    background: var(--ok-bg);
    color: var(--ok-fg);
  }
  .cur .mark {
    border-color: transparent;
    background: var(--accent-soft);
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .between {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }
  .bar {
    height: 10px;
    border-radius: 5px;
    background: var(--border);
    overflow: hidden;
  }
  .bar > div {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
  }
  .small {
    font-size: 12px;
  }
  .ok {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--ok-fg);
  }
  .installing {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 14px;
    font-weight: 700;
  }
  .spin {
    display: inline-flex;
  }
  @media (max-width: 640px) {
    .progress-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
