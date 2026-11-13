# Thermal and Power Optimization

Battery life, thermal throttling, and power efficiency are performance problems on handheld and mobile platforms. A game that meets its FPS target but runs at 90% GPU utilization will degrade over a 30-minute session and drain the battery in 2 hours. This reference covers the diagnosis and fixes.

---

## The Power Model (Conceptual)

Understanding why power matters requires understanding how hardware clocks work.

**Power consumption scales non-linearly with clock speed**:
- Doubling clock speed roughly triples or quadruples power draw (due to dynamic power = C × V² × f)
- A chip running at 60% utilization can downclock significantly, saving disproportionate power
- Example: Steam Deck total APU TDP is 15W (CPU + GPU combined); the GPU portion at 1600MHz (max boost) draws approximately 8–10W; at 800MHz draws ~3–4W — same FPS if utilization is proportionally lower

**The utilization-clock relationship**:
- Hardware uses Dynamic Voltage and Frequency Scaling (DVFS) to choose the lowest clock that meets demand
- If your game needs 90% GPU at 1600MHz to hit 60fps, the hardware must run at max clock
- If your game needs 55% GPU at 1600MHz to hit 60fps, the hardware can downclock to ~900MHz and still deliver 60fps — at roughly 1/3 the GPU power draw
- **The goal**: reduce work so the hardware can choose a lower clock, not just reduce utilization at the same clock

**CPU and GPU share a power envelope on mobile/handheld**:
- On Steam Deck, the total TDP is 15W (configurable to 5–15W)
- CPU and GPU compete for this budget
- Reducing CPU work frees power for the GPU, and vice versa — even if the other was the bottleneck
- This is why CPU optimizations can improve GPU performance on handheld: they free power budget

**Practical implication**: The target is not "meet FPS at any utilization." The target is "meet FPS at low enough utilization that the hardware can downclock." This gives you thermal headroom, battery life, and margin for worst-case scenes — all simultaneously.

---

## Thermal Throttling

**Mechanism**: Sustained load causes chip temperature to rise. When temperature approaches the thermal design limit, the hardware reduces clock speeds to stay within the thermal design power (TDP). Performance degrades over time — the game starts smooth and gets choppy after 15–30 minutes.

**The burst vs. sustained distinction**: Modern chips can briefly exceed TDP (Intel Turbo Boost, AMD Precision Boost). A benchmark that runs for 30 seconds may show excellent performance that isn't sustainable. Always test for 30+ minutes.

**Diagnosis**:
1. Run the game for 30 minutes in a demanding scene
2. Monitor GPU clock speed over time (GPU-Z, MSI Afterburner, Steam Deck's built-in overlay)
3. If clock speed decreases over time (e.g., starts at 1600MHz, drops to 900MHz after 20 minutes), you're thermally throttling
4. Correlate with frame time: frame time should increase as clocks drop

**Thermal throttling vs. other performance degradation**: If performance degrades over time but clocks stay constant, look for memory leaks (increasing GC pressure) or streaming issues (memory fragmentation). Thermal throttling specifically shows clock speed reduction.

**Fix**: Reduce sustained utilization so thermal equilibrium occurs at a higher clock speed. The hardware will find a stable operating point where heat dissipation equals heat generation. If that point is at 60% utilization and 800MHz, the game runs cool indefinitely. If it requires 90% at 1600MHz, the chip overheats and throttles.

**Target**: After 30 minutes of gameplay in the most demanding scene, GPU and CPU clocks should be stable (not decreasing). If they're decreasing, reduce sustained load until they stabilize.

---

## Battery Life Optimization

Battery life is determined by average power draw over time. Halving average power draw doubles battery life.

**The single biggest lever: frame rate cap**

| FPS cap | Approximate battery life (Steam Deck) |
|---|---|
| Uncapped (~120fps in menus) | ~1.5 hours |
| 60fps | ~2–3 hours |
| 40fps | ~3–4 hours |
| 30fps | ~4–6 hours |

A 30fps cap can more than double battery life compared to 60fps. For games where 30fps is acceptable, this is the highest-impact single change.

**Target utilization for battery efficiency**:
- Aim for 55–70% GPU utilization at your target FPS
- This allows the hardware to downclock, saving power disproportionately
- 90% GPU at 60fps draws ~3× more power than 60% GPU at 60fps

**Idle power traps**: Menus, loading screens, and cutscenes often render at uncapped FPS with no frame cap. A main menu rendering at 300fps wastes enormous power for zero player benefit. Apply a frame cap everywhere, not just in gameplay.

```
// Pseudocode: apply frame cap in all states
function set_frame_cap(state):
    match state:
        GAMEPLAY:    target_fps = 60  // or 30 for battery mode
        MENU:        target_fps = 30  // menus don't need 60fps
        LOADING:     target_fps = 15  // loading screens need even less
        CUTSCENE:    target_fps = 30  // match cinematic feel
        PAUSED:      target_fps = 10  // nearly static image
```

**Audio and haptics**:
- Vibration motors draw significant power (0.5–2W) — use them judiciously
- Constant audio processing (many simultaneous streams, complex DSP) contributes to CPU power draw
- Streaming audio from disk keeps the storage controller active; pre-load short sounds

**Network**:
- WiFi polling for multiplayer ping, cloud saves, and analytics keeps the WiFi radio active
- Batch network requests; don't poll continuously when infrequent checks suffice
- On mobile, background network activity is a significant battery drain

---

## Adaptive Quality / Dynamic Resolution

When a single quality setting can't meet both performance and battery targets across all hardware, adaptive quality bridges the gap.

**Dynamic Resolution Rendering (DRR)**:
- Adjust internal render resolution per-frame to maintain frame budget
- When frame time exceeds budget, reduce resolution; when frame time is below budget, increase resolution
- The resolution change is invisible to the player if done with a good upscaler (FSR, DLSS, TAA upscale)
- Implementation: track a rolling average of frame time; adjust render scale up/down by small increments each frame

```
// Pseudocode: simple dynamic resolution controller
target_frame_time = 1.0 / target_fps
render_scale = 1.0
min_scale = 0.5
max_scale = 1.0

function update_render_scale(actual_frame_time):
    if actual_frame_time > target_frame_time * 1.1:  // 10% over budget
        render_scale = max(render_scale - 0.05, min_scale)
    elif actual_frame_time < target_frame_time * 0.9:  // 10% under budget
        render_scale = min(render_scale + 0.02, max_scale)
    // Asymmetric: drop faster than you recover (avoid oscillation)
```

**Quality tiers**:
- Detect platform capabilities at startup and set appropriate defaults
- Steam Deck: medium settings, 60fps, dynamic resolution enabled
- High-end PC: ultra settings, uncapped, dynamic resolution disabled
- Mobile low-end: low settings, 30fps, aggressive dynamic resolution

**Player-configurable settings**:
- Always let players choose their own FPS/quality tradeoff
- Provide presets (Performance / Balanced / Quality) that set multiple settings simultaneously
- Never lock players into a single quality level — some prefer 30fps with better visuals; others prefer 60fps with lower quality

**Power profile response**:
- On platforms that expose power state (plugged in vs. battery), automatically adjust quality
- Steam Deck: detect plugged vs. battery; offer to switch quality presets
- Mobile: iOS/Android expose low-power mode; reduce quality when active

---

## Headroom Philosophy

Headroom is the margin between current utilization and capacity. It's not waste — it's insurance.

**Why headroom matters**:
- **Thermal variance**: A chip running at 75% utilization at 20°C ambient will throttle at 35°C ambient (summer, direct sunlight on a handheld). Headroom absorbs this.
- **Worst-case scenes**: Your benchmark scene is not your worst-case scene. An explosion with 50 particles, 10 enemies, and a dynamic light is worse than your benchmark. Headroom absorbs this.
- **OS background tasks**: The OS runs background tasks (indexing, updates, notifications) that consume CPU and memory. Headroom absorbs this.
- **Player multitasking**: On mobile, players switch apps, receive notifications, and run background apps. Headroom absorbs this.

**Target headroom**:
- 60–75% GPU utilization at target FPS on min-spec hardware
- 60–75% CPU utilization on the main thread
- 20% VRAM/RAM headroom (don't fill the memory budget completely)

**The 30-minute test**: The definitive headroom test is not a benchmark — it's a 30-minute play session in the most demanding area of the game. If performance is stable at the end as it was at the beginning, you have sufficient headroom. If it degrades, you have a thermal problem even if instantaneous metrics look fine.

**The "looks fine in the profiler" trap**: A profiler session of 30 seconds in a controlled scene will show good metrics even for a game that throttles after 20 minutes. Always test duration, not just instantaneous performance.

**Headroom vs. optimization**: Headroom is not achieved by leaving performance on the table — it's achieved by optimizing until you have headroom. A game that runs at 90% GPU to hit 60fps has no headroom. A game that runs at 60% GPU to hit 60fps has 40% headroom. Both hit 60fps; only one is shippable on constrained hardware.
