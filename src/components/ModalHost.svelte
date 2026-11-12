<script lang="ts">
  import Modal from './Modal.svelte';
  import ErrorPanel from './ErrorPanel.svelte';
  import { t } from '../lib/i18n.svelte';
  import { app, closeModal, toast } from '../lib/state.svelte';
  import { copyText } from '../lib/ipc';
  import type { ErrorAction } from '../lib/errors';

  let checked = $state(false);
  let values = $state<string[]>([]);

  $effect(() => {
    const m = app.modal;
    if (m?.kind === 'confirm') checked = m.check?.value ?? false;
    if (m?.kind === 'prompt') values = m.fields.map((f) => f.value);
  });

  function resolveConfirm(ok: boolean) {
    const m = app.modal;
    if (m?.kind !== 'confirm') return;
    closeModal();
    m.resolve({ ok, checked });
  }
  function resolvePrompt(ok: boolean) {
    const m = app.modal;
    if (m?.kind !== 'prompt') return;
    closeModal();
    m.resolve(ok ? [...values] : null);
  }
  function errorAction(a: ErrorAction) {
    const m = app.modal;
    if (m?.kind !== 'error') return;
    closeModal();
    m.handlers[a]?.();
  }
</script>

{#if app.modal?.kind === 'confirm'}
  {@const m = app.modal}
  <Modal title={m.title} onclose={() => resolveConfirm(false)} width={480}>
    <p class="p">{m.text}</p>
    {#if m.check}
      <label class="check"><input type="checkbox" bind:checked /> {m.check.label}</label>
    {/if}
    {#snippet footer()}
      <button type="button" class="btn" onclick={() => resolveConfirm(false)}>{t('common.cancel')}</button>
      <button type="button" class="btn {m.danger ? 'danger solid' : 'primary'}" onclick={() => resolveConfirm(true)}>{m.confirmLabel ?? t('confirm.go')}</button>
    {/snippet}
  </Modal>
{:else if app.modal?.kind === 'prompt'}
  {@const m = app.modal}
  <Modal title={m.title} onclose={() => resolvePrompt(false)} width={480}>
    <form
      class="fields"
      onsubmit={(e) => {
        e.preventDefault();
        resolvePrompt(true);
      }}
    >
      {#each m.fields as f, i (i)}
        <label class="field">
          {f.label}
          <input class="input" class:mono={f.mono} type={f.type ?? 'text'} placeholder={f.placeholder} bind:value={values[i]} />
        </label>
      {/each}
      <button type="submit" class="sr-only">{t('common.ok')}</button>
    </form>
    {#snippet footer()}
      <button type="button" class="btn" onclick={() => resolvePrompt(false)}>{t('common.cancel')}</button>
      <button type="button" class="btn primary" onclick={() => resolvePrompt(true)}>{m.confirmLabel ?? t('common.ok')}</button>
    {/snippet}
  </Modal>
{:else if app.modal?.kind === 'error'}
  {@const m = app.modal}
  <Modal title={t('err.generic.t')} onclose={closeModal} width={560}>
    <ErrorPanel error={m.error} available={(a) => !!m.handlers[a]} onaction={errorAction} />
    {#snippet footer()}
      <button type="button" class="btn" onclick={closeModal}>{t('common.close')}</button>
    {/snippet}
  </Modal>
{:else if app.modal?.kind === 'text'}
  {@const m = app.modal}
  <Modal title={m.title} onclose={closeModal} width={760}>
    <pre class="term big">{m.text}</pre>
    {#snippet footer()}
      <button
        type="button"
        class="btn"
        onclick={async () => {
          await copyText(m.text);
          toast(t('common.copied'), 'success', undefined, 2000);
        }}>{t('common.copy')}</button
      >
      <button type="button" class="btn primary" onclick={closeModal}>{t('common.close')}</button>
    {/snippet}
  </Modal>
{/if}

<style>
  .p {
    margin: 0;
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .big {
    max-height: 60vh;
  }
</style>
