---
name: "game-audio"
summary: "Audio design principles for games: music, sound effects, and adaptive systems"
type: "design"
description: "You MUST consult this skill when reasoning about game audio design — how music serves gameplay, designing sound that reinforces game feel, adaptive/reactive audio systems, tonal integration between music and sound effects, or creative process for game composers. Also trigger when audio feels generic, when a brief demands something unprecedented, or when discussing constraints as creative tools. NOT for Wwise/FMOD node graph configuration or middleware setup. NOT for general music composition theory outside a game context."
---

# Game Audio

Vocabulary and frameworks for reasoning about audio design in games — how sound serves gameplay, not just atmosphere.

---

## Core Vocabulary

### Composition and Process

**Process-Breaking** — Deliberately abandoning your existing workflow to reach a different outcome. Using the same DAW templates and contact patches produces the same result. The only path to genuinely novel audio is changing the process: different source material, different generation methods, different instruments. "Change the process, change the outcome."

**Constraint-Driven Composition** — Treating a creative restriction as a forcing function rather than a problem to solve. A "no guitars" brief forces exploration that produces a unique sonic identity. Constraints push you away from genre defaults. The team that immediately finds a workaround for a constraint ends up with genre-typical results; the team that takes the constraint seriously ends up with something new.

**Comfortable Failure** — A team culture that explicitly encourages experimentation and tolerates early failure. Fear of rejection is the primary obstacle to process-breaking. Audio directors who respond to failed attempts with "keep going, you're on the right path" produce different (better) work from their composers than those who demand safety. Culture is part of the audio design process.

### Audio Systems

**Reactive Audio** — Music that responds to gameplay state. The key design question is *how much* reactivity the gameplay structure actually needs. Linear arena combat benefits from music that drives continuously (like hitting play on an album). Complex branching gameplay can support sophisticated dynamic systems. For non-combat contexts, the question shifts from "how much reactivity?" to "what gameplay states carry emotional meaning?" Match system complexity to gameplay complexity.

**Tonal Integration** — Aligning the pitch of tonal sound effects and the music's key to each other. Either tune the SFX to the music's root note, or design the music's key around the SFX constraints. Cannot be fixed in post — must be designed in from the start. A chain gun firing fast enough to produce a tone should be tuned to the music's key; alternatively, write the music in the key the SFX dictates.

**Soundtrack as Artifact** — The game OST treated as a standalone creative work, not a collection of exported loops. Designed to be listened to in a car, structured with narrative arc (concept album format), and arranged to represent the music at its best — independent of gameplay constraints.

### Techniques

**Sine Wave as Pure Input** — Using the simplest possible audio signal (a sine wave) as input to a processing chain. Because a sine wave has no harmonics, everything interesting that emerges is entirely a product of the chain. This reveals the chain's character. See **Analog Chain as Instrument**.

**Analog Chain as Instrument** — Treating an entire signal chain (pedals, tape machines, spring reverbs, compressors) as a single instrument. The chain's emergent properties — ground hum, harmonic distortion, feedback behavior — become part of the sonic identity. Swap components freely; the concept (pure input → complex chain) remains.

**Shepard Tone** — An endlessly-rising audio illusion: notes fade in at the bottom as they fade out at the top, creating perpetual tension without resolution. Used for gameplay events of indeterminate duration (e.g., glory kills) where a riser must loop indefinitely while feeling like it's always building. See **Reactive Audio** for the gameplay context where duration-indeterminate audio is needed.

---

## Problem → Concept Routing

| Problem | Concepts | What to Check |
|---|---|---|
| "The music sounds like every other game in this genre" | Process-Breaking, Constraint-Driven Composition | Are you using your existing templates? What constraints can you impose to force a new direction? |
| "The brief demands something unprecedented" | Process-Breaking, Comfortable Failure | Change the generation method, not just the content. Does your team culture support experimentation? |
| "The music feels disconnected from gameplay" | Reactive Audio, Tonal Integration | Does the music's complexity match the gameplay structure? Are tonal SFX tuned to the music's key? |
| "The dynamic music system keeps interrupting the groove" | Reactive Audio | Is the gameplay structure actually complex enough to need dynamic music? Simpler may be better. |
| "The music and sound effects clash in the mix" | Tonal Integration | Identify which SFX produce tones. Tune them to the music's root note (or vice versa). This cannot be fixed in post-processing. |
| "The audio feels generic despite good technical execution" | Process-Breaking, Constraint-Driven Composition | The process produced a genre-typical result. What constraint would force a different direction? |
| "I can't figure out how to make this sound unique to this game" | Process-Breaking, Constraint-Driven Composition | Start from the game's own assets (weapon sounds, environmental audio). Use spectral morphing to transform game-specific sounds into instruments. |
| "The OST release feels like an afterthought" | Soundtrack as Artifact | Treat it as a separate project. Structure it as a concept album, not a loop dump. |
| "The composer is playing it safe" | Comfortable Failure | Examine team culture. Are failed experiments punished or encouraged? |

---

## Worked Examples

### Example 1: Constraint as Identity

**Scenario**: "Our brief says no guitars, but the game feels like it needs aggressive, upfront sound."

Apply **Constraint-Driven Composition**. Spend time building the sound *without* guitars — this forces you to find what else can provide aggression. When you eventually add guitars (if you do), morph them with a game-iconic sound (a weapon sample, an enemy sound) using spectral morphing. The result carries the game's identity rather than sounding like a genre import.

The constraint's value: by not starting with guitars, you build a sonic foundation that is unique to the game. Guitars added later become one element in that foundation, not the foundation itself.

**Diagnosis**: Don't treat "no guitars" as a temporary restriction to work around. Treat it as the direction. The music you build *under this constraint* will be more interesting than the music you'd have built without it — because the constraint forced you off the default path.

---

### Example 2: Matching Reactive Audio to Gameplay Structure

**Scenario**: "Should we build a sophisticated adaptive music system for our arena shooter?"

Apply **Reactive Audio**. Map your gameplay structure: is combat linear (enter → fight → advance) or branching (multiple simultaneous objectives, variable pacing)? Linear combat benefits from music that drives continuously — a complex adaptive system that changes layers based on enemy count will interrupt the groove more than it enhances it.

Reserve dynamic music for moments where the gameplay state genuinely changes the player's emotional context: entering combat from exploration, a boss encounter, a scripted story beat. For continuous combat, let the music run.

**Diagnosis**: Build the simplest reactive system that serves the gameplay. Complexity that interrupts the groove is worse than simplicity that sustains it.

---

## Design Analysis Checklist

Run these questions when evaluating an audio design:

**Process**: Are you using your existing workflow? If yes — what would happen if you changed the source material generation method entirely?

**Constraints**: What restrictions does the brief impose? Have you explored them as creative directions, or treated them as problems to solve?

**Reactivity**: Does your gameplay structure actually need dynamic music? Map the structure first, then decide how much reactivity serves it.

**Tonal Integration**: Which sound effects in this context produce tones? Are they tuned to the music's root note (or vice versa)? Is this designed in, or left to post-processing?

**Culture**: Does your team respond to failed audio experiments with encouragement or correction? Fear of rejection produces safe, genre-typical results.

**Identity**: Does the audio carry something specific to this game — a morphed weapon sound, a unique signal chain, a sonic motif from the game's own assets?

**Soundtrack**: If the OST is released, is it designed as a standalone artifact or a loop dump?

---

## References

| File | Contents | Read when... |
|---|---|---|
| `references/audio-as-gameplay.md` | Mick Gordon / DOOM (2016): process-breaking, constraint-driven composition, tonal integration, reactive audio, analog chain as instrument, Shepard tones, soundtrack as artifact | You need full technique detail, concrete examples, or anti-pattern catalog |

---

## Relationship to Other Skills

**game-design** — Game feel and feedback layering theory. Audio is a primary feedback layer in game feel (alongside animation, camera, hitpause, screenshake). For the theory of why feedback layering matters and how it creates game feel, see `game-design`. This skill covers *how to design the audio layer*; game-design covers *why that layer matters in the whole system*.

**game-patterns** — Implementation patterns for game systems. If you're implementing an adaptive audio system (state machine for music layers, event-driven sound triggers), game-patterns covers the structural patterns. This skill covers the design reasoning for *what* that system should do.

**brainstorm** — This skill provides domain vocabulary that brainstorm sessions draw on when working on audio direction. They co-trigger naturally: brainstorm drives the ideation process, game-audio provides the concepts to reason with.
