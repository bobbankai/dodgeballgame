# ECS Architecture Patterns

Full Entity Component System architecture — entities as IDs, components as data, systems as behavior. Distinct from the simpler Component pattern (see `decoupling.md`).

*Synthesized from GDC talks on ECS architecture and data-driven game design; also draws on Nystrom's* Game Programming Patterns *(gameprogrammingpatterns.com).*

---

## ECS Architecture

**Intent**: Structure game objects as pure IDs, attach typed data bags (components) to them, and process all components of a given type in bulk via systems. Achieves both domain separation and cache-friendly performance.

**Problem**: Monolithic entity classes accumulate every domain (AI, physics, animation, audio) into one object. Two failure modes:
1. **Complexity**: 10,000–20,000-line game object classes where every programmer must understand every domain.
2. **Performance**: Iterating entities to update one domain (e.g., physics) skips over all other domain data in memory, causing cache misses that can drop a 60fps game to 1fps.

**Solution**: Three-part architecture:

| Part | Role | Example |
|---|---|---|
| **Entity** | A bare integer ID — no data, no behavior | `EntityId player = 42;` |
| **Component** | Plain data struct tagged to an entity ID | `Position{x, y}`, `Health{current, max}` |
| **System** | Queries entities with specific components and applies logic | `PhysicsSystem` updates all `Position` + `Velocity` pairs |

```cpp
// Components: pure data, no methods
struct Position  { float x, y; };
struct Velocity  { float dx, dy; };
struct Health    { int current, max; };
struct Renderable{ SpriteId sprite; };

// System: queries for entities with both Position and Velocity
class PhysicsSystem {
public:
    void update(World& world, float dt) {
        // Query returns only entities that have BOTH components
        for (auto [pos, vel] : world.query<Position, Velocity>()) {
            pos.x += vel.dx * dt;
            pos.y += vel.dy * dt;
        }
        // Entities with Position but no Velocity (e.g., static walls) are skipped
    }
};

// Entity construction: compose from components
EntityId goblin = world.createEntity();
world.add<Position>(goblin,   {10, 5});
world.add<Velocity>(goblin,   {0, 0});
world.add<Health>(goblin,     {30, 30});
world.add<Renderable>(goblin, {SPRITE_GOBLIN});

// A flying goblin: same components, add Wings
world.add<Wings>(goblin, {3.0f});
```

**Key insight**: Systems query for entities that have *all required components*, then iterate only that result set. This is what makes ECS cache-friendly — no skipping over unrelated data, and no processing entities that lack a required component.

**Trade-offs**:
- High framework complexity — requires an ECS library or significant custom infrastructure.
- System ordering creates implicit dependencies; must be declared and enforced.
- Debugging emergent behavior is harder than tracing explicit method calls.
- For most games, the Component pattern (see `decoupling.md`) is simpler and sufficient.

**Game applications**: Caves of Qud (317+ monster types composed from capability components), Dwarf Fortress (emergent interactions from composable entity properties), Unity DOTS particle systems (100,000+ particles updated per frame), RTS unit simulation (large homogeneous unit populations).

**Engine note**: Bevy ECS and Unity DOTS implement full ECS natively — use their built-in query/system APIs directly. Classic Unity (MonoBehaviour) and Godot (node tree) implement the Component pattern, not full ECS. EnTT and flecs are popular C++ ECS libraries for custom engines.

---

## How ECS Enables Emergence

Composable components create entity behaviors that weren't explicitly designed. When a designer adds a `Flammable` component to a `Wooden Door`, the fire system automatically applies — no code change needed. Unexpected combinations (a `Poisoned` + `Explosive` barrel) arise from component intersection, not from a programmer anticipating every case.

**Caves of Qud example**: Items in the game are composed of capability components — `MeleeAttack`, `RangedAttack`, `Defense`, `Consumable`, `Activatable`. A "shield that bashes" is just an item with both `Defense` and `MeleeAttack` components. The combination is free; no `ShieldBash` subclass required.

This is the core design payoff: **content breadth scales with data, not with code**. A roguelike with 317 monster types doesn't need 317 classes — it needs a rich component vocabulary and data files that compose them.

**Caveat**: Emergence cuts both ways. Unintended component combinations also produce valid (but possibly wrong) behaviors. Use system filters or required co-component constraints to limit which entities a system processes.

---

## Data-Driven Entity Construction

ECS pairs naturally with external data files. Entity definitions live in JSON/YAML; the game reads them and assembles components at runtime.

```json
{
  "goblin_archer": {
    "components": [
      { "type": "Health",      "current": 20, "max": 20 },
      { "type": "MeleeAttack", "damage": 4 },
      { "type": "RangedAttack","damage": 6, "range": 8 },
      { "type": "Renderable",  "sprite": "goblin_archer" }
    ]
  }
}
```

**Designer impact**: New entity types require no programmer involvement. A designer adds a component to a data file; the system picks it up automatically. This is the primary reason content-heavy games (roguelikes, RPGs) adopt ECS — it decouples content creation from engineering cycles.

**Security note for moddable games**: When loading entity definitions from untrusted sources (mods, user content), validate component type names against a whitelist registry and clamp numeric fields to game-defined bounds. An unvalidated component name could reference internal-only systems; unbounded numeric values could break balance or crash systems.

---

## ECS vs. Component Pattern

| | Component Pattern | Full ECS |
|---|---|---|
| **Entity** | Object with component fields | Integer ID only |
| **Components** | Objects with data + methods | Plain data structs |
| **Behavior** | Component's own `update()` | Separate system classes |
| **Game loop** | Entity calls `component.update()` | System queries + iterates component sets |
| **Cache behavior** | Mixed (depends on layout) | Cache-friendly by design |
| **Complexity** | Low — easy to add to any engine | High — requires ECS framework |
| **Best for** | Most games | Performance-critical or content-heavy games |

The Component pattern (see `decoupling.md`) is the right default. Full ECS is the right choice when you need cache-friendly bulk processing AND data-driven composition at scale — not just one or the other.

---

## When to Use Full ECS

**Use full ECS when:**
- You have profiled and confirmed cache misses as a bottleneck in entity update loops
- Content breadth is large (100+ entity types) AND designers need to iterate without code changes AND your engine doesn't already provide a component model
- You want emergent gameplay from component combinations as a design goal
- You're building a moddable game where external content must compose safely

**Use Component pattern instead when:**
- Your game has <500 entities and no measurable cache pressure
- Your engine already provides a component model (Godot, classic Unity) — use it directly
- You're building a roguelike, puzzle game, or turn-based game — the performance case for ECS rarely applies; the composition case may apply, but Type Object + data files often suffices

**Nystrom's direct advice** (from the GDC talk): For roguelikes, the classic domain-split ECS "is not super helpful." The performance argument requires cache misses to be your actual bottleneck. Use components to split along *capabilities* (what an entity can do), not domains (physics/rendering/AI) — the capability split gives you composition without the ECS framework overhead.

---

## Anti-Patterns

**Over-engineering for simple games**: ECS frameworks (Bevy, Unity DOTS, EnTT) carry real complexity. If your game has 50 entity types and runs at 60fps without ECS, you don't need it. "I hear good things about C-sections — can I have one?" (Nystrom's analogy: the surgery is for a specific problem, not a general improvement.)

**Splitting along domains when capabilities are lopsided**: A roguelike's "physics component" is trivial; its "AI component" is enormous. Domain-split ECS just moves the complexity into one fat component. Split along capabilities instead.

**Treating ECS as an organizational tool**: ECS solves performance (cache locality) and content scale (data-driven composition). It does not inherently make code easier to read or reason about. If you're adopting ECS for "cleaner architecture" without those specific needs, you're adding complexity without payoff.

**Forgetting system ordering**: Systems that share components have implicit ordering dependencies. `PhysicsSystem` must run before `RenderSystem` or you render stale positions. In single-threaded ECS, enforce order via registration sequence. In parallel ECS (Bevy, Unity DOTS), declare explicit read/write component dependencies — the scheduler uses these to prevent data races, not just ordering violations.

---

## Pattern Combinations

| Combination | Use case |
|---|---|
| **ECS + Data Locality** | The canonical pairing — component arrays enable SoA layout; systems iterate them cache-efficiently |
| **ECS + Prototype/Factory** | Data files define entity archetypes; Factory reads them and assembles components at spawn time |
| **ECS + Type Object** | Type Object defines shared stats for a monster breed; ECS components hold per-instance state |
| **ECS + Event Queue** | Systems communicate via events rather than direct component reads, avoiding cross-system coupling |
