import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import type { CollectibleConfig, MovementConfig } from '../config/types';
import type { TrackSystem } from '../track/TrackSystem';
import type { EventBus } from '../core/EventBus';
import { createRng } from '../core/rng';
import { loadMergedProp } from '../core/assets';
import { EntityWindow, placeEntity, type TrackEntity } from './EntityBase';

interface Coin extends TrackEntity { baseY: number; magnetized: boolean; }

/**
 * Monete: disposte in linee, archi sulle voragini, curve e gruppi bonus.
 * Istanze di un'unica mesh, raccolta con burst demandato agli effetti.
 */
export class CollectibleSystem {
  private window = new EntityWindow<Coin>();
  private tmp = new Vector3();
  private time = 0;
  collected = 0;
  total = 0;
  /** Raggio magnete attivo (0 = spento). */
  magnetRadius = 0;

  constructor(
    private scene: Scene,
    private track: TrackSystem,
    private cfg: CollectibleConfig,
    private movement: MovementConfig,
    private bus: EventBus,
  ) {}

  async build(): Promise<void> {
    let template: Mesh | null = null;
    if (this.cfg.model) {
      template = await loadMergedProp(this.scene, this.cfg.model, 'coin');
    }
    if (!template) {
      // Fallback procedurale: sfera di luce (per i mondi magici o quando
      // il cliente non fornisce un modello di collectible).
      const orb = MeshBuilder.CreateSphere('orb', { diameter: 0.55, segments: 10 }, this.scene);
      const mat = new StandardMaterial('orbMat', this.scene);
      mat.emissiveColor = Color3.FromHexString('#9ff2ff');
      mat.diffuseColor = Color3.FromHexString('#4dd8ff');
      mat.alpha = 0.95;
      orb.material = mat;
      const halo = MeshBuilder.CreateSphere('orbHalo', { diameter: 0.95, segments: 8 }, this.scene);
      const hm = new StandardMaterial('orbHaloMat', this.scene);
      hm.emissiveColor = Color3.FromHexString('#5fd0ff');
      hm.alpha = 0.22;
      hm.disableLighting = true;
      halo.material = hm;
      template = Mesh.MergeMeshes([orb, halo], true, true, undefined, false, true);
    }
    if (!template) return;
    const rng = createRng(555);
    const root = new TransformNode('coins', this.scene);

    const addCoin = (d: number, x: number, y: number) => {
      const inst = template!.createInstance(`coin${this.total}`);
      inst.scaling.setAll(this.cfg.scale);
      inst.parent = root;
      const coin: Coin = { d, x, y: y + 0.7, baseY: y + 0.7, magnetized: false, node: inst, active: true };
      placeEntity(this.track, coin, this.tmp);
      this.window.items.push(coin);
      this.total++;
    };

    for (const seg of this.track.plan) {
      const half = seg.width / 2 - 1.1;
      switch (seg.kind) {
        case 'coin-area': {
          // 2-3 linee parallele o a zigzag.
          let d = seg.startD + 6;
          while (d < seg.startD + seg.length - 6) {
            const lineLen = 5 + Math.floor(rng() * 4);
            const x = (rng() * 2 - 1) * half * 0.8;
            const zig = rng() < 0.35;
            for (let i = 0; i < lineLen; i++) {
              const xx = zig ? x * Math.cos(i * 0.9) : x;
              addCoin(d + i * 2.1, xx, 0);
            }
            d += lineLen * 2.1 + 6 + rng() * 8;
          }
          break;
        }
        case 'curve-left': case 'curve-right': {
          // Fila che asseconda la curva.
          const x = (seg.kind === 'curve-left' ? -1 : 1) * half * 0.4;
          for (let d = seg.startD + 8; d < seg.startD + seg.length - 8; d += 2.3) {
            if (rng() < 0.8) addCoin(d, x, 0);
          }
          break;
        }
        case 'gap': {
          // Arco che disegna la traiettoria del salto sopra la voragine.
          const mid = seg.startD + seg.length / 2;
          const w = 3.25 + 3;
          for (let i = -3; i <= 3; i++) {
            const d = mid + i * (w / 3.2);
            const y = 1.6 * (1 - (i / 3.5) * (i / 3.5));
            addCoin(d, 0, y);
          }
          break;
        }
        case 'bridge': {
          for (let d = seg.startD + 5; d < seg.startD + seg.length - 5; d += 2.2) addCoin(d, 0, 0);
          break;
        }
        case 'hill-up': case 'hill-down': {
          for (let d = seg.startD + 6; d < seg.startD + seg.length - 6; d += 2.6) {
            if (rng() < 0.6) addCoin(d, Math.sin(d * 0.25) * half * 0.5, 0);
          }
          break;
        }
        case 'final-run': {
          // Gran finale generoso: tre file piene.
          for (let d = seg.startD + 6; d < seg.startD + seg.length - 10; d += 2.2) {
            for (const x of [-half * 0.55, 0, half * 0.55]) addCoin(d, x, 0);
          }
          break;
        }
        case 'straight': case 'obstacle-area': case 'enemy-area': case 'narrow': case 'canyon': {
          for (let d = seg.startD + 6; d < seg.startD + seg.length - 6; d += 3.2) {
            if (rng() < 0.38) addCoin(d, (rng() * 2 - 1) * half * 0.7, 0);
          }
          break;
        }
      }
    }
    this.window.finalize();
    if (template) template.setEnabled(false);
  }

  update(dt: number, pd: number, px: number, py: number): void {
    this.time += dt;
    const near = this.window.near(pd, 6, 60);
    for (const c of near) {
      if (!c.active) continue;
      // Attrazione magnete.
      const dist = Math.abs(c.d - pd) + Math.abs(c.x - px);
      if (this.magnetRadius > 0 && dist < this.magnetRadius) c.magnetized = true;
      if (c.magnetized) {
        c.d += (pd - c.d) * Math.min(1, dt * 10);
        c.x += (px - c.x) * Math.min(1, dt * 10);
        c.y += (py + 0.7 - c.y) * Math.min(1, dt * 10);
      } else {
        c.y = c.baseY + Math.sin(this.time * 2.5 + c.d) * 0.12;
      }
      placeEntity(this.track, c, this.tmp);
      c.node.rotation.y = this.time * 3 + c.d * 0.4;
      // Raccolta.
      const r = this.cfg.radius + (c.magnetized ? 0.6 : 0);
      if (Math.abs(c.d - pd) < r + 0.4 && Math.abs(c.x - px) < r && Math.abs(c.y - (py + 0.7)) < 1.3) {
        c.active = false;
        c.node.setEnabled(false);
        this.collected++;
        this.bus.emit('coinCollected', { d: c.d, x: c.x, y: c.y, total: this.collected });
      }
    }
    void this.movement;
  }

  /** Riattiva le monete oltre il punto di respawn (ma non quelle già prese prima). */
  reset(): void { this.window.reset(); }
}

export type { Coin };
