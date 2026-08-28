import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3, VertexBuffer } from '@babylonjs/core';
import type { TrackSystem } from '../track/TrackSystem';
import { createRng } from '../core/rng';
import { loadMergedProp } from '../core/assets';
import { EntityWindow, placeEntity, type TrackEntity } from './EntityBase';

type ObstacleKind = 'rock' | 'log' | 'barrier' | 'slider';

interface Obstacle extends TrackEntity {
  kind: ObstacleKind;
  /** Semilarghezza collisione. */
  hx: number;
  /** Profondità collisione lungo d. */
  hd: number;
  /** Altezza: saltando sopra questa quota si è salvi. */
  height: number;
  /** Per gli ostacoli mobili. */
  slideAmp: number;
  slidePhase: number;
  hitConsumed: boolean;
}

/**
 * Ostacoli: rocce (GLB), tronchi da saltare, barriere e rocce mobili che
 * attraversano la strada. Tutti leggibili con anticipo e mai unfair.
 */
export class ObstacleSystem {
  private window = new EntityWindow<Obstacle>();
  private tmp = new Vector3();
  private time = 0;
  onHit: ((o: Obstacle) => void) | null = null;

  constructor(private scene: Scene, private track: TrackSystem, _assetPath: string, private rockModels: string[] = []) {}

  async build(): Promise<void> {
    const rng = createRng(808);
    const root = new TransformNode('obstacles', this.scene);
    // Rocce: modelli low-poly del pack (KayKit), normalizzati sulla
    // dimensione massima (alcuni sono lastre larghe e basse); collisioni
    // calcolate dalle misure reali. Fallback procedurale se non caricano.
    const rocks: { mesh: Mesh; hx: number; height: number }[] = [];
    for (const url of this.rockModels) {
      try {
        const m = await loadMergedProp(this.scene, url, `rock_${rocks.length}`);
        if (m) rocks.push(this.normalizeRock(m));
      } catch { /* fallback sotto */ }
    }
    if (!rocks.length) {
      rocks.push(this.normalizeRock(this.makeBoulder(11)), this.normalizeRock(this.makeBoulder(77)));
    }

    const woodMat = new StandardMaterial('logMat', this.scene);
    woodMat.diffuseColor = Color3.FromHexString('#8a5a33');
    woodMat.specularColor = Color3.Black();
    const woodEndMat = new StandardMaterial('logEndMat', this.scene);
    woodEndMat.diffuseColor = Color3.FromHexString('#c89a66');
    const barrierMat = new StandardMaterial('barrierMat', this.scene);
    barrierMat.diffuseColor = Color3.FromHexString('#d6452b');
    barrierMat.specularColor = Color3.Black();
    const barrierMat2 = new StandardMaterial('barrierMat2', this.scene);
    barrierMat2.diffuseColor = Color3.FromHexString('#f2ede4');
    barrierMat2.specularColor = Color3.Black();

    const logTemplate = (() => {
      const body = MeshBuilder.CreateCylinder('log', { diameter: 0.95, height: 4.4, tessellation: 9 }, this.scene);
      body.rotation.z = Math.PI / 2;
      body.material = woodMat;
      body.bakeCurrentTransformIntoVertices();
      return body;
    })();
    logTemplate.setEnabled(false);

    const barrierTemplate = (() => {
      const parts: Mesh[] = [];
      for (let i = 0; i < 3; i++) {
        const bar = MeshBuilder.CreateBox(`bar${i}`, { width: 3.4, height: 0.24, depth: 0.18 }, this.scene);
        bar.position.y = 0.32 + i * 0.32;
        bar.material = i % 2 === 0 ? barrierMat : barrierMat2;
        parts.push(bar);
      }
      for (const sx of [-1.6, 1.6]) {
        const post = MeshBuilder.CreateBox(`post${sx}`, { width: 0.16, height: 1.1, depth: 0.16 }, this.scene);
        post.position.set(sx, 0.55, 0);
        post.material = barrierMat;
        parts.push(post);
      }
      const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
      merged.setEnabled(false);
      return merged;
    })();

    const add = (kind: ObstacleKind, d: number, x: number, opts: Partial<Obstacle> = {}) => {
      let node: TransformNode;
      let hx = 1, hd = 1, height = 1;
      switch (kind) {
        case 'rock': {
          const t = rocks[Math.floor(rng() * rocks.length)];
          if (!t) return;
          const inst = t.mesh.createInstance(`ob_rock_${d}`);
          const s = 1.0 + rng() * 0.6;
          inst.scaling.setAll(s);
          node = inst;
          hx = t.hx * s * 0.85; hd = 0.9;
          height = Math.max(0.6, t.height * s * 0.8);
          break;
        }
        case 'log': {
          const inst = logTemplate.createInstance(`ob_log_${d}`);
          // Il tronco si adatta alla larghezza reale della strada in quel
          // punto: sulle passerelle strette non deve sbordare nel vuoto.
          const roadW = this.track.getFrame(d).width;
          const sx = Math.min(1, Math.max(0.45, (roadW - 0.9) / 4.4));
          inst.scaling.x = sx;
          node = inst;
          inst.position.y = 0.45;
          hx = (4.4 * sx) / 2; hd = 0.75; height = 0.95;
          break;
        }
        case 'barrier': {
          const inst = barrierTemplate.createInstance(`ob_bar_${d}`);
          node = inst;
          hx = 1.7; hd = 0.5; height = 1.05;
          break;
        }
        case 'slider': {
          const t = rocks[0];
          if (!t) return;
          const inst = t.mesh.createInstance(`ob_slider_${d}`);
          inst.scaling.setAll(1.4);
          node = inst;
          hx = t.hx * 1.4 * 0.8; hd = 0.95;
          height = Math.max(0.8, t.height * 1.4 * 0.8);
          break;
        }
      }
      node.parent = root;
      const o: Obstacle = {
        kind, d, x, y: 0, node, active: true,
        hx, hd, height,
        slideAmp: 0, slidePhase: rng() * Math.PI * 2,
        hitConsumed: false,
        ...opts,
      };
      placeEntity(this.track, o, this.tmp);
      node.rotation.y = kind === 'log' || kind === 'barrier' ? this.yawAt(d) : rng() * Math.PI * 2;
      this.window.items.push(o);
    };

    for (const seg of this.track.plan) {
      const half = seg.width / 2;
      const localRng = rng;
      const density =
        seg.kind === 'obstacle-area' ? 1 :
        seg.kind === 'canyon' ? 0.8 :
        seg.kind === 'narrow' ? 0.5 :
        seg.kind === 'straight' ? 0.25 :
        seg.kind === 'final-run' ? 0.45 : 0;
      if (density === 0) continue;
      // Progressione: più fitti nell'ultimo quarto.
      const phase = seg.startD / this.track.totalLength;
      const gapBetween = (phase < 0.25 ? 26 : phase < 0.5 ? 20 : phase < 0.75 ? 16 : 13) / density;
      for (let d = Math.max(seg.startD + 10, 80); d < seg.startD + seg.length - 8; d += gapBetween * (0.8 + localRng() * 0.5)) {
        const r = localRng();
        if (r < 0.34) add('rock', d, (localRng() * 2 - 1) * (half - 1.4));
        else if (r < 0.58) add('log', d, (localRng() * 2 - 1) * (half - 2.4));
        else if (r < 0.8) add('barrier', d, (localRng() * 2 - 1) * (half - 2.0));
        else if (phase > 0.4) add('slider', d, 0, { slideAmp: half - 1.3 });
        else add('rock', d, (localRng() * 2 - 1) * (half - 1.4));
      }
    }
    this.window.finalize();
  }

  /**
   * Normalizza un modello roccia: dimensione massima ~1.5m (alcune rocce
   * del pack sono lastre larghe e basse), base a y=0, centrata. Restituisce
   * le misure reali per una collisione onesta.
   */
  private normalizeRock(m: Mesh): { mesh: Mesh; hx: number; height: number } {
    const bb = m.getBoundingInfo().boundingBox;
    const dx = bb.maximum.x - bb.minimum.x;
    const dy = bb.maximum.y - bb.minimum.y;
    const dz = bb.maximum.z - bb.minimum.z;
    const s = 1.5 / Math.max(0.001, dx, dy, dz);
    const cx = (bb.minimum.x + bb.maximum.x) / 2;
    const cz = (bb.minimum.z + bb.maximum.z) / 2;
    m.position.set(-cx * s, -bb.minimum.y * s, -cz * s);
    m.scaling.setAll(s);
    m.bakeCurrentTransformIntoVertices();
    m.refreshBoundingInfo();
    // Molti sassi low-poly hanno il fondo aperto: senza doppia faccia
    // sembrano gusci vuoti appena crescono di scala.
    if (m.material) (m.material as StandardMaterial).backFaceCulling = false;
    return { mesh: m, hx: (Math.max(dx, dz) * s) / 2, height: dy * s };
  }

  /** Masso low-poly convesso generato proceduralmente. */
  private makeBoulder(seed: number): Mesh {
    const rng = createRng(seed);
    const m = MeshBuilder.CreatePolyhedron(`boulder${seed}`, { type: 3, size: 0.85 }, this.scene);
    const pos = m.getVerticesData(VertexBuffer.PositionKind)!.slice();
    for (let i = 0; i < pos.length; i += 3) {
      // Perturbazione leggera: resta convesso (variazioni forti creavano
      // pieghe concave da "foglio accartocciato").
      const k = 0.9 + rng() * 0.22;
      pos[i] *= k;
      pos[i + 1] = Math.max(pos[i + 1] * k * 0.82, -0.5);
      pos[i + 2] *= k;
    }
    m.setVerticesData(VertexBuffer.PositionKind, pos);
    m.convertToFlatShadedMesh();
    const mat = new StandardMaterial(`boulderMat${seed}`, this.scene);
    // Grigio pietra scuro: con sole + ambiente pieni un grigio chiaro
    // satura e diventa un blocco bianco.
    mat.diffuseColor = Color3.FromHexString('#3c4046');
    mat.emissiveColor = Color3.FromHexString('#0b0c0e');
    mat.specularColor = Color3.Black();
    m.material = mat;
    m.setEnabled(false);
    return m;
  }

  private yawAt(d: number): number {
    const f = this.track.getFrame(d);
    return Math.atan2(f.forward.x, f.forward.z);
  }

  update(dt: number, pd: number, px: number, py: number, canHit: boolean): void {
    this.time += dt;
    this.window.maybeCull(dt, pd);
    const near = this.window.near(pd, 8, 70);
    for (const o of near) {
      if (!o.active) continue;
      if (o.kind === 'slider' && o.slideAmp > 0) {
        o.x = Math.sin(this.time * 1.4 + o.slidePhase) * o.slideAmp;
        placeEntity(this.track, o, this.tmp);
        o.node.rotation.y += dt * 2;
      }
      if (!canHit || o.hitConsumed) continue;
      if (
        Math.abs(o.d - pd) < o.hd + 0.55 &&
        Math.abs(o.x - px) < o.hx + 0.45 &&
        py < o.height
      ) {
        o.hitConsumed = true;
        setTimeout(() => { o.hitConsumed = false; }, 1200);
        this.onHit?.(o);
      }
    }
  }

  reset(): void { this.window.reset(); }
}

export type { Obstacle };
