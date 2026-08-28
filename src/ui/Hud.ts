import type { GameConfig, PowerUpKind } from '../config/types';

const PU_ICONS: Record<PowerUpKind, string> = {
  shield: '🛡️', magnet: '🧲', doubleScore: '✨', speedBoost: '⚡', superJump: '🦘', invincibility: '⭐',
};
const PU_COLORS: Record<PowerUpKind, string> = {
  shield: '#38bdf8', magnet: '#f43f5e', doubleScore: '#fbbf24',
  speedBoost: '#22d3ee', superJump: '#a3e635', invincibility: '#e879f9',
};

/** HUD minimalista: vite, punteggio, tempo, power-up attivi, progress bar. */
export class Hud {
  private root: HTMLElement;
  private livesEl!: HTMLElement;
  private scoreEl!: HTMLElement;
  private multEl!: HTMLElement;
  private timeEl!: HTMLElement;
  private fillEl!: HTMLElement;
  private markerEl!: HTMLElement;
  private puRow!: HTMLElement;
  private hintEl!: HTMLElement;
  private vignette!: HTMLElement;
  private fpsEl: HTMLElement | null = null;
  private chips = new Map<string, { el: HTMLElement; bar: HTMLElement }>();
  private maxLives: number;
  /** Chiamata quando l'utente tocca il bottone pausa. */
  onPause: (() => void) | null = null;
  /** Chiamata quando l'utente tocca il bottone turbo. */
  onBoost: (() => void) | null = null;
  private boostEl: HTMLElement | null = null;

  constructor(parent: HTMLElement, private cfg: GameConfig) {
    this.maxLives = cfg.rules.startingLives;
    this.root = document.createElement('div');
    this.root.className = 'hud';
    const isTouch = 'ontouchstart' in window;
    this.root.innerHTML = `
      <div class="vignette"></div>
      <div class="hud-top">
        <div class="hud-lives" aria-label="${cfg.strings.lives}"></div>
        <div class="hud-score"><span class="value">0</span><span class="mult">x1</span></div>
        <div class="hud-right">
          <div class="hud-time">0:00</div>
          <button class="hud-pause" aria-label="Pausa">II</button>
        </div>
      </div>
      <div class="hud-progress"><div class="fill"></div><div class="marker"></div></div>
      <div class="hud-hint">${isTouch ? cfg.strings.controlsHintMobile : cfg.strings.controlsHint}</div>
      <div class="hud-powerups"></div>
      ${cfg.boost.coinsRequired > 0 ? `
      <button class="hud-boost" aria-label="Turbo">
        <span class="meter"></span>
        <span class="ico">🚀</span>
        <span class="count"></span>
      </button>` : ''}
      ${cfg.game.debugFps ? '<div class="hud-fps">-- fps</div>' : ''}
    `;
    parent.appendChild(this.root);
    this.root.querySelector('.hud-pause')!.addEventListener('click', () => this.onPause?.());
    this.boostEl = this.root.querySelector('.hud-boost');
    if (this.boostEl) {
      // stopPropagation: il tocco sul bottone non deve diventare un salto.
      for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'touchend'] as const) {
        this.boostEl.addEventListener(ev, (e) => e.stopPropagation());
      }
      this.boostEl.addEventListener('click', (e) => { e.stopPropagation(); this.onBoost?.(); });
      this.setBoost(0, 0);
    }
    this.livesEl = this.root.querySelector('.hud-lives')!;
    this.scoreEl = this.root.querySelector('.hud-score .value')!;
    this.multEl = this.root.querySelector('.hud-score .mult')!;
    this.timeEl = this.root.querySelector('.hud-time')!;
    this.fillEl = this.root.querySelector('.hud-progress .fill')!;
    this.markerEl = this.root.querySelector('.hud-progress .marker')!;
    this.puRow = this.root.querySelector('.hud-powerups')!;
    this.hintEl = this.root.querySelector('.hud-hint')!;
    this.vignette = this.root.querySelector('.vignette')!;
    this.fpsEl = this.root.querySelector('.hud-fps');
    this.setLives(this.maxLives);
    // Tacche checkpoint sulla progress bar.
    const bar = this.root.querySelector('.hud-progress')!;
    for (const frac of cfg.level.checkpoints) {
      const cp = document.createElement('div');
      cp.className = 'cp';
      cp.style.left = `${frac * 100}%`;
      bar.appendChild(cp);
    }
  }

  show(): void {
    this.root.classList.add('visible');
    setTimeout(() => this.hintEl.classList.add('fade'), 6000);
  }
  hide(): void { this.root.classList.remove('visible'); }

  setLives(lives: number): void {
    this.livesEl.innerHTML = '';
    for (let i = 0; i < this.maxLives; i++) {
      const h = document.createElement('span');
      h.className = 'heart' + (i >= lives ? ' lost' : '');
      h.textContent = '❤️';
      this.livesEl.appendChild(h);
    }
  }

  setScore(score: number): void {
    this.scoreEl.textContent = score.toLocaleString('it-IT');
    const parent = this.scoreEl.parentElement!;
    parent.classList.remove('bump');
    void parent.offsetWidth;
    parent.classList.add('bump');
  }

  setMultiplier(mult: number): void {
    this.multEl.textContent = `x${mult}`;
    this.multEl.classList.toggle('active', mult > 1);
  }

  setTime(seconds: number): void {
    const s = Math.max(0, Math.ceil(seconds));
    this.timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.timeEl.classList.toggle('low', s <= 20);
  }

  setProgress(frac: number): void {
    const pct = `${Math.min(100, frac * 100).toFixed(1)}%`;
    this.fillEl.style.width = pct;
    this.markerEl.style.left = pct;
  }

  /** Chip power-up con barra di durata. */
  setPowerUp(kind: PowerUpKind, remaining: number, duration: number): void {
    let chip = this.chips.get(kind);
    if (!chip) {
      const el = document.createElement('div');
      el.className = 'pu-chip';
      el.style.setProperty('--pu-color', PU_COLORS[kind]);
      const label = this.cfg.strings[`power${kind[0].toUpperCase()}${kind.slice(1)}`] ?? kind;
      el.innerHTML = `<span class="ico">${PU_ICONS[kind]}</span><span>${label}</span><span class="bar"><i></i></span>`;
      this.puRow.appendChild(el);
      chip = { el, bar: el.querySelector('.bar i')! };
      this.chips.set(kind, chip);
    }
    if (duration <= 0) {
      chip.bar.parentElement!.style.display = 'none';
    } else {
      chip.bar.style.width = `${Math.max(0, (remaining / duration) * 100)}%`;
    }
  }

  removePowerUp(kind: string): void {
    const chip = this.chips.get(kind);
    if (chip) { chip.el.remove(); this.chips.delete(kind); }
  }

  /**
   * Stato del bottone turbo: cariche disponibili e frazione (0..1) della
   * prossima carica in arrivo dalle monete raccolte.
   */
  setBoost(charges: number, frac: number): void {
    if (!this.boostEl) return;
    const meter = this.boostEl.querySelector<HTMLElement>('.meter')!;
    const count = this.boostEl.querySelector<HTMLElement>('.count')!;
    meter.style.height = `${Math.min(100, (charges > 0 ? 1 : frac) * 100)}%`;
    count.textContent = charges > 1 ? String(charges) : '';
    this.boostEl.classList.toggle('ready', charges > 0);
  }

  /** Messaggio centrale (CHECKPOINT, VIA!, combo…). */
  message(text: string, hold = false, color?: string): void {
    const el = document.createElement('div');
    el.className = `center-msg ${hold ? 'hold' : 'show'}`;
    el.textContent = text;
    if (color) el.style.color = color;
    this.root.appendChild(el);
    setTimeout(() => el.remove(), hold ? 1700 : 1000);
  }

  /** Numero del countdown con animazione dedicata. */
  countdown(text: string): void {
    const el = document.createElement('div');
    el.className = 'countdown-num';
    el.textContent = text;
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  /** Punteggio fluttuante vicino al centro-azione. */
  floatScore(text: string): void {
    const el = document.createElement('div');
    el.className = 'float-score';
    el.textContent = text;
    el.style.left = `${48 + Math.random() * 8}%`;
    el.style.top = `${52 + Math.random() * 8}%`;
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 850);
  }

  /** Indicatore diagnostico: fps, mesh attive e posizione sulla pista. */
  setFps(fps: number, activeMeshes: number, d?: number, segment?: string): void {
    if (!this.fpsEl) return;
    const pos = d !== undefined ? ` · d ${Math.round(d)}${segment ? ' ' + segment : ''}` : '';
    this.fpsEl.textContent = `${Math.round(fps)} fps · ${activeMeshes} mesh${pos}`;
    this.fpsEl.classList.toggle('low', fps < 25);
  }

  hitFlash(): void {
    this.vignette.classList.add('hit');
    setTimeout(() => this.vignette.classList.remove('hit'), 220);
  }
}
