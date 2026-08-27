import type { ScoringConfig } from '../config/types';
import type { EventBus } from '../core/EventBus';

/**
 * Punteggio con combo e moltiplicatore x1..x3: le raccolte consecutive
 * senza subire danni alzano il moltiplicatore; un colpo lo azzera.
 */
export class ScoreSystem {
  score = 0;
  combo = 0;
  bestCombo = 0;
  multiplier = 1;
  /** Moltiplicatore extra dal power-up Punti x2. */
  doubleScoreActive = false;

  constructor(private cfg: ScoringConfig, private bus: EventBus) {
    bus.on('coinCollected', () => {
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.multiplierFor(this.combo));
      const newMult = this.multiplierFor(this.combo);
      if (newMult !== this.multiplier) {
        this.multiplier = newMult;
        bus.emit('comboChanged', { combo: this.combo, multiplier: this.multiplier });
      }
      this.add(this.cfg.collectible);
    });
    bus.on('powerUpCollected', () => this.add(this.cfg.powerUp));
    bus.on('checkpointReached', () => this.add(this.cfg.checkpoint));
    bus.on('lifeLost', () => this.resetCombo());
    bus.on('fell', () => this.resetCombo());
  }

  private multiplierFor(combo: number): number {
    return Math.min(this.cfg.maxMultiplier, 1 + Math.floor(combo / this.cfg.comboStep));
  }

  private resetCombo(): void {
    this.combo = 0;
    if (this.multiplier !== 1) {
      this.multiplier = 1;
      this.bus.emit('comboChanged', { combo: 0, multiplier: 1 });
    }
  }

  add(base: number): void {
    const delta = Math.round(base * this.multiplier * (this.doubleScoreActive ? 2 : 1));
    this.score += delta;
    this.bus.emit('scoreChanged', { score: this.score, delta });
  }

  /** Bonus di fine livello: completamento + tempo residuo. */
  finish(remainingSeconds: number): { completion: number; timeBonus: number } {
    const completion = this.cfg.levelComplete;
    const timeBonus = Math.max(0, Math.round(remainingSeconds)) * this.cfg.timeBonusPerSecond;
    this.score += completion + timeBonus;
    this.bus.emit('scoreChanged', { score: this.score, delta: completion + timeBonus });
    return { completion, timeBonus };
  }
}
