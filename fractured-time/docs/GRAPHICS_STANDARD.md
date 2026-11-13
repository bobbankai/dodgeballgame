# Graphics Standard

Source: directive §9-§13. Verify every technique against the installed Three.js (0.187) API; never invent APIs; use the best compatible alternative.

## Renderer
WebGPURenderer primary, WebGL2 fallback (`?webgl` forces it), TSL node materials, `RenderPipeline` post, PBR, IBL, correct colour management, ACES filmic
tone mapping (re-evaluate AgX/Neutral per chapter). No WebGL-only post with WebGPURenderer. Presets: ULTRA / HIGH / BALANCED / PERFORMANCE (`src/rendering/quality.ts`);
players can adjust expensive effects individually.

## Verified available in three 0.187 (addons/tsl/display)
GTAO (`ao`), `ssgi` (AO + GI, wants MRT diffuse + temporal), `ssr`, `bloom`, `dof`, `chromaticAberration`, `film`, `smaa`, `fxaa`, `taau`, `motionBlur`,
`SunLight`/`CSMShadowNode` (cascaded directional shadows), `ClusteredLighting`/`DynamicLighting` (many lights), `LightProbeGrid`, `GodraysNode`
(volumetric light shafts), `SSSNode`. Investigate and adopt where they improve the image: TAA, volumetrics, reflection probes, transmission.

## Lighting and shadows
Cinematic, believable, never flat. Strong composition, natural contrast, indirect illumination, realistic sources, purposeful colour temperature, atmospheric depth.
Per-space lighting: research labs, urban exteriors, corporate interiors, abandoned locations, cinematics, temporal anomalies, boss arenas.
Shadows: suitable resolution, soft + stable filtering, correct bias/normal bias, convincing contact, distance behaviour. No jaggies, floating shadows, acne, or crushed-black scenes.
Use cascaded directional shadows outdoors; budget shadow-casting local lights (a handful near the player); contact shadows via AO.

## Materials (TSL PBR; see MODELING_STANDARD for baked maps)
Skin, hair, fabric, leather, metal, glass, plastic, rubber, concrete, asphalt, wood, composite armour, futuristic tech. Each needs believable reflection + roughness response
and wear: scratches, seams, dust, manufacturing detail, fabric texture, roughness variation, subtle discolouration. No flat colours, no uniformly smooth surfaces.
Procedural TSL surfaces (`src/rendering/materials.ts`) provide seams, bolts, grime, scratches, bump; hero assets additionally use baked normal/roughness/metal/AO/emissive maps,
compressed (KTX2) with mipmaps, sized by screen-space importance.

## Reflections
Glass, metal, polished floors, wet asphalt, equipment, armour: choose per surface from environment maps, reflection probes, SSR, planar reflections.

## Post-processing (tuned, never excessive)
AO/GI, bloom, grading, DOF, AA (SMAA/FXAA now, TAA when verified), reflections, atmospheric fog, motion blur, filmic tone mapping, temporal distortion.
Bloom, blur, chromatic aberration and grain stay subtle in normal play; strong only for gameplay-driven temporal events. Post enhances good assets; it never hides poor ones.

## Shader / VFX library (TSL, reusable, gameplay-driven)
Temporal energy, reality fractures, holographic displays, futuristic screens, glass, wet surfaces, water, environmental transitions, animated machinery, character equipment,
boss transformations. Temporal effects: distortion, afterimages, energy ripples, particles, timeline transitions, reversed movement, reality reconstruction, localised environment change.
Each effect responds to gameplay, uses particle variation, emissive light, shader animation, environment sync and audio feedback. No generic glowing spheres or random particle bursts.

## Testing the rendering
Always look at screenshots from both backends (`tools/shot.cjs`: `webgpu` under Xvfb, `webgl` headless). Check: exposure, shadow bias/acne, banding, aliasing, fireflies, AO halos,
DOF focus, reflection correctness. Record verified behaviours in `CLAUDE.md`.
