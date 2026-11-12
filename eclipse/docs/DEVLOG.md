# Eclipse: Fallen Gods — development log

A persistent record of what is built, what is verified, what is blocked and what comes next. Newest
entries at the top. "Verified" means seen working in the running game (headless WebGPU and/or
WebGL 2 screenshots, or tests), not just compiled.

## Environment notes

- Blender is the `bpy` 5.2.3 Python module (PyPI), in `/opt/bvenv` (`/opt/bvenv/bin/python script.py`).
  download.blender.org is not reachable from the build sandbox; the module is the same Blender.
- MPFB 2.0.18 (MakeHuman for Blender, GPL code; its base mesh, targets, rigs and weights are CC0) is
  cloned from GitHub to `/opt/eclipse-raw/mpfb2` and installed as a bpy extension (`mpfb.zip`).
- Poly Haven (CC0) textures: `tools/tex/ph_fetch.py` -> `/opt/eclipse-raw/ph`, then
  `tools/tex/build_textures.py` -> `public/assets/tex/*.webp` (1K albedo / normal / ORM).
- FluidR3 GM soundfont (MIT) and FluidSynth from apt, for rendering the score.
- Headless Chromium runs WebGPU on SwiftShader (`maxInterStageShaderVariables` = 16) and WebGL 2 on
  SwiftShader. `tools/play.mjs` drives the game in either (`--gl webgl2`).

## Log

### Session 7 — shading v2, and a class of bug found by A/B: HDR-scaled terms

Built (see `docs/RENDERING.md`):
- **`EcShading` plugin on every PBR material**: sun contact shadows marched through the depth
  pre-pass (applied to the sun's own shadow term, so fill and reflections are untouched), cloth fuzz
  keyed per texel on roughness/metalness, leaf translucency, world-space macro variation, geometric
  specular anti-aliasing. WebGPU and WebGL 2 versions of every snippet.
- **Local light probe** (`Lighting.updateLocal`): the surroundings near the player captured into the
  environment cube, diffuse SH eased old -> new (never pops), first capture blocks the level load.
- `?test` exposes `__shade` and `__refreshShading()`; `Shade.debug` = 1/2 paints the contact term and
  the depth-agreement check.

Found and fixed by A/B (each seen broken, then seen working):
- **Kael's face was flat red plastic.** The skin plugin's subsurface terms are added in HDR times the
  sun's colour*intensity (4+); at 0.85/0.55/0.35 they swamped the albedo. Plugin off showed a real
  face. Now 0.12/0.5/0.06 (+ Babylon translucency 0.08).
- **White speckle on the back of his head**: the same scale bug in the Kajiya-Kay hair terms
  (0.35/0.6 -> 0.03/0.2). Bisected: plugin off = clean, mesh hidden = scalp only.
- **No tree had ever received leaf translucency**: the photoscan leaf materials are alpha-BLENDED
  (the Blender round trip turns the scan's cutout into a blend), so my `needAlphaTesting()` check
  never matched. Blended leaves also write no depth (fog, AO and contact shadows could not see them)
  and sort badly. They are now alpha-tested cutouts (0.42) with translucency 0.4.
- **Aurelion's head was hollow**: his mask was a face plate only (nothing behind it, the crown floating
  on an empty skull) and a void-glass "mouth" read as a scream. Golden skullcap added, mouth removed.
- **Eclipse Priest** was a tight white bag over a mannequin head: now a loose cowl open at the face
  with a gold slit-eyed mask.
- **Every boss's death scene played over an empty floor** (found by playing the Eclipse ending): the
  death clips drop the pelvis below the floor on every rig (0.25 m on a thrall, 1.7 m on Aurelion's
  tall one), the body dissolved 0.2 s before the scene began, and the cameras were aimed at
  standing-chest height. Now `Enemy.groundBody` keeps the fallen body on the floor,
  `holdBody`/`releaseBody` keep it for the scene, and all five `bossDeath` shots frame `bodyCentre()`.

Playability pass (finishing the game):
- **Production build** (`npm run eclipse:build`): clean, 6.7 MB JS (1.5 MB gzipped) + 289 MB of assets;
  `dist-eclipse/` is git-ignored. Unit tests (16) pass.
- **Settings > Controls**: keys were rebindable in the data and the input layer but there was no way to do it.
  Pick an action, press the new key or mouse button (Esc cancels); a key another action held swaps over to
  it, so nothing is doubled or unbound. Verified in the game, including the swap and the Esc cancel (which
  first also closed the menu: the input layer ran before the menu's handler on synthetic events).
- `eclipse/README.md`: how to run and build, controls (keyboard, gamepad, touch), combat basics, options.
- The local light probe no longer runs while a level loads (a WebGPU validation warning appeared in
  overlapping level swaps; the probe sampled scenery that was being created and disposed).
- A test-harness lesson: game time is frozen while a level loads, so waits in a test script must be real-time
  conditions (`__game.loading`), not `t:` seconds; the first chain run fired five chapter transitions at once.

Verified headless: all five chapters + the playground load with no shader errors in WebGPU and the
playground in WebGL 2 (re-run after the probe, foliage and skin changes); the Aurelion fight runs (sun-line eruptions, corona nova ring, burning status);
Kael, the Sentinel, Thornbound and Bloomcaller close up; the forest grove with the new foliage.

Not done yet / honest gaps:
- Aurelion's gold (and every `gold` look) reads as burnished bronze rather than bright metal in
  game: metals depend on what they reflect, and the environment cube is dull. Needs look-dev.
- Contact shadows and the local probe cost real GPU time that headless software rendering cannot
  measure; the numbers in RENDERING.md are step counts, not milliseconds. Low preset has neither.
- The ending was played headless up to the dawn climb (death scene, sparks, Ithra's farewell, the sky
  turning); the credits hand-off and the final banner were not captured.
- Kael's armour reads as matte blue-grey cloth rather than steel; the gear atlas for his plate needs a look.

### Session 6 — bugs found by playing: navmesh, materials, cutscenes; cloth; mobile HUD

Found and fixed (each seen broken, then seen working, headless):
- **Navmesh had no floor in the sky level.** `Navigation.build` flipped every mesh's triangles
  (right for the terrain and Babylon's builders, wrong for glTF kit collision), so kit tops became
  ceilings: in the Shattered Sky every query failed and monks stood still; raised kit geometry
  elsewhere (ramparts, bridges, stairs) was missing too. Winding is now read per mesh (an open sheet
  must face up; a closed solid must enclose positive volume). Coverage checked on Ashen, Drowned,
  Sky and Forest; monks now close in and attack.
- **Cloth printed a gingham check.** The `cloth_weave` detail texture is a picnic check, so linen,
  rope, char-cloth, feathers and petals all showed plaid; bone and pearl used a tiled marble floor
  (grout lines). New Poly Haven sets (linen, poplin, white leather); 13 characters re-composited
  (`enemy_build.py <id> --retex`, no re-bake).
- **Hairlines of the wrong material along seams.** Material IDs are baked as colours; across a
  seam the blend can land exactly on a third material's colour (sap-glow between petal and leaf,
  barnacle between kelp and sea-glow, char-cloth between char and rust: 7 characters). The decoder
  now gives such thin between-texels back to the materials on either side.
- **Statues and columns had floor-tile grout.** `sun_marble` is now procedural veined slab marble
  (`tools/tex/gen_marble.py`).
- **Danger telegraphs burned to white discs** (additive at 3-5x). Now a sigil: thin rim, guide
  circles, glyph strokes that light in turn as the strike nears, a capped fill that keeps its hue.
- **A boss intro could be skipped and the boss wake mid-cutscene**, hitting a player who could not
  move: `Director.play` dropped scripts asked for while another ran. Scripts now queue.
- **Phone layout:** the hotbar sat mid-screen; the boss bar covered Kael's bars; the pause button was
  trapped inside the scaled pad; subtitles ran under the buttons. Reworked for narrow and short
  screens (boss bar top right, hotbar bottom centre on touch, lines in the open middle-left).
- Bloomcaller redesigned: blossom circlet seated on the hood, leaf robe, fine sap veins.

New:
- **Cloth secondary motion.** `tools/blender/cloth.py` (run by `enemy_build.py`; standalone for
  built characters) adds four hem bones under the pelvis and weights hanging cloth (below the hips,
  clear of leg and foot capsules) to them; `anim/ClothSprings.ts` hangs each panel along the
  effective gravity (trails a lunge, swings on after a stop), flares it on a spin, lets a striding
  thigh push it out, and couples the panels into one ring. On 13 characters; seen on the monk,
  acolyte, cinder knight and Ignaroth in motion. (First try weighted the ankle wraps too: they swung
  out like skis. Feet are excluded now.)
- `?level=playground&boss=<ignaroth|thaloryn|vaeltris|sylvaris|aurelion>` for fight tests.

Verified headless this session: Vaeltris (intro after the chapter opening; hits both ways, adds,
stagger, shock), Sylvaris (lash, spores, root status, thicket telegraphs), the sun kit pieces.

Still open: Chapter Five (Sentinel, Priest, Aurelion still building at the time of writing), the
ending cinematic, Kael's own tabard (Kael's export carries face morphs; cloth.py does not handle it
yet), wing secondary motion for Vaeltris.

### Session 5 — Chapters Three to Five, the ending, downloaded photoscans

Built:
- **Chapter Three, the Shattered Sky** (`levels/ShatteredSky.ts`, `?level=sky`): Aethel Spire torn
  into islands over a sea of cloud (a billowing heightfield, `world/CloudSea.ts`); rope bridges,
  stairs and stepping stones to the Stormcrown; distant lightning strikes. Sky kit (17 pieces).
  Stormbound Monk (glaive, dodges, shock), Tempest Warden (bolts, lightning strikes, wards),
  **Vaeltris** (hovering; walking lightning strikes, wind gust, feather fans, a dive from the
  clouds, the tempest, summons). Lightning bolts (`vfx/Lightning.ts`: jagged forked channels with
  return-stroke flicker, sky flash, thunder delayed at the speed of sound). Shock status.
- **Chapter Four, the Forgotten Sanctuary** (`levels/Sanctuary.ts`, `?level=forest`): a forest
  valley past the root-swallowed gate, the keepers' grove, a ravine crossed on a fallen giant, the
  blight, and the Heartwood glade ringed by roots under a colossal flowering tree. Forest kit
  (17 pieces) plus **downloaded CC0 photoscans** (Poly Haven: ferns, shrubs, stumps, roots,
  trunks, moss, boulders and three trees) through a new pipeline (`tools/models/ph_models.py`,
  `tools/blender/import_models.py`: decimation to budgets, leaf-island thinning for trees, WebP
  textures; EnvKit keeps their own materials). Thornbound, Bloomcaller, **Sylvaris** (lash,
  thicket of roots, spore pods, vine grasp, regrowth that heals unless staggered, the bloomfield,
  summons). Root status (a dodge tears free).
- **Chapter Five, the Eternal Eclipse** (`levels/Eclipse.ts`, `?level=eclipse`): Solmara's
  terraces under a huge black sun; Gilded Sentinels (sword and tower shield; off-hand weapons are
  now attached), Eclipse Priests (sun rays, flares, wards), **Aurelion** (greatsword, sun-lance,
  solar flares, corona nova rings to jump or dodge, the Black Sun phase that darkens the summit
  and looses void orbs, summons). **The ending**: the sparks given back, the black sun sliding
  off the sun as the sky turns to morning, then the credits.
- Story: chapters 3–5 (Ithra's confession, the truth about the Eclipse), 111 recorded lines in
  all; scores for every chapter and boss plus the ending (11 pieces); storm, forest and sun sounds.
- Gear pipeline: material IDs widened to 64; storm cloth, storm-glow, feather, copper, silver,
  bark, moss, petal, sap-glow, leaf, sun-glow, white cloth and void-glass materials; seven new
  weapons; Vaeltris's wings rebuilt twice (now an armoured arm with overlapping feathers).
- `?level=kitview&kit=<sky|forest|photoscans|trees|sun|...>` lays a kit out with game materials.
- The simulation holds while a level loads; small ground cover casts no shadows.

Verified headless: the Shattered Sky loads and renders (islands, bridges, cloud sea, monks in
place); kit pieces and photoscans render with their own materials; the chapter transition and
the Thaloryn intro play.

Not done yet / honest gaps:
- Chapters Four and Five have not been played through headless yet (models still building at the
  time of writing); the Vaeltris, Sylvaris and Aurelion fights and the ending are untested.
- The sculpted forest trees (blobby canopies) were replaced by photoscans in the level; the forest
  kit's own trees remain only as a fallback.
- Wing and cloak animation is rigid (no cloth or secondary motion).

### Session 4 — Chapter Two: the Drowned Empire; two rendering bugs found and fixed

Built:
- **Level `drowned`** (`levels/Drowned.ts`, `?level=drowned[&at=forum|temple|arena]`): Vael Maris
  under knee-deep water in the rain. Harbour quay and triumphal arch → flooded Forum (colonnades,
  the Emperor's statue on a dry island, apartment blocks) → the aqueduct pouring from its broken
  ends → the canal bridge with stairs → the Temple of Tides (enterable cella with a lore beat) → the
  causeway → the flooded amphitheatre (eleven seating wedges, open to the south). Drowned kit:
  18 pieces (`tools/blender/drowned_kit.py`). One water plane to the horizon over a seabed so far
  water has depth for fog; invisible quay walls along the canal; falling into deep water washes
  Kael back to the last firm ground (fade, 8 % damage).
- **Enemies**: Drowned Reaver (spear; now a bronze cavalry face-mask with sea-glow eyes) and
  Tidecaller (water orbs, wards, surge). Per-archetype voices and deaths (brine and sea-glow
  instead of ash). **Thaloryn** (trident, scale 2.4, 3200 HP): thrust, sweep, two-hit combo, tidal
  wave, whirlpools that pull, submerge-and-geyser, twin crossing waves, summons; element-coloured
  phase blasts. Waves are now a curling crest mesh with a foam lip.
- **Wading**: speed −30 % at waist depth, water footsteps with droplets and a ripple ring; the
  camera rides above the surface. Surface layers know the water level (soaked, glossless,
  puddle-free below it).
- **Audio**: synthesized water set (wading, splash, geyser, wave roll, whirlpool, water cast,
  brine dissolve, rain / lapping / waterfall loops), drowned groans, Thaloryn's roar; score
  `drowned` (E dorian/aeolian, rolling triplets; four stems) and `thaloryn` (E phrygian, two stems).
- **Story**: `story/chapter2.ts` (opening flight over the city, forum / aqueduct / bridge /
  temple / arena beats, Thaloryn's rise, phase lines, his death — he knows Ithra). 24 new recorded
  lines; Thaloryn's voice is pitched down with a slow flanger in a drowned hall.
- **Chapter flow**: `Flow.chapterComplete()` loads the next chapter after the god's death scene;
  chapter select lists Chapter Two.

Fixed (both affected Chapter One too):
- Every environment-kit piece was being drawn **alpha-blended**: the baked AO travels in an RGBA
  colour attribute, so Babylon flagged the meshes `hasVertexAlpha`. They never reached the depth
  texture, so fog, SSAO and SSR treated buildings as sky (washed-out, see-through silhouettes;
  statues against the sky vanished). Assets never use vertex alpha now (`AssetManager`, `EnvKit`).
- **Terrain normals pointed down** (computed from a winding flipped in session 3), so the ground
  was lit from below and near-black. Normals now come from the heightfield.
- `sfx.py` wiped the recorded voice lines from the audio manifest; it keeps them now, and
  `record.py` re-registers lines it skips.
- Smoke particles faded in from full opacity (pops); every smoke layer now fades in.

Verified (headless WebGPU, 960×540 / 1280×720): the level loads (navmesh 246k tris), every area
renders, encounters spawn, the Thaloryn fight starts (banner, bar, attacks land, soak status),
tidal and twin waves and whirlpools play; Chapter One re-checked after the fixes.

Not done yet / honest gaps:
- Thaloryn's intro and death cinematics, the full fight to the end and the Ashen → Drowned
  transition have not been played through headless yet.
- Enemies are not slowed by water; no swimming (deep water is a wash-back by design).
- Chapters III–V, the camp interlude, the ending.

### Sessions 2–3 — shaders, Kael, combat, enemies, Ignaroth, Varn Keld (in progress)

Built:
- **Shader system** (`render/post/*`, `render/materials/*`): own post chain (6-level energy-conserving
  bloom with lens dirt, histogram-free auto exposure, CPU-built 3D LUT grading, ACES/AgX tone map,
  CAS sharpening, thin-lens DoF), volumetric fog with sun shadow-map light shafts, ray-marched
  volumetric clouds, PBR material plugins (ash/snow/moss cover, wetness and puddles, dissolve,
  animated emissive, skin, Kajiya-Kay hair, wind), a 4-layer height-blended terrain with biplanar
  cliffs, clustered local lights (`render/LocalLights.ts`) for fires and spell flashes.
- **Kael** built entirely by script in Blender (`tools/blender/kael.py`): MakeHuman CC0 body, SDF-
  sculpted armour shells, Cycles bakes, composited PBR textures (procedural forged steel and
  chainmail, `tools/tex/gen_metal.py`), hair cards, expression morphs, sockets. 52 hand-keyed clips
  baked through an IK control rig (`kael_anims.py`) plus 8 enemy clips.
- **Combat** (`combat/*`, `player/Player.ts`): swept blade hits, stats, attack table, parry/riposte,
  executions, dodge i-frames, lock-on, HUD. **Motion warping** for every attacker: each attack clip's
  real reach is measured from its animation (`anim/Reach.ts`) and the swing is steered to land.
- **Enemy AI** (`ai/*`): Recast navmesh + Detour crowd, perception (cone, line of sight, hearing),
  group tactics through an AI director (attack tokens, slots round the player), utility-scored
  attacks with chains and tells, blocks/dodges, poise breaks into executable stuns, ash-dissolve
  deaths; projectiles and telegraphed hazards (`combat/Projectiles.ts`, `combat/Hazards.ts`).
- **Ashen enemies** (`tools/blender/enemy_build.py`, `ashen_gear.py`, `ashen_weapons.py`): Ashbound
  Thrall, Cinder Knight, Pyre Acolyte, their weapons, and **Ignaroth** with his sword Cinderfall.
- **Bosses** (`ai/Boss.ts`, `ai/bosses/Ignaroth.ts`): phases with roaring transitions, phase-gated
  move sets, special moves (fire-line cleave, stomp, leaping slam, meteor rain, nova, summons).
- **VFX** (`vfx/*`): pooled HDR particle presets on game time, Catmull-Rom blade trails, ground
  telegraphs / shockwaves / scorch marks, falling ash, house fires, smoke columns.
- **Environment pipeline**: `tools/blender/envkit.py` + `ashen_kit.py` (walls, ramparts, towers,
  gatehouse, houses, chapel, stairs, rubble, dead trees, props; metric UVs, baked vertex AO,
  collision proxies) and `world/EnvKit.ts` (thin-instanced placement, merged collider for physics
  and navmesh), `world/TerrainBuilder.ts`, `world/Encounters.ts`.
- **Chapter One level** `levels/AshenKingdom.ts` (`?level=ashen&at=village|gate|throne`): first
  layout pass of Varn Keld from the Cinder Road to the Crucible Throne arena.

Verified (headless screenshots / logs):
- Playground fights against three enemies: approach, circling, token turns, telegraphs, hits on the
  player after motion warping was added, kills with ash dissolve, Cinder Knight impact + scorch.

Fixed along the way:
- MPFB targets were silently skipped (it matches by basename, not `dir/name`): Kael's face shaping
  had never applied. Fixed in `human.py`; Kael is being rebuilt.
- GLBs carried bake-only vertex colours (5 MB of waste on the thrall); exporter now drops them.
  Cloth/plate shells drop their hidden inner wall (half the UV space back).
- Recast saw every floor upside down (Babylon's index winding); navmesh input is now flipped.

Not done yet / honest gaps:
- The Ashen level is a first layout pass: not yet verified in the running game; no Undercroft, no
  lava fissures or rising-lava phase 3, no throne model; archers and hounds from the design are not
  built (the roster is thrall / knight / acolyte).
- No story cinematics, dialogue, camp, progression menus, saves, audio or mobile controls yet.
- Chapters II–V not started.

### Session 1 — foundation

Built:
- Project `eclipse/` (Vite + TypeScript strict, Babylon.js 9.35, Havok 1.3.14, recast-navigation 0.44).
  Scripts: `npm run eclipse`, `eclipse:build`, `eclipse:typecheck`, `eclipse:test`.
- `EngineHost`: WebGPU first, WebGL 2 fallback, resolution scale and device-pixel-ratio cap.
- `Clock`: fixed 60 Hz simulation, hit-stop and slow motion in real seconds, manual stepping in
  `?test` mode (the harness calls `__game.advance(seconds)`).
- Renderer: right-handed scene; `Sky` (procedural atmosphere, sun, eclipse corona, fbm clouds,
  stars, lightning), `Lighting` (sun with cascaded shadow maps — PCF or PCSS by quality — and the sky
  captured into a prefiltered environment cube for IBL), `Atmosphere` (height fog with HG sun
  scattering and a ray-marched noise layer), `Pipeline` (TAA / SSAO2 / SSR / atmosphere / god rays /
  motion blur / bloom / ACES + colour curves / DoF / FXAA / grain / chromatic aberration / sharpen),
  `MaterialLibrary` (tiled PBR from texture sets). Every custom shader exists in WGSL and GLSL.
- `Physics`: Havok with manual fixed stepping, static mesh / box / animated / dynamic bodies, ray casts.
- `Settings`: presets (low / medium / high / ultra), audio, controls with bindings, accessibility.
  `?quality=` and `?gfx=key:value,...` overrides.

Verified:
- Sandbox (`?level=sandbox`) renders correctly on WebGPU and WebGL 2 at low and ultra (SSR reflections,
  SSAO, fog, shadows, IBL).

Engine issues found and handled:
- Babylon 9.35 WGSL geometry-buffer shader calls `toLinearSpaceVec4` on a vec3 when the albedo is sRGB;
  patched at startup (`render/EnginePatches.ts`).
- On devices limited to 16 inter-stage varyings (SwiftShader, some phones) the pre-pass renderer's
  extra outputs push PBR + CSM shaders over the limit. `render/Caps.ts` detects this and makes SSAO,
  SSR and motion blur render a separate geometry pass instead; SSR's Fresnel blend is off in that mode.
- Rendering outside `runRenderLoop` needs `engine.beginFrame()/endFrame()` on WebGPU.

Not done yet: everything in Phases 2–10 (see the task list in the next entries).
