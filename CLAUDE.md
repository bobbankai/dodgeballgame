# Inkbound

A story game in three.js: Ada, 12, steps into her late mother's sketchbook and restores its colours.
Full design: `docs/DESIGN.md`. Everything is built from code: Blender Python scripts make the models,
rigs, animations and levels; the game is TypeScript + three.js with a custom ink-and-wash renderer.

## Run

- `npm run dev` then open http://localhost:5173 (title screen).
- Dev shortcuts: `?at=<checkpoint>` jumps into Chapter One (`arrival`, `stream`, `bridge`, `village`,
  `terrace1`, `terrace2`, `terrace3`, `plateau`); `?level=sea[&at=...]` Chapter Two (`arrival`, `shore`,
  `headland`, `gallery`, `pier`, `sea1`-`sea3`, `island`); `?level=page[&at=...]` Chapter Three (`arrival`,
  `kitchen`, `garden`, `studio`, `page`); `?level=epilogue`; `?level=attic` the prologue; `?level=playground`.
- `npx tsc --noEmit` typechecks; `npm run build` makes the production bundle.

## Testing without a GPU

`node tools/play.mjs "http://localhost:5173/?test&at=village" <outDir> '<json script>' [w] [h]` steps the
game deterministically (software WebGL) while holding keys and taking screenshots. Script steps:
`{"keys":["KeyW"],"t":1.0,"shot":"name","eval":"js"}`. In `?test` mode `window.__game` and
`window.THREE` are exposed; `__game.ui.autoAdvance = 0.4` makes dialogue and notes move on by
themselves. Scripted walking: set `__game.player.goal` with `inputEnabled = false` (goals are ignored
while the player has control). `tools/tile.py <dir> <out.png> [cols]` (run with the scratchpad venv's
python, system PIL is broken) tiles screenshots into one sheet, sorted by file name (b10 < b2).

## Assets (Blender 4.5 at /opt/blender, run headless)

- `blender -b -P tools/blender/<script>.py -- --export` writes GLBs into `src/assets/`.
  `--preview out.png` renders Cycles previews; `--poses out.png` renders animation contact sheets.
- `lib.py` shared helpers (shapes, materials, rig, Poser, spline clip authoring, bake_materials,
  export). `kit.py` environment pieces. `ada.py` + `ada_anims.py`, `pip.py`, `attic.py`,
  `margin_village.py`; Chapter Two: `kit_sea.py` (lighthouse, boat, pier, stacks, inkwell), `crane.py`
  (the Keeper), `folded_sea.py` (level); Chapter Three: `mum.py` (Mum: her own design, nothing like Ada's,
  long copper hair and braid, indigo dress, paint-splashed apron, fingered hands; Ada's bone names so
  the scenes and her walk work, with her own idle, talk and kneeling clips), `unfinished_page.py`.
  Blender (x, y, z) is three (x, z, -y).
- Rig conventions (Blender, character faces -Y, left = +X): pose rotations are written about the
  armature axes and converted per bone (`Poser`). +X bends an upward bone forwards / swings a
  downward bone back; `ax` sets a bone's absolute pitch. `sym=k` mirrors _L channels to _R k frames
  out of phase.
- Scenery is merged per 60 m chunk and its materials are baked into vertex colours, with the ink
  line id in the colour alpha (ids 10-199; runtime ids are 200+). One draw call per chunk.

## Renderer (src/render)

- `InkMaterial.ts`: the only surface shader. Toon wash + cool shadow wash, sun (SunLight cascades)
  and point lights, world-space pencil hatching, graphite vs colour mixed by watercolour bloom masks
  and pigment families (green / blue / warm), erase field (the Smudge), drawn water. `uPigment` is
  what is restored everywhere; each bloom carries its own families (`uBloomTint`) as it spreads, and
  folds into `uPigment` when done. `waves` displaces by the sea (`glsl.ts` WAVES = `Sea.seaHeight`).
- `Pipeline.ts`: MRT (colour + view normal/line id) + depth -> composite: ink lines (inverse-depth
  laplacian, normals, ids, dry-brush break-up), bloom, wash banding, wet edges, paper, grading.
  The composite writes scene depth so the `overlay` scene (sketch strokes, particles, sprites) is
  depth-tested but never outlined. Overlay shaders output display colours directly.
- `Sketch.ts` screen-space pencil ribbons (must be double-sided) and ghost hatching.
- `Portrait.ts` the last page, painted step by step on a canvas texture (pencil, washes, details);
  `InkOptions.reveal` draws a figure in from the feet up with a gold edge (Mum).

## Game (src/game, src/levels)

Game loop, Player (floating capsule + ground ray, step-up, `ride()` a seat), Animator (weighted clip
blending, face overlays), CameraRig (orbit, five-ray collision that looks past railings, shots,
`guide` hook for awkward places like the spiral stair, `sailing()`), Director (async story scripts on
game time, `rail()` camera moves, `focus()` depth of field, `cinematic()`), Trace (ink-in
mechanic), DrawnPath (paths Ada draws herself in Chapter Three), Companion (Pip), Keeper (crane),
Mum, Boat, Sea, Storm, Smudge, Flow (title, prologue to epilogue in order, credits, saves in
localStorage, pause). A level only reaches the frame loop once `load()` finishes.

## Status

Done: Prologue (attic), Chapter One (Margin Village, green), Chapter Two (Folded Sea, blue),
Chapter Three (Unfinished Page, gold), Epilogue (morning attic) and credits. The whole story plays
from the title screen through to the credits.
