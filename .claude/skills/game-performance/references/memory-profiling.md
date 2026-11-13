# Memory Profiling and Budget Planning

Memory problems manifest in two ways: running out (crashes, OS kills, out-of-memory errors) and leaking (memory grows over time until it runs out). Both require different investigations but the same diagnostic approach: measure first, then categorize.

---

## Memory Budget Planning

Before diagnosing problems, establish what your budget actually is. Memory budgets are platform-specific and non-negotiable on constrained hardware.

**Platform constraints**:

| Platform | Practical limit | Notes |
|---|---|---|
| PC (Windows) | Flexible (8–64GB typical) | Virtual memory provides headroom; VRAM is the real constraint |
| Steam Deck | ~12GB usable from 16GB shared pool | CPU and GPU share the same physical memory; no separate VRAM |
| Nintendo Switch | ~3.2GB usable from 4GB unified pool | Unified memory (no separate VRAM); OS reserves ~800MB; docked/handheld modes differ in GPU clock, not memory |
| iOS | ~800MB–1.5GB before OS kills the app | iOS uses system-wide memory pressure (jetsam) — limits are not fixed per-app; test with background apps active |
| Android | ~1–2GB before kills | Highly fragmented; test on low-end devices with background apps running |
| PS5 / Xbox Series | ~12–14GB usable | Unified memory architecture (like Steam Deck, but much larger) |

**The budget exercise**: Start with your min-spec hardware's total memory. Subtract OS overhead (~500MB–1GB). Subtract engine overhead (~200–500MB). What remains is your game's budget. Allocate it:

| Category | Typical share | Notes |
|---|---|---|
| Textures | 40–60% | The largest category by far |
| Meshes | 10–20% | Geometry data, skeletal data |
| Audio | 5–15% | Compressed audio in memory; long tracks streamed |
| Runtime (scripts, state) | 10–20% | Heap allocations, game state, UI |
| Engine overhead | 5–10% | Render targets, engine buffers |

**The test**: Load your most memory-intensive level. Check memory usage at peak (after all streaming has settled). If you're above 80% of budget, you have a problem — the remaining 20% is headroom for streaming, worst-case scenes, and OS variance.

---

## VRAM vs System RAM

Understanding which pool is under pressure determines where to look.

**Discrete GPU (desktop, laptop with dedicated GPU)**:
- VRAM: separate pool on the GPU card (4–24GB typical)
- System RAM: CPU-accessible memory
- When VRAM is full, the driver spills to system RAM over PCIe — this is extremely slow (10–100× slower than VRAM access) and causes severe performance degradation
- Diagnosis: monitor VRAM usage separately from system RAM; they're independent budgets

**Integrated / shared memory (Steam Deck, mobile, Intel integrated)**:
- GPU and CPU share the same physical memory pool
- There is no separate VRAM — every texture allocation reduces available system RAM
- The "VRAM" shown in tools is a logical reservation, not a separate physical pool
- Implication: you're managing ONE budget, not two. A 4GB texture budget on a 16GB Steam Deck leaves 12GB for everything else — including the OS, the game's system RAM, and all other processes.
- This is why texture compression matters even more on shared-memory platforms: compressed textures use less of the shared pool.

**Practical implication**: On Steam Deck, if your game uses 6GB of textures, you've consumed 37.5% of total system memory just for textures. The OS, game logic, audio, and meshes must fit in the remaining 10GB.

---

## Streaming Strategies

Streaming is how you fit more content than fits in memory at once. The goal is to keep the active set in memory while loading what's needed and evicting what's not.

**Texture streaming**:
- Load the highest-needed mip level based on screen coverage (how many pixels the texture covers)
- Evict unused mips when memory pressure increases
- The streaming budget: reserve memory for "in-flight" textures being loaded (typically 10–20% of texture budget)
- Common problem: streaming system loads too aggressively, causing memory spikes during transitions

**Level/chunk streaming**:
- Divide the world into chunks; load chunks as the player approaches
- Keep a "ring" of loaded chunks around the player; evict chunks beyond a distance threshold
- The streaming budget: how many chunks can be in memory simultaneously?
- Common problem: chunk boundaries cause hitches when many assets load simultaneously — pre-load the next chunk before the player reaches the boundary

**Audio streaming**:
- Short SFX (< 5 seconds): keep decompressed in memory for instant playback
- Long audio (music, ambient, dialogue): stream from disk, decompress on the fly
- The streaming budget: each streaming audio source needs a decode buffer (~256KB–1MB)
- Common problem: too many simultaneous streaming sources exhaust the audio streaming budget

**The streaming budget calculation**:
```
Total memory budget
  - Static resident (engine, OS, always-loaded assets)
  - Active set (current level's assets)
  = Streaming budget (available for in-flight loads and streaming buffers)
```

If the streaming budget is too small, loads stall waiting for memory to free up, causing hitches.

---

## Allocation Patterns and Problems

### Managed Languages (C#, GDScript, Lua)

**Per-frame allocation** — Creating objects in the update loop that become garbage:
- Symptom: allocation rate (bytes/frame) is non-zero in the profiler
- Diagnosis: profiler's allocation view shows which call sites allocate
- Fix: Object pooling, cached collections, value types (see `references/cpu-profiling.md § GC Pressure`)

**GC heap growth** — The heap keeps growing because live object count increases:
- Symptom: memory usage increases monotonically over a play session; GC collections become more frequent and longer
- This is a memory leak equivalent in managed languages — objects are being retained when they shouldn't be
- Common cause: event listeners not disconnected (the listener holds a reference to the object, preventing collection), caches that grow without bounds, static collections that accumulate entries
- Diagnosis: take a heap snapshot at minute 1 and minute 30; compare live object counts by type; the type that grew is the leak

**Unbounded caches** — A cache that grows without eviction:
- Symptom: memory grows slowly and steadily; no obvious leak in object counts
- Common cause: `Dictionary<string, T>` used as a cache with no eviction policy; every unique key adds an entry forever
- Fix: add a maximum size and an eviction policy (LRU, time-based expiry)

### Native Languages (C++, Rust)

**Heap fragmentation** — Many small alloc/free cycles fragment the heap:
- Symptom: total free memory is sufficient, but allocations fail or are slow; memory usage is higher than expected
- Cause: alternating alloc/free of different-sized objects leaves "holes" in the heap that can't be used for larger allocations
- Fix: pool allocators (fixed-size pools don't fragment), arena allocators (allocate from a contiguous block, free the whole block at once)

**Pool exhaustion** — Pre-allocated pool runs out:
- Symptom: objects stop spawning, or the game crashes with an assertion
- Cause: pool size was set too small for worst-case scenarios
- Fix: increase pool size; add graceful handling for pool exhaustion (log and drop, not crash); monitor pool utilization in development

**Monitoring allocation rate over time**: In development builds, log total allocated memory every 30 seconds. A graph that trends upward is a leak. A graph that plateaus is healthy. A graph that spikes and drops is streaming working correctly.

---

## Finding What's Eating Memory

When memory is over budget, the investigation is: what's largest, what's duplicated, what's unused?

**Step 1: Sort by category**

Most memory profilers can show usage by asset type. The breakdown is almost always:
1. Textures (largest, by far)
2. Audio
3. Meshes
4. Runtime heap

Start with textures. They're the biggest lever and the most common problem.

**Step 2: Check for duplicates**

The same asset loaded multiple times under different paths is a common problem:
- `textures/hero.png` and `assets/characters/hero.png` pointing to the same file
- An asset loaded by two different systems that don't share a cache
- Texture atlases that contain textures also loaded individually

Most asset management systems have a "find duplicates" tool. If yours doesn't, sort assets by file size and look for identical sizes — likely duplicates.

**Step 3: Check for unused assets**

Assets loaded but never rendered:
- Leftover from cut content that was removed from the game but not from the asset loading list
- Assets loaded eagerly at startup "just in case" but never actually used in the current level
- Streaming system loading assets that are out of range

Diagnosis: enable asset tracking (log every asset load and every asset use). After a play session, compare loaded vs used. Anything loaded but never used is a candidate for removal or lazy loading.

**Step 4: Check resolution**

Do all textures need to be at their current resolution?
- A 4096×4096 texture for a UI icon that's displayed at 64×64 pixels wastes 4096× the memory
- A 2048×2048 texture for a distant background object that covers 200 screen pixels is wasteful
- Rule of thumb: texture resolution should roughly match the maximum screen coverage of the object

**Step 5: Timeline analysis**

When does memory peak?
- **At level load, then drops**: Streaming is working correctly — assets load, then unused ones are evicted
- **At level load, stays high**: Assets are loaded but not evicted; streaming eviction isn't working
- **Grows continuously during play**: Memory leak — objects are being retained
- **Spikes at specific moments**: Bulk loading (entering a new area, spawning a boss) — stagger the loads

**Memory profiling workflow**:
```
1. Start the game, note baseline memory
2. Load the most memory-intensive level
3. Wait for streaming to settle (30–60 seconds)
4. Note peak memory
5. Play for 10 minutes
6. Note memory after play
7. If (memory after play) > (memory after load): potential leak
8. Take heap snapshots at load and after play; compare live object counts
```
