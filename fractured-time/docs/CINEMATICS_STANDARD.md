# Cinematics, Story, Audio, UI (standard)

Source: directive §20, §23, §24 and master directive narrative/UI/audio/save sections.

## Story
Preserve the five-chapter storyline (`MASTER_DEVELOPMENT_DIRECTIVE.md`). Each chapter: meaningful opening, character interaction, exploration, combat, environmental discovery, plot development,
cinematic sequences, a major encounter, a coherent ending and transition. Coherent central mystery, arcs, revelations supported by earlier evidence; no filler missions. Both endings get complete cinematics
that reflect earlier discoveries and decisions. Dialogue is natural and in-character; major characters have motivation, personality, development.

## Cutscene system
Reusable cinematic timeline/sequencer: scripted character actions, camera tracks + blending, facial expressions, dialogue sequencing, subtitles, sound sync, lighting transitions, environment animation,
timeline events, triggers, smooth return to gameplay, skip for seen cinematics without breaking progression. Film language: establishing shots, close-ups, tracking shots, over-the-shoulder dialogue,
controlled DOF, deliberate blocking, dramatic light, pauses, ambient sound. **Revelations are animated scenes, interactions or gameplay events, never static text screens.**
Characters perform (see ANIMATION_STANDARD cinematic performance). Bosses get introductions and endings.

## Audio (original or properly licensed; placeholder tones are not sound design)
Ambience distinct per location · footsteps by surface · movement · combat impacts · defence feedback · machinery · temporal ability sounds with a recognisable identity · boss effects · UI · cinematic sound ·
**dynamic layered music** (exploration, suspense, combat, boss, revelation, finale) with smooth transitions · spatial audio where useful · careful mix (dialogue, music, effects balanced).
Dialogue: complete original script with subtitles and timing; integrate voice only if a legal, high-quality source exists; never pretend recordings exist.

## UI / UX (premium sci-fi, consistent; not generic unstyled HTML)
Menus: Main Menu, New Game, Continue, Chapter Select (after unlock), Settings, Controls, Pause, Credits. HUD: health, temporal energy, active abilities, boss health, objectives, interaction prompts, subtitles;
minimal during exploration. Pause: Resume, Settings, Controls, Restart Checkpoint, Main Menu. Settings: graphics presets (Ultra/High/Balanced/Performance), resolution scale, expensive-effect toggles, audio volumes,
mouse/camera sensitivity, motion blur, subtitles, colour accessibility, key rebinding. High-quality typography, spacing, iconography, smooth transitions, responsive animation, clear navigation, accessibility.
Input: keyboard + mouse, gamepad, touch controls on mobile.

## Save / progression
Versioned structured saves in IndexedDB: chapter, checkpoint, health/abilities, unlocked mechanics, story decisions, objectives, collectibles, flags. Continue, checkpoint restore, chapter completion, return to
menu, restart from checkpoint. Rewind history must never corrupt permanent progression.
