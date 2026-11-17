# Project Progress (honest status)

Ladder: 1 Planned · 2 Implemented · 3 Integrated · 4 Tested · 5 Visually reviewed · 6 Polished · 7 Complete.
Update at the start and end of every session. Never mark above what the evidence shows.

## v1 restart (current)

The owner asked for a restart from scratch against `GRAPHICS_DIRECTIVE_PROMPT.md` and its two reference images (A: UE5 forest, the bar
for shaders/lighting; B: MetaHuman-class character, the bar for models). The v0 prototype is archived intact in `archive/v0-prototype/`
(its systems and lessons are listed further down and will be ported, not rewritten blind).

**Overall:** the whole campaign now exists end to end in code: five chapters scripted beat by beat (Chapter 1 facility + surface,
Chapter 2 district, Chapter 3 arcology, Chapter 4 paradox, Chapter 5 Nexus) with all five bosses (Sentinel A-07, the Rift Marshal, the
Echo, Commander Nyx, Director Voss), the ending choice, both endings and credits; chapters hand over to the next. **Latest (renderer rewrite, see `docs/RENDERER.md`):** the owner asked for the old shader system to be removed and a new
engine built from scratch. It is done in the sense that matters for the codebase: `src/rendering/` no longer exists and every
shader is in `src/graphics/` (core with capability detection, 5 presets + independent settings, a fail-soft frame graph,
GPU-histogram eye adaptation, our own AgX with looks, scene-linear grading with tinted black points, debug views and a
performance overlay; the material library; light-volume fog and skies; shadows of moving things on the baked world with
contact-hardening soft edges, plus screen-space contact shadows; sparks, rings and rain; our own ocean and window shaders).
Compared side by side with the old renderer at five places and reviewed in the lab, the storm exit, the arcology, the
Nexus and the Chapter 4 sea. Not done or not verified: GPU-compute particles (tried, reverted to CPU integration), capsule
shadows, VXGI, TAAU, Chapter 2 and the new windows (Chapter 2 loses the software WebGPU device in this container with either
renderer), real GPUs and phones (only SwiftShader here), and a device-loss risk with the shadow pass under SwiftShader.
**Before that:** the
storm re-bakes have landed (Chapter 1's surface, Chapter 2, Chapter 4's terrace with its modelled skyline). Reviewing the ruined
terrace found that every lightmap had been stored through the sRGB curve (bug 49): all maps are linear now and exposure follows
the baked light where Ethan stands, so every place's contrast, shadows and bounce changed; the places listed under "Linear
lightmaps" were reviewed after it, the rest of the campaign not yet. **Previous pass:** every chapter's full bake has run (Chapter 4's for the first time). Testing them in the engine
found that no exterior sky had ever drawn and that every two-reality section lit its shared structure in reality b with the wrong
lightmap (bugs 37-39); both are fixed in code, the shared maps re-bake section by section, and the storm places (Chapter 1's
surface, Chapter 2, Chapter 4's ruin) re-bake under a sky that matches the one now drawn. Chapters 3 and 5 have been played
through by script; Chapter 4's play-through is running. **Earlier state:**
Chapters 1 and 2 have been played by script; Chapters 3-5 are written and their levels build, but their final bakes are still in the
queue and none of their fights has been played through yet, so nothing past Chapter 2 is above level 3. The reference pass (fog,
rain, wet streets, SSR, water, dusk city, skin, POM, grading) is in; it has been reviewed in the facility and the surface only.

| Area | Status | Evidence / gaps |
|---|---|---|
| Renderer rewrite (`src/graphics/`, `docs/RENDERER.md`) | 5 | old system fully removed; core, frame graph, exposure, grading, materials, fog, sky, dynamic + contact shadows, particles, rain, ocean, windows; visually reviewed at the places listed above (not Chapter 2); see RENDERER.md for open items |
| Asset acquisition (Poly Haven, ambientCG, MPFB 2 + MakeHuman CC0 packs, CMU mocap), licence ledger `docs/ASSETS.md` | 4 | `tools/assets/polyhaven.py`, `tools/assets/fetch_makehuman.sh` |
| Ethan: MPFB body, skin/eyes/hair shells, field kit, 75 face shapes (`blender/characters/ethan.py`, `ethan_kit.py`) | 5 | reviewed in Cycles and WebGPU against reference B; gaps below |
| Engine character materials (`src/graphics/materials/characters.ts`, `skin.ts`, `hairShells.ts`) | 5 | dual-lobe skin + wrapped scatter, hair shells, eyes, cornea, fabrics, armour with baked masks |
| Animation: CMU mocap retarget + authored combat clips on the game rig (`blender/animations/`) | 4 | 43 clips with hit windows, i-frames, lunges in `humanoid_clips.json`. Facing, shoulders and the cast's rest offsets fixed this pass (bugs 58-61): every clip measured facing forward, the guard and strikes reviewed from the front in the lab, a strike with real input lands on an enemy ahead; the rest of the set not yet reviewed clip by clip in motion |
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
| Chapter 2 (`ch2_level.py`, `ch2.ts`) | 4 | 7 sections (rooftops, street, cafe, gate, plaza, underpass, helipad), 7 scripted beats with 59 voiced lines, laser-sweep rewind puzzle, plaza waves, pursuit, boss, recovered-footage ending. **Full bake done** (first time all seven): the street reviewed in the engine at night in the rain against the neon/rain references (lantern string, blade signs, interior-mapped towers, the HELIX van, parked vans, cordon, overgrowth, wet reflections). A full scripted play-through on this bake is still to do |
| Audio (`src/audio/`) | 4 | synthesised sound design (27 recipes, measured offline + mix table), ambience beds, adaptive score, HRTF positioning, per-space reverb; voices for every Chapter 1 line (Kokoro) with per-speaker treatment. Not heard by a person yet: needs a listening pass on real speakers |
| Front end (`src/ui/menu.ts`) | 4 | title (Continue/New Game/Chapters/Settings/Credits), loading card, pause menu, persistent settings (quality, volumes, sensitivity, invert Y, subtitles, shake), checkpoint saves; keyboard/mouse/gamepad navigation; reviewed by screenshot |
| HUD v2 | 3 | speaker-coloured subtitles, objective reveal with key glyphs, styled prompts, boss bar with title, damage trail and phase marker |
| Afterimages (`src/temporal/afterimages.ts`) | 3 | pooled ghost copies of Ethan's pose on dodge / rewind / slow; not yet reviewed in motion |
| Chapter 1 surface finale (s8 deck, s9 skyline: `citykit.py`, `facades.py`) | 2 | built; bake + engine review pending |
| Chapter 3 (`ch3_level.py`, `ch3.ts`): lobby, offices, Palimpsest lab (Temporal Echo, plate gate), mirror hall, Palimpsest Core | 4 | per-reality lights/lightmaps/probes/volumes; EchoBoss (`bosses/echo.ts`); 33 voiced lines; the ruin (timeline b) overgrown under its broken ceilings. **Played through by script to `chapter3_complete`** (timeline shift, echo ability, plate gate, mirror hall, ambush, the Echo through both phases) on the quick bake; full bake queued |
| Chapter 4 (`ch4_level.py`, `ch4.ts`): future terrace (two skies), 2079 memory lab, foundry, crucible | 4 | NyxBoss (`bosses/nyx.ts`) 3 phases; Imani's part revealed; 40 voiced lines; first full export this pass; **played through by script to `chapter4_complete`** (terrace fight and gate, the three memories, foundry fight, casting channel by shift, the console and door, Nyx's three phases with the arena flipping, the Echo's return). The terrace's skyline is now modelled (citykit `future` and `ruin` towers rising from the sea, interior-mapped panes, their own lightmaps) and the deck dressed (benches, lamp posts, paving bands, wayfinding totem, the ring sculpture; their remains in the ruin): reviewed in Cycles in both realities; the in-engine bake is queued. The sea reviewed from the terrace (swell, foam around the towers, storm swell in the ruin). Crucible walkway reached a metre short of the platform (fixed, re-baked); a fall respawned Ethan in the foundry (fixed) |
| Chapter 5 (`ch5_level.py`, `ch5.ts`): Nexus fragments, skybridge with the Echo as ally, the Engine's heart; choice; Endings A and B; credits | 4 | generated Nexus sky (the Engine is its sun); VossBoss (`bosses/voss.ts`) 3 phases + pylons + flips; `characters/companion.ts`; `ui/finale.ts`; **full bake done** (forest island: 12 firs, waist-high ferns, roots, boulders, fallen trunk; the Engine's light rays past the floating island); play-through by script running |
| Imani, Nyx, Voss models | 4 / 4 / 4 | all three exported and reviewed in the engine lab: Voss with his salt-and-pepper beard, silver hair, grey brows and blue eyes; Nyx's grey and Imani's brown eyes read true. Chapter 4 and 5 play-throughs wait for their bakes (their level meshes were never committed: the full bakes now running export them) |
| **Reference pass (10 owner photos: rain-wet streets, neon, misty god rays, caves, sea, UE5 skin)** | | |
| Volumetric fog lit by baked light volumes (`envkit.bake_volume`, `src/graphics/atmosphere/fog.ts`) | 4 | per section a 3D grid of the light filling the air (every fixture, shadowed by ray casts against the section; outdoors the occluded sky + sun visibility), 6-280 KB each; post pass marches every pixel's ray through height fog with drifting fbm, HG sun phase, energy-conserving integration, TRAA-resolved jitter; 40/28/16 steps by preset, classic fog on Performance. Ch1 interiors + c2 baked; engine look review in progress |
| Rain + wet world (`src/graphics/shaders/surfaceLayers.ts`, `src/rendering/rain.ts`) | 3 | outdoor statics: porous darkening, clear-coat water film, puddles in noise basins with raindrop rings, rivulets on walls; GPU rain streaks lit by the light volume (flare under lamps/neon), splash crowns, a ray-cast shelter map keeps rain from under roofs; rain runs on world time (hangs in the air during time slow); characters soak (skin film + beads, darker cloth) and dry slowly indoors. Not yet seen in a baked dusk street |
| Screen-space reflections (`postfx.ts`) | 3 | MRT reflectivity (water film, polished metal, smooth floors) + roughness; three's SSR, blurred by roughness; High + Ultra |
| Water medium (`src/graphics/materials/water.ts`, `envkit.water_mat`) | 3 | transmissive IOR 1.33 with per-pixel depth absorption (scene depth behind the surface), layered swells + noise ripples + rain rings, shoreline foam, `flow` 0 freezes it (the plaza fountain) |
| The storm at nightfall (Ch1 surface, Ch2) | 3 | sky at 0.24 in bakes/volumes/background, eye adaptation per place; lit windows (skyline emission maps on a 48 m tile; real panes on near towers), working street lights with luminaires and lights, shopfronts with lit interiors, neon names and spill light, a dead hotel sign on the abandoned side, lit checkpoint booths; lightning lights the sky and the air. Rebake running |
| Skin v2 (`charmat.ts` skin) | 3 | pores in the base normal (distance-faded) + a finer micro layer (whiteout blend), specular occlusion in pores, rain soak; stubble/beard shells not done |
| Eyes v2 (`charmat.ts` eye, cornea) | 4 | the iris had its own gloss and its low-poly dish mirrored the studio/sky in big pale facets (every cast member's eyes read grey): iris specular off (the cornea carries the reflection), cornea sharper and weaker, sclera warmer and darker; cornea normals welded. Reviewed in the lab close-up (Imani, Ethan) |
| Foliage (`blender/props/foliage.py`, `src/world/foliage.ts`) | 4 | Poly Haven CC0 plants/trees for real time: conifer twigs to cards textured by a Cycles-rendered atlas of the tree's own clusters (tinted dark blue-green), plants decimated with their Alpha maps merged in (colour bled under the cut-outs); instanced per section with light-volume lighting, wind, a broken wet film; twig cards keep their coverage at distance (mip-scaled, sharpened alpha + alpha-to-coverage). Reviewed in the engine on the Chapter 5 island (quick bake) and the Chapter 2 overgrowth |
| Interior-mapped windows (`src/graphics/materials/windows.ts`, our own since the renderer rewrite; the vendored kit is gone) | 2 | a pane in every bay of the city's towers: blinds, curtains, rooms with parallax, a share lit; the panes skip the lightmap (the kit lights its own dressing: the lightmap made every blind glow white), far facades fade to the mean. Reviewed on the Chapter 2 street at night |
| HELIX van (`blender/environments/vehicles.py`) | 4 | hard-surface panel van replacing the box van: profile shell with rounded silhouette, arches with lips, five-spoke wheels, glazing, seams, livery, lamps, roof light bar (red/blue lights baked), crumpled nose; reviewed in Cycles and the engine |
| Chapter 2 street dressing (`streetkit.py`, Poly Haven hidden-alley set) | 3 | cast-iron bollards with chains, paper lanterns, cables, bins, hydrant, cameras, covered car, tyres, barrel stove, graffiti shutters, rusted aircon, manholes, scanned barriers; Cycles preview reviewed; in the full Chapter 2 bake now running |
| Open sea (`src/world/sea.ts`, vendored MIT ocean kit) | 4 | Gerstner sheet + top-level mirror pass + seabed stamps around the sea stacks at the Chapter 4 terrace; reviewed in the engine from the terrace edge in both realities (Coastal breeze / Storm swell), foam wrapping the towers |
| Skies (`src/graphics/atmosphere/sky.ts`) | 3 | our own background node: HDRIs sampled directly in Blender's orientation (the sun sits where the baked shadows say), horizon melting into the haze; the storm at nightfall procedural (domain-warped fbm cloud deck, darker rifts, undersides lit by the city's sodium glow, rain haze at the horizon matched to the fog). Reviewed on the Chapter 2 street (level and looking up), the Chapter 4 terrace in both realities, the Nexus. Before this pass no sky had ever rendered (bug 37) |
| Character light rig (`world/probes.ts` CharacterLight) | 3 | per character, on top of its baked probe: a camera-side fill up to a readable minimum and a rim in the colour of the air, both only where the place is dark; reviewed on the night street (Ethan reads from behind and the front) and the corridor (no visible change) |
| Mobile: touch controls + phone layout (`src/ui/touch.ts`, `touch.css`, `device.ts`) | 4 | floating stick (sprint past its ring), drag-to-look, action cluster (strike, heavy, guard/parry, dodge, jump, lock), the HUD's four abilities and the interact prompt as buttons, pause; safe-area insets, rotate hint in portrait, fullscreen + landscape lock where the browser allows; phones start on Performance (tablets Balanced: the saved default had been "high" everywhere), render 540 lines (was 565x261 on a phone), lightmaps at half size (memory). `tools/touch_check.cjs` (emulated phone, multi-touch through the DevTools protocol): walk, sprint, look with two thumbs, strike, dodge, slow, prompt, portrait, title menu all pass. Leaving the tab (another app, a locked phone) pauses and silences the game; a lost GPU device / WebGL context (phones reclaim backgrounded tabs) shows a notice and reloads at the last checkpoint (checked by forcing a WebGL context loss). Not yet run on a real phone: frame rate and memory there are unmeasured |
| Chapter flow tests on the final assets (`tests/scripts/flows/`) | 4 | after the linear-lightmap pass, on a static build: Chapter 3 -> `chapter3_complete`, Chapter 4 -> `chapter4_complete` (Nyx defeated), Chapter 5 -> `chapter5_complete` (ending B), from the Voss beat ending A and ending B. Chapters 1-2 by their own scripts earlier |
| Linear lightmaps + eye adaptation (`envkit.bake_lightmap`, `ChapterRuntime.adapt`) | 4 | lightmaps stored linear (bug 49); exposure = (0.3 / L)^0.4 from the probe field's mean radiance at Ethan, clamped 0.5-6, eased at 1.2/s: a dark place still reads darker than a bright one. Reviewed: Ch1 corridor, lab, engine chamber (its dusty air thinned for the higher exposure), surface; Ch2 street, plaza; Ch3 lobby (both realities), offices (both), Palimpsest lab, mirror hall; Ch4 terrace (both), memory lab, foundry, crucible; Ch5 Nexus. Not yet judged on a real GPU in motion |
| Level packing (`tools/assets/pack_levels.sh`) | 4 | meshopt compression of every level section (the loader decodes it): 165 MB -> 31 MB; nodes, extras, materials, lightmap and window UVs kept; the Chapter 3 offices rendered identical packed and raw in both realities, the Chapter 2 street and the Nexus smoke-tested |
| Office kit (`blender/environments/officekit.py`) | 3 | workstation pods (scanned desks, task chairs and flat screens built in Blender, clutter, plants), wall storage, ruined variants; whole-prop triangle budgets. Placed in the Chapter 3 offices and Palimpsest lab, the Chapter 4 memory lab (re-baking) |
| Voss's beard and hair (`voss.py`) | 3 | a boxed beard in the jaw/chin/moustache zone with a lip guard, salt-and-pepper colour, a short swept-back comb; Cycles review shows the groom; colour pass and engine review pending |


### v1 known quality gaps (must be fixed; do not forget)
- **WebGPU on the Chapter 2 street (unverified on real hardware):** in the headless software WebGPU here the street loses the device
  (white frame) at every quality, with or without the storm sky, the window panes and the rain; the morning build before this pass
  does the same, so it is not a regression. Interiors (Chapter 1), the Nexus and the lab render on WebGPU identically to WebGL2.
  Needs a run on a real GPU; if it reproduces there, bisect with the test switches (`?nostorm`, `?nowin`, `?norain`).
- **Places with no light of their own** (seen once the lightmaps went linear): the Chapter 1 lift house (lamps, re-baked), Chapter 3's
  whole ruin (ceiling breaches over the lobby, offices, Palimpsest lab, mirror hall and core, dusty air: shafts reviewed in the
  lobby and the mirror hall) and Chapter 2's rooftops, café and underpass (lamps, re-baking) are done or in hand. The rest of the
  campaign was swept once after bug 49 (about thirty places); not every room has been seen.
- Street prop variants without textures: fixed (the street re-exported with the fallbacks; its lens maps no longer embedded).
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
32. Voss's long coat was a 3.5 mm shell meshed at a 1.8 mm grid: it exported shattered (torn triangles on the back, shards in front).
    Now 7 mm of heavy wool with a larger triangle budget; the placket and pin moved out to sit on it.
33. Chapters 4 and 5 failed at export on statics with no UV map at all (a reality holding only curves/text): one is created.
34. The skybridge's overhead ribs hung at 3.3 m, the third-person camera's height, with no camera collision: walking the bridge
    the camera passed through rib after rib (black frames), and a respawn at the heart's checkpoint parked it behind the last one.
    Ribs raised to 5.3 m on taller fins; the bridge rebaked.
35. The Nexus heart whited out toward the Engine (bounce-lit volume + forward scattering at 2x exterior density): thinned.
36. Chapter 5 played by script from the first fragment to both endings (`tests/scripts/flows/ch5_*.json`): island puzzles (shift,
    slow, echo gate), the fight, the bridge with the Echo as ally, Voss through three phases, the Engine, Ending A and Ending B.
37. **No exterior sky had ever rendered** (every chapter, both backends): the HDRI was assigned as `scene.background` while still
    loading; three converts an equirect background to a cube map the first frame it sees it and keeps that cube, here the 1x1
    placeholder. Earlier reviews of the street and the surface judged a black sky. Skies are now our own background node
    (`graphics/atmosphere/sky.ts`), preloaded with their section.
38. The storm's HDRI (Poly Haven "approaching storm") is a sunny meadow under cumulus with trees on the skyline: once skies drew,
    the night street had a dim daytime sky over it. The storm is now procedural (cloud deck lit by the city's glow), and the
    bakes use an HDR made from the same sky (`envkit.storm_hdri`): the old one lit open ground about nine times as strongly as
    the sky drawn above it (the ruined terrace glared white under a dark sky). Chapter 1's surface, Chapter 2 and Chapter 4's
    ruin rebake with it.
39. Two-reality sections: the shared structure's reality-b lightmap was written to `<key>_b_lm.hdr`, the same file as the b
    dressing's map, which baked after it and overwrote it; in reality b every shared wall and floor sampled another mesh's
    lightmap (Chapter 3 a1-a5, Chapter 4 p1/p3/p4, Chapter 5 n1/n3). Now `<key>_shared_b_lm.hdr`; rebaking with
    `FT_REUSE_LM=1` (the LM unwrap is deterministic, checked vertex for vertex), so only the missing maps bake.
40. Down every street a lit dome stood on the sky: rays left the light volume through its far wall below a line and through its
    lid above it, and the air outside (the fog colour) was darker than the baked air at the lid. Outside air now matches the
    lid's light; the lid blends over 8 m.
41. A sun in the sky (the day HDRI ~450, the Nexus Engine ~900) flooded every bloom mip: a white veil over the whole frame (the
    Nexus read as a whiteout). Bloom input is capped per pixel.
42. Ethan's near-black suit and dark skin went to a silhouette in dark places (the night street's probe is ~1/5 of the
    facility's): a character fill/rim rig, only where the place is dark.
43. Chapter 4 had never been exported (its level meshes were never committed); first export and first play-through this pass.
44. The crucible's walk from the foundry door stopped a metre short of the platform: walking in dropped Ethan into the pit; and a
    fall respawned him 12 m the wrong way, in the foundry behind the door.
45. Once skies drew, two places showed where the world stopped: the Chapter 2 rooftop alley opened onto nothing at its north end
    (closed with a brick block), and the Chapter 4 skyline's textured boxes read as boxes (modelled towers now).
46. Rooms had no ceiling collider: rain fell inside the surface lift house (the shelter map rays went through the roof), and the
    camera could rise through ceilings.
47. Moving the probe baker's scratch render out of the asset folders put every bake on one file: bakes run side by side read
    each other's cube faces (Chapter 2's storm bake and the offices' failed on an empty face; others could have read a wrong
    one). The scratch file is per process now; the affected probe sets re-bake.
48. Every scanned prop in every level had its texture scrambled: `finish_static` re-unwrapped UV0 of the whole joined mesh with
    a metric projection (right for tiling materials), props included; a desk's drawers and handles read as a grey patchwork.
    Faces with 'own' recipes keep their authored UVs now. The lightmap unwrap does not depend on UV0, so the affected sections
    re-export with every lightmap reused (offices, the forest island; the street, Palimpsest lab and Chapter 4 follow).
49. **Every lightmap in the game was stored through the sRGB curve.** `bake_lightmap` saved a float image tagged Linear Rec.709,
    and Blender writes such an image to Radiance HDR through the (extended) sRGB transfer function: measured 0.0245 -> 0.170,
    0.25 -> 0.535, 1.5 -> 1.19. Every shadow, bounce and dim corner was lifted several times over while the probes and light
    volumes (written by numpy) stayed linear: rooms looked flat and washed, characters darker than the walls around them, and the
    ruined terrace's deck shone white under a black storm (0.153 where the storm gives 0.021). Found by baking a test patch in
    the same scene and comparing with the shipped map. Maps now save as Non-Color data; the 61 shipped maps were decoded in place
    by the exact inverse (`tools/assets/linearise_lightmaps.py`, no re-bake; a converted map is logged in `.cache/linearised.txt`).
50. The fixed exposure per place (1 inside, the sky marker's value outside) had been tuned against those lifted maps; with linear
    maps the dim interiors went black and the ruins unreadable. Replaced by eye adaptation from the baked probes (below).
51. One reflection probe per section, captured in whichever reality was entered first and before an image sky had loaded: the
    ruined terrace's wet deck mirrored 2101's daylight (a pale floor under a night sky). Probes are per reality now and recapture
    when the sky arrives.
52. Plain recipes kept the glTF importer's image nodes and the exporter embedded them: a security camera's lens carried 7 MB of
    2K maps into the street (`strip_textures` covers plain materials now; the street is 3.6 MB packed).
53. The Palimpsest lab was exported before the map fallbacks: the circuit board's second material and the chemistry set's glass
    asked for maps that did not exist (re-exported with its lightmaps kept).
54. Every sliding door's leaves were exported with no UV set (dynamic objects skip `finish_static`): their tiled painted-metal
    material sampled one texel, so every door in the game was a flat slab of paint. The loader now box-projects metric UVs onto
    any mesh that arrives without them, and `sliding_door` unwraps its leaves for future exports.
55. 2101's stone was rust: the "grey_cartago_01" scan is slate veined rust-orange and `desat` is the saturation kept (Blender
    and the engine agree), so at 0.7 the reception desk, planters, plinths and pool basin of the clean future read as rusted
    metal. Saturation 0.12; Chapters 3-5 re-exported with every lightmap kept (UVs checked identical).
56. The Nexus whited out near the Engine (the skybridge, Voss's arena): its sky holds the Engine as a bright blob the bake took
    for a sun, and the fog scattered that sun forward over every view toward it, on top of the Engine's own light already in the
    level. Isolated by rendering without fog and without the fog's sun (both cleared it); the fog's sun is off in the Nexus (as
    under the storm), and the void beyond the volume keeps the marker's dark blue instead of the volume's lid light.
57. Places with no light of their own, found in a sweep after bug 49: Chapter 2's opening rooftops (black decks, Ethan invisible),
    Imani's café (black around two small lanterns; its camera started crushed behind Ethan's head at the door) and the underpass
    pursuit (no light at all under the highway). Lamps in each (a hut lamp, a beacon and a gap lamp on the roofs; festoon bulbs and
    a desk lamp in the café; sodium fixtures under the deck and a lamp at the stairwell); re-baking.
58. Every human shrugged: the retarget copied each source bone's absolute direction, right for limbs (T-pose source, A-pose rig)
    but not for the clavicles, whose rest slope is anatomy (CMU's rise ~12 degrees from the chest, the rig's fall ~9): shoulders
    hiked ~23 degrees in every clip. Clavicles now take the capture's own motion relative to the chest, damped to 0.7.
59. The idle stood ~90 degrees off its forward and the whole combat set (guard, strikes, blocks, dodges, reactions, casts) ~120:
    Ethan stood side-on whenever he stopped and struck sideways at what he faced (the flow tests kill with helpers and never
    showed it). The retarget leaves the pelvis's yaw free (aligning a vertical bone's direction fixes nothing about its turn).
    Looped clips are now turned so the body faces forward over the frames that play (by the hips; fighting stances by the head, so
    a bladed guard stays bladed), the guard (and everything authored on it) by its head, one-shots by their first frames (the roll
    started facing backwards). Measured per clip: every clip faces -Y; gameplay events and root speeds unchanged.
60. The idle's subject held his head tilted ~30 degrees: an `upright` option eases neck, head and upper chest toward rest (idle 0.7).
61. Imani, Nyx, the operatives and Voss rest differently from the rig the clips were authored on (toes ~80 degrees: another roll;
    a dozen bones 5-12): glTF clips set absolute local rotations, so their toes bent and knees shifted. The loader retargets the
    shared clips per body in world space with rest offsets (q' = O_parent^-1 q O_bone): each bone's world motion relative to its
    own rest now matches the rig's within 0.1 degree (checked on toes, thighs, arms, spine in walk, strike and idle).

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
