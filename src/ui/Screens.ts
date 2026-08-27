import type { GameConfig } from '../config/types';
import type { LeaderboardEntry } from '../leaderboard/Leaderboard';

export interface RunStats {
  score: number;
  coins: number;
  coinsTotal: number;
  powerUps: number;
  timeSeconds: number;
  bestCombo: number;
  completed: boolean;
}

/**
 * Flusso schermate DOM: loading -> nome -> (intro/countdown gestiti dal
 * GameController) -> risultati con classifica.
 */
export class Screens {
  private parent: HTMLElement;
  private current: HTMLElement | null = null;

  constructor(parent: HTMLElement, private cfg: GameConfig) {
    this.parent = parent;
    const rotate = document.createElement('div');
    rotate.className = 'rotate-notice';
    rotate.textContent = cfg.strings.rotateDevice;
    parent.appendChild(rotate);
  }

  private mount(el: HTMLElement): void {
    this.dismiss();
    this.parent.appendChild(el);
    this.current = el;
  }

  dismiss(): void {
    const el = this.current;
    if (el) {
      el.classList.add('hidden');
      setTimeout(() => el.remove(), 500);
      this.current = null;
    }
  }

  private brandHeader(): string {
    const logo = this.cfg.brand.logo
      ? `<img class="logo" src="${this.cfg.brand.logo}" alt="">`
      : '';
    return `${logo}<h1>${this.cfg.game.name}</h1>`;
  }

  /** Schermata di caricamento con barra. */
  loading(): (frac: number) => void {
    const el = document.createElement('div');
    el.className = 'screen';
    el.innerHTML = `
      ${this.brandHeader()}
      <div class="loading-bar"><i></i></div>
      <div class="sub">${this.cfg.strings.loading}</div>
    `;
    this.mount(el);
    const bar = el.querySelector<HTMLElement>('.loading-bar i')!;
    return (frac) => { bar.style.width = `${Math.min(100, frac * 100)}%`; };
  }

  /** Inserimento nome: risolve con il nickname. */
  nameEntry(): Promise<string> {
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = 'screen';
      el.innerHTML = `
        ${this.brandHeader()}
        <h2>${this.cfg.strings.insertName}</h2>
        <input class="name-input" maxlength="12" autocomplete="off" spellcheck="false" placeholder="AAA" />
        <button class="btn">${this.cfg.strings.play}</button>
      `;
      this.mount(el);
      const input = el.querySelector<HTMLInputElement>('.name-input')!;
      const btn = el.querySelector<HTMLButtonElement>('.btn')!;
      const submit = () => {
        const name = (input.value.trim() || 'PLAYER').toUpperCase().slice(0, 12);
        this.dismiss();
        resolve(name);
      };
      btn.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      setTimeout(() => input.focus(), 400);
    });
  }

  /** Schermata risultati + classifica. */
  results(stats: RunStats, rank: number, top: LeaderboardEntry[], nickname: string, onReplay: () => void): void {
    const s = this.cfg.strings;
    const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const rows = top.slice(0, 5).map((e, i) => `
      <div class="lb-row ${e.nickname === nickname && e.score === stats.score ? 'me' : ''}">
        <span class="pos">${i + 1}.</span>
        <span class="nick">${escapeHtml(e.nickname)}</span>
        <b>${e.score.toLocaleString('it-IT')}</b>
      </div>`).join('');
    const el = document.createElement('div');
    el.className = 'screen';
    el.innerHTML = `
      <h1>${stats.completed ? s.runComplete : s.gameOver}</h1>
      <div class="results-card">
        <div class="row total"><span>${s.score}</span><b>${stats.score.toLocaleString('it-IT')}</b></div>
        <div class="row"><span>${s.collectibles}</span><b>${stats.coins} / ${stats.coinsTotal}</b></div>
        <div class="row"><span>${s.powerupsTaken}</span><b>${stats.powerUps}</b></div>
        <div class="row"><span>${s.time}</span><b>${fmtTime(stats.timeSeconds)}</b></div>
        <div class="row"><span>${s.bestCombo}</span><b>x${stats.bestCombo}</b></div>
        <div class="row"><span>${s.rank}</span><b>#${rank}</b></div>
      </div>
      <h2>${s.topPlayers}</h2>
      <div class="lb-list">${rows || '<div class="sub">—</div>'}</div>
      <button class="btn">${s.playAgain}</button>
    `;
    this.mount(el);
    el.querySelector('.btn')!.addEventListener('click', () => { this.dismiss(); onReplay(); });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
