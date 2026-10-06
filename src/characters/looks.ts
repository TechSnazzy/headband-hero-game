import { DIM, type HumanoidParts } from './Humanoid';
import type { VoxelBuilder } from '../world/voxel';
import { PALETTE, type ColorList } from '../config/palette';

/**
 * Voxel "looks" for each character, matched to the Higgsfield concept art.
 * Each returns HumanoidParts decorators for the shared rig.
 */

const V = 0.06; // body voxel size: chunky pixel-camo look

interface BaseLook {
  skin: ColorList;
  shirt: ColorList;
  sleeves: ColorList | null; // null = bare arms
  pants: ColorList;
  boots: ColorList;
  belt: number;
  bulk: number; // 1 = hero muscle
}

function baseParts(
  l: BaseLook,
  head: (v: VoxelBuilder) => void,
  chestExtra?: (v: VoxelBuilder) => void,
): HumanoidParts {
  const b = l.bulk;
  return {
    pelvis(v) {
      v.shell(0, DIM.hipY + 0.02, 0, 0.5 * b, 0.2, 0.3, V, l.pants);
      v.box(0, DIM.hipY + 0.1, 0, 0.53 * b, 0.07, 0.33, l.belt);
      v.box(0, DIM.hipY + 0.1, -0.17, 0.09, 0.07, 0.02, 0x8a7a50); // buckle
    },
    thigh(v, side) {
      v.shell(0, -0.23, 0, 0.25 * b, 0.5, 0.28, V, l.pants);
      // Cargo pocket.
      v.box(0.13 * side * b, -0.26, 0, 0.04, 0.14, 0.16, l.pants[1]);
    },
    shin(v) {
      v.shell(0, -0.19, 0, 0.23 * b, 0.42, 0.26, V, l.pants);
      v.shell(0, -0.44, -0.04, 0.27 * b, 0.16, 0.36, V, l.boots);
      v.box(0, -0.35, 0, 0.26 * b, 0.03, 0.27, l.boots[0]);
    },
    chest(v) {
      v.shell(0, 0.3, 0, 0.62 * b, 0.6, 0.34, V, l.shirt);
      v.shell(0, 0.65, 0, 0.18, 0.12, 0.16, V, l.skin); // neck
      if (!l.sleeves) {
        // Bare muscular shoulders and the V of the tank top.
        v.shell(0.3 * b, 0.5, 0, 0.16, 0.16, 0.3, V, l.skin);
        v.shell(-0.3 * b, 0.5, 0, 0.16, 0.16, 0.3, V, l.skin);
        v.box(0, 0.55, -0.172, 0.18, 0.1, 0.01, l.skin[0]);
        v.box(0, 0.5, -0.172, 0.1, 0.06, 0.01, l.skin[1]);
      } else {
        v.shell(0.3 * b, 0.5, 0, 0.16, 0.16, 0.3, V, l.sleeves);
        v.shell(-0.3 * b, 0.5, 0, 0.16, 0.16, 0.3, V, l.sleeves);
      }
      chestExtra?.(v);
    },
    head,
    upperArm(v) {
      const c = l.sleeves ?? l.skin;
      v.shell(0, -0.16, 0, 0.23 * b, 0.36, 0.23 * b, V, c);
    },
    foreArm(v) {
      const c = l.sleeves ?? l.skin;
      v.shell(0, -0.13, 0, 0.21 * b, 0.28, 0.21 * b, V, l.sleeves ? l.skin : c);
      if (l.sleeves) v.shell(0, -0.07, 0, 0.225 * b, 0.14, 0.225 * b, V, l.sleeves);
      v.shell(0, -0.33, 0, 0.15, 0.15, 0.16, 0.05, l.skin); // hand
    },
  };
}

/** Face helper: eyes, brows, nose and optional beard. Head box is 0.36 wide at y 0.02..0.4. */
function face(
  v: VoxelBuilder,
  opts: { beard?: number; brows?: number; eyes?: boolean; mustache?: number },
): void {
  const z = -0.184;
  if (opts.eyes !== false) {
    v.box(-0.08, 0.235, z, 0.07, 0.045, 0.01, 0xf4f4f0);
    v.box(0.08, 0.235, z, 0.07, 0.045, 0.01, 0xf4f4f0);
    v.box(-0.065, 0.235, z - 0.002, 0.035, 0.045, 0.01, 0x2a1c14);
    v.box(0.095, 0.235, z - 0.002, 0.035, 0.045, 0.01, 0x2a1c14);
  }
  v.box(0, 0.18, z - 0.02, 0.06, 0.08, 0.04, PALETTE.skinShade); // nose
  if (opts.brows !== undefined) {
    v.box(-0.08, 0.285, z - 0.005, 0.1, 0.03, 0.02, opts.brows);
    v.box(0.08, 0.285, z - 0.005, 0.1, 0.03, 0.02, opts.brows);
  }
  if (opts.beard !== undefined) {
    v.box(0, 0.07, z - 0.005, 0.36, 0.1, 0.02, opts.beard);
    v.box(-0.15, 0.13, z - 0.005, 0.06, 0.1, 0.02, opts.beard);
    v.box(0.15, 0.13, z - 0.005, 0.06, 0.1, 0.02, opts.beard);
    v.box(0, 0.12, z - 0.006, 0.14, 0.03, 0.02, opts.beard);
  }
  if (opts.mustache !== undefined) v.box(0, 0.125, z - 0.012, 0.18, 0.04, 0.02, opts.mustache);
  v.box(0, 0.1, z - 0.008, 0.1, 0.02, 0.01, 0x7a3a2a); // mouth
}

/** Headband Hero: tank top, bare muscular arms, camo pants, long dark hair and a dark cloth headband. */
export function heroParts(): HumanoidParts {
  const look: BaseLook = {
    skin: PALETTE.skin,
    shirt: PALETTE.tankTop,
    sleeves: null,
    pants: PALETTE.pantsCamo,
    boots: PALETTE.boots,
    belt: PALETTE.belt,
    bulk: 1.12,
  };
  return baseParts(look, (v) => {
    v.shell(0, 0.21, 0, 0.36, 0.38, 0.36, V, PALETTE.skin);
    face(v, { beard: 0x3a2a20, brows: 0x241a14 });
    // Messy dark hair: top, sides and long at the back down to the shoulders.
    v.shell(0, 0.43, 0.01, 0.4, 0.1, 0.4, 0.07, PALETTE.hair);
    v.shell(0, 0.2, 0.17, 0.4, 0.42, 0.1, 0.07, PALETTE.hair);
    v.shell(-0.19, 0.24, 0.05, 0.05, 0.3, 0.28, 0.07, PALETTE.hair);
    v.shell(0.19, 0.24, 0.05, 0.05, 0.3, 0.28, 0.07, PALETTE.hair);
    v.shell(0, 0.0, 0.2, 0.36, 0.2, 0.08, 0.07, PALETTE.hair);
    // Tufts sticking up above the band.
    v.box(-0.12, 0.5, -0.06, 0.08, 0.06, 0.08, PALETTE.hair[0]);
    v.box(0.06, 0.51, -0.1, 0.08, 0.07, 0.08, PALETTE.hair[1]);
    v.box(0.15, 0.49, 0.06, 0.08, 0.06, 0.08, PALETTE.hair[2]);
    // The signature dark cloth headband wrapping the forehead (over the hair so it
    // reads from every camera angle), knot and tails hanging at the back.
    v.shell(0, 0.34, 0, 0.44, 0.09, 0.46, 0.06, PALETTE.headband);
    v.box(0.07, 0.33, 0.25, 0.1, 0.1, 0.06, PALETTE.headband[1]);
    v.box(0.11, 0.2, 0.255, 0.07, 0.2, 0.04, PALETTE.headband[0]);
    v.box(0.02, 0.15, 0.255, 0.07, 0.26, 0.04, PALETTE.headband[2]);
  });
}

/** Grunt rifleman: charcoal and rust-red camo, rust beret, vest pouches. */
export function gruntParts(variant = 0): HumanoidParts {
  const look: BaseLook = {
    skin: PALETTE.skin,
    shirt: PALETTE.charcoal,
    sleeves: PALETTE.rustCamo,
    pants: PALETTE.rustCamo,
    boots: [0x222224, 0x2a2a2c],
    belt: 0x1e1e20,
    bulk: 1.0,
  };
  return baseParts(
    look,
    (v) => {
      v.shell(0, 0.21, 0, 0.36, 0.38, 0.36, V, PALETTE.skin);
      face(v, { beard: variant % 2 ? 0x2a2420 : 0x3a2c22, brows: 0x221a16 });
      v.shell(0, 0.22, 0.17, 0.37, 0.3, 0.05, V, PALETTE.hair);
      // Beret, slouched to one side, with a plain dark badge (no insignia).
      v.shell(0.02, 0.43, 0, 0.42, 0.1, 0.42, 0.07, PALETTE.beret);
      v.shell(0.12, 0.47, 0.02, 0.24, 0.06, 0.34, 0.07, PALETTE.beret);
      v.box(-0.1, 0.43, -0.215, 0.06, 0.06, 0.02, 0x3a3a3c);
    },
    (v) => {
      // Tactical vest with three pouches.
      v.shell(0, 0.28, 0, 0.56, 0.42, 0.37, V, PALETTE.charcoal);
      for (const x of [-0.15, 0, 0.15]) {
        v.box(x, 0.2, -0.2, 0.12, 0.14, 0.05, 0x4a4440);
        v.box(x, 0.26, -0.225, 0.12, 0.03, 0.01, PALETTE.rust[2]);
      }
    },
  );
}

/** Sniper / lookout in a shaggy ghillie suit with sunglasses. */
export function sniperParts(): HumanoidParts {
  const look: BaseLook = {
    skin: PALETTE.skin,
    shirt: PALETTE.ghillie,
    sleeves: PALETTE.ghillie,
    pants: PALETTE.ghillie,
    boots: [0x4a3a28, 0x3a2e20],
    belt: 0x4a3a28,
    bulk: 1.05,
  };
  const shag = (
    v: VoxelBuilder,
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    n: number,
    seed: number,
  ): void => {
    let s = seed;
    const r = (): number => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (let i = 0; i < n; i++) {
      const x = cx + (r() - 0.5) * w;
      const y = cy + (r() - 0.5) * h;
      const z = cz + (r() - 0.5) * d;
      v.box(
        x,
        y,
        z,
        0.07,
        0.07 + r() * 0.06,
        0.07,
        PALETTE.ghillie[Math.floor(r() * PALETTE.ghillie.length)],
      );
    }
  };
  const parts = baseParts(
    look,
    (v) => {
      v.shell(0, 0.21, 0, 0.36, 0.38, 0.36, V, PALETTE.skin);
      face(v, { beard: 0x4a3420, eyes: false });
      v.box(0, 0.235, -0.19, 0.3, 0.07, 0.02, 0x111111); // sunglasses
      // Hood.
      v.shell(0, 0.4, 0.03, 0.46, 0.14, 0.44, 0.07, PALETTE.ghillie);
      v.shell(-0.21, 0.2, 0.04, 0.06, 0.38, 0.38, 0.07, PALETTE.ghillie);
      v.shell(0.21, 0.2, 0.04, 0.06, 0.38, 0.38, 0.07, PALETTE.ghillie);
      v.shell(0, 0.2, 0.2, 0.44, 0.42, 0.06, 0.07, PALETTE.ghillie);
      shag(v, 0, 0.35, 0.05, 0.5, 0.25, 0.5, 26, 7);
    },
    (v) => {
      shag(v, 0, 0.3, 0, 0.7, 0.6, 0.42, 60, 13);
      // Binoculars on the chest and a rust armband stripe.
      v.box(-0.06, 0.35, -0.21, 0.08, 0.12, 0.06, 0x2f3a2a);
      v.box(0.06, 0.35, -0.21, 0.08, 0.12, 0.06, 0x2f3a2a);
    },
  );
  const baseUpper = parts.upperArm;
  parts.upperArm = (v, side) => {
    baseUpper(v, side);
    if (side === -1) v.shell(0, -0.12, 0, 0.25, 0.08, 0.25, 0.05, PALETTE.rust);
    shag(v, 0, -0.16, 0, 0.3, 0.36, 0.3, 14, 20 + side);
  };
  const baseThigh = parts.thigh;
  parts.thigh = (v, side) => {
    baseThigh(v, side);
    shag(v, 0, -0.2, 0, 0.32, 0.5, 0.34, 16, 30 + side);
  };
  return parts;
}

/** Dog handler: charcoal fatigues, rust armband, cap. */
export function handlerParts(): HumanoidParts {
  const look: BaseLook = {
    skin: PALETTE.skin,
    shirt: PALETTE.charcoal,
    sleeves: PALETTE.charcoal,
    pants: PALETTE.rustCamo,
    boots: [0x222224, 0x2a2a2c],
    belt: 0x1e1e20,
    bulk: 1.05,
  };
  const p = baseParts(look, (v) => {
    v.shell(0, 0.21, 0, 0.36, 0.38, 0.36, V, PALETTE.skin);
    face(v, { mustache: 0x2a1e16, brows: 0x221a16 });
    v.shell(0, 0.43, 0.01, 0.39, 0.1, 0.39, 0.07, PALETTE.charcoal);
    v.box(0, 0.4, -0.25, 0.32, 0.03, 0.14, PALETTE.charcoal[2]); // cap brim
  });
  const baseUpper = p.upperArm;
  p.upperArm = (v, side) => {
    baseUpper(v, side);
    if (side === -1) v.shell(0, -0.1, 0, 0.25, 0.08, 0.25, 0.05, PALETTE.rust);
  };
  return p;
}

export type AllyLook = 'young' | 'medic' | 'sergeant';

/** Captured allies: olive drab, slightly torn uniforms. */
export function allyParts(kind: AllyLook): HumanoidParts {
  const look: BaseLook = {
    skin: kind === 'medic' ? [0xc98a5a, 0xbf7f50, 0xd2925f] : PALETTE.skin,
    shirt: PALETTE.olive,
    sleeves: PALETTE.olive,
    pants: PALETTE.olive,
    boots: [0x4a3424, 0x3e2c1e],
    belt: 0x4a3424,
    bulk: kind === 'sergeant' ? 1.05 : 0.95,
  };
  const p = baseParts(
    look,
    (v) => {
      v.shell(0, 0.21, 0, 0.36, 0.38, 0.36, V, look.skin);
      if (kind === 'sergeant') {
        face(v, { mustache: 0x3a3a3a, brows: 0x3a3a3a });
        v.box(-0.19, 0.2, 0.0, 0.03, 0.18, 0.12, 0x6a6a6a); // gray sideburns
        v.box(0.19, 0.2, 0.0, 0.03, 0.18, 0.12, 0x6a6a6a);
        v.box(0.1, 0.22, -0.186, 0.02, 0.12, 0.01, 0xa04030); // old scar
        v.shell(0, 0.43, 0.01, 0.4, 0.1, 0.4, 0.07, PALETTE.olive);
        v.box(0, 0.4, -0.25, 0.32, 0.03, 0.14, PALETTE.olive[1]);
      } else if (kind === 'medic') {
        face(v, { brows: 0x221a16 });
        v.shell(0, 0.42, 0.02, 0.4, 0.1, 0.4, 0.07, [0x1e1612, 0x2a1e18]);
        v.shell(0, 0.22, 0.18, 0.38, 0.32, 0.06, 0.07, [0x1e1612, 0x2a1e18]);
      } else {
        // Young soldier: messy brown hair with a white field bandage wrapped around the head.
        face(v, { brows: 0x5a4028 });
        const hair = [0x5a3a22, 0x4a2e1a, 0x6a4428];
        v.shell(0, 0.43, 0.01, 0.4, 0.1, 0.4, 0.07, hair);
        v.shell(0, 0.22, 0.18, 0.38, 0.34, 0.06, 0.07, hair);
        v.box(-0.1, 0.49, -0.08, 0.1, 0.06, 0.1, hair[0]);
        v.box(0.08, 0.5, -0.04, 0.1, 0.07, 0.1, hair[1]);
        v.shell(0, 0.36, 0, 0.42, 0.08, 0.42, 0.06, [0xf2efe6, 0xe4e0d4, 0xfaf8f0]);
      }
    },
    (v) => {
      v.shell(0, 0.3, -0.03, 0.22, 0.4, 0.32, V, PALETTE.undershirt);
      if (kind === 'medic') {
        // Field medical satchel with a white plus.
        v.box(0.2, 0.05, 0.12, 0.2, 0.2, 0.12, 0x6e5232);
        v.box(0.2, 0.05, 0.181, 0.1, 0.03, 0.01, 0xffffff);
        v.box(0.2, 0.05, 0.181, 0.03, 0.1, 0.01, 0xffffff);
      }
    },
  );
  const baseUpper = p.upperArm;
  p.upperArm = (v, side) => {
    baseUpper(v, side);
    if (kind === 'sergeant') {
      // Plain yellow chevrons (generic rank stripes, not a real insignia).
      for (let i = 0; i < 3; i++)
        v.box(0.12 * side, -0.08 - i * 0.045, 0, 0.01, 0.025, 0.14, PALETTE.chevron);
    }
    if (kind === 'medic' && side === -1)
      v.shell(0, -0.1, 0, 0.24, 0.08, 0.24, 0.05, PALETTE.medicWhite);
  };
  return p;
}
