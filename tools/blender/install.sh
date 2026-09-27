#!/usr/bin/env bash
# Installs a headless Blender LTS for the asset pipeline (idempotent).
# Usage: tools/blender/install.sh [install-dir]   (default /opt/blender)
set -euo pipefail
VERSION="${BLENDER_VERSION:-4.5.14}"
SERIES="${VERSION%.*}"
DEST="${1:-/opt/blender}"
if [ -x "$DEST/blender" ] && "$DEST/blender" -b --version 2>/dev/null | grep -q "Blender $VERSION"; then
  echo "Blender $VERSION already installed at $DEST"
  exit 0
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
URL="https://download.blender.org/release/Blender${SERIES}/blender-${VERSION}-linux-x64.tar.xz"
echo "Downloading $URL"
curl -fSL --retry 4 -o "$TMP/blender.tar.xz" "$URL"
tar -xJf "$TMP/blender.tar.xz" -C "$TMP"
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
mv "$TMP/blender-${VERSION}-linux-x64" "$DEST"
ln -sf "$DEST/blender" /usr/local/bin/blender 2>/dev/null || true
"$DEST/blender" -b --version | head -1
