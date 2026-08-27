import { TransformNode, Vector3 } from '@babylonjs/core';
import type { TrackSystem } from '../track/TrackSystem';

/** Entità in coordinate-traccia (d lungo il percorso, x laterale, y quota). */
export interface TrackEntity {
  d: number;
  x: number;
  y: number;
  node: TransformNode;
  active: boolean;
}

/** Aggiorna la posizione mondo di un'entità dalla sua posizione-traccia. */
export function placeEntity(track: TrackSystem, e: TrackEntity, tmp: Vector3): void {
  track.toWorld(e.d, e.x, e.y, tmp);
  e.node.position.copyFrom(tmp);
}

/**
 * Test di collisione player/entità in spazio-traccia: economico e stabile
 * (nessun motore fisico necessario per un on-rails runner).
 */
export function hits(
  pd: number, px: number, py: number,
  e: TrackEntity, dz: number, dx: number, yMin: number, yMax: number,
): boolean {
  return e.active
    && Math.abs(e.d - pd) < dz
    && Math.abs(e.x - px) < dx
    && py >= yMin && py <= yMax;
}

/** Finestra scorrevole sulle entità ordinate per d: evita scansioni O(n). */
export class EntityWindow<T extends TrackEntity> {
  items: T[] = [];
  private lo = 0;
  private cullAcc = 99;
  private lastEnabled = new WeakMap<object, boolean>();

  /**
   * Streaming per distanza: tiene attive solo le entità vicine al giocatore.
   * Con migliaia di mesh sul percorso questo mantiene stabile il frame rate
   * per tutta la partita (chiamare a ogni update: internamente è throttled).
   */
  maybeCull(dt: number, pd: number, behind = 90, ahead = 440): void {
    this.cullAcc += dt;
    if (this.cullAcc < 0.3) return;
    this.cullAcc = 0;
    for (const it of this.items) {
      const on = it.active && it.d > pd - behind && it.d < pd + ahead;
      if (this.lastEnabled.get(it.node) !== on) {
        this.lastEnabled.set(it.node, on);
        it.node.setEnabled(on);
      }
    }
  }

  finalize(): void { this.items.sort((a, b) => a.d - b.d); }

  /** Restituisce le entità con d in [pd-behind, pd+ahead]. */
  near(pd: number, behind: number, ahead: number): T[] {
    while (this.lo < this.items.length && this.items[this.lo].d < pd - behind) this.lo++;
    const out: T[] = [];
    for (let i = this.lo; i < this.items.length; i++) {
      if (this.items[i].d > pd + ahead) break;
      out.push(this.items[i]);
    }
    return out;
  }

  reset(): void { this.lo = 0; }
}
