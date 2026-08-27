import { AnimationGroup, Scene, TransformNode, Vector3, Mesh } from '@babylonjs/core';
import type { CharacterConfig } from '../config/types';
import { loadModel } from '../core/assets';

export type AnimName = keyof CharacterConfig['animations'];

/**
 * Character controller modulare: carica un GLB qualsiasi e pilota le sue
 * AnimationGroup tramite la mappa nomi del config, con crossfade.
 * Sostituire il personaggio = sostituire il file + la mappa animazioni.
 */
export class CharacterSystem {
  root!: TransformNode;
  /** Nodo interno per rotazioni locali (saluto frontale, lean laterale). */
  visual!: TransformNode;
  meshes: Mesh[] = [];
  private groups = new Map<string, AnimationGroup>();
  private current: AnimationGroup | null = null;
  private fading: { from: AnimationGroup; t: number; dur: number } | null = null;

  constructor(private scene: Scene, private cfg: CharacterConfig) {}

  async load(): Promise<void> {
    const model = await loadModel(this.scene, this.cfg.model, 'character');
    this.root = new TransformNode('characterRoot', this.scene);
    this.visual = new TransformNode('characterVisual', this.scene);
    this.visual.parent = this.root;
    model.root.parent = this.visual;
    model.root.scaling.setAll(this.cfg.scale);
    model.root.position.y = this.cfg.yOffset;
    // Nasconde gli accessori indesiderati (per nome di nodo/mesh).
    const hidden = new Set<string>();
    if (this.cfg.hideMeshes?.length) {
      const patterns = this.cfg.hideMeshes.map((h) => h.toLowerCase());
      const matches = (name: string) => patterns.some((p) => name.toLowerCase().startsWith(p));
      for (const m of model.meshes) {
        let node: { name: string; parent?: unknown } | null = m;
        while (node) {
          if (matches(node.name)) { m.setEnabled(false); hidden.add(m.name); break; }
          node = (node as { parent: { name: string } | null }).parent as { name: string } | null;
        }
      }
    }
    this.meshes = model.meshes.filter((m) => !hidden.has(m.name));
    for (const g of model.animationGroups) {
      g.stop();
      this.groups.set(g.name, g);
    }
    this.play('idle', true);
  }

  /** Riproduce un'animazione logica con crossfade. */
  play(name: AnimName, loop: boolean, speed = 1, fade = 0.18): AnimationGroup | null {
    const groupName = this.cfg.animations[name];
    if (!groupName) return null;
    const g = this.groups.get(groupName);
    if (!g) return null;
    if (this.current === g) { g.speedRatio = speed; return g; }
    const prev = this.current;
    g.stop();
    g.start(loop, speed);
    g.setWeightForAllAnimatables(prev ? 0 : 1);
    if (prev) this.fading = { from: prev, t: 0, dur: fade };
    this.current = g;
    return g;
  }

  /** true se l'animazione logica esiste nel modello caricato. */
  has(name: AnimName): boolean {
    const n = this.cfg.animations[name];
    return !!n && this.groups.has(n);
  }

  update(dt: number): void {
    if (this.fading && this.current) {
      this.fading.t += dt;
      const k = Math.min(1, this.fading.t / this.fading.dur);
      this.current.setWeightForAllAnimatables(k);
      this.fading.from.setWeightForAllAnimatables(1 - k);
      if (k >= 1) {
        this.fading.from.stop();
        this.fading = null;
      }
    }
  }

  /** Durata (s) di un'animazione alla velocità indicata. */
  duration(name: AnimName, speed = 1): number {
    const n = this.cfg.animations[name];
    const g = n ? this.groups.get(n) : null;
    if (!g) return 0.8;
    const frames = g.to - g.from;
    // Le animazioni glTF girano a 60 fps in Babylon per default.
    return frames / 60 / Math.max(0.001, speed);
  }

  setPosition(v: Vector3): void { this.root.position.copyFrom(v); }
}
