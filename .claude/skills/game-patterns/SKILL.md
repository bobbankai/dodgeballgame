---
name: "game-patterns"
summary: "Engine-agnostic game programming patterns: ECS, state machines, event systems, pooling"
type: "design"
description: "Consult this skill when making game architecture decisions, choosing how to structure game systems, or asking which pattern fits a problem. Also trigger when designing entity/component systems, input handling, game state machines, event/messaging systems, object pooling, spatial queries, or scripting/modding support. NOT for engine-specific implementation (see godot, love2d, odin-gamedev). NOT for general software design outside game development (see software-design)."
---

# Game Programming Patterns

Engine-agnostic pattern reference for game systems. Synthesized from Nystrom's *Game Programming Patterns* (gameprogrammingpatterns.com).

**Relationship to engine skills**: This skill provides the *why* and *when*. Your engine skill (e.g., godot, love2d, odin-gamedev) provides the idiomatic *how*. When both fire, the engine skill takes precedence on implementation details — use this skill to understand which pattern to reach for, then let the engine skill guide the concrete code.

---

## Pattern Selection by Problem

### "I need to decouple things"

| Problem | Pattern | Choose when... |
|---|---|---|
| Entity behavior spans multiple domains (physics, rendering, AI) | **Component** — split into isolated domain objects | You're structuring an entity, not connecting systems |
| Need composable entities with emergent interactions AND 100+ entity types in data files, or confirmed cache-miss bottleneck in entity loops | **ECS Architecture** — entities as IDs, components as data, systems as behavior | You need data-driven content scale AND no engine component model, OR profiled cache pressure — not just organization |
| One system reacts to events in another, response needed immediately | **Observer** — subject notifies listeners synchronously | Few listeners, no performance concern in the handler |
| Systems communicate asynchronously, or events need batching/dedup | **Event Queue** — buffer events; consumers pull when ready | Observer is too synchronous, or you need cross-thread safety |
| A subsystem needs a global access point with swappable implementations | **Service Locator** — register/retrieve through a central registry | You need global access AND testability (mock services) |

**Disambiguation**: Observer vs Event Queue is the most common confusion. Use Observer when the response must happen *now* (UI updating a health bar on damage). Use Event Queue when the response can happen *later* (audio playing a sound next frame) or when you need to aggregate events (10 "footstep" events → 1 sound).

**Jonathan Blow's counterpoint**: An event queue is trivial to implement and often overrated. For scripted sequences, plain sequential code is clearer — put it on a thread if it must span frames. For "run a function when a variable changes," decide deliberately whether per-frame polling is acceptable and exactly *when* in the frame the reaction fires; code that reacts at an arbitrary time will crash in ways that are hard to reproduce.

### "I need to structure entity behavior"

| Problem | Pattern |
|---|---|
| Entity has distinct modes (idle, attacking, dead) with different behavior | **State** — FSM where each state owns its transitions and behavior |
| Many entity types share behavior but differ in data (e.g., enemy stats) | **Type Object** — define a "type" object that instances share |
| Entities need per-frame update logic without a massive switch | **Update Method** — each entity owns an `update()` called by the game loop |
| Subclasses need safe access to a large set of engine operations | **Subclass Sandbox** — base class exposes protected primitives; subclasses compose them |

### "I need to handle input or actions"

| Problem | Pattern |
|---|---|
| Input needs to be rebindable, undoable, or replayable | **Command** — encapsulate each action as an object with `execute()`/`undo()` |
| Need to drive AI and player with the same action interface | **Command** — AI emits Command objects; same executor handles both |

### "I need performance"

| Problem | Pattern | Scale indicator |
|---|---|---|
| Frequent allocation/deallocation of short-lived objects (bullets, particles) | **Object Pool** — pre-allocate; recycle instead of free | 100+ allocations/sec or GC-sensitive platforms |
| Spatial queries (collision, visibility, range checks) are too slow | **Spatial Partition** — grid, quadtree, or BSP to limit candidates | 100+ objects in query space; O(n²) becoming measurable |
| Derived data is expensive to recompute every frame | **Dirty Flag** — mark stale, recompute lazily only when needed | Recomputation takes >0.5ms AND source data changes infrequently |
| Many objects share identical data (same sprite, same mesh) | **Flyweight** — share immutable data; store only per-instance delta | 1000+ instances with shared intrinsic state |
| Cache misses are killing performance in hot loops | **Data Locality** — restructure for sequential memory access (SoA) | 10,000+ entities in a tight loop; profile confirms cache misses |

**Disambiguation**: If your game has <100 entities and no measurable performance issue, skip this section. Profile first, pattern second.

### "I need scripting or data-driven behavior"

| Problem | Pattern | Choose when... |
|---|---|---|
| Designers need to define behavior without recompiling | **Bytecode** — compile to a simple VM; interpret at runtime | You need sandboxed, hot-reloadable scripting AND your engine's built-in scripting isn't sufficient |
| Need to spawn entities from data (JSON, prefabs) | **Prototype** — clone a template object or data-driven archetype | Construction is straightforward; combine with Factory for complex construction |
| Need pluggable algorithms (pathfinding, AI behaviors) | **Strategy** — swap implementations behind a common interface | The algorithm varies at runtime or per-instance; otherwise just call the function |
| Need to add behavior to objects at runtime without subclassing | **Decorator** — wrap objects to layer on additional behavior | Effects are composable and order-dependent; for flat effects, use a list instead |
| Need a consistent way to create families of objects | **Factory** — centralize construction; decouple callers from concrete types | Construction logic is complex, varies by type, or reads from data files |

### "I need to manage time and sequencing"

| Problem | Pattern |
|---|---|
| Game must run at consistent speed across hardware | **Game Loop** — fixed-update with variable render; decouple sim from display |
| Two buffers must swap atomically (graphics, physics state) | **Double Buffer** — write to back buffer; swap at frame boundary |

---

## Core Patterns — Start Here

For indie and hobbyist games, these five patterns solve the majority of architecture problems. Reach for these first before exploring the full catalog:

| Pattern | Why it's core |
|---|---|
| **State** | Almost every game entity has modes (idle, attacking, dead). Eliminates unmanageable if/else chains. |
| **Observer** | Decouples game systems cleanly. You'll use this constantly for UI updates, achievements, audio triggers. |
| **Command** | Makes input rebindable and undoable. Essential once you need replays, AI actors, or an undo system. |
| **Component** | Your engine already uses this (Godot nodes, Unity MonoBehaviours). Understanding it prevents monolithic entity classes. |
| **Factory** | Spawning entities from data files. Every game with diverse content needs this. |

The remaining 18 patterns are situational — reach for them when you hit the specific problem they solve, not preemptively.

---

## Pattern Combinations

Patterns rarely appear alone. These are the most common compositions:

| Combination | Use case |
|---|---|
| **Command + State** | Input handling that varies by entity state. Each state returns different commands for the same inputs. |
| **Observer + Event Queue** | When Observer's synchronous notification is too rigid. Queue events for async, batched processing. |
| **Type Object + Factory** | Data-driven spawning: Factory reads a type name from JSON, looks up the Type Object, constructs the instance. |
| **Component + Update Method** | The entity system pattern. Each component has `update(dt)`, called by the game loop. Foundation of most engines. |
| **Object Pool + Flyweight** | Pool instances share a Flyweight for immutable data (sprite, stats). Pool handles lifecycle; Flyweight handles memory. |
| **State + Observer** | State machine that broadcasts state transitions. UI, audio, and animation systems observe state changes without coupling. |
| **Strategy + Component** | Swap algorithms on a per-component basis. An AI component holds a pathfinding Strategy that can change at runtime. |

When the agent recommends a pattern, consider whether a complementary pattern strengthens the design.

---

## All 23 Patterns — Quick Reference

### Design Patterns Revisited

**Command** — Encapsulates a request as an object. Enables rebindable input, undo/redo stacks, replay systems, and AI-driven actors. Reach for it whenever you need to parameterize, queue, or reverse actions. See `references/design-patterns-revisited.md`.

**Flyweight** — Shares a single copy of immutable data across many instances. Use when thousands of objects (trees, tiles, bullets) share identical intrinsic state. The shared object is stateless; per-instance data stays separate. See `references/design-patterns-revisited.md`.

**Observer** — Subject maintains a list of listeners and notifies them on events. Decouples producers (physics, gameplay) from consumers (UI, achievements, audio). Watch for the lapsed-listener problem in GC languages. See `references/design-patterns-revisited.md`.

**Prototype** — Clone an existing object to create new ones. In games, most useful as a data-driven archetype pattern: a JSON "template" object that instances copy from. Less useful as a pure OOP pattern. See `references/design-patterns-revisited.md`.

**Singleton** — Ensures one instance with global access. Widely overused in games. Prefer Service Locator or dependency injection. Use Singleton only when the single-instance constraint is a genuine invariant, not just convenience. See `references/design-patterns-revisited.md`.

**State** — Finite state machine where each state is an object that owns its behavior and transitions. Eliminates sprawling `if/switch` chains in entity update logic. Hierarchical and pushdown variants handle nested states and modal UIs. See `references/design-patterns-revisited.md`.

### Sequencing Patterns

**Double Buffer** — Maintains two buffers; one is written while the other is read. Prevents tearing in rendering and physics. **Engine note**: your engine almost certainly implements this — understand it for debugging, don't implement it from scratch. See `references/sequencing.md`.

**Game Loop** — The heartbeat of every game: process input → update → render, decoupled from hardware speed. Fixed-update with variable render is the gold standard. **Engine note**: your engine owns this loop — understand it to use `_process` vs `_physics_process` correctly. See `references/sequencing.md`.

**Update Method** — Each entity owns an `update(dt)` method called once per frame. Simple, universal, but watch for order-of-update dependencies and the cost of virtual dispatch on thousands of objects. See `references/sequencing.md`.

### Behavioral Patterns

**Bytecode** — Compiles behavior into instructions for a simple virtual machine. Use when designers need to author behavior without recompiling, or when sandboxing untrusted scripts. High implementation cost — only justified for moddable games or complex scripting needs. See `references/behavioral.md`.

**Subclass Sandbox** — Base class exposes a rich set of protected operations; subclasses implement behavior by composing them. Keeps subclasses from reaching into engine internals directly. Good for spell/ability systems with many variants. See `references/behavioral.md`.

**Type Object** — Separates "what kind of thing" from "this specific thing." A `Monster` instance holds a pointer to a `MonsterType` that defines stats, AI, and sprites. Enables data-driven entity definitions without a class per type. See `references/behavioral.md`.

### Decoupling Patterns

**Component** — Splits a monolithic entity class into isolated domain components (physics, rendering, AI, input). Each component knows its domain; the entity is a thin container. Foundation of ECS architectures. **Engine note**: Unity's `GetComponent`, Godot's node tree implement this; Bevy implements full ECS (see below). See `references/decoupling.md`. *Full ECS differs — see `references/ecs-architecture.md`.*

**Event Queue** — Decouples event producers from consumers in time, not just structure. Events are buffered; consumers process them at their own pace. Solves the "slow observer" problem and enables cross-thread communication. See `references/decoupling.md`.

**Service Locator** — A registry that maps service interfaces to concrete implementations. Provides global access without hard-coding dependencies. Better than Singleton because the implementation is swappable (useful for null/test services). See `references/decoupling.md`.

### ECS Architecture

**ECS Architecture** — Full Entity Component System: entities are bare integer IDs, components are plain data structs attached to entity IDs, and systems query and iterate component sets in bulk. Achieves cache-friendly performance (contiguous component arrays) and data-driven content scale (entity types defined in data files, no code change per new type). Use when you have profiled cache misses as a bottleneck in entity loops, OR when content breadth is large (100+ types) AND designers need to iterate without code changes AND your engine has no built-in component model. For most games, the simpler Component pattern suffices. See `references/ecs-architecture.md`.

### Optimization Patterns

**Data Locality** — Restructures data for cache-friendly sequential access. Array-of-Structs → Struct-of-Arrays. Critical in hot loops (particle updates, physics ticks). **Engine note**: ECS engines (Bevy, Unity DOTS) enforce this automatically. See `references/optimization.md`.

**Dirty Flag** — Tracks whether derived data is stale. Recomputes only when the source data has changed and the derived value is actually needed. Use for world transforms, pathfinding caches, UI layout. See `references/optimization.md`.

**Object Pool** — Pre-allocates a fixed array of objects; "allocates" by marking one active, "frees" by marking it inactive. Eliminates heap churn for short-lived objects. Essential for bullets, particles, audio sources. See `references/optimization.md`.

**Spatial Partition** — Divides space into a structure (grid, quadtree, BSP, k-d tree) to reduce collision/query candidates from O(n²) to O(n log n) or better. Choose based on object density and movement frequency. See `references/optimization.md`.

### Additional Patterns

**Factory** — Centralizes object construction. Decouples callers from concrete types; enables construction from data (string → class). Use when construction logic is complex or needs to vary. See `references/additional-patterns.md`.

**Strategy** — Swaps algorithm implementations behind a common interface. Use for pluggable AI behaviors, pathfinding algorithms, or serialization formats. Lighter than full inheritance hierarchies. See `references/additional-patterns.md`.

**Decorator** — Wraps an object to add behavior without subclassing. Use for composable item enchantments, status effects, or logging wrappers. Watch for deep wrapper chains becoming hard to debug. See `references/additional-patterns.md`.

---

## Engine-Handles-This Flags

These patterns are worth understanding conceptually, but you should not implement them from scratch when using a game engine:

- **Game Loop** — Godot: `_process`/`_physics_process`. Unity: `Update`/`FixedUpdate`. Love2d: `love.update`.
- **Double Buffer** — Handled by the renderer. Understand it to debug vsync/tearing issues.
- **Component** — Godot nodes, Unity components (MonoBehaviour). Use the engine's system; don't roll your own.
- **ECS** — Bevy ECS, Unity DOTS implement full ECS. Use their built-in query/system APIs directly.
- **Data Locality** — Unity DOTS/ECS, Bevy ECS enforce this. In other engines, be aware of cache effects in hot loops.

---

## References

| File | Contents |
|---|---|
| `references/design-patterns-revisited.md` | Command, Flyweight, Observer, Prototype, Singleton, State |
| `references/sequencing.md` | Double Buffer, Game Loop, Update Method |
| `references/behavioral.md` | Bytecode, Subclass Sandbox, Type Object |
| `references/decoupling.md` | Component, Event Queue, Service Locator |
| `references/optimization.md` | Data Locality, Dirty Flag, Object Pool, Spatial Partition |
| `references/additional-patterns.md` | Factory, Strategy, Decorator |
| `references/ecs-architecture.md` | Full ECS Architecture — Entity/Component/System, emergence, data-driven construction, when to use vs. Component pattern |
| `references/serialization-and-asset-loading.md` | Custom serialization, save formats, asset pipeline, level loading — read when serializing game data, designing save formats, or loading levels/assets |
