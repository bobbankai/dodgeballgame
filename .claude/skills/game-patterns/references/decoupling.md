# Decoupling Patterns

Patterns for reducing coupling between game systems so they can evolve independently.

---

## Component

**Intent**: Allow a single entity to span multiple domains (physics, rendering, AI, input) without coupling those domains to each other.

**Problem**: A `Player` class that handles input, physics, rendering, and audio in one monolithic class becomes a 5,000-line nightmare. Every programmer must understand every domain to make a change. Reusing behavior across entity types (e.g., both Player and NPC need physics) requires awkward inheritance.

**Solution**: Split the entity into a thin container plus domain-specific component objects. Each component owns its domain's data and behavior. The entity is just a bag of components.

```cpp
// Component interfaces
class InputComponent {
public:
    virtual void update(Entity& entity) = 0;
};
class PhysicsComponent {
public:
    virtual void update(Entity& entity, World& world) = 0;
};
class GraphicsComponent {
public:
    virtual void update(Entity& entity, Renderer& renderer) = 0;
};

// Entity is a thin container
class Entity {
public:
    float x, y, velocity;

    Entity(InputComponent* in, PhysicsComponent* phys, GraphicsComponent* gfx)
        : input(in), physics(phys), graphics(gfx) {}

    void update(World& world, Renderer& renderer) {
        input->update(*this);
        physics->update(*this, world);
        graphics->update(*this, renderer);
    }
private:
    InputComponent*   input;
    PhysicsComponent* physics;
    GraphicsComponent* graphics;
};

// Compose entities from components:
Entity* player = new Entity(
    new PlayerInputComponent(),
    new RigidBodyPhysics(),
    new AnimatedSprite()
);
Entity* aiEnemy = new Entity(
    new PatrolAIComponent(),
    new RigidBodyPhysics(),
    new AnimatedSprite()
);
```

**Component communication**: Three options, often combined:
1. **Shared state on entity**: components read/write shared fields (position, velocity). Simple but creates implicit ordering dependencies.
2. **Direct references**: `GraphicsComponent` holds a pointer to `PhysicsComponent` to query ground state. Simple but creates coupling between components.
3. **Messaging**: entity broadcasts messages to all components. Decoupled but more complex.

**Entity Component Systems (ECS)**: The extreme version — entities are just IDs, components are plain data structs, systems process all components of a type in bulk. Enables Data Locality and cache-friendly processing. See `optimization.md` → Data Locality.

**Trade-offs**:
- Adds indirection — getting anything done requires fetching the right component first.
- Component communication is harder than direct method calls.
- For simple games, a monolithic entity class is fine. Don't over-engineer.

**Game applications**: Every modern game engine uses this. Player/enemy entities, UI elements, scene objects.

**Engine note**: Unity `GameObject` + `MonoBehaviour` components, Godot node tree (each node is a component), Bevy ECS, Unreal `Actor` + `ActorComponent`. This pattern is the foundation of all major engines — you're always using it.

---

## Event Queue

**Intent**: Decouple event producers from consumers in time as well as structure — producers post events to a queue; consumers process them at their own pace.

**Problem**: Observer is synchronous — a slow observer blocks the subject. Audio playback triggered by physics events can't happen mid-physics-update (audio system isn't ready). Cross-thread communication needs a buffer. You want to aggregate multiple "play footstep" requests per frame into one sound.

**Solution**: Events are pushed onto a queue (ring buffer or dynamic list). Consumers pull from the queue when they're ready — typically once per frame.

```cpp
struct SoundEvent {
    SoundId id;
    float   volume;
    Vector3 position;
};

class AudioQueue {
    static const int MAX = 256;
    SoundEvent pending[MAX];
    int head = 0, tail = 0;
public:
    void playSound(SoundId id, float vol, Vector3 pos) {
        // Overflow guard: drop if full (head==tail means empty; (tail+1)%MAX==head means full)
        if ((tail + 1) % MAX == head) return;
        // Deduplicate: if same sound already queued this frame, skip
        for (int i = head; i != tail; i = (i + 1) % MAX) {
            if (pending[i].id == id) return;
        }
        pending[tail] = {id, vol, pos};
        tail = (tail + 1) % MAX;
    }

    void processQueue(AudioEngine& audio) {
        while (head != tail) {
            audio.play(pending[head]);
            head = (head + 1) % MAX;
        }
    }
};
```

**Ring buffer** is the standard implementation: fixed memory, O(1) push/pop, no allocation. Size it to never overflow (assert or drop oldest on overflow).

**Trade-offs**:
- Events are processed with a delay (up to one frame). Not suitable for immediate feedback (e.g., collision response).
- Queue can overflow if producers outpace consumers — handle gracefully.
- Feedback loops: an event handler that posts more events can fill the queue. Process only events that were in the queue at the start of the frame.
- Harder to debug than synchronous Observer — event chains are implicit.

**Game applications**: Audio event systems, input event buffering, UI event dispatch, cross-thread communication (game thread → render thread), network message queues, analytics event batching.

**Engine note**: Godot's `call_deferred()` queues a method call for the next frame. Unity's `SendMessage` (avoid) and event systems. Most engine audio systems use an internal queue. For custom systems, implement a ring buffer.

---

## Service Locator

**Intent**: Provide a global point of access to a service without coupling callers to the concrete implementation.

**Problem**: Many systems need access to audio, logging, or analytics. Passing these through every constructor is tedious. Singleton gives global access but hard-codes the implementation, making testing and swapping impossible.

**Solution**: A central registry maps service interfaces to concrete implementations. Callers ask the locator for a service by interface; the locator returns the registered implementation.

```cpp
class Audio {
public:
    virtual ~Audio() {}
    virtual void playSound(SoundId id) = 0;
    virtual void stopSound(SoundId id) = 0;
};

class NullAudio : public Audio {  // Null object — does nothing
    void playSound(SoundId) override {}
    void stopSound(SoundId) override {}
};

class Locator {
    static Audio* audio_;
public:
    static void provide(Audio* service) { audio_ = service; }
    static Audio& audio() {
        return audio_ ? *audio_ : nullAudio_;
    }
private:
    static NullAudio nullAudio_;
};

// At startup:
Locator::provide(new SDLAudio());

// In tests:
Locator::provide(new MockAudio());

// Anywhere in the codebase:
Locator::audio().playSound(SOUND_EXPLOSION);
```

The **Null Object** default (`NullAudio`) is critical — it means code that calls `Locator::audio()` before a real service is registered silently does nothing instead of crashing.

**Trade-offs**:
- Still global state — dependencies are implicit. Prefer dependency injection when you can afford the verbosity.
- If the locator is called before a service is registered, the null object prevents crashes but hides bugs. Log a warning in the null object's methods during development.
- Service Locator is appropriate for truly cross-cutting concerns (audio, logging, analytics) that would otherwise require threading through every call stack.

**Game applications**: Audio systems, logging, analytics, save/load services, platform abstraction layers (PC vs. console file I/O).

**Engine note**: Godot's autoloads behave like singletons (one instance, globally accessible by name) but don't support swapping implementations — for true Service Locator behavior with swappable implementations, register services manually. Unity's `FindObjectOfType<T>()` is a slow variant — prefer manual registration. For dependency injection in Unity, consider Zenject or VContainer.
