/** Pub/sub tipizzato e minimale per il disaccoppiamento dei sistemi. */

export interface GameEvents {
  coinCollected: { d: number; x: number; y: number; total: number };
  powerUpCollected: { kind: string; d: number; x: number };
  powerUpExpired: { kind: string };
  checkpointReached: { index: number; d: number };
  enemyHit: { d: number };
  obstacleHit: { d: number };
  fell: { d: number };
  lifeLost: { livesLeft: number };
  respawn: { d: number };
  comboChanged: { combo: number; multiplier: number };
  scoreChanged: { score: number; delta: number };
  jumped: { double: boolean };
  landed: {};
  finished: {};
  gameOver: {};
  speedChanged: { multiplier: number };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler<any>>>();

  on<K extends keyof GameEvents>(event: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(event as string);
    if (!set) { set = new Set(); this.handlers.set(event as string, set); }
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    this.handlers.get(event as string)?.forEach((fn) => fn(payload));
  }

  clear(): void { this.handlers.clear(); }
}
