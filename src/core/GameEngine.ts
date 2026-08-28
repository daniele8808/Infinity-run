import {
  Color3, Color4, DirectionalLight, Engine, HemisphericLight, Scene, Vector3,
} from '@babylonjs/core';

/**
 * Involucro Babylon: engine, scena, luci morbide, ombre, fog.
 * I sistemi di gioco si registrano sul loop con onUpdate.
 */
export class GameEngine {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly sun: DirectionalLight;
  readonly ambient: HemisphericLight;
  private updaters: ((dt: number) => void)[] = [];

  constructor(canvas: HTMLCanvasElement) {
    // adaptToDeviceRatio spinto a DPR 3 su iPhone = 3x pixel da disegnare:
    // cappiamo a 2x per un frame rate stabile su mobile.
    this.engine = new Engine(canvas, true, { stencil: true, antialias: true }, false);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.engine.setHardwareScalingLevel(1 / dpr);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.55, 0.8, 0.95, 1);
    // Niente picking al passaggio del puntatore: le collisioni sono nostre.
    this.scene.skipPointerMovePicking = true;

    this.ambient = new HemisphericLight('ambient', new Vector3(0.2, 1, 0.1), this.scene);
    this.ambient.intensity = 0.9;
    this.ambient.diffuse = new Color3(1, 0.98, 0.92);
    this.ambient.groundColor = new Color3(0.45, 0.6, 0.42);

    this.sun = new DirectionalLight('sun', new Vector3(-0.45, -1, 0.55).normalize(), this.scene);
    this.sun.intensity = 1.15;
    this.sun.diffuse = new Color3(1, 0.96, 0.85);
    // Fog atmosferica leggera per la profondità.
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.0020;
    this.scene.fogColor = new Color3(0.78, 0.89, 0.95);

    this.engine.runRenderLoop(() => {
      const dt = Math.min(this.engine.getDeltaTime() / 1000, 1 / 15);
      for (const fn of this.updaters) fn(dt);
      this.scene.render();
    });
    // Rotazione mobile: iOS può notificare il resize in ritardo o non
    // notificarlo affatto; osserviamo il canvas stesso e ridimensioniamo
    // anche con un secondo passaggio ritardato.
    const resizeNow = () => this.engine.resize();
    const resizeSoon = () => {
      resizeNow();
      setTimeout(resizeNow, 120);
      setTimeout(resizeNow, 400);
    };
    window.addEventListener('resize', resizeSoon);
    window.addEventListener('orientationchange', resizeSoon);
    window.visualViewport?.addEventListener('resize', resizeSoon);
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(resizeSoon).observe(canvas);
    }
  }

  onUpdate(fn: (dt: number) => void): () => void {
    this.updaters.push(fn);
    return () => { this.updaters = this.updaters.filter((f) => f !== fn); };
  }

  /** Applica l'atmosfera del tema (luci, fog, colore di fondo). */
  applyLighting(l: {
    ambientIntensity: number; ambientColor: string; groundColor: string;
    sunIntensity: number; sunColor: string;
    fogColor: string; fogDensity: number; clearColor: string;
  }): void {
    this.ambient.intensity = l.ambientIntensity;
    this.ambient.diffuse = Color3.FromHexString(l.ambientColor);
    this.ambient.groundColor = Color3.FromHexString(l.groundColor);
    this.sun.intensity = l.sunIntensity;
    this.sun.diffuse = Color3.FromHexString(l.sunColor);
    this.scene.fogColor = Color3.FromHexString(l.fogColor);
    this.scene.fogDensity = l.fogDensity;
    const cc = Color3.FromHexString(l.clearColor);
    this.scene.clearColor = new Color4(cc.r, cc.g, cc.b, 1);
  }

}
