#!/usr/bin/env bash
# Build + export a character from its Blender script, keep the raw GLB in vendor/, then pack it for the game.
#   tools/assets/export_character.sh ethan
# gltfpack flags: -cc meshopt compression, -kn/-km/-ke keep node names, material names and extras (material recipes live in extras),
# -kv keep vertex attributes on texture-less materials (hair UVs), -vtf float UVs (the node materials sample raw uv(), no transforms),
# -vpf float positions (metres in mesh space: hair shells displace and armour patterns are measured in metres), -vn 8 normal bits.
set -euo pipefail
cd "$(dirname "$0")/../.."
name="${1:?character name}"
out="public/assets/characters/$name/$name.glb"
script="blender/characters/$name.py"
args="--export"
if [ ! -f "$script" ]; then script="blender/characters/helix.py"; args="--variant $name --export"; fi  # HELIX archetypes
/opt/blender/blender -b --factory-startup --python-exit-code 1 -P "$script" -- $args
mkdir -p vendor
cp "$out" "vendor/${name}_raw.glb"
npx gltfpack -i "vendor/${name}_raw.glb" -o "$out" -cc -kn -km -ke -kv -vpf -vtf -vn 8
ls -la "vendor/${name}_raw.glb" "$out"
