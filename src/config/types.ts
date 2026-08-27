/**
 * Tipi di configurazione del framework white-label.
 * Tutto ciò che riguarda branding, asset, gameplay tuning e testi
 * vive in game-config.json: il codice non contiene riferimenti hardcoded.
 */

export interface BrandConfig {
  /** Logo mostrato in loading/menu (opzionale). */
  logo?: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  /** Colore testo HUD. */
  textColor: string;
  /** Sfondo schermate UI (css). */
  uiBackground: string;
  fontFamily: string;
}

export interface AnimationMap {
  idle: string;
  greeting: string;
  run: string;
  jump: string;
  /** Animazione atterraggio (opzionale, fallback: run). */
  land?: string;
  hit: string;
  death: string;
  victory: string;
  powerUp?: string;
  celebration?: string;
  stumble?: string;
}

export interface CharacterConfig {
  model: string;
  /** Scala uniforme applicata al modello. */
  scale: number;
  /** Offset verticale del modello rispetto al suolo. */
  yOffset: number;
  /** Mappa nome-logico -> nome AnimationGroup nel GLB. */
  animations: AnimationMap;
  /** Nodi/mesh del GLB da nascondere (es. accessori indesiderati). */
  hideMeshes?: string[];
  /** Velocità di riproduzione della corsa a baseSpeed. */
  runAnimSpeed: number;
}

export interface MovementConfig {
  /** Velocità base di avanzamento (m/s). */
  baseSpeed: number;
  /** Rampa di velocità: [tempoSec, moltiplicatore]. */
  speedRamp: [number, number][];
  /** Modalità laterale: 'free' (continuo) o 'lanes'. */
  lateralMode: 'free' | 'lanes';
  /** Velocità laterale massima (m/s) in modalità free. */
  lateralSpeed: number;
  /** Numero corsie (solo lateralMode='lanes'). */
  laneCount: number;
  /** Impulso verticale del salto (m/s). */
  jumpVelocity: number;
  /** Gravità (m/s^2, positiva verso il basso). */
  gravity: number;
  /** Doppio salto abilitato. */
  doubleJump: boolean;
  /** Moltiplicatore impulso del secondo salto. */
  doubleJumpFactor: number;
}

export type SegmentKind =
  | 'straight' | 'curve-left' | 'curve-right' | 'hill-up' | 'hill-down'
  | 'bridge' | 'gap' | 'narrow' | 'obstacle-area' | 'enemy-area'
  | 'coin-area' | 'powerup-area' | 'checkpoint' | 'canyon' | 'final-run' | 'finish';

export interface LevelConfig {
  /** Durata target del livello in secondi. */
  duration: number;
  /** Sequenza segmenti; 'auto' genera la ricetta procedurale controllata. */
  layout: 'auto' | SegmentKind[];
  /** Posizioni checkpoint in frazione del percorso (usate con layout auto). */
  checkpoints: number[];
  /** Larghezza standard della strada (m). */
  trackWidth: number;
  /** Seed per la generazione controllata (stessa ricetta a parità di seed). */
  seed: number;
}

export interface CollectibleConfig {
  model?: string;
  score: number;
  /** Raggio di raccolta (m). */
  radius: number;
  scale: number;
}

export type PowerUpKind = 'shield' | 'magnet' | 'doubleScore' | 'speedBoost' | 'superJump' | 'invincibility';

export interface PowerUpConfig {
  /** Power-up abilitati e distribuiti nel livello. */
  enabled: PowerUpKind[];
  /** Durate in secondi (per quelli a tempo). */
  durations: Partial<Record<PowerUpKind, number>>;
  /** Punti per raccolta power-up. */
  score: number;
  /** Modelli GLB opzionali per sostituire le icone procedurali. */
  models?: Partial<Record<PowerUpKind, string>>;
  /** Raggio del magnete (m). */
  magnetRadius: number;
  /** Moltiplicatore velocità dello speed boost. */
  speedBoostFactor: number;
}

export interface EnemyConfig {
  /** Modello GLB opzionale (fallback: slime procedurale cartoon). */
  model?: string;
  scale: number;
}

export interface ScoringConfig {
  collectible: number;
  powerUp: number;
  checkpoint: number;
  levelComplete: number;
  /** Punti bonus per ogni secondo residuo. */
  timeBonusPerSecond: number;
  /** Raccolte consecutive necessarie per salire di moltiplicatore. */
  comboStep: number;
  maxMultiplier: number;
}

export interface RulesConfig {
  startingLives: number;
  /** Secondi di invulnerabilità dopo un colpo. */
  invulnerabilityTime: number;
  /** 'checkpoint' = respawn all'ultimo checkpoint; 'restart' = ricomincia. */
  onGameOver: 'checkpoint' | 'restart';
}

export interface AudioConfig {
  /** Stile della musica procedurale di fallback. */
  style?: 'adventure' | 'magic';
  /** File audio opzionali; se assenti si usa il fallback sintetizzato. */
  music?: string;
  files: Partial<Record<SfxName, string>>;
  musicVolume: number;
  sfxVolume: number;
}

export type SfxName =
  | 'coin' | 'jump' | 'land' | 'hit' | 'fall' | 'checkpoint' | 'powerup'
  | 'countdown' | 'go' | 'victory' | 'gameover' | 'click' | 'combo' | 'enemy';

export interface EnvironmentConfig {
  theme: string;
  /** Cartella asset del tema. */
  assetPath: string;
}

export interface StringsConfig {
  [key: string]: string;
}

export interface LeaderboardConfig {
  provider: 'local' | 'api';
  /** Endpoint REST per provider 'api'. */
  apiUrl?: string;
  /** ID evento opzionale salvato con ogni punteggio. */
  eventId?: string;
  maxEntries: number;
}

/** Profilo selezionabile dal menu iniziale: override parziali del config. */
export interface ProfileConfig {
  id: string;
  label: string;
  /** Emoji/icona mostrata nella card di selezione. */
  icon: string;
  description?: string;
  /** Override profondi applicati sopra il config base. */
  overrides: Partial<GameConfig>;
}

/** Opzione di durata selezionabile dal menu. */
export interface DurationOption {
  label: string;
  seconds: number;
}

export interface GameConfig {
  /** Profili selezionabili (personaggio+mondo); vuoto = si parte diretti. */
  profiles?: ProfileConfig[];
  /** Durate proposte nel menu; vuoto = si usa level.duration. */
  durationOptions?: DurationOption[];
  game: { name: string; version: string };
  brand: BrandConfig;
  character: CharacterConfig;
  movement: MovementConfig;
  level: LevelConfig;
  environment: EnvironmentConfig;
  collectible: CollectibleConfig;
  powerUps: PowerUpConfig;
  enemy: EnemyConfig;
  scoring: ScoringConfig;
  rules: RulesConfig;
  audio: AudioConfig;
  leaderboard: LeaderboardConfig;
  strings: StringsConfig;
}
