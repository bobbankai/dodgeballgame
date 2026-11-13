# Push-Forward Design

How resource scarcity and mechanical incentives create aggressive, forward-moving player behavior. Load this when designing combat systems, resource loops, or any mechanic where you want players to engage rather than retreat.

---

## The Core Principle

**Source:** Kurt Loudon & Jake Campbell, "Embracing Push Forward Combat in DOOM" (GDC 2016). For spatial/arena design principles, see the level-design skill (not yet available).


**Push-forward design** is a system architecture where the optimal strategy is always aggressive engagement. Players are rewarded for moving forward and punished for retreating or playing passively.

The key insight: push-forward is not just a design aesthetic — it is a **motivation system**. The mechanics must make aggression feel like the correct and rewarding choice, not just the stylistically intended one.

---

## The Resource Scarcity Engine

The foundation of push-forward behavior is **resource replenishment through combat**:

- Health restores by killing enemies (glory kills), not by hiding
- Ammo replenishes by killing enemies, not by finding caches
- Special resources (chainsaw fuel) are rare and require tactical decisions about when to use them

This creates a **positive feedback loop for aggression:**
1. Player engages → kills enemy → gains health/ammo
2. Player retreats → takes damage without replenishment → resource deficit worsens
3. Resource deficit → player must engage to survive → aggression becomes mandatory

**The rubber-band asymmetry:** Health drops rubber-band (heavier enemies drop more health, incentivizing tackling the hardest threats). Ammo does NOT rubber-band — ammo scarcity forces weapon variety and tactical decisions about which tool to use.

---

## Depth Through Scarcity

Resource scarcity creates depth by forcing tradeoffs:

**Weapon as tools, not upgrades:** Each weapon has a specific role (combat shotgun = stagger, super shotgun = close-range burst, chainsaw = ammo pinata). No single weapon dominates all situations. Scarcity forces players to cycle through their arsenal, which creates the "combat chess" decision space.

**The chainsaw as ammo economy:** The chainsaw converts any enemy into an ammo drop. This creates a strategic decision: use it on fodder (fuel-efficient) or on a dangerous heavy (guaranteed kill, high risk). The scarcity of chainsaw fuel makes this decision meaningful every time.

**Glory kills as risk/reward:** Glory kills provide large health drops but require standing still briefly. The system makes players invincible during the animation and pauses enemy attacks — but the player must decide when the health gain is worth the positional risk.

---

## The Threat Management System

Push-forward only works if players feel empowered to engage. The enemy hit-reaction system is designed to reinforce player agency:

**Hit reaction spectrum (weakest → strongest):**
1. **Twitch** — additive animation, doesn't interrupt enemy behavior but can break aim
2. **Falter** — full-body animation, interrupts current action, can be chained (pain lock)
3. **Stagger** — daze state, signals vulnerability, enables glory kill

The key reframe: hit reactions are not enemy animations — they are **tools for the player to manage threats**. The player can interrupt, slow, and control enemies through sustained fire. This makes aggression feel effective rather than reckless.

**Token system for attack density:** A global token pool limits how many enemies can attack simultaneously. This prevents overwhelming barrages while maintaining the feeling of being outnumbered. Higher difficulty = more tokens = more simultaneous attacks.

---

## Enemy Design as Push-Forward Support

Enemies must support the push-forward loop, not undermine it:

**Enemies hold position:** Ranged enemies stay in place and expose themselves rather than seeking cover. This means the player must advance to engage them — they won't come to you. "Exposed cover" positions (the opposite of cover-shooter cover) keep enemies visible and shootable.

**Accuracy punishes standing still:** Enemy accuracy adjusts to player movement speed. Moving players are missed more often; stationary players get hit. The game mechanically enforces that movement is safer than cover.

**Single-sentence AI:** Each enemy type does one thing well. Players can read their threat instantly. Complexity comes from combinations, not from individual enemy complexity. "Ingredients, not entrees."

**Enemy archetypes create push-forward puzzles:**
- Imps (slow arc projectiles) teach counter-attacking — interrupt their wind-up
- Pinkies (chargers) teach lateral movement — their weak spot is the back
- Heavies (high health) incentivize chainsaw use or sustained focus

---

## The Dance: What Push-Forward Feels Like

When the system works, combat has a rhythm: constant movement, lateral and circular motion, natural back-and-forth between player and enemies. The DOOM team called this "the dance."

**Failure conditions** (signs push-forward is breaking down):
- Players retreat from enemies
- Players post up in a doorway
- Players snipe from a distance
- Players kite enemies around the space

If any of these emerge in playtesting, the resource loop is broken — aggression is not being rewarded sufficiently, or the cost of engagement is too high.

---

## Generalizing Push-Forward

The DOOM implementation is specific, but the underlying principle generalizes:

**Any system where the optimal strategy is passive or retreating is anti-push-forward.** Cover shooters, regenerating health, and ammo abundance all create incentives to disengage.

**Push-forward requires:**
1. Resources that replenish through engagement, not through waiting
2. Enemies that reward aggression (stagger, interrupt, glory kill)
3. Mechanics that punish passivity (accuracy vs. movement, resource drain)
4. A clear feedback loop: engage → reward → engage more

**The design question:** Does your resource system make engagement feel like the correct choice, or does it make retreat feel safe?

For how push-forward relates to player motivation models, see `player-experience.md` if not already loaded. For the spatial/arena design that supports push-forward movement, see the level-design skill (not yet available).
