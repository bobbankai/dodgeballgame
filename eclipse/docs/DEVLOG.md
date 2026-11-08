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
