import { Color3, Vector3 } from '@babylonjs/core';
import type { GameConfig, PowerUpKind } from '../config/types';
import { GameEngine } from './GameEngine';
import { EventBus } from './EventBus';
import { TrackSystem } from '../track/TrackSystem';
import { TrackBuilder } from '../track/TrackBuilder';
import { resolveTheme, type Theme, type ThemeDefinition } from '../world/themes';
import { CharacterSystem } from '../character/CharacterSystem';
import { InputSystem, KeyboardSource, TouchSource } from '../input/InputSystem';
import { RunController } from '../gameplay/RunController';
import { ChaseCamera } from '../camera/ChaseCamera';
import { CollectibleSystem } from '../gameplay/Collectibles';
import { ObstacleSystem } from '../gameplay/Obstacles';
import { EnemySystem } from '../gameplay/Enemies';
import { PowerUpSystem } from '../gameplay/PowerUps';
import { CheckpointSystem, FinishGate } from '../gameplay/Checkpoints';
import { ScoreSystem } from '../gameplay/ScoreSystem';
import { AudioSystem } from '../audio/AudioSystem';
import { Effects } from '../fx/Effects';
import { Hud } from '../ui/Hud';
import { Screens } from '../ui/Screens';
import { createLeaderboard, type LeaderboardProvider } from '../leaderboard/Leaderboard';
import { loadMergedProp } from './assets';

type Phase = 'boot' | 'name' | 'intro' | 'countdown' | 'playing' | 'finishing' | 'results' | 'inspect';

/** Orchestratore: possiede i sistemi, gestisce il flusso e le regole. */
export class GameController {
  private engine: GameEngine;
  private bus = new EventBus();
  private track: TrackSystem;
  private theme: Theme;
  private themeDef: ThemeDefinition;
  private character: CharacterSystem;
  private input = new InputSystem();
  private run: RunController;
  private camera: ChaseCamera;
  private coins: CollectibleSystem;
  private obstacles: ObstacleSystem;
  private enemies: EnemySystem;
  private powerUps: PowerUpSystem;
  private checkpoints: CheckpointSystem;
  private score: ScoreSystem;
  private audio: AudioSystem;
  private fx!: Effects;
  private hud: Hud;
  private screens: Screens;
  private leaderboard: LeaderboardProvider;

  private phase: Phase = 'boot';
  private lives: number;
  private nickname = 'PLAYER';
  private timeLeft: number;
  private readonly timeLimit: number;
  private playTime = 0;
  private inspectD = 0;
  private inspectH = 34;
  private inspectLabel: HTMLElement | null = null;
  private fpsAcc = 0;
  // Risoluzione dinamica: 0 = piena (DPR<=2), poi riduzioni progressive.
  private perfLevel = 0;
  private perfCalm = 0;
  private pausedGame = false;
  private pauseEl: HTMLElement | null = null;
  // Turbo caricato dalle monete, attivato liberamente dal giocatore.
  private boostCharges = 0;
  private boostMeter = 0;
  private boostTimer = 0;

  constructor(canvas: HTMLCanvasElement, private cfg: GameConfig, private opts: { nickname?: string; inspect?: boolean } = {}) {
    applyBrand(cfg);
    this.engine = new GameEngine(canvas);
    this.track = new TrackSystem(cfg.level, cfg.movement);
    this.themeDef = resolveTheme(cfg.environment.theme);
    this.engine.applyLighting(this.themeDef.lighting);
    this.theme = this.themeDef.create(this.engine.scene, this.track, cfg.environment.assetPath);
    this.character = new CharacterSystem(this.engine.scene, cfg.character);
    this.run = new RunController(cfg, this.track, this.character, this.input, this.bus);
    this.camera = new ChaseCamera(this.engine.scene, this.track, this.run);
    this.coins = new CollectibleSystem(this.engine.scene, this.track, cfg.collectible, cfg.movement, this.bus);
    this.obstacles = new ObstacleSystem(
      this.engine.scene, this.track, cfg.environment.assetPath,
      cfg.environment.rockModels ?? [
        'assets/environment/forest/stone_2.glb',
        'assets/environment/forest/stone_4.glb',
        'assets/environment/forest/stone_5.glb',
      ],
    );
    this.enemies = new EnemySystem(this.engine.scene, this.track, cfg.enemy);
    this.powerUps = new PowerUpSystem(this.engine.scene, this.track, cfg.powerUps, this.bus);
    this.checkpoints = new CheckpointSystem(
      this.engine.scene, this.track, this.bus, 'assets/props/flag.glb',
      Color3.FromHexString(cfg.brand.accentColor),
    );
    this.score = new ScoreSystem(cfg.scoring, this.bus);
    this.audio = new AudioSystem(cfg.audio);
    this.leaderboard = createLeaderboard(cfg.leaderboard);
    this.lives = cfg.rules.startingLives;
    // Il tempo limite deriva dalla lunghezza REALE del percorso (che ha un
    // minimo strutturale), con margine per respawn e imprevisti.
    const estSeconds = this.track.totalLength / (cfg.movement.baseSpeed * 1.05);
    this.timeLimit = Math.ceil(Math.max(cfg.level.duration, estSeconds) * 1.3);
    this.timeLeft = this.timeLimit;

    (window as unknown as Record<string, unknown>).__game = this;
    const ui = document.getElementById('ui')!;
    this.hud = new Hud(ui, cfg);
    this.screens = new Screens(ui, cfg);
    this.hud.onPause = () => this.togglePause();
    this.hud.onBoost = () => this.activateBoost();
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.togglePause();
      if (e.key === 'Shift' || e.key.toLowerCase() === 'b') this.activateBoost();
    });
  }

  /** Attiva un turbo se c'è una carica pronta: 5s di velocità extra. */
  private activateBoost(): void {
    if (this.phase !== 'playing' || this.pausedGame) return;
    if (this.boostCharges <= 0 || this.boostTimer > 0) return;
    const bc = this.cfg.boost;
    this.boostCharges--;
    this.boostTimer = bc.duration;
    this.run.modifiers.speedFactor = bc.factor;
    this.camera.setFovBoost(true);
    this.audio.play('powerup');
    this.hud.setBoost(this.boostCharges, this.boostMeter / Math.max(1, bc.coinsRequired));
    this.hud.setPowerUp('speedBoost', bc.duration, bc.duration);
  }

  /** Pausa di gioco: overlay con riprendi, musica on/off e uscita. */
  private togglePause(): void {
    if (this.phase !== 'playing') return;
    this.pausedGame = !this.pausedGame;
    if (!this.pausedGame) {
      this.pauseEl?.remove();
      this.pauseEl = null;
      return;
    }
    const s = this.cfg.strings;
    const el = document.createElement('div');
    el.className = 'pause-overlay';
    el.innerHTML = `
      <h2>${s.paused ?? 'PAUSA'}</h2>
      <button class="primary resume">${s.resume ?? 'RIPRENDI'}</button>
      <button class="music"></button>
      <button class="quit">${s.exitGame ?? 'ESCI DAL GIOCO'}</button>`;
    const musicBtn = el.querySelector('.music') as HTMLElement;
    const musicLabel = () => `${s.music ?? 'MUSICA'}: ${this.audio.musicEnabled ? (s.on ?? 'SÌ') : (s.off ?? 'NO')}`;
    musicBtn.textContent = musicLabel();
    el.querySelector('.resume')!.addEventListener('click', () => this.togglePause());
    musicBtn.addEventListener('click', () => {
      this.audio.setMusicEnabled(!this.audio.musicEnabled);
      musicBtn.textContent = musicLabel();
    });
    el.querySelector('.quit')!.addEventListener('click', () => location.reload());
    document.getElementById('ui')!.appendChild(el);
    this.pauseEl = el;
  }

  async start(): Promise<void> {
    const setProgress = this.screens.loading();
    const steps: [string, () => Promise<unknown>][] = [
      ['theme', () => this.theme.build()],
      ['character', () => this.character.load()],
      ['coins', () => this.coins.build()],
      ['obstacles', () => this.obstacles.build()],
      ['enemies', () => this.enemies.build()],
      ['powerups', () => this.powerUps.build()],
      ['checkpoints', () => this.checkpoints.build()],
    ];
    let done = 0;
    for (const [name, job] of steps) {
      try {
        await job();
      } catch (err) {
        // Un asset mancante non blocca il gioco: log e si prosegue.
        console.warn(`Caricamento parziale (${name}):`, err);
      }
      setProgress(++done / (steps.length + 1));
    }
    new TrackBuilder(this.engine.scene, this.track, this.themeDef.palette);
    new FinishGate(
      this.engine.scene, this.track,
      Color3.FromHexString(this.cfg.brand.primaryColor),
      Color3.FromHexString(this.cfg.brand.secondaryColor),
      this.cfg.game.name.toUpperCase(),
    );
    await this.buildFinishLandmark();
    this.fx = new Effects(this.engine.scene);
    setProgress(1);

    // Ombra del personaggio: solo il disco morbido (l'ombra dinamica
    // sfarfallava sovrapponendosi al disco su mobile).

    // Input.
    this.input.addSource(new KeyboardSource());
    this.input.addSource(new TouchSource(document.body));
    this.input.onAny(() => this.audio.unlock());

    // Posizione iniziale: personaggio rivolto verso la camera.
    this.placeCharacterAtStart();
    this.wireEvents();
    this.engine.onUpdate((dt) => this.update(dt));

    await new Promise((r) => setTimeout(r, 350));
    if (this.opts.inspect) {
      this.screens.dismiss();
      this.enterInspector();
      return;
    }
    if (this.opts.nickname) {
      this.nickname = this.opts.nickname;
      this.screens.dismiss();
    } else {
      this.phase = 'name';
      this.nickname = await this.screens.nameEntry();
    }
    this.audio.unlock();
    await this.playIntro();
  }

  /**
   * Modalità debug: camera-drone che sorvola l'intero percorso, guidata
   * da slider di posizione e quota. Serve a mandare feedback puntuali
   * ("a d 850 c'è X") senza dover giocare fino al punto.
   */
  private enterInspector(): void {
    this.phase = 'inspect';
    this.character.visual.setEnabled(false);
    this.fx.blobShadow.setEnabled(false);
    const ui = document.getElementById('ui')!;
    const el = document.createElement('div');
    el.className = 'inspector';
    el.innerHTML = `
      <div class="pos-label">d 0</div>
      <div class="panel">
        <div class="row"><span>Pista</span><input class="d-slider" type="range" min="0" max="${Math.floor(this.track.totalLength - 1)}" step="1" value="0" /></div>
        <div class="row"><span>Quota</span><input class="h-slider" type="range" min="8" max="90" step="1" value="${this.inspectH}" /></div>
        <div class="step">
          <button class="b-back">◀ −25 m</button>
          <button class="b-fwd">+25 m ▶</button>
          <button class="exit">✕ Esci</button>
        </div>
      </div>
    `;
    ui.appendChild(el);
    this.inspectLabel = el.querySelector('.pos-label');
    const dSlider = el.querySelector<HTMLInputElement>('.d-slider')!;
    const hSlider = el.querySelector<HTMLInputElement>('.h-slider')!;
    dSlider.addEventListener('input', () => { this.inspectD = Number(dSlider.value); });
    hSlider.addEventListener('input', () => { this.inspectH = Number(hSlider.value); });
    const step = (delta: number) => {
      this.inspectD = Math.max(0, Math.min(this.track.totalLength - 1, this.inspectD + delta));
      dSlider.value = String(Math.round(this.inspectD));
    };
    el.querySelector('.b-back')!.addEventListener('click', () => step(-25));
    el.querySelector('.b-fwd')!.addEventListener('click', () => step(25));
    el.querySelector('.exit')!.addEventListener('click', () => window.location.reload());
  }

  /**
   * Risoluzione dinamica: se il telefono non regge, si riduce la risoluzione
   * di rendering a gradini (la UI resta nitida, è DOM). Si risale piano solo
   * dopo un periodo prolungato di frame rate alto.
   */
  private adaptResolution(fps: number): void {
    const base = 1 / Math.min(window.devicePixelRatio || 1, 2);
    const levels = [1, 1.4, 1.8];
    if (fps < 32 && this.perfLevel < levels.length - 1) {
      this.perfLevel++;
      this.perfCalm = 0;
      this.engine.engine.setHardwareScalingLevel(base * levels[this.perfLevel]);
    } else if (fps > 55 && this.perfLevel > 0) {
      this.perfCalm += 0.5;
      if (this.perfCalm >= 5) {
        this.perfLevel--;
        this.perfCalm = 0;
        this.engine.engine.setHardwareScalingLevel(base * levels[this.perfLevel]);
      }
    } else {
      this.perfCalm = 0;
    }
  }

  /**
   * Meta scenografica oltre il traguardo: un castello enorme in fondo alla
   * strada, visibile da lontano. Modello e altezza sono configurabili.
   */
  private async buildFinishLandmark(): Promise<void> {
    const url = this.cfg.environment.finishModel ?? 'assets/props/castle.glb';
    if (!url) return;
    try {
      const castle = await loadMergedProp(this.engine.scene, url, 'finish_landmark');
      if (!castle) return;
      const bb = castle.getBoundingInfo().boundingBox;
      const h = Math.max(0.001, bb.maximum.y - bb.minimum.y);
      const scale = (this.cfg.environment.finishModelHeight ?? 26) / h;
      const f = this.track.getFrame(this.track.totalLength - 0.1);
      const yaw = Math.atan2(f.forward.x, f.forward.z);
      castle.scaling.setAll(scale);
      // Fronte rivolto verso chi arriva, base leggermente affondata.
      castle.rotation.y = yaw + Math.PI;
      castle.position.copyFrom(f.pos).addInPlace(f.forward.scale(38));
      castle.position.y = f.pos.y - bb.minimum.y * scale - 0.35;
      castle.setEnabled(true);
      castle.freezeWorldMatrix();
    } catch (err) {
      console.warn('Castello del traguardo non caricato:', err);
    }
  }

  /** Aggiorna la camera-drone e i sistemi nella modalità ispettore. */
  private updateInspector(dt: number): void {
    const d = this.inspectD;
    // I sistemi vivono e vengono streamati attorno al punto osservato
    // (py altissimo: nessuna raccolta o collisione accidentale).
    this.coins.update(dt, d, 0, 999);
    this.obstacles.update(dt, d, 0, 999, false);
    this.enemies.update(dt, d, 0, 999, false);
    this.powerUps.update(dt, d, 0, 999);
    const f = this.track.getFrame(d);
    const cam = this.camera.camera;
    const h = this.inspectH;
    // Anti-cresta come la camera di gioco: sui dossi la camera si alza
    // quanto il punto piu' alto dei prossimi metri, cosi' la strada oltre
    // la cresta resta visibile invece di sparire "tagliata dal cielo".
    let crest = f.pos.y;
    for (const ahead of [12, 26, 42, 60]) {
      const fd = Math.min(d + ahead, this.track.totalLength - 1);
      crest = Math.max(crest, this.track.getFrame(fd).pos.y);
    }
    const lift = (crest - f.pos.y) * 1.15;
    cam.position.copyFrom(f.pos)
      .subtractInPlace(f.forward.scale(h * 0.85))
      .addInPlace(new Vector3(0, h + lift, 0));
    cam.setTarget(this.track.toWorld(Math.min(d + 14, this.track.totalLength - 1), 0, 1));
    cam.rotation.z = 0;
    if (this.inspectLabel) {
      const seg = this.track.segmentAt(d).kind;
      const pct = Math.round((d / this.track.finishD) * 100);
      this.inspectLabel.textContent = `d ${Math.round(d)} · ${seg} · ${pct}%`;
    }
  }

  private placeCharacterAtStart(): void {
    const f = this.track.getFrame(0.1);
    const pos = this.track.toWorld(0.1, 0, 0);
    this.character.root.position.copyFrom(pos);
    this.character.root.rotation.y = Math.atan2(f.forward.x, f.forward.z) + Math.PI;
  }

  /** Intro: saluto frontale, giro verso il percorso, countdown, via. */
  private async playIntro(): Promise<void> {
    this.phase = 'intro';
    this.camera.introMode = true;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    this.character.play('greeting', false, 1);
    await wait(Math.min(2200, this.character.duration('greeting') * 1000 + 300));

    // Si gira verso il percorso.
    const f = this.track.getFrame(0.1);
    const targetYaw = Math.atan2(f.forward.x, f.forward.z);
    const startYaw = this.character.root.rotation.y;
    const turnMs = 650;
    const t0 = performance.now();
    this.character.play('idle', true);
    await new Promise<void>((resolve) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / turnMs);
        this.character.root.rotation.y = startYaw + (targetYaw + Math.PI * 2 - startYaw) * easeInOut(k);
        if (k < 1) requestAnimationFrame(step); else resolve();
      };
      step();
    });
    this.character.root.rotation.y = targetYaw;

    // Countdown 3-2-1-VIA! con camera che si allarga.
    this.phase = 'countdown';
    this.camera.introDistance = 7.4;
    this.camera.introHeight = 2.9;
    for (const n of ['3', '2', '1']) {
      this.hud.countdown(n);
      this.audio.play('countdown');
      await wait(900);
    }
    this.hud.countdown(this.cfg.strings.go);
    this.audio.play('go');
    this.camera.introMode = false;
    this.hud.show();
    this.audio.startMusic();
    this.phase = 'playing';
    this.run.start();
  }

  /** Cablaggio eventi -> punteggio, HUD, audio, effetti. */
  private wireEvents(): void {
    const b = this.bus;
    b.on('coinCollected', ({ d, x, y }) => {
      this.audio.play('coin');
      this.fx.burst(this.track.toWorld(d, x, y), Color3.FromHexString('#ffd700'));
      // Le monete caricano il turbo (fino a maxCharges).
      const bc = this.cfg.boost;
      if (bc.coinsRequired > 0 && this.boostCharges < bc.maxCharges) {
        this.boostMeter++;
        if (this.boostMeter >= bc.coinsRequired) {
          this.boostMeter = 0;
          this.boostCharges++;
          this.audio.play('combo');
          this.hud.message(this.cfg.strings.boostReady ?? 'TURBO PRONTO!', false, 'var(--primary)');
        }
        this.hud.setBoost(this.boostCharges, this.boostMeter / bc.coinsRequired);
      }
    });
    b.on('scoreChanged', ({ score, delta }) => {
      this.hud.setScore(score);
      if (delta > 0 && delta < 2000) this.hud.floatScore(`+${delta}`);
    });
    b.on('comboChanged', ({ multiplier }) => {
      this.hud.setMultiplier(multiplier);
      if (multiplier > 1) {
        this.audio.play('combo');
        this.hud.message(`COMBO x${multiplier}`, false, 'var(--accent)');
      }
    });
    b.on('jumped', () => this.audio.play('jump'));
    b.on('landed', () => this.audio.play('land'));
    b.on('checkpointReached', ({ index, d }) => {
      this.audio.play('checkpoint');
      this.hud.message(this.cfg.strings.checkpoint);
      this.fx.wave(this.track.toWorld(d, 0, 0.3), Color3.FromHexString(this.cfg.brand.accentColor));
      void index;
    });
    b.on('powerUpCollected', ({ kind, d, x }) => {
      this.audio.play('powerup');
      this.fx.burst(this.track.toWorld(d, x, 1.2), this.powerUps.color(kind as PowerUpKind), 22, 1.3);
      this.applyPowerUp(kind as PowerUpKind, true);
    });
    b.on('powerUpExpired', ({ kind }) => {
      this.applyPowerUp(kind as PowerUpKind, false);
      this.hud.removePowerUp(kind);
    });
    b.on('fell', () => {
      this.audio.play('fall');
      this.loseLife(true);
    });

    this.obstacles.onHit = () => this.handleHit('obstacle');
    this.enemies.onHit = () => this.handleHit('enemy');
  }

  private applyPowerUp(kind: PowerUpKind, on: boolean): void {
    switch (kind) {
      case 'magnet':
        this.coins.magnetRadius = on ? this.cfg.powerUps.magnetRadius : 0;
        break;
      case 'doubleScore':
        this.score.doubleScoreActive = on;
        break;
      case 'speedBoost':
        this.run.modifiers.speedFactor = on ? this.cfg.powerUps.speedBoostFactor : 1;
        this.camera.setFovBoost(on);
        break;
      case 'superJump':
        this.run.modifiers.jumpFactor = on ? 1.35 : 1;
        break;
      case 'shield':
      case 'invincibility':
        break;
    }
    if (on && kind === 'shield') this.hud.setPowerUp('shield', 0, 0);
    if (this.character.has('powerUp') && on) {
      // Piccola celebrazione senza interrompere la corsa: solo se non in aria.
    }
  }

  private get playerProtected(): boolean {
    return this.run.invulnerable > 0 || this.powerUps.has('invincibility');
  }

  private handleHit(source: 'obstacle' | 'enemy'): void {
    if (this.phase !== 'playing' || this.playerProtected) return;
    if (this.powerUps.consumeShield()) {
      this.audio.play('powerup');
      this.hud.removePowerUp('shield');
      this.fx.burst(this.character.root.position.add(new Vector3(0, 1, 0)), Color3.FromHexString('#38bdf8'), 20, 1.2);
      this.run.applyHit();
      return;
    }
    this.audio.play(source === 'enemy' ? 'enemy' : 'hit');
    this.loseLife(false);
  }

  private loseLife(fromFall: boolean): void {
    if (this.phase !== 'playing') return;
    this.lives--;
    this.hud.setLives(this.lives);
    this.hud.hitFlash();
    this.camera.addShake(0.9);
    this.bus.emit('lifeLost', { livesLeft: this.lives });

    if (this.lives <= 0) {
      // Torna all'ultimo checkpoint (o all'inizio) con vite piene.
      this.audio.play('gameover');
      this.lives = this.cfg.rules.startingLives;
      this.hud.setLives(this.lives);
      const d = this.cfg.rules.onGameOver === 'restart' ? 0 : this.checkpoints.lastPassedD;
      this.hud.message(this.cfg.strings.respawn, true);
      this.run.respawnAt(Math.max(0, d));
      this.resetWindows();
      return;
    }
    if (fromFall) {
      // Riparte ~35 m prima della voragine (circa 3 secondi di corsa):
      // il giocatore deve avere il tempo di leggere il salto e prepararlo.
      const gap = this.track.gaps.find(([a, b]) => this.run.d >= a - 8 && this.run.d <= b + 8);
      const back = Math.max(0, (gap ? gap[0] : this.run.d) - 35);
      this.run.respawnAt(Math.max(this.checkpoints.lastPassedD, 0) > back
        ? Math.max(this.checkpoints.lastPassedD, 0)
        : back);
      this.resetWindows();
    } else {
      this.run.applyHit();
      this.character.play('hit', false, 1.3, 0.08);
      setTimeout(() => {
        if (this.phase === 'playing' && this.run.grounded) {
          this.character.play('run', true, this.cfg.character.runAnimSpeed);
        }
      }, 700);
    }
  }

  private resetWindows(): void {
    this.coins.reset();
    this.obstacles.reset();
    this.enemies.reset();
    this.powerUps.reset();
  }

  private update(dt: number): void {
    if (this.pausedGame) return;
    this.fx?.update(dt);
    this.theme.update(
      dt,
      this.phase === 'inspect' ? this.camera.camera.position : (this.character.root?.position ?? Vector3.Zero()),
      this.phase === 'inspect' ? this.inspectD : this.run.d,
    );
    this.character.update?.(dt);
    if (this.phase === 'inspect') {
      this.updateInspector(dt);
      return;
    }
    if (this.phase === 'intro' || this.phase === 'countdown') {
      this.camera.update(dt);
      return;
    }
    if (this.phase !== 'playing' && this.phase !== 'finishing') return;

    this.run.update(dt);
    const pd = this.run.d, px = this.run.x, py = this.run.y;

    if (this.phase === 'playing') {
      this.playTime += dt;
      this.timeLeft -= dt;

      // Turbo attivo: countdown e ritorno alla velocità normale.
      if (this.boostTimer > 0) {
        this.boostTimer -= dt;
        this.hud.setPowerUp('speedBoost', Math.max(0, this.boostTimer), this.cfg.boost.duration);
        if (this.boostTimer <= 0) {
          this.run.modifiers.speedFactor = 1;
          this.camera.setFovBoost(false);
          this.hud.removePowerUp('speedBoost');
        }
      }
      const canHit = !this.playerProtected;
      this.coins.update(dt, pd, px, py);
      this.obstacles.update(dt, pd, px, py, canHit);
      this.enemies.update(dt, pd, px, py, canHit);
      this.powerUps.update(dt, pd, px, py);
      this.checkpoints.update(dt, pd);

      // HUD.
      this.hud.setTime(this.timeLeft);
      this.hud.setProgress(this.run.progress);
      for (const [kind, s] of this.powerUps.active) this.hud.setPowerUp(kind, s.remaining, s.duration);

      // Lampeggio invulnerabilità.
      const blink = this.run.invulnerable > 0 && Math.floor(this.run.invulnerable * 10) % 2 === 0;
      this.character.visual.setEnabled(!blink);

      // Ombra blob a terra (segue anche il salto).
      const ground = this.track.toWorld(pd, px, 0);
      this.fx.updateBlobShadow(ground, py);

      // Bolla scudo.
      const bubble = this.powerUps.shieldCharges > 0 || this.powerUps.has('invincibility');
      this.fx.shieldBubble.setEnabled(bubble);
      if (bubble) {
        this.fx.shieldBubble.position.copyFrom(this.character.root.position);
        this.fx.shieldBubble.position.y += 0.95;
      }

      // Musica più intensa avvicinandosi al traguardo.
      this.audio.intensity = Math.min(1, this.run.progress * 1.15);

      // Indicatore FPS diagnostico + risoluzione dinamica.
      this.fpsAcc += dt;
      if (this.fpsAcc > 0.5) {
        this.fpsAcc = 0;
        const fps = this.engine.engine.getFps();
        this.adaptResolution(fps);
        this.hud.setFps(
          fps,
          this.engine.scene.getActiveMeshes().length,
          pd,
          this.track.segmentAt(pd).kind,
        );
      }

      if (pd >= this.track.finishD) this.finish(true);
      else if (this.timeLeft <= 0) this.finish(false);
    }

    this.camera.update(dt);
  }

  private async finish(completed: boolean): Promise<void> {
    if (this.phase !== 'playing') return;
    this.phase = 'finishing';
    this.run.phase = 'finished';
    this.character.visual.setEnabled(true);
    this.audio.stopMusic();

    if (completed) {
      this.audio.play('victory');
      this.hud.message(this.cfg.strings.levelComplete, true);
      this.character.play('victory', true, 1);
      this.fx.celebrate(this.character.root);
      this.fx.burst(this.character.root.position.add(new Vector3(0, 2, 0)), Color3.FromHexString(this.cfg.brand.primaryColor), 30, 2);
      this.score.finish(Math.max(0, this.timeLeft));
    } else {
      this.audio.play('gameover');
      this.hud.message(this.cfg.strings.gameOver, true);
      this.character.play('death', false, 1);
    }

    await new Promise((r) => setTimeout(r, 2600));
    this.phase = 'results';
    this.hud.hide();

    const stats = {
      score: this.score.score,
      coins: this.coins.collected,
      coinsTotal: this.coins.total,
      powerUps: this.powerUps.collectedCount,
      timeSeconds: this.playTime,
      bestCombo: this.score.bestCombo,
      completed,
    };
    const rank = await this.leaderboard.submit({
      nickname: this.nickname,
      score: stats.score,
      timeSeconds: Math.round(stats.timeSeconds),
      date: new Date().toISOString(),
      eventId: this.cfg.leaderboard.eventId,
    });
    const top = await this.leaderboard.top(5);
    this.screens.results(stats, rank, top, this.nickname, () => window.location.reload());
  }
}

/** Applica i colori/font del brand come CSS variables. */
function applyBrand(cfg: GameConfig): void {
  const r = document.documentElement.style;
  r.setProperty('--primary', cfg.brand.primaryColor);
  r.setProperty('--secondary', cfg.brand.secondaryColor);
  r.setProperty('--accent', cfg.brand.accentColor);
  r.setProperty('--text', cfg.brand.textColor);
  r.setProperty('--ui-bg', cfg.brand.uiBackground);
  r.setProperty('--font', cfg.brand.fontFamily);
  document.title = cfg.game.name;
}

function easeInOut(t: number): number { return t * t * (3 - 2 * t); }
