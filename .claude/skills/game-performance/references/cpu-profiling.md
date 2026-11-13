# CPU Bottleneck Classification

When Step 4 of the diagnostic tree identifies a CPU bottleneck, use this reference to classify the specific subsystem and apply targeted fixes. Also covers hitching (Step 5).

---

## Frame Budget Anatomy

A frame's CPU time splits across multiple subsystems. Understanding the split tells you where to look.

**Typical frame breakdown** (varies by game type):

| Subsystem | Typical share | Notes |
|---|---|---|
| Script / game logic | 20–40% | AI, pathfinding, custom systems, UI |
| Physics | 10–30% | Collision detection, solver, rigidbody integration |
| Animation | 5–15% | Skeleton evaluation, blend trees, IK |
| Render thread submission | 10–30% | Building draw calls, uploading uniforms, state changes |
| Audio | 2–10% | Mixing, streaming, DSP effects |
| GC / memory | 0–30% | Managed language garbage collection (spiky) |

**The waterfall model**: The CPU prepares work for the GPU. If the CPU takes too long, the GPU starves — it finishes its previous frame's work and sits idle waiting for the next batch. This is submission-bound behavior and shows up as high CPU utilization with GPU "bubbles."

**Main thread vs render thread**: Some engines (Unity, Godot 4) split rendering submission to a separate render thread. If your engine does this, the bottleneck could be on the render thread (submission overhead) rather than the main thread (game logic). Check which thread is at 100%.

**Diagnosis workflow**:
1. Open the profiler
2. Find the frame's longest bar
3. Expand it to find the subsystem
4. Expand that subsystem to find the specific function
5. That function is your target

---

## Script / Logic Bound

**Mechanism**: Game logic (AI, pathfinding, UI, custom systems) consuming too much of the frame budget. This is the most common CPU bottleneck in indie games — custom code running in the hot loop without profiling.

**Confirm**: Disable systems one by one; observe frame time reduction per system. The system that, when disabled, drops frame time the most is the bottleneck.

**Levers**:
- **Amortize over multiple frames**: Not everything needs to run every frame. AI decision-making can run every 100ms (6 frames at 60fps) with no visible difference. Pathfinding can run every 200ms. Spread expensive work across frames using a time-sliced scheduler.
- **Reduce update frequency for distant/invisible entities**: Entities far from the camera or off-screen don't need full-fidelity updates. Reduce update rate or disable entirely based on distance/visibility.
- **Spatial partitioning for queries**: "Find all enemies within 50 units" is O(n) without spatial partitioning, O(log n) with a grid or quadtree. See game-patterns (Spatial Partition).
- **Simpler algorithms**: O(n²) collision checks, O(n log n) sorts in hot loops, deep recursive calls — profile reveals these. Replace with appropriate data structures.
- **Cache results**: If a computation's inputs haven't changed, don't recompute. See game-patterns (Dirty Flag).

**Common culprits**:
- O(n²) collision or proximity checks without spatial partitioning (every entity checks every other entity)
- Pathfinding for all entities every frame (A* is expensive; run it infrequently and cache the path)
- UI layout recalculation every frame (recalculate only when content changes)
- Serialization or JSON parsing in the hot loop (parse once at load, not per frame)
- String operations in the hot loop (concatenation, formatting, comparison) — especially expensive in managed languages

---

## Physics Bound

**Mechanism**: The physics simulation step (collision detection, constraint solving, rigidbody integration) taking too long. Physics is typically run on a fixed timestep, so the cost is predictable but can be high with many active bodies.

**Confirm**: In the profiler, identify the physics simulation step as a named block (e.g., `PhysicsServer`, `PhysicsProcess`, `FixedUpdate`). If that block alone accounts for the majority of frame time, physics is the bottleneck. Alternatively, set physics body count to zero while keeping all other entities active — if frame time drops proportionally to the physics share shown in the profiler, physics is confirmed. Avoid using total entity count reduction as the test, since it also reduces AI, animation, and render submission work.

**Levers**:
- **Simplified collision shapes**: Mesh colliders are expensive — they require triangle-level collision detection. Replace with primitive shapes (box, sphere, capsule, convex hull). A character with a capsule collider is 10–100× cheaper than a mesh collider.
- **Physics LOD**: Disable physics for distant or off-screen objects. A rigidbody 500 units away doesn't need to simulate.
- **Sleep bodies not in motion**: Most physics engines support sleeping — bodies that haven't moved above a threshold stop simulating. Ensure your objects are allowed to sleep (don't apply tiny forces every frame that prevent sleeping).
- **Fixed timestep tuning**: A physics timestep of 1/120 runs the simulation twice per frame at 60fps. If your game doesn't need sub-frame physics accuracy, 1/60 or even 1/30 may be sufficient.
- **Reduce solver iterations**: Physics solvers iterate to converge on a solution. Fewer iterations = less accurate but faster. For casual games, 2–4 iterations is often sufficient; default is often 8–10.
- **Layer-based collision filtering**: Don't check collisions between layers that can never interact (e.g., enemies vs. enemies if they can't collide with each other). Most engines support collision layer matrices.

**Common culprits**:
- Mesh colliders on everything, including static level geometry (use convex decomposition or primitive shapes)
- Too many active rigidbodies (hundreds of small physics objects all simulating simultaneously)
- Physics timestep too small relative to game needs (1/120 when 1/60 would suffice)
- Joints and constraints between many bodies (ragdolls, cloth, chains) — each constraint adds solver cost
- Trigger volumes checking against all physics bodies (use layer filtering)

---

## GC Pressure (Managed Languages)

**Mechanism**: Managed runtimes can cause allocation-related performance problems, but the mechanism differs by language:
- **C# (Unity, Godot Mono)**: Uses a tracing GC that can cause stop-the-world pauses. Per-frame allocations accumulate pressure; when the GC threshold is crossed, a collection pause causes a visible frame spike (5–50ms).
- **Lua**: Uses an incremental GC that interleaves collection steps with program execution. Pauses are smaller and distributed, but high allocation rates still cause measurable overhead.
- **GDScript (Godot native)**: Uses reference counting as the primary memory management strategy. No traditional GC pauses, but cycle collection for reference cycles can cause small hitches. The main cost is the per-allocation/deallocation overhead, not collection pauses.

The mitigation — reducing per-frame allocations — applies to all three. The hitching pattern (periodic 5–50ms spikes) is most pronounced in C#.

**Confirm** (language-specific):
- **C#**: GC collection events visible in profiler timeline, correlating with frame time spikes. Allocation rate (bytes/frame) is high in the profiler's memory view.
- **GDScript**: No GC collection events exist — look for high allocation rate in the memory profiler view instead. Per-frame `Array`/`Dictionary` creation causes measurable overhead visible as elevated frame time in `_process`.
- **Lua**: Look for incremental GC steps distributed across frames. Total GC time per second is the relevant metric, not individual spike events.

**Levers**:
- **Object pooling**: Pre-allocate objects and reuse them instead of allocating/freeing. The single most effective lever. See game-patterns (Object Pool). Apply to: bullets, particles, audio sources, UI elements, any frequently spawned/despawned object.
- **Avoid per-frame allocations**: Audit the hot loop for allocations. Common sources:
  - Collections created in update methods (`new List<T>()` every frame) — cache and clear instead
  - String concatenation (`"Score: " + score`) — use `StringBuilder` or format strings
  - LINQ/functional chains — each operator creates an intermediate collection
  - Closures/lambdas capturing variables — may allocate a closure object
  - Boxing value types (passing `int` where `object` is expected)
- **Value types over reference types**: Structs (C#) and value types don't allocate on the heap. Use them for small, frequently created data (vectors, colors, hit results).
- **Pre-allocate capacity**: When you must use collections, pre-allocate capacity to avoid resize allocations: `new List<T>(expectedCapacity)`.
- **Incremental GC**: Some engines/runtimes support incremental GC (Godot 4, Unity with incremental GC enabled) — the collection is spread across multiple frames, eliminating single-frame spikes at the cost of slightly higher average overhead.

**Common culprits** (language-specific):

*C# (Unity, Godot Mono)*:
- `GetComponent<T>()` called every frame (cache the reference in `Start`/`_Ready`)
- `new Vector3()` in hot paths (Vector3 is a struct in C# — this is fine, but `new List<Vector3>()` is not)
- LINQ in update loops (`enemies.Where(e => e.IsAlive).ToList()` allocates every frame)
- `string.Format` or string interpolation in hot paths

*GDScript (Godot)*:
- Array/Dictionary creation in `_process` (`var result = []` every frame)
- `get_node()` called every frame (cache in `_ready`)
- Signal connections created/disconnected frequently

*Lua (Love2D, custom)*:
- Table creation in hot loops (`{}` syntax allocates a new table)
- String concatenation with `..` operator
- Closures created in hot paths

---

## Cache Inefficiency (Native Languages)

**Mechanism**: Data accessed in random memory order causes constant CPU cache misses. An L1 cache hit costs ~4 cycles; an L1 miss to L2 costs ~12 cycles; an L2 miss to L3 costs ~40 cycles; an L3 miss to DRAM costs ~200–300 cycles. In a hot loop with poor data locality, most misses go all the way to DRAM. In a loop processing 10,000 entities, the difference between cache-friendly and cache-hostile access patterns can be 10–50× in performance.

This is the primary performance problem in native-language (C++, Rust) game code that has already been algorithmically optimized.

**Confirm**: Hardware performance counters (available in Intel VTune, AMD uProf, Instruments on macOS) show high L1/L2 cache miss rate in hot functions. Or: the function appears fast in isolation but slow in the profiler when running with the full game state (cache pollution from other systems).

**Levers**:
- **Data-oriented design (SoA)**: Struct-of-Arrays instead of Array-of-Structs. If your update loop only reads position and velocity, store all positions in one array and all velocities in another. The loop reads sequentially through both arrays — cache-friendly. See game-patterns (Data Locality).
- **Hot/cold splitting**: Separate frequently-accessed fields (position, velocity, health) from rarely-accessed fields (name, spawn data, debug info). The hot fields fit in cache; the cold fields are never evicted during gameplay.
- **Avoid pointer chasing**: Linked lists, trees, and pointer-based data structures cause a cache miss per node traversal. Prefer flat arrays with indices.
- **Linear iteration patterns**: Iterate arrays sequentially. Random access into large arrays (e.g., looking up entity data by ID in a sparse array) causes cache misses.
- **Contiguous allocation**: Allocate related objects together. A custom allocator or pool allocator keeps objects of the same type contiguous in memory.

**Common culprits**:
- Deep inheritance hierarchies with virtual dispatch — each virtual call follows a pointer to the vtable, then a pointer to the function, then the function's data
- Linked lists of game objects (each node is a separate allocation, scattered in memory)
- Tree structures traversed every frame (scene graphs, behavior trees with many nodes)
- Random-access into large sparse arrays (entity lookup by ID when IDs are sparse)
- `std::vector<std::unique_ptr<Entity>>` — the vector is contiguous, but each entity is a separate heap allocation

---

## Hitching

**Mechanism**: Single frames taking 10–100× longer than normal, causing visible stutter. The average FPS looks fine; the frame time graph shows spikes. Hitching is distinct from sustained low FPS — it's a different problem requiring a different investigation.

**Confirm**: Frame time graph over 60+ seconds shows periodic or situational spikes. Average FPS may look acceptable; 1% low FPS reveals the problem.

### Periodic Hitches (every N seconds)

**Likely causes**:
- **GC collection**: The most common. Managed runtimes collect when the heap reaches a threshold. Collection frequency depends on allocation rate.
  - Fix: Reduce per-frame allocation rate (see GC Pressure section). Target near-zero allocation in the steady state.
- **Autosave**: Writing save data to disk on the main thread. Even fast SSDs can cause 5–20ms stalls.
  - Fix: Move disk writes to a background thread. Write to a memory buffer first; flush asynchronously.
- **Background streaming checks**: Periodic checks for which assets to stream in/out.
  - Fix: Profile the streaming system; ensure checks are O(1) or amortized.

### Situational Hitches (entering areas, spawning)

**Likely causes**:
- **Shader compilation on first use**: The GPU driver compiles shaders the first time they're used. This can cause 50–500ms stalls.
  - Fix: Pre-warm shaders during loading screens. Most engines have a shader pre-compilation API. Alternatively, use a shader cache that persists across sessions.
- **Synchronous asset loading**: Loading a texture or mesh synchronously on the main thread when it's first needed.
  - Fix: Pre-load assets during level load or in background threads. Use async loading APIs.
- **Bulk entity spawning**: Spawning 100 entities simultaneously causes 100 allocations, 100 physics body registrations, 100 render object registrations.
  - Fix: Stagger spawning over multiple frames. Pre-spawn and hide entities (pool them).
- **Physics world rebuild**: Adding many physics bodies simultaneously can trigger a broadphase rebuild.
  - Fix: Add bodies incrementally; avoid bulk additions.

### Random Hitches

**Likely causes**:
- **OS background tasks**: Antivirus scans, Windows Update, background app activity. Hard to fix; can be mitigated by setting process priority.
- **Driver issues**: GPU driver stalls, shader recompilation in the driver. Update drivers; check for known issues.
- **Thermal throttling**: If the chip is near its thermal limit, any additional load causes a clock reduction and a frame spike.
  - Fix: Reduce sustained utilization (see `references/thermal-power.md`).

**Diagnostic tool**: Record a 60-second frame time graph. Note the exact timing of spikes. Correlate with profiler events (GC, disk I/O, asset loads). The correlation is usually obvious once you're looking at the right data.
