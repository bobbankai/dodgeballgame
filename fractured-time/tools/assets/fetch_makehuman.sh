#!/bin/bash
# Re-fetch MPFB and the CC0 MakeHuman asset packs, install MPFB into Blender and the packs into MPFB's data dir.
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p vendor/mpfb vendor/makehuman
curl -fsSL -o vendor/mpfb/mpfb-2.0.18.zip "https://extensions.blender.org/download/sha256:c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad/add-on-mpfb-v2.0.18.zip?repository=%2Fapi%2Fv1%2Fextensions%2F&blender_version_min=4.2.0"
for p in asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip asset_packs/skins01/skins01_cc0.zip asset_packs/skins02/skins02_cc0.zip functional/faceunits01.zip functional/visemes01.zip functional/visemes02.zip; do
  [ -f "vendor/makehuman/$(basename $p)" ] || curl -fsSL -o "vendor/makehuman/$(basename $p)" "https://files.makehumancommunity.org/$p"
done
blender -b --factory-startup --command extension install-file -r user_default -e vendor/mpfb/mpfb-2.0.18.zip
UD=$(blender -b --python-expr "import bpy;print('UD='+bpy.utils.extension_path_user('bl_ext.user_default.mpfb',create=True))" 2>/dev/null | grep '^UD=' | cut -d= -f2)/data
mkdir -p "$UD"
for z in vendor/makehuman/*.zip; do unzip -oq "$z" -d "$UD"; done
echo "MPFB data installed at $UD"
