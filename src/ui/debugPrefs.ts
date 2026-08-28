/**
 * Preferenze degli strumenti di debug (badge FPS, esplora mappa),
 * modificabili dalla pagina impostazioni protetta e persistite sul device.
 */
export interface DebugPrefs {
  fps: boolean;
}

const KEY = 'ir_debug_prefs';

export function loadDebugPrefs(defaultOn: boolean): DebugPrefs {
  const base: DebugPrefs = { fps: defaultOn };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...base, ...JSON.parse(raw) as Partial<DebugPrefs> };
  } catch { /* storage non disponibile: si usano i default del config */ }
  return base;
}

export function saveDebugPrefs(p: DebugPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* best effort */ }
}
