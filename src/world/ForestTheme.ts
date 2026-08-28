import {
  Color3, Color4, DynamicTexture, Mesh, MeshBuilder, ParticleSystem, Scene,
  StandardMaterial, Texture, TransformNode, Vector3, VertexBuffer,
} from '@babylonjs/core';
import type { TrackSystem } from '../track/TrackSystem';
import type { TrackPalette } from '../track/TrackBuilder';
import { loadMergedProp, loadModel } from '../core/assets';
import { createRng } from '../core/rng';

interface PropSpec {
  file: string;
  weight: number;
  scale: [number, number];
  /** Distanza minima dal bordo strada. */
  minOff: number;
  maxOff: number;
}

const PROPS: PropSpec[] = [
  { file: 'common_tree_1.glb', weight: 3, scale: [1.1, 1.9], minOff: 3.5, maxOff: 26 },
  { file: 'common_tree_2.glb', weight: 3, scale: [1.1, 1.9], minOff: 3.5, maxOff: 26 },
  { file: 'common_tree_3.glb', weight: 2, scale: [1.1, 1.8], minOff: 3.5, maxOff: 26 },
  { file: 'pine_tree_1.glb', weight: 2, scale: [1.2, 2.1], minOff: 4.5, maxOff: 30 },
  { file: 'pine_tree_2.glb', weight: 2, scale: [1.2, 2.1], minOff: 4.5, maxOff: 30 },
  { file: 'pine_tree_3.glb', weight: 1, scale: [1.2, 2.0], minOff: 4.5, maxOff: 30 },
  { file: 'bush_1.glb', weight: 3, scale: [1.0, 1.7], minOff: 1.2, maxOff: 18 },
  { file: 'bush_2.glb', weight: 2, scale: [1.0, 1.7], minOff: 1.2, maxOff: 18 },
  { file: 'bush_berries_1.glb', weight: 1, scale: [1.0, 1.5], minOff: 1.2, maxOff: 14 },
  { file: 'flower_1.glb', weight: 2, scale: [1.0, 1.5], minOff: 0.7, maxOff: 10 },
  { file: 'flower_2.glb', weight: 2, scale: [1.0, 1.5], minOff: 0.7, maxOff: 10 },
  { file: 'flower_3.glb', weight: 2, scale: [1.0, 1.5], minOff: 0.7, maxOff: 10 },
  { file: 'grass_1.glb', weight: 4, scale: [1.0, 1.8], minOff: 0.5, maxOff: 12 },
  { file: 'grass_2.glb', weight: 3, scale: [1.0, 1.8], minOff: 0.5, maxOff: 12 },
  { file: 'stone_1.glb', weight: 2, scale: [0.9, 1.8], minOff: 2.0, maxOff: 20 },
  { file: 'stone_3.glb', weight: 2, scale: [0.9, 1.8], minOff: 2.0, maxOff: 20 },
  { file: 'mushroom_1.glb', weight: 1, scale: [0.9, 1.4], minOff: 1.0, maxOff: 9 },
  { file: 'tree_stump_1.glb', weight: 1, scale: [1.0, 1.4], minOff: 1.5, maxOff: 12 },
];

/** Parametri di variante del tema (giorno sereno / notte magica). */
export interface ForestVariant {
  night: boolean;
  skyStops: [string, string, string, string];
  terrainMul: [number, number, number];
  mountainColor: string;
  mountainCap: string;
  cloudCount: number;
  birdCount: number;
  fireflyColors: string[];
  fireflyCount: number;
  moteColor: [number, number, number, number];
  glowMushrooms: boolean;
}

export const DAY_VARIANT: ForestVariant = {
  night: false,
  skyStops: ['#3d9be9', '#8ecdf2', '#d9ecf5', '#ffe8c4'],
  terrainMul: [1, 1, 1],
  mountainColor: '#7d9b8a',
  mountainCap: '#f2f7f7',
  cloudCount: 14,
  birdCount: 4,
  fireflyColors: ['#ff5d8f', '#ffd166', '#8338ec', '#06d6a0'],
  fireflyCount: 12,
  moteColor: [1, 1, 0.85, 0.28],
  glowMushrooms: false,
};

export const NIGHT_VARIANT: ForestVariant = {
  night: true,
  skyStops: ['#0a1030', '#1b2760', '#443a8a', '#7a4fa8'],
  terrainMul: [0.58, 0.62, 1.0],
  mountainColor: '#3d4463',
  mountainCap: '#aebbe8',
  cloudCount: 5,
  birdCount: 0,
  fireflyColors: ['#ffe066', '#b6ff66', '#66ffd9', '#ffd166'],
  fireflyCount: 26,
  moteColor: [1, 0.9, 0.5, 0.5],
  glowMushrooms: true,
};

export const FOREST_PALETTE: TrackPalette = {
  gapGlow: Color3.FromHexString('#ffb703'),
  road: Color3.FromHexString('#d8b57f'),
  roadAlt: Color3.FromHexString('#cfa971'),
  edge: Color3.FromHexString('#b3854f'),
  skirt: Color3.FromHexString('#8a6a45'),
  bridge: Color3.FromHexString('#a5713f'),
  rail: Color3.FromHexString('#7c4f2a'),
  canyonRock: Color3.FromHexString('#b08a62'),
  water: Color3.FromHexString('#41b6e6'),
};

/**
 * Tema "forest": cielo, valle, vegetazione, nuvole, uccelli, farfalle,
 * particelle ambientali. Tutte le mesh sono istanze di prop fusi (1 draw/tipo).
 */
export class ForestTheme {
  readonly root: TransformNode;
  private time = 0;
  // Il cielo (e la luna) inseguono la camera a mano: infiniteDistance
  // viene ignorato da Babylon quando la mesh ha un parent.
  private skyDome: Mesh | null = null;
  private skyBodies: { mesh: Mesh; offset: Vector3 }[] = [];
  private clouds: { node: TransformNode; speed: number }[] = [];
  private birds: { node: TransformNode; radius: number; speed: number; phase: number; center: Vector3; height: number }[] = [];
  private butterflies: { node: TransformNode; wings: Mesh[]; anchor: Vector3; phase: number }[] = [];

  /** Campioni (x,z,y) del percorso per far salire il terreno con la strada. */
  private roadSamples: { x: number; z: number; y: number }[] = [];

  constructor(
    private scene: Scene,
    private track: TrackSystem,
    private assetPath: string,
    private variant: ForestVariant = DAY_VARIANT,
  ) {
    this.root = new TransformNode('forestTheme', scene);
    const f = this.track.getFrame(0);
    for (let d = 0; d < this.track.totalLength; d += 8) {
      // Voragini e ponti restano su una conca: il terreno lì non sale.
      const seg = this.track.segmentAt(d);
      if (seg.kind === 'bridge' || this.track.isGap(d)) continue;
      this.track.getFrame(d, f);
      this.roadSamples.push({ x: f.pos.x, z: f.pos.z, y: f.pos.y });
    }
  }

  /**
   * Quota del terreno: rilievo dolce di base che, vicino al percorso,
   * si fonde con la quota della strada (-2.3 m) così le salite diventano
   * vere colline erbose e non terrapieni sospesi nel cielo.
   */
  terrainHeightAt(x: number, z: number): number {
    const base = -3.6 + Math.sin(x * 0.021) * Math.cos(z * 0.017) * 1.6 + Math.sin(x * 0.008 + z * 0.011) * 2.2;
    const R = 75;
    let best = Infinity;
    let bestY = 0;
    for (const s of this.roadSamples) {
      const dx = x - s.x, dz = z - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; bestY = s.y; }
    }
    if (best > R * R) return base;
    const t = 1 - Math.sqrt(best) / R;
    const w = t * t * (3 - 2 * t);
    return base * (1 - w) + (bestY - 2.3) * w;
  }

  async build(): Promise<void> {
    this.buildSky();
    this.buildTerrain();
    this.buildMountains();
    await this.scatterProps();
    await this.buildClouds();
    await this.buildBirds();
    this.buildButterflies();
    this.buildAmbientParticles();
  }

  update(dt: number, playerPos: Vector3, playerD = 0): void {
    this.time += dt;
    // Skybox vero: la cupola celeste (e la luna) restano centrate su chi
    // guarda, ovunque arrivi il percorso.
    if (this.skyDome) this.skyDome.position.set(playerPos.x, 0, playerPos.z);
    for (const b of this.skyBodies) {
      b.mesh.position.set(playerPos.x + b.offset.x, b.offset.y, playerPos.z + b.offset.z);
    }
    // Streaming: solo la vegetazione entro ~600 m resta attiva.
    this.cullAcc += dt;
    if (this.cullAcc > 0.35 && this.propInstances.length) {
      this.cullAcc = 0;
      for (const p of this.propInstances) {
        const on = p.d > playerD - 120 && p.d < playerD + 620;
        if (on !== p.on) { p.on = on; p.node.setEnabled(on); }
      }
    }
    for (const c of this.clouds) c.node.position.x += c.speed * dt;
    if (this.ambientPs) {
      (this.ambientPs.emitter as Vector3).copyFrom(playerPos);
    }
    for (const b of this.birds) {
      const a = this.time * b.speed + b.phase;
      b.node.position.set(
        b.center.x + Math.cos(a) * b.radius,
        b.height + Math.sin(this.time * 0.8 + b.phase) * 1.5,
        b.center.z + Math.sin(a) * b.radius,
      );
      b.node.rotation.y = -a - Math.PI / 2;
    }
    for (const f of this.butterflies) {
      const a = this.time * 1.7 + f.phase;
      f.node.position.set(
        f.anchor.x + Math.sin(a * 0.9) * 1.6,
        f.anchor.y + 0.9 + Math.sin(a * 1.3) * 0.5,
        f.anchor.z + Math.cos(a * 0.7) * 1.6,
      );
      const flap = Math.sin(this.time * 18 + f.phase) * 0.9;
      f.wings[0].rotation.z = flap;
      f.wings[1].rotation.z = -flap;
    }
  }

  private buildSky(): void {
    const sky = MeshBuilder.CreateSphere('sky', { diameter: 1400, sideOrientation: Mesh.BACKSIDE, segments: 12 }, this.scene);
    const v = this.variant;
    const W = v.night ? 1024 : 8;
    const H = v.night ? 512 : 256;
    const tex = new DynamicTexture('skyTex', { width: W, height: H }, this.scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, v.skyStops[0]);
    grad.addColorStop(0.55, v.skyStops[1]);
    grad.addColorStop(0.8, v.skyStops[2]);
    grad.addColorStop(1, v.skyStops[3]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    if (v.night) {
      // Stelle nella metà alta del cielo.
      const rng = createRng(12);
      for (let i = 0; i < 420; i++) {
        const x = rng() * W;
        const y = rng() * H * 0.85;
        const r = 0.5 + rng() * 1.3;
        ctx.fillStyle = rng() < 0.15 ? '#cfe0ff' : '#ffffff';
        ctx.globalAlpha = 0.35 + rng() * 0.65;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    tex.update();
    if (v.night) {
      // Luna piena con alone.
      const moon = MeshBuilder.CreateSphere('moon', { diameter: 26, segments: 12 }, this.scene);
      const mm = new StandardMaterial('moonMat', this.scene);
      mm.emissiveColor = Color3.FromHexString('#fdf6d8');
      mm.disableLighting = true;
      moon.material = mm;
      moon.position.set(160, 240, 420);
      moon.applyFog = false;
      moon.parent = this.root;
      this.skyBodies.push({ mesh: moon, offset: moon.position.clone() });
      const halo = MeshBuilder.CreateSphere('moonHalo', { diameter: 44, segments: 10 }, this.scene);
      const hm = new StandardMaterial('moonHaloMat', this.scene);
      hm.emissiveColor = Color3.FromHexString('#fdf6d8');
      hm.alpha = 0.16;
      hm.disableLighting = true;
      halo.material = hm;
      halo.position.copyFrom(moon.position);
      halo.applyFog = false;
      halo.parent = this.root;
      this.skyBodies.push({ mesh: halo, offset: halo.position.clone() });
    }
    const mat = new StandardMaterial('skyMat', this.scene);
    mat.emissiveTexture = tex;
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    sky.material = mat;
    sky.applyFog = false;
    sky.isPickable = false;
    // Il cielo segue la camera in update(): infiniteDistance NON funziona
    // sulle mesh con parent, e una sfera statica di raggio 700 diventa un
    // muro che "taglia" il mondo appena il percorso supera quel raggio.
    sky.parent = this.root;
    this.skyDome = sky;
  }

  /** Valle ondulata sotto il percorso. */
  private buildTerrain(): void {
    const bounds = this.trackBounds();
    const size = Math.max(bounds.sizeX, bounds.sizeZ) + 500;
    const ground = MeshBuilder.CreateGround('valley', { width: size, height: size, subdivisions: 160, updatable: true }, this.scene);
    ground.position.set(bounds.cx, -3.6, bounds.cz);
    const pos = ground.getVerticesData(VertexBuffer.PositionKind)!;
    const colors: number[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i] + bounds.cx, z = pos[i + 2] + bounds.cz;
      // Quota assoluta - quota del nodo (il ground sta a y=-3.6).
      const h = this.terrainHeightAt(x, z) + 3.6;
      pos[i + 1] = h;
      const g = 0.52 + 0.1 * Math.sin(x * 0.05 + z * 0.04) + Math.min(0.08, h * 0.012);
      const m = this.variant.terrainMul;
      colors.push((0.32 + Math.min(0.06, h * 0.008)) * m[0], g * m[1], 0.28 * m[2], 1);
    }
    ground.updateVerticesData(VertexBuffer.PositionKind, pos);
    ground.refreshBoundingInfo();
    ground.setVerticesData(VertexBuffer.ColorKind, colors);
    ground.createNormals(true);
    const mat = new StandardMaterial('valleyMat', this.scene);
    mat.diffuseColor = Color3.White();
    mat.specularColor = Color3.Black();
    ground.material = mat;
    mat.freeze();
    ground.isPickable = false;
    ground.parent = this.root;
    ground.freezeWorldMatrix();
  }

  private buildMountains(): void {
    const bounds = this.trackBounds();
    const rng = createRng(777);
    const mat = new StandardMaterial('mountainMat', this.scene);
    mat.diffuseColor = Color3.FromHexString(this.variant.mountainColor);
    mat.specularColor = Color3.Black();
    const capMat = new StandardMaterial('mountainCapMat', this.scene);
    capMat.diffuseColor = Color3.FromHexString(this.variant.mountainCap);
    capMat.specularColor = Color3.Black();
    const R = Math.max(bounds.sizeX, bounds.sizeZ) / 2 + 420;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rng() * 0.3;
      const h = 60 + rng() * 90;
      const w = 110 + rng() * 130;
      const m = MeshBuilder.CreateCylinder(`mountain${i}`, { diameterTop: 0, diameterBottom: w, height: h, tessellation: 7 }, this.scene);
      m.position.set(bounds.cx + Math.cos(a) * R, h / 2 - 12, bounds.cz + Math.sin(a) * R);
      m.rotation.y = rng() * Math.PI;
      m.material = mat;
      m.isPickable = false;
      m.parent = this.root;
      m.freezeWorldMatrix();
      if (h > 90) {
        const cap = MeshBuilder.CreateCylinder(`cap${i}`, { diameterTop: 0, diameterBottom: w * 0.34, height: h * 0.32, tessellation: 7 }, this.scene);
        cap.position.set(m.position.x, h - h * 0.16 - 12, m.position.z);
        cap.rotation.y = m.rotation.y;
        cap.material = capMat;
        cap.isPickable = false;
        cap.parent = this.root;
        cap.freezeWorldMatrix();
      }
    }
  }

  private async scatterProps(): Promise<void> {
    const rng = createRng(4242);
    const templates = new Map<string, Mesh>();
    for (const p of PROPS) {
      const mesh = await loadMergedProp(this.scene, `${this.assetPath}/${p.file}`, p.file);
      if (mesh) templates.set(p.file, mesh);
    }
    // Di notte i funghi diventano protagonisti e brillano.
    if (this.variant.glowMushrooms) {
      for (const [file, tpl] of templates) {
        if (!file.startsWith('mushroom')) continue;
        const mats = tpl.material && 'subMaterials' in tpl.material
          ? ((tpl.material as unknown as { subMaterials: StandardMaterial[] }).subMaterials ?? [])
          : [tpl.material as StandardMaterial];
        for (const m of mats) {
          if (m && 'emissiveColor' in m) m.emissiveColor = Color3.FromHexString('#69e6ff').scale(0.85);
        }
      }
      for (const p of PROPS) if (p.file.startsWith('mushroom')) p.weight = 4;
    }
    const totalWeight = PROPS.reduce((a, p) => a + p.weight, 0);
    const frame = this.track.getFrame(0);
    const flowersAnchors: Vector3[] = [];
    for (let d = 4; d < this.track.totalLength; d += 5.5) {
      this.track.getFrame(d, frame);
      const seg = this.track.segmentAt(d);
      if (seg.kind === 'bridge' || seg.kind === 'canyon') continue;
      const sides = rng() < 0.75 ? [-1, 1] : [rng() < 0.5 ? -1 : 1];
      for (const side of sides) {
        let r = rng() * totalWeight;
        let spec = PROPS[0];
        for (const p of PROPS) { r -= p.weight; if (r <= 0) { spec = p; break; } }
        const tpl = templates.get(spec.file);
        if (!tpl) continue;
        const off = frame.width / 2 + spec.minOff + rng() * (spec.maxOff - spec.minOff);
        const pos = frame.pos.add(frame.right.scale(side * off));
        // I prop vicini seguono la quota strada, i lontani il pendio reale.
        const t = Math.min(1, (off - frame.width / 2) / 22);
        const th = this.terrainHeightAt(pos.x, pos.z);
        pos.y = frame.pos.y * (1 - t * 0.9) + (th + 0.05) * t * 0.9 - 0.05;
        const inst = tpl.createInstance(`p_${spec.file}_${d}_${side}`);
        inst.position = pos;
        const s = spec.scale[0] + rng() * (spec.scale[1] - spec.scale[0]);
        inst.scaling.setAll(s);
        inst.rotation.y = rng() * Math.PI * 2;
        inst.isPickable = false;
        inst.parent = this.root;
        inst.freezeWorldMatrix();
        this.propInstances.push({ node: inst, d, on: true });
        if (spec.file.startsWith('flower') && flowersAnchors.length < 14 && rng() < 0.4) {
          flowersAnchors.push(pos.clone());
        }
      }
    }
    this.flowerAnchors = flowersAnchors;
  }

  private flowerAnchors: Vector3[] = [];
  /** Prop del percorso con la loro distanza d, per lo streaming. */
  private propInstances: { node: { setEnabled(b: boolean): void }; d: number; on: boolean }[] = [];
  private cullAcc = 99;

  private async buildClouds(): Promise<void> {
    const rng = createRng(99);
    const files = ['cloud_1.glb', 'cloud_2.glb', 'cloud_3.glb'];
    const bounds = this.trackBounds();
    for (let i = 0; i < this.variant.cloudCount; i++) {
      const f = files[i % files.length];
      const mesh = await loadMergedProp(this.scene, `${this.assetPath}/${f}`, `${f}_${i}`);
      if (!mesh) continue;
      mesh.setEnabled(true);
      const node = new TransformNode(`cloud${i}`, this.scene);
      mesh.parent = node;
      mesh.position.setAll(0);
      const cm = mesh.material as StandardMaterial;
      if (cm && 'emissiveColor' in cm) {
        cm.emissiveColor = this.variant.night ? new Color3(0.07, 0.08, 0.14) : new Color3(0.45, 0.47, 0.5);
        if (this.variant.night && 'diffuseColor' in cm) cm.diffuseColor = Color3.FromHexString('#3c4468');
      }
      const s = 6 + rng() * 9;
      node.scaling.setAll(s);
      node.position.set(
        bounds.cx + (rng() - 0.5) * bounds.sizeX * 1.4,
        38 + rng() * 30,
        bounds.cz + (rng() - 0.5) * bounds.sizeZ * 1.4,
      );
      node.parent = this.root;
      this.clouds.push({ node, speed: 0.6 + rng() * 1.2 });
    }
  }

  private async buildBirds(): Promise<void> {
    const rng = createRng(2025);
    const bounds = this.trackBounds();
    const files = ['parrot.glb', 'flamingo.glb'];
    for (let i = 0; i < this.variant.birdCount; i++) {
      try {
        const model = await loadModel(this.scene, `${this.assetPath}/${files[i % 2]}`, `bird${i}`);
        model.animationGroups.forEach((g) => g.start(true, 0.9 + rng() * 0.4));
        const node = new TransformNode(`bird${i}`, this.scene);
        model.root.parent = node;
        model.root.scaling.setAll(0.02 + rng() * 0.012);
        node.parent = this.root;
        this.birds.push({
          node,
          radius: 25 + rng() * 40,
          speed: 0.15 + rng() * 0.2,
          phase: rng() * Math.PI * 2,
          center: new Vector3(bounds.cx + (rng() - 0.5) * bounds.sizeX, 0, bounds.cz + (rng() - 0.5) * bounds.sizeZ),
          height: 20 + rng() * 18,
        });
      } catch { /* uccelli opzionali */ }
    }
  }

  private buildButterflies(): void {
    const rng = createRng(31);
    const colors = this.variant.fireflyColors;
    const anchors = [...this.flowerAnchors];
    if (this.variant.night) {
      // Lucciole distribuite lungo tutto il percorso.
      const f = this.track.getFrame(0);
      for (let d = 20; d < this.track.totalLength; d += 60 + rng() * 60) {
        this.track.getFrame(d, f);
        anchors.push(f.pos.add(f.right.scale((rng() * 2 - 1) * 8)).add(new Vector3(0, 0.6, 0)));
      }
    }
    if (!anchors.length) anchors.push(new Vector3(0, 1, 10));
    for (let i = 0; i < Math.min(this.variant.fireflyCount, anchors.length * 2); i++) {
      const node = new TransformNode(`butterfly${i}`, this.scene);
      const mat = new StandardMaterial(`bflyMat${i}`, this.scene);
      mat.emissiveColor = Color3.FromHexString(colors[i % colors.length]);
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      const wings: Mesh[] = [];
      for (const side of [-1, 1]) {
        const w = MeshBuilder.CreatePlane(`wing${i}_${side}`, { width: 0.16, height: 0.22 }, this.scene);
        w.material = mat;
        w.parent = node;
        w.position.x = side * 0.08;
        w.setPivotPoint(new Vector3(-side * 0.08, 0, 0));
        w.isPickable = false;
        wings.push(w);
      }
      node.parent = this.root;
      this.butterflies.push({ node, wings, anchor: anchors[i % anchors.length], phase: rng() * 10 });
    }
  }

  /** Pulviscolo/foglioline che fluttuano nell'aria davanti alla camera. */
  private buildAmbientParticles(): void {
    const ps = new ParticleSystem('ambientMotes', 120, this.scene);
    ps.particleTexture = makeCircleTexture(this.scene, '#ffffff');
    ps.emitter = new Vector3(0, 3, 0);
    ps.minEmitBox = new Vector3(-25, -2, -10);
    ps.maxEmitBox = new Vector3(25, 8, 60);
    const mc = this.variant.moteColor;
    ps.color1 = new Color4(mc[0], mc[1], mc[2], mc[3]);
    ps.color2 = new Color4(mc[0] * 0.85, mc[1], mc[2] * 0.8, mc[3] * 0.7);
    ps.colorDead = new Color4(1, 1, 1, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.minSize = 0.03; ps.maxSize = 0.09;
    ps.minLifeTime = 4; ps.maxLifeTime = 8;
    ps.emitRate = 10;
    ps.direction1 = new Vector3(-0.3, -0.08, -0.2);
    ps.direction2 = new Vector3(0.3, 0.12, 0.2);
    ps.minEmitPower = 0.2; ps.maxEmitPower = 0.6;
    ps.gravity = new Vector3(0, -0.05, 0);
    ps.start();
    this.ambientPs = ps;
  }

  ambientPs: ParticleSystem | null = null;

  private boundsCache: { cx: number; cz: number; sizeX: number; sizeZ: number } | null = null;
  private trackBounds() {
    if (this.boundsCache) return this.boundsCache;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    const f = this.track.getFrame(0);
    for (let d = 0; d < this.track.totalLength; d += 20) {
      this.track.getFrame(d, f);
      minX = Math.min(minX, f.pos.x); maxX = Math.max(maxX, f.pos.x);
      minZ = Math.min(minZ, f.pos.z); maxZ = Math.max(maxZ, f.pos.z);
    }
    this.boundsCache = {
      cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2,
      sizeX: maxX - minX, sizeZ: maxZ - minZ,
    };
    return this.boundsCache;
  }
}

/** Piccola texture circolare per i particellari. */
export function makeCircleTexture(scene: Scene, color: string): Texture {
  const size = 64;
  const tex = new DynamicTexture(`circleTex_${color}`, { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.6, color + 'cc');
  grad.addColorStop(1, color + '00');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}
