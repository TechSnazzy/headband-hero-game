/**
 * Level data format. Levels are plain data: terrain shaping, props, patrols,
 * captives and objectives. New levels (River Village, Sunken Temple, ...) are
 * added as new LevelDef files plus any new prop or enemy types they need.
 */

export type Vec2 = [number, number];

export interface FlatZone {
  x: number;
  z: number;
  r: number; // radius of the flat area
  h: number; // target height
  blend?: number; // falloff width
}

export interface PathDef {
  points: Vec2[];
  width: number;
}

export type PropType =
  | 'tent'
  | 'watchtower'
  | 'crate'
  | 'ammoCrate'
  | 'barrel'
  | 'fence'
  | 'cage'
  | 'torch'
  | 'campfire'
  | 'rock'
  | 'boulder'
  | 'sandbags'
  | 'banner'
  | 'tree'
  | 'palm'
  | 'bush'
  | 'grass'
  | 'log'
  | 'hut'
  | 'medkit'
  | 'ammo'
  | 'rockPile';

export interface PropDef {
  type: PropType;
  x: number;
  z: number;
  rot?: number; // radians
  scale?: number;
  len?: number; // fences: length in meters
  id?: string;
}

export type EnemyType = 'grunt' | 'sniper' | 'handler' | 'dog';

export interface GuardDef {
  type: EnemyType;
  /** Patrol waypoints. A single point means a stationary guard who looks around. */
  patrol: Vec2[];
  /** For stationary guards: directions (radians) to scan between. */
  look?: number[];
  /** Raised position (for tower snipers): y offset above ground. */
  elevated?: number;
  /** Dogs follow this guard index as their handler. */
  handler?: number;
  waitTime?: number;
}

export type AllyKind = 'young' | 'medic' | 'sergeant';

export interface CaptiveDef {
  kind: AllyKind;
  name: string;
  x: number;
  z: number;
  rot?: number;
}

export interface CheckpointDef {
  id: string;
  x: number;
  z: number;
  r: number;
  label: string;
}

export interface LevelDef {
  id: string;
  name: string;
  subtitle: string;
  seed: number;
  /** Width (x) and depth (z) in meters. World spans -w/2..w/2 and -d/2..d/2. */
  size: { w: number; d: number };
  mood: {
    skyTop: number;
    skyHorizon: number;
    fog: number;
    fogNear: number;
    fogFar: number;
    sun: number;
    sunIntensity: number;
    ambient: number;
    mist: boolean;
  };
  terrain: {
    base: number;
    amplitude: number;
    frequency: number;
    border: number; // height of the boundary cliffs
    borderWidth: number;
    flats: FlatZone[];
    paths: PathDef[];
  };
  forest: {
    treeDensity: number; // per 100 m^2
    bushDensity: number;
    grassDensity: number;
    keepClear: FlatZone[]; // zones where nothing random spawns
  };
  hero: { x: number; z: number; yaw: number };
  intro: {
    /** Helicopter flight path from offscreen to the drop point. */
    from: [number, number, number];
    drop: [number, number, number];
    exit: [number, number, number];
  };
  extraction: { x: number; z: number; r: number };
  props: PropDef[];
  guards: GuardDef[];
  captives: CaptiveDef[];
  checkpoints: CheckpointDef[];
  /** Ordered objective texts. */
  objectives: {
    reachCamp: string;
    freeCaptives: string;
    extract: string;
    holdOut: string;
  };
  hints: string[];
}
