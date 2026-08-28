import '@babylonjs/loaders/glTF';
import './ui/style.css';
import { deepMerge, loadConfig } from './config/ConfigLoader';
import type { GameConfig } from './config/types';
import { GameController } from './core/GameController';
import { Screens } from './ui/Screens';
import { registerServiceWorker } from './ui/fullscreen';
import { loadDebugPrefs } from './ui/debugPrefs';

registerServiceWorker();

async function boot(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const base = await loadConfig();
  // Le preferenze salvate dalla pagina impostazioni vincono sul config.
  const dbg = loadDebugPrefs(base.game.debugFps ?? false);
  base.game.debugFps = dbg.fps;
  base.game.debugInspect = dbg.inspect;
  let cfg: GameConfig = base;
  let nickname: string | undefined;
  let inspect = false;

  // Menu iniziale: scelta eroe/mondo + durata + nome (se il config
  // definisce dei profili; senza profili si parte diretti).
  if (base.profiles?.length) {
    applyBrandVars(base);
    const menu = new Screens(document.getElementById('ui')!, base);
    const durations = base.durationOptions?.length
      ? base.durationOptions
      : [{ label: '3:30', seconds: base.level.duration }];
    const preferred = durations.find((d) => d.seconds === 120) ?? durations[0];
    const sel = await menu.startMenu(base.profiles, durations, preferred.seconds);
    cfg = deepMerge(structuredClone(base), sel.profile.overrides) as GameConfig;
    cfg.level.duration = sel.seconds;
    nickname = sel.nickname;
    inspect = sel.inspect;
  }

  const game = new GameController(canvas, cfg, { nickname, inspect });
  await game.start();
}

/** Variabili brand minime per il menu, prima che parta il GameController. */
function applyBrandVars(cfg: GameConfig): void {
  const r = document.documentElement.style;
  r.setProperty('--primary', cfg.brand.primaryColor);
  r.setProperty('--secondary', cfg.brand.secondaryColor);
  r.setProperty('--accent', cfg.brand.accentColor);
  r.setProperty('--text', cfg.brand.textColor);
  r.setProperty('--ui-bg', cfg.brand.uiBackground);
  r.setProperty('--font', cfg.brand.fontFamily);
}

boot().catch((err) => {
  console.error(err);
  const ui = document.getElementById('ui');
  if (ui) {
    ui.innerHTML = `<div class="screen"><h2>Errore di avvio</h2><div class="sub">${String(err)}</div></div>`;
  }
});
