/** Alert states shared by every guard. */
export type AlertState = 'unaware' | 'suspicious' | 'alerted' | 'searching';

/** Anything with an alert state that contributes to the camp alert meter. */
export interface AlertSource {
  readonly alive: boolean;
  readonly alertState: AlertState;
  /** 0..1 detection meter. */
  readonly awareness: number;
}

/**
 * Camp-wide alert level for the HUD meter: the worst state among living guards,
 * plus a smoothed 0..1 level.
 */
export class AlertSystem {
  level = 0;
  state: 'calm' | 'suspicious' | 'alerted' | 'searching' = 'calm';
  /** Seconds since any guard was alerted (used for music and reinforcements). */
  sinceAlerted = 999;
  /** True once the camp has gone loud at least once. */
  everAlerted = false;

  update(dt: number, sources: Iterable<AlertSource>): void {
    let worst: AlertSystem['state'] = 'calm';
    let peak = 0;
    for (const s of sources) {
      if (!s.alive) continue;
      peak = Math.max(peak, s.awareness);
      if (s.alertState === 'alerted') worst = 'alerted';
      else if (s.alertState === 'searching' && worst !== 'alerted') worst = 'searching';
      else if (s.alertState === 'suspicious' && worst === 'calm') worst = 'suspicious';
    }
    const target = worst === 'alerted' ? 1 : worst === 'searching' ? Math.max(0.6, peak) : peak;
    this.level += (target - this.level) * Math.min(1, dt * (target > this.level ? 6 : 1.2));
    this.state = worst;
    if (worst === 'alerted') {
      this.sinceAlerted = 0;
      this.everAlerted = true;
    } else this.sinceAlerted += dt;
  }

  reset(): void {
    this.level = 0;
    this.state = 'calm';
    this.sinceAlerted = 999;
    this.everAlerted = false;
  }
}
