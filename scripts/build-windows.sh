#!/usr/bin/env bash
# Build do ADB GUI Manager para Windows (x86_64, MSVC) a partir do Linux, com cargo-xwin.
#
#   scripts/build-windows.sh [--portable | --installer] [--accept-license]
#
# --portable (padrão): .zip com o .exe; dados e perfil do WebView2 ficam numa pasta
#                      ao lado dele (adb-gui-manager-data).
# --installer:         instalador NSIS (-setup.exe).
#
# Na primeira vez o xwin baixa o CRT do MSVC e o SDK do Windows dos servidores da
# Microsoft, o que exige aceitar a licença deles: https://go.microsoft.com/fwlink/?LinkId=2086102
# O script só segue com --accept-license ou XWIN_ACCEPT_LICENSE=1. O download fica em
# ~/.cache/cargo-xwin e é reaproveitado nos próximos builds.
set -euo pipefail

cd "$(dirname "$0")/.."
MODE=portable
for a in "$@"; do
  case "$a" in
    --portable) MODE=portable ;;
    --installer) MODE=installer ;;
    --accept-license) export XWIN_ACCEPT_LICENSE=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "opção desconhecida: $a" >&2; exit 2 ;;
  esac
done

TARGET=x86_64-pc-windows-msvc
VERSION=$(node -p "require('./package.json').version")

missing=()
command -v cargo-xwin >/dev/null || missing+=("cargo-xwin  →  cargo install --locked cargo-xwin")
for t in clang lld-link llvm-lib llvm-rc; do
  command -v "$t" >/dev/null || missing+=("$t  →  sudo apt install clang lld llvm")
done
rustup target list --installed | grep -qx "$TARGET" || missing+=("alvo $TARGET  →  rustup target add $TARGET")
[ "$MODE" = installer ] && { command -v makensis >/dev/null || missing+=("makensis  →  sudo apt install nsis"); }
[ -d node_modules ] || missing+=("dependências npm  →  npm install")
if [ ${#missing[@]} -gt 0 ]; then
  echo "Falta para o build de Windows:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 1
fi

if [ "${XWIN_ACCEPT_LICENSE:-}" != "1" ] && [ ! -d "${XWIN_CACHE_DIR:-$HOME/.cache/cargo-xwin}/xwin" ]; then
  echo "O primeiro build baixa o CRT do MSVC e o SDK do Windows da Microsoft." >&2
  echo "Leia a licença em https://go.microsoft.com/fwlink/?LinkId=2086102 e rode de novo com --accept-license." >&2
  exit 3
fi
export XWIN_ACCEPT_LICENSE=1
# O SDK 10.0.26100 que o xwin escolhe sozinho vem sem os cabeçalhos x86_64 no manifesto
# atual ("unable to find x86_64 headers for Win11SDK_10.0.26100"); o 22621 funciona.
export XWIN_SDK_VERSION="${XWIN_SDK_VERSION:-10.0.22621}"

if [ "$MODE" = portable ]; then
  npx tauri build --runner cargo-xwin --target "$TARGET" --no-bundle --features portable \
    --config src-tauri/tauri.portable.conf.json
  EXE="src-tauri/target/$TARGET/release/adb-gui-manager.exe"
  OUT=dist-windows
  STAGE="$OUT/ADB-GUI-Manager-$VERSION-windows-x64-portable"
  rm -rf "$STAGE" "$STAGE.zip"
  mkdir -p "$STAGE"
  cp "$EXE" "$STAGE/adb-gui-manager.exe"
  cat > "$STAGE/LEIA-ME.txt" <<EOF
ADB GUI Manager $VERSION — versão portátil para Windows 10/11 (64 bits)

Abra adb-gui-manager.exe. Não precisa instalar.

- Configurações, histórico, o platform-tools baixado pelo app e o perfil do WebView2
  ficam na pasta adb-gui-manager-data, ao lado do .exe. Para levar o app para outro
  computador, copie a pasta inteira.
- Precisa do Microsoft Edge WebView2 Runtime, que já vem no Windows 10 e 11 atualizados.
- O adb: o app procura no PATH e no Android SDK. Sem adb, ele oferece baixar o
  platform-tools oficial do Google para a pasta portátil, ou apontar o adb.exe.
- Para usar outro adb só nesta execução:  adb-gui-manager.exe --adb "C:\\platform-tools\\adb.exe"
EOF
  (cd "$OUT" && zip -qr "$(basename "$STAGE").zip" "$(basename "$STAGE")")
  echo
  echo "Portátil: $OUT/$(basename "$STAGE").zip"
else
  npx tauri build --runner cargo-xwin --target "$TARGET" --bundles nsis
  echo
  echo "Instalador: $(ls src-tauri/target/$TARGET/release/bundle/nsis/*.exe)"
fi
