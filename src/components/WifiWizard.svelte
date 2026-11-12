<script lang="ts">
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import ErrorPanel from './ErrorPanel.svelte';
  import { t } from '../lib/i18n.svelte';
  import { navigate } from '../lib/state.svelte';
  import { deviceName } from '../lib/state.svelte';
  import { close, confirmAsk, flow, restart, retry, skipDevice, type StepId } from '../lib/wififlow.svelte';
  import type { ErrorAction } from '../lib/errors';

  const f = $derived(flow.current);
  const STEPS: StepId[] = ['ip', 'tcpip', 'connect'];
  const queued = $derived(flow.queue.map((q) => deviceName(q.serial)).join(', '));
  // Depois do tcpip a conexão pelo Wi-Fi não depende mais do cabo.
  const canUnplug = $derived(!!f && f.steps.tcpip === 'done' && f.phase !== 'failed');
  const address = $derived(f ? `${f.ip || 'IP'}:${f.port}` : '');

  function label(s: StepId): string {
    if (!f) return '';
    if (s === 'ip') return f.ip ? t('wifi.step.ipDone', { ip: f.ip }) : t('wifi.step.ip');
    if (s === 'tcpip') return t('wifi.step.tcpip', { port: f.port });
    return t('wifi.step.connect', { address });
  }

  function onErrorAction(a: ErrorAction) {
    if (a === 'retry') retry();
    else if (a === 'pairAgain') {
      close();
      navigate('connect');
    } else if (a === 'reconnect') restart();
  }
</script>

{#if f}
  <Modal title={f.phase === 'ask' ? t('wifi.askTitle', { name: f.name }) : t('wifi.title', { name: f.name })} onclose={close} width={560}>
    {#if f.phase === 'ask'}
      <p class="p">{t('wifi.askText', { port: f.port })}</p>
    {:else}
      {#if f.auto && f.phase === 'run'}<div class="auto"><Icon name="info" size={16} /> {t('wifi.auto')}</div>{/if}
      <ol class="steps">
        {#each STEPS as s (s)}
          {@const st = f.steps[s]}
          <li class="step {st}">
            <span class="mark" aria-hidden="true">
              {#if st === 'done'}<Icon name="check" size={14} stroke={2.6} />
              {:else if st === 'running'}<Icon name="spinner" size={14} stroke={2.6} class="spin" />
              {:else if st === 'error'}<Icon name="close" size={14} stroke={2.6} />
              {:else if st === 'skipped'}–
              {:else}{STEPS.indexOf(s) + 1}{/if}
            </span>
            <span class="txt">{label(s)}</span>
            <span class="sr-only">{st}</span>
          </li>
        {/each}
      </ol>

      {#if f.phase === 'run' && f.status}
        <div class="status" role="status">{f.status}</div>
      {/if}
      {#if canUnplug}
        <div class="unplug" role="note">
          <Icon name="usb" size={22} />
          <span>{t('wifi.canUnplug')}</span>
        </div>
      {/if}

      {#if f.phase === 'done'}
        <div class="ok" role="status"><Icon name="check" size={20} stroke={2.4} /> {f.result}</div>
      {:else if f.phase === 'failed'}
        <section class="fail" role="alert">
          {#if f.error}
            <!-- Tentar de novo e começar de novo ficam no rodapé; aqui só o que é extra. -->
            <ErrorPanel error={f.error} available={(a) => a === 'pairAgain'} onaction={onErrorAction} />
          {:else}
            <div class="nofail"><Icon name="alert" size={20} /> {f.status}</div>
          {/if}
        </section>
      {/if}
    {/if}

    {#if queued}<div class="queue muted">{t('wifi.next', { names: queued })}</div>{/if}

    {#snippet footer()}
      {#if f.phase === 'ask'}
        <button type="button" class="linkbtn plain" onclick={skipDevice}>{t('wifi.neverDevice')}</button>
        <button type="button" class="btn" onclick={close}>{t('wifi.notNow')}</button>
        <button type="button" class="btn primary" onclick={confirmAsk}>{t('wifi.yes')}</button>
      {:else if f.phase === 'run'}
        <button type="button" class="btn" onclick={close}>{t('common.cancel')}</button>
      {:else if f.phase === 'failed'}
        <button type="button" class="btn" onclick={close}>{t('common.close')}</button>
        <button type="button" class="btn" onclick={restart}>{t('wifi.restart')}</button>
        <button type="button" class="btn primary" onclick={retry}>{f.failedAt === 'connect' ? t('wifi.retryConnect') : t('common.retry')}</button>
      {:else}
        <button type="button" class="btn primary" onclick={close}>{t('common.ok')}</button>
      {/if}
    {/snippet}
  </Modal>
{/if}

<style>
  .p {
    margin: 0;
  }
  .auto {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 12px;
    color: var(--muted);
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
  }
  .mark {
    width: 24px;
    height: 24px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    background: var(--surface-3);
    color: var(--muted);
    flex: 0 0 auto;
  }
  .step.running .mark {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .step.running .txt {
    font-weight: 600;
  }
  .step.done .mark {
    background: var(--ok-bg);
    color: var(--ok-fg);
  }
  .step.error .mark {
    background: var(--err-bg);
    color: var(--err-fg);
  }
  .step.skipped .txt {
    color: var(--muted);
    text-decoration: line-through;
  }
  .unplug {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px 14px;
    font-size: 13px;
  }
  .queue {
    font-size: 12px;
  }
  .status {
    font-size: 13px;
    color: var(--accent);
  }
  .ok {
    display: flex;
    gap: 10px;
    align-items: center;
    background: var(--ok-bg);
    color: var(--ok-fg);
    border-radius: 10px;
    padding: 12px 14px;
    font-weight: 600;
  }
  .fail {
    border: 1px solid var(--err-border);
    border-radius: 10px;
    padding: 14px;
  }
  .nofail {
    display: flex;
    gap: 10px;
    align-items: center;
    color: var(--err-fg);
    font-weight: 600;
  }
  .plain {
    color: var(--muted);
    font-weight: 500;
    font-size: 12px;
    text-decoration: underline;
    margin-right: auto;
  }
</style>
