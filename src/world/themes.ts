import { Color3, Scene } from '@babylonjs/core';
import type { TrackSystem } from '../track/TrackSystem';
import type { TrackPalette } from '../track/TrackBuilder';
import { ForestTheme, FOREST_PALETTE, DAY_VARIANT, NIGHT_VARIANT } from './ForestTheme';

/** Contratto di un tema: ambiente completo costruito attorno al percorso. */
export interface Theme {
  build(): Promise<void>;
  update(dt: number, playerPos: { x: number; y: number; z: number }, playerD?: number): void;
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
  gapGlow: Color3.FromHexString('#66e0ff'),
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
      ambientIntensity: 0.78, ambientColor: '#b4c2ff', groundColor: '#2a3358',
      sunIntensity: 0.6, sunColor: '#c4d6ff',
      fogColor: '#1a2348', fogDensity: 0.0012, clearColor: '#0a0f26',
    },
  },
};

export function resolveTheme(name: string): ThemeDefinition {
  return THEMES[name] ?? THEMES.forest;
}
