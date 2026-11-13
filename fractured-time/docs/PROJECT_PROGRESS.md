# Project Progress (honest status)

Ladder: 1 Planned · 2 Implemented · 3 Integrated · 4 Tested · 5 Visually reviewed · 6 Polished · 7 Complete.
Update at the start and end of every session. Never mark above what the evidence shows.

## v1 restart (current)

The owner asked for a restart from scratch against `GRAPHICS_DIRECTIVE_PROMPT.md` and its two reference images (A: UE5 forest, the bar
for shaders/lighting; B: MetaHuman-class character, the bar for models). The v0 prototype is archived intact in `archive/v0-prototype/`
(its systems and lessons are listed further down and will be ported, not rewritten blind).

**Overall:** v1 is in the character/look-development stage. **One character (Ethan) is being brought to the reference-B bar; no
environment, gameplay, chapter, boss, cutscene, audio or UI exists in v1 yet. Nothing in v1 is complete.**

| Area | Status | Evidence / gaps |
|---|---|---|
| Asset acquisition (Poly Haven, ambientCG, MPFB 2 + MakeHuman CC0 packs), licence ledger `docs/ASSETS.md` | 4 | `tools/assets/polyhaven.py`, `tools/assets/fetch_makehuman.sh`; MPFB is GPL and used as an authoring tool only |
| Character build pipeline (MPFB base -> targets -> layered skin, eyes + cornea, hair, fitted garments + composite armour, game rig, face shapes) | 4 | `blender/characters/ethan.py`; review renders in Cycles (`--review`) |
| Export + pack (`tools/assets/export_character.sh`) | 4 | GLB with 75 face morphs (ARKit 52 + visemes) on the body; brows/lashes/eyes/teeth/cornea skinned to the head with their own matching face morphs (mhclo binding); baked eye/teeth occlusion and hair data in COLOR_0; material recipes in glTF extras. gltfpack: float positions + UVs |
| Engine character materials (`src/rendering/charmat.ts`) | 5 | rebuilt from the Blender recipes: dual-lobe skin (smooth base + oily clearcoat lobe with pores, cavity, SSS translucency), photoscanned fabrics, procedural armour, emissive light-lines, eye (iris rebuilt, lid AO, wet additive cornea), teeth, alpha-hashed brows/lashes |
| Hair (`src/rendering/hairshell.ts`) | 5 | 24 shells of the subdivided scalp, per-strand coils / length / tone, cylindrical strand shading with specular anti-aliasing, density falloff at the hairline + fade; sparse strand cards for flyaways. Reads as a real short coily crop in the lab; not yet seen in motion |
| Temporal AA (TRAA) | 4 | in the post pipeline on high/ultra (velocity MRT, resolve before bloom); resolves hair, lashes, specular |
| Character look-dev lab (`lab.html`) | 4 | studio HDRI + key/fill/rim; framing identical to the Cycles review set; `?view=face|face34|eyes|hair|front|full|back`, `?hide=<recipe type>`, `?meshes` |
| Ethan's field kit (`blender/characters/ethan_kit.py`, `blender/common/hardsurface.py`) | 5 | "dark practical operator kit": one-piece jersey combat shirt, SDF mock-neck collar, twill trousers, gloves; low-profile plate carrier (front/back plate bags with seams, cummerbund + MOLLE, padded straps over the trapezius), 3 magazine pouches + admin pouch, belt + buckle, knee pads, lofted combat boots (lug sole, midsole line, tongue, laces, eyelets), chronal gauntlet with light-lines. Hard-surface pieces are SDFs fitted to ray-cast body fields, metric UVs, skinned from the body. Covered skin is removed (no poke-through). Reviewed front/back/chest/neck in Cycles and WebGPU |
| Skin lighting (`src/rendering/skin.ts`) | 5 | per-channel wrapped diffuse (red bleeds furthest past the terminator) on top of the SSS lighting model; matched against Cycles random-walk SSS under the same light rig |
| Ethan vs reference B | **4** | face, eyes, brows, hair, skin and kit read as a real operator in the lab and match the Cycles review closely; still short of B in skin micro-detail and cloth folds; no expressions authored; no animation |
| Renderer look-dev vs reference A (lighting-only view, environment) | Planned | |
| Gameplay port from v0 (controller, camera, combat, temporal abilities, AI) | Planned | v0 code in the archive works and is tested; it will be ported onto the v1 assets |
| Chapters 1-5, bosses, cutscenes, audio, UI, saves, endings | Planned | |

### v1 known quality gaps (must be fixed; do not forget)
- **Skin** is still smoother and flatter than reference B: needs stronger micro detail at mid distance, specular breakup, and a real
  subsurface diffusion (screen-space or pre-integrated) instead of translucency only.
- **Expressions**: the 75 face shapes exist but no expression set / facial animation has been authored or reviewed.
- **No animation** on the v1 rig (game_engine, 53 bones). Mocap retarget is the plan.
- GLB is 8.5 MB (fabric scans load separately as 1k JPEG). **~390k triangles** at the hero level (20 hair shells = ~40k): needs LODs for
  gameplay distance and KTX2 textures.
- **Cloth has no folds** (shells follow the body): trousers and shirt need fold/wrinkle detail at the joints.
- Only one character. Every other character (Mara, Dr. Kane, troopers, bosses) still has to be built.

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
