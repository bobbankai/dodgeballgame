---
name: "game-design"
summary: "Frameworks for analyzing mechanics, game feel, player motivation, and systemic design"
type: "design"
description: "You MUST consult this skill when reasoning about or evaluating game design decisions — analyzing mechanics, diagnosing why a design feels wrong or shallow, evaluating whether a mechanic is interesting, or discussing game feel, player motivation, balance, or systemic design. Also trigger when a game feels one-note, shallow, or like every other game in its genre. NOT for engine-specific implementation (see godot, love2d) or shader/VFX work (see godot-shader)."
---

# Game Design

Vocabulary and frameworks for reasoning about game design problems — what to build and why.

---

## Core Vocabulary

### Understanding Your Design

**Design / Dynamics / Experience** — From the DDE framework (Walk, Görlich, Barrett 2017). *Design* is what the designer controls: blueprint, rules, interface. *Dynamics* are the runtime behavior that emerges when design elements interact with player input and each other. *Experience* is what the player perceives — sensory, emotional, intellectual. Work at the design layer (write rules, set parameters, define interfaces); evaluate outcomes at the experience layer.

**Depth vs Complexity** — Depth is the meaningful decision space created by interplay between mechanics. Complexity is the raw count of rules, objects, and options. Good design maximizes the ratio of depth to complexity. A game can have 3 mechanics and enormous depth, or 30 mechanics and feel shallow.

**Emergence** — Non-obvious outcomes from combining simple rules. When a system's behavior cannot be predicted by examining individual rules in isolation. The foundation of replayability in systemic games — players discover new combinations rather than exhausting a fixed set of outcomes.

**Interplay / Counterpoint** — How mechanics interact to create depth. Borrowed from music theory: independent voices that follow their own logic but create something richer when combined. A mechanic that doesn't interact with other mechanics contributes complexity without depth. The test: remove the mechanic — does the remaining game lose depth, or just lose content?

### Understanding Your Player

**Player-Subject** — From Sicart (2009). The mental persona that actually plays the game — not the full human, but a subset with different abilities, ethics, and risk tolerance. The Player-Subject can make decisions the real person never would (betray an ally, sacrifice a unit). Designers target the Player-Subject, not the player directly. This distinction matters when designing moral choices, risk systems, and difficulty.

**DKART** — Dexterity, Knowledge, Adaptation, Reflex, Timing. From the Critical Gaming blog (Richard Terrell, archived). The five skill domains a game can test. Analyzing which DKART skills a mechanic exercises reveals whether your game has a rich or narrow skill spectrum. A narrow profile isn't inherently bad — it means the mechanic is focused — but a whole game with one DKART profile may lack variety.

**4 Keys to Fun** — From Nicole Lazzaro (XEODesign). Hard Fun (challenge/mastery), Easy Fun (curiosity/exploration), People Fun (social interaction), Serious Fun (meaning/value). Most successful games serve multiple keys. Useful for diagnosing why a game feels one-note — it's usually serving only one key.

**Invisible Onboarding** — Teaching indistinguishable from playing. The best tutorial provokes "there was a tutorial?" from players. Achieved through structural decisions (economy design, mechanic pacing), play-based learning, and adaptive guidance that appears only when needed. The test: if you must label something "Tutorial," the onboarding has failed. Distinct from Perceived Affordances (which is whether a thing *looks* like what it does) — Invisible Onboarding is whether the *act of teaching* is invisible.

**Perceived Affordances** — Can the player intuit what interactions are possible by looking at the game? Spiky things should look dangerous. Flammable things should look flammable. When affordances are clear, players discover rules through play instead of tutorials. When affordances are opaque, players feel cheated by deaths they couldn't predict.

**Investment Curve** — Player willingness to absorb new information is proportional to their existing investment in the game. At minute 1, tolerance for teaching is near-zero — players need to be playing immediately. At level 45, a 3-minute tutorial for an optional mode is acceptable because the player is committed. Governs *when* to introduce peripheral mechanics, complex stores, optional modes, and character-heavy exposition. The corollary: make the right action the most available action early on, because you cannot rely on the player understanding *why* it's right.

### Evaluating Your Design

**Solvability** — From Sirlin. *Pure solutions* (one best strategy) cause games to degenerate into memorization. *Mixed solutions* (optimal play involves probability distributions) keep games strategically alive. Hidden information, randomness, and real-time execution all push toward mixed solutions. Ask: can a player find a dominant strategy and stop thinking?

**Slippery Slope** — When falling behind makes it harder to catch up, creating a negative feedback loop. The opposite — rubber-banding — can feel artificial. Good designs find middle ground: deficit is meaningful and recoverable, but not self-reinforcing.

**Subtractive Design** — Removing elements to improve the whole. If a mechanic doesn't create interplay with other mechanics, it adds complexity without depth. The discipline of asking "what can I remove?" rather than "what can I add?" A mechanic that survives subtractive scrutiny earns its place.

**Ludo-narrative Coherence** — The embedded narrative (designer-authored story) and the emergent narrative (story arising from dynamics) must harmonize. When they conflict, the player experiences dissonance — the Antagonist (the unified source of challenge: enemy, environment, puzzle, or the player's own limitations) becomes inconsistent. Coined by Clint Hocking (2007); applied here via the DDE framework.

**Game Feel** — How responsive and satisfying moment-to-moment interaction feels. Achieved through feedback layering: animation, sound, camera, particles, hitpause, screenshake. A well-designed mechanic with poor game feel still fails. Distinct from whether the mechanic is strategically interesting — both layers matter independently.

**Design Hook** — The unique, specific thing that makes a game different from everything else that already exists. Not a genre description, not production values, not design pillars — the one mechanic, constraint, or combination that produces a new type of decision or experience. A game without a clear hook cannot be explained in one sentence and cannot be differentiated from competitors. The test: "Why would someone buy this instead of what's already out there?" See `references/design-communication.md`.

**Difficulty ≠ Quality** — Difficulty and quality are orthogonal axes. A higher skill ceiling is not automatically a better game. The designer's job is an operative theory of *good*, not an operative theory of *hard*. The exchange rate between what a game demands and what it returns is the relevant metric. See `references/craft-and-refinement.md`.

**Idea Density** — The count of distinct ideas surfaced per N levels or encounters. A low idea density means the game is not mining its own mechanic's depth — the same lesson is being repeated rather than extended. A useful diagnostic when a game feels exhausted before its content runs out. See `references/craft-and-refinement.md`.

**Contrivance Budget** — Every rule adds "weight" measured in the player's cognitive cost. A rule must return more than the weight it adds. The minimum discipline is noticing how much you're adding. Pace contrivance modularly so internalized rules stop feeling like contrivance and the budget resets. See `references/craft-and-refinement.md`.

### Building Your Systems

**Cursed Problem** — From Alex Jaffe (GDC 2019). A design problem with no good solution, only least-bad tradeoffs. Arises when two core player promises are logically incompatible — not just hard to satisfy simultaneously, but structurally contradictory. Recognizing a cursed problem prevents wasting months searching for a solution that doesn't exist. The four responses: barriers (make the problematic behavior impossible), gates (make it difficult), carrots (change the objective), s'mores (lean into the behavior and make it the game). See `references/cursed-problems.md`.

**Push-Forward Loop** — A system architecture where the optimal strategy is always aggressive engagement. Resources replenish through combat, not through waiting; enemies punish passivity; movement is mechanically safer than cover. The loop: engage → kill → gain resources → must engage again. Generalizes beyond combat to any system where you want players to move forward rather than retreat or optimize passively.

**Mechanics-as-Meaning** — From Soren Johnson (GDC 2010). A game's mechanics determine what it is actually about, regardless of theme. When mechanics and theme conflict, mechanics win — players follow the optimal path, not the intended narrative. Risk is about risk (probabilistic combat). Diplomacy is about diplomacy (simultaneous turns). Super Mario Bros. is about timing, not plumbing. Designing a game to be "about" something requires making that thing the mechanically optimal or most engaging path. See `references/design-principles.md`.

**Permissions / Restrictions / Conditions** — Three rule types for systemic design. *Permissions*: what you can do ("wood burns"). *Restrictions*: exceptions to permissions ("water douses flames"). *Conditions*: the framework for the other two ("most wood is in the forest"). Simple rules in each category combine into complex emergent behavior. The key: keep each rule simple; let combinations do the work.

**Consistency** — Rules must behave the same everywhere. Three aspects: *Predictability* (same inputs → same outputs), *Coherence* (rules work the same in all areas of the game), *Variability* (consistency enables mixing things up because players can reason about outcomes). Inconsistency is the primary source of exploits in systemic games.

**Choice Architecture** — How options are structured and presented to players. The number of simultaneous options has cognitive consequences grounded in subitizing (instant perception of 1-4 items), working memory limits (5-7 comfortable, 8+ feels boundless), and the decoy effect (a contextually inferior option makes the remaining choices feel more satisfying). Three is the minimum count that supports the decoy pattern while staying within effortless perception. See `references/choice-architecture.md`.

**Draw-Forward Formula** — From Dan Felder (ex-Legends of Runeterra / Hearthstone designer). A synergy design pattern: give a component a meaningful drawback, then offer a second component that converts that drawback into an advantage. Players perceive the combination as a discovery rather than a power addition — the psychological satisfaction comes from transforming bad-into-good, not from raw stat increases. Grounded in loss aversion (Kahneman/Tversky) and the "free" effect (Ariely). See `references/design-principles.md`.

---

## Problem → Concept Routing

| Problem | Concepts | What to Check |
|---|---|---|
| "My game feels shallow/repetitive" | Depth vs Complexity, Interplay | Are mechanics interacting with each other, or existing in isolation? |
| "Players solve it and stop playing" | Solvability | Pure vs mixed solution? Add hidden information, randomness, or real-time execution |
| "Combat/interactions feel flat" | Game Feel, DKART | Is feedback layering adequate? Which skill domains are being tested? |
| "Players keep finding exploits" | Consistency, Permissions/Restrictions | Are rules applied uniformly? Look for inconsistent restrictions |
| "The story feels disconnected from gameplay" | Ludo-narrative Coherence, Player-Subject | Do embedded and emergent narratives harmonize? Is the Antagonist consistent? |
| "My game has too many mechanics" | Subtractive Design, Depth vs Complexity | Which mechanics don't create interplay? Cut them |
| "Players don't understand the systems" | Perceived Affordances, Consistency | Can players discover rules through play? Are affordances clear? |
| "Falling behind feels hopeless" | Slippery Slope | Is there a negative feedback loop? Are comeback mechanics possible without feeling artificial? |
| "The game is fun but I can't explain why" | 4 Keys to Fun, DKART, Emergence | Which keys does it serve? What skills does it test? Where does emergence happen? |
| "My game feels like every other [genre] game" | Interplay, Counterpoint, Subtractive Design | What unique interplay exists? What conventions can you subtract? |
| "Players aren't motivated to continue" | 4 Keys to Fun, Player-Subject | Which emotional needs are unserved? Does the Player-Subject have meaningful agency? |
| "Players aren't discovering or engaging with synergies" | Draw-Forward, Interplay | Are individual components strong-with-drawback, or just weak? Does finding the combo feel like a discovery? Check `references/design-principles.md` |
| "The difficulty feels wrong" | DKART, Slippery Slope | Which skills are overtaxed? Is challenge calibrated to skill growth? |
| "Players quit in the first few minutes" | Invisible Onboarding, Investment Curve | Is the game playable immediately? Are you front-loading teaching? Check `references/onboarding.md` |
| "My tutorial feels heavy or forced" | Invisible Onboarding | Is the teaching labeled, separated, or interruptive? Can it be structural instead? Check `references/onboarding.md` |
| "We've been iterating for months and can't solve this design problem" | Cursed Problem | Are two core player promises logically incompatible? If yes, stop looking for a solution — choose a sacrifice. Check `references/cursed-problems.md` |
| "Players retreat or play passively instead of engaging" | Push-Forward Loop | Does your resource system reward engagement or passivity? Are enemies punishing standing still? Check `references/push-forward-design.md` |
| "The game's theme doesn't match how it actually plays" | Mechanics-as-Meaning, Ludo-narrative Coherence | What does the game mechanically reward? Is that the same as what the theme promises? Check `references/design-principles.md` |
| "I can't explain what makes my game unique" | Design Hook | Can you state the hook in one sentence? Does the moment-to-moment play demonstrate the differentiating idea? Check `references/design-communication.md` |
| "My game feels shallow after players exhaust the content" | Live Design, Emergence, Solvability | Is there a content cadence that brings players back? Are there multiple axes of randomness? Check `references/live-design.md` |
| "Players feel overwhelmed by choices" or "How many options should I offer?" | Choice Architecture | Are you above the subitizing range (4)? Is there structural support for narrowing (archetypes, rarity, resource gating)? Check `references/choice-architecture.md` |
| "Players don't feel good about their picks" | Choice Architecture, Decoy Effect | Is there a contextually inferior option making the real choices feel satisfying? Is the decoy's inferiority obvious at a glance? Check `references/choice-architecture.md` |
| "I want to add procedural generation but don't know where to start" | Procedural Design | What specifically are you generating? Which method fits the content type? Check `references/procedural-design.md` |
| "My game world feels arbitrary or inconsistent" | World Design, Consistency | Are you conforming to reality where you have no reason not to? Are you simulating the previous game instead of reasoning from first principles? Check `references/world-design.md` |
| "Players aren't engaging with the moral choices in my game" | Mechanics-as-Meaning, Ludo-narrative Coherence | Do the mechanics support the moral weight, or does the optimal path undermine the intended choice? Check `references/design-principles.md` |
| "My narrative creates urgency but players ignore it" or "Players rush the main quest and skip side content" | Urgency Mismatch, Ludo-narrative Coherence | Does your game have real consequences for delay, or is the urgency purely narrative? Check `references/narrative-integration.md` |
| "The game opens well but players feel like they've seen everything by level 5" | Idea Density, Depth vs Complexity | Are you surfacing new ideas per level, or repeating the same lesson? Check `references/craft-and-refinement.md` |
| "My game is hard but players say it doesn't feel worth it" | Difficulty ≠ Quality, Game Feel | Is the difficulty paid back with interesting situations? Is the exchange rate positive? Check `references/craft-and-refinement.md` |
| "Players complain about controls but I can't reproduce the problem" | Input Feel, Game Feel | Are you playing differently than your players (discrete taps vs hold-and-time)? Check `references/craft-and-refinement.md` |
| "I've been designing in a doc but the prototype doesn't match the vision" | Anti-GDD, Design Artifacts | Does the design live in the playable build? Check `references/craft-and-refinement.md` and `references/design-artifacts.md` for the counterpoint |
| "Some parts of my game feel polished but others feel weak" | Marginal Parts, Production Value | Are you polishing the already-good parts? Concentrate effort on the marginal ones first. Check `references/craft-and-refinement.md` |

---

## Worked Examples

### Example 1: Diagnosing a Shallow Design

**Scenario**: "My platformer has 20 enemy types but combat feels repetitive."

Apply **depth vs complexity** and **interplay**. Twenty enemies that all walk toward the player and deal contact damage = high complexity, low depth. The enemies don't interact with each other or with level geometry — they're parallel, not counterpoint.

Depth comes from enemies that create interplay. Spelunky's enemy roster is small but deep — consider three enemy types: one that drops from ceilings, one that patrols the ground, one that flies toward the player with erratic pathfinding. None of these is complex in isolation. But combine them: the ceiling-dropper lands near the ground-patroller, potentially sending it toward the player, who jumps to dodge and triggers an arrow trap. No single enemy caused this — the depth emerged from their interaction.

**Diagnosis**: Don't add more enemy types. Redesign existing enemies so they interact with each other and with level geometry. Three enemies with rich interplay beat twenty that exist in parallel.

---

### Example 2: Evaluating a Mechanic's Skill Profile

**Scenario**: "Is this mechanic interesting enough?"

Apply **DKART** to map the skill profile. Use the BOOST mechanic from Station 38 (Critical Gaming analysis) as a model: click-drag to set direction and power.

- **Dexterity**: High — 360° aim with variable power creates ~17,000 distinct input combinations
- **Knowledge**: Moderate — learn object properties, fuel consumption rates
- **Adaptation**: Moderate — adjust to level geometry and current momentum state
- **Reflex**: Low — static levels, no surprises requiring instant reaction
- **Timing**: High — progressive momentum means approach angle and speed change every maneuver

A narrow DKART profile isn't a flaw — it means the mechanic is focused. But if the whole game shares the same narrow profile, it may lack variety for players who excel in different skill domains. Use DKART to check whether your game's skill demands match your target audience.

---

### Example 3: Checking Rule Consistency

**Scenario**: "Players keep finding exploits in our systemic game."

Apply **consistency** through the **permissions/restrictions/conditions** lens. The most common cause: a material is flammable in one area but not another, or a physics interaction works on some objects but silently fails on others.

Audit process:
1. List all permissions ("wood burns", "enemies can be knocked back", "water conducts electricity")
2. For each permission, verify the restriction and condition boundaries are applied uniformly
3. If "wood burns" is a permission, does ALL wood burn? If not, the exception needs to be a clearly communicated restriction ("wet wood doesn't burn"), not an invisible inconsistency

Invisible inconsistencies feel like exploits to players who discover them and like bugs to players who get burned by them. Explicit restrictions feel like depth — players learn the rule and use it strategically.

---

## Design Analysis Checklist

Run these questions when evaluating a design:

**Depth**: Where does depth come from? Which mechanics create interplay? Could you remove a mechanic without losing depth — and if yes, should you?

**Skill**: What DKART skills does your game test? Is the skill spectrum narrow or broad? Does it match your target audience?

**Motivation**: Which of the 4 Keys does your game serve? Does it serve more than one? Which player needs are unserved?

**Rules**: Are your rules simple, intuitive, and consistent? Can players discover them through play, or do they require tutorials?

**Narrative**: Do embedded and emergent narratives harmonize? Is the game a consistent Antagonist?

**Feel**: Does moment-to-moment interaction feel responsive and satisfying? Is feedback layered appropriately?

**Onboarding**: Can a new player reach minute 5 without reading a word? Does the game's structure guide correct behavior without explanation? Are mechanics introduced at a rate matching the investment curve?

---

## References

| File | Contents | Read when... |
|---|---|---|
| `references/frameworks.md` | MDA, DDE, Schell's Tetrad, Costikyan, Lazzaro | You need full framework context or want to analyze a game through multiple lenses |
| `references/depth-and-dynamics.md` | Interplay, counterpoint, complexity vs depth, emergence, DKART deep-dive | You're diagnosing depth problems or analyzing skill spectrums |
| `references/player-experience.md` | 4 Keys to Fun, flow theory, player motivation, game feel, communicating rules | You're evaluating player experience, motivation, difficulty, or game feel |
| `references/systems-and-rules.md` | Systemic design, permissions/restrictions/conditions, state-space decomposition | You're designing rule systems or building a systemic game |
| `references/balance-and-competition.md` | Solvability, slippery slope, subtractive design, economy design | You're tuning balance, competitive design, or resource systems |
| `references/narrative-integration.md` | Ludo-narrative coherence, embedded vs emergent narrative, Player-Subject, Antagonist | You're integrating story with gameplay or diagnosing narrative dissonance |
| `references/design-artifacts.md` | One-page designs, state-space maps, commitment artifacts, game loops | You need to document or communicate design decisions |
| `references/onboarding.md` | Invisible onboarding techniques, investment curve, adaptive messaging, mechanic pacing, economy-as-guidance, writing style | You're designing how a game teaches itself, players aren't learning mechanics, or early retention is poor |
| `references/cursed-problems.md` | Taxonomy of unsolvable design tensions, player promises, four sacrifice techniques (barriers/gates/carrots/s'mores), canonical examples | You've been iterating on a design problem for months without progress, or two core promises seem incompatible |
| `references/push-forward-design.md` | Push-forward as a motivation system, resource scarcity loops, threat management, enemy design for aggression, failure conditions | Players are retreating or playing passively; you want combat or engagement to feel aggressive and rewarding |
| `references/design-principles.md` | Rosewater's MTG design lessons (selected from GDC 2016 talk), mechanics-as-meaning (Soren Johnson), player psychographics, restrictions breed creativity, theme vs. meaning, Draw-Forward Formula (Dan Felder) | Making high-level design philosophy decisions, evaluating whether a mechanic serves its game, diagnosing theme/mechanic misalignment, designing synergy systems |
| `references/world-design.md` | First-principles persistent world design, immersion through consistency, simulation vs. abstraction, achievement system design, setting as resonance/dissonance | Designing persistent worlds or multiplayer spaces; diagnosing why a world feels arbitrary or inconsistent |
| `references/live-design.md` | Content cadence, 13-week league model, economy resets, marketing threshold, player psychographic targeting, ethical monetization | Designing a game-as-a-service, planning content release schedules, diagnosing player number decline |
| `references/design-communication.md` | Hook identification, moment-to-moment clarity, common pitch pitfalls, one-sentence game description, scope communication | Pitching a game concept, evaluating whether a design has a clear identity, diagnosing why a game is hard to explain |
| `references/choice-architecture.md` | Decoy effect, option count thresholds (2/3/4/5/8), subitizing, player heuristics, analysis paralysis, compression techniques | Deciding how many options to present at a choice point, or diagnosing why choices feel overwhelming or unsatisfying |
| `references/procedural-design.md` | PCG method catalog (tiles/grammars/distribution/parametric/interpretive/simulation), subtractive methods, oatmeal problem, ownership design, multiple axes of randomness | Considering procedural generation for any system; diagnosing why generated content feels shallow or repetitive |
| `references/craft-and-refinement.md` | Openings/first-impression friction, difficulty vs quality (exchange rate), idea density, contrivance budget, marginal-parts heuristic, production value, input feel, silent playtesting, anti-GDD counterpoint, evaluation lenses | A game's opening isn't landing; a mechanic feels exhausted or shallow; difficulty is calibrated wrong; you need a process check on whether you're building the right thing |

---

## Relationship to Other Skills

**game-patterns** — Implementation patterns. game-patterns says "use the State pattern for entity behavioral modes." This skill says "your entity needs distinct behavioral modes" — and explains *why* that's the right design decision. They co-trigger; this skill informs the design choice, game-patterns informs the implementation.

**godot / love2d** — Engine-specific implementation. This skill is engine-agnostic. When both fire, the engine skill handles concrete code; this skill handles design reasoning.

**brainstorm** — Ideation process. This skill provides the domain vocabulary that brainstorm sessions draw on. They co-trigger naturally: brainstorm drives the conversation, game-design provides the concepts to reason with.
