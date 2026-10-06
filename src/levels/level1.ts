import type { LevelDef, PropDef } from './types';

/**
 * Level 1: Misty Ridge.
 * Landing zone on the southern ridge (+Z), jungle trail north to the enemy camp,
 * extraction clearing to the north-west. -Z is north.
 */

const CAMP = { x: 0, z: -48 };

function campProps(): PropDef[] {
  const p: PropDef[] = [];
  const cx = CAMP.x;
  const cz = CAMP.z;
  const fence = (x: number, z: number, len: number, alongX: boolean): void => {
    p.push({ type: 'fence', x: cx + x, z: cz + z, len, rot: alongX ? Math.PI / 2 : 0 });
  };
  // Perimeter fence with a south gate and a west gate.
  fence(-11, 18, 14, true);
  fence(11, 18, 14, true);
  fence(-9, -18, 18, true);
  fence(9, -18, 18, true);
  fence(-18, -11, 14, false);
  fence(-18, 11, 14, false);
  fence(18, -9, 18, false);
  fence(18, 9, 18, false);

  // Gate defenses.
  p.push({ type: 'sandbags', x: cx - 6, z: cz + 20.5 });
  p.push({ type: 'sandbags', x: cx + 6, z: cz + 20.5 });
  p.push({ type: 'torch', x: cx - 4.5, z: cz + 18.6 });
  p.push({ type: 'torch', x: cx + 4.5, z: cz + 18.6 });
  p.push({ type: 'torch', x: cx - 18.6, z: cz - 4.5 });
  p.push({ type: 'torch', x: cx - 18.6, z: cz + 4.5 });
  p.push({ type: 'sandbags', x: cx - 20.5, z: cz - 6, rot: Math.PI / 2 });

  // Watchtowers on opposite corners.
  p.push({ type: 'watchtower', x: cx - 14, z: cz + 11, id: 'towerSW' });
  p.push({ type: 'watchtower', x: cx + 14, z: cz - 13, id: 'towerNE' });

  // Tents and huts.
  p.push({ type: 'tent', x: cx - 11, z: cz + 3, rot: 0 });
  p.push({ type: 'tent', x: cx + 11, z: cz + 5, rot: 0 });
  p.push({ type: 'tent', x: cx + 10, z: cz - 6, rot: Math.PI / 2 });
  p.push({ type: 'hut', x: cx - 11, z: cz - 10 });
  p.push({ type: 'banner', x: cx, z: cz - 15 });
  p.push({ type: 'banner', x: cx - 3, z: cz + 17 });

  // Campfire in the middle.
  p.push({ type: 'campfire', x: cx, z: cz });
  p.push({ type: 'log', x: cx - 2.5, z: cz, rot: 0, scale: 0.6 });
  p.push({ type: 'log', x: cx + 2.5, z: cz + 0.5, rot: 0.3, scale: 0.6 });
  p.push({ type: 'torch', x: cx - 4, z: cz - 11 });
  p.push({ type: 'torch', x: cx + 4, z: cz - 11 });

  // Cover: crates, barrels, ammo crates.
  const crates: [number, number][] = [
    [-5, 10],
    [-4, 10],
    [-4.5, 11],
    [6, 12],
    [14, 1],
    [14, 2],
    [-14, -3],
    [-6, -4],
    [5, -3],
    [9, -16.8],
  ];
  for (const [x, z] of crates) p.push({ type: 'crate', x: cx + x, z: cz + z });
  p.push({ type: 'barrel', x: cx + 7, z: cz + 11 });
  p.push({ type: 'barrel', x: cx + 7.9, z: cz + 11.6 });
  p.push({ type: 'barrel', x: cx - 16.5, z: cz - 17 });
  p.push({ type: 'barrel', x: cx + 16.5, z: cz + 16.5 });
  p.push({ type: 'ammoCrate', x: cx - 6.5, z: cz + 11, id: 'ammo1' });
  p.push({ type: 'ammoCrate', x: cx + 13.5, z: cz - 3, id: 'ammo2' });
  p.push({ type: 'ammoCrate', x: cx - 13.5, z: cz - 14, id: 'ammo3' });

  // Pickups.
  p.push({ type: 'medkit', x: cx - 8, z: cz + 8 });
  p.push({ type: 'medkit', x: cx + 12.5, z: cz + 8.5 });
  p.push({ type: 'medkit', x: cx - 4, z: cz - 14 });

  // Stealth approach cover just outside the fence.
  const cover: PropDef[] = [
    { type: 'bush', x: cx - 22, z: cz + 16 },
    { type: 'bush', x: cx + 22, z: cz + 12 },
    { type: 'bush', x: cx - 23, z: cz - 2 },
    { type: 'bush', x: cx + 23, z: cz - 6 },
    { type: 'bush', x: cx - 8, z: cz + 24 },
    { type: 'grass', x: cx + 7, z: cz + 24, scale: 1.3 },
    { type: 'grass', x: cx - 14, z: cz + 22, scale: 1.2 },
    { type: 'grass', x: cx - 21, z: cz + 6, scale: 1.1 },
    { type: 'grass', x: cx + 21, z: cz + 2, scale: 1.1 },
    { type: 'grass', x: cx - 3, z: cz - 22, scale: 1.2 },
    // Tall grass inside the fence for daring routes.
    { type: 'grass', x: cx - 14, z: cz + 9, scale: 0.9 },
    { type: 'grass', x: cx + 6, z: cz - 14, scale: 0.8 },
  ];
  p.push(...cover);
  return p;
}

function trailProps(): PropDef[] {
  return [
    // Landing zone ridge.
    { type: 'boulder', x: 9, z: 86 },
    { type: 'rock', x: -7, z: 72 },
    { type: 'grass', x: 6, z: 70, scale: 1.2 },
    { type: 'grass', x: -9, z: 60, scale: 1.3 },
    { type: 'bush', x: -3, z: 55 },
    { type: 'log', x: -16, z: 48, rot: 0.6 },
    { type: 'rockPile', x: -2, z: 66 },
    // Mid jungle.
    { type: 'grass', x: -14, z: 38, scale: 1.4 },
    { type: 'grass', x: -2, z: 30, scale: 1.2 },
    { type: 'bush', x: -15, z: 28 },
    { type: 'bush', x: 2, z: 18 },
    { type: 'boulder', x: 14, z: 20 },
    { type: 'rock', x: -10, z: 12 },
    { type: 'grass', x: 12, z: 8, scale: 1.3 },
    { type: 'grass', x: -4, z: 2, scale: 1.4 },
    { type: 'bush', x: 10, z: -4 },
    { type: 'log', x: 1, z: -12, rot: 1.2 },
    { type: 'grass', x: 9, z: -14, scale: 1.2 },
    { type: 'bush', x: -6, z: -16 },
    { type: 'ammo', x: -13, z: 30 },
    { type: 'medkit', x: 13, z: 12 },
    { type: 'rockPile', x: -5, z: 6 },
    { type: 'ammo', x: 6, z: -18 },
    // Extraction route.
    { type: 'grass', x: -27, z: -56, scale: 1.2 },
    { type: 'bush', x: -33, z: -66 },
    { type: 'boulder', x: -46, z: -66 },
  ];
}

export const LEVEL_1: LevelDef = {
  id: 'misty-ridge',
  name: 'Misty Ridge',
  subtitle: 'Level 1',
  seed: 1337,
  size: { w: 128, d: 192 },
  mood: {
    skyTop: 0x86b9e2,
    skyHorizon: 0xcfe3e8,
    fog: 0xbcd3d4,
    fogNear: 30,
    fogFar: 135,
    sun: 0xfff1d6,
    sunIntensity: 2.4,
    ambient: 1.6,
    mist: true,
  },
  terrain: {
    base: 1.5,
    amplitude: 2.6,
    frequency: 0.035,
    border: 10,
    borderWidth: 11,
    flats: [
      { x: 0, z: 80, r: 7, h: 4.5, blend: 9 }, // landing zone ridge
      { x: CAMP.x, z: CAMP.z, r: 22, h: 1, blend: 6 }, // camp
      { x: -40, z: -78, r: 9, h: 1.5, blend: 6 }, // extraction clearing
    ],
    paths: [
      {
        points: [
          [0, 74],
          [-8, 58],
          [-10, 42],
          [-4, 24],
          [6, 8],
          [4, -10],
          [0, -26],
        ],
        width: 3.2,
      },
      {
        points: [
          [-18, -48],
          [-28, -56],
          [-38, -72],
        ],
        width: 3,
      },
    ],
  },
  forest: {
    treeDensity: 1.0,
    bushDensity: 0.35,
    grassDensity: 0.25,
    keepClear: [
      { x: 0, z: 80, r: 9, h: 0 },
      { x: CAMP.x, z: CAMP.z, r: 25, h: 0 },
      { x: -40, z: -78, r: 11, h: 0 },
    ],
  },
  hero: { x: 0, z: 79, yaw: 0 },
  intro: {
    from: [-30, 24, 128],
    drop: [0, 4.5 + 7, 80],
    exit: [-70, 34, 30],
  },
  extraction: { x: -40, z: -78, r: 6 },
  reinforcements: [
    [-6, -62],
    [6, -40],
    [-24, -40],
  ],
  props: [...campProps(), ...trailProps()],
  guards: [
    // 0: trail patrol in the jungle.
    {
      type: 'grunt',
      patrol: [
        [-10, 44],
        [-6, 30],
        [-3, 22],
        [-8, 36],
      ],
      waitTime: 2,
    },
    // 1 + 2: dog handler and dog near the camp approach.
    {
      type: 'handler',
      patrol: [
        [8, 4],
        [4, -8],
        [-4, -14],
        [2, -2],
      ],
      waitTime: 2.5,
    },
    { type: 'dog', patrol: [[8, 4]], handler: 1 },
    // 3: gate guard.
    { type: 'grunt', patrol: [[2, -27]], look: [Math.PI, Math.PI + 0.6, Math.PI - 0.6] },
    // 4: camp perimeter patrol (inside the fence).
    {
      type: 'grunt',
      patrol: [
        [-16, -34],
        [16, -34],
        [16, -63.5],
        [-16, -63.5],
      ],
      waitTime: 1.5,
    },
    // 5: cage guard.
    {
      type: 'grunt',
      patrol: [
        [-4, -53],
        [4, -53],
      ],
      waitTime: 3,
    },
    // 6 + 7: tower snipers.
    {
      type: 'sniper',
      patrol: [[-14, -37]],
      elevated: 4.6,
      look: [Math.PI * 0.75, Math.PI, Math.PI / 2],
    },
    { type: 'sniper', patrol: [[14, -61]], elevated: 4.6, look: [-0.7, 0, -1.4] },
    // 8: tent area guard.
    {
      type: 'grunt',
      patrol: [
        [7, -40],
        [7, -50],
      ],
      waitTime: 4,
    },
    // 9: west gate guard facing the extraction route.
    { type: 'grunt', patrol: [[-21, -50]], look: [Math.PI / 2, 1.1, 2.0] },
  ],
  captives: [
    { kind: 'young', name: 'Pvt. Danny Reyes', x: -7, z: -58 },
    { kind: 'medic', name: 'Doc Imani Hale', x: 0, z: -60 },
    { kind: 'sergeant', name: 'Sgt. Walt Brody', x: 7, z: -58 },
  ],
  checkpoints: [
    { id: 'lz', x: 0, z: 79, r: 6, label: 'Landing Zone' },
    { id: 'trail', x: -5, z: 26, r: 5, label: 'Jungle Trail' },
    { id: 'outskirts', x: 1, z: -20, r: 5, label: 'Camp Outskirts' },
  ],
  objectives: {
    reachCamp: 'Infiltrate the enemy camp to the north',
    freeCaptives: 'Free the captured soldiers ({n}/{total})',
    extract: 'Get everyone to the extraction chopper (north-west)',
    holdOut: 'Hold out until the chopper is ready: {t}s',
  },
  hints: [
    'WASD to move, mouse to look. Shift sprints (noisy), C or Ctrl crouches (quiet).',
    'Crouch in tall grass and bushes to hide. Guards have vision cones: stay out of them.',
    'Hold E behind an unaware guard for a silent takedown.',
    'Left click fires. The rifle is LOUD. Press 2 for the suppressed pistol, 3 for rocks.',
  ],
};
