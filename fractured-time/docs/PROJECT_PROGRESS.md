# Project Progress (honest status)

Ladder: 1 Planned · 2 Implemented · 3 Integrated · 4 Tested · 5 Visually reviewed · 6 Polished · 7 Complete.
Update at the start and end of every session. Never mark above what the evidence shows.

## v1 restart (current)

The owner asked for a restart from scratch against `GRAPHICS_DIRECTIVE_PROMPT.md` and its two reference images (A: UE5 forest, the bar
for shaders/lighting; B: MetaHuman-class character, the bar for models). The v0 prototype is archived intact in `archive/v0-prototype/`
(its systems and lessons are listed further down and will be ported, not rewritten blind).

**Overall:** v1 has a realistic hero, a ported and tested gameplay core, a baked-lighting environment pipeline, Chapter 1's facility
(7 sections) plus its surface finale (2 sections), three HELIX enemy archetypes, the Sentinel A-07 boss, a cinematic director and a
scripted Chapter 1 from wake-up to the surface. **Chapter 1 is not yet complete** (see gaps). Chapters 2-5, the cast beyond Ethan and
the Echo, audio, menus and saves do not exist yet.

| Area | Status | Evidence / gaps |
|---|---|---|
| Asset acquisition (Poly Haven, ambientCG, MPFB 2 + MakeHuman CC0 packs, CMU mocap), licence ledger `docs/ASSETS.md` | 4 | `tools/assets/polyhaven.py`, `tools/assets/fetch_makehuman.sh` |
| Ethan: MPFB body, skin/eyes/hair shells, field kit, 75 face shapes (`blender/characters/ethan.py`, `ethan_kit.py`) | 5 | reviewed in Cycles and WebGPU against reference B; gaps below |
| Engine character materials (`src/rendering/charmat.ts`, `skin.ts`, `hairshell.ts`) | 5 | dual-lobe skin + wrapped scatter, hair shells, eyes, cornea, fabrics, armour with baked masks |
| Animation: CMU mocap retarget + authored combat clips on the game rig (`blender/animations/`) | 4 | 43 clips with hit windows, i-frames, lunges in `humanoid_clips.json`; contact sheets reviewed; not yet polished in motion |
| Gameplay core (fixed 60 Hz loop, Rapier controller, camera, combat, parry, dodge, temporal slow/rewind/echo, AI) | 4 | ported from v0; scripted tests in `tests/scripts/` (parry/block/dodge/slow/rewind/echo) pass |
| Baked environment pipeline (`blender/environments/envkit.py`, `src/world/level.ts`) | 5 | Cycles lightmaps (HDR, UV1) + specular-only real-time lights on static surfaces; engine matches the Cycles render from the same camera |
| Character lighting: baked SH light probes (`envkit.bake_probes`, `src/world/probes.ts`) | 5 | Cycles cube-face renders projected to order-2 SH per probe (382 in Ch1); every character blends its own probe; fixed characters rendering black in every room |
| Facility kit v2 (pilasters, wainscot + set-back panels, LED trim, ceiling grid, floor bands, hazard paint, glass) | 4 | Cycles render of the checkpoint reviewed; full chapter rebake in progress; engine review pending |
| Chapter runtime (`src/chapters/runtime.ts`): sections streamed (current +-1), light pool, doors, triggers, interactables, fights, bosses, `?at=` beat jumps | 4 | Chapter 1 played checkpoint -> lift by script (fights spawn and resolve, doors open, cycling door cycles) |
| Cinematic director (`src/cinematics/director.ts`): letterbox, input lock, camera rails, focus pulls, fades, title cards | 3 | used for the opening, Engine reveal, Sentinel wake, wreck pass, lift and surface finale; not yet reviewed frame by frame |
| HELIX enemies: trooper, operative, heavy (`blender/characters/helix.py`) | 4 | ~0.9 MB packed each; fight in s3/s4/s5; animation/AI tuning not reviewed in motion |
| Sentinel A-07 (`blender/characters/sentinel.py`, `src/bosses/sentinel.ts`) | 5 | rebuilt as polygonal hard surface (`blender/common/hardpoly.py`), 65k tris, baked AO + edge masks, scanned breakup, hazard bands; two phases, telegraphed attacks, armour shed; fight not yet played through by hand |
| The Echo (`src/characters/echo.ts`) | 3 | Ethan's own model with an amber chronal signature; appears in the Chapter 1 finale |
| Chapter 1 surface finale (s8 deck, s9 skyline: `citykit.py`, `facades.py`) | 2 | built; bake + engine review pending |
| Chapters 2-5, Imani/Voss/Nyx, Rift Marshal/Echo/Nyx/Voss bosses, both endings | 1 | planned |
| Audio, menus, settings, saves | 1 | `Sfx` logs only |

### v1 known quality gaps (must be fixed; do not forget)
- **Skin** is still smoother and flatter than reference B: needs stronger micro detail at mid distance, specular breakup, and a real
  subsurface diffusion (screen-space or pre-integrated) instead of translucency only.
- **Expressions**: the 75 face shapes exist but no expression set / facial animation has been authored or reviewed.
- Animation exists but has not been polished in motion (foot sliding, transitions, hit reactions need review in the game).
- **Chapter 1 not complete:** the boss fight, the cycling-door slow-time pass and every cinematic still need a hand-played, frame-by-frame
  review; the surface sections need their bake and engine review; no audio.
- GLB is 8.5 MB (fabric scans load separately as 1k JPEG). **~390k triangles** at the hero level (20 hair shells = ~40k): needs LODs for
  gameplay distance and KTX2 textures.
- **Cloth has no folds** (shells follow the body): trousers and shirt need fold/wrinkle detail at the joints.
- Characters still to build: Imani Reyes, Director Voss, Commander Nyx, the Rift Marshal; the Echo needs his own wear and motion.

### v1 bugs found by testing and fixed
1. MPFB fitted the game rig ~0.8 m below the body unless the human is created with detailed helpers.
2. MPFB purges unused materials when adding an asset: shoes are added before any custom material is made.
3. gltfpack moved the UV scale into texture transforms, which raw `uv()` node materials ignore (pores became blisters): float UVs.
4. gltfpack drops custom vertex attributes: engine data now travels in COLOR_0 (exporter: by colour-attribute name only).
5. The eye's corneal cap (alpha 0 in MakeHuman's texture) covered the iris: alpha-cut in the engine.
6. A transparent "white" cornea read as cataracts: the cornea now adds only its reflection.
7. Every proxy shape key exported with default weight 1 (all 53 brow shapes applied at once): keys start at 0, influences reset on load.
8. MPFB custom weight files tied brows/lashes/eyes/teeth to `Root`: all weighted to the head (face motion comes from shape keys).
9. Hair shells with 3D Worley noise lost the WebGPU device: replaced by a 2x2x2 hashed cellular search.
10. The lab rendered before separately loaded textures arrived once the GLB got small (roughness read 0: chrome): `texturesReady()`.
11. Embedded fabric scans made the GLB 81 MB although the engine loads them itself: stripped at export (8.5 MB).
12. The lab's light rig was mirrored relative to the Cycles review: rebuilt as an exact conversion (area lights + shadowed key).
13. Characters rendered as black silhouettes in every room: the real-time PMREM probe captured ~10x too little light. Replaced by
    Cycles-baked SH light probes (the same light as the lightmaps).
14. Lightmaps baked into the wrong UV set (Cycles bakes into the ACTIVE map) and as one island per face: LM made active for the bake,
    smart-project + pack islands.
15. Level extras sat on the parent group of multi-material meshes, so lightmaps never applied: parent userData is read too.
16. SDF-meshed hard surface crumpled after decimation (light and edge wear caught every crumple): hard surface is now polygonal
    (`hardpoly.py`); per-vertex wear masks on low-poly faces were 1 everywhere: masks are baked textures on a UV atlas.
17. The Sentinel's phase-2 core colour change called TSL through the wrong namespace and never happened.
18. Wall signs were hidden behind the new pilasters: moved in front.

---

## v0 prototype (archived in `archive/v0-prototype/`; kept for its systems and lessons)

**Overall:** early production. The engine core, the first character, a combat arena, combat, and three of the five temporal abilities run and are
verified in the real game. **No chapter exists yet. Chapters 1-5, the bosses, cutscenes, audio, menus, saves and the real environments are not built.
Nothing here is "complete".**

### Systems

| Area | Status | Evidence / gaps |
|---|---|---|
| Toolchain audit (three 0.187, Rapier 0.21, Vite 8, TS 7, Blender 5.3) | 6 | versions verified; effect-node exports verified against the installed package |
| WebGPU renderer + WebGL2 fallback | 4 | the game boots and plays on both backends headlessly (WebGPU = SwiftShader under Xvfb); production bundle smoke-tested on WebGPU/high. **No real-GPU run.** |
| Post pipeline (GTAO, bloom, DOF, chromatic, SMAA/FXAA, film, gameplay-driven grade/ripple) | 4 | renders in the game; SSGI/SSR/TAA/motion blur written/unverified; grade not tuned |
| Procedural TSL PBR materials | 3 | render in the arena; look mediocre (reads as tiled panels); need real kit + baked maps |
| Quality presets | 2 | defined and applied at boot; no settings UI |
| Fixed-step loop (60 Hz, hit-stop, per-group time scale) | 4 | drives the game; time scales verified (slow = 0.26) |
| Physics (Rapier kinematic controller, sensors, raycast) | 4 | grounding, collision, camera ray work in the arena. Bug found+fixed: controller ignored collision groups |
| Input (KB/M, gamepad, touch hooks, buffering, replayable control frames) | 2 | KB/M path not run in a real browser; tests use scripted controls |
| Third-person camera (follow, collision, lock-on framing, shake, cinematic override) | 3 | runs; collision/lock-on not reviewed in tight spaces; no cinematic use yet |
| Player controller (accel, jump, coyote, run/sprint) | 4 | run 4.6 m/s, sprint 6.6 m/s verified; no foot IK, speed matched by playback rate only |
| Combat: combo chain, buffering, cancel windows, aim-assist lunge | 4 | light1>2>3 chain, authored damage (8/10.4/12.8) applied; hit windows from clip events. Bug found+fixed: hit tests depended on render timing. Heavy/launcher/kick not exercised |
| Defence: block, perfect parry window (0.2 s), guard, dodge i-frames, stagger | 4 | parry/block/dodge outcomes verified by script (`tests/scripts/defence.json`). Guard-break path untested |
| Temporal Counter (parry -> world slows, counter strike) | 3 | opening + stagger verified; the counter strike itself not exercised |
| Time Slow | 4 | world 0.26, energy 25 + 4.5/s, toggle verified. Enemy anim slow + audio filter not reviewed |
| Time Rewind | 4 | restored Ethan 4 s back, health preserved, energy spent. Enemy revive + registered objects written but not exercised |
| Temporal Echo | 4 | records last 4 s of control frames, spawns a ghost that replays and **damages the enemy**; bug found+fixed. Mechanism triggering not built |
| Timeline Shift | 2 | state toggle + handlers + post ripple only; no level geometry/collision swap yet |
| Enemy AI (perception, patrol/investigate/chase/circle/attack, tokens, block, evade) | 3 | one trooper type fights; 3 archetype defs exist but share Ethan's model; no navmesh/pathing; group behaviour untested |
| Blender: parametric humanoid (SDF), shared 70-bone rig, side-aware weights | 4 | superseded in v1 by the MPFB pipeline |
| Animation library (41 clips) | 4 | on the v0 70-bone rig; not reviewed in motion |
| HUD, VFX | 3 | minimal; not the premium UI the directive requires |
| Audio | Planned | `Sfx` only logs calls (silent) |

### v0 bugs found by testing and fixed
1. TSL `1 - node` JS arithmetic produced NaN in WGSL (device lost / black screen).
2. Presenting a WebGPU canvas in headless Chromium destroyed the device: use headful Chromium under Xvfb without `--use-angle=swiftshader`.
3. Hit detection read bones from the render scene graph (stale between frames): now refreshed at the end of every simulation tick.
4. Rapier character controller ignored collision groups: echo stuck inside the player. Now passes the character's groups.
5. Production build shipped without the game (dynamic import with a computed path): entry is static now.

## Environment notes
Blender 5.3 at /opt/blender (installed by the environment setup script). WebGPU test path: Xvfb + headful Chromium. See `CLAUDE.md`.
Headless rendering is software-only: **no frame-rate or GPU-memory measurements exist.**
