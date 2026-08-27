import { Vector3 } from '@babylonjs/core';
import type { GameConfig } from '../config/types';
import type { TrackSystem } from '../track/TrackSystem';
import type { CharacterSystem } from '../character/CharacterSystem';
import type { InputSystem } from '../input/InputSystem';
import type { EventBus } from '../core/EventBus';

export type RunPhase = 'idle' | 'running' | 'falling' | 'respawning' | 'finished' | 'dead';

/** Modificatori applicati dai power-up. */
export interface MovementModifiers {
  speedFactor: number;
  jumpFactor: number;
}

/**
 * Fisica di corsa in coordinate-traccia: avanzamento automatico con rampa,
 * laterale continuo, salto/doppio salto, cadute nei precipizi, respawn.
 */
export class RunController {
  phase: RunPhase = 'idle';
  /** Distanza percorsa lungo la spline. */
  d = 0;
  /** Offset laterale (m). */
  x = 0;
  /** Quota sopra la strada. */
  y = 0;
  private vy = 0;
  private vx = 0;
  grounded = true;
  private usedDouble = false;
  /** Tempo di gioco trascorso (per la rampa velocità). */
  elapsed = 0;
  invulnerable = 0;
  lastCheckpointD = 0;
  modifiers: MovementModifiers = { speedFactor: 1, jumpFactor: 1 };
  private lastSpeedMult = 1;
  private fallTimer = 0;
  private worldPos = new Vector3();

  constructor(
    private cfg: GameConfig,
    private track: TrackSystem,
    private character: CharacterSystem,
    private input: InputSystem,
    private bus: EventBus,
  ) {
    input.onJump(() => this.tryJump());
  }

  get speed(): number {
    const m = this.cfg.movement;
    let ramp = m.speedRamp[0][1];
    for (const [t, mult] of m.speedRamp) if (this.elapsed >= t) ramp = mult;
    return m.baseSpeed * ramp * this.modifiers.speedFactor;
  }

  get progress(): number { return Math.min(1, this.d / this.track.finishD); }

  start(): void {
    this.phase = 'running';
    this.character.play('run', true, this.cfg.character.runAnimSpeed);
  }

  private tryJump(): void {
    if (this.phase !== 'running') return;
    const m = this.cfg.movement;
    if (this.grounded) {
      this.vy = m.jumpVelocity * this.modifiers.jumpFactor;
      this.grounded = false;
      this.usedDouble = false;
      this.bus.emit('jumped', { double: false });
      this.character.play('jump', false, 1.15, 0.08);
    } else if (m.doubleJump && !this.usedDouble) {
      this.vy = m.jumpVelocity * m.doubleJumpFactor * this.modifiers.jumpFactor;
      this.usedDouble = true;
      this.bus.emit('jumped', { double: true });
      this.character.play('jump', false, 1.25, 0.06);
    }
  }

  /** Colpito da ostacolo/nemico: gestito da GameController (vite, iframes). */
  applyHit(): void {
    this.invulnerable = this.cfg.rules.invulnerabilityTime;
  }

  respawnAt(d: number): void {
    this.phase = 'respawning';
    this.d = d;
    this.x = 0;
    this.y = 2.5;
    this.vy = 0;
    this.vx = 0;
    this.fallTimer = 0;
    this.invulnerable = this.cfg.rules.invulnerabilityTime + 0.6;
    this.character.play('run', true, this.cfg.character.runAnimSpeed);
    setTimeout(() => { if (this.phase === 'respawning') this.phase = 'running'; }, 350);
    this.bus.emit('respawn', { d });
  }

  update(dt: number): void {
    if (this.phase === 'idle' || this.phase === 'dead') return;
    const m = this.cfg.movement;
    this.elapsed += dt;
    if (this.invulnerable > 0) this.invulnerable -= dt;

    // Notifica cambio scaglione di velocità (per HUD/audio).
    const cur = this.speed / (m.baseSpeed * this.modifiers.speedFactor);
    if (Math.abs(cur - this.lastSpeedMult) > 0.001) {
      this.lastSpeedMult = cur;
      this.bus.emit('speedChanged', { multiplier: cur });
    }

    if (this.phase === 'falling') {
      this.fallTimer += dt;
      this.vy -= m.gravity * dt;
      this.y += this.vy * dt;
      this.d += this.speed * 0.25 * dt;
      this.syncVisual(dt);
      if (this.fallTimer > 0.9) {
        this.bus.emit('fell', { d: this.d });
        this.phase = 'respawning';
      }
      return;
    }
    if (this.phase === 'finished') {
      this.syncVisual(dt);
      return;
    }

    // Avanzamento automatico.
    this.d += this.speed * dt;

    // Laterale continuo con inerzia morbida.
    const targetVx = this.input.axis * m.lateralSpeed;
    this.vx += (targetVx - this.vx) * Math.min(1, dt * 14);
    this.x += this.vx * dt;
    const frame = this.track.getFrame(this.d);
    const margin = 0.55;
    const half = Math.max(0.6, frame.width / 2 - margin);
    this.x = Math.max(-half, Math.min(half, this.x));

    // Verticale.
    if (!this.grounded || this.y > 0) {
      this.vy -= m.gravity * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        if (!this.grounded) {
          this.grounded = true;
          this.usedDouble = false;
          this.bus.emit('landed', {});
          if (this.phase === 'running') {
            this.character.play('run', true, this.cfg.character.runAnimSpeed, 0.12);
          }
        }
      }
    }

    // Precipizio: se tocchi terra dentro una voragine, cadi.
    if (this.grounded && this.y <= 0 && this.track.isGap(this.d) && this.phase === 'running') {
      this.grounded = false;
      this.phase = 'falling';
      this.vy = -2;
      this.character.play('hit', false, 1.2, 0.1);
    }

    this.syncVisual(dt);
  }

  /** Posiziona la mesh del personaggio nel mondo. */
  private syncVisual(dt: number): void {
    const frame = this.track.getFrame(this.d);
    this.track.toWorld(this.d, this.x, this.y, this.worldPos);
    this.character.root.position.copyFrom(this.worldPos);
    const yaw = Math.atan2(frame.forward.x, frame.forward.z);
    this.character.root.rotation.y = yaw;
    // Lean laterale e in curva.
    const lean = this.vx * 0.045 + frame.curvature * this.speed * 0.4;
    this.character.visual.rotation.z += ((-lean) - this.character.visual.rotation.z) * Math.min(1, dt * 10);
    // Pendenza: inclina leggermente il busto su salite/discese.
    const ahead = this.track.getFrame(Math.min(this.d + 3, this.track.totalLength - 1));
    const slope = Math.atan2(ahead.pos.y - frame.pos.y, 3);
    this.character.visual.rotation.x += ((slope * 0.5) - this.character.visual.rotation.x) * Math.min(1, dt * 8);
  }

  get world(): Vector3 { return this.worldPos; }
}
