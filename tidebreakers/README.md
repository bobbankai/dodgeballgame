# Tidebreakers — The Song Beneath the Sea

A third-person action brawler with a story, built in Babylon.js on WebGPU with an anime cel-shaded look.
Kai Marlowe, seventeen, carries a storm in his chest; across five chapters he loses his grandmother,
gathers a crew of people who each lost someone, and faces the Grand Admiral who wants to still the sea
forever. An original world and cast in the spirit of big-hearted pirate-adventure manga (no characters,
names or places from any existing series). Full design: `docs/DESIGN.md`.

Everything is made from code in this folder: the characters, rigs, animations, scenery and levels come
from Blender Python scripts, and the game is TypeScript with a hand-written WGSL renderer. Nothing is
reused from the rest of the repository.

## Run

```
npm install
npm run tidebreakers            # http://localhost:5175  (title screen)
npm run tidebreakers:build      # typecheck + production bundle in dist-tidebreakers/
```

A browser with WebGPU is required (Chrome / Edge 113+, Safari 18+).

URL options: `?level=<id>&at=<beat>` jumps into a level (`prologue`, `gulls`, `ashport`, `market`, `shoals`,
`crown`, `epilogue`; beats are listed in each level's `beats`), `?view=<character>&anim=<clip>` opens the
model viewer, `?quality=high|medium|low`.

### Controls

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Move / camera | WASD / mouse | sticks |
| Light attack (4-hit combo) | J / left click | X / Square |
| Heavy (hold to charge a launcher) | K / right click | Y / Triangle |
| Jump (attack in the air) | Space | A / Cross |
| Dodge | Shift | B / Circle |
| Guard, tap just before a hit to parry (also parries bullets back) | Q | LB |
| Gale Burst / Tempest Dash | E / R | RB / RT |
| Crew assist | C | LT |
| Hurricane (full storm meter) | F | L3 + R3 |
| Lock on | Tab | R3 |
| Advance dialogue | Space / click | A |
| Pause | Esc | Start |

## The story

Prologue (the night of the Great Squall), five chapters and an epilogue, played in order from the title
screen (a live scene: the Wren under sail at golden hour) to the credits; saves at every beat (localStorage, Continue / Chapters on the title screen).

| Level | | Boss |
|---|---|---|
| Prologue: The Lantern | Seren rows out to a sinking ferry; her son wades into the sea after her | |
| 1 Gull's Rest | Sparring with Grandma Ines, a last ordinary morning with the village, the Armada lands, the cliff path, Ines's death | Commodore Halvard |
| 2 Ashport | Mira, the mines, following her brother Teo's chalk drawings down to Tunnel Nine | Baron Gorrick Vane (two phases, furnace vents) |
| 3 The Drowned Market | A night on the Wren (Kai's mother, Teo), Bram's soup kitchen, his confession, throwing the lifebuoys, Hana | Halvard again (two phases) |
| 4 The Weeping Shoals | Nell's lighthouse, her father's survey flags and his bottle, the wreckers, his last letter | The Weeping Maw (serpent) |
| 5 The Sunken Crown | The crew holds the gates; Kai reads the Albatross's names aloud, and adds Ines's; Ys-Marrow rises; the lantern and Lissa's name | Grand Admiral Vale (three phases) |
| Epilogue: The Wake | Dawn at sea | |

About 310 lines of dialogue, 15 arena fights, a tutorial spar and five bosses. Play time is
measured by the play-bot (see Testing), which plays straight through with no exploring. The latest full runs
from the prologue to the end of the epilogue: 61–62 minutes including the fights it lost and replayed
(12–16 deaths), and 48–51 minutes for a player who never dies; the credits add half a minute.
Loading screens are not counted, and neither is any time the bot spends stuck on scenery (none in these runs).

## Layout

```
src/render      Renderer (MRT G-buffer, cascaded sun shadows with drifting cloud shadows, AO, screen-space
                reflections on the sea, DOF, sun shafts, bloom, anime lens flare, final grade), Trails
                (strike arcs behind blades, fists and feet),
                Globals (shared uniform block), materials, Vfx (GPU particle quads, lightning)
src/shaders     WGSL: lib/ (lighting, toon, face, shadows, noise, sky, waves, surfaces), materials/
                (toon characters, outlines, terrain, scenery, ocean, grass, sky), post/ (AO, bilateral
                blur, SSR, DOF, shafts, bloom, final), vfx/ (particles)
src/game        Game (combat resolution, hazards, projectiles), Fighter, Player, Animator (retargeting,
                blending, layers), Procedural (look-at, spring chains), Face, CameraRig, Collision, Props
src/ai          enemy archetypes, crew allies, bosses
src/world       Terrain, Sea (CPU mirror of the waves), EnvKit (scenery instancing), Boat, Serpent, Grass
src/story       Director: dialogue, camera framing, acting, letterbox, depth of field
src/levels      one file per level (world + script), Level base (beats, checkpoints, fights, weather)
src/Flow.ts     title, chapter order, saves, death and retry, pause, credits
tools/blender   asset pipelines (run with Blender 4.5 headless)
tools/play.mjs  headless runner (software WebGPU) for screenshots and scripted play
```

## Asset pipelines (Blender, headless)

- Characters: `blender -b -P tools/blender/chars.py -- <name> --export` runs the staged pipeline in
  `tb/pipeline.py`: reference analysis → parametric blockout → quad cage (direct polygon modelling) →
  subdivision projected onto an SDF sculpt → relaxed topology → garments extracted from the body and
  inflated, refined (hem smoothing, extra subdivision, joint folds) → materials (albedo, class, baked AO,
  face mask) → rig with anatomy-based weights → deformation tests → LOD1 → GLB. Each stage renders
  evidence into `docs/art/<name>/` (blockout, cage, topology, final front/side/back/three-quarter, face,
  arm raised, elbow and knee bent, action pose). 18 characters: `chars.py` (Kai) and `cast.py`.
  Anatomy (`tb/body.py`): the shoulder line falls from the neck along a trapezius into a deltoid that wraps
  the upper arm (the arm's rounded end sits inside the shoulder), so sleeves and coats drape instead of
  sitting on pads; broad shallow pecs; heads have a clean face plane, a small nose ridge, shallow eye
  hollows (the eyes are drawn by the shader) and a soft V jaw. Hair (`tb/wardrobe.py`): a volume with
  strand grooves sculpted from the crown whorl, covered by locks combed over the head (they follow the
  scalp at the hair's thickness, layer outward like shingles, leave the head below a release height and fall
  with gravity, tips curling in), each lock arched on top with blade-thin edges. Trousers keep their legs
  separate below the thigh (no web between the knees); loose cloth gets wider weight smoothing; every
  cloth and leather edge gets a darker piping and a light stitch line.
- Animation: `blender -b -P tools/blender/anims.py -- --export` writes `public/assets/anims/humanoid.glb`.
  Combat moves are hand-keyed (`anims.py`: key poses → FK interpolation with easing → two-bone IK contact
  solving → overlap). Locomotion and acting come from motion capture (`mocap_anims.py`, `tb/mocap.py`):
  CMU Graphics Lab Motion Capture Database ASF/AMC files are downloaded on demand, retargeted in world
  space onto our rig (per-bone rest alignment, analytic local rotations, keyed finger poses, gaze
  correction), trimmed to seamless cycles and made in-place with their travel speed recorded in
  `mocap.json`. Contact sheets: `--sheets <clips>` → `docs/art/anims/`. Mocap data: mocap.cs.cmu.edu
  (free for use in products; the raw data may not be resold).
- Scenery: `blender -b -P tools/blender/envkit.py -- <kit> [--preview]` (`common`, `gulls`, `ships`, `props`,
  `ashport`, `market`, `shoals`, `citadel`): pieces built from bevelled blocks, lofted hulls, tubes and SDF
  sculpts, painted per vertex (albedo, wind sway, baked AO, surface class for the shader).

## Testing

`node tools/play.mjs "<url>?test&level=gulls&at=village" <outDir> '<json steps>' [w] [h]` steps the game
deterministically in headless Chromium with software WebGPU and saves screenshots. Steps:
`{"t": seconds, "shot": "name", "eval": "js", "keys": ["KeyW"]}`. In `?test` mode the page exposes
`__game`, `__kai`, `__flow`, `__r` (renderer), `__ui`; `window.__autoplay = true` lets a bot walk to
objectives and end fights so whole chapters play through; `__ui.autoAdvance = 0.3` advances dialogue.
Long runs should use a static build (`vite build --outDir <dir>` served on its own port), because the dev
server reloads the page when sources change.

Play time is measured with a play-bot (`src/test/PlayBot.ts`, `window.__playbot = true`) that only uses the
controls: it runs to each objective marker, fights with combos, launchers, specials it has unlocked and crew
assists, steps out of warning circles, jumps tide rings, dodges or parries some telegraphed swings (more as it
dies and learns a fight), and reads each line of dialogue at about 200 words a minute before pressing on. It
dies and restarts from checkpoints like a player. `node tools/playtime.mjs "<static url>/?test&level=prologue"
<outDir>` plays the whole story that way and writes `playtime.json` (minutes per level and checkpoint, deaths,
time lost to them, times it had to be moved past scenery). Gameplay and UI timers run on game time, so the
headless measurement matches real play. `__r.globals.set('counts', n, k, 2, 0)` with k = 1 normals,
2 depth, 3 ids, 4 raw HDR, 5 AO, 6 shafts, 7 depth-of-field mask shows the debug views.

## Status and honest notes

- The whole story plays from the title screen to the credits under the test bot.
- Shader code: about 2,700 lines of WGSL across 37 files, every line in use. It has not been padded toward
  the requested 20,000. Effects were added where they visibly improve the game and are reported at their
  real size.
- Characters are stylized and fully rigged with deformation tests, with proper shoulder anatomy, anime
  hair built from combed locks and finished hems, but they are procedural, not hand-sculpted by an artist:
  hands are simple and garments have no texture detail beyond painted trims.
- Scenery is built from procedural pieces; the look comes mostly from the shaders and lighting.
