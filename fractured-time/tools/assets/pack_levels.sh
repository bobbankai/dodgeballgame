#!/usr/bin/env bash
# Pack the level sections for the game: meshopt compression (the loader decodes it), the raw Blender export kept in
# vendor/levels_raw/ (inspection, lightmap-UV checks, re-packing). Sections already packed are skipped.
#   tools/assets/pack_levels.sh            all chapters
#   tools/assets/pack_levels.sh ch3 ch4    some
# gltfpack flags as for the characters: -cc meshopt, -kn/-km/-ke keep node names (markers, colliders), material names and extras
# (recipes, lightmap paths, markers), -kv keep attributes, -vpf float positions (sections sit hundreds of metres from the
# origin), -vtf float UVs (lightmap UVs and window cells: interior-mapping seeds run past 4000), -vn 8 normal bits.
# Verified on the Chapter 3 offices: 23.7 MB -> 4.1 MB, rendered identical in both realities.
set -euo pipefail
cd "$(dirname "$0")/../.."
chapters=("$@")
[ ${#chapters[@]} -eq 0 ] && chapters=(ch1 ch2 ch3 ch4 ch5)
for ch in "${chapters[@]}"; do
  for f in public/assets/environments/$ch/*.glb; do
    [ -f "$f" ] || continue
    if node -e "const b=require('fs').readFileSync('$f');const j=JSON.parse(b.slice(20,20+b.readUInt32LE(12)));process.exit((j.extensionsUsed||[]).includes('EXT_meshopt_compression')?0:1)"; then
      continue
    fi
    raw="vendor/levels_raw/$ch/$(basename "$f")"
    mkdir -p "$(dirname "$raw")"
    cp "$f" "$raw"
    npx gltfpack -i "$raw" -o "$f" -cc -kn -km -ke -kv -vpf -vtf -vn 8 > /dev/null
    printf '%-44s %8d -> %8d KB\n' "$f" $(( $(stat -c %s "$raw") / 1024 )) $(( $(stat -c %s "$f") / 1024 ))
  done
done
