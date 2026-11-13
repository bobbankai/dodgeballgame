# Commands (run from /home/user/dodgeballgame)
- Dev server: `npm run eclipse` (vite --config eclipse/vite.config.ts). Use port 5181+ in scripts; 5180 was used earlier.
- Typecheck: `npm run eclipse:typecheck` (or `npx tsc --noEmit -p eclipse`).
- Build: `npm run eclipse:build`. Tests: `npm run eclipse:test` (vitest --root eclipse).
- Headless play: `node eclipse/tools/play.mjs "<url>/?test&level=<id>&quality=low" <outDir> @script.json [w h]`. Query: `level=sky|forest|eclipse|playground|kitview&kit=...`, `boss=<id>`, `enemies=a,b`, `nointro`, `touch`.
- Blender asset: `/opt/bvenv/bin/python eclipse/tools/blender/enemy_build.py <id> --res 2048 --preview` (full bake, slow ~20 min); `--retex` re-composites textures only (~50 s); `eclipse/tools/blender/cloth.py <id>` re-runs hem bones on a saved character .blend.
- Texture pipeline: `python3 eclipse/tools/tex/ph_fetch.py tex <ids> --res 2k` then `/opt/bvenv/bin/python eclipse/tools/tex/build_textures.py --only <ids>`.
- Machine has 4 cores; long builds run in background with `timeout: 7200000`.