# Status

Last updated: 2026-10-05

## Where things stand

- Milestones M0 to M9 are done (see PLAN.md). Level 1 (Misty Ridge) is playable start to finish: helicopter intro, stealth or loud approach, rescue 3 captives, extraction hold-out, win/lose screens, checkpoints.
- Live: https://techsnazzy.github.io/headband-hero-game/ (deploys from `main` via GitHub Actions).
- Linked from seantechguy.com Games menu (site repo: `~/Projects/SORT THESE/DEV-PROJECTS/TechSnazzy`, commit "Add Headband Hero to Games menu").

## Known gaps / ideas for next session

- Audio is procedural WebAudio. Higgsfield's SFX/music models are restricted to its own game-builder pipeline, so real samples would need another source; drop files in `public/audio/` and register them with `registerSamples` in `src/audio/Audio.ts`.
- Draw calls are around 600 (each tree is its own mesh for camera fading). Instancing trees would help low-end machines.
- Guards navigate with direct steering plus a sidestep when stuck; no navmesh. Fine for Level 1's open camp lanes.
- Only the chase camera ships. Add modes by implementing `CameraMode` (`src/camera/CameraMode.ts`) and registering them in `Game.loadLevel`; F9 cycles.
- Later levels (River Village, Sunken Temple, Ember Crater, Cloud Forest Monastery, Warlord's Fortress) are not started. Add a `LevelDef` in `src/levels/` plus any new prop/enemy types.

## Testing tips

- `window.game` is exposed in the browser console. `game.play()`, `game.intro.skip()`, `game.hero.spawn(x, z, yaw)`, `game.aiCtx.combatEnabled = false` are handy.
