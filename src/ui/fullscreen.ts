/** Utility fullscreen/PWA: schermo intero su Android, hint di installazione su iOS. */

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * Da chiamare DENTRO un gesto utente: prova il fullscreen nativo e il blocco
 * orientamento landscape (Android/desktop; iOS Safari non lo supporta:
 * lì il fullscreen vero si ottiene installando la webapp).
 */
export function tryFullscreen(): void {
  if (isStandalone()) return;
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
  };
  const req = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
  if (!req) return;
  Promise.resolve(req()).catch(() => { /* iOS o negato: ok */ });
}

/** Registra il service worker (cache offline + requisito installazione PWA). */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  navigator.serviceWorker.register('sw.js').catch(() => { /* non bloccante */ });
}
