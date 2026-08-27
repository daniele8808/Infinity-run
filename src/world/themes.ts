import type { Scene } from '@babylonjs/core';
import type { TrackSystem } from '../track/TrackSystem';
import type { TrackPalette } from '../track/TrackBuilder';
import { ForestTheme, FOREST_PALETTE } from './ForestTheme';

/** Contratto di un tema: ambiente completo costruito attorno al percorso. */
export interface Theme {
  build(): Promise<void>;
  update(dt: number, playerPos: { x: number; y: number; z: number }): void;
}

export interface ThemeDefinition {
  create(scene: Scene, track: TrackSystem, assetPath: string): Theme;
  palette: TrackPalette;
}

/**
 * Registro dei temi: per aggiungerne uno (space, city, desert, snow…)
 * si implementa il contratto Theme e lo si registra qui; il config
 * environment.theme seleziona quale usare senza toccare il gameplay.
 */
export const THEMES: Record<string, ThemeDefinition> = {
  forest: {
    create: (scene, track, assetPath) => new ForestTheme(scene, track, assetPath),
    palette: FOREST_PALETTE,
  },
};

export function resolveTheme(name: string): ThemeDefinition {
  return THEMES[name] ?? THEMES.forest;
}
