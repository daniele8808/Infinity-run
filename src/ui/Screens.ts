import type { DurationOption, GameConfig, ProfileConfig } from '../config/types';
import type { LeaderboardEntry } from '../leaderboard/Leaderboard';
import { isIos, isStandalone, tryFullscreen } from './fullscreen';
import { loadDebugPrefs, saveDebugPrefs } from './debugPrefs';

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
  /** Avvio dell'esplora-mappa dalle impostazioni protette. */
  private inspectLauncher: (() => void) | null = null;

  constructor(parent: HTMLElement, private cfg: GameConfig) {
    this.parent = parent;
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

  /**
   * Menu iniziale: scelta dell'eroe/mondo, durata del livello e nome.
   * È la porta d'ingresso white-label: le card arrivano dai profili config.
   */
  startMenu(profiles: ProfileConfig[], durations: DurationOption[], defaultSeconds: number):
    Promise<{ profile: ProfileConfig; seconds: number; nickname: string; inspect: boolean }> {
    return new Promise((resolve) => {
      const s = this.cfg.strings;
      const el = document.createElement('div');
      el.className = 'screen';
      const cards = profiles.map((p, i) => `
        <button class="sel-card ${i === 0 ? 'active' : ''}" data-id="${p.id}">
          <span class="ico">${p.icon}</span>
          <span class="name">${p.label}</span>
          <span class="desc">${p.description ?? ''}</span>
        </button>`).join('');
      const chips = durations.map((d) => `
        <button class="chip ${d.seconds === defaultSeconds ? 'active' : ''}" data-sec="${d.seconds}">${d.label}</button>`).join('');
      const iosHint = isIos() && !isStandalone()
        ? `<div class="sub install-hint">${s.iosInstallHint ?? ''}</div>` : '';
      el.innerHTML = `
        ${this.brandHeader()}
        <h2>${s.chooseHero}</h2>
        <div class="sel-cards">${cards}</div>
        <div class="chips-row"><span class="chips-label">${s.chooseDuration}</span><div class="chips">${chips}</div></div>
        <input class="name-input" maxlength="12" autocomplete="off" spellcheck="false" placeholder="${s.insertName}" />
        <button class="btn">${s.play}</button>
        ${iosHint}
        <button class="admin-btn" aria-label="Impostazioni">⚙️</button>
      `;
      this.mount(el);
      let profile = profiles[0];
      let seconds = defaultSeconds;
      el.querySelectorAll<HTMLButtonElement>('.sel-card').forEach((c) => {
        c.addEventListener('click', () => {
          el.querySelectorAll('.sel-card').forEach((x) => x.classList.remove('active'));
          c.classList.add('active');
          profile = profiles.find((p) => p.id === c.dataset.id) ?? profiles[0];
        });
      });
      el.querySelectorAll<HTMLButtonElement>('.chip').forEach((c) => {
        c.addEventListener('click', () => {
          el.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
          c.classList.add('active');
          seconds = Number(c.dataset.sec);
        });
      });
      const input = el.querySelector<HTMLInputElement>('.name-input')!;
      const submit = (inspect: boolean) => {
        if (!inspect) tryFullscreen();
        const nickname = (input.value.trim() || 'PLAYER').toUpperCase().slice(0, 12);
        this.dismiss();
        resolve({ profile, seconds, nickname, inspect });
      };
      el.querySelector<HTMLButtonElement>('.btn')!.addEventListener('click', () => submit(false));
      // L'esplora-mappa vive nelle impostazioni protette: da lì si lancia
      // con il profilo e la durata selezionati nel menu.
      this.inspectLauncher = () => submit(true);
      el.querySelector<HTMLButtonElement>('.admin-btn')!.addEventListener('click', () => this.showAdmin());
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(false); });
    });
  }

  /**
   * Pagina impostazioni protetta da password: attiva/disattiva gli
   * strumenti di debug (badge FPS, esplora mappa). Le preferenze sono
   * salvate sul dispositivo e applicate con un riavvio della pagina.
   */
  private showAdmin(): void {
    const pass = this.cfg.game.adminPassword ?? '1234';
    const ov = document.createElement('div');
    ov.className = 'admin-overlay';
    ov.innerHTML = `
      <div class="admin-card">
        <h3>Impostazioni</h3>
        <div class="admin-lock">
          <input class="admin-pass" type="password" inputmode="numeric" maxlength="16" placeholder="Password" />
          <div class="admin-error">Password errata</div>
          <div class="admin-row">
            <button class="btn-ghost cancel">Annulla</button>
            <button class="btn ok">OK</button>
          </div>
        </div>
        <div class="admin-settings hidden">
          <label class="admin-toggle"><input type="checkbox" class="t-fps" /><span>Indicatore FPS</span></label>
          <button class="btn-ghost inspect-btn">🛠️ Esplora mappa (debug)</button>
          <div class="sub">Le modifiche si applicano al riavvio.</div>
          <button class="btn close">Chiudi</button>
        </div>
      </div>`;
    this.parent.appendChild(ov);
    const lock = ov.querySelector('.admin-lock')!;
    const settings = ov.querySelector('.admin-settings')!;
    const passInput = ov.querySelector<HTMLInputElement>('.admin-pass')!;
    const error = ov.querySelector<HTMLElement>('.admin-error')!;
    const tFps = ov.querySelector<HTMLInputElement>('.t-fps')!;
    const prefs = loadDebugPrefs(this.cfg.game.debugFps ?? false);
    const initial = { ...prefs };
    passInput.focus();
    const tryUnlock = () => {
      if (passInput.value === pass) {
        lock.classList.add('hidden');
        settings.classList.remove('hidden');
        tFps.checked = prefs.fps;
      } else {
        error.classList.add('show');
        passInput.value = '';
      }
    };
    ov.querySelector('.ok')!.addEventListener('click', tryUnlock);
    passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
    ov.querySelector('.cancel')!.addEventListener('click', () => ov.remove());
    tFps.addEventListener('change', () => {
      prefs.fps = tFps.checked;
      saveDebugPrefs(prefs);
    });
    ov.querySelector('.inspect-btn')!.addEventListener('click', () => {
      ov.remove();
      this.inspectLauncher?.();
    });
    ov.querySelector('.close')!.addEventListener('click', () => {
      if (prefs.fps !== initial.fps) location.reload();
      else ov.remove();
    });
  }

  /** Inserimento nome: risolve con il nickname. */
  nameEntry(): Promise<string> {
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = 'screen';
      const iosHint = isIos() && !isStandalone()
        ? `<div class="sub install-hint">${this.cfg.strings.iosInstallHint ?? ''}</div>` : '';
      el.innerHTML = `
        ${this.brandHeader()}
        <h2>${this.cfg.strings.insertName}</h2>
        <input class="name-input" maxlength="12" autocomplete="off" spellcheck="false" placeholder="AAA" />
        <button class="btn">${this.cfg.strings.play}</button>
        ${iosHint}
      `;
      this.mount(el);
      const input = el.querySelector<HTMLInputElement>('.name-input')!;
      const btn = el.querySelector<HTMLButtonElement>('.btn')!;
      const submit = () => {
        // Dentro il gesto utente: fullscreen nativo dove supportato (Android/desktop).
        tryFullscreen();
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
        <div class="row"><span>${s.missed ?? 'Mancati'}</span><b>${Math.max(0, stats.coinsTotal - stats.coins)}</b></div>
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
