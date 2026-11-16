# Project Progress (honest status)

Ladder: 1 Planned · 2 Implemented · 3 Integrated · 4 Tested · 5 Visually reviewed · 6 Polished · 7 Complete.
Update at the start and end of every session. Never mark above what the evidence shows.

## v1 restart (current)

The owner asked for a restart from scratch against `GRAPHICS_DIRECTIVE_PROMPT.md` and its two reference images (A: UE5 forest, the bar
for shaders/lighting; B: MetaHuman-class character, the bar for models). The v0 prototype is archived intact in `archive/v0-prototype/`
(its systems and lessons are listed further down and will be ported, not rewritten blind).

**Overall:** the whole campaign now exists end to end in code: five chapters scripted beat by beat (Chapter 1 facility + surface,
Chapter 2 district, Chapter 3 arcology, Chapter 4 paradox, Chapter 5 Nexus) with all five bosses (Sentinel A-07, the Rift Marshal, the
Echo, Commander Nyx, Director Voss), the ending choice, both endings and credits; chapters hand over to the next. **Honest state (this pass):** Chapter 2 has never had its full bake (running now, with the new street dressing); Chapter 4 is
baking; Chapters 5, 3 and the Chapter 1 sections s6/s8 follow in the queue. **Earlier state:**
Chapters 1 and 2 have been played by script; Chapters 3-5 are written and their levels build, but their final bakes are still in the
queue and none of their fights has been played through yet, so nothing past Chapter 2 is above level 3. The reference pass (fog,
rain, wet streets, SSR, water, dusk city, skin, POM, grading) is in; it has been reviewed in the facility and the surface only.

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
| The Echo (`src/characters/echo.ts`) | 5 | Ethan's own model with an amber chronal signature (rim + amber light-lines), reviewed in the lab; appears in the Chapter 1 finale |
| Dr. Imani Reyes (`blender/characters/imani.py`, `imani_kit.py`, shared `person.py`) | 4 | built and reviewed in Cycles + WebGPU (body); jacket rebuilt as bridged cloth with finished edges (re-export pending); face close-up not verifiable on the headless software GPU (device loss with hair shells filling the screen) |
| Commander Nyx, Director Voss (`nyx.py`, `voss.py` + kits) | 3 | built; Nyx reviewed in the engine lab; Voss's builds were OOM-killed by a kit bug (fixed, below), re-export pending |
| HELIX enemies v3 (`helix_kit.py`, `ethan_kit.py` variants) | 5 | v3 (this pass): the suits were near-black (0.03-0.05 albedo) and read as flat mannequins: lifted to charcoal so the scanned weave reads; the chest plate cleared the admin pouch that broke through it; field gear added (elbow pads, a drop-leg pouch on two leg straps, a radio with a whip antenna on the left strap, a larger unit chevron). Trooper reviewed in the lab; operative/heavy/marshal re-exporting |
| HELIX enemies v2 (`helix_kit.py`) | 5 | sculpted helmet (flat sides, crest, brow) + full smoked visor and slit, chest plate with the HELIX chevron, layered pauldrons; heavy: bigger plates + backpack; operative: dark, swept plate, cyan bracers; baked masks; ~90-97k tris; reviewed in the engine lab |
| The Rift Marshal (`bosses/marshal.ts`, helix `marshal` variant) | 2 | temporal armour cracked by parries, acceleration bursts with afterimages, blink recovery, counters repeated attacks, phase 2; pursuer in the underpass; model export queued; not yet fought |
| Chapter 2 (`ch2_level.py`, `ch2.ts`) | 2 | 7 sections built in code (rooftops, street, cafe, gate, plaza, underpass, helipad), 7 scripted beats with 59 voiced lines across both chapters, laser-sweep rewind puzzle, plaza waves, pursuit, boss, recovered-footage ending; bake + play-through pending |
| Audio (`src/audio/`) | 4 | synthesised sound design (27 recipes, measured offline + mix table), ambience beds, adaptive score, HRTF positioning, per-space reverb; voices for every Chapter 1 line (Kokoro) with per-speaker treatment. Not heard by a person yet: needs a listening pass on real speakers |
| Front end (`src/ui/menu.ts`) | 4 | title (Continue/New Game/Chapters/Settings/Credits), loading card, pause menu, persistent settings (quality, volumes, sensitivity, invert Y, subtitles, shake), checkpoint saves; keyboard/mouse/gamepad navigation; reviewed by screenshot |
| HUD v2 | 3 | speaker-coloured subtitles, objective reveal with key glyphs, styled prompts, boss bar with title, damage trail and phase marker |
| Afterimages (`src/temporal/afterimages.ts`) | 3 | pooled ghost copies of Ethan's pose on dodge / rewind / slow; not yet reviewed in motion |
| Chapter 1 surface finale (s8 deck, s9 skyline: `citykit.py`, `facades.py`) | 2 | built; bake + engine review pending |
| Chapter 3 (`ch3_level.py`, `ch3.ts`): lobby, offices, Palimpsest lab (Temporal Echo, plate gate), mirror hall, Palimpsest Core | 4 | per-reality lights/lightmaps/probes/volumes; EchoBoss (`bosses/echo.ts`); 33 voiced lines; the ruin (timeline b) overgrown under its broken ceilings. **Played through by script to `chapter3_complete`** (timeline shift, echo ability, plate gate, mirror hall, ambush, the Echo through both phases) on the quick bake; full bake queued |
| Chapter 4 (`ch4_level.py`, `ch4.ts`): future terrace (two skies), 2079 memory lab, foundry, crucible | 3 | NyxBoss (`bosses/nyx.ts`) 3 phases; Imani's part revealed; 40 voiced lines; quick bake for flow tests, full bake queued; not played through |
| Chapter 5 (`ch5_level.py`, `ch5.ts`): Nexus fragments, skybridge with the Echo as ally, the Engine's heart; choice; Endings A and B; credits | 3 | generated Nexus sky (the Engine is its sun); VossBoss (`bosses/voss.ts`) 3 phases + pylons + flips; `characters/companion.ts`; `ui/finale.ts`; voices recording; full bake queued; not played through |
| Imani, Nyx, Voss models | 4 / 4 / 4 | all three exported and reviewed in the engine lab: Voss with his salt-and-pepper beard, silver hair, grey brows and blue eyes; Nyx's grey and Imani's brown eyes read true. Chapter 4 and 5 play-throughs wait for their bakes (their level meshes were never committed: the full bakes now running export them) |
| **Reference pass (10 owner photos: rain-wet streets, neon, misty god rays, caves, sea, UE5 skin)** | | |
| Volumetric fog lit by baked light volumes (`envkit.bake_volume`, `src/rendering/volumetrics.ts`) | 4 | per section a 3D grid of the light filling the air (every fixture, shadowed by ray casts against the section; outdoors the occluded sky + sun visibility), 6-280 KB each; post pass marches every pixel's ray through height fog with drifting fbm, HG sun phase, energy-conserving integration, TRAA-resolved jitter; 40/28/16 steps by preset, classic fog on Performance. Ch1 interiors + c2 baked; engine look review in progress |
| Rain + wet world (`src/rendering/wet.ts`, `rain.ts`) | 3 | outdoor statics: porous darkening, clear-coat water film, puddles in noise basins with raindrop rings, rivulets on walls; GPU rain streaks lit by the light volume (flare under lamps/neon), splash crowns, a ray-cast shelter map keeps rain from under roofs; rain runs on world time (hangs in the air during time slow); characters soak (skin film + beads, darker cloth) and dry slowly indoors. Not yet seen in a baked dusk street |
| Screen-space reflections (`postfx.ts`) | 3 | MRT reflectivity (water film, polished metal, smooth floors) + roughness; three's SSR, blurred by roughness; High + Ultra |
| Water medium (`src/rendering/water.ts`, `envkit.water_mat`) | 3 | transmissive IOR 1.33 with per-pixel depth absorption (scene depth behind the surface), layered swells + noise ripples + rain rings, shoreline foam, `flow` 0 freezes it (the plaza fountain) |
| The storm at nightfall (Ch1 surface, Ch2) | 3 | sky at 0.24 in bakes/volumes/background, eye adaptation per place; lit windows (skyline emission maps on a 48 m tile; real panes on near towers), working street lights with luminaires and lights, shopfronts with lit interiors, neon names and spill light, a dead hotel sign on the abandoned side, lit checkpoint booths; lightning lights the sky and the air. Rebake running |
| Skin v2 (`charmat.ts` skin) | 3 | pores in the base normal (distance-faded) + a finer micro layer (whiteout blend), specular occlusion in pores, rain soak; stubble/beard shells not done |
| Eyes v2 (`charmat.ts` eye, cornea) | 4 | the iris had its own gloss and its low-poly dish mirrored the studio/sky in big pale facets (every cast member's eyes read grey): iris specular off (the cornea carries the reflection), cornea sharper and weaker, sclera warmer and darker; cornea normals welded. Reviewed in the lab close-up (Imani, Ethan) |
| Foliage (`blender/props/foliage.py`, `src/world/foliage.ts`) | 4 | Poly Haven CC0 plants/trees for real time: conifer twigs to cards textured by a Cycles-rendered atlas of the tree's own clusters (tinted dark blue-green), plants decimated with their Alpha maps merged in (colour bled under the cut-outs); instanced per section with light-volume lighting, wind, a broken wet film; twig cards keep their coverage at distance (mip-scaled, sharpened alpha + alpha-to-coverage). Reviewed in the engine on the Chapter 5 island (quick bake) and the Chapter 2 overgrowth |
| Interior-mapped windows (`src/rendering/windows/`, vendored MIT kit) | 4 | a pane in every bay of the city's towers: blinds, curtains, rooms with parallax, a share lit; the panes skip the lightmap (the kit lights its own dressing: the lightmap made every blind glow white), far facades fade to the mean. Reviewed on the Chapter 2 street at night |
| HELIX van (`blender/environments/vehicles.py`) | 4 | hard-surface panel van replacing the box van: profile shell with rounded silhouette, arches with lips, five-spoke wheels, glazing, seams, livery, lamps, roof light bar (red/blue lights baked), crumpled nose; reviewed in Cycles and the engine |
| Chapter 2 street dressing (`streetkit.py`, Poly Haven hidden-alley set) | 3 | cast-iron bollards with chains, paper lanterns, cables, bins, hydrant, cameras, covered car, tyres, barrel stove, graffiti shutters, rusted aircon, manholes, scanned barriers; Cycles preview reviewed; in the full Chapter 2 bake now running |
| Open sea (`src/world/sea.ts`, vendored MIT ocean kit) | 3 | Gerstner sheet + top-level mirror pass + seabed stamps around the sea stacks at the Chapter 4 terrace; not yet seen in the engine (needs the Chapter 4 export, running) |
| Voss's beard and hair (`voss.py`) | 3 | a boxed beard in the jaw/chin/moustache zone with a lip guard, salt-and-pepper colour, a short swept-back comb; Cycles review shows the groom; colour pass and engine review pending |


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
19. The skyline section's bounding box (1.4 km) contained every underground room, so streaming could pick it and unload the room
    Ethan stood in: the smallest box containing the point now wins.
20. The engine chamber's floor had no collider (Ethan fell through at the `engine` checkpoint): collider added, re-export queued.
21. The Sentinel had no rewind snapshot: time recording during its fight threw every tick. It now snapshots (never across its phase change).
22. Section light volumes were requested without the asset prefix (404): fixed.
23. Source edits hot-reloaded the dev page in the middle of scripted tests: tests now run against a separate static build.
24. Voss's lapel pin and placket were meshed at 0.5-0.9 mm over the whole coat's bounding box (a 13.6 GB grid): every Voss build was
    OOM-killed. Fine parts now get boxes of their own. His low boots had no lacing and crashed the boot builder: laces are optional.
25. Exact booleans in `hardpoly.carve` left an empty material slot per cut (the Chapter 2 bake crashed on it): cut faces take the
    target's material; `finish` folds empty and duplicate slots.
26. Poly Haven's cut-out plants keep their opacity in a separate Alpha map that was never fetched: grass, moss and nettles drew as dark
    cards. Alpha maps are fetched and merged.
27. A material named after its own asset with Blender's `.001` suffix produced doubled texture names: the suffix is stripped first.
28. The window kit's dressing was lit by the pane's lightmap (the light on the outer glass) and every blind glowed white at night.
29. The eye shader forced every iris brown (Voss's blue and Nyx's grey eyes rendered amber); brow cards were reddish brown on
    everyone; hair cards were exported dark brown whatever the character's hair colour.
30. Light volumes held direct light only: plants and the fog sat several times darker than the bounce-lit walls (bounce added).
31. The flow tests read a cleared objective's faded text and reported Chapter 3's ambush as stuck; the game was right (helper fixed).

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
