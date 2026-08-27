# Infinity Run — Framework white-label per branded 3D runner

Un **on-rails runner 3D in terza persona** pensato come piattaforma riutilizzabile:
per ogni cliente si sostituiscono personaggio, ambientazione, collectible, nemici,
loghi, colori e audio — la meccanica di gioco resta identica.

> Demo: valle verde cartoon, esploratore robot, monete dorate, slime cartoon,
> power-up Scudo/Magnete/Punti x2, portali checkpoint, ~3,5 minuti di corsa
> con vero inizio, progressione e traguardo.

## Avvio rapido

```bash
npm install
npm run dev        # sviluppo su http://localhost:5173
npm run build      # build di produzione in dist/
npm run preview    # anteprima della build
```

**Stack:** Babylon.js · TypeScript · Vite · asset GLB/GLTF (animazioni embedded) · WebAudio.

## Personalizzazione white-label

Tutto il branding vive in **`public/game-config.json`** — nessun asset è
hardcoded nel codice. Si può ridefinire solo ciò che serve (merge sui default):

| Sezione | Cosa controlla |
|---|---|
| `game` | nome, durata |
| `brand` | logo, colori (primario/secondario/accento), font, sfondi UI |
| `character` | file GLB, scala, **mappa animazioni** (nome logico → AnimationGroup) |
| `movement` | velocità base, rampa, salto, double jump, modalità laterale `free`/`lanes` |
| `level` | durata, layout segmenti (`auto` o lista), checkpoint, larghezza strada, seed |
| `environment` | tema (`forest`, …) e cartella asset |
| `collectible` / `powerUps` / `enemy` | modelli, punteggi, durate, power-up abilitati |
| `scoring` / `rules` | punti, combo, vite, invulnerabilità, respawn |
| `audio` | file musica/SFX (fallback: sintesi WebAudio) |
| `leaderboard` | `local` (LocalStorage) o `api` (REST) |
| `strings` | tutti i testi UI (localizzabili) |

### Sostituire il personaggio

1. Esporta un GLB con animazioni embedded (`Idle`, corsa, salto, saluto, hit,
   morte, vittoria — i nomi sono liberi).
2. Copia il file in `public/assets/character/` e aggiorna `character.model`
   e `character.animations` nel config.

### Aggiungere un tema

Implementa il contratto `Theme` (`src/world/themes.ts`), fornisci una
`TrackPalette` e registralo in `THEMES`. Il config `environment.theme`
seleziona il tema senza toccare il gameplay.

### Collegare un backend classifica

`src/leaderboard/Leaderboard.ts` definisce l'interfaccia `LeaderboardProvider`
(`submit`, `top`, `rankOf`). La demo usa LocalStorage; `ApiLeaderboard` è un
client REST minimale pronto per Firebase/Supabase/backend custom
(`leaderboard.provider: "api"` + `apiUrl`).

## Architettura

```
src/
├── config/        tipi + loader del game-config (merge sui default)
├── core/          GameEngine (scena/luci/fog), GameController (flusso), EventBus, asset loader
├── track/         TrackPlan (ricetta livello) → TrackSystem (spline) → TrackBuilder (mesh)
├── world/         registro temi + ForestTheme (cielo, valle, vegetazione, nuvole, uccelli…)
├── character/     CharacterSystem (GLB + crossfade animazioni via mappa nomi)
├── input/         InputSystem astratto (tastiera, touch; predisposto gamepad/arcade)
├── gameplay/      RunController, Collectibles, Obstacles, Enemies, PowerUps, Checkpoints, Score
├── camera/        ChaseCamera (anticipo curve, tilt, shake, FOV boost)
├── audio/         AudioSystem (file da config + sintesi WebAudio + musica procedurale)
├── fx/            burst particellari, onde checkpoint, confetti, ombra blob
├── ui/            HUD e schermate DOM (colori brand via CSS variables)
└── leaderboard/   provider astratto + LocalStorage + client REST
```

**Concetti chiave**

- **Coordinate-traccia** `(d, x, y)`: tutto il gameplay vive sulla spline
  (distanza, offset laterale, quota). Collisioni economiche e deterministiche,
  nessun motore fisico necessario.
- **Ricetta procedurale controllata**: il livello è una sequenza di segmenti
  (rettilinei, curve, salite, ponti, voragini, aree nemici/bonus…) generata con
  seed fisso in quattro fasi di difficoltà e dimensionata su durata × velocità.
- **Object pooling / instancing**: un merge per tipo di prop + istanze;
  finestre scorrevoli sulle entità ordinate per `d`.

## Controlli

- **Desktop:** ← → / A D per muoversi, Spazio / ↑ / W per saltare (doppio salto).
- **Mobile:** trascina per muoverti, tocca o swipe-up per saltare.
- L'input è astratto (`InputSource`) per aggiungere gamepad/joystick arcade.

## Deploy

Il workflow `.github/workflows/deploy.yml` pubblica la build su **GitHub Pages**
a ogni push (abilitare Pages → Source: GitHub Actions nelle impostazioni repo).
La build usa percorsi relativi: funziona anche in sottocartelle o kiosk offline.

## Licenze asset

Demo interamente CC0 — dettagli in `public/assets/ATTRIBUTION.md`.
