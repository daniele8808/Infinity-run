import { Vector3 } from '@babylonjs/core';
import type { LevelConfig, MovementConfig, SegmentKind } from '../config/types';
import { planLevel, type PlannedSegment } from './TrackPlan';

/** Terna di riferimento in un punto del percorso. */
export interface TrackFrame {
  pos: Vector3;
  forward: Vector3;
  right: Vector3;
  /** Curvatura orizzontale (rad/m, >0 curva a sinistra). */
  curvature: number;
  width: number;
  kind: SegmentKind;
}

interface Sample {
  x: number; y: number; z: number;
  yaw: number;
  d: number;
  width: number;
  kind: SegmentKind;
  curvature: number;
}

const STEP = 2; // metri fra i campioni

/**
 * Percorso su spline: tutto il gioco vive in coordinate-traccia (d, offsetX, offsetY).
 * d = distanza percorsa, offsetX = laterale, offsetY = quota sopra la strada.
 */
export class TrackSystem {
  readonly plan: PlannedSegment[];
  readonly totalLength: number;
  /** Intervalli [inizio, fine] in d senza strada (precipizi). */
  readonly gaps: [number, number][] = [];
  readonly checkpoints: { index: number; d: number }[] = [];
  readonly finishD: number;
  private samples: Sample[] = [];

  constructor(level: LevelConfig, movement: MovementConfig) {
    this.plan = planLevel(level, movement);

    // Integrazione della linea centrale: yaw ed elevazione con easing per segmento.
    let x = 0, y = 0, z = 0, yaw = 0, d = 0;
    for (const seg of this.plan) {
      const steps = Math.max(2, Math.round(seg.length / STEP));
      const dl = seg.length / steps;
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps, t1 = (i + 1) / steps;
        const yawRate = (seg.yawDelta * (ease(t1) - ease(t0))) / dl;
        yaw += seg.yawDelta * (ease(t1) - ease(t0));
        y += seg.elevDelta * (ease(t1) - ease(t0));
        x += Math.sin(yaw) * dl;
        z += Math.cos(yaw) * dl;
        d += dl;
        this.samples.push({ x, y, z, yaw, d, width: seg.width, kind: seg.kind, curvature: yawRate });
      }
      if (seg.kind === 'gap') {
        // Ampiezza assoluta (~6.5 m): saltabile con un buon salto singolo,
        // comoda col doppio salto, qualunque sia la lunghezza del segmento.
        const mid = seg.startD + seg.length / 2;
        this.gaps.push([mid - 3.25, mid + 3.25]);
      }
      if (seg.kind === 'checkpoint') {
        this.checkpoints.push({ index: seg.checkpointIndex ?? 0, d: seg.startD + seg.length / 2 });
      }
    }
    this.totalLength = d;
    const finish = this.plan[this.plan.length - 1];
    this.finishD = finish.startD + finish.length * 0.5;
    // Campione sentinella iniziale.
    this.samples.unshift({ ...this.samples[0], d: 0, x: 0, y: 0, z: 0, yaw: 0 });
  }

  /** Frame interpolato alla distanza d (clampata al percorso). */
  getFrame(d: number, out?: TrackFrame): TrackFrame {
    const f = out ?? {
      pos: new Vector3(), forward: new Vector3(), right: new Vector3(),
      curvature: 0, width: 0, kind: 'straight' as SegmentKind,
    };
    const s = this.samples;
    const dd = Math.min(Math.max(d, 0), this.totalLength - 0.001);
    // Ricerca binaria del campione.
    let lo = 0, hi = s.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid].d <= dd) lo = mid; else hi = mid;
    }
    const a = s[lo], b = s[hi];
    const t = (dd - a.d) / Math.max(0.0001, b.d - a.d);
    const yaw = a.yaw + shortAngle(b.yaw - a.yaw) * t;
    f.pos.set(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
    f.forward.set(Math.sin(yaw), 0, Math.cos(yaw));
    // In pendenza il forward reale ha componente y, ma per gameplay/camera basta l'orizzontale.
    f.right.set(f.forward.z, 0, -f.forward.x);
    f.curvature = lerp(a.curvature, b.curvature, t);
    f.width = lerp(a.width, b.width, t);
    f.kind = t < 0.5 ? a.kind : b.kind;
    return f;
  }

  /** Posizione mondo per coordinate-traccia. */
  toWorld(d: number, offsetX: number, offsetY: number, out?: Vector3): Vector3 {
    const f = this.getFrame(d, this.scratch);
    const v = out ?? new Vector3();
    v.copyFrom(f.pos);
    v.addInPlace(f.right.scale(offsetX));
    v.y += offsetY;
    return v;
  }

  /** true se in d la strada è interrotta (precipizio). */
  isGap(d: number): boolean {
    for (const [a, b] of this.gaps) if (d >= a && d <= b) return true;
    return false;
  }

  segmentAt(d: number): PlannedSegment {
    let found = this.plan[0];
    for (const s of this.plan) { if (s.startD <= d) found = s; else break; }
    return found;
  }

  private scratch: TrackFrame = {
    pos: new Vector3(), forward: new Vector3(), right: new Vector3(),
    curvature: 0, width: 0, kind: 'straight',
  };
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function ease(t: number): number { return t * t * (3 - 2 * t); }
function shortAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
