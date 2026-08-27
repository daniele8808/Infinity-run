import type { AudioConfig, SfxName } from '../config/types';

/**
 * Audio via WebAudio: usa i file dichiarati nel config quando presenti,
 * altrimenti sintetizza ogni effetto. La musica procedurale aumenta di
 * intensità avvicinandosi al traguardo.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private buffers = new Map<SfxName, AudioBuffer>();
  private musicBuffer: AudioBuffer | null = null;
  private sfxGain!: GainNode;
  private musicGain!: GainNode;
  private musicTimer: number | null = null;
  private nextBeat = 0;
  private beatIndex = 0;
  /** 0..1: cresce con il progresso del livello. */
  intensity = 0;
  private started = false;

  constructor(private cfg: AudioConfig) {}

  private silentEl: HTMLAudioElement | null = null;

  /** Da chiamare alla prima interazione utente (autoplay policy). */
  unlock(): void {
    if (this.ctx) { this.ctx.resume(); this.playSilentKeepalive(); return; }
    this.ctx = new AudioContext();
    this.playSilentKeepalive();
    // Se la pagina torna in primo piano, riattiva il contesto.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.ctx?.resume();
    });
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.cfg.sfxVolume;
    this.sfxGain.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.cfg.musicVolume;
    this.musicGain.connect(this.ctx.destination);
    this.loadFiles();
  }

  /**
   * iOS silenzia il WebAudio quando l'interruttore laterale è su
   * "silenzioso": un <audio> in loop (quasi muto) sposta la sessione
   * audio in modalità playback e la musica torna udibile.
   */
  private playSilentKeepalive(): void {
    if (this.silentEl) return;
    const el = document.createElement('audio');
    // WAV di 0,1s di silenzio, inline.
    el.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';
    el.loop = true;
    el.volume = 0.01;
    el.setAttribute('playsinline', '');
    el.play().then(() => { this.silentEl = el; }).catch(() => { /* riprova al prossimo gesto */ });
  }

  private async loadFiles(): Promise<void> {
    if (!this.ctx) return;
    const jobs = Object.entries(this.cfg.files).map(async ([name, url]) => {
      if (!url) return;
      try {
        const res = await fetch(url);
        const buf = await this.ctx!.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(name as SfxName, buf);
      } catch { /* fallback sintetico */ }
    });
    if (this.cfg.music) {
      jobs.push((async () => {
        try {
          const res = await fetch(this.cfg.music!);
          this.musicBuffer = await this.ctx!.decodeAudioData(await res.arrayBuffer());
        } catch { /* musica procedurale */ }
      })());
    }
    await Promise.all(jobs);
  }

  play(name: SfxName): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const buf = this.buffers.get(name);
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.sfxGain);
      src.start();
      return;
    }
    this.synth(name);
  }

  /** Sintesi di fallback per ogni effetto. */
  private synth(name: SfxName): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const beep = (freq: number, dur: number, at: number, type: OscillatorType = 'sine', vol = 0.5, glide = 0) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t + at);
      if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + glide), t + at + dur);
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(vol, t + at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + at + dur);
      o.connect(g).connect(this.sfxGain);
      o.start(t + at);
      o.stop(t + at + dur + 0.05);
    };
    const noise = (dur: number, at: number, vol = 0.4, freq = 1200) => {
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(f).connect(g).connect(this.sfxGain);
      src.start(t + at);
    };
    switch (name) {
      case 'coin': beep(1180, 0.09, 0, 'triangle', 0.4); beep(1660, 0.14, 0.06, 'triangle', 0.35); break;
      case 'jump': beep(330, 0.22, 0, 'square', 0.18, 420); break;
      case 'land': noise(0.1, 0, 0.25, 700); break;
      case 'hit': noise(0.25, 0, 0.5, 900); beep(190, 0.3, 0, 'sawtooth', 0.3, -120); break;
      case 'fall': beep(500, 0.7, 0, 'sine', 0.35, -420); break;
      case 'checkpoint': beep(660, 0.14, 0, 'triangle', 0.4); beep(880, 0.22, 0.12, 'triangle', 0.4); break;
      case 'powerup': [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.14, i * 0.07, 'triangle', 0.35)); break;
      case 'countdown': beep(440, 0.16, 0, 'square', 0.3); break;
      case 'go': beep(880, 0.4, 0, 'square', 0.35); break;
      case 'victory': [523, 659, 784, 1046, 1318].forEach((f, i) => beep(f, 0.28, i * 0.13, 'triangle', 0.4)); break;
      case 'gameover': [392, 330, 262, 196].forEach((f, i) => beep(f, 0.3, i * 0.22, 'sine', 0.4)); break;
      case 'combo': beep(1320, 0.1, 0, 'triangle', 0.3); beep(1760, 0.12, 0.06, 'triangle', 0.3); break;
      case 'enemy': noise(0.2, 0, 0.4, 600); beep(150, 0.25, 0, 'sawtooth', 0.25, -60); break;
      case 'click': beep(700, 0.06, 0, 'sine', 0.25); break;
    }
  }

  startMusic(): void {
    if (!this.ctx || this.started) return;
    this.started = true;
    if (this.musicBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.musicBuffer;
      src.loop = true;
      src.connect(this.musicGain);
      src.start();
      return;
    }
    // Sequencer procedurale con lookahead.
    this.nextBeat = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.schedule(), 90);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) { clearInterval(this.musicTimer); this.musicTimer = null; }
    this.started = false;
  }

  /**
   * Musica a sezioni legata al progresso del livello:
   * inizio sereno, sviluppo più ricco, tensione, finale che sale di tonalità.
   */
  private schedule(): void {
    const ctx = this.ctx!;
    const bpm = 112 + this.intensity * 30;
    const spb = 60 / bpm / 2; // ottavi
    // Sezioni: I-vi-IV-V serena, poi vi-IV-I-V più emotiva, poi tensione modale.
    const SECTIONS: number[][][] = [
      [[220, 277.2, 329.6], [185, 220, 277.2], [146.8, 220, 293.7], [164.8, 246.9, 329.6]],
      [[185, 220, 277.2], [146.8, 220, 293.7], [220, 277.2, 329.6], [164.8, 246.9, 329.6]],
      [[196, 246.9, 293.7], [146.8, 185, 220], [164.8, 207.7, 246.9], [220, 261.6, 329.6]],
    ];
    const section = this.intensity < 0.35 ? 0 : this.intensity < 0.7 ? 1 : 2;
    // Gran finale: tutta la musica sale di un tono (energia da ultimo giro).
    const lift = this.intensity > 0.85 ? Math.pow(2, 2 / 12) : 1;
    const chords = SECTIONS[section].map((c) => c.map((f) => f * lift));
    const penta = [440, 493.9, 554.4, 659.3, 740].map((f) => f * lift);
    while (this.nextBeat < ctx.currentTime + 0.25) {
      const beat = this.beatIndex;
      const bar = Math.floor(beat / 8) % 4;
      const step = beat % 8;
      const at = this.nextBeat;
      const note = (freq: number, dur: number, vol: number, type: OscillatorType, dest: GainNode) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.value = freq;
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(vol, at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, at + dur);
        o.connect(g).connect(dest);
        o.start(at);
        o.stop(at + dur + 0.05);
      };
      // Basso sul quarto (in ottava nel finale per più spinta).
      if (step % 2 === 0) {
        note(chords[bar][0] / 2, spb * 1.8, 0.4, 'triangle', this.musicGain);
        if (this.intensity > 0.85 && step % 4 === 0) {
          note(chords[bar][0], spb * 0.9, 0.22, 'triangle', this.musicGain);
        }
      }
      // Arpeggio.
      const arpFreq = chords[bar][(step * 2) % 3] * 2;
      note(arpFreq, spb * 0.9, 0.16 + this.intensity * 0.08, 'square', this.musicGain);
      // Melodia pentatonica sopra, entra con l'intensità.
      if (this.intensity > 0.3 && step % 4 === 1) {
        note(penta[(bar + step) % penta.length], spb * 1.6, 0.14, 'triangle', this.musicGain);
      }
      // Hi-hat.
      if (this.intensity > 0.15 && step % 2 === 1) {
        const len = Math.floor(ctx.sampleRate * 0.03);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const s = ctx.createBufferSource();
        s.buffer = buf;
        const f = ctx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = 6000;
        const g = ctx.createGain();
        g.gain.value = 0.1 + this.intensity * 0.1;
        s.connect(f).connect(g).connect(this.musicGain);
        s.start(at);
      }
      this.nextBeat += spb;
      this.beatIndex++;
    }
  }
}
