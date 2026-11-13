# Behavioral Patterns

Patterns for defining and varying entity behavior, especially when behavior needs to be data-driven or safely extensible.

---

## Bytecode

**Intent**: Compile behavior into instructions for a lightweight virtual machine, enabling data-driven behavior that can be authored, modified, and sandboxed without recompiling the game.

**Problem**: Designers need to define spell effects, enemy AI, or quest logic without touching C++ code. Exposing the full scripting language is too powerful (security, stability). Hardcoding behavior in subclasses requires a programmer for every change.

**Solution**: Define a small set of opcodes that represent the operations designers need. Compile high-level behavior descriptions into bytecode arrays. At runtime, a simple interpreter executes the bytecode.

```cpp
enum Instruction {
    INST_LITERAL,      // push constant
    INST_GET_HEALTH,   // push caster.health
    INST_GET_AGILITY,
    INST_ADD,          // pop two, push sum
    INST_DIVIDE,
    INST_SET_HEALTH,   // pop value, set target.health
};

class VM {
    int stack[MAX_STACK];
    int stackSize = 0;
public:
    void interpret(const uint8_t* bytecode, int size,
                   Entity& caster, Entity& target) {
        for (int i = 0; i < size; i++) {
            switch (bytecode[i]) {
                case INST_LITERAL:
                    push(bytecode[++i]);
                    break;
                case INST_GET_HEALTH:
                    push(caster.health);
                    break;
                case INST_GET_AGILITY:
                    push(caster.agility);
                    break;
                case INST_ADD: {
                    int b = pop(), a = pop();
                    push(a + b);
                    break;
                }
                case INST_DIVIDE: {
                    int b = pop(), a = pop();
                    push(a / b);  // caller must ensure b != 0
                    break;
                }
                case INST_SET_HEALTH:
                    target.health = pop();
                    break;
                default:
                    assert(false && "unknown opcode");
            }
        }
    }
private:
    // Security: always bounds-check push/pop — malformed bytecode must not
    // corrupt memory. If bytecode comes from untrusted sources, validate the
    // entire program before execution rather than checking per-instruction.
    void push(int v) {
        assert(stackSize < MAX_STACK && "bytecode stack overflow");
        stack[stackSize++] = v;
    }
    int pop() {
        assert(stackSize > 0 && "bytecode stack underflow");
        return stack[--stackSize];
    }
};
```

A spell "set target health to (caster.agility / 2)" compiles to:
`[INST_GET_AGILITY, INST_LITERAL, 2, INST_DIVIDE, INST_SET_HEALTH]`

**Trade-offs**:
- **High implementation cost** — you're building a compiler and VM. Only justified when:
  - Designers need to author behavior without programmer involvement.
  - You need to sandbox untrusted scripts (mods, user content).
  - Behavior needs to be hot-reloaded or shipped as data.
- Debugging bytecode is harder than debugging source code — invest in tooling.
- Consider Lua, Wren, or MicroPython as alternatives before rolling your own VM.

**Game applications**: Spell/ability systems (Diablo-style), quest scripting, cutscene sequencing, moddable games (Dwarf Fortress, Minecraft), AI behavior trees compiled to bytecode.

**Engine note**: Godot's GDScript compiles to bytecode before execution. Unity has Visual Scripting (also bytecode-based). For custom scripting, embed Lua via `sol2` (C++) or use GDExtension. Rolling your own VM is rarely the right call unless your scripting domain is very constrained. **Security note**: when embedding Lua or MicroPython, restrict the standard library — remove `os`, `io`, `package`, and `debug` from Lua's sandbox; never expose file I/O or process execution to untrusted scripts.

---

## Subclass Sandbox

**Intent**: Define behavior in subclasses by composing a set of protected operations provided by the base class, keeping subclasses isolated from engine internals.

**Problem**: You have 50 spell subclasses. Each spell needs to play sounds, spawn particles, apply damage, and query game state. If each subclass calls engine APIs directly, you have 50 classes tightly coupled to the engine. Changing an API requires touching all 50.

**Solution**: The base `Spell` class provides protected methods that wrap all engine interactions. Subclasses implement `activate()` by composing those primitives — they never call engine code directly.

```cpp
class Spell {
public:
    virtual void activate(Entity& caster, Entity& target) = 0;
protected:
    // Primitives — subclasses use these, never engine APIs directly
    void playSound(SoundId id, float volume = 1.0f);
    void spawnParticles(ParticleType type, Vector3 pos, int count);
    void applyDamage(Entity& target, int amount, DamageType type);
    void healTarget(Entity& target, int amount);
    int  getStatOf(const Entity& e, Stat stat);
    bool isInRange(const Entity& a, const Entity& b, float range);
};

class FireballSpell : public Spell {
public:
    void activate(Entity& caster, Entity& target) override {
        if (!isInRange(caster, target, 10.0f)) return;
        playSound(SOUND_FIREBALL_CAST);
        spawnParticles(PARTICLE_FIRE, target.position, 20);
        applyDamage(target, 50, DAMAGE_FIRE);
    }
};
```

**Trade-offs**:
- The base class accumulates all engine coupling — it becomes a "god class" of primitives. Keep it focused; split into mixins if it grows too large.
- Subclasses can only do what the base class exposes. This is a feature (sandboxing) and a limitation (you may need to add primitives frequently early on).
- Inheritance is still inheritance — deep hierarchies are still painful. Prefer flat hierarchies (one level of subclasses).

**Game applications**: Spell/ability systems, enemy behavior variants, power-up effects, weapon types, any system with many variants that share a common set of operations.

**Engine note**: In Godot, a base `Ability` script with `@export` variables and helper methods serves the same purpose. In Unity, a base `MonoBehaviour` with protected helpers. The pattern maps cleanly to both.

---

## Type Object

**Intent**: Allow flexible creation of new "types" by defining a type object that instances share, rather than creating a new class per type.

**Problem**: Your game has 200 monster types. Creating a C++ subclass per monster type is impractical — it requires recompilation for every new monster, and designers can't add monsters without programmer help. You want monsters defined in data files.

**Solution**: Separate the "type" (shared data: stats, AI behavior, sprite) from the "instance" (per-entity state: position, health, current target). Each instance holds a reference to its type object.

```cpp
class MonsterType {
public:
    const char* name;
    int         maxHealth;
    int         attackDamage;
    float       moveSpeed;
    SpriteSheet* sprite;
    AIBehavior*  ai;

    // Types can have a parent for inheritance:
    MonsterType* parent = nullptr;

    int getMaxHealth() const {
        if (maxHealth != INHERIT) return maxHealth;
        return parent ? parent->getMaxHealth() : 0;  // root type must define maxHealth
    }
};

class Monster {
public:
    MonsterType* type;
    int          health;
    Vector3      position;

    int maxHealth()    const { return type->getMaxHealth(); }
    int attackDamage() const { return type->attackDamage; }
    void update()            { type->ai->update(*this); }
};

// Load from JSON:
// { "name": "cave_troll", "maxHealth": 200, "attackDamage": 30, ... }
MonsterType* trollType = loadMonsterType("cave_troll.json");
Monster* troll = new Monster{trollType, trollType->maxHealth, spawnPos};
```

**Type inheritance**: A `cave_troll` can inherit from `base_troll`, overriding only the fields that differ. This gives you a data-driven inheritance hierarchy without class hierarchies.

**Trade-offs**:
- Type objects are essentially a manual implementation of what classes give you for free. Use when you need runtime-defined types (moddable games, data-driven design).
- Type inheritance in data can become as tangled as class inheritance — keep hierarchies shallow.
- If types are truly static and known at compile time, just use classes.

**Game applications**: Enemy/item/spell type systems, equipment with stat templates, tile types, projectile definitions, any system where designers define many variants of a concept.

**Engine note**: Godot resources (`Resource` subclasses) serve as type objects. Unity `ScriptableObject` is the canonical type object pattern. Unreal `DataAsset`. All three let designers define types in the editor without code.
