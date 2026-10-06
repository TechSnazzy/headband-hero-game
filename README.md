# Headband Hero

A voxel stealth-action game for the browser. A muscular commando in a dark cloth headband is dropped by helicopter at the edge of a misty jungle. Infiltrate the enemy camp, free the captured soldiers, and get everyone to the extraction helicopter. Sneak and pick guards off quietly, or go loud with the rifle and fight your way out. Gunfire is loud: going loud brings the whole camp down on you.

Stylized cartoon action, no blood or gore. Eliminated characters burst into a puff of voxel cubes.

**Play:** https://techsnazzy.github.io/headband-hero-game/

![Screenshot placeholder](docs/screenshot.png)

_Screenshot placeholder: replace `docs/screenshot.png` with a fresh capture._

## Status

Work in progress. See [PLAN.md](PLAN.md) for milestones.

## Controls

| Input | Action |
| --- | --- |
| Mouse | Look and aim (click the game to lock the pointer) |
| W A S D | Move relative to the camera |
| Left click | Fire (hold for full auto on the rifle; throws a rock in slot 3) |
| Right click or R | Reload |
| Shift | Sprint (fast, noisy) |
| C or Ctrl | Crouch / sneak (slow, quiet, hide in tall grass and bushes) |
| Space | Hop (noisy) |
| E (hold) | Interact: free captives, open crates, pick up items, silent takedown from behind |
| 1, 2, 3 or mouse wheel | Switch equipment: rifle, suppressed pistol, rocks |
| Esc | Pause menu |
| F9 | Debug: cycle camera modes (once more than one exists) |

## Run locally

Requires Node 20 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:5173/headband-hero-game/.

## Build

```bash
npm run build
npm run preview
```

The production build lands in `dist/`.

Other scripts: `npm run lint`, `npm run format`, `npm run typecheck`.

## Deploy

Every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml), which lints, builds with Vite and publishes `dist/` to GitHub Pages. Pages is configured with **GitHub Actions** as the source. `vite.config.ts` sets `base: '/headband-hero-game/'` to match the Pages path.

## Folder structure

```
assets/          Source art and audio (concept art, textures, UI, audio). See ASSETS.md.
docs/            Notes and screenshots.
public/          Static files copied as-is into the build (runtime images, sounds).
src/
  main.ts        Entry point
  game/          Game loop, state machine, checkpoints
  config/        tuning.ts (all gameplay numbers), palette.ts (colors)
  camera/        CameraMode interface, CameraRig, ChaseCamera
  input/         Keyboard, mouse, pointer lock
  world/         Voxel terrain, colliders, ray casts, props, foliage
  player/        Hero controller and voxel model
  weapons/       Weapons and their voxel models
  enemies/       Guard and dog models, health, hitboxes
  ai/            Perception, hearing, alert states, guard brain
  allies/        Captives and followers
  levels/        Level data (Level 1 plus room for 2 to 6)
  fx/            Particles, tracers, voxel debris
  ui/            HUD and menus
  audio/         Sound manager
  assets/        Asset loader helpers
```

## Credits

- Built with [Three.js](https://threejs.org/), [Vite](https://vitejs.dev/) and [TypeScript](https://www.typescriptlang.org/).
- Concept art, key art and generated assets made with [Higgsfield](https://higgsfield.ai/). See [ASSETS.md](ASSETS.md).
- All 3D models are built procedurally from voxel boxes in code.
- Code written with [Claude Code](https://claude.com/claude-code).

## License

Licensing is undecided. All rights reserved for now.
