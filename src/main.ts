import '@babylonjs/loaders/glTF';
import './ui/style.css';
import { loadConfig } from './config/ConfigLoader';
import { GameController } from './core/GameController';
import { registerServiceWorker } from './ui/fullscreen';

registerServiceWorker();

async function boot(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const cfg = await loadConfig();
  const game = new GameController(canvas, cfg);
  await game.start();
}

boot().catch((err) => {
  console.error(err);
  const ui = document.getElementById('ui');
  if (ui) {
    ui.innerHTML = `<div class="screen"><h2>Errore di avvio</h2><div class="sub">${String(err)}</div></div>`;
  }
});
