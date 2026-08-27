import { FreeCamera, Scene, Vector3 } from '@babylonjs/core';
import type { TrackSystem } from '../track/TrackSystem';
import type { RunController } from '../gameplay/RunController';

/**
 * Camera third-person dinamica: segue da dietro leggermente rialzata,
 * anticipa e inclina nelle curve, shake sugli impatti, FOV che si
 * allarga con la velocità.
 */
export class ChaseCamera {
  readonly camera: FreeCamera;
  private shake = 0;
  private baseFov = 0.92;
  private fovTarget = 0.92;
  private pos = new Vector3();
  private target = new Vector3();
  private smoothPos: Vector3 | null = null;
  private smoothTarget: Vector3 | null = null;
  private roll = 0;
  /** Modalità intro: inquadra il personaggio frontalmente. */
  introMode = true;
  /** Distanza/quota dell'inquadratura intro (allargata nel countdown). */
  introDistance = 4.4;
  introHeight = 1.7;
  private t = 0;

  constructor(scene: Scene, private track: TrackSystem, private run: RunController) {
    this.camera = new FreeCamera('chaseCam', new Vector3(0, 3, -6), scene);
    this.camera.minZ = 0.3;
    this.camera.maxZ = 1500;
    this.camera.fov = this.baseFov;
    scene.activeCamera = this.camera;
  }

  addShake(amount: number): void { this.shake = Math.min(1.4, this.shake + amount); }
  setFovBoost(on: boolean): void { this.fovTarget = on ? this.baseFov + 0.16 : this.baseFov; }

  update(dt: number): void {
    this.t += dt;
    // In portrait l'orizzontale si stringe: allarga il campo visivo.
    const aspect = this.camera.getEngine().getAspectRatio(this.camera);
    const base = aspect < 1 ? 1.18 : 0.92;
    if (base !== this.baseFov) {
      const boosted = this.fovTarget > this.baseFov;
      this.baseFov = base;
      this.fovTarget = boosted ? base + 0.16 : base;
    }
    const run = this.run;
    if (this.introMode) {
      // Davanti al personaggio, che guarda in camera.
      const f = this.track.getFrame(run.d);
      this.pos.copyFrom(run.world)
        .addInPlace(f.forward.scale(-this.introDistance))
        .addInPlace(f.right.scale(0.9));
      this.pos.y += this.introHeight;
      this.target.copyFrom(run.world);
      this.target.y += 1.0;
    } else {
      const back = 7.2;
      const ahead = 10 + run.speed * 0.35;
      const fBack = this.track.getFrame(Math.max(0, run.d - back));
      const fAhead = this.track.getFrame(Math.min(this.track.totalLength - 1, run.d + ahead));
      const fHere = this.track.getFrame(run.d);
      // Posizione: dietro sulla spline, rialzata; segue in parte l'offset laterale.
      this.pos.copyFrom(fBack.pos)
        .addInPlace(fBack.right.scale(run.x * 0.55));
      // Scavalca le creste: la camera resta sopra il punto più alto della
      // strada fra la sua posizione e il personaggio.
      const fMid = this.track.getFrame(Math.max(0, run.d - back * 0.5));
      const crest = Math.max(fBack.pos.y, fMid.pos.y, fHere.pos.y);
      this.pos.y = crest + 3.1 + Math.min(1.6, Math.max(0, run.y) * 0.35);
      // Target: avanti lungo il percorso (anticipa la curva).
      this.target.copyFrom(fAhead.pos).addInPlace(fAhead.right.scale(run.x * 0.3));
      this.target.y = fHere.pos.y + 1.4 + run.y * 0.55;
      // Inclinazione in curva.
      const targetRoll = -fHere.curvature * run.speed * 0.55;
      this.roll += (targetRoll - this.roll) * Math.min(1, dt * 4);
    }

    // Smoothing.
    if (!this.smoothPos) { this.smoothPos = this.pos.clone(); this.smoothTarget = this.target.clone(); }
    const k = this.introMode ? Math.min(1, dt * 5) : Math.min(1, dt * 7.5);
    this.smoothPos.addInPlace(this.pos.subtract(this.smoothPos).scale(k));
    this.smoothTarget!.addInPlace(this.target.subtract(this.smoothTarget!).scale(k));

    // Camera shake decrescente.
    let sx = 0, sy = 0;
    if (this.shake > 0.001) {
      this.shake *= Math.exp(-dt * 6);
      sx = (Math.sin(this.t * 47) + Math.sin(this.t * 31.7)) * 0.05 * this.shake;
      sy = (Math.cos(this.t * 39) + Math.sin(this.t * 51.3)) * 0.05 * this.shake;
    }

    this.camera.position.copyFrom(this.smoothPos);
    this.camera.position.x += sx;
    this.camera.position.y += sy;
    this.camera.setTarget(this.smoothTarget!);
    if (!this.introMode) {
      this.camera.rotation.z = this.roll;
    }
    this.camera.fov += (this.fovTarget - this.camera.fov) * Math.min(1, dt * 3);
  }
}
