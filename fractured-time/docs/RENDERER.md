# FRACTURED TIME renderer (`src/graphics/`)

The owner asked (2026-11-17) for the old shader system to be removed and a new rendering engine built from scratch on
`WebGPURenderer` + TSL, approaching UE5-class results where the web platform allows it. This document is the persistent
record of that work: the audit of what existed, the comparison with UE5, the architecture, the checklist, and the honest
status. It is updated in the same commit as the code it describes.

Status words follow `AAA_QUALITY_STANDARD.md`: Planned > Implemented > Integrated > Tested > Visually reviewed > Polished > Complete.

---

## 1. Phase 0 audit (the system being replaced)

Three.js **0.187.0** (latest stable at the time, released 2026-10-30), `three/webgpu` + `three/tsl`, WebGL2 fallback through
`WebGPURenderer`'s own backend. Vite 8, TypeScript 7, Rapier 0.21, three-mesh-bvh 0.9.

### Files of the old system (`src/rendering/`, 3.7 k lines) and what they did

| File | Lines | Role | Users |
|---|---|---|---|
| `gfx.ts` | 107 | renderer creation, AgX on the renderer, PCF shadows, resize (touch: lines per preset), studio PMREM | game, lab, arena |
| `quality.ts` | 56 | 4 presets (ultra/high/balanced/performance), detection | game, menu, lab, arena, main |
| `postfx.ts` | 305 | one RenderPipeline: MRT (output/normal/diffuse/velocity/refl), temporal distortion, GTAO or SSGI, SSR, volumetric fog, TRAA, capped bloom, DOF, CA, SMAA/FXAA, CDL grade + gameplay looks, film grain, fade | game, runtime, ctx, lab |
| `volumetrics.ts` | 305 | ray-marched height fog lit by the sections' baked light volumes (FTV1 3D textures), HG sun, Hillaire integration, analytic tail | postfx, runtime, foliage, rain |
| `charmat.ts` | 466 | recipe -> material for characters and levels: skin, scanned PBR (+POM), armour (procedural wear), practical/emissive, hair cards, cornea, eye, teeth, brow cards, texture cache | loader, level, probes, foliage, sentinel, lab |
| `skin.ts` | 49 | SSS material subclass with per-channel wrapped diffuse | charmat |
| `hairshell.ts` | 154 | fur-shell coily hair (stacked shells, coiled strand cells) | charmat |
| `wet.ts` | 100 | weather uniforms; water film as clearcoat, puddles, rivulets, rain rings | level, runtime, foliage, charmat |
| `water.ts` | 86 | transmissive water material (swells, depth absorption, foam) | level |
| `sky.ts` | 94 | image sky (equirect) + procedural storm deck | runtime |
| `rain.ts` | 206 | GPU rain streaks + splashes, height-map occlusion, lit by the fog volume | game |
| `vfx.ts` | 169 | CPU-stepped hit sparks and shock rings | game |
| `envmat.ts` | 208 | procedural panels for the test arena | arena |
| `aosets.ts` | 18 | generated list of scan sets with AO maps | charmat |
| `windows/` | 383+55 | vendored MIT interior-mapping kit + adapter | level |
| `ocean/` | 767+108 | vendored MIT ocean kit + planar reflection | world/sea |

Related code outside the folder: `world/level.ts` (lightmaps, `BakedSpecularLightingModel`, screen/plain/glass materials,
reflection probe capture), `world/probes.ts` (SH probe field + character fill/rim rig), `world/lightpool.ts` (nearest-fixture
light pool for characters), `chapters/runtime.ts` (sky, fog settings, probe-driven eye adaptation, lightning, weather).

### What the audit found

- **Lighting data is good and stays.** Static surfaces carry linear Cycles lightmaps (UV1), sections carry L2 SH probe grids and
  light volumes. These are scene data, not shader code, and remain the base of the GI.
- **No real-time shadows anywhere in the chapters.** Characters, enemies and doors cast nothing onto the baked world; the only
  grounding was screen-space AO. This is the largest visible gap.
- **Tone mapping lived on the renderer** (`renderer.toneMapping = AgX`, `toneMappingExposure` driven by the runtime) and the
  grade ran *before* it in the same chain. There was no histogram metering; exposure came only from the SH probe at Ethan.
- **One monolithic post chain**, rebuilt as a whole per preset; no debug views, no GPU timing, no per-effect settings, no
  dynamic resolution, no capability detection beyond "did WebGPU init".
- **Materials were per-call factories** with tuned values buried in code; no shared shader library (noise, triplanar,
  wetness etc. re-implemented per file), no material lab outside the character lab.
- **Fail-soft existed** (each effect in a try/catch) and must be kept.

### APIs verified in `node_modules/three` r187 (used by the new system)

`three/addons/tsl/display/`: `GTAONode (ao)`, `SSGINode`, `SSRNode`, `SSSNode` (screen-space contact shadows for one light),
`BloomNode`, `DepthOfFieldNode`, `MotionBlur`, `TRAANode`, `TAAUNode`, `TemporalReprojectNode`, `SharpenNode` (RCAS),
`FSR1Node`, `Lut3DNode`, `ChromaticAberrationNode`, `FilmNode`, `lensDirt`, `GodraysNode`, `DenoiseNode`, `RecurrentDenoiseNode`,
`SMAANode`, `FXAANode`, `depthAwareBlur`, `ImportanceSampledEnvironment`.
`three/addons/tsl/lighting/`: `ClusteredLightsNode` (Forward+), `LightProbeGridNode`. `three/addons/lighting/`: `LightProbeGrid`,
`CSMShadowNode`, `vxgi/` (voxel cone traced GI, WebGPU only). `three/addons/tsl/shadows/TileShadowNode`.
`RenderPipeline.outputColorTransform` applies `renderer.toneMapping` + output colour space at the end; with
`renderer.toneMapping = NoToneMapping` it applies only the sRGB encode, so tone mapping can live in our graph exactly once.
GPU timing: `new WebGPURenderer({ trackTimestamp: true })` + `renderer.resolveTimestampsAsync()` (needs `timestamp-query`).

---

## 2. UE5 feature comparison (decided before implementation)

Classification: **Practical** = can be built properly in the browser today; **Approximate** = the visual goal is reachable
with a different technique; **Experimental** = possible on WebGPU, but cost or robustness is not proven on target devices;
**Impractical** = needs hardware or API features the web does not expose.

| UE5 feature | What it does in UE5 | Web/WebGPU status | Class | FRACTURED TIME approach |
|---|---|---|---|---|
| Lumen GI | dynamic diffuse GI via SW/HW ray tracing over mesh SDFs + surface cache | no ray tracing, no SDF generation at scale | Impractical (as such) / Approximate | Cycles-baked lightmaps + L2 SH probe grid + light volumes for static light (offline path tracing = Lumen-quality bounce for static scenes); SSGI for short-range dynamic bounce; VXGI (r187) as an experimental Ultra option on WebGPU |
| Lumen reflections | traced reflections incl. off-screen | no RT | Approximate | SSR (roughness-aware) over per-section, per-reality reflection probes; planar mirror for the sea |
| Nanite | virtualised micro-polygon geometry | no mesh shaders, no 64-bit atomics raster | Impractical | meshopt-compressed merged section meshes, gltfpack LODs, frustum + distance culling, instancing for repeated props |
| Virtual Shadow Maps | 16k virtual shadow pages, cached | no sparse resources | Impractical / Approximate | static shadows are baked (infinitely cached); dynamic objects get a fitted "inset" shadow map onto baked surfaces + screen-space contact shadows + capsule soft shadows; CSM for a real-time sun where one exists |
| Distance-field shadows / AO | soft shadows and AO from mesh SDFs | no SDF generation | Approximate | analytic **capsule shadows** from the skeleton (UE's own capsule shadows idea): soft indirect shadows of characters under any light, plus GTAO |
| TSR | temporal super resolution | practical | Practical | TRAA (native res) / TAAU (dynamic res) + RCAS sharpening |
| Substrate | layered slab material framework | node materials can layer | Approximate | layered physical model: base + clearcoat (water film, lacquer, oil) + sheen + anisotropy + transmission + SSS, built from a shared TSL library |
| Subsurface (skin) | Burley / subsurface profile | practical in approximation | Approximate | wrapped per-channel diffuse + thickness translucency + dual specular lobes |
| Volumetric fog | froxel fog, lights inject | practical as a ray march | Practical | ray-marched height fog lit by the baked light volumes + sun phase, energy-conserving integration, temporally resolved |
| Volumetric clouds | ray-marched cloud layer | possible, costly | Experimental | procedural cloud deck (2.5D) for the storm; HDR image skies elsewhere; full 3D clouds not planned |
| Sky atmosphere | physical Rayleigh/Mie | practical | Practical | analytic physical sky (Rayleigh + Mie + ozone tint, sun disc, night) for procedural places; image skies where the art uses an HDRI |
| Screen-space effects | GTAO, SSR, contact shadows | practical | Practical | GTAO / SSGI, SSR, SSS contact shadows from r187 nodes |
| Auto exposure | histogram metering | compute + atomics on WebGPU | Practical (WebGPU) / Approximate (WebGL2) | GPU log-luminance histogram with percentile clipping; WebGL2 falls back to probe metering |
| Post / cinematic | bloom, DOF, motion blur, lens, grading, LUTs | practical | Practical | all built, per-effect settings, camera profiles |
| Virtual texturing | streamed texture pages | no sparse textures | Impractical | per-section texture streaming, size limits on mobile, KTX2 where the pipeline supports it |
| Mega lights / many lights | thousands of shadowed lights | — | Approximate | baked fixtures + a fixed real-time pool near the player; Forward+ clustered lights (r187) evaluated for effects |
| Profiling (stat gpu, Insights) | per-pass timing | timestamp queries | Practical | GPU frame time via timestamp queries where supported, CPU timing, draw/triangle/memory overlay |

---

## 3. Architecture

```
src/graphics/
  index.ts                 public API
  config/presets.ts        5 presets + independent settings, detection, persistence (migrates the old 4-preset key)
  core/capabilities.ts     what the device can do (backend, features, limits, memory, touch, reduced motion)
  core/device.ts           WebGPURenderer creation, backend fallback, device-loss hook
  core/resources.ts        texture cache with load tracking, owned GPU resources, disposal, memory estimate
  core/timing.ts           CPU and GPU frame timing, percentiles
  core/resolution.ts       render scale (presets, touch lines) and dynamic resolution
  core/GraphicsSystem.ts   the facade the game talks to
  shaders/                 the TSL library (noise, colour, BRDF helpers, triplanar, anti-tiling, POM, normals, wetness, wear, SH)
  materials/               recipe adapter (glTF extras -> materials), templates and presets, characters (skin, eye, hair)
  lighting/                lightmaps, probe field + character rig, light pool, dynamic shadows, capsule shadows
  reflections/             reflection probes (per section, per reality), planar mirror
  atmosphere/              physical sky, image sky, storm deck, volumetric fog, weather state
  postprocessing/          frame graph and its stages (AO/GI, SSR, fog, TAA, bloom, DOF, motion blur, exposure,
                           tone mapping, grading, lens, gameplay looks, AA, output)
  effects/                 rain, sparks and rings, GPU particles
  optimization/            shader warm-up, budgets
  debugging/               debug views, performance overlay, diagnostics
```

Colour pipeline (one place each, never twice): textures are decoded to linear on sampling (sRGB colour maps tagged
`SRGBColorSpace`, data maps `NoColorSpace`); lighting is scene-linear HDR in half float; exposure is applied once
(auto-exposure stage); tone mapping once (our stage; `renderer.toneMapping = NoToneMapping`); display-referred grading
after it; the sRGB encode once (`RenderPipeline.outputColorTransform`).

---

## 4. Checklist

### Phase 0 — audit
- [x] Old system audited (section 1), r187 APIs verified, UE5 comparison written (section 2), architecture set (section 3)

### Phase 1 — foundation
- [x] capabilities, device creation with fallback and device-loss hook
- [x] 5 presets + independent settings + persistence + migration of the old key (`?gfx.<setting>=` overrides)
- [x] resource manager (texture cache, owned resources, disposal)
- [x] frame timing (CPU, GPU timestamps), resolution control + dynamic resolution (dynamic resolution untested on real hardware)
- [x] frame graph with fail-soft stages; exposure (GPU histogram), tone mapping (own AgX + looks, ACES, Neutral, Hable), grading, gameplay looks
- [x] debug views (albedo, normals, depth, AO, GI, reflections, fog, luminance, clipping, velocity, unexposed) + performance overlay
- [x] game, lab and arena switched over; `gfx.ts`, `quality.ts`, `postfx.ts` deleted

### Phase 2 — materials
- [x] TSL shader library (common, sampling: triplanar, anti-tiling, POM; surface layers: weather, wear)
- [x] recipe adapter + environment templates (scanned PBR with anti-tiling and macro variation, POM, plain/coated, glass, screens, practical lights, our own interior-mapped windows)
- [x] character shaders (skin with curvature-aware scatter, eye, cornea, teeth, hair cards, hair shells, armour, fabric)
- [x] weather layer (wet film, puddles with damp rims, rivulets, soaked characters)
- [x] water material (with per-wave footprint fade)
- [ ] material lab scene
- [x] `charmat.ts`, `skin.ts`, `hairshell.ts`, `wet.ts`, `water.ts`, `envmat.ts`, `windows/` deleted

### Phase 3–8 — lighting, shadows, GI, reflections, atmosphere, post
- [x] lightmaps + probe field + character rig + light pool moved into `lighting/`; reflection capture into `reflections/`
- [x] dynamic-object shadows on baked surfaces (own caster pass, contact-hardening PCSS, aimed by the probe's dominant direction)
- [x] screen-space contact shadows (r187 `SSSNode`, aimed by the dynamic shadows' dominant light, scaled by its strength)
- [x] capsule shadows (`lighting/capsuleShadows.ts`: five capsules per character from the skeleton, the four nearest characters)
- [x] SSGI / GTAO / SSR stages with debug views
- [ ] VXGI experiment (r187 `vxgi`, WebGPU only)
- [x] reflection probes in `reflections/` (per section, per reality; studio environment for test rooms)
- [x] physical sky (written, not yet used by a place), image sky, storm deck, volumetric fog (two-lobe phase, exact analytic tail) in `atmosphere/`
- [x] histogram auto exposure, bloom (energy-capped), DOF, motion blur (Ultra), lens (CA, vignette, grain), TRAA + RCAS sharpening
- [ ] TAAU upscaling (dynamic resolution currently resizes the render directly)
- [x] sparks and shock rings in `effects/particles.ts` (CPU-integrated, GPU-drawn streaks; soft ring bands by uniform, no recompiles)
- [ ] GPU-compute particles (attempted: see status log)
- [x] rain in `effects/rain.ts` (near streaks, far curtains, splashes, gusting wind); our own ocean in `water/ocean.ts`
- [x] `volumetrics.ts`, `sky.ts`, `rain.ts`, `vfx.ts`, `ocean/` deleted; `src/rendering/` gone

### Phase 9–10 — optimisation and validation
- [ ] shader warm-up, budgets, dynamic resolution tuned
- [ ] validation scenes (materials, lighting, post, characters, stress)
- [ ] screenshot regression set across chapters
- [ ] flow tests pass on the new renderer
- [ ] final status with measurements and limitations

---

## 5. Status log

- 2026-11-17: Phase 0 complete.
- 2026-11-17: Phases 1-2 in. Measured against the old renderer at five places (lab, storm exit, lobby, mirror hall, Nexus):
  - exposure: the GPU histogram's key/response were fitted to the probe meter the art was tuned with (key 0.16, response 0.36;
    within ~20 % at six places);
  - the old grade ran before exposure with a linear pivot, crushing everything under about sRGB 0.3 to a blue-black; the new
    house look (AgX, power 1.35) plus a gamma-space tinted black point per place restores the depth while keeping shadow detail;
  - neutral white balance had a green shift (Planckian 6500 K is not D65): fixed, 6500 K is now identity;
  - the fog's camera matrices were not being updated (the old post chain did it): fixed, `FogStage.update()` per frame;
  - skin in the lab is a little less saturated than the old real-time render (which crushed blue out of darker skin); the lab now
    uses log contrast 1.3 (Blender's Medium High Contrast is log contrast 1.2).
  - not verified: Chapter 2 (loses the SwiftShader WebGPU device in this container with either renderer), the new windows shader,
    the new water shader in a level, real GPUs and phones.
- 2026-11-17: dynamic-object shadows in (`lighting/dynamicShadows.ts`). Characters, enemies, echoes and door leaves render their
  light-space depth into a 2048/4096 float map (`dynamicShadows` setting; off on Performance) fitted round the player; baked
  surfaces take away `strength` of their light where shadowed (0.3 + 0.45 x how directional the probe's light is). Two traps
  found on the way: a raw texel fetch indexes WebGPU's top-down rows while `texture().sample()` uses three's v-up convention, and
  sampling an unfilterable float map with an explicit level returned nothing; the filter uses texel fetches, unrolled and
  branch-free. Debug view `shadowmap` shows the map. Reviewed: door-leaf shadows across a lab floor and wall (soft, contact
  hardening). Not yet framed in a gameplay shot with Ethan's own shadow in view.
- 2026-11-17: sparks and rings rebuilt (`effects/particles.ts`), old `vfx.ts` deleted. A compute-shader particle path was built
  and abandoned for now: with CPU-uploaded state buffers every dispatch restarted from the uploaded spawn state (the shared
  attribute was re-uploaded), and with GPU-owned state the spawn-copy pass wrote nothing and reported no error on the
  SwiftShader device. Sparks are integrated on the CPU (a few hundred at most) and drawn by a GPU streak shader.
- Open risk: with the dynamic shadow pass on, the SwiftShader WebGPU device in this container is lost in some runs (always
  with sparks and rings in flight, never with the pass off). Fetches are clamped and nothing writes out of bounds; needs a
  check on real hardware. Tests that need stability can pass `?gfx.dynamicShadows=0`.
- 2026-11-17: rain and the sea rebuilt; `src/rendering/` is gone (every shader in the game is now in `src/graphics/`).
  The ocean: 12 Gerstner waves from a sea state on a camera-following warped grid, per-pixel analytic normals plus
  footprint-faded ripples, a planar mirror (`reflector`, whitelisted layers) with Fresnel against a depth-coloured body over a
  baked seabed tile, crest and shore foam, GGX glint. Reviewed on the Chapter 4 terrace in both realities (calm blue with the
  towers mirrored; storm swell with foam). Far-rain curtains not yet reviewed in a framed shot.
- 2026-11-17: assets for the new renderer. 2K colour/normal/roughness for the 33 surface and fabric sets seen close up
  (`textureResolution` '2k' on High/Ultra desktop, '1k' on Medium and below and on every phone); the Chapter 4 daylight
  sky gets an 8K detail image of its upper hemisphere, blended to the 2K HDR where it saturates (the sun) and below the
  horizon. Reviewed: cloud structure resolves (A/B on the terrace). KTX2 measured and deferred: 2K UASTC colour 2.4 MB and
  normal 4.2 MB per map against 0.5 / 1.1 MB as JPG (19 s each to encode); it would cut GPU memory about 4x (BC7/ASTC) at
  three times the download. Revisit for phones (1K UASTC/ETC1S to ASTC) if memory shows up on real devices.
- 2026-11-17: capsule shadows in. Reviewed in the lab from above: a soft darkening round and between Ethan's feet that the
  frame without them lacks. Chapter 2 reviewed on the WebGL2 backend (street, windows, Ethan's readability: the storm black
  point lowered to 0.022 so the character fill is not closed to black); dynamic shadows' WebGL row order checked.
