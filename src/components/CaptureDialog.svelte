<script lang="ts">
  // Prévia da captura de tela: imagem, dados e as ações Copiar, Salvar e Capturar de novo.
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { lang, t } from '../lib/i18n.svelte';
  import { formatBytes } from '../lib/format';
  import { cap, closeCapture, copyCapture, openCapture, saveCapture } from '../lib/capture.svelte';
  import { whenText } from '../lib/update.svelte';

  const title = $derived(t('capture.title', { name: cap.name }));

  function onkey(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'c' && !window.getSelection()?.toString()) {
      e.preventDefault();
      copyCapture();
    } else if (k === 's') {
      e.preventDefault();
      saveCapture();
    }
  }
</script>

<svelte:window onkeydown={onkey} />

<Modal {title} onclose={closeCapture} width={820}>
  <div class="grid">
    <div class="shot" aria-busy={cap.busy}>
      {#if cap.busy || !cap.info}
        <div class="wait"><span class="spin"><Icon name="spinner" size={26} /></span>{t('capture.capturing')}</div>
      {:else}
        <img src={cap.info.dataUrl} alt={t('capture.alt', { name: cap.name })} />
      {/if}
    </div>
    <div class="side" class:dim={cap.busy}>
      <dl>
        <dt>{t('capture.device')}</dt>
        <dd>{cap.name}</dd>
        <dt>{t('capture.serial')}</dt>
        <dd class="mono small">{cap.serial}</dd>
        <dt>{t('capture.resolution')}</dt>
        <dd>{cap.info ? `${cap.info.width} × ${cap.info.height}` : '…'}</dd>
        <dt>{t('capture.size')}</dt>
        <dd>{cap.info ? `${formatBytes(cap.info.size, lang.current)} · PNG` : '…'}</dd>
        <dt>{t('capture.taken')}</dt>
        <dd>{cap.info ? whenText(cap.at) : '…'}</dd>
      </dl>
      <div class="acts">
        <button type="button" class="btn primary" disabled={cap.busy || !cap.info} onclick={copyCapture}><Icon name="copy" size={16} />{t('capture.copy')}</button>
        <button type="button" class="btn outline" disabled={cap.busy || !cap.info} onclick={saveCapture}><Icon name="download" size={16} />{t('capture.save')}</button>
      </div>
      {#if cap.copied}
        <div class="done"><Icon name="check" size={14} />{t('capture.copied')}</div>
      {/if}
      {#if cap.savedTo}
        <div class="done"><Icon name="check" size={14} /><span class="path">{t('capture.savedTo', { path: cap.savedTo })}</span></div>
      {/if}
      <div class="muted small hint">{t('capture.hint')}</div>
    </div>
  </div>

  {#snippet footer()}
    <button type="button" class="btn" disabled={cap.busy} onclick={() => openCapture(cap.serial)}><Icon name="camera" size={16} />{t('capture.again')}</button>
    <span class="spacer"></span>
    <button type="button" class="btn" onclick={closeCapture}>{t('common.close')}</button>
  {/snippet}
</Modal>

<style>
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 250px;
    gap: 20px;
  }
  .shot {
    height: min(60vh, 520px);
    min-height: 260px;
    border-radius: 10px;
    background: var(--term-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 12px;
  }
  .shot img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 4px;
    box-shadow: 0 0 0 1px var(--term-border);
  }
  .wait {
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
    color: var(--term-text);
    font-size: 13px;
  }
  .spin {
    display: inline-flex;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .side.dim {
    opacity: 0.55;
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    row-gap: 7px;
    font-size: 13px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .acts {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .acts .btn {
    justify-content: center;
  }
  .done {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--ok-bg);
    color: var(--ok-fg);
    font-size: 12.5px;
  }
  .done .path {
    overflow-wrap: anywhere;
  }
  .hint {
    line-height: 18px;
  }
  .small {
    font-size: 12px;
  }
  .spacer {
    flex: 1 1 auto;
  }
</style>
