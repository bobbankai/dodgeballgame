# Additional Patterns

Patterns from the broader software design canon that appear frequently in game development.

---

## Factory

**Intent**: Centralize object construction logic, decoupling callers from concrete types and enabling construction from data.

**Problem**: Spawning game objects requires knowing their concrete types. When you have 50 enemy types, every spawner must `#include` every enemy header. Adding a new type requires modifying spawner code. You want to spawn enemies from a string name loaded from a data file.

**Solution**: A factory centralizes construction. Callers pass a type identifier; the factory returns the appropriate object.

**Simple factory function**:
```cpp
Entity* createEnemy(const std::string& type, Vector3 pos) {
    if (type == "goblin")    return new Goblin(pos);
    if (type == "skeleton")  return new Skeleton(pos);
    if (type == "troll")     return new Troll(pos);
    return nullptr;
}
```

**Registry-based factory** (preferred for extensibility):
```cpp
class EntityFactory {
    using Creator = std::function<Entity*(Vector3)>;
    std::unordered_map<std::string, Creator> creators;
public:
    void registerType(const std::string& name, Creator creator) {
        creators[name] = creator;
    }

    Entity* create(const std::string& name, Vector3 pos) {
        auto it = creators.find(name);
        if (it == creators.end()) return nullptr;
        return it->second(pos);
    }
};

// Registration (at startup or via static initializers):
factory.registerType("goblin",   [](Vector3 p) { return new Goblin(p); });
factory.registerType("skeleton", [](Vector3 p) { return new Skeleton(p); });

// Usage:
Entity* e = factory.create(jsonData["type"], spawnPos);
```

**Abstract Factory**: A family of related factories that produce compatible objects. Use when you need to swap entire sets of objects (e.g., different enemy tiers, different UI themes).

**Trade-offs**:
- Simple factory functions are fine for small, stable type sets.
- Registry factories enable data-driven spawning and modding but add indirection.
- Error handling: what happens when an unknown type is requested? Return null, throw, or return a "missing" placeholder.
- Factories don't solve ownership — decide whether the factory or the caller owns the returned object.

**Game applications**: Enemy/item/projectile spawning from data files, UI widget construction, level object instantiation, save/load (reconstruct objects from serialized type names), modding systems.

**Engine note**: Godot's `load()` + `instantiate()` is a factory. Unity's `Instantiate(prefab)` is a factory. Unreal's `SpawnActor<T>`. In scripting, factories are often just functions that return configured scene instances.

---

## Strategy

**Intent**: Define a family of algorithms, encapsulate each one, and make them interchangeable — letting the algorithm vary independently from the clients that use it.

**Problem**: An enemy needs different pathfinding algorithms depending on context (A* for open areas, flow fields for crowds, simple chase for short distances). Hardcoding the algorithm in the enemy class makes it impossible to swap without modifying the class.

**Solution**: Define a strategy interface. Each algorithm is a concrete strategy. The context holds a reference to the current strategy and delegates to it.

```cpp
class PathfindingStrategy {
public:
    virtual ~PathfindingStrategy() {}
    virtual Path findPath(Vector3 from, Vector3 to, const World& world) = 0;
};

class AStarPathfinding : public PathfindingStrategy {
public:
    Path findPath(Vector3 from, Vector3 to, const World& world) override {
        // A* implementation
    }
};

class FlowFieldPathfinding : public PathfindingStrategy {
public:
    Path findPath(Vector3 from, Vector3 to, const World& world) override {
        // Flow field implementation
    }
};

class Enemy {
    PathfindingStrategy* pathfinder;
public:
    Enemy(PathfindingStrategy* strategy) : pathfinder(strategy) {}

    void setStrategy(PathfindingStrategy* s) { pathfinder = s; }

    void update(const World& world) {
        Path path = pathfinder->findPath(position, target, world);
        followPath(path);
    }
};

// Swap at runtime based on context:
if (enemyCount > 50)
    enemy->setStrategy(new FlowFieldPathfinding());
else
    enemy->setStrategy(new AStarPathfinding());
```

**Functional variant** (preferred in modern languages):
```cpp
// In C++, use std::function instead of a class hierarchy:
using PathFn = std::function<Path(Vector3, Vector3, const World&)>;

class Enemy {
    PathFn pathfinder;
public:
    Enemy(PathFn fn) : pathfinder(fn) {}
    void setStrategy(PathFn fn) { pathfinder = fn; }
};

// Usage:
Enemy e([](auto from, auto to, auto& w) { return astar(from, to, w); });
```

**Relationship to Component**: Strategy is stateless (encapsulates an algorithm); Component is stateful (encapsulates a domain with data). A physics component is a Component; a sorting algorithm is a Strategy.

**Trade-offs**:
- Overkill for algorithms that never change — just call the function directly.
- Strategy objects are often stateless; consider using function pointers or lambdas instead of classes.
- If strategies need to communicate with each other or share state, consider a different pattern.

**Game applications**: Pathfinding algorithms, AI decision-making (aggressive vs. defensive), sorting/rendering strategies, input handling (keyboard vs. gamepad vs. AI), serialization formats.

**Engine note**: In Godot, passing a `Callable` achieves the same result. In Unity, delegates and `Action<T>` serve as lightweight strategies. GDScript's first-class functions make the functional variant natural.

---

## Decorator

**Intent**: Attach additional behavior to an object dynamically by wrapping it in a decorator object that implements the same interface.

**Problem**: A sword can be enchanted with fire damage, then with poison, then with a speed bonus. Modeling every combination as a subclass (`FirePoisonSpeedSword`) is combinatorially explosive. You want to compose effects at runtime.

**Solution**: Define a component interface. The base object implements it. Each decorator wraps another object implementing the same interface, adding behavior before or after delegating.

```cpp
class Weapon {
public:
    virtual ~Weapon() {}
    virtual int  getDamage() const = 0;
    virtual void onHit(Entity& target) = 0;
};

class Sword : public Weapon {
public:
    int  getDamage() const override { return 10; }
    void onHit(Entity& target) override { /* basic hit */ }
};

// Decorator base — wraps another Weapon
class WeaponDecorator : public Weapon {
protected:
    Weapon* wrapped;
public:
    WeaponDecorator(Weapon* w) : wrapped(w) {}
};

class FireEnchantment : public WeaponDecorator {
public:
    FireEnchantment(Weapon* w) : WeaponDecorator(w) {}
    int getDamage() const override { return wrapped->getDamage() + 5; }
    void onHit(Entity& target) override {
        wrapped->onHit(target);
        target.applyBurning(3.0f);  // add fire effect
    }
};

class PoisonEnchantment : public WeaponDecorator {
public:
    PoisonEnchantment(Weapon* w) : WeaponDecorator(w) {}
    int getDamage() const override { return wrapped->getDamage(); }
    void onHit(Entity& target) override {
        wrapped->onHit(target);
        target.applyPoison(10.0f);
    }
};

// Compose at runtime:
Weapon* mySword = new PoisonEnchantment(
                      new FireEnchantment(
                          new Sword()));
// getDamage() = 15, onHit() applies fire + poison
```

**Trade-offs**:
- Deep decorator chains are hard to debug — you can't easily inspect what's wrapped inside.
- Each decorator adds an indirection (virtual call). For performance-critical paths, consider a flat list of effects instead.
- Identity: `mySword` is a `PoisonEnchantment`, not a `Sword`. Type checks (`dynamic_cast`) break down.
- **Alternative for status effects**: a flat list of effect objects on the entity, each with an `apply(entity, dt)` method. Simpler, more inspectable, easier to serialize.

**Game applications**: Item enchantments, status effects (burning, poisoned, slowed), UI component composition (scrollable + bordered + shadowed panel), logging/profiling wrappers, network message transformations.

**Engine note**: In Godot, composing nodes achieves similar results without the wrapper pattern. In Unity, multiple `MonoBehaviour` components on a `GameObject` compose behavior. The flat-list-of-effects approach is often more practical than classical Decorator in game engines.

---

## Procedural Animation (IK + Raycasting)

**Intent**: Replace pre-baked walk cycles with runtime-computed limb placement. Works for any creature topology: bipeds, quadrupeds, spiders, mechs, tentacles.

**Problem**: Pre-baked animations assume fixed terrain and creature proportions. Slopes, stairs, debris, and procedurally-generated worlds break the illusion — feet float above or clip through surfaces. Scaling a creature changes its stride, but not its animation. The state space (terrain angle × creature size × gait speed) is too large to author by hand.

**Solution**: Four-step runtime algorithm:

1. **Target acquisition**: Raycast from each limb's "rest position" (relative to the body) downward — or along the creature's local gravity direction — to find terrain contact points. The raycast origin moves with the body; the result is where the foot should land. If the raycast finds no surface (gap, ledge, zero-gravity), fall back to the limb's rest pose relative to the body — never leave the IK target undefined, as an unset target produces degenerate joint angles.

2. **IK chain solving**: Given the target position, compute joint angles using Inverse Kinematics. FABRIK is the simplest solver (iterative, handles any chain length, integrates constraints naturally via position clamping); CCD is simpler to reason about per-joint but can oscillate near joint limits. The chain runs from hip/shoulder through intermediate joints to the foot/hand endpoint.

3. **Step interpolation**: When the distance between a foot's current grounded position and its target exceeds a threshold, trigger a step. Interpolate along an arc — not linearly — lifting the foot, moving it to the new target, and placing it down. Arc height scales with step distance. Never retrigger a step on a limb already mid-step — this causes oscillation. If the body moves significantly while a step is in progress, either update the arc destination mid-flight or commit to the original target and accept minor error.

4. **Gait coordination**: Prevent all limbs from stepping simultaneously. Enforce patterns: diagonal pairs for quadrupeds (trot gait; lateral pairs for walk gait), left-right alternation for bipeds, wave patterns for hexapods. Simple rule: a leg can only step if its adjacent legs are grounded. Deadlock escape: if a large body displacement leaves all legs needing to step simultaneously (e.g., after a teleport or respawn), release the constraint and step in a fixed priority order rather than freezing.

**Trade-offs**:
- Procedural animation can hit the uncanny valley when almost-but-not-quite natural. Hand-crafted animations often look better on fixed terrain.
- Raycasting every limb every frame has a CPU cost; cache results and update at reduced frequency for distant creatures.
- Blending procedural placement with authored animations (e.g., attack cycles) requires careful weight management.
- Debugging IK chains is harder than debugging keyframe data — invest in visualization tools (draw the chain, the target, the raycast hit).

**When to use**: Dynamic terrain (slopes, stairs, debris), variable creature sizes, procedural creatures, climbing systems, any situation where pre-baked animations can't cover the state space.

**When NOT to use**: Fixed-terrain games where hand-crafted animations look better (2D platformers, fighting games).

**Engine note**:
- Godot: `SkeletonIK3D` (deprecated in Godot 4.x — still functional but prefer `SkeletonModifier3D`-based solutions for new projects); raycasts via `PhysicsDirectSpaceState3D.intersect_ray()`
- Love2D: Manual 2D IK math — law of cosines solves 2-bone chains analytically; FABRIK for longer chains
- General: Any engine with raycasting and skeletal animation supports this pattern; the algorithm is engine-agnostic

**Game applications**: Rain World (slugcat and creature locomotion), Grow Home (BUD's climbing system), Spore (creature locomotion adapting to procedural body topology), Assassin's Creed series (IK foot placement on uneven terrain).

---

## Hex Grid

**When hex grids beat square grids**: Every hex has exactly 6 equidistant neighbors — no diagonal bias (square grids have 4 cardinal + 4 diagonal neighbors at √2 distance). This produces organic-looking terrain, natural frontlines, and clean flanking geometry. Common in strategy games, colony sims, and procedural map generation.

**Coordinate systems**: Pick flat-top or pointy-top orientation at project start — the two use different neighbor direction vectors and different pixel conversion matrices; mixing references silently produces wrong results.
- **Offset coordinates**: Rows/columns with alternating offsets per row. Simple to store in a 2D array; neighbor lookup varies by row parity, making math awkward.
- **Cube coordinates**: Three axes (x, y, z) constrained by x + y + z = 0. Distance = `(|dx| + |dy| + |dz|) / 2`. Clean math, one redundant axis.
- **Axial coordinates**: Drop the redundant axis from cube — store only (q, r), compute s = −q − r on demand. Best balance of storage efficiency and math clarity. **Standard recommendation.** Pixel-to-axial conversion requires cube rounding: convert to fractional cube, round all three components, then fix the component with the largest rounding delta — rounding q and r independently produces wrong results near cell boundaries.

**Pathfinding**: A* works identically to square grids for uniform-cost movement; only the neighbor enumeration changes — six neighbors instead of 4 or 8. For weighted terrain, ensure the heuristic is admissible: `hex_distance(a, b) * min_movement_cost`. If any terrain cost is < 1, scale the heuristic accordingly.

**Chunking for performance**: Large hex maps divide into screen-space rectangular chunks for rendering and streaming. Each chunk owns a fixed cell count; chunk membership is computed via axial-to-chunk mapping (not a simple 2D array index), and boundaries must account for hex stagger.

**Engine note**:
- Godot: `TileMapLayer` with hex mode (Godot 4.2+; `TileMap` is deprecated), or custom implementation using axial coordinates with `Vector2i`
- Love2D: Manual coordinate math with axial-to-pixel and pixel-to-axial conversion functions
