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
`{"keys":["KeyW"],"t":1.0,"shot":"name","eval":"js"}` (a step's `eval` runs before its wait). In `?test`
mode `window.__game`, `window.__G` (the shared uniforms: `__G.uPigment.value.set(1,1,1)` shows colour),
`window.__audio` and `window.THREE` are exposed; `__game.pipe.uniforms.uDebug.value` = 1/2/3 shows the
ambient occlusion, contact shadow or bloom buffer; `__game.player.expression.set('joy')` (and
`.autoBlink = false`) poses a face; headless timing is meaningless (no real GPU); `__game.ui.autoAdvance = 0.4` makes dialogue and notes move on by
themselves. Scripted walking: set `__game.player.goal` with `inputEnabled = false` (goals are ignored
while the player has control). `tools/tile.py <dir> <out.png> [cols]` (run with the scratchpad venv's
python, system PIL is broken) tiles screenshots into one sheet, sorted by file name (b10 < b2).

## Assets (Blender 4.5 at /opt/blender, run headless)

- `blender -b -P tools/blender/<script>.py -- --export` writes GLBs into `src/assets/`.
  `--preview out.png` renders Cycles previews; `--poses out.png` renders animation contact sheets.
- `lib.py` shared helpers (shapes, materials, rig, Poser, spline clip authoring, bake_materials,
  export). `sdf.py` sculpts with signed distance fields (numpy): primitives, smooth union / subtract /
  intersect, shells, displacement, noise; `sculpt()` meshes a field (narrow-band surface nets, vertices
  projected onto the field, decimated to a triangle budget); `bake_ao()` bakes Cycles AO per vertex.
  Characters are sculpted this way, one continuous surface per material, AO painted into the colours;
  `figure.py` holds the shared character pieces (surface placement, eyes with a painted iris clipped
  by the lids, hands, sleeve weighting, the AO-aware painter). Pip and the Keeper are sculpted then
  decimated symmetrically to flat facets (folded paper). `kit.py` environment pieces: `box()` is a
  hand-made block (rounded edges, a slight lean, `wobble=0` where pieces must meet exactly);
  `sculpt()` for sculpted scenery (cottages, roofs via `roof_field`, trees and rocks from a few
  cached variants, props, `turned_leg`, `spindle_chair`, `mug`; the windmill, shed, Great Tree,
  bridge, stairs and door frame). Give a sculpt enough triangles for its detail: a grooved surface
  (stone courses, boards) decimated too hard shatters into shards, so check every new piece in a
  preview. Long thin round things (poles, whips) are cleaner as `lib.tube` meshes; openings in a
  round wall use cylindrical coordinates so their surrounds follow the curve.
  `ada.py` + `ada_anims.py`, `pip.py`, `attic.py`,
  `margin_village.py`; Chapter Two: `kit_sea.py` (lighthouse, the dinghy (a lofted clinker hull
  from `hull_lines`, seats cut to it with `fitted_plank`), pier, stacks, inkwell), `crane.py`
  (the Keeper), `folded_sea.py` (level); Chapter Three: `mum.py` (Mum: her own design, nothing like Ada's,
  long copper hair and braid, indigo dress, paint-splashed apron, fingered hands; Ada's bone names so
  the scenes and her walk work, with her own idle, talk and kneeling clips), `unfinished_page.py`.
  Blender (x, y, z) is three (x, z, -y).
- Faces: Ada and Mum have expression bones `brow_L/R` and `mouth_L/R` (the mouth line and Mum's lips
  fade from the corners into `mouth`, the skin round them follows: weight kind `face`), plus
  `eye_L/R` and `mouth` as before.
- Rig conventions (Blender, character faces -Y, left = +X): pose rotations are written about the
  armature axes and converted per bone (`Poser`). +X bends an upward bone forwards / swings a
  downward bone back; `ax` sets a bone's absolute pitch. `sym=k` mirrors _L channels to _R k frames
  out of phase.
- Scenery is merged per 60 m chunk and its materials are baked into vertex colours, with the ink
  line id in the colour alpha (ids 10-199; runtime ids are 200+). One draw call per chunk.

## Renderer (src/render)

- `InkMaterial.ts`: the only surface shader (`gloss` / `glossSize` / `glossWhite`: highlights left as bare paper). Toon wash + cool shadow wash, sun (SunLight cascades)
  and point lights, world-space pencil hatching, graphite vs colour mixed by watercolour bloom masks
  and pigment families (green / blue / warm), erase field (the Smudge), drawn water. `uPigment` is
  what is restored everywhere; each bloom carries its own families (`uBloomTint`) as it spreads, and
  folds into `uPigment` when done. `waves` displaces by the sea (`glsl.ts` WAVES = `Sea.seaHeight`).
- `Pipeline.ts`: MRT (colour + view normal/line id; colour alpha = how sunlit) + depth, 4x MSAA at
  high quality -> half-res ambient occlusion + sun contact shadows (depth-aware blur) -> quarter/eighth
  bloom -> composite: AO and contact shadows as cool washes, reflections on water (line id 3, marched
  through the depth buffer), ink lines (inverse-depth laplacian, normals, ids, dry-brush break-up),
  wash banding, wet edges, paper, grading, filmic shoulder, dither. `setQuality('high'|'medium'|'low')`
  (pause menu, remembered; `?quality=`). Materials add sky fill / ground bounce (`setFill` per level),
  aerial perspective toward `uSkyTop`, and slow pigment variation.
  The composite writes scene depth so the `overlay` scene (sketch strokes, particles, sprites) is
  depth-tested but never outlined. Overlay shaders output display colours directly.
- `Sketch.ts` screen-space pencil ribbons (must be double-sided) and ghost hatching.
- `Portrait.ts` the last page, painted step by step on a canvas texture (pencil, washes, details);
  `InkOptions.reveal` draws a figure in from the feet up with a gold edge (Mum).

## Game (src/game, src/levels)

Game loop, Player (floating capsule + ground ray, step-up, `ride()` a seat), Animator (weighted clip
blending; `layers` run around the mixer), Procedural (look-at over chest/neck/head and spring-driven
loose bones: Ada's scarf and satchel, Mum's braid; it restores the mixer's value before the mixer runs,
since the mixer only writes changed values; `Game.looks()` decides who looks at whom), Face (`expression` on Ada, Mum: twelve emotions as brow/eye/mouth poses, its own blinks,
lip flaps on vowels; FoxFace for Pip: ears, tail, head tilt; it sets bones from rest each frame
because the mixer only writes values that change), dialogue lines `[who, text, emotion?]` (else
`inferEmotion`), listeners echo, `director.feel()`, CameraRig (orbit, five-ray collision that looks past railings, shots,
`guide` hook for awkward places like the spiral stair, `sailing()`), Director (async story scripts on
game time, `rail()` camera moves, `focus()` depth of field, `cinematic()`), Trace (ink-in
mechanic), DrawnPath (paths Ada draws herself in Chapter Three), Companion (Pip), Keeper (crane),
Mum, Boat, Sea, Storm, Smudge, Flow (title, prologue to epilogue in order, credits, saves in
localStorage, pause). A level only reaches the frame loop once `load()` finishes. `loadLevel` resets
Ada (`Player.reset()`), the UI (`UI.reset()`: a pending line or note is dropped, so the old level's
script stops), the camera, and frees the old level's GPU resources; `loadGLTF` returns a fresh copy
of the scene every call (levels repaint and move what they load).
Full-story regression bot: `node tools/drive.cjs '<url>/?test' tools/storybot.js` plays from the
title to the credits, teleporting between beats and calling `finish()` on traces (~25 min headless);
run it against a separate `vite build --outDir` served statically, since editing sources reloads the
dev server. In drive scripts never return a story promise from `ev()` (it waits on game time that only
passes when the script steps it): wrap calls as `ev(() => { void level.method(); })`.
Interactable check: `R=<radius> STEP=<grid> node tools/drive.cjs '<url>' tools/interact_check.js` finds,
for every enabled interactable, a spot Ada can walk to (flood fill over the floors, jumps only if
needed) where it becomes the prompt, then uses it the way the phone's button does and reports
OK / FAIL / UNREACHABLE (later beats are unreachable until earlier ones are done, by design).
Interactables with `at` (things to look at or read) are chosen by distance plus facing, so neighbours
can each be picked; Ada glances at the one offered. On phones the prompt itself is a button (Tap /
Hold) and the round action button is labelled with what it will do (`UI.actionLabel`).

Voices (src/audio/Speech.ts): every line is recorded with a neural voice (Kokoro-82M via
kokoro-onnx, run locally): `node tools/voices/lines.mjs > lines.json` collects the lines (tuples,
`say()` calls, the attic's looks, Mum's notes, which she reads aloud), `tools/voices/record.py
lines.json <kokoro dir>` writes `src/assets/voices/<lineKey>.mp3` + `manifest.json` (duration and a
loudness envelope that moves the mouths and paces the text). Each character is a blend of Kokoro
voices with its own rate and pitch/formant shift. Change a line and it babbles until re-recorded
(the script skips lines it already has; `FIX` holds respellings for words the model misreads).
Pause menu: Voices On/Off. `?test` turns them off (they run in real time); `__speech.enabled = true`.

Audio (src/audio, the rest synthesised): the score (felt piano panned by pitch, string section, flute,
harp, bells; generative around Mum's lullaby), voices (formant syllables per speaker, bent by the
line's emotion, music ducks under them), footsteps by surface (Collision classifies the ground's
painted colour: grass, wood, stone, sand, paper, water), ambiences (gusting wind, birds placed in the
trees, gulls), and `Soundscape` emitters in the world with the camera as listener (the stream along
its length, the windmill, surf on the nearest beaches, water lapping the boat, the attic clock,
chimes on the last page).

## Status

Done: Prologue (attic), Chapter One (Margin Village, green), Chapter Two (Folded Sea, blue),
Chapter Three (Unfinished Page, gold), Epilogue (morning attic) and credits. The whole story plays
from the title screen through to the credits.
