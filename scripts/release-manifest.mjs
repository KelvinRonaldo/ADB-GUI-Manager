#!/usr/bin/env node
// Prepara os arquivos de uma Release: copia os pacotes com o nome publicado, assina cada um
// (assinatura presa à versão) e gera o latest.json que o app lê em "Buscar atualizações",
// mais o SHA256SUMS.txt.
//
//   node scripts/release-manifest.mjs --out <pasta> --notes <notas.md> \
//     [--appimage <arq>] [--deb <arq>] [--nsis <arq-setup.exe>] [--portable <arq.zip>] \
//     [--base-url <url>] [--key <updater.key>]
//
// --base-url: onde os arquivos ficam publicados; o padrão é a Release vX.Y.Z do GitHub.
//             Para testar localmente, http://localhost:<porta>/ (o app aceita o latest.json
//             de outro lugar com ADBGUI_UPDATE_ENDPOINT, mas sempre confere a assinatura).
// --key:      chave privada do atualizador; o padrão é ~/.config/adb-gui-manager/updater.key
//             (ou TAURI_SIGNING_PRIVATE_KEY_PATH). A pública fica em src-tauri/tauri.conf.json.
// A versão vem do src-tauri/tauri.conf.json, ou de --version.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) fail(`argumento solto: ${a}`);
  args[a.slice(2)] = process.argv[++i];
}

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

const conf = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const version = args.version ?? conf.version;
const out = resolve(args.out ?? fail('falta --out'));
const notes = args.notes ? readFileSync(resolve(args.notes), 'utf8').trim() : fail('falta --notes');
const key = resolve(args.key ?? process.env.TAURI_SIGNING_PRIVATE_KEY_PATH ?? join(homedir(), '.config/adb-gui-manager/updater.key'));
if (!existsSync(key)) fail(`chave do atualizador não encontrada: ${key}`);
let base = args['base-url'] ?? `https://github.com/KelvinRonaldo/ADB-GUI-Manager/releases/download/v${version}/`;
if (!base.endsWith('/')) base += '/';

// Nome publicado de cada pacote e a chave dele no latest.json (o app procura
// "{os}-{arch}-{instalador}"; o portátil usa "-portable"). Sem chave genérica de propósito:
// um pacote de outro tipo instalado por cima quebraria a instalação.
const KINDS = [
  { opt: 'appimage', target: 'linux-x86_64-appimage', name: `ADB-GUI-Manager_${version}_amd64.AppImage` },
  { opt: 'deb', target: 'linux-x86_64-deb', name: `ADB-GUI-Manager_${version}_amd64.deb` },
  { opt: 'nsis', target: 'windows-x86_64-nsis', name: `ADB-GUI-Manager_${version}_x64-setup.exe` },
  { opt: 'portable', target: 'windows-x86_64-portable', name: `ADB-GUI-Manager-${version}-windows-x64-portable.zip` },
];

mkdirSync(out, { recursive: true });
const platforms = {};
const sums = [];
for (const k of KINDS) {
  const src = args[k.opt];
  if (!src) continue;
  if (!existsSync(src)) fail(`não achei ${k.opt}: ${src}`);
  const dest = join(out, k.name);
  copyFileSync(src, dest);
  execFileSync('npx', ['tauri', 'signer', 'sign', '-f', key, '-p', process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '', '--app-version', version, dest], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const signature = readFileSync(`${dest}.sig`, 'utf8').trim();
  platforms[k.target] = { signature, url: base + encodeURIComponent(k.name) };
  sums.push(`${createHash('sha256').update(readFileSync(dest)).digest('hex')}  ${k.name}`);
  console.log(`assinado: ${k.name} → ${k.target}`);
}
if (!Object.keys(platforms).length) fail('nenhum pacote informado (--appimage, --deb, --nsis, --portable)');

const manifest = { version, notes, pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), platforms };
writeFileSync(join(out, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(out, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
console.log(`\n${join(out, 'latest.json')} (versão ${version}, ${Object.keys(platforms).length} pacote(s))`);
console.log(`Suba na Release: ${[...KINDS.filter((k) => args[k.opt]).map((k) => k.name), 'latest.json', 'SHA256SUMS.txt'].join(', ')}`);
console.log(`Os .sig ficam em ${basename(out)}/ só para conferência; o app usa a assinatura de dentro do latest.json.`);
