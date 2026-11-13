# Design Patterns Revisited

Classic GoF patterns as they apply in game development contexts.

---

## Command

**Intent**: Encapsulate a request as an object, enabling parameterization, queuing, logging, and reversal of operations.

**Problem**: Input handling hard-wires button presses to function calls. You can't rebind keys, record replays, implement undo, or drive AI with the same code path as player input.

**Solution**: Define a `Command` base with `execute()`. Each action becomes a subclass. The input handler holds a mapping from buttons to Command instances and calls `execute()` — it never calls game functions directly.

```cpp
class Command {
public:
    virtual ~Command() {}
    virtual void execute(Actor& actor) = 0;
    virtual void undo(Actor& actor) {}  // optional
};

class JumpCommand : public Command {
public:
    void execute(Actor& actor) override { actor.jump(); }
};

// Input handler maps buttons to commands:
Command* buttonA = new JumpCommand();

// Each frame:
Command* cmd = inputHandler.handleInput();
if (cmd) cmd->execute(player);
```

For undo, store the previous state in the command before executing:

```cpp
class MoveCommand : public Command {
    Unit* unit; int x, y, prevX, prevY;
public:
    // MoveCommand binds to a specific unit at creation time;
    // the Actor& parameter is unused (this command is not reusable across actors)
    void execute(Actor& /*actor*/) override {
        prevX = unit->x; prevY = unit->y;
        unit->moveTo(x, y);
    }
    void undo(Actor& /*actor*/) override { unit->moveTo(prevX, prevY); }
};
```

Maintain an undo stack: push on execute, pop and call `undo()` on Ctrl-Z.

**Trade-offs**:
- Adds a class per action — manageable with a base class and helpers.
- Stateless commands (JumpCommand) can be singletons/flyweights; stateful commands (MoveCommand) must be instantiated per use.
- In languages with first-class functions, lambdas/closures replace the class hierarchy cleanly.

**Game applications**: Rebindable controls, replay systems (record command stream, replay it), undo in level editors, AI that emits commands instead of calling functions directly, networked games (serialize and transmit command stream).

**Engine note**: In Godot, `InputMap` handles rebinding; pair with an action queue for undo. In Unity, the `ICommand` pattern is common in editor tools. Love2d: closures work well as lightweight commands.

---

## Flyweight

**Intent**: Share a single copy of immutable data across many instances to reduce memory.

**Problem**: A forest of 10,000 trees each storing their own mesh, texture, and shader data consumes enormous memory, even though all oak trees are identical in those respects.

**Solution**: Split object state into *intrinsic* (shared, immutable) and *extrinsic* (per-instance). Store intrinsic data once in a shared Flyweight object; each instance holds only its extrinsic state (position, health, etc.) plus a pointer to the shared data.

```cpp
struct TreeModel {  // Flyweight — one per tree type
    Mesh mesh;
    Texture bark;
    Texture leaves;
};

struct Tree {  // Instance — one per tree in the world
    TreeModel* model;  // shared pointer
    Vector3 position;
    float height;
    float sway;
};

// Render: instanced draw call passes all Tree positions to GPU
// with a single TreeModel — one draw call for 10,000 trees.
```

**Trade-offs**:
- Only beneficial when many instances share identical intrinsic data.
- Intrinsic data must be truly immutable — if instances need to diverge, they're no longer flyweights.
- Modern GPUs handle this via instanced rendering; the pattern maps directly to GPU instancing.

**Game applications**: Tile maps (one tile type shared by thousands of tiles), particle systems (particle template shared by all particles of a type), enemy types (stats/sprites shared; position/health per-instance).

**Engine note**: Godot's `MultiMeshInstance3D`, Unity's `Graphics.DrawMeshInstanced`, and Love2d's `SpriteBatch` all implement this at the rendering level.

---

## Observer

**Intent**: Let one object announce events without knowing who receives them; listeners register and unregister independently.

**Problem**: The physics engine needs to trigger an achievement when the player falls off a bridge. Putting achievement code in the physics engine couples two unrelated systems. Every new achievement would require touching physics code.

**Solution**: Physics becomes a Subject with `addObserver()`/`removeObserver()` and a protected `notify()`. The achievement system implements Observer and registers itself. Physics calls `notify(entity, EVENT_FELL)` — it doesn't know or care who's listening.

```cpp
class Observer {
public:
    virtual void onNotify(const Entity& entity, Event event) = 0;
};

class Subject {
    Observer* observers[MAX];
    int count = 0;
public:
    void addObserver(Observer* o) {
        assert(count < MAX && "observer list full");
        observers[count++] = o;
    }
    void removeObserver(Observer* o) { /* remove from array */ }
protected:
    void notify(const Entity& e, Event ev) {
        for (int i = 0; i < count; i++) observers[i]->onNotify(e, ev);
    }
};

class Physics : public Subject {
    void updateEntity(Entity& e) {
        bool wasOnGround = e.isOnGround();
        e.applyGravity();
        if (wasOnGround && !e.isOnGround()) notify(e, EVENT_FELL);
    }
};
```

**Trade-offs**:
- Synchronous: slow observers block the subject. Use Event Queue for async.
- Lapsed listener problem: in GC languages, observers that aren't unregistered stay alive via the subject's reference. Always unregister on destroy.
- Debugging is harder — event chains are implicit. Prefer explicit coupling within a single system; use Observer across system boundaries.

**Game applications**: Achievement systems, UI health bars reacting to game state, audio system responding to game events, analytics/telemetry, save-state triggers.

**Engine note**: Godot signals are Observer with syntactic sugar. Unity's `UnityEvent` and C# `event` keyword implement the same pattern. Love2d: roll your own or use a library like `beholder`.

---

## Prototype

**Intent**: Create new objects by cloning an existing prototype rather than constructing from scratch.

**Problem**: You have dozens of enemy types. Constructing each from scratch requires knowing all their parameters. You want to define enemies in data and spawn them by name.

**Solution**: Two flavors in games:

**OOP Prototype** — each class implements `clone()`:
```cpp
class Monster {
public:
    virtual Monster* clone() const = 0;
};
class Ghost : public Monster {
    int health;
public:
    Monster* clone() const override { return new Ghost(*this); }
};

// Spawn by cloning a template:
Monster* spawnGhost() { return ghostTemplate->clone(); }
```

**Data-driven Prototype** (more common in modern games) — a JSON/YAML "archetype" that instances copy from, with per-instance overrides:
```json
{
  "type": "ghost",
  "prototype": "base_enemy",
  "health": 50,
  "speed": 3.0
}
```
The spawner looks up "ghost", copies the base_enemy defaults, applies overrides, and constructs the instance.

**Trade-offs**:
- OOP clone() is rarely the right tool — prefer factories or data-driven archetypes.
- Data-driven prototype is powerful for moddable games and designer-friendly workflows.
- Deep vs. shallow copy semantics must be explicit.

**Game applications**: Enemy/item spawning from data files, prefab systems (Unity prefabs are prototypes), save/load by serializing instance state relative to prototype.

**Engine note**: Unity prefabs, Godot scenes, and Unreal blueprints are all prototype-based spawning systems.

---

## Singleton

**Intent**: Ensure a class has exactly one instance with global access.

**Problem**: You need one AudioManager, one FileSystem, one EventBus. You want to access it from anywhere without passing it through every function call.

**Solution**:
```cpp
class AudioManager {
public:
    static AudioManager& instance() {
        static AudioManager inst;  // C++11: thread-safe lazy init
        return inst;
    }
    void playSound(SoundId id) { /* ... */ }
private:
    AudioManager() {}
};

// Usage:
AudioManager::instance().playSound(SOUND_EXPLOSION);
```

**Trade-offs**:
- **Widely overused.** The convenience of global access is also its danger: any code can call into it, creating hidden dependencies that make testing and refactoring painful.
- Singletons make unit testing hard — you can't swap in a mock.
- Two singletons with initialization order dependencies cause subtle bugs.
- **Prefer Service Locator** — same global access, but the implementation is swappable. Use Singleton only when the single-instance constraint is a genuine invariant (e.g., a hardware interface), not just "I want global access."

**Game applications**: Legitimate uses are rare. Common misuses: game state managers, resource managers, input systems — all better served by dependency injection or Service Locator.

**Engine note**: Godot's autoloads are singletons. Use them sparingly; prefer passing dependencies explicitly or using the scene tree.

---

## State

**Intent**: Allow an object to alter its behavior when its internal state changes; the object appears to change its class.

**Problem**: A character with idle/walk/jump/attack states implemented as a giant `if/else` or `switch` becomes unmaintainable. Adding a new state requires touching the entire block. Transitions are scattered everywhere.

**Solution**: Each state is an object that owns its behavior and knows its valid transitions. The entity holds a pointer to the current state and delegates to it.

```cpp
class HeroState {
public:
    virtual ~HeroState() {}
    virtual HeroState* handleInput(Hero& hero, Input input) = 0;
    virtual void update(Hero& hero) = 0;
    virtual void enter(Hero& hero) {}
    virtual void exit(Hero& hero) {}
};

class StandingState : public HeroState {
public:
    HeroState* handleInput(Hero& hero, Input input) override {
        if (input == PRESS_DOWN) return new DuckingState();
        if (input == PRESS_B)    return new JumpingState();
        return nullptr;  // stay in this state
    }
    void update(Hero& hero) override { /* idle animation */ }
};

class Hero {
    HeroState* state = new StandingState();
public:
    void handleInput(Input input) {
        HeroState* next = state->handleInput(*this, input);
        if (next) {
            state->exit(*this);
            delete state;
            state = next;
            state->enter(*this);
        }
    }
    void update() { state->update(*this); }
};
```

**Variants**:
- **Hierarchical FSM**: states inherit from parent states; unhandled inputs bubble up. Good for "any state → dead" transitions.
- **Pushdown automaton**: push states onto a stack; pop to return to previous state. Good for modal UIs (pause menu → inventory → back to pause).

**Trade-offs**:
- State explosion: N states × M inputs = N×M transitions to manage. For complex behavior, consider Behavior Trees instead.
- Allocating state objects per transition adds GC pressure; use a pool or static state instances.

**Game applications**: Character controllers, enemy AI, UI screens, game phase management (title → gameplay → pause → game over), animation state machines.

**Engine note**: Godot's `AnimationTree` + `AnimationNodeStateMachine`, Unity's Animator Controller, and most engine animation systems implement hierarchical FSMs. For gameplay logic, roll your own or use a BT library.
