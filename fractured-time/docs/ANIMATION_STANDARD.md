# Animation Standard

Source: directive §14, §15 and master directive "Professional Character Animation System". Top priority. Properly authored skeletal animation in Blender; no reliance on primitive rotation/tweening.

## Required clips (player; enemies get their own sets)
Idle (breathing, look-around) · walk · run · sprint · start/stop · turning · strafe · jump · fall · land · light attacks (several) · heavy attacks (several) · combo finishers · block ·
**perfect parry** · counters · directional dodges · stagger · hit reactions · recovery · contextual finishers · time-slow / rewind / echo / timeline-shift / temporal-counter / recovery ·
cinematic: walking during dialogue, looking at others, device interaction, reacting to events, emotional gestures, chapter-specific actions.

## Runtime
State machines · blending · crossfading · directional movement blending · root motion where appropriate · foot placement (IK or pinned contacts) · animation **events** (hit window, cancel window,
parry window, i-frames, footsteps, ability activation) · secondary motion (cloth, gear, hair) · facial animation. Three.js `AnimationMixer` or an equivalent controller (`src/animation/`).
**A visible attack must correspond to its registered hit timing** (events live in `humanoid_clips.json`, authored with the clip).

## Quality bar
Movements communicate **weight, momentum, balance**; every attack has anticipation, movement, impact, recovery. No stiff movement, foot sliding, unnatural transitions, poor deformation, robotic combat.
Review in the running game (not only Blender): full playback, weight, transitions, foot placement, combat timing, deformation. Important animations must look professionally authored; key story
moments get individually authored animation.

## Cinematic performance
Facial expressions, eye movement, blinking, head turns, emotional reactions, natural gestures, body language, dialogue sync, character interaction. No motionless characters standing in front of
subtitles for important scenes. Use facial rigs or morph targets. Performance reflects personality, emotion, relationships, events and context.

## Authoring pipeline
`blender/animations/anim_lib.py` (DSL: pose dicts, mirror, merge, keyed) and `ethan_anims.py` (clips; 30 fps). Review with `--poses` contact sheets, then in the game. Rig facts and axis conventions are in `CLAUDE.md`.
Known gaps are tracked in `PROJECT_PROGRESS.md` (e.g. guard/block arm pose, hand-authored key poses need polish passes with reference timing, no facial animation yet).
