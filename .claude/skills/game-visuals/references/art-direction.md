# Art Direction: Channels, Composition, and Production Workflow

Covers how visual information channels work, how to compose a screen for maximum playability, why art direction beats rendering tech, and how to gather references and brief artists effectively. Read this when a scene looks technically fine but plays badly, when the background is eating the foreground, or when you need to brief an artist and don't know where to start.

*Synthesized from [Jonathan Blow stream clips](https://www.youtube.com/@JBH-p5b) — full per-topic sources in [docs/sources/jonathan-blow.md](../../docs/sources/jonathan-blow.md).*

---

## Table of Contents

1. [Visual Information Channels](#visual-information-channels)
2. [Screen Real-Estate and Composition](#screen-real-estate-and-composition)
3. [Art Direction Over Rendering Tech](#art-direction-over-rendering-tech)
4. [Reference Gathering and Artist Briefing](#reference-gathering-and-artist-briefing)
5. [Production Heuristics](#production-heuristics)

---

## Visual Information Channels

A scene communicates through multiple simultaneous channels: **color**, **shape**, and **surface contrast** (roughness, value variation across a surface). Each channel is independent — a player can read shape even when color is ambiguous, and can read value contrast even when shape is complex.

Removing a channel costs legibility. Monochrome art subtracts the color channel; that's a deliberate trade-off and can look great when the remaining channels are strong. But flattening surface contrast — making everything the same roughness or the same mid-value — subtracts the surface channel too, and the result is uniform "slop" that reads as noise rather than information.

Film can recover from thin channels because human perceptual systems are tuned to recognize faces and scenes from minimal cues. Games can't rely on that shortcut: the player needs to read *game state* (where is the enemy, what is interactive, where is the edge of the platform), not just recognize a scene. Protecting all three channels is a playability concern, not just an aesthetic one.

**Practical check**: convert to grayscale and squint. If the important elements don't pop from the noise, the value/surface channel is broken. Then check at half-size — if shapes blur into each other, the shape channel is too fine-grained.

---

## Screen Real-Estate and Composition

### Active-Play-Area Ratio

Jonathan Blow argues that a useful composition metric is the fraction of screen pixels that are *actionable* — where the player's attention and decisions actually live. If only 15–20% of the screen is active play space and the rest is decorative background, the composition is working against the player.

The "imagine it on a phone" test is a quick proxy: shrink the game to a small screen in your mind. Does the play area still read clearly, or does it get swallowed by background detail?

### Foreground / Background Separation

Reusing the same visual objects in both foreground and background destroys depth cues and makes the scene harder to read. Foreground elements should be visually distinct from background elements — different silhouette complexity, different value range, different level of detail. This is separate from the density-balance principle (which is about contrast levels); it's about *vocabulary*: the foreground and background should look like they belong to different visual registers.

### Art Teams and Background Creep

Jonathan Blow observes a production dynamic worth fighting: art teams naturally maximize background detail because that's where they have the most creative freedom. The foreground is constrained by gameplay requirements; the background is not. Left unchecked, this produces backgrounds that are more visually interesting than the play space — the classic legibility failure.

The countermeasure is keeping the camera zoomed in and treating camera angle as a deliberate, per-level design choice rather than a default. A tighter camera reduces the background's share of the screen and forces the play space to dominate.

---

## Art Direction Over Rendering Tech

Jonathan Blow's stance: perceived visual quality comes primarily from direction and composition, not from raw rendering technology. A game with strong art direction — clear silhouettes, deliberate value structure, a consistent visual vocabulary — will read better than a technically impressive game with uniform, low-contrast "slop."

His concrete comparisons (Elden Ring and Black Myth: Wukong reading better than Doom: The Dark Ages, in his view) are contestable and reflect his taste. The transferable principle is not: **direction is the multiplier on tech**. Better shaders applied to a poorly directed scene produce a better-looking poorly directed scene. Direction applied to modest tech can produce something that reads clearly and feels intentional.

Even monochrome can look great if the remaining channels (shape, value, composition) are focused and directed. The failure mode is not "low tech" — it's "undirected."

---

## Reference Gathering and Artist Briefing

### Gather References with a Low Bar

Collect references with a deliberately low bar: breadth first, curation later. The goal of early reference gathering is to map the space of possibilities, not to commit to a direction. Pulling from far outside the domain on purpose — circuit diagrams, illuminated manuscripts, sacred geometry, industrial photography — is how you find combinations that feel original rather than derivative.

Early ideation is *supposed* to be vague. Don't over-specify too soon; let the reference pool suggest directions rather than forcing a predetermined answer.

### Brief Artists with Concrete References

Abstract prose briefs ("make it feel ancient and mysterious") are hard to execute consistently. Concrete style references — images, not words — give artists a shared target. Pair the reference images with your own rough sketch, even programmer-art quality. The sketch communicates spatial intent (where things go, rough proportions) that reference images alone can't convey.

Jonathan Blow's approach: give each game-world a base geometric motif and pack meaning into its interior. The motif provides visual coherence; the interior variation provides interest. This gives artists a constraint that produces consistency without requiring identical assets.

---

## Production Heuristics

### Placeholder-First Asset Validation

Before spending art-team time on a visual effect or asset, validate whether the effect is wanted at all using a found or placeholder texture. A rough stand-in that captures the spatial and contrast properties of the intended asset is enough to answer "does this read correctly in context?" Committing art-team time before that question is answered is waste.

### Library Search Before AI Generation

For a specific technical asset (a particular texture type, a reference image for a specific material), a library search often beats AI image generation. Library assets are real photographs or illustrations with genuine material properties; AI output tends toward plausible-looking averages that lack the specific character you're after.

### AI Image Output as Idea-Spark

Jonathan Blow's stance on AI-generated images: useful as an idea-spark in early ideation — a way to quickly sample a large visual space — but not as a final asset or a brief for an artist. His argument is that AI image generators don't understand the image or the text prompt; they produce statistically plausible outputs that look coherent but lack intentional structure. Using AI output as a final asset skips the direction step entirely.

The productive use: generate a large batch of rough variations to identify which visual directions are worth pursuing, then brief a human artist with the promising directions plus concrete references and a sketch.
