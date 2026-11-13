# Audio as Gameplay — Mick Gordon, DOOM (2016)

Source: "Composing the DOOM Soundtrack" — Mick Gordon, GDC

---

## Core Argument

A brief that demands music "nobody has ever heard before" cannot be executed by running your existing process. The piano player, the dubstep producer, and the template-opening composer all produce music *inspired by* the brief — not an *execution* of it. The only way to reach a genuinely different outcome is to change the process.

> "Change the process, change the outcome."

This applies to audio design at every level: composition method, sound generation, team culture, and how you interpret constraints.

---

## Key Principles

### 1. Process-Breaking as Creative Method

Using the same DAW templates, the same contact patches, the same workflow produces the same result. Breaking the process means:

- Generating source material through unfamiliar means (hardware signal chains, tape machines, analog pedals)
- Starting from the simplest possible input (a sine wave) so that everything interesting comes from the process, not the source
- Treating the entire signal chain as the instrument, not the individual components

**Concrete example**: Gordon fed sine waves through a chain of distortion pedals, tape echoes, and compressors. The sine wave is the purest possible audio signal — any interesting character that emerged was entirely a product of the chain. This made the chain the instrument.

### 2. Constraint-Driven Composition

The "no guitars" brief was not a limitation to work around — it was a forcing function that produced something more interesting than guitars would have. By spending months building a sound without guitars, Gordon arrived at a sonic identity that was genuinely unique to DOOM. When guitars were eventually added, they were morphed with the original DOOM chainsaw sample, making them unrecognizable as conventional guitar.

**The principle**: Constraints force you away from defaults. Defaults produce genre-typical results. Constraints produce identity.

**Anti-pattern**: Treating a constraint as a problem to solve rather than a creative direction to explore. The team that immediately finds a workaround for "no guitars" ends up with metal-meme music. The team that takes the constraint seriously ends up with something new.

### 3. Comfortable Failure as Team Culture

Fear of rejection is the primary obstacle to process-breaking. A team that punishes early failure forces composers into safe, proven approaches. The id Software audio team modeled the opposite:

- "Weird Wednesday" sessions: weekly jams with no tempo, no key, no goal — just exploration
- Audio director response to a failed first attempt: "I feel you've taken the first step on a journey toward the perfect destination. Keep going."
- The goal of these sessions was to create an environment where each person felt comfortable in failure

**Design implication**: The team culture is part of the audio design process. A composer working with a team that encourages experimentation will produce different (better) work than the same composer working with a team that demands safety.

### 4. Reactive Audio — Matching System Complexity to Gameplay Structure

DOOM's combat is linear: enter arena → kill demons → advance. Gordon chose *not* to build a complex dynamic music system for this structure because it would interrupt the groove. The music needed to feel like hitting play on an album — continuous, driving, uninterrupted.

Where dynamic audio was used:
- **Glory kills**: Music drops out, replaced by a Shepard tone (endlessly-rising looping riser). Because glory kill duration was unpredictable, the riser needed to loop indefinitely while feeling like it was always building.
- **Combat start**: Music could begin with just hi-hat and rhythm, then fully kick in when combat intensity peaked.

**The principle**: Match the complexity of your dynamic audio system to the complexity of your gameplay structure. A fighting game with predictable round structure (Killer Instinct) can support complex reactive music. A linear arena shooter benefits from music that stays out of the way and drives.

**Anti-pattern**: Building a sophisticated adaptive music system for gameplay that doesn't need it. Complexity that interrupts the groove is worse than simplicity that sustains it.

### 5. Tonal Integration — Music and Sound Design as One Mix

Sound effects that produce tones (rapid-fire weapons, engines, environmental drones) must be tuned to the music's key. In DOOM, the tri-barrel chain gun fires fast enough that its bullet rhythm produces a pitched tone. That tone was tuned to D, matching the music playing in that section.

**The principle**: Tonal integration is not an afterthought. It cannot be fixed in post-processing. It must be designed in from the start — carve your sounds and music with the final mix in mind.

> "If you're ducking stuff when something else happens or trying to compress this when this is happening, you're fixing a problem that shouldn't be there in the first place."

**Practical approach**: Identify which sound effects will produce tones at gameplay frequency. Tune those effects to the root note of the music that plays in that context. Design the music's key around the constraints of the sound effects, or vice versa.

### 6. Soundtrack as Standalone Artifact

The game OST is not a collection of loops pulled from Wwise. It is a separate creative work that represents the music at its best. DOOM's OST used:
- Voiceover monologues from the game to separate sections (inspired by 70s/80s concept albums)
- Arrangements designed to be listened to in a car, not in a game
- A narrative arc across the album, not just a playlist

**The principle**: The soundtrack is the best opportunity to present the music without gameplay constraints. Treat it as a separate project.

---

## Techniques

### Sine Wave as Pure Input
Feed the simplest possible signal through your processing chain. A sine wave has no harmonics — everything interesting that emerges is entirely a product of the chain. This lets you evaluate and tune the chain as an instrument.

### Analog Signal Chain as Instrument
Build a chain of hardware (pedals, tape machines, spring reverbs, compressors) and treat the entire chain as a single instrument. Feed it simple inputs; record the outputs. The chain's character — ground hum, harmonic distortion, feedback behavior — becomes part of the sound identity.

### Tape Speed Manipulation
Record at 30 ips, play back at 15 ips. Playing a part up an octave and twice as fast before recording produces a slowed-down result with different harmonic character than simply pitch-shifting in software.

### Spectral Embedding
Use synthesizers that generate audio from images (e.g., Harmor/Image-Line) to embed visual content in the frequency spectrum. Only visible with a spectrograph — an Easter egg technique.

### Morphing Source Samples
Use spectral morphing plugins to interpolate between a game-iconic sound (DOOM chainsaw) and a conventional instrument (guitar). The result is unrecognizable as either source but carries the identity of both.

### Shepard Tone for Indeterminate Duration
When a gameplay event has unpredictable duration (glory kill), use a Shepard tone — a series of notes that fade in at the bottom as they fade out at the top, creating the perception of endless rising tension. Loops indefinitely without feeling repetitive.

### Compressor as Dynamic Reveal
Set a compressor to knock off ~20 dB. When loud transients stop, the compressor opens up and reveals the noise floor of every piece of equipment in the chain. This noise becomes part of the texture — the compressor is doing creative work, not just dynamic control.

---

## Anti-Patterns

| Anti-Pattern | Why It Fails |
|---|---|
| Opening your template from the last project | Produces the same result as the last project |
| Treating constraints as problems to solve | Bypasses the creative forcing function the constraint provides |
| Building complex dynamic audio for simple gameplay | Interrupts groove; complexity without benefit |
| Tuning music and sound effects independently | Creates tonal clashes that can't be fixed in the mix |
| Releasing the OST as raw game loops | Wastes the best opportunity to present the music at its best |
| Requiring safety from your audio team | Forces composers into proven approaches; prevents process-breaking |

---

## Relationship to Game Feel

Audio is a primary feedback layer in game feel. The DOOM soundtrack works because it matches the game's intensity curve — it drives the player to keep moving, reinforces the arena-combat loop, and drops out at exactly the right moments (glory kills) to create contrast. For game feel and feedback layering theory, see `game-design`.
