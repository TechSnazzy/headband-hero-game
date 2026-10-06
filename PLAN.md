# Headband Hero: Build Plan

Voxel stealth-action browser game. Vite + Three.js + TypeScript, static files only, deployed to GitHub Pages.

Live: https://techsnazzy.github.io/headband-hero-game/

## Architecture (short)

| Area | Folder | Notes |
| --- | --- | --- |
| Bootstrap | `src/main.ts` | Creates the `Game`. |
| Game loop and state | `src/game/` | Renderer, scene, state machine (title, intro, playing, paused, won, lost), checkpoints. |
| Tuning | `src/config/tuning.ts` | Every gameplay number lives here (speeds, noise, vision, damage, ammo, reload, aim assist). |
| Palette | `src/config/palette.ts` | All colors used by the procedural voxel models. |
| Camera | `src/camera/` | `CameraMode` interface (`enter`, `update`, `exit`) and a `CameraRig` that swaps modes. Ships with `ChaseCamera`. F9 cycles modes once more than one exists. |
| Input | `src/input/` | Keyboard, mouse, pointer lock, wheel. Gamepad later. |
| World | `src/world/` | Voxel terrain heightmap, static colliders, analytic ray casts, props, foliage hiding zones. |
| Player | `src/player/` | Hero controller, voxel hero model, procedural animation. |
| Weapons | `src/weapons/` | Rifle, suppressed pistol, rocks. Voxel weapon models shared by hand, pickup and HUD icon. |
| Enemies | `src/enemies/` | Grunt, sniper, guard dog. Voxel models, health, hitboxes, elimination. |
| AI | `src/ai/` | Perception (vision cones, hearing), alert states, noise bus, guard brain. |
| Allies | `src/allies/` | Captives, cages, follow behavior. |
| Levels | `src/levels/` | `LevelDef` data. Level 1 now; levels 2 to 6 are added as more data plus a few mechanics. |
| FX | `src/fx/` | Voxel debris, sparks, puffs, tracers, shells, muzzle flash. |
| UI | `src/ui/` | DOM HUD, menus, hints. |
| Audio | `src/audio/` | WebAudio manager. Uses generated SFX where present, synth fallbacks otherwise. |

## Milestones

- [x] **M0** Repo scaffold, README, .gitignore, tooling (ESLint, Prettier, EditorConfig), CI deploy, first push, Pages enabled.
- [x] **M1** Hero walking on voxel terrain, pointer-lock mouse look, swappable chase camera with wall/tree avoidance.
- [x] **M2** Helicopter intro: fly in over the misty ridge, drop the hero at the landing zone, fly away.
- [x] **M3** Shooting: art-matched rifle, crosshair, full auto, reload, recoil, tracers, shells, hit feedback.
- [x] **M4** Enemies: grunts, sniper, guard dog, vision cones, health, cartoon elimination, alert system, enemy fire.
- [x] **M5** Stealth kit: crouch, tall grass and bushes, suppressed pistol, rocks, silent takedowns.
- [x] **M6** Captives in cages, hold E to free, allies follow.
- [ ] **M7** Extraction helicopter, hold-out countdown, win and lose flow, checkpoints.
- [ ] **M8** HUD polish, title/pause/controls menus, audio, generated art and SFX, polish pass.
- [ ] **M9** Final deploy check, link on seantechguy.com games menu.

## Later (not in MVP, code is ready for them)

- Levels: River Village, Sunken Temple, Ember Crater, Cloud Forest Monastery, Warlord's Fortress (boss fights: The Warden, The Colonel, The Warlord).
- Camera modes: top-down, isometric, over-the-shoulder, first-person, 2.5D side view, tilt-shift diorama, fixed cinematic.
- Gamepad support.
- Civilians (non-targetable NPCs, same "friendly" rules as allies).
