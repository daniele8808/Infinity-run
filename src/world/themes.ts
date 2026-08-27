import { Color3, Scene } from '@babylonjs/core';
import type { TrackSystem } from '../track/TrackSystem';
import type { TrackPalette } from '../track/TrackBuilder';
import { ForestTheme, FOREST_PALETTE, DAY_VARIANT, NIGHT_VARIANT } from './ForestTheme';

/** Contratto di un tema: ambiente completo costruito attorno al percorso. */
export interface Theme {
  build(): Promise<void>;
  update(dt: number, playerPos: { x: number; y: number; z: number }): void;
}

/** Illuminazione/atmosfera applicata dal GameController alla scena. */
export interface ThemeLighting {
  ambientIntensity: number;
  ambientColor: string;
  groundColor: string;
  sunIntensity: number;
  sunColor: string;
  fogColor: string;
  fogDensity: number;
  clearColor: string;
}

export interface ThemeDefinition {
  create(scene: Scene, track: TrackSystem, assetPath: string): Theme;
  palette: TrackPalette;
  lighting: ThemeLighting;
}

const NIGHT_PALETTE: TrackPalette = {
  road: Color3.FromHexString('#8a8fae'),
  roadAlt: Color3.FromHexString('#7d82a0'),
  edge: Color3.FromHexString('#666b8a'),
  skirt: Color3.FromHexString('#43486a'),
  bridge: Color3.FromHexString('#5d4a72'),
  rail: Color3.FromHexString('#3b3253'),
  canyonRock: Color3.FromHexString('#525a80'),
  water: Color3.FromHexString('#3a6fd8'),
};

/**
 * Registro dei temi: per aggiungerne uno (space, city, desert, snow…)
 * si implementa il contratto Theme e lo si registra qui; il config
 * environment.theme seleziona quale usare senza toccare il gameplay.
 */
export const THEMES: Record<string, ThemeDefinition> = {
  forest: {
    create: (scene, track, assetPath) => new ForestTheme(scene, track, assetPath, DAY_VARIANT),
    palette: FOREST_PALETTE,
    lighting: {
      ambientIntensity: 0.9, ambientColor: '#fffae8', groundColor: '#739a6b',
      sunIntensity: 1.15, sunColor: '#fff3d6',
      fogColor: '#c7e3f2', fogDensity: 0.002, clearColor: '#8ccbf2',
    },
  },
  'magic-forest': {
    create: (scene, track, assetPath) => new ForestTheme(scene, track, assetPath, NIGHT_VARIANT),
    palette: NIGHT_PALETTE,
    lighting: {
      ambientIntensity: 0.62, ambientColor: '#a9b8ff', groundColor: '#1c2340',
      sunIntensity: 0.55, sunColor: '#bcd0ff',
      fogColor: '#101736', fogDensity: 0.0028, clearColor: '#0a0f26',
    },
  },
};

export function resolveTheme(name: string): ThemeDefinition {
  return THEMES[name] ?? THEMES.forest;
}
