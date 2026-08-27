import type { LeaderboardConfig } from '../config/types';

export interface LeaderboardEntry {
  nickname: string;
  score: number;
  timeSeconds: number;
  date: string;
  eventId?: string;
}

/**
 * Interfaccia astratta della classifica: la demo usa LocalStorage,
 * in produzione si collega un backend (Firebase/Supabase/custom)
 * implementando lo stesso contratto.
 */
export interface LeaderboardProvider {
  submit(entry: LeaderboardEntry): Promise<number>;
  top(n: number): Promise<LeaderboardEntry[]>;
  /** Posizione (1-based) che avrebbe un punteggio. */
  rankOf(score: number): Promise<number>;
}

const STORAGE_KEY = 'runner.leaderboard.v1';

export class LocalLeaderboard implements LeaderboardProvider {
  constructor(private cfg: LeaderboardConfig) {}

  private read(): LeaderboardEntry[] {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    } catch { return []; }
  }
  private write(list: LeaderboardEntry[]): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* storage pieno o bloccato */ }
  }

  async submit(entry: LeaderboardEntry): Promise<number> {
    const list = this.read();
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    this.write(list.slice(0, this.cfg.maxEntries));
    return list.findIndex((e) => e === entry) + 1;
  }

  async top(n: number): Promise<LeaderboardEntry[]> {
    return this.read().slice(0, n);
  }

  async rankOf(score: number): Promise<number> {
    return this.read().filter((e) => e.score > score).length + 1;
  }
}

/** Provider REST minimale: POST /scores, GET /scores?limit=n. */
export class ApiLeaderboard implements LeaderboardProvider {
  constructor(private cfg: LeaderboardConfig) {}

  async submit(entry: LeaderboardEntry): Promise<number> {
    const res = await fetch(`${this.cfg.apiUrl}/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...entry, eventId: this.cfg.eventId }),
    });
    const data = await res.json().catch(() => ({}));
    return data.rank ?? 0;
  }
  async top(n: number): Promise<LeaderboardEntry[]> {
    const res = await fetch(`${this.cfg.apiUrl}/scores?limit=${n}`);
    return res.json();
  }
  async rankOf(score: number): Promise<number> {
    const res = await fetch(`${this.cfg.apiUrl}/scores/rank?score=${score}`);
    const data = await res.json().catch(() => ({}));
    return data.rank ?? 0;
  }
}

export function createLeaderboard(cfg: LeaderboardConfig): LeaderboardProvider {
  return cfg.provider === 'api' && cfg.apiUrl ? new ApiLeaderboard(cfg) : new LocalLeaderboard(cfg);
}
