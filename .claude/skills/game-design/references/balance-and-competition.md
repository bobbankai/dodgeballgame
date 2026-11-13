# Balance, Competition, and Game Economy

Deep-dive reference for balancing games, designing competitive systems, and building resource economies. Load this when tuning balance, designing competitive play, or building resource systems.

---

## Table of Contents

1. [Solvability](#solvability)
2. [Slippery Slope and Feedback Loops](#slippery-slope-and-feedback-loops)
3. [Subtractive Design](#subtractive-design)
4. [Game Economy Design](#game-economy-design)
5. [Balancing Multiplayer Games](#balancing-multiplayer-games)
6. [Worked Example: Mario Kart's Balance Systems](#worked-example-mario-karts-balance-systems)
7. [Individual Empowerment](#individual-empowerment)
8. [Interruption Economy](#interruption-economy)
9. [Diagnostic Questions](#diagnostic-questions)

---

## Solvability

**Source:** David Sirlin, *Playing to Win* (2005).

A game is **solved** when a player can find a complete set of instructions for every situation — a pure strategy that is always optimal. When a game is solved, no decisions remain. Players who know the solution just execute it; players who don't are simply behind on memorization.

### Pure Solutions

A **pure solution** is a dominant strategy: one approach that is always better than all alternatives. If a pure solution exists, the game degenerates. Players who find it stop thinking; players who don't are playing a different (worse) game.

Chess endgames and opening books trend toward pure solutions. Grandmasters memorize hundreds of opening lines because the optimal play in those positions is known. The interesting chess happens in the middle game, where the solution space is too large to memorize.

**Design implication**: Pure solutions emerge when the game has insufficient hidden information, no randomness, and no real-time execution pressure. If players can see the full game state, calculate optimal play, and execute it without time pressure, they will find the pure solution.

### Mixed Solutions (Nash Equilibrium)

A **mixed solution** is optimal play that involves probability distributions rather than fixed choices. Even if you know the mixed solution, you still must monitor opponents and react to their styles.

Rock-Paper-Scissors has a known mixed solution: play each option with 1/3 probability. But knowing this doesn't make the game trivial — you still must execute the distribution and read whether your opponent is deviating from it. A player who always throws rock is exploitable; a player who plays the mixed solution can exploit them.

Mixed solutions keep games strategically alive because the optimal play depends on what the opponent is doing, not just on the game state.

### Donkeyspace

**Source:** Frank Lantz.

**Donkeyspace** is the space of suboptimal plays. Good players intentionally enter donkeyspace to exploit opponents who are also playing suboptimally. This is where interesting competitive play happens.

**Example**: In a fighting game, the theoretically optimal punish after blocking a certain move might be a difficult combo that requires precise execution. A player who knows their opponent can't execute that combo might choose a simpler, lower-damage punish that they can execute reliably. They're playing suboptimally by the theory — but optimally against this specific opponent.

Donkeyspace is not a failure of design. It's evidence that the game has a rich enough solution space that players must reason about their opponents, not just about the abstract optimal play.

### Designing Against Solvability

Four tools that push games toward mixed solutions:

- **Hidden information**: Players cannot see the full game state. Poker is unsolvable because you don't know the opponent's hand. Fog of war in strategy games serves the same function.
- **Randomness**: Not a dirty word — it's a tool. Randomness prevents pure solutions by introducing variance that no strategy can fully control. The question is whether the randomness is meaningful (creates decisions) or arbitrary (creates frustration).
- **Real-time execution**: Even if the optimal move is known, executing it under time pressure introduces variance. The player who knows the optimal combo must still execute it.
- **Double-blind decisions**: Both players commit simultaneously, without seeing the other's choice. This structure forces probability distributions rather than reactive play.

**The unconscious learning factor**: Research by Lewicki (1987) showed that people learn complex patterns without knowing they learned them. Competitive game players develop intuitions about opponent tendencies that they cannot articulate. This is why experienced players can "read" opponents — they've internalized patterns from thousands of games. Designing for this means creating games rich enough that pattern recognition is a meaningful skill.

---

## Slippery Slope and Feedback Loops

### Positive Feedback Loops

A **positive feedback loop** amplifies advantages: winning gives advantages that make winning easier.

**Monopoly** is the canonical example. More properties → more rent → more money → more properties. Once a player establishes a property advantage, the loop compounds it. Games are often decided in the first few turns; the remaining play is just executing the inevitable conclusion.

Positive feedback loops are not inherently bad — they create decisive outcomes and reward early skill. The problem is when they activate too early or too strongly, making the game feel decided before it's interesting.

### Negative Feedback Loops

A **negative feedback loop** helps losing players recover: falling behind gives advantages that make catching up easier.

**Mario Kart's item distribution** is the canonical example. Last place gets the best items (Blue Shell, Star, Bullet Bill). First place gets weak items (Coins, Green Shell). The loop compresses the field, keeping races competitive.

Negative feedback loops keep games competitive but can feel artificial. If the comeback mechanic is too powerful, skilled play feels pointless — you'll be punished for being good. The challenge is calibrating the loop so that deficit is meaningful and recoverable, but not self-reinforcing.

### The Design Challenge

Pure positive feedback = games decided early, trailing players disengage. Pure negative feedback = effort feels pointless, leading players disengage. Neither extreme serves the game.

**Middle ground approaches:**

- **Limited comeback mechanics**: Negative feedback that helps but doesn't guarantee recovery. Mario Kart's Blue Shell can be countered; it's not automatic.
- **Multiple victory paths**: A player losing on one axis can win on another. A trailing player in a 4X game might be militarily weak but economically dominant.
- **Resource diversity**: Multiple currencies that can't all be optimized simultaneously. A player who falls behind in one resource might have advantages in another.
- **Skill-gated catch-up**: Comeback mechanics that require skill to exploit. A fighting game's comeback mechanic (ultra meter) requires the player to execute a difficult combo — the advantage is available but not automatic.

---

## Subtractive Design

**Source:** David Sirlin, *Playing to Win*; general game design practice.

**The discipline**: For every mechanic, ask "does this create interplay with other mechanics?" If not, cut it.

This is the hardest discipline in game design. Designers resist removing features because of sunk cost — the time spent building the mechanic, the attachment to the idea. The question isn't "did we spend time on this?" It's "does the game improve without it?"

### The Complexity Budget

Every mechanic costs player attention. Players have a finite capacity to track rules, options, and states simultaneously. Mechanics that don't generate depth are spending that budget wastefully — they're consuming attention without returning meaningful decisions.

**The budget test**: If you removed this mechanic, would the game lose depth? If yes, the mechanic earns its place. If no, it's spending attention budget without contributing to the decision space.

### Identifying Candidates for Removal

- **Mechanics players ignore**: If players consistently skip or avoid a mechanic, it's not creating decisions. Either the mechanic needs to be made more relevant, or it should be removed.
- **Mechanics that only matter in edge cases**: A mechanic that's relevant in 1% of situations is spending complexity budget for 1% of the game. Unless that 1% is critical, the mechanic is a poor investment.
- **Mechanics that duplicate function**: If two mechanics serve the same strategic purpose, one is redundant. Keep the one with richer interactions; remove the other.

### The Courage to Cut

Subtractive design requires courage because it means admitting that work was wasted. The sunk cost fallacy is powerful — "we spent three months on this system, we can't cut it." But a mechanic that doesn't earn its place makes the game worse, regardless of how long it took to build.

**The reframe**: Cutting a mechanic that doesn't work is not wasting the work — it's completing the work. The work was to find out whether the mechanic belonged. It doesn't. The work is done.

For the relationship between subtractive design and depth/complexity ratio, see the "Depth vs Complexity" section in `depth-and-dynamics.md` if not already loaded.

---

## Game Economy Design

A game economy is any system where resources are earned, spent, converted, and lost. Understanding economy design is essential for balance — an economy that inflates or deflates will break the game's balance even if individual mechanics are well-tuned.

### Resources as Design Tools

Resources are decision axes. Each resource creates a question: how do I earn it, spend it, and convert it? Multiple resources create multiple decision axes — but more resources also means more complexity. Apply the depth/complexity test: does each resource create interplay with other resources, or does it exist in isolation?

### Sources and Sinks

Every resource needs both:

- **Sources**: Where the resource comes from. Killing enemies, completing quests, crafting, time-based generation.
- **Sinks**: Where the resource goes. Purchasing upgrades, paying costs, decay over time.

An economy without sinks inflates — resources accumulate faster than they're consumed, and their value drops. An economy without sources deflates — resources are consumed faster than they're generated, and the player runs out.

**The balance question**: Are sources and sinks in equilibrium? Is the equilibrium point interesting — does it create decisions about when to earn and when to spend?

### Economy Loops

The earn → spend → earn cycle is the fundamental economy loop. The loop should be satisfying at every stage:

- **Earning** should feel rewarding. The player should feel like their actions are generating value.
- **Spending** should feel meaningful. The player should feel like their choices matter.
- **The gap between earning and spending** is where decisions live. If the player always has exactly what they need, there are no decisions. If the player is always resource-starved, there's no agency.

### Multiple Currencies

Each currency creates a new decision axis. A game with gold (general currency), wood (building material), and food (unit upkeep) creates three axes that interact: you can spend gold to buy food, but gold spent on food isn't spent on units, which means your army is weaker, which means you earn gold more slowly.

**The complexity cost**: More currencies = more complexity. Each currency the player must track consumes attention budget. Apply the depth test: does this currency create interplay with other currencies, or does it exist in isolation?

### Inflation and Deflation

**Inflation**: Resources accumulate faster than they're consumed. Their value drops. Late-game gold in many RPGs is worthless because the player has more than they can spend. This is an economy design failure — the resource stopped creating decisions.

**Deflation**: Resources are consumed faster than they're generated. The player is always resource-starved. This can be intentional (survival games) or a failure (the player can't make progress because they're always broke).

**Exchange rates**: Can players trade one resource for another? Exchange rates create interplay between resource systems — a player who has excess gold but needs wood can convert, creating a decision about whether the exchange rate is worth it.

---

## Balancing Multiplayer Games

### Viable Options

Every option should be viable in some situation. If an option is never the best choice, it's not a real option — it's a trap for players who don't know better.

**The viability test**: For every option (weapon, character, strategy), ask: "Is there a situation where this is the best choice?" If yes, it's viable. If no, it needs to be buffed, redesigned, or removed.

Viable options don't mean equal options. A niche option that's the best choice in 5% of situations is viable. An option that's the best choice in 50% of situations is dominant (and probably needs to be nerfed).

### Fairness: Symmetric vs. Asymmetric

**Symmetric balance**: All players have the same tools. Chess is symmetric — both players have identical pieces. Fairness is structural.

**Asymmetric balance**: Players have different tools that are balanced against each other. StarCraft is asymmetric — Terran, Zerg, and Protoss have different units, buildings, and mechanics. Fairness is achieved through playtesting and tuning, not through structural equality.

Asymmetric balance is harder to achieve but creates richer play. Different factions create different skill profiles, different strategies, and different player identities. The challenge is ensuring that the asymmetry doesn't create dominant factions.

### Intuition

Players should be able to approximate good play intuitively. If optimal play is counter-intuitive, the design may be misleading players.

**Example**: If the optimal strategy in a resource game is to ignore the most visually prominent resource and focus on a secondary resource that looks less important, new players will consistently make the wrong choice. The design is communicating the wrong priorities.

Counter-intuitive optimal play isn't always wrong — sometimes the discovery of the non-obvious strategy is part of the game's depth. But if the counter-intuitive strategy is always optimal (not just sometimes), the design is misleading players about what matters.

### Playtesting

Balance cannot be designed in isolation — it must be discovered through play. Designers are not representative players. They know the game too well, they've played it too long, and they have emotional investments in specific mechanics.

**The playtesting principle**: Every balance decision should be validated by players who don't know the game. What feels balanced to the designer may feel broken to a fresh player, and vice versa.

---

## Worked Example: Mario Kart's Balance Systems

Mario Kart is a masterclass in applied balance design. It uses multiple overlapping systems to keep races competitive without making skill feel irrelevant.

### Negative Feedback Loop: Item Distribution

Item quality is inversely proportional to race position. Last place gets powerful items (Blue Shell, Star, Bullet Bill). First place gets weak items (Coins, Green Shell). This is a deliberate negative feedback loop — the game actively helps losing players and penalizes leading players.

**Why it works**: The loop compresses the field without eliminating skill. A skilled player in first place still wins more often than an unskilled player in first place — the items are a headwind, not a wall. The loop creates tension (the leader is always threatened) without making the outcome random.

**Contrast with Monopoly's positive feedback loop**: Early property acquisition → compound advantage → no meaningful decisions for trailing players. Monopoly's loop has no counterweight. Mario Kart's loop has a counterweight built in.

### Mixed Solutions: Real-Time Execution + Randomness

Even knowing the optimal racing line, optimal item usage, and optimal kart configuration, Mario Kart remains a mixed solution game. The item randomness means you can't predict what you'll receive. The real-time execution means you must react to other racers' positions and items. The optimal play depends on what's happening right now, not just on abstract knowledge.

**Contrast with a pure-solution racing game**: If items were deterministic and the optimal racing line were fixed, the game would degenerate into memorization. The randomness and real-time pressure prevent this.

### Secondary Economy: Coins

Coins are a secondary resource that boost top speed (reward skilled driving) but cap at 10 (prevent runaway advantage). This is a micro-economy with a built-in sink: coins are lost when hit by items.

The coin system creates a secondary decision axis: is it worth taking a risky shortcut that might cost coins? Is it worth using an item offensively if it means losing your coin advantage? The economy is simple but creates interplay with the primary race mechanics.

### The Balance Lesson

Mario Kart's balance works because each system addresses a different failure mode:
- Item distribution prevents runaway leads (positive feedback loop problem)
- Randomness prevents pure solutions (solvability problem)
- Coins create a secondary decision axis (depth problem)

No single system does all the work. The balance emerges from the interaction of multiple overlapping systems — which is itself a form of systemic design.

---

## Individual Empowerment

In multiplayer, outnumbered players face compounding disadvantages: more total health to burn through, more damage output converging on them, crossfire angles they can't cover. Games that want solo players to feel impactful must build empowerment in deliberately.

Three approaches that work:

- **Fast kill times**: Even in a 1v3, if you shoot first you win. CoD and CS reward positioning and awareness over raw numbers. The gun that finds the enemy first wins the fight.
- **Powerful utility**: Grenades, environmental damage, and abilities that let one player affect multiple enemies simultaneously. Halo's grenade/precision-weapon sandbox lets a skilled player thin a group before the close-range fight starts.
- **High-damage close-range tools**: Weapons that kill instantly at close range but require aggressive, risky positioning to use. Gears of War's Gnasher shotgun rewards players willing to close distance.

The failure mode: slow TTK combined with weak utility produces a teamshot meta. Solo players feel useless regardless of skill. Destiny 2's 4v4 era exemplified this — slow TTK plus weak grenades meant "whoever has more guns pointed at the same target wins." No individual action could overcome the numbers.

Empowerment ≠ high skill ceiling. It means moderate-skill solo players can impact matches meaningfully, not just survive them.

---

## Interruption Economy

Some competitive games replace resource accumulation with **negate management** as the primary skill axis. Rather than building up mana or units, players manage a limited budget of interruptions — counterspells, handtraps, frame traps. The core skill expression is baiting opponents into spending their interruptions on low-value plays, then resolving high-value plays through the opened gap.

This creates a distinct competitive dynamic: the player who exhausts their negates early loses to the patient opponent who saved theirs. Examples: Yu-Gi-Oh handtraps, fighting game frame traps baiting reversals, MTG counterspell wars, poker bluffing as bait.

**Design implication**: if your game has interruption mechanics, depth comes from knowing *when not to interrupt* — not from the interrupt itself.

---

## Diagnostic Questions

**Solvability:**
- Does the game have a dominant strategy? Can it be found through analysis alone?
- Is there hidden information, randomness, or real-time execution that prevents pure solutions?
- Are players reasoning about opponents, or just executing known-optimal play?

**Feedback loops:**
- Does winning create advantages that compound? Is there a counterweight?
- Does losing create recovery opportunities? Are they skill-gated or automatic?
- At what point in the game are outcomes typically decided? Is that too early?

**Subtractive design:**
- Which mechanics do players consistently ignore?
- Which mechanics only matter in edge cases?
- Which mechanics duplicate the function of another mechanic?

**Economy:**
- Does every resource have both sources and sinks?
- Are sources and sinks in equilibrium? Is the equilibrium point interesting?
- Does each currency create interplay with other currencies?

**Multiplayer balance:**
- Is every option viable in some situation?
- Is optimal play intuitive, or does it require overriding player intuitions?
- Has balance been validated by players who don't know the game?

For framework-level analysis of how balance relates to player experience, see the "Flow Theory" section in `player-experience.md` if not already loaded. For how systemic rules interact with balance, see the "Consistency" section in `systems-and-rules.md` if not already loaded.
