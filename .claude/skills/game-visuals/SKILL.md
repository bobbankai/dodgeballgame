---
name: "game-visuals"
summary: "Visual design principles for legibility, color hierarchy, and art direction in games"
type: "design"
description: "You MUST consult this skill when reasoning about visual design decisions that serve gameplay — art direction for legibility, color and contrast for communication, palette design, making simulation systems visually readable, or diagnosing why a game looks muddy, unreadable, or tonally wrong. Also trigger on visual hierarchy, player visibility, colorblind accessibility, or art that needs to communicate game state. NOT for shader/VFX implementation (see godot-shader) or engine-specific rendering (see godot, love2d). NOT for UI/UX layout."
---

# Game Visuals

Visual design principles for games — how art communicates, guides attention, and serves gameplay.

---

## Core Vocabulary

### Perception and Legibility

**Visual Hierarchy** — The ordering of visual importance. The most critical element (player character, key information) must have the highest contrast relative to its surroundings. Secondary elements have medium contrast. Background elements recede. Violating hierarchy — making the background more visually interesting than the player — is the most common legibility failure in indie games.

**Value Contrast** — The light-to-dark relationship, independent of hue or saturation. Value contrast is the most powerful legibility tool because it works for everyone, including colorblind players. The grayscale test: convert to grayscale — if important elements don't pop, the problem is value, not color.

**Saturation Contrast** — The interplay between vivid and muted colors. Maximum saturation everywhere produces visual noise. Varied saturation — some vivid, some muted — creates hierarchy and visual interest. The most vibrant-seeming games (Nintendo) achieve this through *varied* saturation, not uniform maximum.

**Density Balance** — How much visual information is on screen, and where. Background density should be lower than foreground density so the player's eye naturally finds important elements. High-density backgrounds compete with gameplay; low-density backgrounds recede and support it.

### Communication and Information

**Color as Information** — In games, color is not decoration; it is a communication channel. Every color choice should answer: what does this tell the player? Category (residential vs. industrial), state (healthy vs. abandoned), danger level, interactivity. When color carries information, it must be redundant — backed by shape, value, or symbol — so colorblind players aren't excluded.

**Redundant Cues** — Communicating the same information through multiple visual channels (color + shape + value + symbol). Required for accessibility and for legibility at small sizes or fast glances. A bullet that is both yellow AND small AND round communicates "friendly" more reliably than one that is only yellow.

**Simulation Legibility** — In games where art represents underlying systems (city builders, strategy games, RPG stats), every visual asset must answer: what job are you doing for the simulation? Art that looks good but doesn't communicate system state is vacuous. Art that communicates state is UI, whether or not it looks like UI.

**Emotional Register** — The accumulated emotional signal of all style choices: color saturation, proportion, line quality, light/shadow treatment. These combine into a tone (cute, menacing, whimsical, weighty). Mismatched style elements produce incoherence — a cute-proportioned character in a horror game, or maximum-saturation colors in a somber narrative.

### Craft and Production

**Information Channels** — The independent visual channels through which a scene communicates: color, shape, and surface contrast (value variation across a surface). Each channel can be read without the others. Removing a channel — monochrome removes color; uniform roughness removes surface contrast — costs legibility. Games can't rely on film's perceptual shortcuts (face/scene recognition), so protecting all three channels is a playability concern, not just an aesthetic one.

**Palette Discipline** — Treating a color palette as a design instrument, not a list of options. Each color slot has a job: highlight, shadow, cycling animation, state indicator. Minimum colors per element is a discipline that produces coherence and leaves room for dynamic effects.

**Constraint-Driven Art** — Working within severe limits (palette size, polygon budget, texture memory) forces creative problem-solving that unlimited resources never demand. Constraints produce mastery; abundance produces dabbling. To apply: cap your palette deliberately, assign every slot a role before painting, and treat the constraint as a design tool rather than a problem to escape.

**Color Cycling** — Animating without extra art frames by rotating palette positions in sequence. The same pixel data reads differently as the palette shifts, creating the illusion of motion (waterfalls, fire, rain, rippling water). Speed is controlled by gradient length, not cycle rate: short gradients cycle fast, long gradients cycle slow. Phase-offset multiple elements so they don't flash in unison — staggered phases produce organic motion.

**Palette Shifting** — Using the same underlying pixel/geometry data to represent multiple states or environments by swapping color assignments. One art asset reads as day, sunset, or night depending on which palette is active. Requires designing assets with non-overlapping color regions for each independently-variable element.

**Post-Processing Unification** — Scene-level passes (ambient occlusion, color grading, atmospherics) that bind individually-made assets into a coherent visual space. Raw assets dumped into a scene look like "a bunch of stuff spewed into the landscape." Ambient occlusion grounds objects; color grading harmonizes independent artists' color choices; atmospherics create spatial depth.

---

## Problem → Concept Routing

| Problem | Concepts | What to Check |
|---|---|---|
| "Players can't see their character against the background" | Visual Hierarchy, Value Contrast | Grayscale test: does the character pop? Reduce background value contrast; increase character contrast |
| "My game looks muddy or flat" | Value Contrast, Saturation Contrast | Is there a full value range? Are some elements vivid and some muted, or is everything the same saturation? |
| "Scene reads as noise — nothing pops even with good contrast" | Information Channels, Value Contrast | Is surface contrast (roughness/value variation) flattened? Squint test: do important elements separate from background? |
| "Background is eating the foreground / play space feels small" | Density Balance, Information Channels | Active-play-area ratio: is most of the screen decorative? Tighten camera angle; ensure foreground/background use distinct visual vocabularies |
| "I need to brief an artist but don't know how to describe the look" | Information Channels | Gather concrete image references + make a rough programmer-art sketch; see `references/art-direction.md` |
| "Colors are too garish / painful to look at" | Saturation Contrast, Palette Discipline | Is saturation maxed everywhere? Vary it — not everything needs to be vivid |
| "Players can't tell what's interactive / dangerous" | Color as Information, Redundant Cues, Visual Hierarchy | Does color carry meaning? Is it backed by shape/value for colorblind users? |
| "My simulation game is hard to read at a glance" | Simulation Legibility, Color as Information | Does each asset communicate category and state? Are states unambiguously differentiated? |
| "My art looks incoherent / style feels off" | Emotional Register, Palette Discipline | Are style elements (saturation, proportion, line, shadow) intentionally chosen and cohesive? |
| "Background competes with gameplay" | Density Balance, Visual Hierarchy | Is background density/contrast lower than foreground? Push background toward midtones |
| "My 3D scene is too dark but lights look harsh" | Value Contrast, Post-Processing Unification | Use ambient/environment light to lift shadow floor; then add colored lights for mood |
| "Assets look disconnected / don't feel like one scene" | Post-Processing Unification | Is ambient occlusion in? Is color grading applied? Are atmospherics creating depth? |
| "Colorblind players can't distinguish elements" | Color as Information, Redundant Cues, Value Contrast | Value contrast is universal — does it differentiate elements without color? Add shape/symbol redundancy |
| "My colorblind mode is just a full-screen color filter" | Redundant Cues, Color as Information | Filters shift problems, not solve them. Each information channel needs a non-color backup (shape, pattern, label, animation). See `references/visual-problems.md` — Accessibility Beyond Color |
| "My palette feels random / colors don't harmonize" | Palette Discipline, Constraint-Driven Art | Does each color have a job? Try deliberately limiting your palette and assigning roles |
| "Animated effects look mechanical / synchronized" | Color Cycling | Are cycling gradients phase-offset? Vary gradient lengths and starting positions for organic motion |
| "I need multiple scene variants (day/night/environments) without redrawing assets" | Palette Shifting, Constraint-Driven Art | Are color regions non-overlapping per element? Can palette slots be swapped independently? |
| "My game's tone feels wrong for the genre" | Emotional Register | Audit each style element: saturation, proportion, line, shadow. Which one is signaling the wrong tone? |
| "My procedurally-generated content looks visually inconsistent" | Post-Processing Unification, Palette Discipline | Are scene-level passes binding varied assets? Does each generated element use a consistent palette with assigned roles? See `references/simulation-art.md` |

---

## Worked Examples

### Example 1: Player Visibility in a Platformer

**Scenario**: "My character keeps getting lost against the background."

Apply **Visual Hierarchy** and **Value Contrast**. Convert the scene to grayscale. If the character doesn't immediately pop, the problem is value — not color, not hue.

The fix has two parts: increase the character's value contrast (make it lighter or darker relative to its surroundings) AND reduce the background's value contrast (push it toward midtones). Don't just fix the character — fix the hierarchy.

**Design principle**: Build the player character to be high-contrast so it works against a wide range of backgrounds. This gives you more freedom with background variety. A high-contrast player against a low-contrast background is more flexible than a light player against a dark background (which constrains all your background choices).

---

### Example 2: Simulation State Legibility

**Scenario**: "Players can't tell which buildings are abandoned vs. thriving in my city builder."

Apply **Simulation Legibility** and **Redundant Cues**. The visual difference between states must be readable at game scale — zoomed out, while managing other things. Subtle differences fail; exaggerated differences work.

Use multiple channels: color shift (desaturated, gray-green for abandoned), geometry change (broken windows, debris), animation state (no activity, no lights). Each channel alone might be missed; together they're unambiguous.

**Design principle**: Every visual asset in a simulation game is UI. Ask "what job is this doing for the simulation?" before asking "does this look good?" Art that looks good but doesn't communicate state is wasted production.

---

### Example 3: Palette Discipline for Coherence

**Scenario**: "My game's colors feel random and don't harmonize."

First, check whether each color has an assigned role. If you can't name what job a color is doing — highlight, shadow, turning edge, state indicator — that's the problem.

Apply **Constraint-Driven Art** and **Palette Discipline**: cap your palette deliberately and assign every slot a role before painting. A useful structure: 2–3 highlight colors, 1 turning-edge color (the darkest zone between lit and shadow faces), 2–3 shadow/bounce-light colors, plus any cycling/animation slots.

The turning edge is often the missing piece. Without it, forms read as flat. With it, even simple pixel art reads as three-dimensional.

**Design principle**: Constraints produce mastery. Deliberately limiting your palette forces you to think about what each color is doing. The discipline of "minimum colors per element" produces more coherent art than unlimited color picking.

---

## Design Analysis Checklist

**Hierarchy**: Does the most important element have the highest contrast? Does the background recede? Grayscale test: does the visual hierarchy survive without color?

**Information**: Does each color choice communicate something? Is that communication backed by shape/value for colorblind players? Can players read state (danger, interactivity, health) at a glance?

**Palette**: Does each color have a job? Is saturation varied, or is everything the same intensity? Are style elements (saturation, proportion, line, shadow) cohesive and intentional?

**Density**: Is background density lower than foreground density? Does the scene guide the eye to important elements, or does everything compete equally?

**Simulation** (if applicable): Does each asset communicate category and state? Are states unambiguously differentiated at game scale? Are visual elements bound to simulation data, or are they decorative?

**Unification**: Do assets feel like one scene or a collection of separate pieces? Is ambient occlusion grounding objects? Is color grading harmonizing the palette? Are atmospherics creating spatial depth?

**Accessibility**: Does value contrast alone differentiate important elements? Are redundant cues (shape, symbol, size) present alongside color?

---

## References

| File | Contents | Read when... |
|---|---|---|
| `references/constrained-palette.md` | Palette as design tool, color cycling, dithering, value ramps, constraint-driven art | You're designing a limited palette, working with pixel art, or want to use color more intentionally |
| `references/visual-problems.md` | Diagnosing and fixing common visual failures: contrast, hierarchy, saturation, density, accessibility | You're critiquing visuals, fixing a specific problem, or need vocabulary to communicate with artists |
| `references/simulation-art.md` | Art as information layer, simulation legibility, post-processing unification, procedural art direction | You're making a simulation/strategy game where art must communicate system state |
| `references/art-direction.md` | Visual information channels, screen composition and active-play-area ratio, art direction over rendering tech, reference-gathering workflow, artist briefing, production heuristics | You're diagnosing why a scene plays badly despite looking fine, briefing artists, or validating assets before committing art-team time |

---

## Relationship to Other Skills

**game-design** — For game feel and perceived affordances, see game-design. This skill handles visual communication; game-design handles whether the mechanic is interesting and whether affordances are clear from a design perspective.

**godot-shader** — For shader/VFX implementation, see godot-shader. This skill handles design decisions (what should this communicate, what contrast level is needed); godot-shader handles the implementation (how to write the shader that achieves it).

**godot / love2d** — Engine-specific rendering implementation. This skill is engine-agnostic. When both fire, the engine skill handles concrete code; this skill handles visual design reasoning.

**brainstorm** — This skill provides the domain vocabulary that visual brainstorming draws on. They co-trigger naturally: brainstorm drives the conversation, game-visuals provides the concepts to reason with.
