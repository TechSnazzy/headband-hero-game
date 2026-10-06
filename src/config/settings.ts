/**
 * Player-adjustable settings (persisted in localStorage). Gameplay tuning lives
 * in tuning.ts; these are per-player preferences layered on top.
 */
export interface Settings {
  sensitivity: number; // multiplier on TUNING.camera.sensitivity
  invertY: boolean;
  volume: number; // 0..1
  music: number; // 0..1
  aimAssist: boolean;
  showHints: boolean;
}

const KEY = 'headband-hero-settings';

const DEFAULTS: Settings = {
  sensitivity: 1,
  invertY: false,
  volume: 0.8,
  music: 0.5,
  aimAssist: true,
  showHints: true,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Storage unavailable (private mode): fall back to defaults.
  }
  return { ...DEFAULTS };
}

export const settings: Settings = load();

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Ignore: settings just won't persist.
  }
}
