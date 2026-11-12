<script lang="ts">
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte';
  import { app, confirmDialog, navigate, restartServer, checkServer, toast } from '../lib/state.svelte';
  import { api } from '../lib/ipc';
  import type { Page } from '../lib/types';
  import type { Key } from '../lib/i18n.svelte';

  const top: { id: Page; icon: string; key: Key; guide?: string }[] = [
    { id: 'devices', icon: 'devices', key: 'nav.devices' },
    { id: 'connect', icon: 'connect', key: 'nav.connect', guide: 'nav-connect' },
  ];
  const tasks: { id: Page; icon: string; key: Key }[] = [
    { id: 'apps', icon: 'apps', key: 'nav.apps' },
    { id: 'files', icon: 'files', key: 'nav.files' },
    { id: 'shell', icon: 'shell', key: 'nav.shell' },
    { id: 'logcat', icon: 'logcat', key: 'nav.logcat' },
  ];

  const active = (id: Page) => app.page === id || (id === 'devices' && app.page === 'details');
  let busy = $state(false);

  async function startServer() {
    busy = true;
    try {
      await api.serverStart();
    } finally {
      busy = false;
      checkServer();
    }
  }
  async function stopServer() {
    const c = await confirmDialog({ title: t('confirm.killServerTitle'), text: t('confirm.killServerText'), danger: true, destructive: true, confirmLabel: t('server.stop') });
    if (!c.ok) return;
    busy = true;
    try {
      await api.serverStop();
    } finally {
      busy = false;
      checkServer();
    }
  }
  async function restart() {
    busy = true;
    try {
      await restartServer();
    } catch (e) {
      toast(String(e), 'error');
    } finally {
      busy = false;
    }
  }
</script>

{#snippet item(id: Page, icon: string, key: Key, guide?: string)}
  <a
    href={'#' + id}
    class="nav-item"
    class:active={active(id)}
    aria-current={active(id) ? 'page' : undefined}
    data-guide={guide}
    onclick={(e) => {
      e.preventDefault();
      navigate(id);
    }}
  >
    <Icon name={icon} />
    <span class="label">{t(key)}</span>
    {#if id === 'devices' && app.devices.length}
      <span class="count">{app.devices.length}</span>
    {/if}
  </a>
{/snippet}

<nav class="side" aria-label={t('nav.label')}>
  <div class="brand">
    <div class="logo"><Icon name="terminalApp" size={20} stroke={2.2} /></div>
    <div>
      <div class="name">ADB GUI Manager</div>
      <div class="ver">v0.1.0</div>
    </div>
  </div>

  {#each top as n (n.id)}
    {@render item(n.id, n.icon, n.key, n.guide)}
  {/each}
  <div class="group" data-guide="nav-tasks">
    {#each tasks as n (n.id)}
      {@render item(n.id, n.icon, n.key)}
    {/each}
  </div>
  {@render item('commands', 'commands', 'nav.commands', 'nav-commands')}

  <div class="divider"></div>
  {@render item('settings', 'settings', 'nav.settings')}

  <div class="spacer"></div>

  <div class="server">
    <div class="row-s">
      <span class="dot" class:off={!app.serverRunning}></span>
      <span class="strong">{app.serverRunning ? t('server.running') : t('server.stopped')}</span>
      <span class="port">:{app.settings.serverPort || 5037}</span>
    </div>
    {#if app.adb}
      <div class="muted-s">adb {app.adb.version.adbVersion}{app.adb.version.toolsVersion ? ` · ${app.adb.version.toolsVersion}` : ''}</div>
      <div class="path" title={app.adb.path}>{app.adb.path}</div>
    {/if}
    <div class="btns">
      {#if app.serverRunning}
        <button type="button" disabled={busy} onclick={restart}>{t('server.restart')}</button>
        <button type="button" disabled={busy} onclick={stopServer} aria-label={t('server.stop')} title={t('server.stop')}><Icon name="stop" size={14} /></button>
      {:else}
        <button type="button" disabled={busy} onclick={startServer}>{t('server.start')}</button>
      {/if}
    </div>
  </div>
</nav>

<style>
  .side {
    width: 220px;
    flex: 0 0 220px;
    background: var(--side-bg);
    color: var(--side-text);
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 16px 12px;
    overflow-y: auto;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 8px 18px;
  }
  .logo {
    width: 34px;
    height: 34px;
    border-radius: 9px;
    background: #3ddc84;
    color: #10331f;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
  }
  .name {
    font-weight: 700;
    font-size: 15px;
    line-height: 18px;
  }
  .ver {
    font-size: 11px;
    color: var(--side-muted);
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    color: #c3c8d0;
    text-decoration: none;
  }
  .nav-item:hover {
    background: var(--side-hover);
    color: #fff;
  }
  .nav-item.active {
    background: var(--side-active);
    color: #fff;
    font-weight: 600;
  }
  .label {
    flex: 1 1 auto;
  }
  .count {
    font-size: 11px;
    font-weight: 600;
    background: #3a4150;
    border-radius: 10px;
    padding: 1px 7px;
  }
  .divider {
    height: 1px;
    background: #323946;
    margin: 10px 4px;
  }
  .spacer {
    flex: 1 1 auto;
  }
  .server {
    border: 1px solid #323946;
    border-radius: 10px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 7px;
    font-size: 12px;
  }
  .row-s {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 4px;
    background: #3ddc84;
  }
  .dot.off {
    background: #f87171;
  }
  .strong {
    font-weight: 600;
  }
  .port {
    margin-left: auto;
    color: var(--side-muted);
  }
  .muted-s {
    color: var(--side-muted);
  }
  .path {
    font-family: var(--mono);
    font-size: 11px;
    color: #c3c8d0;
    word-break: break-all;
  }
  .btns {
    display: flex;
    gap: 6px;
  }
  .btns button {
    flex: 1 1 auto;
    background: transparent;
    color: var(--side-text);
    border: 1px solid #3a4150;
    border-radius: 7px;
    padding: 7px 10px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .btns button:last-child:not(:first-child) {
    flex: 0 0 34px;
  }
  .btns button:hover:not(:disabled) {
    background: var(--side-hover);
  }
</style>
