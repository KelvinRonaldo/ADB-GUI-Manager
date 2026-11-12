<script lang="ts">
  import { onMount } from 'svelte';
  import Sidebar from './components/Sidebar.svelte';
  import CommandLog from './components/CommandLog.svelte';
  import Toasts from './components/Toasts.svelte';
  import ModalHost from './components/ModalHost.svelte';
  import Guide from './components/Guide.svelte';
  import FirstRun from './pages/FirstRun.svelte';
  import Devices from './pages/Devices.svelte';
  import Details from './pages/Details.svelte';
  import Connect from './pages/Connect.svelte';
  import Apps from './pages/Apps.svelte';
  import Files from './pages/Files.svelte';
  import Shell from './pages/Shell.svelte';
  import Logcat from './pages/Logcat.svelte';
  import Commands from './pages/Commands.svelte';
  import SettingsPage from './pages/Settings.svelte';
  import { app, boot, startPageGuide, startTour } from './lib/state.svelte';
  import type { Page } from './lib/types';

  let bootError = $state('');
  // Telas que seguram coisas rodando (sessões de shell, logcat, transferências,
  // comando ao vivo) ficam montadas depois da primeira visita.
  const keepAlive: Page[] = ['shell', 'logcat', 'files', 'commands'];
  let visited = $state<Record<string, boolean>>({});

  $effect(() => {
    if (keepAlive.includes(app.page)) visited[app.page] = true;
  });

  onMount(async () => {
    try {
      await boot();
    } catch (e) {
      bootError = String(e);
    }
  });

  $effect(() => {
    if (app.booted && app.adb && !app.settings.tourDone && !app.tour.active && !app.tour.done) startTour();
  });

  function onkey(e: KeyboardEvent) {
    if (e.key === 'F1') {
      e.preventDefault();
      if (app.adb) startPageGuide();
    }
  }
</script>

<svelte:window onkeydown={onkey} />

{#if bootError}
  <div class="boot err">{bootError}</div>
{:else if !app.booted}
  <div class="boot">ADB GUI Manager…</div>
{:else if !app.adb}
  <FirstRun />
{:else}
  <div class="shell">
    <Sidebar />
    <main class="main">
      <div class="pages">
        {#if app.page === 'devices'}
          <Devices />
        {:else if app.page === 'details'}
          <Details />
        {:else if app.page === 'connect'}
          <Connect />
        {:else if app.page === 'apps'}
          <Apps />
        {:else if app.page === 'settings'}
          <SettingsPage />
        {/if}
        {#if visited.shell}<div class="keep" hidden={app.page !== 'shell'}><Shell active={app.page === 'shell'} /></div>{/if}
        {#if visited.logcat}<div class="keep" hidden={app.page !== 'logcat'}><Logcat /></div>{/if}
        {#if visited.files}<div class="keep" hidden={app.page !== 'files'}><Files active={app.page === 'files'} /></div>{/if}
        {#if visited.commands}<div class="keep" hidden={app.page !== 'commands'}><Commands active={app.page === 'commands'} /></div>{/if}
      </div>
      <CommandLog />
    </main>
  </div>
{/if}

<Toasts />
<ModalHost />
<Guide />

<style>
  .shell {
    display: flex;
    height: 100vh;
    overflow: hidden;
  }
  .main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .pages {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .keep {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .keep[hidden] {
    display: none;
  }
  .boot {
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
  }
  .boot.err {
    color: var(--err-fg);
    padding: 24px;
    white-space: pre-wrap;
  }
</style>
