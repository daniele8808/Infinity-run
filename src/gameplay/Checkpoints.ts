import {
  Color3, DynamicTexture, MeshBuilder, Scene, StandardMaterial, TransformNode,
} from '@babylonjs/core';
import type { TrackSystem } from '../track/TrackSystem';
import type { EventBus } from '../core/EventBus';
import { loadMergedProp } from '../core/assets';

interface Checkpoint { index: number; d: number; passed: boolean; arch: TransformNode; glowMat: StandardMaterial; }

/**
 * Checkpoint: portali luminosi con bandiere. Al passaggio salvano la
 * posizione di respawn ed emettono l'evento per punteggio/UI/audio.
 */
export class CheckpointSystem {
  private checkpoints: Checkpoint[] = [];
  lastPassedD = 0;
  lastPassedIndex = -1;
  private time = 0;

  constructor(
    private scene: Scene,
    private track: TrackSystem,
    private bus: EventBus,
    private flagModelUrl: string,
    private accent: Color3,
  ) {}

  async build(): Promise<void> {
    const flag = await loadMergedProp(this.scene, this.flagModelUrl, 'flag');
    for (const cp of this.track.checkpoints) {
      const frame = this.track.getFrame(cp.d);
      const root = new TransformNode(`checkpoint${cp.index}`, this.scene);
      root.position.copyFrom(frame.pos);
      root.rotation.y = Math.atan2(frame.forward.x, frame.forward.z);
      const half = frame.width / 2;

      // Arco luminoso.
      const glowMat = new StandardMaterial(`cpGlow${cp.index}`, this.scene);
      glowMat.emissiveColor = this.accent;
      glowMat.disableLighting = true;
      glowMat.alpha = 0.75;
      const arch = MeshBuilder.CreateTorus(`cpArch${cp.index}`, {
        diameter: half * 2 - 0.8, thickness: 0.2, tessellation: 40,
      }, this.scene);
      arch.rotation.x = Math.PI / 2;
      arch.position.y = 0.35;
      arch.material = glowMat;
      arch.parent = root;

      // Bandiere ai lati.
      if (flag) {
        for (const side of [-1, 1]) {
          const inst = flag.createInstance(`cpFlag${cp.index}_${side}`);
          inst.parent = root;
          inst.position.set(side * (half + 0.6), 0, 0);
          inst.scaling.setAll(2.2);
        }
      }
      this.checkpoints.push({ index: cp.index, d: cp.d, passed: false, arch: root, glowMat });
    }
  }

  update(dt: number, pd: number): void {
    this.time += dt;
    for (const cp of this.checkpoints) {
      cp.glowMat.alpha = 0.55 + Math.sin(this.time * 3 + cp.index) * 0.2;
      if (!cp.passed && pd >= cp.d) {
        cp.passed = true;
        this.lastPassedD = cp.d;
        this.lastPassedIndex = cp.index;
        this.bus.emit('checkpointReached', { index: cp.index, d: cp.d });
      }
    }
  }
}

/** Traguardo: grande portale con struttura e insegna. */
export class FinishGate {
  root: TransformNode;

  constructor(private scene: Scene, private track: TrackSystem, primary: Color3, secondary: Color3, label: string) {
    const d = this.track.finishD;
    const frame = this.track.getFrame(d);
    this.root = new TransformNode('finishGate', this.scene);
    this.root.position.copyFrom(frame.pos);
    this.root.rotation.y = Math.atan2(frame.forward.x, frame.forward.z);
    const half = frame.width / 2;

    const pillarMat = new StandardMaterial('finishPillarMat', this.scene);
    pillarMat.diffuseColor = secondary;
    pillarMat.specularColor = Color3.Black();
    for (const side of [-1, 1]) {
      const pillar = MeshBuilder.CreateCylinder(`finishPillar${side}`, { diameter: 0.9, height: 6.5, tessellation: 10 }, this.scene);
      pillar.position.set(side * (half + 0.8), 3.25, 0);
      pillar.material = pillarMat;
      pillar.parent = this.root;
    }
    this.buildFinishDressing(half, primary, secondary);
    // Insegna con testo su DynamicTexture.
    const banner = MeshBuilder.CreatePlane('finishBanner', { width: half * 2 + 3.2, height: 1.6 }, this.scene);
    banner.position.y = 7.5;
    banner.rotation.y = Math.PI;
    const tex = new DynamicTexture('finishTex', { width: 1024, height: 160 }, this.scene, true);
    tex.uScale = -1;
    tex.uOffset = 1;
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = primary.toHexString();
    ctx.fillRect(0, 0, 1024, 160);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 88px Trebuchet MS, sans-serif';
    // Compressione orizzontale esplicita: alcuni renderer ignorano il
    // maxWidth di fillText, la scala del contesto no.
    // measureText e' inaffidabile su alcuni renderer: se il valore non e'
    // plausibile si usa una stima per carattere (bold 88px ~ 53px/car).
    let textW = ctx.measureText(label).width;
    if (!(textW > label.length * 20)) textW = label.length * 53;
    const squeeze = Math.min(1, 900 / textW);
    ctx.save();
    ctx.translate(512, 86);
    ctx.scale(squeeze, 1);
    ctx.fillText(label, 0, 0);
    ctx.restore();
    tex.update();
    const bMat = new StandardMaterial('finishBannerMat', this.scene);
    bMat.emissiveTexture = tex;
    bMat.disableLighting = true;
    bMat.backFaceCulling = false;
    banner.material = bMat;
    banner.parent = this.root;

    // Portale luminoso.
    const glowMat = new StandardMaterial('finishGlow', this.scene);
    glowMat.emissiveColor = primary;
    glowMat.disableLighting = true;
    glowMat.alpha = 0.5;
    const arch = MeshBuilder.CreateTorus('finishArch', { diameter: half * 2 - 0.6, thickness: 0.32, tessellation: 48 }, this.scene);
    arch.rotation.x = Math.PI / 2;
    arch.position.y = 0.35;
    arch.material = glowMat;
    arch.parent = this.root;
  }

  /** Scenografia del traguardo: linea a scacchi e bandierine. */
  private buildFinishDressing(half: number, primary: Color3, secondary: Color3): void {
    // Texture a scacchi bianco/nero riusata da linea e cartello.
    const checkerTex = new DynamicTexture('finishCheckerTex', { width: 512, height: 128 }, this.scene, false);
    const cctx = checkerTex.getContext() as CanvasRenderingContext2D;
    const cell = 32;
    for (let cy = 0; cy < 4; cy++) {
      for (let cx = 0; cx < 16; cx++) {
        cctx.fillStyle = (cx + cy) % 2 === 0 ? '#ffffff' : '#1c1c22';
        cctx.fillRect(cx * cell, cy * cell, cell, cell);
      }
    }
    checkerTex.update();
    const checkerMat = new StandardMaterial('finishCheckerMat', this.scene);
    checkerMat.emissiveTexture = checkerTex;
    checkerMat.disableLighting = true;
    checkerMat.backFaceCulling = false;

    // Linea del traguardo a scacchi sull'asfalto.
    const line = MeshBuilder.CreateGround('finishLine', { width: half * 2 - 0.3, height: 1.7, subdivisions: 1 }, this.scene);
    line.position.y = 0.06;
    line.material = checkerMat;
    line.parent = this.root;

    // Festoni di bandierine tra i pali (due corde con leggera catenaria).
    const flagMats = [primary, secondary, Color3.White()].map((c, i) => {
      const m = new StandardMaterial(`finishFlagMat${i}`, this.scene);
      m.emissiveColor = c;
      m.disableLighting = true;
      m.backFaceCulling = false;
      return m;
    });
    const span = half * 2 + 1.6;
    for (const [baseY, zOff, sag] of [[6.4, 0.5, 0.7], [6.4, -0.5, 0.55]] as const) {
      const n = 11;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = -span / 2 + t * span;
        const y = baseY - Math.sin(t * Math.PI) * sag;
        const flag = MeshBuilder.CreateDisc(`finishFlag_${zOff}_${i}`, { radius: 0.34, tessellation: 3 }, this.scene);
        flag.position.set(x, y, zOff);
        flag.rotation.z = Math.PI / 2;
        flag.material = flagMats[i % 3];
        flag.parent = this.root;
      }
    }

    // Bandierine triangolari in cima ai pali.
    for (const side of [-1, 1]) {
      const top = MeshBuilder.CreateDisc(`finishTopFlag${side}`, { radius: 0.55, tessellation: 3 }, this.scene);
      top.position.set(side * (half + 0.8), 7.0, 0);
      top.rotation.z = side > 0 ? Math.PI : 0;
      top.material = flagMats[0];
      top.parent = this.root;
    }
  }
}
