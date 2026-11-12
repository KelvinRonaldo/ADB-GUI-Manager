<script lang="ts">
  // Ícones de traço, desenhados aqui para não depender de fonte nem rede.
  const PATHS: Record<string, string> = {
    devices: '<rect x="6" y="2" width="12" height="20" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/>',
    connect: '<path d="M4.5 10a11 11 0 0 1 15 0"/><path d="M7.8 13.4a6.4 6.4 0 0 1 8.4 0"/><circle cx="12" cy="17.5" r="1.2"/>',
    apps: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    files: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/>',
    shell: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
    logcat: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="4" y2="6"/><line x1="3" y1="12" x2="4" y2="12"/><line x1="3" y1="18" x2="4" y2="18"/>',
    commands: '<polyline points="8 6 2 12 8 18"/><polyline points="16 6 22 12 16 18"/>',
    settings: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="7" cy="18" r="2" fill="currentColor"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><polyline points="21 3 21 9 15 9"/>',
    down: '<polyline points="6 9 12 15 18 9"/>',
    up: '<polyline points="6 15 12 9 18 15"/>',
    right: '<polyline points="9 6 15 12 9 18"/>',
    left: '<polyline points="15 6 9 12 15 18"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
    close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    check: '<polyline points="5 12 10 17 19 7"/>',
    alert: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="7.5" x2="12" y2="13"/><circle cx="12" cy="16.5" r="0.6" fill="currentColor"/>',
    info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r="0.6" fill="currentColor"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unplugged: '<path d="M7 7l10 10"/><rect x="6" y="2" width="12" height="20" rx="2"/>',
    wifiOff: '<path d="M4.5 10a11 11 0 0 1 15 0"/><path d="M7.8 13.4a6.4 6.4 0 0 1 8.4 0"/><circle cx="12" cy="17.5" r="1.2"/><line x1="4" y1="4" x2="20" y2="20"/>',
    usb: '<path d="M12 2v14"/><path d="M8 6l4-4 4 4"/><path d="M6 12v2a6 6 0 0 0 12 0v-2"/><circle cx="12" cy="20" r="2"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>',
    upload: '<path d="M12 15V3"/><polyline points="7 8 12 3 17 8"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    download: '<path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    play: '<polygon points="7 4 19 12 7 20 7 4" fill="currentColor"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>',
    trash: '<polyline points="4 7 20 7"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M9 7V4h6v3"/>',
    folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><line x1="12" y1="10" x2="12" y2="16"/><line x1="9" y1="13" x2="15" y2="13"/>',
    arrowUp: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><circle cx="12" cy="17" r="0.6" fill="currentColor"/>',
    star: '<polygon points="12 3 14.8 8.8 21 9.6 16.5 13.9 17.6 20 12 17 6.4 20 7.5 13.9 3 9.6 9.2 8.8 12 3"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
    power: '<path d="M12 3v9"/><path d="M6.3 7.5a8 8 0 1 0 11.4 0"/>',
    spinner: '<path d="M12 3a9 9 0 1 0 9 9"/>',
    terminalApp: '<polyline points="5 8 10 12 5 16"/><line x1="12" y1="17" x2="19" y2="17"/>',
  };

  let { name, size = 18, stroke = 1.8, class: cls = '' }: { name: string; size?: number; stroke?: number; class?: string } = $props();
</script>

<svg
  class={cls}
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {@html PATHS[name] ?? ''}
</svg>
