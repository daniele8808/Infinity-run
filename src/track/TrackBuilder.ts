import {
  Color3, Color4, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode,
  Vector3, VertexData,
} from '@babylonjs/core';
import type { TrackSystem } from './TrackSystem';

/** Palette del nastro stradale (sovrascrivibile dal tema). */
export interface TrackPalette {
  /** Colore della striscia luminosa che segnala i bordi delle voragini. */
  gapGlow?: Color3;
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
/** Metri di strada extra dietro la partenza e oltre il traguardo. */
const LEAD_IN = 26;
const LEAD_OUT = 60;

/**
 * Costruisce le mesh del percorso: nastro stradale con vertex color,
 * fianchi in terra, ponti in legno con parapetti, pareti canyon e acqua.
 */
export class TrackBuilder {
  readonly root: TransformNode;

  constructor(private scene: Scene, private track: TrackSystem, private palette: TrackPalette) {
    this.root = new TransformNode('trackRoot', scene);
    this.buildRoad();
    this.buildGapMarkers();
    this.buildCaps();
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
    for (let d = -LEAD_IN; d <= t.totalLength + LEAD_OUT; d += SAMPLE) rows.push({ d, skip: false });

    let vi = 0;
    const frame = t.getFrame(0);
    const f0 = t.getFrame(0.1);
    const lead = { fwd: f0.forward.clone(), right: f0.right.clone(), pos: f0.pos.clone(), width: f0.width };
    const fEnd = t.getFrame(t.totalLength - 0.1);
    const tail = { fwd: fEnd.forward.clone(), right: fEnd.right.clone(), pos: fEnd.pos.clone(), width: fEnd.width };
    for (let r = 0; r < rows.length; r++) {
      const { d } = rows[r];
      if (d < 0) {
        // Estrapolazione rettilinea dietro la partenza.
        frame.pos.copyFrom(lead.pos).addInPlace(lead.fwd.scale(d));
        frame.right.copyFrom(lead.right);
        frame.width = lead.width;
        frame.kind = 'straight';
      } else if (d > t.totalLength) {
        // Estrapolazione oltre il traguardo: il mondo non finisce li'.
        frame.pos.copyFrom(tail.pos).addInPlace(tail.fwd.scale(d - t.totalLength));
        frame.right.copyFrom(tail.right);
        frame.width = tail.width;
        frame.kind = 'straight';
      } else {
        t.getFrame(d, frame);
      }
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
        const gapHere = d > 0 && (t.isGap(d) || t.isGap(rows[r - 1].d));
        const prevGap = r > 1 && rows[r - 1].d > 0 && (t.isGap(rows[r - 1].d) || t.isGap(rows[r - 2].d));
        if (!gapHere) {
          const a = vi - 4, b = vi;
          for (let i = 0; i < 3; i++) {
            indices.push(a + i, b + i, b + i + 1, a + i, b + i + 1, a + i + 1);
          }
        }
        // Pareti di chiusura ai bordi delle voragini, allineate alla mesh:
        // niente piu' spigoli 'bucati' guardando dentro il fosso.
        if (gapHere !== prevGap) {
          const rowD = rows[r - 1].d;
          t.getFrame(Math.max(rowD, 0.01), frame);
          const half = frame.width / 2;
          const l = frame.pos.add(frame.right.scale(-half));
          const rr = frame.pos.add(frame.right.scale(half));
          const base = positions.length / 3;
          positions.push(
            l.x, l.y + 0.02, l.z,
            rr.x, rr.y + 0.02, rr.z,
            rr.x, rr.y - 4, rr.z,
            l.x, l.y - 4, l.z,
          );
          // Interno in terra scura: vuoto leggibile senza sembrare un glitch.
          const c = p.skirt.scale(0.42);
          colors.push(c.r, c.g, c.b, 1, c.r, c.g, c.b, 1, c.r * 0.4, c.g * 0.4, c.b * 0.4, 1, c.r * 0.4, c.g * 0.4, c.b * 0.4, 1);
          normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
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
    const f0 = t.getFrame(0.1);
    const lead = { fwd: f0.forward.clone(), right: f0.right.clone(), pos: f0.pos.clone(), width: f0.width };
    const fEndS = t.getFrame(t.totalLength - 0.1);
    const tailS = { fwd: fEndS.forward.clone(), right: fEndS.right.clone(), pos: fEndS.pos.clone(), width: fEndS.width };
    let vi = 0;
    let prevOk = false;
    let prevRowGap = false;
    for (let d = -LEAD_IN; d <= t.totalLength + LEAD_OUT; d += SAMPLE) {
      let skip: boolean;
      let rowGap = false;
      if (d < 0) {
        frame.pos.copyFrom(lead.pos).addInPlace(lead.fwd.scale(d));
        frame.right.copyFrom(lead.right);
        frame.width = lead.width;
        skip = false;
      } else if (d > t.totalLength) {
        frame.pos.copyFrom(tailS.pos).addInPlace(tailS.fwd.scale(d - t.totalLength));
        frame.right.copyFrom(tailS.right);
        frame.width = tailS.width;
        skip = false;
      } else {
        t.getFrame(d, frame);
        const seg = t.segmentAt(d);
        rowGap = t.isGap(d);
        // Stessa regola a due righe del piano stradale: il fianco esiste
        // solo dove esiste la strada sopra (niente muri orfani nel fosso).
        skip = rowGap || prevRowGap || seg.kind === 'bridge';
      }
      prevRowGap = rowGap;
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

  /**
   * Strisce luminose sul bordo delle voragini: il salto si legge con
   * chiarezza anche di notte o in controluce.
   */
  private buildGapMarkers(): void {
    const t = this.track;
    const glow = this.palette.gapGlow ?? Color3.FromHexString('#ffd166');
    const mat = new StandardMaterial('gapGlowMat', this.scene);
    mat.emissiveColor = glow;
    mat.disableLighting = true;
    const frame = t.getFrame(0);
    for (const [a, b] of t.gaps) {
      for (const edgeD of [a - 2.7, b + 2.7]) {
        t.getFrame(edgeD, frame);
        const strip = MeshBuilder.CreateBox(`gapGlow_${edgeD}`, {
          width: frame.width - 0.4, height: 0.1, depth: 0.8,
        }, this.scene);
        strip.position = frame.pos.clone();
        strip.position.y += 0.09;
        strip.rotation.y = Math.atan2(frame.forward.x, frame.forward.z);
        strip.material = mat;
        strip.isPickable = false;
        strip.parent = this.root;
        strip.freezeWorldMatrix();
      }
    }
  }

  /**
   * Pareti di chiusura della sezione stradale: senza di queste la strada
   * appare cava all'inizio, ai bordi delle voragini e alle testate dei ponti.
   */
  private buildCaps(): void {
    const t = this.track;
    const p = this.palette;
    // Punti in cui il blocco solido della strada si interrompe.
    const capDs: number[] = [-LEAD_IN + 0.1];
    for (const seg of t.plan) {
      if (seg.kind === 'bridge') { capDs.push(seg.startD - 0.1, seg.startD + seg.length + 0.1); }
    }
    const positions: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];
    const frame = t.getFrame(0);
    let vi = 0;
    for (const d of capDs) {
      const dd = Math.min(Math.max(d, 0.05), t.totalLength - 0.05);
      t.getFrame(dd, frame);
      const half = frame.width / 2;
      const l = frame.pos.add(frame.right.scale(-half));
      const r = frame.pos.add(frame.right.scale(half));
      // Quad verticale: bordo strada in alto, fondo skirt in basso.
      positions.push(
        l.x, l.y + 0.02, l.z,
        r.x, r.y + 0.02, r.z,
        r.x, r.y - SKIRT_DEPTH, r.z,
        l.x, l.y - SKIRT_DEPTH, l.z,
      );
      const top = p.skirt, bot = p.skirt.scale(0.55);
      colors.push(top.r, top.g, top.b, 1, top.r, top.g, top.b, 1, bot.r, bot.g, bot.b, 1, bot.r, bot.g, bot.b, 1);
      indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
    }
    const mesh = new Mesh('roadCaps', this.scene);
    const vd = new VertexData();
    vd.positions = positions; vd.indices = indices; vd.colors = colors;
    vd.normals = [];
    VertexData.ComputeNormals(positions, indices, vd.normals);
    vd.applyToMesh(mesh);
    const mat = this.makeMat('roadCapsMat');
    mat.backFaceCulling = false;
    mesh.material = mat;
    mesh.parent = this.root;
    mesh.freezeWorldMatrix();
  }

  /**
   * Parapetti in legno: solo sui ponti. Pali e corrimano sono campionati
   * negli STESSI punti, cosi' il corrimano passa esattamente sulle teste
   * dei pali (niente legni sospesi o scollegati).
   */
  private buildRails(): void {
    const t = this.track;
    const mat = this.makeMat('railMat');
    mat.diffuseColor = this.palette.rail;
    let template: Mesh | null = null;
    const frame = t.getFrame(0);
    for (const seg of t.plan) {
      if (seg.kind !== 'bridge') continue;
      for (const side of [-1, 1]) {
        const pathPoints: Vector3[] = [];
        for (let d = seg.startD + 1.5; d <= seg.startD + seg.length - 1.5; d += 3) {
          t.getFrame(d, frame);
          const half = frame.width / 2 - 0.18;
          const base = frame.pos.add(frame.right.scale(side * half));
          if (!template) {
            template = MeshBuilder.CreateBox('railPost', { width: 0.22, height: 1.0, depth: 0.22 }, this.scene);
            template.material = mat;
            template.parent = this.root;
          }
          const inst = template.createInstance(`rail_${d}_${side}`);
          inst.position = base.clone();
          inst.position.y += 0.46;
          inst.parent = this.root;
          inst.freezeWorldMatrix();
          const top = base.clone();
          top.y += 0.96;
          pathPoints.push(top);
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
    this.buildBridgeAprons();
  }

  /** Fasce laterali dell'impalcato: il ponte ha spessore, non un foglio. */
  private buildBridgeAprons(): void {
    const t = this.track;
    const frame = t.getFrame(0);
    const mat = this.makeMat('bridgeApronMat');
    mat.diffuseColor = this.palette.rail;
    mat.backFaceCulling = false;
    for (const seg of t.plan) {
      if (seg.kind !== 'bridge') continue;
      for (const side of [-1, 1]) {
        const positions: number[] = [];
        const indices: number[] = [];
        let vi = 0;
        for (let d = seg.startD; d <= seg.startD + seg.length; d += 2) {
          t.getFrame(d, frame);
          const edge = frame.pos.add(frame.right.scale(side * frame.width / 2));
          positions.push(edge.x, edge.y + 0.06, edge.z, edge.x, edge.y - 0.5, edge.z);
          if (vi > 0) indices.push(vi - 2, vi, vi + 1, vi - 2, vi + 1, vi - 1);
          vi += 2;
        }
        const mesh = new Mesh(`bridgeApron_${seg.startD}_${side}`, this.scene);
        const vd = new VertexData();
        vd.positions = positions; vd.indices = indices;
        vd.normals = [];
        VertexData.ComputeNormals(positions, indices, vd.normals);
        vd.applyToMesh(mesh);
        mesh.material = mat;
        mesh.parent = this.root;
        mesh.freezeWorldMatrix();
      }
    }
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
      // Fiume vero: attraversa tutta la valle e riempie la conca del ponte;
      // dove il terreno risale oltre il livello dell'acqua nascono le sponde.
      // Il terreno nella conca scende fino a roadY-2.3: l'acqua deve stare
      // appena SOPRA quel fondo, altrimenti resta sepolta e invisibile.
      const water = MeshBuilder.CreateGround(`water_${seg.startD}`, { width: 240, height: 26, subdivisions: 1 }, this.scene);
      water.position = frame.pos.clone();
      water.position.y = frame.pos.y - 2.0;
      water.rotation.y = Math.atan2(frame.forward.x, frame.forward.z);
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
