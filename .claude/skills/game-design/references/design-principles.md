# Design Principles

Generalizable design philosophy from two complementary sources: 20 years of Magic: The Gathering design and a systematic analysis of how game mechanics communicate meaning. Load this when making high-level design decisions, evaluating whether a mechanic serves its game, or diagnosing why a design feels philosophically off.

---

## Part I: Rosewater's Design Principles

**Source:** Mark Rosewater, "Magic: The Gathering: 20 Years, 20 Lessons Learned" (GDC 2016).


### Work With Human Nature, Not Against It

Players come with a complex operating system. When your game fights human instincts, the game loses. Change your game to match your players, not the other way around.

*MTG example:* Players kept trying to attack with a creature that couldn't attack. The solution wasn't better communication — it was changing the rules to let them attack.

**Corollary:** Don't confuse "interesting" with "fun." Intellectual stimulation (interesting) and emotional satisfaction (fun) are different. Players make decisions based on emotion, not logic. Design for emotional response.

### Aesthetics Matter

Humans perceive things in specific ways. Balance, symmetry, pattern completion — these aren't arbitrary preferences, they're how the brain processes the world. When your game violates aesthetic expectations without intent, it distracts players from the actual experience.

*MTG example:* A card with stats of 7/7 costing 8 mana that let you pay 7 life to draw 7 cards felt wrong aesthetically — the sevens didn't align with the cost. Players complained even though the card was powerful and flavorful.

### Resonance Is a Teaching Tool

Players come preloaded with emotional responses to existing concepts. Zombies, dragons, fire — these carry meaning before the player reads a single rule. Use resonance to:
1. Create emotional attachment (players bond with things they already care about)
2. Front-load learning (piggybacking: "it flies" teaches the Flying mechanic instantly)

*Example:* Plants vs. Zombies chose plants (can't move) and zombies (come in waves) specifically because those choices taught the core mechanics without explanation.

### Allow Ownership and Exploration

Players bond most deeply with things they discover and claim as their own. Don't always show players what you want them to see — let them find it.

- Provide choices (colors, builds, paths, expressions)
- Allow customization that creates "their" version of the game
- Leave room for players to discover combinations you didn't anticipate

*MTG example:* The Commander format was invented by players, not designers. Wizards recognized it and supported it. The format became one of the most popular in the game's history.

### Details Are Where Players Fall in Love

What seems insignificant to the designer may be the thing that makes a player fall in love with the game. A tiny creature in the background of a card illustration became a beloved character because players found it and claimed it. Every detail matters to someone.

### Design for Specific Audiences

When you aim to please everyone, you please no one. Each component should be designed for the player it's intended for. A card designed for Timmy (visceral thrill) and a card designed for Spike (competitive optimization) will conflict if you try to make them the same card.

**Player psychographics (Rosewater's model):**
- **Timmy/Tammy** — wants to experience something; visceral thrill, emotional bonding
- **Johnny/Jenny** — wants to express something; showing others who they are through the game
- **Spike** — wants to prove something; the game is a tool to demonstrate capability

### Restrictions Breed Creativity

The myth: more options = more creativity. The reality: the brain solves problems using existing neural pathways. Constraints force new pathways.

*MTG example:* Theme weeks (write about goblins) produce better columns than open-ended weeks. Constrained set designs (only two-color pairs) produce more innovative mechanics than open-ended ones.

**Practical application:** If you're stuck, add a constraint. If your design space feels exhausted, change the starting point.

### Small Changes Can Change Everything

You don't have to change much to create a radically different experience. Invasion and Ravnica are both multicolor sets — but changing "play as many colors as possible" to "play exactly two colors" created an entirely different game.

**The peas principle:** Game designers keep adding more. Ask instead: how little do I need to add? One well-chosen change beats ten incremental additions.

### Be More Afraid of Boring Than Challenging

When you try something ambitious and fail, players forgive you — they respect the attempt. When you bore players, they resent it. Boring is not a safe choice; it's a costly one.

### Players Identify Problems; Designers Solve Them

Players are excellent at recognizing when something feels wrong. They are poor at diagnosing why or proposing solutions — they don't know your tools, constraints, or design space. Use player feedback to identify what's broken; use your design knowledge to determine the fix.

### Make the Fun Part the Correct Strategy

The game implicitly promises: "If you do what the game tells you to do, you'll have a good time." When the optimal strategy is unfun, you've broken that promise. Players will follow the optimal path even if it's miserable, then blame the game.

*MTG example:* The "gotcha" mechanic made the optimal strategy "don't talk, don't laugh, don't interact" — the opposite of fun.

---

## Part II: Johnson's Mechanics-as-Meaning

**Source:** Soren Johnson, "Theme is Not Meaning" (GDC 2010).

### Theme Is Not Meaning

A game's theme is its skin — the setting, characters, visual presentation. A game's **meaning** is what the mechanics actually communicate through play.

These can diverge dramatically. When they do, the mechanics win. Players experience what the rules make them do, not what the story tells them they're doing.

*Examples:*
- Risk is about risk (probabilistic combat, sequential turns). Diplomacy is about diplomacy (simultaneous turns, deterministic combat). Same theme, radically different meaning.
- Super Mario Bros. is about timing, not plumbing.
- Peggle is about chaos theory, not unicorns.
- Left 4 Dead is about teamwork, not zombies.

### Mechanics Determine What a Game Is About

The rules define the actual experience. Two games with identical themes but different mechanics are fundamentally different games. Two games with different themes but identical mechanics are fundamentally the same game.

*Starcraft vs. Warcraft:* Starcraft (different mechanics, same genre) is the mechanical descendant of Warcraft. World of Warcraft (same theme, different mechanics) is a fundamentally different game.

### Players Optimize the Fun Out

When mechanics and theme conflict, players follow the mechanics. If the optimal strategy contradicts the intended experience, players will pursue the optimal strategy and feel cheated by the experience.

*BioShock example:* The game presented a moral choice (harvest vs. rescue Little Sisters). But the mechanics made the "good" choice mechanically competitive or superior in the long run. Players saw through it — the "choice" lacked weight because the mechanics didn't create a genuine dilemma.

**Design implication:** If you want your game to be about something, the mechanics must make that thing the optimal or most engaging path. Theme alone cannot carry meaning.

### Theme Matters for Framing, Not Meaning

Theme is not irrelevant — it shapes player expectations, creates resonance, and determines the cultural context of the game. But theme cannot substitute for mechanical meaning.

A game about the Holocaust requires mechanics that make players experience what it felt like to be complicit — not just a reskin of a neutral mechanic. The redistricting game (Gerrymandering) works because the mechanics make you do the thing the game is about.

### Align Theme and Meaning

The most powerful games are those where theme and mechanics reinforce each other — where doing the thing the game is about is also what the mechanics reward.

*Diagnostic question:* What is your game actually about, mechanically? Is that the same as what you say it's about thematically? If not, which one do you want to be true — and how do you change the other to match?

---

## Synthesis: The Two Principles Together

Rosewater and Johnson are describing the same phenomenon from different angles:

- Rosewater: Design for emotional response. Make the fun part the correct strategy. Work with human nature.
- Johnson: Mechanics determine meaning. Players follow optimal paths. Theme cannot override what the rules reward.

Together: **Your game is what your mechanics make players do. Design the mechanics to make the right thing feel right.**

---

## Draw-Forward Formula

**Source:** Dan Felder (ex-Legends of Runeterra / Hearthstone designer).

Create an option with a significant upside and a meaningful drawback (+2/-1). Then offer a second option that converts the drawback into an advantage. The player perceives massive value (+3) even when the net outcome is equivalent to simpler alternatives.

**Cognitive basis:** Loss aversion (Kahneman/Tversky) combined with the "free" effect (Ariely). Removing a negative feels like gaining a positive, so the brain double-counts the benefit. A drawback-that-becomes-advantage triggers a discovery/cleverness response that flat power never achieves.

**Game examples:**
- *Magic: The Gathering* — Lightning Axe (discard a card to cast for {R} instead of {5}{R}, dealing 5 damage) + Roar of the Wurm (costs less when cast from graveyard). The discard "cost" becomes fuel.
- *Pokémon* — Flame Orb (burns the holder) + Guts ability (attack boost when statused). The item's "downside" activates the payoff.
- *Slay the Spire* — Rupture (gain Strength when you lose HP from a card) + Offering/Brutality (lose HP for cards/draw). Self-damage becomes a build-around.
- *Path of Exile* — Unique items with harsh drawbacks that specific builds convert into advantages.

**Design application:** When building synergy systems, front-load drawbacks on individual components so that combinations feel like discoveries. Players who find the combo feel clever; players who don't still have functional (if suboptimal) pieces. The key insight: synergy satisfaction comes from perceived transformation of bad-into-good, not from raw power addition.

---

## Diagnostic Questions

**Emotional response:**
- What emotion is your game trying to evoke? Does every mechanic contribute to that emotion?
- Is the fun part the correct strategy, or does optimal play feel unfun?
- Are you designing to prove you can do something, or to deliver the best experience for your audience?

**Human nature:**
- Are you fighting human instincts, or working with them?
- What do players want to do when they first pick up your game? Does the game let them do it?
- Are you confusing "interesting" (intellectual) with "fun" (emotional)?

**Mechanics-as-meaning:**
- What is your game actually about, mechanically? What does the optimal path reward?
- Is that the same as what the theme promises?
- If mechanics and theme conflict, which one do you want to be true — and how do you change the other to match?

**Player psychographics:**
- Who is each mechanic designed for (Timmy/experience, Johnny/expression, Spike/mastery)?
- Are you trying to please everyone with a single component and pleasing no one?
- Does the game give players enough choices to make it feel personal?

For how these principles apply to specific systems, see `systems-and-rules.md` if not already loaded. For player motivation models that inform psychographic design, see `player-experience.md` if not already loaded. For narrative-mechanic alignment, see `narrative-integration.md` if not already loaded.
