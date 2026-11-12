<script lang="ts">
  // Erro na tela (A): ocupa o lugar da operação que parou, com as saídas à vista.
  import ErrorPanel from './ErrorPanel.svelte';
  import type { AdbError, ErrorAction } from '../lib/errors';
  import { navigate, reconnect, restartServer } from '../lib/state.svelte';

  let {
    error,
    serial = null,
    onretry,
    handlers = {},
  }: { error: AdbError; serial?: string | null; onretry?: () => void; handlers?: Partial<Record<ErrorAction, () => void>> } = $props();

  let busy = $state(false);
  // Onde dá para repetir a operação, "Tentar de novo" sempre aparece.
  const withRetry = $derived(onretry && !error.actions.includes('retry') ? { ...error, actions: [...error.actions, 'retry' as ErrorAction] } : error);

  const builtin: Partial<Record<ErrorAction, () => void | Promise<void>>> = {
    chooseDevice: () => navigate('devices'),
    pairAgain: () => navigate('connect'),
    openSettings: () => navigate('settings'),
    restartServer: async () => {
      await restartServer();
      onretry?.();
    },
  };

  function available(a: ErrorAction): boolean {
    if (handlers[a]) return true;
    if (a === 'retry') return !!onretry;
    if (a === 'reconnect') return !!serial;
    return a in builtin;
  }

  async function act(a: ErrorAction) {
    if (handlers[a]) return handlers[a]!();
    if (a === 'retry') return onretry?.();
    if (a === 'reconnect' && serial) {
      busy = true;
      try {
        if (await reconnect(serial)) onretry?.();
      } finally {
        busy = false;
      }
      return;
    }
    await builtin[a]?.();
  }
</script>

<section class="card es" role="alert" aria-busy={busy}>
  <ErrorPanel error={withRetry} {available} onaction={act} />
</section>

<style>
  .es {
    padding: 18px;
    border-color: var(--err-border);
  }
</style>
