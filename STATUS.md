# Status

Last updated: 2026-10-16

## Where things stand

- Milestones M0 to M9 are done (see PLAN.md). Level 1 (Misty Ridge) is playable start to finish: helicopter intro, stealth or loud approach, rescue 3 captives, extraction hold-out, win/lose screens, checkpoints.
- Live: https://techsnazzy.github.io/headband-hero-game/ (deploys from `main` via GitHub Actions).
- Linked from seantechguy.com Games menu (site repo: `~/Projects/SORT THESE/DEV-PROJECTS/TechSnazzy`, commit "Add Headband Hero to Games menu").

## Latest changes (2026-10-16, from playtest feedback)

- Crosshair can now aim up to 18 degrees above the horizon (camera drops to shoulder height when looking up). Tuning: `camera.maxLookUpDeg`, `camera.lowOrbitDeg`.
- Stealth one-at-a-time: suppressed pistol shots on unaware guards/dogs deal 2.5x (`stealth.sneakDamageMultiplier`), so one shot drops them; suppressed hits no longer call for help.
- Alarm spread reduced: rifle radius 32 m, only guards within half of it go on alert, the rest investigate; teammate gunfire heard within 18 m; dog barks only alarm the handler (others investigate); call-for-help radius 16 m.
- Dogs: health 40, smell range 3.5 m.
- Watchtowers: hold E at the ladder to climb and silently take out the lookout.

## Known gaps / ideas for next session

- Audio is procedural WebAudio. Higgsfield's SFX/music models are restricted to its own game-builder pipeline, so real samples would need another source; drop files in `public/audio/` and register them with `registerSamples` in `src/audio/Audio.ts`.
- Draw calls are around 600 (each tree is its own mesh for camera fading). Instancing trees would help low-end machines.
- Guards navigate with direct steering plus a sidestep when stuck; no navmesh. Fine for Level 1's open camp lanes.
- Only the chase camera ships. Add modes by implementing `CameraMode` (`src/camera/CameraMode.ts`) and registering them in `Game.loadLevel`; F9 cycles.
- Later levels (River Village, Sunken Temple, Ember Crater, Cloud Forest Monastery, Warlord's Fortress) are not started. Add a `LevelDef` in `src/levels/` plus any new prop/enemy types.

## Testing tips

- `window.game` is exposed in the browser console. `game.play()`, `game.intro.skip()`, `game.hero.spawn(x, z, yaw)`, `game.aiCtx.combatEnabled = false` are handy.
