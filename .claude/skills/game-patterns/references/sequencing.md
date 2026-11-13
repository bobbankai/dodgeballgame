# Sequencing Patterns

Patterns for managing time, frames, and per-entity update logic.

---

## Double Buffer

**Intent**: Maintain two buffers — one being written, one being read — and swap them atomically to prevent consumers from seeing partially-updated state.

**Problem**: The renderer reads the framebuffer while the game is writing the next frame. Without protection, the display shows a half-rendered frame (tearing). The same problem occurs in physics when one body's update reads another body's position mid-update.

**Solution**: Keep two copies of the state. The game writes to the *back buffer*; the renderer reads from the *front buffer*. At the end of each frame, swap the pointers.

```cpp
class FrameBuffer {
    Pixel pixels[WIDTH * HEIGHT];
public:
    void clear() { memset(pixels, 0, sizeof(pixels)); }
    void draw(int x, int y, Pixel color) { pixels[y * WIDTH + x] = color; }
    const Pixel* data() const { return pixels; }
};

class Renderer {
    FrameBuffer buffers[2];
    int current = 0;
public:
    FrameBuffer& backBuffer()  { return buffers[current]; }
    FrameBuffer& frontBuffer() { return buffers[1 - current]; }
    void swap() { current = 1 - current; }
};
```

Physics double-buffering: each body reads positions from the *previous* frame's buffer while writing to the current frame's buffer. Swap after all bodies update.

**Trade-offs**:
- Doubles memory for buffered state.
- Introduces one frame of latency between state change and visibility.
- The swap must be atomic — use a pointer swap, not a copy.

**Game applications**: Framebuffer rendering (universal), physics state (when bodies must read consistent previous-frame positions), cellular automata, any system where readers and writers must be isolated.

**Engine note**: Every game engine handles framebuffer double-buffering automatically. You will almost never implement this yourself. Understand it to debug vsync artifacts, screen tearing, or physics jitter. In Godot, `RenderingServer` manages this. In Unity, the render pipeline handles it.

---

## Game Loop

**Intent**: Decouple the progression of game time from user input and processor speed so the game runs consistently across hardware.

**Problem**: A naive loop that processes input and renders as fast as possible runs at different speeds on different machines. A loop that blocks waiting for input freezes animations and physics.

**Solution**: The loop never blocks. It processes whatever input is available, advances the simulation, and renders — every frame, regardless of input. Time management is the key design decision.

**Fixed timestep with variable rendering** (recommended):
```cpp
const double MS_PER_UPDATE = 1000.0 / 60.0;  // 60 Hz physics
double previous = getCurrentTime();
double lag = 0.0;

while (true) {
    double current = getCurrentTime();
    double elapsed = current - previous;
    previous = current;
    lag += elapsed;

    processInput();

    // Catch up physics in fixed steps
    while (lag >= MS_PER_UPDATE) {
        update(MS_PER_UPDATE);
        lag -= MS_PER_UPDATE;
    }

    // Interpolate render position between physics frames
    render(lag / MS_PER_UPDATE);
}
```

The `lag / MS_PER_UPDATE` interpolation factor (0.0–1.0) lets the renderer interpolate object positions between the previous and current physics states, producing smooth motion even when the display refresh rate is higher than the physics tick rate. Store both previous and current state per object to use this correctly.

**Variants**:
- **Fixed timestep + sleep**: simplest, but game slows down if a frame takes too long.
- **Variable timestep**: `update(elapsed)` — adapts to speed but causes physics instability and non-determinism. Avoid for physics-heavy games.
- **Fixed update + variable render** (above): gold standard for most games.

**Trade-offs**:
- Fixed timestep accumulator can "spiral of death" if a frame takes longer than the timestep — cap the maximum lag.
- Interpolation requires storing previous and current state for rendered objects.
- Web/mobile platforms may own the loop (browser's `requestAnimationFrame`, iOS run loop) — adapt accordingly.

**Game applications**: Every real-time game. Turn-based games still need a loop for animations and UI.

**Engine note**: **Do not implement this yourself when using a game engine.** Godot: `_process(delta)` for rendering/input, `_physics_process(delta)` for physics (fixed timestep). Unity: `Update()` for rendering, `FixedUpdate()` for physics. Love2d: `love.update(dt)` and `love.draw()`. Understanding this pattern explains *why* those callbacks exist and when to use each.

---

## Update Method

**Intent**: Give each entity its own update behavior that the game loop calls once per frame, simulating a collection of independent objects.

**Problem**: The game loop needs to advance the state of hundreds of entities — enemies, projectiles, particles, NPCs. Putting all that logic in the game loop creates a monolith. Each entity type needs to manage its own state across frames.

**Solution**: Each entity implements an `update(dt)` method. The game loop maintains a collection of entities and calls `update` on each.

```cpp
class Entity {
public:
    virtual ~Entity() {}
    virtual void update(double dt) = 0;
    bool isAlive = true;
};

class Skeleton : public Entity {
    float patrolTimer = 0;
public:
    void update(double dt) override {
        patrolTimer += dt;
        if (patrolTimer > 2.0f) {
            reverseDirection();
            patrolTimer = 0;
        }
        moveInDirection(dt);
    }
};

// Game loop:
for (auto& entity : entities) {
    entity->update(deltaTime);
}
// Remove dead entities after the loop (never during iteration)
// C++20: std::erase_if(entities, [](auto& e) { return !e->isAlive; });
// Pre-C++20: entities.erase(std::remove_if(entities.begin(), entities.end(),
//     [](auto& e) { return !e->isAlive; }), entities.end());
```

**Trade-offs**:
- **Order dependency**: entity A's update may read entity B's position before B has updated this frame. Mitigate with double-buffering state or careful ordering.
- **Modification during iteration**: never add/remove entities while iterating. Use a pending list and apply changes after the loop.
- **Virtual dispatch cost**: calling a virtual method on thousands of entities per frame has measurable overhead. Data-oriented ECS systems avoid this by processing components in bulk.
- **Inactive entities**: entities that are off-screen or sleeping still pay the update cost unless you cull them.

**Game applications**: Every game with moving entities. The pattern is so fundamental it's baked into every engine's entity system.

**Engine note**: Godot's `_process`/`_physics_process`, Unity's `Update`/`FixedUpdate`, Love2d's `love.update` — all implement this pattern. The engine calls your `update` method; you don't call the engine's loop.
