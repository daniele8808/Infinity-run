import type { AudioConfig, SfxName } from '../config/types';

/**
 * Audio via WebAudio: usa i file dichiarati nel config quando presenti,
 * altrimenti sintetizza. La musica NON viene sequenziata dal vivo: ogni
 * sezione è pre-renderizzata una volta in un buffer messo in loop —
 * su iOS il flusso continuo di nodi one-shot accumulava spazzatura audio
 * e faceva crollare progressivamente il frame rate.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private buffers = new Map<SfxName, AudioBuffer>();
  private musicBuffer: AudioBuffer | null = null;
  private sfxGain!: GainNode;
  private musicGain!: GainNode;
  /** 0..1: cresce con il progresso del livello. */
  intensity = 0;
  private started = false;
  private silentEl: HTMLAudioElement | null = null;
  private sectionTimer: number | null = null;
  private currentKey = '';
  private rendering = false;
  private activeSource: AudioBufferSourceNode | null = null;
  private activeGain: GainNode | null = null;
  private loopCache = new Map<string, AudioBuffer>();

  constructor(private cfg: AudioConfig) {}

  /** Da chiamare alla prima interazione utente (autoplay policy). */
  unlock(): void {
    if (this.ctx) { this.ctx.resume(); this.playSilentKeepalive(); return; }
    this.ctx = new AudioContext();
    this.playSilentKeepalive();
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
      case 'coin':
        if (this.cfg.style === 'magic') {
          beep(1318, 0.22, 0, 'sine', 0.35); beep(1976, 0.3, 0.07, 'sine', 0.3); beep(2637, 0.34, 0.12, 'sine', 0.2);
        } else {
          beep(1180, 0.09, 0, 'triangle', 0.4); beep(1660, 0.14, 0.06, 'triangle', 0.35);
        }
        break;
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

  // ------------------------- Musica in loop -------------------------

  startMusic(): void {
    if (!this.ctx || this.started) return;
    this.started = true;
    if (this.musicBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.musicBuffer;
      src.loop = true;
      src.connect(this.musicGain);
      src.start();
      this.activeSource = src;
      return;
    }
    this.updateSection();
    this.sectionTimer = window.setInterval(() => this.updateSection(), 1500);
    // Pre-renderizza in background le sezioni successive: al cambio (e al
    // gran finale) il loop e' gia' in cache, zero lavoro sul frame.
    const style = this.cfg.style === 'magic' ? 'magic' : 'adventure';
    (async () => {
      for (const [sec, lift] of [[1, false], [2, false], [2, true]] as [number, boolean][]) {
        await this.renderLoop(style, sec, lift).catch(() => { /* best effort */ });
        await new Promise((r) => setTimeout(r, 400));
      }
    })();
  }

  stopMusic(): void {
    if (this.sectionTimer !== null) { clearInterval(this.sectionTimer); this.sectionTimer = null; }
    try { this.activeSource?.stop(); } catch { /* già fermo */ }
    this.activeSource = null;
    this.started = false;
    this.currentKey = '';
  }

  /** Cambia sezione/tonalità quando il progresso lo richiede. */
  private updateSection(): void {
    const style = this.cfg.style === 'magic' ? 'magic' : 'adventure';
    const section = this.intensity < 0.35 ? 0 : this.intensity < 0.7 ? 1 : 2;
    const lift = this.intensity > 0.85 ? 1 : 0;
    const key = `${style}:${section}:${lift}`;
    if (key === this.currentKey || this.rendering) return;
    this.rendering = true;
    this.renderLoop(style, section, lift === 1)
      .then((buf) => { this.currentKey = key; this.swapTo(buf); })
      .finally(() => { this.rendering = false; });
  }

  /** Crossfade morbido verso il nuovo loop. */
  private swapTo(buf: AudioBuffer): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const oldSrc = this.activeSource;
    const oldGain = this.activeGain;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(1, now + 0.8);
    g.connect(this.musicGain);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(g);
    src.start(now);
    this.activeSource = src;
    this.activeGain = g;
    if (oldSrc && oldGain) {
      oldGain.gain.setValueAtTime(1, now);
      oldGain.gain.linearRampToValueAtTime(0.0001, now + 0.8);
      setTimeout(() => { try { oldSrc.stop(); } catch { /* ok */ } }, 900);
    }
  }

  /**
   * Renderizza offline un loop di 4 battute per stile/sezione, con coda
   * ripiegata sull'inizio per un loop senza click. Costo: una tantum.
   */
  private async renderLoop(style: 'adventure' | 'magic', section: number, lift: boolean): Promise<AudioBuffer> {
    const cacheKey = `${style}:${section}:${lift}`;
    const cached = this.loopCache.get(cacheKey);
    if (cached) return cached;
    const sr = this.ctx!.sampleRate;
    const sectionMid = [0.15, 0.5, 0.85][section];
    const bpm = style === 'magic' ? 94 + sectionMid * 22 : 112 + sectionMid * 30;
    const spb = 60 / bpm / 2; // ottavi
    const steps = 32; // 4 battute
    const loopLen = steps * spb;
    const tail = 1.6;
    const off = new OfflineAudioContext(2, Math.ceil((loopLen + tail) * sr), sr);
    const master = off.createGain();
    master.gain.value = 1;
    master.connect(off.destination);
    const liftMul = lift ? Math.pow(2, 2 / 12) : 1;

    const tone = (freq: number, at: number, dur: number, vol: number, type: OscillatorType) => {
      const o = off.createOscillator();
      const g = off.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(vol, at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, at + dur);
      o.connect(g).connect(master);
      o.start(at);
      o.stop(at + dur + 0.05);
    };
    const bell = (freq: number, at: number, vol: number, dur: number) => {
      tone(freq, at, dur, vol, 'sine');
      tone(freq * 2, at, dur, vol * 0.35, 'sine');
    };
    const hat = (at: number, vol: number) => {
      const len = Math.floor(sr * 0.03);
      const buf = off.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const s = off.createBufferSource();
      s.buffer = buf;
      const f = off.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 6000;
      const g = off.createGain();
      g.gain.value = vol;
      s.connect(f).connect(g).connect(master);
      s.start(at);
    };

    if (style === 'magic') {
      const Am = [220, 261.63, 329.63], F = [174.61, 220, 261.63];
      const C = [261.63, 329.63, 392], G = [196, 246.94, 293.66];
      const Dm = [146.83, 174.61, 220], E = [164.81, 207.65, 246.94];
      const SECTIONS = [[Am, F, C, G], [Am, C, F, G], [Dm, Am, E, Am]];
      const chords = SECTIONS[section].map((c) => c.map((f) => f * liftMul));
      const sparkle = [880, 1046.5, 1174.66, 1318.51].map((f) => f * liftMul);
      for (let beat = 0; beat < steps; beat++) {
        const bar = Math.floor(beat / 8) % 4;
        const step = beat % 8;
        const at = beat * spb;
        if (step === 0 || step === 4) bell(chords[bar][0] / 2, at, 0.42, spb * 4);
        if (step === 0 || step === 2 || step === 3 || step === 6) {
          bell(chords[bar][(step * 2 + bar) % 3] * 2, at, 0.15 + sectionMid * 0.06, spb * 3.2);
        }
        if (Math.random() < 0.14 + sectionMid * 0.12) {
          bell(sparkle[Math.floor(Math.random() * sparkle.length)], at, 0.09, spb * 2);
        }
        if (sectionMid > 0.35 && step === 1 && bar % 2 === 0) bell(chords[bar][2] * 2, at, 0.14, spb * 5);
      }
    } else {
      const SECTIONS: number[][][] = [
        [[220, 277.2, 329.6], [185, 220, 277.2], [146.8, 220, 293.7], [164.8, 246.9, 329.6]],
        [[185, 220, 277.2], [146.8, 220, 293.7], [220, 277.2, 329.6], [164.8, 246.9, 329.6]],
        [[196, 246.9, 293.7], [146.8, 185, 220], [164.8, 207.7, 246.9], [220, 261.6, 329.6]],
      ];
      const chords = SECTIONS[section].map((c) => c.map((f) => f * liftMul));
      const penta = [440, 493.9, 554.4, 659.3, 740].map((f) => f * liftMul);
      for (let beat = 0; beat < steps; beat++) {
        const bar = Math.floor(beat / 8) % 4;
        const step = beat % 8;
        const at = beat * spb;
        if (step % 2 === 0) {
          tone(chords[bar][0] / 2, at, spb * 1.8, 0.4, 'triangle');
          if (lift && step % 4 === 0) tone(chords[bar][0], at, spb * 0.9, 0.22, 'triangle');
        }
        tone(chords[bar][(step * 2) % 3] * 2, at, spb * 0.9, 0.16 + sectionMid * 0.08, 'square');
        if (sectionMid > 0.3 && step % 4 === 1) tone(penta[(bar + step) % penta.length], at, spb * 1.6, 0.14, 'triangle');
        if (sectionMid > 0.15 && step % 2 === 1) hat(at, 0.1 + sectionMid * 0.1);
      }
    }

    const rendered = await off.startRendering();
    // Coda ripiegata sull'inizio: loop senza click né code tagliate.
    const loopSamples = Math.floor(loopLen * sr);
    const tailSamples = Math.min(rendered.length - loopSamples, loopSamples);
    const out = this.ctx!.createBuffer(2, loopSamples, sr);
    for (let ch = 0; ch < 2; ch++) {
      const src = rendered.getChannelData(ch);
      const dst = out.getChannelData(ch);
      for (let i = 0; i < loopSamples; i++) dst[i] = src[i];
      for (let i = 0; i < tailSamples; i++) dst[i] += src[loopSamples + i];
    }
    this.loopCache.set(cacheKey, out);
    return out;
  }
}
