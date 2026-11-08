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
