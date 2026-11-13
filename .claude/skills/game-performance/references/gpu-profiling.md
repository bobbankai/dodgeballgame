# GPU Bottleneck Classification

When Step 3 of the diagnostic tree identifies a GPU bottleneck, use this reference to classify the specific type and apply targeted fixes. Each section follows: **Mechanism → Confirm → Levers → Common Culprits**.

---

## Fill-Rate / Pixel Throughput

**Mechanism**: The GPU processes a fixed number of pixels per clock cycle. Fill-rate = resolution × overdraw × per-pixel shader cost. When the total pixel work exceeds the GPU's throughput capacity, frames take longer than the budget allows.

The key insight: fill-rate scales with resolution. A 2× resolution increase means 4× the pixel work. This is why the halve-render-scale test is so diagnostic — if it's fill-rate bound, the load drops proportionally.

**Confirm**: Halve render scale → GPU load drops significantly (proportional to resolution reduction). If load drops by ~75% when you halve resolution (0.5× scale = 0.25× pixels), it's almost purely fill-rate bound.

**Levers**:
- **Dynamic resolution rendering (DRR)**: Automatically reduce internal resolution when frame time exceeds budget. Maintains target FPS at the cost of image quality. Most effective lever for fill-rate problems.
- **Reduce overdraw**: Every pixel rendered multiple times multiplies fill-rate cost. Techniques:
  - Depth prepass: render geometry depth-only first; subsequent passes skip pixels that fail depth test
  - Occlusion culling: don't submit geometry that's fully behind other geometry
  - Sort transparent objects back-to-front and minimize transparency layers
  - Reduce particle count or particle size (particles are high-overdraw offenders)
- **Simplify pixel shaders**: Fewer instructions per fragment = more pixels per clock. See Shader Complexity section.
- **Reduce post-processing passes**: Each full-screen effect is a full-resolution fill-rate cost. Stack them carefully; combine passes where possible.

**Common culprits**:
- Multiple full-screen post-process effects stacked (bloom + SSAO + depth of field + color grading = 4× fill-rate overhead)
- Particle systems with large particles and high spawn rates — each particle covers many pixels, often with alpha blending (overdraw)
- SSAO at maximum quality on mobile or integrated GPU hardware
- Volumetric fog or volumetric lighting at full resolution
- Transparent UI elements rendered at full resolution with complex shaders

**Numbers to know**: On a Steam Deck (RDNA2 integrated), fill-rate budget is roughly 2 Gpixels/sec at base clock. At 1280×800 native, that's ~1,953 full-screen passes per second — or about 32 passes per 16.6ms frame. Every post-process pass consumes one of those slots.

---

## Bandwidth / Memory Throughput

**Mechanism**: The GPU reads textures and writes framebuffers through a fixed-bandwidth memory bus. When shaders sample large or many textures, the bus saturates — the GPU's compute units sit idle waiting for data. This is distinct from compute-bound: the GPU has ALU capacity, but it's starved for data.

On integrated/shared memory hardware (Steam Deck, mobile), CPU and GPU share the same memory bus. Heavy GPU texture reads compete with CPU data access, compounding the problem.

**Confirm**: Replace textures with solid-color constants in shaders (Test B1 from the diagnostic tree) → GPU load drops significantly. This isolates texture reads from shader ALU — if removing texture reads drops load, bandwidth is the driver.

**Levers**:
- **Texture compression**: Compressed formats reduce bandwidth by 4–8× with minimal visual quality loss.
  - Desktop: BC1 (opaque, 8:1), BC3 (alpha, 4:1), BC7 (high quality, 4:1)
  - Mobile/handheld: ASTC 4×4 (4:1), ASTC 6×6 (~9:1 for less-detailed textures)
  - Never ship uncompressed textures unless there's a specific reason (e.g., render targets that are written every frame)
- **Mipmap bias**: Force lower-resolution mip levels for textures that don't need full detail. A +1 mip bias halves linear resolution (quarters texel count), reducing bandwidth by ~4×.
- **Reduce render target precision**: RGBA16F (8 bytes/pixel) → RGBA8 (4 bytes/pixel) halves framebuffer bandwidth. Use 16F only where the precision is actually needed (HDR render targets, G-buffer normals).
- **Texture atlasing**: Combining many small textures into one atlas reduces sampler state changes and can improve cache coherency.
- **Reduce G-buffer channels**: Deferred rendering G-buffers can be bandwidth-heavy. Consolidate channels; use packed formats (e.g., pack normals into RG16F instead of RGBA16F).
- **Shadow map resolution**: Shadow maps are read every frame for every shadowed pixel. Oversized shadow maps waste bandwidth. Match resolution to the shadow's screen coverage.

**Common culprits**:
- Uncompressed textures (RGBA8 raw, no BC/ASTC compression) — the single most common bandwidth problem
- Unnecessary high-precision render targets (RGBA16F for a render target that only needs 0–1 values)
- Excessive deferred G-buffer channels (5+ render targets in the G-buffer)
- Large shadow map resolutions (4096×4096 for a shadow that covers 200 screen pixels)
- Texture arrays or cubemaps at full resolution when lower resolution would suffice
- Streaming textures at the wrong mip level (loading too-high-resolution mips for distant objects)

**Bandwidth math**: A 2048×2048 uncompressed RGBA8 texture = 16MB. BC7 compressed = 4MB. At 60fps, sampling that texture once per frame = 960MB/sec vs 240MB/sec. On a device with 50GB/sec memory bandwidth, the difference between 10 uncompressed vs 10 compressed textures is 9.4GB/sec vs 2.3GB/sec — a meaningful fraction of total bandwidth.

---

## Shader Complexity / ALU

**Mechanism**: Fragment shaders with many math operations (trigonometry, `pow`, `normalize`, multiple light evaluations per pixel) saturate the GPU's arithmetic logic units (ALUs). The GPU has plenty of pixels to process, but each pixel takes too many clock cycles to compute.

This is distinct from bandwidth-bound: the GPU is actively computing, not waiting for data. The white material test distinguishes them — if replacing shaders with flat white drops load but removing texture reads doesn't, it's ALU-bound.

**Confirm**: Two-step confirmation from the diagnostic tree: (1) Test B1 — replace textures with solid-color constants (keep shader math) → no improvement; (2) replace entire shader with flat unlit → GPU load drops. Improvement in step 2 but not step 1 confirms ALU is the bottleneck, not bandwidth. Note: "ALU-bound" is a catch-all for shader compute cost; GPU-specific profiling tools (RenderDoc, NSight, Xcode GPU Frame Capture) are needed to distinguish ALU saturation from register spills or control flow divergence.

**Levers**:
- **Move computation to vertex shader**: Per-vertex operations run once per vertex; per-fragment operations run once per pixel. For operations that vary smoothly across a surface (some lighting terms, UV transforms), vertex-shader computation is cheaper.
- **Bake into textures**: Pre-compute expensive per-pixel calculations into a texture. Ambient occlusion, lightmaps, and pre-baked reflections are all "baked shader complexity."
- **Use LUTs (lookup tables)**: Replace expensive math functions (`pow`, `exp`, trigonometry) with a texture lookup. A 256-entry 1D texture lookup is faster than `pow(x, 2.2)` on many GPUs.
- **Reduce instruction count**: Profile the shader with a GPU-specific tool. Identify the most expensive instructions. Approximate where precision isn't critical.
- **Half-precision (mediump/float16)**: On mobile and some integrated GPUs, half-precision operations are 2× faster than full-precision. Use `mediump` in GLSL or `half` in HLSL for color values, normals, and other data that doesn't need full float range.
- **Shader LOD**: Use simpler shaders for distant objects. The same LOD system that reduces geometry can swap to a simpler material.

**Common culprits**:
- Complex PBR (physically-based rendering) on every surface, including distant objects with no LOD
- Per-pixel procedural noise (Perlin, Simplex, Worley) — extremely expensive; bake to texture instead
- Multiple dynamic light sources each evaluated per-pixel with shadow sampling
- Screen-space reflections (SSR) — ray-marching per pixel is very expensive
- Complex water shaders with multiple octaves of wave simulation per pixel

---

## Vertex / Geometry Throughput

**Mechanism**: The GPU processes N vertices per clock cycle through the geometry pipeline (vertex shader, primitive assembly, rasterization setup). Dense meshes, tessellation, or many per-vertex attributes saturate this pipeline. The render scale test won't help here — vertex processing cost is independent of resolution.

**Confirm**: Aggressive LOD or disabling distant objects → GPU load drops. But the render scale test showed no improvement — confirming it's vertex-bound, not fill-rate.

**Levers**:
- **LOD systems**: The primary lever. Reduce polygon count for distant objects. A 10,000-triangle hero mesh at distance 500 can be a 500-triangle mesh with no visible quality loss.
- **Mesh simplification**: Import meshes with decimation applied. Many DCC tools (Blender, Maya) export unnecessarily dense meshes. A character mesh at 50,000 triangles is rarely justified.
- **Occlusion culling**: Don't submit geometry that's fully occluded by other geometry. The GPU still processes vertices for culled geometry unless the CPU culls it first.
- **Instance merging / GPU instancing**: Render many copies of the same mesh with a single draw call. Each instance shares the vertex data; only per-instance data (transform, color) differs.
- **Reduce per-vertex attributes**: Strip unused UV channels, tangent vectors (if not needed for normal mapping), and vertex colors. Each attribute adds to the per-vertex data read from memory.
- **Disable tessellation**: Tessellation multiplies triangle count dynamically. It's rarely worth the cost on constrained hardware.

**Common culprits**:
- No LOD system at all — hero-quality meshes rendered at every distance
- Tessellation enabled globally without distance-based falloff
- Importing meshes from DCC tools without decimation (sculpted meshes at subdivision level 3+)
- Skinned meshes with too many bones per vertex (4+ bone influences per vertex is expensive)
- Foliage/vegetation with no LOD or billboard fallback

---

## Fixed Overhead / Submission

**Mechanism**: Each draw call has a fixed CPU and GPU cost regardless of how many pixels or vertices it processes. State changes between draw calls (switching shaders, binding different textures, changing render targets) are especially expensive. When a frame contains hundreds of draw calls with different materials, the fixed overhead dominates — even if each individual draw call is cheap.

This is submission-bound: the CPU is spending its budget preparing GPU work, and the GPU has "bubbles" (idle time between draw calls waiting for the next batch of work).

**Confirm**: Neither render scale nor LOD changes affect GPU load. A frame debugger shows hundreds of draw calls with state changes between them. GPU utilization is high but GPU clock is low — the GPU is not actually computing at full speed.

**Levers**:
- **Static batching**: Combine static geometry that shares a material into a single mesh. One draw call instead of N. Most engines support this automatically for static objects.
- **Dynamic batching**: Combine small dynamic objects that share a material into a single draw call per frame. Has CPU cost for the batching itself; only worthwhile for very small meshes.
- **GPU instancing**: Render many copies of the same mesh with one draw call. Requires the same mesh and same material (with per-instance data passed as instance attributes).
- **Material atlasing**: Combine multiple textures into one atlas so objects can share a material. Objects with the same material can be batched.
- **Reduce render passes**: Each render pass (shadow map, reflection capture, G-buffer, post-process) has fixed overhead. Audit for passes that aren't contributing visibly.
- **Find rogue cameras**: Each camera triggers a full render pass. Disabled cameras that are still active, cameras rendering to offscreen targets for effects that aren't visible — these are common sources of hidden draw call overhead.
- **Disable shadow casting per light**: Each shadow-casting light adds a shadow map render pass. Disable shadow casting for lights that don't contribute visibly (fill lights, ambient lights, lights far from the camera).

**Common culprits**:
- Decals implemented as separate draw calls per decal (use a decal atlas and batch)
- Per-object materials without batching (every object has a unique material instance)
- Cameras rendering to offscreen render textures for effects that are disabled or invisible
- Shadow passes for every light in the scene, including lights that don't visibly contribute
- Particle systems with one draw call per particle instead of one draw call per system
