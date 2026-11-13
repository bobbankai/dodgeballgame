# Performance and Testing

Source: directive §25 and master directive §15, §19. **Measure; never invent numbers.** Record only values you actually measured, with the hardware/backend they came from.

## Targets (approximate, not guarantees)
~60 FPS on capable desktop at appropriate settings · 30-60 FPS on supported lower-end devices when feasible · stable frame pacing · reasonable memory · reliable loading.
Presets: ULTRA, HIGH, BALANCED, PERFORMANCE (`src/rendering/quality.ts`): resolution scale, shadow resolution/cascades, AO/GI, SSR, bloom, DOF, motion blur, chromatic, grain, particle multiplier, fog, AA.

## Techniques to use
Frustum culling · LOD · GPU instancing · mesh compression (meshopt/Draco) · texture compression (KTX2) + mipmaps · batching · asset streaming + async loading · selective shadow casting · efficient shaders ·
resource pooling · dynamic resolution · shader-compile management · resource disposal · memory monitoring. Optimise expensive temporal effects carefully; never trade stability for a barely visible gain.

## Budgets to maintain (fill in as measured)
| Budget | Target | Measured |
|---|---|---|
| Draw calls (main play view) | tbd | not measured |
| Triangles on screen | tbd | not measured |
| Texture memory | tbd | not measured |
| GPU frame time | tbd | not measured (no real GPU in the dev container) |
| CPU frame time | tbd | not measured |
| Particles | tbd | not measured |
| Active animations / skinned characters | tbd | not measured |
| Physics bodies | tbd | not measured |
Asset sizes now: `characters/ethan.glb` 8.6 MB (41 sampled clips, uncompressed): needs meshopt + animation key reduction.

## Test environment (important limits)
The dev container has **no real GPU**: WebGPU runs on SwiftShader (software Vulkan) under Xvfb, WebGL2 on software GL. These verify *correctness and appearance*, not speed. Real-GPU profiling must be done by the owner
or in CI with hardware and recorded here. Browser matrix to verify when hardware allows: WebGPU startup, WebGL2 fallback, loading, resize, pointer lock, audio init, fullscreen, error handling, presets.

## Automated checks
`npm run build` (typecheck + bundle), headless screenshot tests (`tools/shot.cjs`), scripted gameplay drives (to be added in `tests/`), asset validation (`blender-asset-qa`, GLB import tests).
