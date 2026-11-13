# Optimization Patterns

Patterns for improving performance through memory layout, lazy computation, object reuse, and spatial organization.

---

## Data Locality

**Intent**: Organize data in memory to maximize CPU cache utilization, reducing cache misses in hot loops.

**Problem**: A game loop that calls `update()` on 10,000 entities via virtual dispatch jumps to a different memory location for each entity's vtable and data. The CPU's cache is constantly evicted. The game spends more time waiting for memory than computing.

**Problem illustration**:
```
// Array of Structs (AoS) — cache-unfriendly for bulk operations
struct Particle {
    Vector3 position;   // 12 bytes
    Vector3 velocity;   // 12 bytes
    float   lifetime;   //  4 bytes
    Color   color;      //  4 bytes
    // ... more fields
};
Particle particles[10000];

// Updating positions reads every particle's full struct into cache,
// but only uses position and velocity — wasted cache lines.
```

**Solution**: Struct of Arrays (SoA) — separate arrays per field. The update loop accesses only the data it needs, sequentially.

```cpp
// Struct of Arrays (SoA) — cache-friendly for bulk operations
struct ParticleSystem {
    Vector3 positions[MAX];   // all positions contiguous
    Vector3 velocities[MAX];  // all velocities contiguous
    float   lifetimes[MAX];
    Color   colors[MAX];
    int     count = 0;

    void update(float dt) {
        // This loop reads positions[] and velocities[] sequentially —
        // both fit in cache. Colors[] and lifetimes[] aren't touched.
        for (int i = 0; i < count; i++) {
            positions[i] += velocities[i] * dt;
        }
    }

    void updateLifetimes(float dt) {
        for (int i = 0; i < count; i++) {
            lifetimes[i] -= dt;
        }
        // Remove dead particles: swap with last, decrement count
        for (int i = count - 1; i >= 0; i--) {
            if (lifetimes[i] <= 0) {
                positions[i]  = positions[--count];
                velocities[i] = velocities[count];
                lifetimes[i]  = lifetimes[count];
                colors[i]     = colors[count];
            }
        }
    }
};
```

**Hot/cold splitting**: Even within AoS, split rarely-accessed fields into a separate "cold" array:
```cpp
struct Entity {
    // Hot data — accessed every frame
    Vector3 position;
    Vector3 velocity;
};
struct EntityDebugInfo {
    // Cold data — accessed only in debug/editor
    char    name[64];
    int     spawnFrame;
};
Entity     entities[MAX];      // hot — fits in cache
EntityDebugInfo debug[MAX];    // cold — never evicted during gameplay
```

**Trade-offs**:
- SoA is less ergonomic — you can't pass a single "particle" around; you pass an index.
- Premature optimization: profile first. AoS is fine for small counts or infrequent updates.
- Pointer-heavy structures (linked lists, trees) defeat cache optimization — prefer arrays.
- **Scale indicator**: Measurable gains typically start at 10,000+ entities in a tight per-frame loop. Below that, AoS is fine. Profile with your engine's profiler before restructuring — the cost of SoA's reduced readability must be justified by measured cache miss reduction.

**Game applications**: Particle systems, physics bodies, AI agents, any system with thousands of objects updated every frame.

**Engine note**: Unity DOTS/ECS and Bevy ECS enforce SoA automatically — components of the same type are stored contiguously. In Godot and traditional Unity, you're in AoS territory; be aware of cache effects in hot loops.

---

## Dirty Flag

**Intent**: Avoid recomputing derived data every frame by tracking whether the source data has changed; recompute only when needed and only when the result is actually used.

**Problem**: Computing a world transform requires multiplying local transforms up the entire scene hierarchy. With 1,000 nodes, recomputing all transforms every frame is wasteful — most objects don't move most frames.

**Solution**: Each node has a `dirty` flag. When local transform changes, mark the node (and all descendants) dirty. When world transform is requested, recompute only if dirty, then clear the flag.

```cpp
class Transform {
    Matrix4 local;
    Matrix4 world;
    bool    dirty = true;
    Transform* parent = nullptr;
    std::vector<Transform*> children;
public:
    void setLocal(const Matrix4& m) {
        local = m;
        markDirty();
    }

    const Matrix4& getWorld() {
        if (dirty) {
            if (parent) world = parent->getWorld() * local;
            else        world = local;
            dirty = false;
        }
        return world;
    }
private:
    void markDirty() {
        if (dirty) return;  // already dirty, children already marked
        dirty = true;
        for (auto* child : children) child->markDirty();
    }
};
```

**Two-phase variant**: Separate the "mark dirty" pass from the "recompute" pass. Mark during update; recompute in bulk before rendering. This avoids redundant recomputation when a node is dirtied multiple times per frame.

**Trade-offs**:
- Adds a flag per object and logic to propagate dirty marks.
- If derived data is needed every frame anyway, the flag adds overhead without benefit.
- Dirty propagation can cascade — marking a root dirty marks the entire subtree.
- Watch for "always dirty" bugs where the flag is set but never cleared.
- **Scale indicator**: Worthwhile when recomputation takes >0.5ms AND the source data changes on fewer than half of frames. If the data changes every frame, the flag overhead is pure cost.

**Game applications**: Scene graph world transforms, pathfinding caches (recompute path only when obstacles change), UI layout (recompute only when content changes), shadow maps (recompute only when lights/geometry move), minimap rendering.

**Engine note**: Godot's `CanvasItem` and `Node3D` use dirty flags internally for transform propagation. Unity's `Transform` component does the same. You'll implement this pattern for custom derived data (e.g., cached pathfinding results, computed stats).

---

## Object Pool

**Intent**: Pre-allocate a fixed collection of objects; "allocate" by marking one active, "free" by marking it inactive — eliminating heap allocation overhead for short-lived objects.

**Problem**: Bullets, particles, and audio sources are created and destroyed hundreds of times per second. `new`/`delete` is slow, fragments the heap, and can cause GC pauses. On consoles, heap fragmentation can prevent certification.

**Solution**: Allocate all objects upfront in a fixed array. Track which are active. "Allocation" is O(1) — find a free slot and mark it active. "Deallocation" is O(1) — mark it inactive.

```cpp
class Particle {
public:
    bool  inUse = false;
    float x, y;
    float vx, vy;
    float lifetime;

    void init(float x, float y, float vx, float vy, float life) {
        inUse = true;
        this->x = x; this->y = y;
        this->vx = vx; this->vy = vy;
        this->lifetime = life;
    }

    void update(float dt) {
        x += vx * dt;
        y += vy * dt;
        lifetime -= dt;
        if (lifetime <= 0) inUse = false;  // "free" it
    }
};

class ParticlePool {
    static const int MAX = 1000;
    Particle pool[MAX];
public:
    Particle* create(float x, float y, float vx, float vy, float life) {
        for (int i = 0; i < MAX; i++) {
            if (!pool[i].inUse) {
                pool[i].init(x, y, vx, vy, life);
                return &pool[i];
            }
        }
        return nullptr;  // pool exhausted — drop silently or log
    }

    void updateAll(float dt) {
        for (int i = 0; i < MAX; i++) {
            if (pool[i].inUse) pool[i].update(dt);
        }
    }
};
```

**Free list optimization**: Instead of scanning for a free slot, maintain a linked list of free objects using the objects' own memory (union the `next` pointer with object data). O(1) allocation and deallocation.

```cpp
union PoolSlot {
    Particle particle;
    PoolSlot* nextFree;
};
```

**Trade-offs**:
- Fixed size — pool exhaustion must be handled gracefully (drop, log, or assert).
- Objects must be fully re-initialized on reuse — stale state from previous use causes bugs.
- Pool size must be tuned: too small drops objects, too large wastes memory.
- Scanning for free slots is O(n) — use a free list for high-frequency allocation.
- **Scale indicator**: Beneficial when allocating/freeing 100+ objects per second, or on platforms where GC pauses are unacceptable. For <50 objects with low allocation frequency, `new`/`delete` (or engine instantiation) is fine.

**Game applications**: Bullets, particles, explosions, audio sources, network packets, UI notifications, any object with high allocation frequency and short lifetime.

**Engine note**: Godot's `MultiMesh` and `CPUParticles2D` use pools internally. Unity's `ObjectPool<T>` (UnityEngine.Pool) is a built-in pool. Love2d: implement manually or use a library. For audio, most engines pool audio sources — don't create/destroy them per sound.

---

## Spatial Partition

**Intent**: Divide space into a data structure that lets you quickly find objects near a point without checking every object.

**Problem**: Collision detection between N objects requires O(N²) pair checks. With 1,000 objects, that's 500,000 checks per frame. Range queries ("find all enemies within 50 units") have the same problem.

**Solution**: Organize objects by position in a spatial data structure. Queries check only the relevant region.

**Fixed grid** (simplest, best for uniformly distributed objects):
```cpp
class Grid {
    static const int CELL_SIZE = 64;
    static const int COLS = WORLD_WIDTH  / CELL_SIZE;
    static const int ROWS = WORLD_HEIGHT / CELL_SIZE;

    std::vector<Entity*> cells[COLS][ROWS];
public:
    void add(Entity* e) {
        int col = (int)(e->x / CELL_SIZE);
        int row = (int)(e->y / CELL_SIZE);
        cells[col][row].push_back(e);
    }

    void remove(Entity* e) {
        int col = (int)(e->x / CELL_SIZE);
        int row = (int)(e->y / CELL_SIZE);
        auto& cell = cells[col][row];
        cell.erase(std::find(cell.begin(), cell.end(), e));
    }

    // Find candidates near a point within radius
    void query(float x, float y, float radius,
               std::vector<Entity*>& results) {
        int minCol = std::max(0, (int)((x - radius) / CELL_SIZE));
        int maxCol = std::min(COLS-1, (int)((x + radius) / CELL_SIZE));
        int minRow = std::max(0, (int)((y - radius) / CELL_SIZE));
        int maxRow = std::min(ROWS-1, (int)((y + radius) / CELL_SIZE));
        for (int c = minCol; c <= maxCol; c++)
            for (int r = minRow; r <= maxRow; r++)
                for (auto* e : cells[c][r])
                    results.push_back(e);
        // Caller does precise distance check on candidates
    }
};
```

**Choosing a structure**:

| Structure | Best for | Notes |
|---|---|---|
| Fixed grid | Uniformly distributed, frequently moving objects | Simple, fast update, poor for sparse/clustered |
| Quadtree | Non-uniform distribution, static or slow-moving | Good for 2D, handles clustering, complex update |
| Octree | 3D, non-uniform | 3D equivalent of quadtree |
| BSP tree | Static geometry (level collision) | Build once, query fast; poor for moving objects |
| k-d tree | Nearest-neighbor queries, static points | Rebuild is expensive; use for static data |
| BVH | Dynamic 3D objects (physics engines) | Incremental update, good for varying sizes |

**Trade-offs**:
- Objects that span multiple cells must be in all relevant cells, or use a "fat" bounding box.
- Moving objects must be removed and re-inserted when they cross cell boundaries.
- Cell size tuning: too small → many empty cells, high overhead; too large → too many objects per cell, queries slow.
- Don't implement from scratch for physics — use the engine's built-in broadphase.
- **Scale indicator**: The naive O(n²) approach is fine for <50 objects. At 100+ objects with frequent proximity queries, a spatial partition pays for itself. At 1000+, it's essential.

**Game applications**: Collision broadphase, AI range queries ("find nearest enemy"), fog of war, audio occlusion, pathfinding node lookup, level streaming.

**Engine note**: Godot's `Area2D`/`Area3D` and physics layers handle spatial queries. Unity's `Physics.OverlapSphere`, `Physics2D.OverlapCircle`. Box2D and Bullet have built-in broadphase. Implement your own only for non-physics spatial queries (e.g., AI range checks, audio).
