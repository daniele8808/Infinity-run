import {
  Color3, Color4, Mesh, MeshBuilder, ParticleSystem, Scene, StandardMaterial,
  TransformNode, Vector3,
} from '@babylonjs/core';
import { makeCircleTexture } from '../world/ForestTheme';

/**
 * Feedback visivi: burst particellari (pool), onda dei checkpoint,
 * bolla scudo, confetti del traguardo.
 */
export class Effects {
  private bursts: ParticleSystem[] = [];
  private burstIndex = 0;
  private waves: { mesh: Mesh; mat: StandardMaterial; t: number }[] = [];
  shieldBubble: Mesh;
  blobShadow: Mesh;
  private confetti: ParticleSystem | null = null;

  constructor(private scene: Scene) {
    // Pool di burst one-shot.
    for (let i = 0; i < 6; i++) {
      const ps = new ParticleSystem(`burst${i}`, 40, scene);
      ps.particleTexture = makeCircleTexture(scene, '#ffffff');
      ps.emitter = new Vector3();
      ps.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
      ps.maxEmitBox = new Vector3(0.1, 0.1, 0.1);
      ps.minSize = 0.12; ps.maxSize = 0.3;
      ps.minLifeTime = 0.25; ps.maxLifeTime = 0.5;
      ps.emitRate = 0;
      ps.manualEmitCount = 0;
      ps.minEmitPower = 2; ps.maxEmitPower = 4.5;
      ps.direction1 = new Vector3(-1, 0.4, -1);
      ps.direction2 = new Vector3(1, 1.6, 1);
      ps.gravity = new Vector3(0, -6, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      ps.start();
      this.bursts.push(ps);
    }

    this.shieldBubble = MeshBuilder.CreateSphere('shieldBubble', { diameter: 2.3, segments: 12 }, scene);
    const sm = new StandardMaterial('shieldBubbleMat', scene);
    sm.emissiveColor = Color3.FromHexString('#38bdf8');
    sm.alpha = 0.22;
    sm.disableLighting = true;
    this.shieldBubble.material = sm;
    this.shieldBubble.isPickable = false;
    this.shieldBubble.setEnabled(false);

    // Ombra morbida sotto il personaggio: legge l'altezza del salto.
    this.blobShadow = MeshBuilder.CreateDisc('blobShadow', { radius: 0.62, tessellation: 24 }, scene);
    this.blobShadow.rotation.x = Math.PI / 2;
    const bm = new StandardMaterial('blobShadowMat', scene);
    bm.diffuseColor = Color3.Black();
    bm.emissiveColor = Color3.Black();
    bm.alpha = 0.28;
    bm.disableLighting = true;
    // Polygon offset: elimina lo z-fighting (sfarfallio) con la strada.
    bm.zOffset = -4;
    this.blobShadow.material = bm;
    this.blobShadow.isPickable = false;
  }

  /** Posiziona l'ombra blob: più piccola e tenue quando il personaggio salta. */
  updateBlobShadow(groundPos: { x: number; y: number; z: number }, jumpHeight: number): void {
    this.blobShadow.position.set(groundPos.x, groundPos.y + 0.06, groundPos.z);
    const k = Math.max(0.45, 1 - jumpHeight * 0.22);
    this.blobShadow.scaling.set(k, k, k);
    (this.blobShadow.material as StandardMaterial).alpha = 0.28 * k;
  }

  burst(pos: Vector3, color: Color3, count = 14, power = 1): void {
    const ps = this.bursts[this.burstIndex++ % this.bursts.length];
    (ps.emitter as Vector3).copyFrom(pos);
    ps.color1 = new Color4(color.r, color.g, color.b, 1);
    ps.color2 = new Color4(Math.min(1, color.r * 1.4), Math.min(1, color.g * 1.4), Math.min(1, color.b * 1.4), 1);
    ps.colorDead = new Color4(color.r, color.g, color.b, 0);
    ps.minEmitPower = 2 * power; ps.maxEmitPower = 4.5 * power;
    ps.manualEmitCount = count;
  }

  /** Onda luminosa che si espande (checkpoint). */
  wave(pos: Vector3, color: Color3): void {
    const mesh = MeshBuilder.CreateTorus('wave', { diameter: 1, thickness: 0.15, tessellation: 32 }, this.scene);
    mesh.position.copyFrom(pos);
    mesh.position.y += 0.3;
    const mat = new StandardMaterial('waveMat', this.scene);
    mat.emissiveColor = color;
    mat.disableLighting = true;
    mat.alpha = 0.8;
    mesh.material = mat;
    this.waves.push({ mesh, mat, t: 0 });
  }

  /** Confetti per il traguardo. */
  celebrate(node: TransformNode): void {
    if (this.confetti) this.confetti.dispose();
    const ps = new ParticleSystem('confetti', 400, this.scene);
    ps.particleTexture = makeCircleTexture(this.scene, '#ffffff');
    ps.emitter = node.position.add(new Vector3(0, 6, 0));
    ps.minEmitBox = new Vector3(-5, 0, -2);
    ps.maxEmitBox = new Vector3(5, 2, 2);
    ps.color1 = new Color4(1, 0.42, 0.56, 1);
    ps.color2 = new Color4(1, 0.83, 0.29, 1);
    ps.colorDead = new Color4(0.4, 0.85, 1, 0);
    ps.minSize = 0.12; ps.maxSize = 0.28;
    ps.minLifeTime = 1.6; ps.maxLifeTime = 3.2;
    ps.emitRate = 130;
    ps.direction1 = new Vector3(-1.5, -1, -1.5);
    ps.direction2 = new Vector3(1.5, -3, 1.5);
    ps.gravity = new Vector3(0, -4, 0);
    ps.minAngularSpeed = -4; ps.maxAngularSpeed = 4;
    ps.start();
    this.confetti = ps;
    setTimeout(() => { ps.stop(); }, 4200);
  }

  update(dt: number): void {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.t += dt;
      const s = 1 + w.t * 14;
      w.mesh.scaling.set(s, 1, s);
      w.mat.alpha = Math.max(0, 0.8 - w.t * 1.1);
      if (w.t > 0.8) {
        w.mesh.dispose();
        this.waves.splice(i, 1);
      }
    }
  }
}
