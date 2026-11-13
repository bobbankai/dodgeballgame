# Eclipse: Fallen Gods — rendering reference

Everything the frame is made of, in the order it is made, and how to change or test each piece.
Source of truth is the code (`src/render/*`); this file says where things are and why.

## Frame order

1. **Shadow pass.** Sun cascades (`Lighting.setShadowQuality`, 1-4 cascades, PCF or contact-hardening PCSS).
   Sun depth for volumetric shafts (`Atmosphere.ts` `SunDepth`, an orthographic depth render).
2. **Depth pre-pass.** The camera's view-depth map (`Pipeline.depth`). It feeds SSAO, SSR, the fog
   pass, depth of field **and the per-material contact shadows**.
3. **Colour pass** (MSAA on the first post-process target at `msaa`). Every PBR material = Babylon's PBR
   shader + the plugins below. Sky and clouds are `Sky.ts` (ray-marched volumetric clouds, Hillaire-style
   scattering terms, procedural eclipse and corona).
4. **Screen-space.** SSAO2 (`ambientOcclusion`), SSR (`reflections`), TAA at `ultra`.
5. **Atmosphere** (`Atmosphere.ts`): exponential height fog, aerial perspective, volumetric fog with
   sun-shadowed light shafts, ray-marched with interleaved-gradient jitter.
6. **Post chain** (`render/post/*`, our own): depth of field -> motion blur (ultra) -> six-level
   energy-conserving bloom with lens dirt -> **Tonemap** (auto exposure, chromatic aberration, ACES/AgX,
   3D-LUT grading, vignette, film grain, dither) -> FXAA -> CAS sharpening.

## Material plugins (`src/render/materials`)

All are `EcPlugin`s: they inject code into Babylon's PBR shader at documented markers, with a WGSL and a GLSL
version of every snippet (WebGPU and WebGL 2 run the same materials, no transpiler). Lower priority runs first.

| Plugin | Priority | What it does |
|---|---|---|
| `EcTerrain` | 100 | 4-layer height-blended terrain, biplanar cliffs, stochastic anti-tiling, macro colour, parallax |
| `EcWind` | 110 | vertex sway for foliage and cloth |
| `EcSurfaceLayers` | 120 | wetness, puddles (not below `MatEnv.waterLevel`), ash/snow/moss cover |
| **`EcShading`** | 120 | **contact shadows, cloth fuzz, leaf translucency, macro variation** (below) |
| `EcDissolve` | 130 | noise burn-away with glowing edge (deaths, phase changes) |
| `EcEmissiveFx` | 140 | pulsing, flowing emissive (runes, veins) |
| `EcSkin` / `EcHair` / `EcLava` | 150 | wrapped-diffuse scattering and back-transmission / Kajiya-Kay hair / lava |

Scene-wide inputs live in `MatEnv` (weather, wind, sun direction and colour) and `Shade` (below), written
once a frame; plugins only read them.

### EcShading (`materials/Shading.ts`)

Registered for every PBR material by `installShading()` (called in `Game` before any material exists);
`ShadingPlugin.of(material)` gets one. Per-material fields: `fuzz`, `leaf`, `leafTint`, `macro`, `contact`.

- **Sun contact shadows.** The cascade (a few cm per texel at best) cannot resolve a boot, a strap or a
  pebble. Each fragment marches 6-12 steps toward the sun through the depth pre-pass and multiplies the
  **sun's own** `shadow` term (spliced into Babylon's light loop right after the cascade lookup), so
  fill light, local lights and reflections are untouched. Safeguards: surfaces facing away from the sun
  are skipped; the term fades out by `contactDistance`; the fragment's own depth is compared with the
  map's, and anything that disagrees (alpha-blended, skipped by the depth pass) returns 1; passes into
  any target that isn't the main one (probe cube faces) bind but never use the map.
- **Cloth fuzz** (`fuzz`, characters' cloth and gear atlases): asperity scattering. A soft sun- and
  sky-lit rim at grazing angles for rough non-metals only, keyed per texel on `roughness` and `metallic`,
  so plate in a mixed gear atlas does not pick it up.
- **Leaf translucency** (`leaf`, set automatically on alpha-tested photoscans): sun transmitted through
  the leaf, strongest looking toward the sun, shadowed by the canopy's own cascade shadows.
- **Macro variation** (`macro`, all `MaterialLibrary.surface` materials and the env kit): three octaves of
  world-space noise drift the albedo's brightness and warmth over metres to break the repeat of tiled
  masonry and paving. 0.35 on metals, 1 elsewhere.
- **Geometric specular anti-aliasing** is switched on for every PBR material at creation.

`Shade` (module state, also `window.__shade` in `?test`): `depth` (the map, or null), `contact` (strength,
0 = off), `contactSteps`, `contactDistance`, `macro`, `debug`. `Pipeline.build` sets them from the preset:

| preset | contact shadows | steps | distance |
|---|---|---|---|
| low | off | - | - |
| medium | on | 6 | 45 m |
| high | on | 8 | 45 m |
| ultra | on | 12 | 60 m |

`Shade.debug = 1` paints each fragment with its contact term; `2` with |map depth - own depth| (should be
black on everything the pre-pass sees: if it is not, that surface is skipped by the depth pass).

## Image-based lighting

`Lighting.captureEnvironment(sky)` renders the sky into a cube, prefilters it (GGX importance sampling) and
sets the diffuse spherical harmonics: the *sky probe*. On top of it, `Lighting.updateLocal(dt, centre)` keeps a
**local light probe** current: the static scenery registered through `addStatic` plus the sky are rendered
into a 96 px cube from 2.2 m above the player, prefiltered, and swapped in when the player has moved 9 m or
14 s have passed. Diffuse SH is eased from the old probe to the new one over 1.5 s (never pops), and
blended 70 % local / 30 % sky since one probe is only exactly right at its own position. The first capture
blocks the level load (no first-frame pop); a new level discards it. `localProbe.size = 0` disables it.

## Adding a plugin

1. Subclass `EcPlugin` (`EcPlugin.ts`); give it a unique priority and a define (`EC_X`) so it costs nothing
   when off.
2. Provide `code()` for both `glsl` and `wgsl`, keyed by a Babylon injection marker
   (`CUSTOM_FRAGMENT_DEFINITIONS`, `..._UPDATE_ALPHA` (albedo is final, before lighting), `..._BEFORE_LIGHTS`,
   `..._BEFORE_FINALCOLORCOMPOSITION` (`finalDiffuse` etc.), `..._BEFORE_FRAGCOLOR`) or a regex key
   (`'!(pattern)'`, `$1` is the match).
3. Bind uniforms in `bindForSubMesh`. Override `copyTo` if its fields must survive `material.clone()`.
4. Mind the varying budget: every cascade costs two interpolated varyings in every lit shader
   (`Caps.separateGeometryPass`).

## Testing a shading change

- `node eclipse/tools/play.mjs "<url>/?test&level=playground&quality=high&enemies=monk" out @script.json`, with a
  fixed camera (`__game.cine.play` + `d.cut`), `__game.pipe.tonemap.params.grain = 0`, and an A/B pair of
  frames (flip the `Shade` field or a plugin's field, call `__refreshShading()`); diff the PNGs numerically.
- Always run every level once in WebGPU and once with `&gl=webgl2` (the two shader languages are separate
  code): errors show up in the log as `[error]`.
- Headless runs use software rasterisation: timing is meaningless, only correctness is.
