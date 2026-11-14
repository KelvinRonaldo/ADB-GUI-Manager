#!/usr/bin/env bash
# Gera as imagens do instalador do Windows (NSIS) a partir do ícone e da versão do app.
# Rodar depois de subir a versão: scripts/installer-images.sh
# Precisa de inkscape e ImageMagick (convert). Saída em src-tauri/windows/.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=src-tauri/windows
ICON=$OUT/app-icon.svg
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
ICON_INNER=$(sed -e 's/<svg[^>]*>//' -e 's#</svg>##' "$ICON")

# Faixa lateral das telas de boas-vindas e conclusão: 164x314 (gerada em 2x; o NSIS ajusta ao controle).
cat > "$TMP/sidebar.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="328" height="628" viewBox="0 0 164 314">
  <rect width="164" height="314" fill="#1f2329"/>
  <svg x="46" y="78" width="72" height="72" viewBox="0 0 512 512">$ICON_INNER</svg>
  <text x="82" y="178" text-anchor="middle" font-family="Ubuntu Sans, Ubuntu, sans-serif" font-weight="600" font-size="15" fill="#e6e8ec">ADB GUI</text>
  <text x="82" y="196" text-anchor="middle" font-family="Ubuntu Sans, Ubuntu, sans-serif" font-weight="600" font-size="15" fill="#e6e8ec">Manager</text>
  <text x="82" y="217" text-anchor="middle" font-family="Ubuntu Sans, Ubuntu, sans-serif" font-size="11.5" fill="#9aa1ad">v$VERSION</text>
  <rect x="67" y="229" width="30" height="3" rx="1.5" fill="#3ddc84"/>
</svg>
SVG

# Imagem do cabeçalho das telas internas (à direita): 150x57, fundo branco, ícone encostado à direita.
cat > "$TMP/header.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="114" viewBox="0 0 150 57">
  <rect width="150" height="57" fill="#ffffff"/>
  <svg x="104" y="10.5" width="36" height="36" viewBox="0 0 512 512">$ICON_INNER</svg>
</svg>
SVG

for n in sidebar header; do
  inkscape "$TMP/$n.svg" -o "$TMP/$n.png" >/dev/null 2>&1
  convert "$TMP/$n.png" -background white -alpha remove -alpha off -type TrueColor "BMP3:$OUT/$n.bmp"
done

# Ícone do instalador e do desinstalador.
for s in 16 20 24 32 40 48 64 256; do
  inkscape "$ICON" -w $s -h $s -o "$TMP/i$s.png" >/dev/null 2>&1
done
convert "$TMP"/i{16,20,24,32,40,48,64,256}.png "$OUT/installer.ico"
echo "Imagens do instalador geradas para a v$VERSION em $OUT"
