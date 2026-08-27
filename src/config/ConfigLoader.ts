import type { GameConfig } from './types';

/**
 * Carica game-config.json e lo fonde con i default.
 * Un config parziale del cliente può ridefinire solo ciò che gli serve.
 */
export async function loadConfig(url = 'game-config.json'): Promise<GameConfig> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Impossibile caricare la configurazione: ${res.status}`);
  const user = await res.json();
  return deepMerge(structuredClone(DEFAULTS), user) as GameConfig;
}

function deepMerge(base: any, extra: any): any {
  if (extra === null || extra === undefined) return base;
  if (Array.isArray(extra) || typeof extra !== 'object') return extra;
  const out = { ...base };
  for (const k of Object.keys(extra)) out[k] = deepMerge(base?.[k], extra[k]);
  return out;
}

/** Default completi: il gioco parte anche con un config vuoto. */
export const DEFAULTS: GameConfig = {
  game: { name: 'Runner', version: '0.0.0' },
  brand: {
    logo: '',
    primaryColor: '#ffb703',
    secondaryColor: '#1b4332',
    accentColor: '#ff5d8f',
    textColor: '#ffffff',
    uiBackground: 'linear-gradient(160deg, rgba(18,52,40,0.92), rgba(9,26,20,0.96))',
    fontFamily: "'Trebuchet MS', 'Segoe UI', Verdana, sans-serif",
  },
  character: {
    model: 'assets/character/character.glb',
    scale: 0.42,
    yOffset: 0,
    runAnimSpeed: 1.35,
    animations: {
      idle: 'Idle', greeting: 'Wave', run: 'Running', jump: 'Jump',
      hit: 'No', death: 'Death', victory: 'Dance', powerUp: 'Yes', celebration: 'ThumbsUp',
    },
  },
  movement: {
    baseSpeed: 11,
    speedRamp: [[0, 1], [60, 1.1], [120, 1.2], [180, 1.28]],
    lateralMode: 'free',
    lateralSpeed: 7.5,
    laneCount: 3,
    jumpVelocity: 8.2,
    gravity: 22,
    doubleJump: true,
    doubleJumpFactor: 0.9,
  },
  level: { duration: 210, layout: 'auto', checkpoints: [0.25, 0.5, 0.75], trackWidth: 7, seed: 1 },
  environment: { theme: 'forest', assetPath: 'assets/environment/forest' },
  collectible: { model: 'assets/collectibles/coin.glb', score: 100, radius: 1.0, scale: 1.6 },
  powerUps: {
    enabled: ['shield', 'magnet', 'doubleScore'],
    durations: { magnet: 9, doubleScore: 10, speedBoost: 6, superJump: 8, invincibility: 6 },
    score: 250,
    magnetRadius: 6,
    speedBoostFactor: 1.45,
  },
  enemy: { scale: 1 },
  scoring: {
    collectible: 100, powerUp: 250, checkpoint: 500, levelComplete: 5000,
    timeBonusPerSecond: 25, comboStep: 10, maxMultiplier: 3,
  },
  rules: { startingLives: 3, invulnerabilityTime: 2, onGameOver: 'checkpoint' },
  audio: { files: {}, musicVolume: 0.35, sfxVolume: 0.8 },
  leaderboard: { provider: 'local', maxEntries: 50 },
  strings: {
    loading: 'Caricamento…', tapToStart: 'Tocca per iniziare', insertName: 'INSERISCI IL TUO NOME',
    play: 'GIOCA', go: 'VIA!', checkpoint: 'CHECKPOINT', levelComplete: 'LIVELLO COMPLETATO',
    runComplete: 'CORSA COMPLETATA', gameOver: 'GAME OVER', respawn: 'Riparti dal checkpoint…',
    score: 'Punteggio', collectibles: 'Monete', powerupsTaken: 'Power-up', time: 'Tempo',
    bestCombo: 'Combo migliore', rank: 'Posizione', topPlayers: 'MIGLIORI GIOCATORI', you: 'TU',
    playAgain: 'GIOCA ANCORA', lives: 'Vite', rotateDevice: 'Ruota il dispositivo in orizzontale per giocare',
    powerShield: 'Scudo', powerMagnet: 'Magnete', powerDoubleScore: 'Punti x2', powerSpeedBoost: 'Turbo',
    powerSuperJump: 'Super Salto', powerInvincibility: 'Invincibile',
    controlsHint: '← → muoviti · SPAZIO salta', controlsHintMobile: 'Trascina per muoverti · Tocca per saltare',
    iosInstallHint: '📲 Schermo intero su iPhone: apri in Safari → Condividi → Aggiungi alla schermata Home',
  },
};
