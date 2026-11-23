# Tidebreakers — animation plan

Generated from `tools/blender/anims.py`. Every humanoid shares this rig and library; clips are
authored as key poses, interpolated (FK), solved for foot/hand contacts (IK), refined with
overlapping action, then baked and exported to `public/assets/anims/humanoid.glb`. Secondary
motion (hair, tails, coats) is simulated at runtime. Contact sheets: `docs/art/anims/`.

| clip | length | loop | purpose | contacts | timing notes |
|---|---|---|---|---|---|
| `idle` | 3.20 s (96 f) | yes | Story idle: weight on both feet, slow breath | both feet planted | keys at 0 / 1.6 s; arms hang with soft fists |
| `guard` | 0.90 s (27 f) | yes | Combat idle: bouncing fighting stance | both feet planted (lead L) | bounce 2.2 Hz, fists at chin height |
| `walk` | 1.00 s (30 f) | yes | Walk 1.7 m/s | heel-strike at 0 and 0.5 s | hips dip on contact, arms counter-swing 28 deg, chest counter-rotates |
| `run` | 0.66 s (20 f) | yes | Run 5.6 m/s with flight phase | contacts at 0 and 0.33 s | forward lean 12 deg, high knees, pumping bent arms |
| `jab` | 0.42 s (13 f) | no | Light 1: lead jab | feet planted | anticipation 0.06 s, hit 0.12 s, recover by 0.42 s |
| `cross` | 0.50 s (15 f) | no | Light 2: rear cross | rear heel lifts on the hit | hips rotate 48 deg, hit 0.14 s |
| `backfist` | 0.70 s (21 f) | no | Light 3: spinning backfist | pivot on lead foot | wind-up 0.12 s, hit 0.29 s |
| `windkick` | 0.85 s (26 f) | no | Light 4 / finisher: wind roundhouse | stands on L | chamber 0.15 s, hit 0.25 s |
| `gale_hammer` | 0.80 s (24 f) | no | Heavy: rising launcher uppercut | rear heel lifts | crouch 0.22 s, hit 0.32 s |
| `charge` | 1.00 s (30 f) | yes | Heavy charge hold (trembling) | feet planted | fast tremble |
| `gale_burst` | 0.90 s (27 f) | no | Special: wind blast | wide stance | draw 0.25 s, release 0.35 s |
| `tempest_dash` | 0.80 s (24 f) | no | Special: dash punch | lunge (root motion at runtime) | launch 0.2 s |
| `hurricane` | 1.90 s (57 f) | no | Super: Hurricane Rising | rises onto the toes | coil 0.7 s, skyward hit 1.15 s |
| `block` | 0.60 s (18 f) | yes | Guard (forearms up) | feet planted | held |
| `parry` | 0.42 s (13 f) | no | Parry deflect | feet planted | sweep 0.12 s |
| `hit_front` | 0.45 s (14 f) | no | Hit reaction from the front | feet planted | snap 0.06 s |
| `hit_back` | 0.45 s (14 f) | no | Hit reaction from behind | feet planted | snap 0.06 s |
| `knockdown` | 1.20 s (36 f) | no | Knocked flat on the back | lands at 0.4 s, bounce 0.5 s | lands at 0.4 s |
| `getup` | 1.15 s (34 f) | no | Get up from the back | hands push off, kneel, stand | ends in guard |
| `death` | 2.00 s (60 f) | no | Defeat: sag, kneel, fall | knee 0.7 s, ground 1.3 s | slow |
| `victory` | 1.60 s (48 f) | no | Fist pump | feet planted | overshoot into the pump |
| `jump` | 0.30 s (9 f) | no | Jump take-off | feet leave the ground at 0.3 s | deep crouch then explosive extension |
| `air` | 0.80 s (24 f) | yes | Airborne loop | none | tucked legs, arms out for balance |
| `air_attack` | 0.60 s (18 f) | no | Aerial axe kick (spikes downward) | none | leg rises 0.18 s, slams 0.3 s |
| `land` | 0.40 s (12 f) | no | Landing absorb | both feet | 0.08 s compression hold sells the weight |
| `dodge` | 0.45 s (14 f) | no | Dodge dash (i-frames; travel is root motion at runtime) | low lunge | committed low silhouette |
| `talk` | 3.00 s (90 f) | yes | Dialogue gestures | feet planted | right hand leads the beats, head nods on stresses |
| `nod` | 0.80 s (24 f) | no | Agreement nod | feet planted | double nod, second smaller |
| `point` | 1.20 s (36 f) | no | Point ahead (story beats) | feet planted | overshoots into the point |
| `kneel_grief` | 2.40 s (72 f) | yes | Kneeling grief (shoulders heave) | R knee and L foot on the ground | slow sob rhythm 0.4 Hz |
| `kneel_hold` | 3.00 s (90 f) | yes | Kneeling, cradling someone (Ines, Teo) | R knee and L foot on the ground | arms make a cradle at lap height |
| `cry` | 1.60 s (48 f) | yes | Face in hands, sobbing | feet planted | shoulders shake |
| `laugh` | 0.60 s (18 f) | yes | Belly laugh | feet planted | quick bounce |
| `wave` | 0.80 s (24 f) | yes | Wave goodbye / hello | feet planted | forearm swings |
| `look_around` | 3.60 s (108 f) | yes | Searching / wary idle | feet planted | holds on each side |
| `cross_arms` | 2.00 s (60 f) | yes | Arms crossed (Mira, Halvard) | feet planted | weight on one hip |
| `salute` | 1.00 s (30 f) | no | Armada salute | feet planted | snaps up |
| `sit` | 2.00 s (60 f) | yes | Sitting on a crate / ledge | seat | static with breath |
| `sword_idle` | 1.20 s (36 f) | yes | One-handed blade idle (marines) | feet planted | blade held low and forward |
| `slash1` | 0.75 s (22 f) | no | Diagonal slash | feet planted | telegraph 0.25 s, hit 0.36 s |
| `slash2` | 0.80 s (24 f) | no | Horizontal slash | feet planted | wide arc, hit 0.4 s |
| `thrust` | 0.70 s (21 f) | no | Lunging thrust | lead foot slides forward | hit 0.33 s |
| `overhead` | 1.30 s (39 f) | no | Two-handed overhead smash (brutes, halberd, Gorrick) | feet planted wide | long telegraph 0.55 s, hit 0.7 s |
| `sweep` | 1.10 s (33 f) | no | Wide polearm sweep (Halvard) | feet planted wide | hit 0.62 s, 180 deg arc |
| `aim` | 1.00 s (30 f) | yes | Rifle aim (riflemen) | feet planted | steady, slight sway |
| `shoot` | 0.50 s (15 f) | no | Rifle shot recoil | feet planted | kick at 0.04 s |
| `shield_idle` | 1.20 s (36 f) | yes | Shield up (brutes) | feet planted | shield arm forward |
| `shield_bash` | 0.80 s (24 f) | no | Shield bash (unblockable) | lunging step | hit 0.42 s |
| `taunt` | 1.40 s (42 f) | no | Boss taunt / roar | feet planted | arms spread wide |
| `throw` | 0.80 s (24 f) | no | Throw (chains, bombs, grapples) | feet planted | release at 0.4 s |
