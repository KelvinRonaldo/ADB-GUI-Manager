#!/usr/bin/env bash
# Gera wake.dex a partir de Wake.java (javac + d8 do Android SDK build-tools).
set -euo pipefail
cd "$(dirname "$0")"
D8=${D8:-$(ls -d "$HOME"/Android/Sdk/build-tools/*/d8 2>/dev/null | sort -V | tail -1)}
tmp=$(mktemp -d)
javac --release 8 -d "$tmp" Wake.java 2>/dev/null || javac -source 8 -target 8 -d "$tmp" Wake.java
"$D8" --min-api 21 --output "$tmp" "$tmp"/Wake.class
cp "$tmp/classes.dex" wake.dex
rm -rf "$tmp"
echo "wake.dex: $(stat -c %s wake.dex) bytes"
