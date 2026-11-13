---
name: "game-performance"
summary: "Systematic GPU/CPU/memory profiling and optimization methodology for games"
type: "design"
description: "You MUST consult this skill when diagnosing or fixing game performance problems — profiling GPU/CPU/memory bottlenecks, improving frame rate, reducing battery consumption, fixing hitches or frame drops, or optimizing for constrained hardware (handheld, mobile, integrated graphics). Also trigger when a game runs at target FPS but utilization is dangerously high, or when frame pacing is inconsistent. NOT for network performance (latency, tick rate, bandwidth), loading time optimization, architectural patterns that prevent performance problems (see game-patterns), shader authoring (see godot-shader), or engine-specific profiling tool configuration."
---

# Game Performance

Systematic methodology for diagnosing and fixing game performance problems. Profile first, fix the root cause, leave headroom.

---

## Core Principles

- **Profile before optimizing.** Measure, don't guess. The bottleneck is almost never where you think it is. Every optimization session starts with a profiler, not a hunch.
- **Fix the root cause, not the symptom.** Upscaling masks fill-rate problems but doesn't fix them — you still pay the thermal and battery cost. Fixing the source gives you FPS gains *and* thermal/battery gains.
- **Isolate variables.** Change one thing at a time, observe the metric, conclude. Changing three things simultaneously makes it impossible to know which one helped.
- **Leave headroom.** Never target 100% utilization. Background OS tasks, worst-case game moments (explosions, many entities), and thermal variance all eat into margin. Target 60–75% utilization at your FPS goal on min-spec hardware.
- **Utilization ≠ performance.** ~29% GPU at 1600MHz delivers the same FPS as 55% GPU at 830MHz — with roughly half the power draw. When the hardware has spare capacity, it downclocks to save power. Lower utilization at a lower clock is better than high utilization at a high clock.
- **Flat profiles are the mature case.** Jonathan Blow observes that once obvious hotspots are eliminated, a mature profile is "flat" — many items each at ~0.3–1%, no single dominant win. If one change *does* give a huge speedup at that stage, you were probably previously negligent. Your options become "accept the profile" or "make an architectural change"; grinding down many small contributors is the expensive, incremental reality. The diagnostic decision tree below assumes a hotspot exists; this principle covers the flat case where it doesn't.
- **Measure work per unit time, not raw throughput.** Don't compare raw rates (fps, draw calls/sec) across different workloads — compare work and features delivered per unit time. A rich scene running at 120fps and an empty room running at 2000fps are not comparable; the empty room number tells you nothing about your game's actual budget. Evaluate performance in the context of what is being rendered.

---

## Performance Glossary

| Term | Definition |
|---|---|
| **Frame budget** | The fixed time available per frame. 16.6ms at 60fps, 33.3ms at 30fps. Every subsystem (GPU, CPU, audio, physics) must finish within this window. |
| **Fill-rate** | GPU pixel throughput: resolution × overdraw × per-pixel shader cost. When this exceeds the GPU's capacity, frames take longer. |
| **Overdraw** | Pixels rendered multiple times per frame due to overlapping geometry or effects. A pixel rendered 4× costs 4× the fill-rate budget. |
| **Bandwidth-bound** | Limited by memory read/write speed, not compute. The GPU is waiting for texture data, not running out of ALU capacity. |
| **Submission-bound** | The CPU can't feed the GPU fast enough. Too many draw calls or state changes per frame; the GPU starves while waiting for work. |
| **Vertex-bound** | Limited by geometry processing throughput. Dense meshes or tessellation saturate the geometry pipeline. |
| **Compute-bound** | Limited by shader ALU operations. Complex fragment shaders with many math ops saturate compute units. |
| **Headroom** | Margin between current utilization and capacity. A safety buffer for variance, thermal throttling, and worst-case scenes. |
| **Frame pacing** | Consistency of frame delivery timing, distinct from average FPS. A game averaging 60fps with frames delivered at 8ms/25ms/8ms/25ms has poor frame pacing — it feels choppy despite the average. |
| **Hitching** | Individual frame spikes amid otherwise smooth performance. Caused by GC collection, streaming stalls, shader compilation, autosave. |
| **Thermal throttle** | Hardware reducing clock speeds to manage heat. Sustained load causes chip temperature to rise; the hardware reduces clocks to stay within thermal design power (TDP). Performance degrades over time. |
| **Power envelope** | Total watts available, shared between CPU and GPU on mobile/handheld. Reducing CPU work can free power for the GPU and vice versa. |
| **Dynamic resolution** | Adjusting internal render resolution at runtime to maintain frame targets. Trades image quality for consistent frame time. |
| **LOD** | Level of Detail — reducing geometry or texture quality for distant objects. The primary lever for vertex and bandwidth budgets. |
| **Mip bias** | Skipping high-resolution mipmap levels to reduce bandwidth. A negative mip bias forces higher-res mips; a positive bias forces lower-res mips. |

---

## The Diagnostic Decision Tree

This is the core of the skill. Follow the numbered steps in order. Each test isolates one variable and tells you where to look next.

### Step 1: Establish Baseline Metrics

Before touching anything, record:
- **FPS** (average and 1% low)
- **GPU utilization %** and **GPU clock speed**
- **CPU utilization %** per core
- **VRAM usage** and **system RAM usage**
- **Frame time graph** over 30+ seconds (not just average FPS)

**Critical question**: Is the problem *sustained low FPS*, *intermittent hitches*, or both?

- Sustained low FPS only → proceed to Step 2
- Intermittent hitches only → proceed to Step 5
- Both → Step 2 first (fix the sustained bottleneck), then return to Step 5

---

### Step 2: Sustained Low FPS — Identify the Primary Bottleneck

Compare GPU utilization vs. CPU utilization:

> **Note**: If your engine uses a separate render thread (Godot 4, Unity multithreaded rendering), check render thread utilization separately from main thread utilization.

| Observation | Conclusion | Next Step |
|---|---|---|
| GPU ~100%, CPU < 80% | GPU-bound | Step 3 |
| CPU ~100%, GPU < 80% | CPU-bound | Step 4 |
| Both ~100% | Submission-bound (CPU preparing too much GPU work) | Step 4 (CPU side), then Step 3 |
| Main thread < 80%, render thread ~100%, GPU < 80% | Render thread submission-bound | Step 4 (render thread submission section) |
| Neither high (both < 70%) | Vsync-limited, frame cap, or external throttle | Check frame cap settings; verify vsync isn't locking to a lower multiple |

**Submission-bound** is a special case: the CPU is spending its budget generating draw calls and state changes, so the GPU starves. It looks like both are high, but the GPU has "bubbles" — it's not actually running at capacity. The fix is on the CPU side (batching, instancing) not the GPU side.

---

### Step 3: GPU-Bound — Classify the GPU Bottleneck

**Test A: Halve render resolution** (set render scale to 0.5×)

> **Mobile/TBDR caveat**: On tile-based GPU architectures (all iOS, most Android — Mali, Adreno, PowerVR), internal framebuffer bandwidth is handled on-chip. Halving resolution may show little improvement even when texture bandwidth is the bottleneck. On these platforms, proceed to Test B regardless of Test A result.

- **GPU load drops significantly** → fill-rate or bandwidth bound
  - **Test B1: Replace textures with solid-color constants** (keep shader math, remove texture reads — use a hardcoded `vec4(1.0)` in the shader instead of a texture sample)
    - GPU load drops → **bandwidth/texture bound** → see `references/gpu-profiling.md § Bandwidth`
    - No change → **shader ALU bound** → see `references/gpu-profiling.md § Shader Complexity`
  - **Test B2 (if B1 showed bandwidth-bound): Re-enable textures but use a single 1×1 solid-color texture for all materials**
    - GPU load stays low → **data bandwidth** is the bottleneck (the sampler hardware is cheap; the data volume was the problem); proceed with compression and mip bias
    - GPU load returns to near-original → **sampler-count or TMU-bound** (too many texture units active regardless of data size); reduce distinct texture samples per pixel
- **No change** → fixed-cost overhead (resolution doesn't affect it)
  - **Test C: Halve geometry count** (aggressive LOD, or disable half the scene objects)
    - GPU load drops → **vertex-bound** → see `references/gpu-profiling.md § Vertex`
    - No change → compute passes, rogue cameras, or unnecessary render passes → see `references/gpu-profiling.md § Fixed Overhead`

---

### Step 4: CPU-Bound — Classify the CPU Bottleneck

Open your profiler and identify which subsystem dominates frame time. Common categories: script/logic, physics, animation, audio, render thread submission.

**Branch on language runtime:**

**[Managed: C#, GDScript, Lua]**
1. Check GC allocation rate per frame first — GC spikes are the most common managed-language performance killer
2. If allocation rate is high, see `references/cpu-profiling.md § GC Pressure`
3. If allocation is low, check which subsystem dominates and see `references/cpu-profiling.md` for that subsystem

**[Native: C++, Rust]**
1. Check cache miss rate in hot loops first — pointer chasing and random memory access are the most common native performance killers
2. If cache miss rate is high, see `references/cpu-profiling.md § Cache Inefficiency`
3. If cache misses are low, check which subsystem dominates and see `references/cpu-profiling.md` for that subsystem

---

### Step 5: Intermittent Hitches — Frame Pacing Investigation

Record a frame time graph over 60+ seconds. Characterize the pattern:

| Pattern | Likely Cause | Investigation |
|---|---|---|
| **Periodic** (every N seconds) | GC collection, autosave, background streaming checks | Check allocation rate; look for periodic disk writes |
| **Situational** (entering areas, spawning) | Streaming stalls, shader compilation on first use, bulk entity spawning | Pre-warm shaders; async streaming; stagger spawns |
| **Random** | OS background tasks, driver issues, thermal throttling | Check CPU temperature; look for OS scheduler interference |

See `references/cpu-profiling.md § Hitching` for the full investigation per category.

---

### Step 6: Thermal and Power Issues

- **Target FPS met but utilization > 80%** → headroom problem; see `references/thermal-power.md § Headroom`
- **Performance degrades over a 20–30 minute play session** → thermal throttling; see `references/thermal-power.md § Thermal Throttling`
- **Battery drains too fast on handheld/mobile** → power optimization needed; see `references/thermal-power.md § Battery Life`

---

## Worked Example: Steam Deck GPU Bottleneck

**Scenario**: A 2D action game hits 60fps on Steam Deck but at 90% GPU utilization and 1600MHz clock speed. The developer wants to ship with headroom for worst-case scenes.

**Step 1: Baseline metrics**
- FPS: 60 (vsync-locked), 1% low: 58
- GPU: 90% utilization, 1600MHz
- CPU: 45% utilization
- Frame time graph: mostly flat at 16.6ms, occasional 18ms spikes

Conclusion: sustained GPU-bound problem. CPU has headroom. Proceed to Step 2.

**Step 2: Primary bottleneck**
GPU ~90%, CPU ~45% → clearly GPU-bound. Proceed to Step 3.

**Step 3: Classify GPU bottleneck**

**Test A**: Set render scale to 0.5× (halve resolution).
- Result: GPU drops from 90% to 55%. Significant drop.
- Conclusion: fill-rate or bandwidth bound. Proceed to Test B1.

**Test B1**: Replace textures with solid-color constants in shaders (keep lighting math, remove texture reads).
- Result: GPU drops from 55% to 35%.
- Conclusion: bandwidth/texture bound. The texture reads are the bottleneck.

**Test B2**: Re-enable textures but use a single 1×1 solid-color texture for all materials.
- Result: GPU stays low at ~35% (same as B1 — the 1×1 texture does not bring load back).
- Conclusion: data bandwidth is the bottleneck (not sampler count). Proceed with compression and mip bias.

**Investigation** (from `references/gpu-profiling.md § Bandwidth`):
- Audit texture compression: several 2048×2048 textures were imported as uncompressed RGBA8. Converting to BC7 (desktop) / ASTC 4×4 (mobile) reduces texture memory bandwidth by 4–8×.
- Found two render targets using RGBA16F precision when RGBA8 was sufficient.
- Found a shadow map at 4096×4096 for a 2D game — reduced to 1024×1024.

**Result after fixes**:
- GPU: drops from 90% to ~60% utilization at 1600MHz
- DVFS kicks in: hardware downclocks to ~1100MHz where the same workload runs at ~80% utilization
- FPS: still 60fps (vsync-locked)
- Power draw: reduced by ~35–40%
- Thermal: chip now runs 10–12°C cooler; no throttling in 30-minute sessions

**Key insight**: The FPS didn't change, but the game is now thermally sustainable and has headroom for worst-case scenes. The fix was invisible to the player but critical for handheld shipping. The hardware chose a lower clock because the workload no longer required maximum clock to meet the frame budget.

---

## References

| File | Contents | Read when... |
|---|---|---|
| `references/gpu-profiling.md` | Fill-rate, bandwidth, shader complexity, vertex, fixed overhead — mechanism, confirmation test, levers, common culprits | Step 3 identifies a GPU bottleneck |
| `references/cpu-profiling.md` | Frame budget anatomy, script/logic, physics, GC pressure, cache inefficiency, hitching | Step 4 identifies a CPU bottleneck, or Step 5 identifies hitches |
| `references/memory-profiling.md` | Budget planning, VRAM vs system RAM, streaming strategies, allocation patterns, finding what's eating memory | VRAM or RAM is near capacity, or you suspect a memory leak |
| `references/thermal-power.md` | Power model, thermal throttling, battery optimization, adaptive quality, headroom philosophy | Game degrades over time, battery drains fast, or utilization is high despite meeting FPS target |

---

## Relationship to Other Skills

**game-patterns** — Architectural patterns that *prevent* performance problems: Object Pool (eliminate GC pressure), Data Locality (fix cache misses), Spatial Partition (reduce O(n²) queries), Dirty Flag (avoid redundant recomputation). Use game-patterns when you've identified the bottleneck category and need the implementation pattern. Use this skill to identify the bottleneck first.

**godot / love2d** — Engine-specific profiling tools and their configuration. This skill is engine-agnostic; your engine skill handles how to open the profiler, what the columns mean, and engine-specific optimization APIs.

**godot-shader** — Shader authoring and optimization. When this skill identifies shader complexity as the bottleneck, godot-shader handles the implementation of simpler or more efficient shaders.

---

## Further Reading

- [Intel Gen11 Developer and Optimization Guide](https://www.intel.com/content/www/us/en/developer/articles/guide/developer-and-optimization-guide-for-intel-processor-graphics-gen11-api.html) — Deep dive into Intel integrated GPU architecture; general integrated GPU constraints apply broadly even though Steam Deck uses AMD RDNA2
- [Valve Steam Deck Recommendations](https://partner.steamgames.com/doc/steamdeck/recommendations) — Official guidance on performance targets, power profiles, and testing methodology for handheld
- [Adrian Courrèges Graphics Studies](https://www.adriancourreges.com/blog/) — Frame-by-frame dissections of AAA games showing exactly what each render pass costs and why
