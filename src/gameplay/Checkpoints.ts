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
        diameter: half * 2 + 1.5, thickness: 0.22, tessellation: 40,
      }, this.scene);
      arch.rotation.x = Math.PI / 2;
      arch.rotation.z = Math.PI / 2;
      arch.scaling.y = 0.8;
      arch.position.y = 0.2;
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
    // Insegna con testo su DynamicTexture.
    const banner = MeshBuilder.CreatePlane('finishBanner', { width: half * 2 + 3.2, height: 1.6 }, this.scene);
    banner.position.y = 6.2;
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
    // Autofit: riduce il font finché il testo entra nell'insegna.
    let size = 96;
    do {
      ctx.font = `bold ${size}px Trebuchet MS, sans-serif`;
      size -= 4;
    } while (size > 24 && ctx.measureText(label).width > 960);
    ctx.fillText(label, 512, 86);
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
    const arch = MeshBuilder.CreateTorus('finishArch', { diameter: half * 2 + 1.6, thickness: 0.35, tessellation: 48 }, this.scene);
    arch.rotation.x = Math.PI / 2;
    arch.rotation.z = Math.PI / 2;
    arch.position.y = 0.2;
    arch.material = glowMat;
    arch.parent = this.root;
  }
}
