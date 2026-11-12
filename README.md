# ADB GUI Manager

Interface gráfica para o `adb`, para Windows e Linux (`br.com.kelvinronaldo.adbguimanager`).

O app usa o adb que já está no computador, ou o apontado ao abrir. Ele faz o que o adb faz, com os
parâmetros de cada comando, e mostra o comando exato de cada ação no registro, embaixo da tela.

## O que tem

| Tela | O que faz |
|---|---|
| Primeira execução | Procura o adb (PATH, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, SDK padrão). Sem adb, deixa apontar o executável ou baixar o platform-tools oficial do Google, com confirmação. |
| Aparelhos | Lista ao vivo (`adb track-devices -l`) em cartões: Android, bateria, IP do Wi-Fi, armazenamento. Menu com reiniciar, passar para Wi-Fi, captura e gravação de tela (acendem a tela antes, para a imagem não sair preta), bugreport, root e remount. |
| Detalhes | Resumo, propriedades, bateria, rede, armazenamento, tela e processos, com a saída verbosa filtrável e exportável. |
| Conectar | Espera por USB, pareamento por código ou QR code (Android 11+), USB para Wi-Fi guiado, conexão por IP, descoberta mDNS e conexões recentes. |
| Apps | Pacotes com abrir, parar, limpar dados, desinstalar, extrair APK, permissões, desativar e informações. Instalação arrastando APKs, com todos os parâmetros do `install`. |
| Arquivos | Computador e aparelho lado a lado, `push` e `pull` com progresso real, `--sync`, `-n`, `-a`, `-z`. |
| Shell | `adb shell` em terminal de verdade (PTY), várias abas, comandos salvos, rodar em todos os aparelhos. |
| Logcat | Ao vivo, com nível, app (`--pid`), tags, regex (`-e`), buffer (`-b`), pausar, limpar e salvar. |
| Todos os comandos | Linha livre com Tab completando, e um formulário para cada comando e parâmetro do adb, com opções globais, comando gerado, saída ao vivo e a ajuda do adb instalado. |
| Configurações | Executável do adb, servidor (`-H`, `-P`, iniciar, parar, reiniciar), variáveis de ambiente do adb, tema, idioma e guias. |

Erros aparecem com a causa e a ação: reconectar o aparelho, tentar de novo, ou decidir, por exemplo instalar com
`-d` quando o aparelho tem versão mais nova. A saída original do adb fica em "Detalhes técnicos".

Na primeira abertura há um tour curto. No fim, o app pergunta se você quer o guia detalhado de cada página na primeira
vez que ela abrir. F1 abre o guia da página atual.

Idiomas: pt-BR e en-US. Tema: Sistema, Claro ou Escuro.

## Aparelho novo por USB passa para o Wi-Fi

Alguns terminais, pela versão do Android, não ficam conectados por USB. Por isso, quando um aparelho é ligado por
USB com o app aberto, o app faz sozinho a sequência:

1. Lê o IP do aparelho na rede (`adb shell ip -f inet addr show`, preferindo Wi-Fi e depois cabo).
2. Roda `adb tcpip 5555`.
3. Roda `adb connect IP:5555`, com até seis tentativas, e confirma que o aparelho apareceu pronto na lista.
4. Diz se funcionou. Se falhar, mostra o motivo, com tentar de novo e começar de novo.

O cabo não precisa sair: depois do `tcpip`, a janela só avisa que ele já pode ser tirado, se você quiser. Se outro
aparelho for pedido enquanto um fluxo roda, ele entra na fila, e a janela mostra quem vem em seguida.

Em Configurações › Aparelho novo por USB: passar sozinho (padrão), perguntar ou não fazer nada, e a porta TCP. Os
aparelhos que já estavam ligados quando o app abriu, ou quando o servidor do adb reiniciou, não mudam. O "Passar para Wi-Fi" do
cartão, dos detalhes e da tela Conectar usa o mesmo fluxo.

## Como abrir com outro adb

```bash
adb-gui-manager --adb /opt/platform-tools/adb
```

O caminho passado assim vale só nesta execução. A escolha salva fica em Configurações.

## Onde ficam os dados

| | Linux | Windows |
|---|---|---|
| Configurações | `~/.config/br.com.kelvinronaldo.adbguimanager/settings.json` | `%APPDATA%\br.com.kelvinronaldo.adbguimanager\settings.json` (portátil: `adb-gui-manager-data\config` ao lado do .exe) |
| Histórico e platform-tools baixado | `~/.local/share/br.com.kelvinronaldo.adbguimanager/` | `%LOCALAPPDATA%\br.com.kelvinronaldo.adbguimanager\` |

## Build

Pré-requisitos: Rust estável, Node 20+, e as dependências do Tauri 2 de cada sistema
(Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`;
Windows: Visual Studio Build Tools com C++ e WebView2).

```bash
npm install
npx tauri build --bundles deb,appimage   # Linux
npx tauri build --bundles nsis,msi       # Windows
```

Os pacotes saem em `src-tauri/target/release/bundle/`.

## Build de Windows no Linux (cross-compiler)

O `scripts/build-windows.sh` compila para Windows x86_64 (MSVC) com o `cargo-xwin` e o LLVM (clang, lld-link,
llvm-lib, llvm-rc). O script confere as ferramentas e diz como instalar o que faltar.

```bash
scripts/build-windows.sh --portable     # .zip com o .exe, em dist-windows/
scripts/build-windows.sh --installer    # instalador NSIS (precisa do makensis)
```

No primeiro build, o xwin baixa o CRT do MSVC e o SDK do Windows dos servidores da Microsoft, o que exige aceitar
a licença deles (https://go.microsoft.com/fwlink/?LinkId=2086102). O script só segue com `--accept-license`. O
download fica em `~/.cache/cargo-xwin` e é reaproveitado.

A versão portátil (`--features portable` com `src-tauri/tauri.portable.conf.json`) guarda configurações, histórico,
o platform-tools baixado e o perfil do WebView2 em `adb-gui-manager-data`, ao lado do .exe. Ela precisa do WebView2
Runtime, que já vem no Windows 10 e 11 atualizados.

## Desenvolvimento

```bash
npm run dev            # só a interface, no navegador, com um backend simulado
npx tauri dev          # o app de verdade
npm test               # testes do front (vitest)
npm run check          # svelte-check
cd src-tauri && cargo test   # testes do backend
```

No navegador, a interface usa `src/lib/mock.ts` no lugar do Rust. Parâmetros de URL úteis:
`?tour` (tour da primeira abertura), `?guides` (oferta de guia nas páginas), `?noadb` (sem adb encontrado),
`?fresh` (sem configurações salvas). No console, `__mockPlugUsb()` simula um aparelho USB novo para testar o
fluxo USB → Wi-Fi, e `__mockPlugUsb(true)` simula o `connect` recusado.

## Estrutura

```
src/                     interface (Svelte 5 + TypeScript)
  App.svelte             layout e navegação
  pages/                 uma tela por arquivo
  components/            barra lateral, barra do alvo, registro, erros, guias, diálogos
  lib/catalog.ts         todos os comandos do adb e seus parâmetros
  lib/errors.ts          classificação das falhas do adb em causa e ação
  lib/locales/           textos pt-BR e en-US (mesmas chaves, checado no build e nos testes)
  lib/state.svelte.ts    estado global, aparelhos, reconexão, guias
  lib/wififlow.svelte.ts fluxo USB → Wi-Fi (IP, tcpip, connect)
src-tauri/src/           backend (Rust)
  locate.rs              onde está o adb e validação por `adb version`
  runner.rs              execução de comandos e registro
  stream.rs              comandos longos com saída ao vivo
  pty.rs                 terminal para shell e transferências com progresso
  tracker.rs             lista de aparelhos ao vivo (track-devices)
  parse.rs               interpretação das saídas do adb, com testes de saídas reais
  download.rs            download do platform-tools
  resources/wake/        injetor da tecla WAKEUP (.dex) para aparelhos sem `input keyevent` (GPOS760)
```
