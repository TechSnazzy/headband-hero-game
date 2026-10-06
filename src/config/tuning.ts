/**
 * Every gameplay tuning number lives here. Change values in this file only;
 * gameplay code reads from TUNING and never hard-codes these numbers.
 *
 * Units: meters (1 voxel block = 1 m), seconds, degrees where noted.
 */
export const TUNING = {
  player: {
    radius: 0.42,
    height: 1.9,
    crouchHeight: 1.25,
    walkSpeed: 4.2,
    sprintSpeed: 7.4,
    crouchSpeed: 2.1,
    aimMoveMultiplier: 0.75, // speed multiplier while aiming/firing
    acceleration: 30,
    airControl: 0.35,
    jumpVelocity: 6.2,
    gravity: 22,
    stepUp: 0.55, // max ledge height walked up without jumping
    maxHealth: 100,
    regenDelay: 4.5, // seconds without damage before regen starts
    regenRate: 9, // health per second
    medkitHeal: 50,
    turnSpeed: 12, // body turn smoothing (higher = snappier)
    interactRange: 2.2,
  },

  camera: {
    fov: 60,
    distance: 6.0,
    minDistance: 1.6,
    height: 1.55, // look target height above feet
    shoulderOffset: 0.75, // over-the-shoulder offset to the right
    defaultPitchDeg: 38,
    minPitchDeg: 18,
    maxPitchDeg: 62,
    sensitivity: 0.0022, // radians per mouse pixel
    followLerp: 14,
    collisionPadding: 0.35,
    fadeOpacity: 0.22, // opacity of trees/props between camera and hero
    recoilReturn: 9,
    aimTiltDeg: 11, // camera looks this much shallower than its orbit angle so the crosshair reaches ahead of the hero
    aimZoom: 0.85, // distance multiplier while aiming
  },

  noise: {
    // Radius (m) in which guards hear each action.
    walk: 6,
    sprint: 15,
    crouch: 1.8,
    jumpLand: 9,
    rifleShot: 55,
    pistolShot: 9,
    rockImpact: 13,
    takedown: 2.5,
    bulletImpact: 7,
    footstepInterval: 0.42,
  },

  stealth: {
    grassHideCrouched: 0.85, // visibility reduction while crouched in tall grass / bush
    grassHideStanding: 0.35,
    crouchVisibility: 0.6, // visibility multiplier while crouched in the open
    sprintVisibility: 1.25,
    takedownRange: 1.7,
    takedownAngleDeg: 70, // must be within this cone behind the guard
    takedownHold: 0.6,
    takedownCooldown: 1.2,
  },

  ai: {
    visionRange: 22,
    visionRangeSuspicious: 26,
    visionRangeAlerted: 34,
    visionFovDeg: 100,
    peripheralRange: 4, // always noticed within this distance if in line of sight
    detectRateNear: 1.8, // alert meter per second at point blank
    detectRateFar: 0.35, // alert meter per second at max range
    suspicionDecay: 0.18,
    alertDecay: 0.06,
    suspiciousThreshold: 0.35,
    alertThreshold: 1.0,
    investigateTime: 6,
    searchTime: 10,
    loseSightTime: 3.5,
    callForHelpRadius: 30,
    patrolSpeed: 1.7,
    investigateSpeed: 2.6,
    chaseSpeed: 4.6,
    flankDistance: 9,
    preferredRange: 14,
    turnSpeed: 5,
    dogSpeed: 6.5,
    dogSmellRange: 5.5,
    dogBiteDamage: 12,
    dogBiteInterval: 0.9,
    reinforcementInterval: 6,
    firstShotDelay: 1.0, // seconds between spotting the hero and opening fire
  },

  enemies: {
    grunt: {
      health: 100,
      damage: 6,
      fireInterval: 0.17,
      burst: 4,
      burstPause: 1.7,
      spreadDeg: 6,
      range: 32,
    },
    sniper: {
      health: 70,
      damage: 28,
      fireInterval: 3.2,
      burst: 1,
      burstPause: 3.2,
      spreadDeg: 1.2,
      range: 60,
    },
    handler: {
      health: 100,
      damage: 6,
      fireInterval: 0.2,
      burst: 3,
      burstPause: 1.9,
      spreadDeg: 6.5,
      range: 28,
    },
    dog: { health: 60 },
    dropAmmoChance: 0.85,
    dropAmmoAmount: [10, 22] as [number, number],
    dropMedkitChance: 0.15,
  },

  weapons: {
    rifle: {
      magazine: 30,
      reserveStart: 90,
      reserveMax: 240,
      damage: 34,
      headshotMultiplier: 2.0,
      fireInterval: 0.095, // seconds between shots (full auto)
      reloadTime: 2.0,
      spreadDeg: 1.1,
      spreadMoveDeg: 2.2,
      spreadSprintDeg: 5.5,
      spreadCrouchMul: 0.55,
      spreadPerShotDeg: 0.45,
      spreadMaxDeg: 6,
      spreadRecover: 9,
      recoilPitch: 0.012, // radians of camera kick per shot
      recoilYaw: 0.004,
      range: 140,
      noise: 'rifleShot' as const,
    },
    pistol: {
      magazine: 12,
      reserveStart: 36,
      reserveMax: 96,
      damage: 40,
      headshotMultiplier: 3.0, // one-hit headshot on a normal guard (40 * 3 >= 100)
      fireInterval: 0.22,
      reloadTime: 1.4,
      spreadDeg: 0.6,
      spreadMoveDeg: 1.6,
      spreadSprintDeg: 4,
      spreadCrouchMul: 0.5,
      spreadPerShotDeg: 0.9,
      spreadMaxDeg: 5,
      spreadRecover: 8,
      recoilPitch: 0.02,
      recoilYaw: 0.003,
      range: 90,
      noise: 'pistolShot' as const,
    },
    rocks: {
      count: 6,
      max: 9,
      throwSpeed: 15,
      throwUp: 4.5,
      cooldown: 0.6,
    },
  },

  aimAssist: {
    enabled: true,
    radiusDeg: 2.2, // angular radius around the crosshair where shots bend toward a target
    strength: 0.55, // 0 = off, 1 = snap fully onto target center
    maxRange: 45,
    friendlyIndicatorRange: 60,
  },

  allies: {
    freeHoldTime: 1.6,
    followDistance: 2.6,
    followSpeed: 5.2,
    runToExtractSpeed: 5,
  },

  extraction: {
    radius: 6,
    holdOutTime: 25, // seconds to defend the chopper once everyone is aboard-ready
    requireAllCaptives: true,
  },

  crates: {
    openHold: 0.7,
    ammoRifle: 45,
    ammoPistol: 18,
    rocks: 3,
  },
} as const;

export type Tuning = typeof TUNING;
