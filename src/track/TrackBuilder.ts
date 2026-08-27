import {
  Color3, Color4, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode,
  Vector3, VertexData,
} from '@babylonjs/core';
import type { TrackSystem } from './TrackSystem';

/** Palette del nastro stradale (sovrascrivibile dal tema). */
export interface TrackPalette {
  road: Color3;
  roadAlt: Color3;
  edge: Color3;
  skirt: Color3;
  bridge: Color3;
  rail: Color3;
  canyonRock: Color3;
  water: Color3;
}

const SAMPLE = 2;
const SKIRT_DEPTH = 4;

/**
 * Costruisce le mesh del percorso: nastro stradale con vertex color,
 * fianchi in terra, ponti in legno con parapetti, pareti canyon e acqua.
 */
export class TrackBuilder {
  readonly root: TransformNode;

  constructor(private scene: Scene, private track: TrackSystem, private palette: TrackPalette) {
    this.root = new TransformNode('trackRoot', scene);
    this.buildRoad();
    this.buildRails();
    this.buildCanyonWalls();
    this.buildWater();
  }

  private makeMat(name: string, opts?: { specular?: number }): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.diffuseColor = Color3.White();
    m.specularColor = new Color3(opts?.specular ?? 0.03, opts?.specular ?? 0.03, opts?.specular ?? 0.03);
    return m;
  }

  private buildRoad(): void {
    const positions: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];
    const normals: number[] = [];
    const t = this.track;
    const p = this.palette;
    const rows: { d: number; skip: boolean }[] = [];
    for (let d = 0; d <= t.totalLength; d += SAMPLE) rows.push({ d, skip: false });

    let vi = 0;
    const frame = t.getFrame(0);
    for (let r = 0; r < rows.length; r++) {
      const { d } = rows[r];
      t.getFrame(d, frame);
      const seg = t.segmentAt(d);
      const half = frame.width / 2;
      const isBridge = seg.kind === 'bridge';
      const base = isBridge ? p.bridge : (Math.floor(d / 14) % 2 === 0 ? p.road : p.roadAlt);

      // 4 vertici per riga: bordo sx, corsia sx, corsia dx, bordo dx.
      const xs = [-half, -half * 0.82, half * 0.82, half];
      for (let i = 0; i < 4; i++) {
        const wp = frame.pos.add(frame.right.scale(xs[i]));
        positions.push(wp.x, wp.y, wp.z);
        const c = i === 0 || i === 3 ? p.edge : base;
        colors.push(c.r, c.g, c.b, 1);
        normals.push(0, 1, 0);
      }
      if (r > 0) {
        const gapHere = t.isGap(d) || t.isGap(rows[r - 1].d);
        if (!gapHere) {
          const a = vi - 4, b = vi;
          for (let i = 0; i < 3; i++) {
            indices.push(a + i, b + i, b + i + 1, a + i, b + i + 1, a + i + 1);
          }
        }
      }
      vi += 4;
    }

    const mesh = new Mesh('road', this.scene);
    const vd = new VertexData();
    vd.positions = positions; vd.indices = indices; vd.colors = colors; vd.normals = normals;
    vd.applyToMesh(mesh);
    const mat = this.makeMat('roadMat');
    mat.backFaceCulling = false;
    mesh.material = mat;
    mesh.useVertexColors = true;
    mesh.receiveShadows = true;
    mesh.parent = this.root;
    mesh.freezeWorldMatrix();

    // Fianchi (skirt) che scendono dal bordo strada: danno solidità a colline e ponti no.
    this.buildSkirt();
  }

  private buildSkirt(): void {
    const t = this.track;
    const p = this.palette;
    const positions: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];
    const frame = t.getFrame(0);
    let vi = 0;
    let prevOk = false;
    for (let d = 0; d <= t.totalLength; d += SAMPLE) {
      t.getFrame(d, frame);
      const seg = t.segmentAt(d);
      const skip = t.isGap(d) || seg.kind === 'bridge';
      const half = frame.width / 2;
      for (const side of [-1, 1]) {
        const top = frame.pos.add(frame.right.scale(side * half));
        positions.push(top.x, top.y, top.z, top.x, top.y - SKIRT_DEPTH, top.z);
        const c = p.skirt;
        colors.push(c.r * 1.15, c.g * 1.15, c.b * 1.15, 1, c.r * 0.6, c.g * 0.6, c.b * 0.6, 1);
      }
      if (prevOk && !skip) {
        // sx: vi-4 (top), vi-3 (bottom) -> vi, vi+1 ; dx: vi-2, vi-1 -> vi+2, vi+3
        indices.push(vi - 4, vi, vi + 1, vi - 4, vi + 1, vi - 3);
        indices.push(vi - 2, vi + 3, vi + 2, vi - 2, vi - 1, vi + 3);
      }
      prevOk = !skip;
      vi += 4;
    }
    const mesh = new Mesh('roadSkirt', this.scene);
    const vd = new VertexData();
    vd.positions = positions; vd.indices = indices; vd.colors = colors;
    vd.normals = [];
    VertexData.ComputeNormals(positions, indices, vd.normals);
    vd.applyToMesh(mesh);
    const mat = this.makeMat('skirtMat');
    mat.backFaceCulling = false;
    mesh.material = mat;
    mesh.parent = this.root;
    mesh.freezeWorldMatrix();
  }

  /** Parapetti in legno sui ponti e nei passaggi stretti. */
  private buildRails(): void {
    const t = this.track;
    const postMatName = 'railMat';
    const mat = this.makeMat(postMatName);
    mat.diffuseColor = this.palette.rail;
    let template: Mesh | null = null;
    const frame = t.getFrame(0);
    for (const seg of t.plan) {
      if (seg.kind !== 'bridge' && seg.kind !== 'narrow') continue;
      for (let d = seg.startD + 2; d < seg.startD + seg.length - 2; d += 4) {
        t.getFrame(d, frame);
        const half = frame.width / 2 + 0.25;
        for (const side of [-1, 1]) {
          if (!template) {
            template = MeshBuilder.CreateBox('railPost', { width: 0.22, height: 1.0, depth: 0.22 }, this.scene);
            template.material = mat;
            template.parent = this.root;
          }
          const inst = template.createInstance(`rail_${d}_${side}`);
          inst.position = frame.pos.add(frame.right.scale(side * half));
          inst.position.y += 0.5;
          inst.parent = this.root;
          inst.freezeWorldMatrix();
        }
      }
      // Corrimano.
      for (const side of [-1, 1]) {
        const pathPoints: Vector3[] = [];
        for (let d = seg.startD + 1; d <= seg.startD + seg.length - 1; d += 3) {
          t.getFrame(d, frame);
          const v = frame.pos.add(frame.right.scale(side * (frame.width / 2 + 0.25)));
          v.y += 1.02;
          pathPoints.push(v);
        }
        if (pathPoints.length > 1) {
          const tube = MeshBuilder.CreateTube(`railTube${seg.startD}_${side}`, { path: pathPoints, radius: 0.09, tessellation: 6 }, this.scene);
          tube.material = mat;
          tube.parent = this.root;
          tube.freezeWorldMatrix();
        }
      }
    }
    if (template) template.setEnabled(false);
  }

  /** Pareti rocciose nei segmenti canyon. */
  private buildCanyonWalls(): void {
    const t = this.track;
    const p = this.palette;
    const frame = t.getFrame(0);
    for (const seg of t.plan) {
      if (seg.kind !== 'canyon') continue;
      for (const side of [-1, 1]) {
        const positions: number[] = [];
        const indices: number[] = [];
        const colors: number[] = [];
        let vi = 0;
        for (let d = seg.startD; d <= seg.startD + seg.length; d += SAMPLE * 2) {
          t.getFrame(d, frame);
          const local = (d - seg.startD) / seg.length;
          const hProfile = Math.sin(Math.min(local, 1) * Math.PI);
          const h = 3 + 7 * hProfile + Math.sin(d * 0.7) * 1.2;
          const off = frame.width / 2 + 1.4 + Math.sin(d * 0.45 + side) * 0.7;
          const bot = frame.pos.add(frame.right.scale(side * off));
          positions.push(bot.x, bot.y - 2, bot.z, bot.x + side * frame.right.x * 1.5, bot.y + h, bot.z + side * frame.right.z * 1.5);
          const c = p.canyonRock;
          const shade = 0.75 + 0.25 * Math.sin(d * 1.3);
          colors.push(c.r * shade, c.g * shade, c.b * shade, 1, c.r, c.g, c.b, 1);
          if (vi > 0) {
            indices.push(vi - 2, vi, vi + 1, vi - 2, vi + 1, vi - 1);
          }
          vi += 2;
        }
        const mesh = new Mesh(`canyon_${seg.startD}_${side}`, this.scene);
        const vd = new VertexData();
        vd.positions = positions; vd.indices = indices; vd.colors = colors;
        vd.normals = [];
        VertexData.ComputeNormals(positions, indices, vd.normals);
        vd.applyToMesh(mesh);
        const mat = this.makeMat(`canyonMat_${seg.startD}_${side}`);
        mat.backFaceCulling = false;
        mesh.material = mat;
        mesh.parent = this.root;
        mesh.freezeWorldMatrix();
      }
    }
  }

  /** Corsi d'acqua sotto i ponti e dentro le voragini. */
  private buildWater(): void {
    const frame = this.track.getFrame(0);
    const mat = new StandardMaterial('waterMat', this.scene);
    mat.diffuseColor = this.palette.water;
    mat.emissiveColor = this.palette.water.scale(0.35);
    mat.alpha = 0.85;
    mat.specularColor = new Color3(0.5, 0.6, 0.7);
    for (const seg of this.track.plan) {
      if (seg.kind !== 'bridge') continue;
      const mid = seg.startD + seg.length / 2;
      this.track.getFrame(mid, frame);
      const water = MeshBuilder.CreateGround(`water_${seg.startD}`, { width: 60, height: 14, subdivisions: 1 }, this.scene);
      water.position = frame.pos.clone();
      water.position.y -= 3.1;
      water.rotation.y = Math.atan2(frame.right.x, frame.right.z);
      water.material = mat;
      water.parent = this.root;
    }
  }
}

export function hex(c: string): Color3 { return Color3.FromHexString(c); }
export function hex4(c: string, a = 1): Color4 {
  const v = Color3.FromHexString(c);
  return new Color4(v.r, v.g, v.b, a);
}
