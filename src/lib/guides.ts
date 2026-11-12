import type { Key } from './i18n.svelte';
import type { Page } from './types';

export interface GuideStep {
  /** Valor de data-guide do elemento destacado. */
  target: string;
  /** Prefixo das chaves: `${key}.t` (título) e `${key}.b` (texto). */
  key: string;
}

export const TOUR: GuideStep[] = [
  { target: 'tour-devices', key: 'tour.1' },
  { target: 'tour-target', key: 'tour.2' },
  { target: 'nav-connect', key: 'tour.3' },
  { target: 'nav-tasks', key: 'tour.4' },
  { target: 'nav-commands', key: 'tour.5' },
  { target: 'tour-log', key: 'tour.6' },
];

const steps = (page: string, targets: string[]): GuideStep[] =>
  targets.map((target, i) => ({ target, key: `g.${page}.${i + 1}` }));

export const PAGE_GUIDES: Record<Page, GuideStep[]> = {
  devices: steps('devices', ['devices-filters', 'devices-view', 'devices-card', 'devices-card-actions', 'devices-connect']),
  details: steps('details', ['details-actions', 'details-tabs', 'details-verbose']),
  connect: steps('connect', ['connect-usb', 'connect-wifi', 'connect-mdns', 'connect-recent']),
  apps: steps('apps', ['apps-search', 'apps-table', 'apps-drop', 'apps-params']),
  files: steps('files', ['files-local', 'files-remote', 'files-actions', 'files-transfers']),
  shell: steps('shell', ['shell-tabs', 'shell-term', 'shell-saved-toggle']),
  logcat: steps('logcat', ['logcat-filters', 'logcat-lines', 'logcat-actions']),
  commands: steps('commands', ['commands-free', 'commands-catalog', 'commands-form', 'commands-output']),
  settings: steps('settings', ['settings-adb', 'settings-server', 'settings-env', 'settings-guides']),
};

export const titleKey = (s: GuideStep) => `${s.key}.t` as Key;
export const bodyKey = (s: GuideStep) => `${s.key}.b` as Key;
