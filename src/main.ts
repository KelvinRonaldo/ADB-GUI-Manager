import { mount } from 'svelte';
import './app.css';
import '@xterm/xterm/css/xterm.css';
import App from './App.svelte';
import MirrorWindow from './MirrorWindow.svelte';
import { isMirrorWindow } from './lib/mirrorWindow';

// A janela destacada do espelho usa a mesma página, só com a tela do aparelho.
const app = mount(isMirrorWindow() ? MirrorWindow : App, { target: document.getElementById('app')! });

export default app;
