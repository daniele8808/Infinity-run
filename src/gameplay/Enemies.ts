import {
  Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3,
} from '@babylonjs/core';
import type { EnemyConfig } from '../config/types';
import type { TrackSystem } from '../track/TrackSystem';
import { createRng } from '../core/rng';
import { loadModel } from '../core/assets';
import { EntityWindow, placeEntity, type TrackEntity } from './EntityBase';

type Behavior = 'idle' | 'patrol' | 'cross' | 'hop';

interface Enemy extends TrackEntity {
  behavior: Behavior;
  amp: number;
  phase: number;
  speed: number;
  baseX: number;
  visual: TransformNode;
  hitConsumed: boolean;
}

/**
 * Nemici cartoon. Default: slime procedurale (corpo squash&stretch, occhi,
 * spuntoni) sostituibile con un GLB via config (enemy.model).
 */
export class EnemySystem {
  private window = new EntityWindow<Enemy>();
  private tmp = new Vector3();
  private time = 0;
  onHit: ((e: Enemy) => void) | null = null;

  constructor(private scene: Scene, private track: TrackSystem, private cfg: EnemyConfig) {}

  async build(): Promise<void> {
    const rng = createRng(1313);
    const root = new TransformNode('enemies', this.scene);

    // Template: GLB dal config oppure slime procedurale.
    let template: Mesh;
    if (this.cfg.model) {
      try {
        const model = await loadModel(this.scene, this.cfg.model, 'enemy');
        const merged = Mesh.MergeMeshes(model.meshes, true, true, undefined, false, true);
        template = merged ?? this.makeSlime();
      } catch {
        template = this.makeSlime();
      }
    } else {
      template = this.makeSlime();
    }
    template.setEnabled(false);

    const add = (behavior: Behavior, d: number, x: number, amp: number) => {
      const visual = new TransformNode(`enemyV_${d}`, this.scene);
      const inst = template.createInstance(`enemy_${d}`);
      inst.parent = visual;
      inst.scaling.setAll(this.cfg.scale);
      visual.parent = root;
      const e: Enemy = {
        d, x, y: 0, baseX: x, node: visual, visual, active: true,
        behavior, amp, phase: rng() * Math.PI * 2,
        speed: 0.9 + rng() * 0.8, hitConsumed: false,
      };
      placeEntity(this.track, e, this.tmp);
      this.window.items.push(e);
    };

    for (const seg of this.track.plan) {
      if (seg.kind !== 'enemy-area' && seg.kind !== 'final-run' && seg.kind !== 'canyon') continue;
      const half = seg.width / 2;
      const phase = seg.startD / this.track.totalLength;
      const spacing = seg.kind === 'enemy-area' ? (phase < 0.6 ? 18 : 14) : 26;
      for (let d = Math.max(seg.startD + 12, 90); d < seg.startD + seg.length - 8; d += spacing * (0.85 + rng() * 0.4)) {
        const r = rng();
        if (r < 0.3) add('idle', d, (rng() * 2 - 1) * (half - 1.6), 0);
        else if (r < 0.6) add('patrol', d, 0, half - 1.5);
        else if (r < 0.85) add('cross', d, 0, half - 1.2);
        else add('hop', d, (rng() * 2 - 1) * (half - 1.6), 0);
      }
    }
    this.window.finalize();
  }

  /** Slime cartoon: cupola gelatinosa, occhi grandi, tre spuntoni. */
  private makeSlime(): Mesh {
    const body = MeshBuilder.CreateSphere('slimeBody', { diameterX: 1.5, diameterY: 1.1, diameterZ: 1.5, segments: 12 }, this.scene);
    body.position.y = 0.55;
    const bodyMat = new StandardMaterial('slimeMat', this.scene);
    bodyMat.diffuseColor = Color3.FromHexString('#7b2fbe');
    bodyMat.emissiveColor = Color3.FromHexString('#2a0f45');
    bodyMat.specularColor = new Color3(0.4, 0.4, 0.5);
    body.material = bodyMat;

    const eyeMat = new StandardMaterial('slimeEyeMat', this.scene);
    eyeMat.diffuseColor = Color3.White();
    eyeMat.emissiveColor = new Color3(0.6, 0.6, 0.6);
    const pupilMat = new StandardMaterial('slimePupilMat', this.scene);
    pupilMat.diffuseColor = Color3.Black();
    const parts: Mesh[] = [body];
    for (const sx of [-0.3, 0.3]) {
      const eye = MeshBuilder.CreateSphere('eye', { diameter: 0.36, segments: 8 }, this.scene);
      eye.position.set(sx, 0.78, 0.55);
      eye.material = eyeMat;
      const pupil = MeshBuilder.CreateSphere('pupil', { diameter: 0.16, segments: 6 }, this.scene);
      pupil.position.set(sx, 0.78, 0.71);
      pupil.material = pupilMat;
      parts.push(eye, pupil);
    }
    const spikeMat = new StandardMaterial('slimeSpikeMat', this.scene);
    spikeMat.diffuseColor = Color3.FromHexString('#ffd166');
    for (const [sx, sz] of [[-0.35, -0.2], [0, -0.05], [0.35, -0.2]] as const) {
      const spike = MeshBuilder.CreateCylinder('spike', { diameterTop: 0, diameterBottom: 0.28, height: 0.55, tessellation: 6 }, this.scene);
      spike.position.set(sx, 1.05, sz);
      spike.material = spikeMat;
      parts.push(spike);
    }
    return Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
  }

  update(dt: number, pd: number, px: number, py: number, canHit: boolean): void {
    this.time += dt;
    const near = this.window.near(pd, 8, 70);
    for (const e of near) {
      if (!e.active) continue;
      const t = this.time * e.speed + e.phase;
      switch (e.behavior) {
        case 'patrol': e.x = Math.sin(t) * e.amp; break;
        case 'cross': e.x = ((t * 0.6) % 2 < 1 ? -1 : 1) * ((((t * 0.6) % 1) * 2 - 1)) * e.amp; break;
        case 'hop': e.y = Math.abs(Math.sin(t * 2.2)) * 0.9; break;
        case 'idle': break;
      }
      // Squash & stretch cartoon.
      const squash = 1 + Math.sin(this.time * 6 + e.phase) * 0.08;
      e.visual.scaling.set(1 / squash, squash, 1 / squash);
      placeEntity(this.track, e, this.tmp);
      if (!canHit || e.hitConsumed) continue;
      if (Math.abs(e.d - pd) < 1.1 && Math.abs(e.x - px) < 1.1 && py < 1.15 + e.y) {
        e.hitConsumed = true;
        setTimeout(() => { e.hitConsumed = false; }, 1200);
        this.onHit?.(e);
      }
    }
  }

  reset(): void { this.window.reset(); }
}

export type { Enemy };
