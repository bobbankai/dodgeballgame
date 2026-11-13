# Depth, Dynamics, and Skill Analysis

Deep-dive reference for what makes games deep, how dynamics emerge, and how to analyze skill requirements. Load this when diagnosing depth problems, analyzing skill spectrums, or evaluating whether a mechanic earns its complexity.

---

## Table of Contents

1. [Depth vs Complexity](#depth-vs-complexity)
2. [Interplay and Counterpoint](#interplay-and-counterpoint)
3. [Gameplay Dynamics](#gameplay-dynamics)
4. [Emergence](#emergence)
5. [DKART Deep-Dive](#dkart-deep-dive)
6. [Worked Example: MOBA Item Shop Depth Analysis](#worked-example-moba-item-shop-depth-analysis)
7. [Command Granularity](#command-granularity)
8. [Diagnostic Questions](#diagnostic-questions)

---

## Depth vs Complexity

**Source:** Richard Terrell, Critical Gaming blog (archived).

**Complexity** = the amount of stuff in a game. Rules, objects, options, inputs, systems. Complexity is countable.

**Depth** = the meaningful decision space arising from interplay between elements. Depth is not countable — it's a quality of the relationships between elements, not a count of the elements themselves.

The ratio that matters: **depth / complexity**. A game with high depth and low complexity is elegant. A game with high complexity and low depth is bloated. Adding complexity without adding depth is the most common design mistake.

### The Chess Benchmark

Chess has moderate complexity: 6 piece types, 64 squares, ~20 rules. But it has enormous depth because every piece interacts with every other piece and with the board state. The queen's value is not fixed — it depends on pawn structure, king safety, open files, endgame proximity. Every element changes the meaning of every other element.

Compare to a hypothetical game with 100 unit types, each with unique stats, but where units never interact — they just deal damage and die. High complexity, near-zero depth. The 100th unit type adds as much depth as the 1st.

### The Depth Test

Ask: does adding element X change how the player thinks about elements A, B, and C? If yes, X adds depth. If no, X adds complexity without depth.

Corollary: does removing element X reduce the meaningful decision space? If yes, X earns its place. If no, it's a candidate for subtractive design.

### Common Depth Killers

- **Dominant strategies**: If one approach is always optimal, the decision space collapses. Players stop thinking and start executing.
- **Parallel mechanics**: Mechanics that don't interact with each other. Each adds complexity; none adds depth.
- **Stat inflation**: More numbers that mean the same thing. A sword that does 10 damage vs 100 damage is not deeper — it's just bigger.
- **Scripted solutions**: When the designer pre-defines the answer to every problem, players aren't making decisions — they're discovering the designer's solution.

---

## Interplay and Counterpoint

**Source:** Richard Terrell, Critical Gaming blog. Concept borrowed from music theory.

**Counterpoint** (music): independent melodic voices that each follow their own harmonic logic, but create something richer when combined. Neither voice is subordinate to the other; both are complete on their own terms.

**Counterpoint** (games): independent mechanics that follow their own logic, but create emergent depth when combined. The test: each mechanic should be coherent in isolation AND create new decision space when combined with other mechanics.

### The Mario Counterpoint Analysis

Super Mario Bros. has four independent mechanical voices:

1. **Gravity**: constant downward pull. Mario falls unless supported.
2. **Ground enemies**: patrol horizontally, reverse at edges. Their logic is purely lateral.
3. **Platforms**: static geometry at varying heights. No logic of their own.
4. **Powerups**: change Mario's size and abilities. Their logic is about Mario's state.

Each is simple. Each follows its own rules. But combined:
- Gravity means jumping has commitment — you can't cancel a jump mid-air.
- Ground enemies mean lateral space is contested.
- Platforms mean vertical space is navigable but requires commitment (gravity).
- Powerups mean Mario's capabilities change, which changes how gravity and enemies interact with him.

The player must reason about all four simultaneously. A Goomba approaching from the right while a platform is above and a pit is to the left creates a problem that requires synthesizing all four voices. No single mechanic created this problem — the depth emerged from their interaction.

### Testing for Counterpoint

For any two mechanics A and B:
- Does A affect how the player uses B? If yes, they're in counterpoint.
- Does B affect how the player uses A? If yes, they're in counterpoint.
- If neither affects the other, they're parallel — they add complexity without depth.

**Example (counterpoint)**: In Hollow Knight, the nail (melee weapon) and the Soul system (magic resource) are in counterpoint. Hitting enemies with the nail generates Soul. Soul powers healing and spells. This means aggressive play (nail) enables defensive options (healing) and offensive options (spells). The two mechanics change each other's meaning.

**Example (parallel)**: In many RPGs, fire magic and ice magic deal the same damage to the same enemies with different visual effects. They're parallel — choosing between them is a cosmetic decision, not a strategic one. High complexity, no depth from the interaction.

---

## Gameplay Dynamics

**Source:** Richard Terrell, Critical Gaming blog.

Dynamics are the runtime behaviors that emerge from design elements interacting. They are not written by the designer — they arise. Three categories:

### Core Dynamics

Arise from fundamental design choices about space and time:

- **Space dynamics**: How the game world is structured. 2D top-down (all directions equally accessible), 2D side-scrolling (gravity creates asymmetry between up/down and left/right), 3D (full spatial reasoning required). The space type determines what kinds of problems are possible.
- **Time dynamics**: How time flows. Organic timers (resource depletion, decay rates), real-time (actions have duration and interrupt potential), turn-based (time is discrete and player-controlled). Time structure determines the cognitive load of decision-making.

### Artificial Dynamics

Rules that connect otherwise unrelated elements, creating dynamics that wouldn't exist from the core mechanics alone.

**Examples:**
- CO meters in Advance Wars: a resource that fills as you take damage, enabling special abilities. This connects the "losing" state (taking damage) to a potential advantage (CO power), creating a comeback mechanic and changing how players think about absorbing hits.
- Ultra meters in Street Fighter: similar structure. Being hit fills the meter. This means being on the defensive generates offensive resources, creating a tension between playing safe and spending meter.

Artificial dynamics are powerful but risky. Done well, they create depth by connecting disparate systems. Done poorly, they feel arbitrary — rules that exist without clear logic.

### Human Dynamics

Arise from the social structure of play:

- **Free-for-all**: Every player is an adversary. Kingmaking (helping a losing player to prevent a winning player from winning) becomes a dynamic.
- **Co-op**: Players share a goal. Communication and role specialization become dynamics.
- **Co-unter-op** (competitive cooperation): Players cooperate toward a shared goal while competing for individual advantage. MMO raiding is co-unter-op — the raid succeeds or fails together, but individual performance is tracked.

Human dynamics can create depth that no amount of mechanical design can replicate, because human opponents are not solvable.

### Games Without Dynamics

Some games have no dynamics in the technical sense:
- **Static puzzles**: The puzzle is fixed; the solution is fixed. No runtime emergence.
- **Rhythm games with fixed patterns**: The song is the same every time. The player's task is execution, not decision-making.

These aren't lesser games — they're different games. Recognizing the absence of dynamics clarifies what the game is actually asking of the player.

---

## Emergence

Emergence occurs when rules define challenges and tools without pre-defining solutions. The player discovers combinations the designer never anticipated.

**The design signal**: emergent games have strategy guides, not walkthroughs. A walkthrough tells you what to do. A strategy guide tells you how to think. If your game needs a walkthrough, it may not be emergent.

### Three Levels of Emergence

**Mechanical emergence**: Physics and object interactions produce unexpected results. Throwing an explosive barrel into a group of enemies in a physics-based game — the designer wrote physics and explosions separately; the combination is emergent.

**Systemic emergence**: Multiple systems interacting produce unexpected strategies. In Dwarf Fortress, the temperature system, the water system, and the enemy pathfinding system are each designed independently. A player who floods a corridor and then lowers the temperature to freeze the water, trapping enemies in ice, has discovered systemic emergence.

**Narrative emergence**: Stories arise from gameplay that the designer never wrote. In Spelunky, the shopkeeper's aggression mechanic (steal once, all shopkeepers become hostile forever) creates player stories about accidental theft, deliberate runs, and the moment everything went wrong. The designer wrote the rule; the story emerged.

### Designing for Emergence

- **Keep rules simple**: Complex rules are harder to combine in unexpected ways. Simple rules with clear logic are more combinable.
- **Maximize interconnections**: The more systems that interact, the more emergence is possible. Isolated systems produce isolated behavior.
- **Resist scripting outcomes**: Every scripted solution is a door closed to emergence. If the designer pre-defines the answer, the player can't discover a better one.
- **Trust the player**: Emergence requires player agency. A game that constantly corrects the player toward the "right" solution is suppressing emergence.

---

## DKART Deep-Dive

**Source:** Richard Terrell, Critical Gaming blog. Introduced in the SKILL.md; expanded here.

DKART maps the five skill domains a game can test. Each domain is independent — a game can demand high Dexterity and low Knowledge, or high Knowledge and low Reflex. The combination is the game's **skill spectrum**.

### Dexterity

Physical execution: speed, control, harmony (fine motor coordination between multiple inputs simultaneously).

- **Speed**: How fast must inputs be executed? Fighting game inputs require high-speed execution; turn-based strategy requires none.
- **Control**: How precisely must inputs be executed? A 360° aim system with variable power requires high control; a four-directional movement system requires low control.
- **Harmony**: How many inputs must be coordinated simultaneously? Playing a character with movement, aiming, and ability activation simultaneously requires high harmony.

### Knowledge

Understanding game objects, their properties, invisible rules, and strategies.

- **Object knowledge**: What does this enemy do? What does this item do?
- **Rule knowledge**: What are the invisible rules? (Iframes on dodge, hitbox sizes, damage formulas)
- **Strategic knowledge**: What are the optimal strategies? What counters what?

Knowledge is the only DKART skill that can be fully transferred outside the game — you can read a wiki. This is why knowledge-heavy games often have spoiler cultures: the knowledge is the game.

### Adaptation

Adjusting to changing conditions, reading the game state, modifying approach based on new information.

- **State reading**: Can the player perceive the current game state accurately?
- **Strategy modification**: Can the player change their approach mid-execution?
- **Prediction**: Can the player anticipate how the state will change?

Adaptation is what separates players who "know what to do" from players who "know what to do right now." A player with high Knowledge but low Adaptation knows the optimal strategy in the abstract but cannot apply it to the current situation.

### Reflex

Responding to unexpected stimuli. Reflex requires surprise — if the player can predict what will happen, they're using Timing, not Reflex.

- **Reaction time**: How quickly must the player respond?
- **Input selection**: How many possible responses exist? More options = higher cognitive load = harder reflex challenge.
- **Consequence severity**: How bad is a missed reflex? Instant death vs. minor setback.

Games that want to test Reflex must include genuine surprise. A boss with a fixed attack pattern tests Timing (you learn the pattern) not Reflex (you react to the unexpected).

### Timing

Executing actions at the right moment. Three types:

- **Static timing**: Fixed patterns. The enemy always attacks at second 3 and second 7. Learn the pattern, execute on schedule. Rhythm games are pure static timing.
- **Internal timing**: Resource management. Execute actions when resources are available, not when they're depleted. Managing stamina in Dark Souls is internal timing — the constraint is self-generated.
- **External timing**: Reactive to dynamic elements. Execute when the window opens, but the window is created by the game state, not a fixed schedule. Parrying in a fighting game is external timing — the window depends on the opponent's action.

**Momentum and timing complexity**: When a game adds momentum (velocity that persists between actions), timing becomes more complex because approach angle and speed become part of every decision. The BOOST mechanic from Station 38 (see "Example 2: Evaluating a Mechanic's Skill Profile" in the game-design skill) demonstrates this: the player must time the boost not just for the current position but for the trajectory it will create.

### Skill Spectrum Analysis

The **skill spectrum** is the range of DKART skills needed to play at a specific level. Three useful benchmarks:

- **Entry level**: What skills are needed to start playing?
- **Completion level**: What skills are needed to finish the game?
- **Mastery level**: What skills are needed to play optimally?

A narrow skill spectrum isn't inherently bad — it means the game is focused. A game that demands only Timing (rhythm game) serves players who want to develop that skill. But a whole game with one DKART profile may lose players who excel in other domains.

**Example**: Portal demands high Knowledge (understanding portal mechanics and spatial reasoning) and moderate Adaptation (applying knowledge to novel configurations), but low Dexterity, Reflex, and Timing. This is a deliberate choice — Portal is a puzzle game, not an action game. The narrow profile serves the design intent.

---

## Worked Example: MOBA Item Shop Depth Analysis

A MOBA item shop with 100+ items. Is this deep or just complex?

**The complexity is obvious**: 100 items, each with stats and passive effects. High complexity.

**The depth question**: Do items interact with each other and with the game state in ways that create meaningful decisions?

### Case 1: Stat Sticks (Low Depth)

If items are purely additive stat bonuses — +50 attack damage, +200 health, +15% attack speed — the decision is: which stats do I need most? This is a knowledge problem (know the optimal build) not a depth problem. Once you know the optimal build for your champion in your role, you execute it every game. The 100 items collapse to ~5 relevant choices.

High complexity, low depth. The item shop is a knowledge quiz, not a strategic system.

### Case 2: Interacting Items (High Depth)

Now imagine an item that converts a percentage of your maximum health into bonus attack damage. This item:
- Changes how health items work (health is now also offense)
- Changes how healing works (more healing = more sustained offense)
- Changes how the enemy team should build (armor becomes more valuable against you)
- Changes team composition decisions (supports who provide healing become more valuable)

One item that creates interplay across four other decision domains. This is depth. The item doesn't just add a stat — it changes the meaning of other items, other roles, and other strategies.

**The chess comparison**: A chess queen doesn't have a fixed value. Its value depends on pawn structure, king safety, open files, and endgame proximity. Every other piece changes what the queen is worth. MOBA items with interplay work the same way — their value is contextual, not fixed.

### Diagnosis

When evaluating an item shop (or any large collection of options):
1. Pick any two items. Does item A change how you think about item B? If yes, they're in counterpoint. If no, they're parallel.
2. Count the items that create interplay vs. items that are pure stat additions. The ratio is your depth/complexity score.
3. If most items are stat sticks, the shop is a knowledge problem, not a strategic system. Consider: fewer items with richer interactions, or items that explicitly modify other items.

---

## Command Granularity

The granularity of available commands should match the granularity of meaningful decisions. If the interesting decision is "which enemy to attack," fine-grained tile movement adds friction without depth — the player is executing, not deciding. If the interesting decision is "how to position," fine-grained movement IS the depth.

**The X-COM spectrum**: Original X-COM uses fine-grained Action Points — each move, turn, and shot costs AP independently. This creates emergent tactics (spend AP now for position vs. save AP for reaction fire) at the cost of high cognitive load. XCOM: Enemy Unknown collapses this to a move-or-shoot binary: lower overhead, fewer emergent moments. Neither is wrong; they serve different audiences and different depth profiles.

**Chess as the gold standard**: Every move is simultaneously a tactical command and a strategic decision. There is zero gap between command granularity and decision granularity — you cannot issue a command that contains no decision.

**Diagnostic**: For each command the player can issue, ask: is there a meaningful decision embedded in this command, or is it execution overhead between decisions? Execution overhead is not always bad — it can create pacing and tension — but it should be a deliberate choice, not an accidental one.

---

## Diagnostic Questions

When diagnosing depth problems, work through these:

**Depth/Complexity ratio:**
- How many mechanics does the game have? (complexity)
- How many mechanics interact with each other? (depth potential)
- Can you remove any mechanic without reducing the decision space? (subtractive test)

**Interplay:**
- For any two mechanics, does A change how the player uses B?
- Are there mechanics that exist in isolation — parallel rather than counterpoint?
- What's the most interesting combination of mechanics in the game? If you can't name one, depth may be low.

**Emergence:**
- Has a player ever done something you didn't anticipate?
- Does your game have a strategy guide or a walkthrough?
- Are there multiple valid approaches to the same problem?

**Skill spectrum:**
- Which DKART skills does your game test?
- Is the spectrum appropriate for your target audience?
- Does the skill demand change as the player progresses, or is it constant?

For framework-level analysis of these concepts, see the "MDA Framework" and "DDE Framework" sections in `frameworks.md` (if not already loaded). For player motivation and how skill demands relate to player experience, see the "Player Motivation Models" section in `player-experience.md` (if not already loaded).
