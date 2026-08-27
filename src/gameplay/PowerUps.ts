import {
  Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3,
} from '@babylonjs/core';
import type { PowerUpConfig, PowerUpKind } from '../config/types';
import type { TrackSystem } from '../track/TrackSystem';
import type { EventBus } from '../core/EventBus';
import { createRng } from '../core/rng';
import { loadMergedProp } from '../core/assets';
import { EntityWindow, placeEntity, type TrackEntity } from './EntityBase';

interface PowerUpEntity extends TrackEntity { kind: PowerUpKind; spin: TransformNode; }

/**
 * Power-up: icone 3D procedurali (sostituibili con GLB via config),
 * timer di durata, modificatori applicati tramite callback.
 */
export class PowerUpSystem {
  private window = new EntityWindow<PowerUpEntity>();
  private tmp = new Vector3();
  private time = 0;
  /** Effetti a tempo attivi: kind -> secondi rimanenti. */
  readonly active = new Map<PowerUpKind, { remaining: number; duration: number }>();
  shieldCharges = 0;
  collectedCount = 0;
  onActivate: ((kind: PowerUpKind) => void) | null = null;
  onExpire: ((kind: PowerUpKind) => void) | null = null;

  constructor(
    private scene: Scene,
    private track: TrackSystem,
    private cfg: PowerUpConfig,
    private bus: EventBus,
  ) {}

  async build(): Promise<void> {
    const rng = createRng(9090);
    const root = new TransformNode('powerups', this.scene);
    const templates = new Map<PowerUpKind, Mesh>();
    for (const kind of this.cfg.enabled) {
      const custom = this.cfg.models?.[kind];
      let mesh: Mesh | null = null;
      if (custom) mesh = await loadMergedProp(this.scene, custom, `pu_${kind}`);
      if (!mesh) mesh = this.makeIcon(kind);
      mesh.setEnabled(false);
      templates.set(kind, mesh);
    }

    // Distribuzione: nelle aree power-up dedicate + qualche sorpresa sparsa.
    const spots: { d: number; x: number }[] = [];
    for (const seg of this.track.plan) {
      if (seg.kind === 'powerup-area') {
        spots.push({ d: seg.startD + seg.length / 2, x: 0 });
      } else if ((seg.kind === 'coin-area' || seg.kind === 'enemy-area') && rng() < 0.4) {
        spots.push({ d: seg.startD + seg.length * (0.3 + rng() * 0.4), x: (rng() * 2 - 1) * (seg.width / 2 - 1.6) });
      }
    }
    let i = 0;
    for (const spot of spots) {
      const kind = this.cfg.enabled[i % this.cfg.enabled.length];
      i++;
      const tpl = templates.get(kind);
      if (!tpl) continue;
      const spin = new TransformNode(`puSpin_${spot.d}`, this.scene);
      const inst = tpl.createInstance(`pu_${kind}_${spot.d}`);
      inst.parent = spin;
      spin.parent = root;
      // Piedistallo luminoso.
      const ring = MeshBuilder.CreateTorus(`puRing_${spot.d}`, { diameter: 1.7, thickness: 0.09, tessellation: 24 }, this.scene);
      ring.parent = spin;
      ring.position.y = -0.85;
      const ringMat = new StandardMaterial(`puRingMat_${spot.d}`, this.scene);
      ringMat.emissiveColor = this.color(kind);
      ringMat.disableLighting = true;
      ring.material = ringMat;
      const e: PowerUpEntity = { d: spot.d, x: spot.x, y: 1.15, node: spin, spin, kind, active: true };
      placeEntity(this.track, e, this.tmp);
      this.window.items.push(e);
    }
    this.window.finalize();
  }

  color(kind: PowerUpKind): Color3 {
    switch (kind) {
      case 'shield': return Color3.FromHexString('#38bdf8');
      case 'magnet': return Color3.FromHexString('#f43f5e');
      case 'doubleScore': return Color3.FromHexString('#fbbf24');
      case 'speedBoost': return Color3.FromHexString('#22d3ee');
      case 'superJump': return Color3.FromHexString('#a3e635');
      case 'invincibility': return Color3.FromHexString('#e879f9');
    }
  }

  /** Icone 3D stilizzate per ogni power-up. */
  private makeIcon(kind: PowerUpKind): Mesh {
    const c = this.color(kind);
    const mat = new StandardMaterial(`puMat_${kind}`, this.scene);
    mat.diffuseColor = c;
    mat.emissiveColor = c.scale(0.55);
    mat.specularColor = new Color3(0.3, 0.3, 0.3);
    const parts: Mesh[] = [];
    switch (kind) {
      case 'shield': {
        const s = MeshBuilder.CreateSphere('icoShield', { diameter: 1.0, segments: 10 }, this.scene);
        s.scaling.z = 0.55;
        parts.push(s);
        break;
      }
      case 'magnet': {
        const path: Vector3[] = [];
        for (let a = 0; a <= 10; a++) {
          const t = Math.PI * (a / 10);
          path.push(new Vector3(Math.cos(t) * 0.42, Math.sin(t) * 0.42, 0));
        }
        const u = MeshBuilder.CreateTube('icoMagnet', { path, radius: 0.14, tessellation: 8 }, this.scene);
        parts.push(u);
        for (const sx of [-0.42, 0.42]) {
          const tip = MeshBuilder.CreateBox('tip', { width: 0.3, height: 0.22, depth: 0.3 }, this.scene);
          tip.position.set(sx, -0.14, 0);
          parts.push(tip);
        }
        break;
      }
      case 'doubleScore': {
        for (const dy of [0, 0.26]) {
          const coin = MeshBuilder.CreateCylinder('ico2x', { diameter: 0.85, height: 0.14, tessellation: 16 }, this.scene);
          coin.position.y = dy;
          coin.rotation.x = 0.12;
          parts.push(coin);
        }
        break;
      }
      case 'speedBoost': {
        for (const dx of [0, 0.35]) {
          const arrow = MeshBuilder.CreateCylinder('icoBoost', { diameterTop: 0, diameterBottom: 0.6, height: 0.7, tessellation: 4 }, this.scene);
          arrow.rotation.z = -Math.PI / 2;
          arrow.position.x = dx;
          parts.push(arrow);
        }
        break;
      }
      case 'superJump': {
        const spring: Vector3[] = [];
        for (let a = 0; a <= 40; a++) {
          const t = (a / 40) * Math.PI * 6;
          spring.push(new Vector3(Math.cos(t) * 0.3, (a / 40) * 0.9 - 0.45, Math.sin(t) * 0.3));
        }
        parts.push(MeshBuilder.CreateTube('icoJump', { path: spring, radius: 0.06, tessellation: 6 }, this.scene));
        break;
      }
      case 'invincibility': {
        // Stella a 5 punte fatta di coni.
        const core = MeshBuilder.CreateSphere('icoStar', { diameter: 0.5, segments: 8 }, this.scene);
        parts.push(core);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const ray = MeshBuilder.CreateCylinder('ray', { diameterTop: 0, diameterBottom: 0.26, height: 0.5, tessellation: 6 }, this.scene);
          ray.position.set(Math.cos(a) * 0.38, Math.sin(a) * 0.38, 0);
          ray.rotation.z = a - Math.PI / 2;
          parts.push(ray);
        }
        break;
      }
    }
    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
    merged.material = mat;
    return merged;
  }

  update(dt: number, pd: number, px: number, py: number): void {
    this.time += dt;
    // Scadenze.
    for (const [kind, s] of [...this.active]) {
      s.remaining -= dt;
      if (s.remaining <= 0) {
        this.active.delete(kind);
        this.onExpire?.(kind);
        this.bus.emit('powerUpExpired', { kind });
      }
    }
    const near = this.window.near(pd, 6, 60);
    for (const e of near) {
      if (!e.active) continue;
      e.y = 1.15 + Math.sin(this.time * 2 + e.d) * 0.15;
      placeEntity(this.track, e, this.tmp);
      e.spin.rotation.y = this.time * 1.8;
      if (Math.abs(e.d - pd) < 1.3 && Math.abs(e.x - px) < 1.2 && py < 2.2) {
        e.active = false;
        e.node.setEnabled(false);
        this.collect(e.kind, e.d, e.x);
      }
    }
  }

  private collect(kind: PowerUpKind, d: number, x: number): void {
    this.collectedCount++;
    if (kind === 'shield') {
      this.shieldCharges = 1;
    } else {
      const duration = this.cfg.durations[kind] ?? 8;
      this.active.set(kind, { remaining: duration, duration });
    }
    this.onActivate?.(kind);
    this.bus.emit('powerUpCollected', { kind, d, x });
  }

  has(kind: PowerUpKind): boolean {
    return kind === 'shield' ? this.shieldCharges > 0 : this.active.has(kind);
  }

  consumeShield(): boolean {
    if (this.shieldCharges > 0) { this.shieldCharges--; return true; }
    return false;
  }

  reset(): void { this.window.reset(); }
}
