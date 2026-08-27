# Roadmap — Prossimi step per completare il gioco

Stato attuale: demo giocabile completa (intro → corsa → traguardo → risultati → classifica),
tema forest, config white-label, deploy GitHub Pages. Qui sotto i passi per portarla
a prodotto finito, in ordine di priorità consigliato.

## 1. Game feel & rifiniture gameplay (priorità alta)

- [ ] **Tuning della difficoltà con playtest reali**: velocità base, ampiezza voragini,
      densità ostacoli per fase — provare con 3-4 persone che non hanno mai giocato
- [ ] **Coyote time e input buffering** sul salto (salto premuto poco prima/dopo il bordo
      deve funzionare: fondamentale per il pubblico casual degli eventi)
- [ ] **Telecamera nei momenti chiave**: leggera zoomata al take del power-up,
      slow-motion di 0,3 s all'ultimo checkpoint, camera dedicata al traguardo
- [ ] **Animazioni di transizione**: stumble sugli ostacoli bassi (ora si usa "hit"),
      atterraggio dedicato dopo i salti alti
- [ ] **Tutorial contestuale**: primo ostacolo/prima voragine con hint "SALTA!" a schermo
- [ ] **Pausa** (tasto ESC / icona touch) con ripresa via countdown

## 2. Contenuto demo (priorità alta)

- [ ] **Nemici con GLB animati** al posto degli slime procedurali (o in aggiunta):
      2-3 varianti con animazioni idle/walk
- [ ] **Power-up mancanti nel level design**: Turbo, Super Salto e Invincibilità sono
      già implementati ma non distribuiti nella demo (`powerUps.enabled` nel config)
- [ ] **Varietà visiva del percorso**: cascate, corsi d'acqua che attraversano la valle,
      archi di roccia, staccionate lungo i rettilinei
- [ ] **Musica su file** (traccia loop professionale) al posto della musica procedurale
- [ ] **SFX aggiuntivi**: passi, vento in velocità, ambiente (uccellini, fruscii)

## 3. Sistema temi (priorità media)

- [ ] Estrarre da `ForestTheme` una base riutilizzabile (skybox, scatter, particellari)
- [ ] **Tema Space**: skybox stellato, pianeti, cristalli al posto degli alberi, nebbie viola
- [ ] **Tema Desert/Snow**: il nature pack include già le varianti `_autumn` e `_snow`
      dei modelli — gran parte del lavoro è palette + luci
- [ ] Definire i temi via JSON (`/themes/<nome>/theme.json`: palette, luci, fog,
      lista prop con pesi) così un tema nuovo non richiede codice

## 4. Configuratore visuale (priorità media)

- [ ] Pagina `/admin` con editor live del `game-config.json`:
      color picker per il brand, upload logo, upload GLB personaggio con
      auto-rilevamento delle AnimationGroup e mappatura guidata
- [ ] Anteprima in tempo reale (il gioco gira in un iframe e ricarica il config)
- [ ] Export/import del config + pacchetto asset per cliente

## 5. Backend classifica & eventi (priorità media)

- [ ] Implementazione `ApiLeaderboard` contro un backend reale
      (Supabase è la via più rapida: tabella `scores` + RLS + edge function per il rank)
- [ ] **Modalità evento**: `eventId` nel config, classifica filtrata per evento,
      reset a inizio giornata, schermata "classifica live" da proiettare
- [ ] Moderazione nickname (blocklist parole) e rate-limiting submit
- [ ] QR code a fine partita per rivedere il proprio punteggio sul telefono

## 6. Mobile & arcade (priorità alta per gli eventi)

- [ ] **Test su dispositivi reali** (iPhone Safari, Android Chrome): performance,
      fullscreen, blocco orientamento, `navigator.vibrate` sugli impatti
- [ ] PWA (manifest + service worker) per installazione e uso offline in kiosk
- [ ] **Supporto gamepad** via Gamepad API (l'input è già astratto: serve solo
      una `GamepadSource`) — copre anche i cabinet arcade con encoder USB
- [ ] Modalità kiosk: attract mode (video/demo loop quando nessuno gioca),
      timeout di inattività che torna alla schermata nome

## 7. Performance (continuo)

- [ ] Profiling su hardware medio-basso: draw calls, thin instances per la vegetazione
      se servisse (ora: istanze normali, 1 draw per tipo)
- [ ] Frustum/distance culling dei prop lontani (chunking per range di `d`)
- [ ] Texture compresse (KTX2/Basis) e LOD per i modelli più pesanti
- [ ] Qualità adattiva: riduzione risoluzione di rendering se il frame time sale

## 8. QA & robustezza

- [ ] Suite Playwright automatica in CI (il flusso di test usato in sviluppo è già
      riproducibile: boot → nome → intro → corsa → warp → risultati)
- [ ] Gestione WebGL context lost, tab in background (pausa automatica)
- [ ] Test resize/orientamento a runtime, safe-area su notch iOS
- [ ] Error tracking (Sentry o simile) per le installazioni agli eventi

## 9. Pipeline white-label (obiettivo commerciale)

- [ ] Repo template + script `create-client.sh` che genera la cartella cliente
      (config + assets) e builda in `dist/<cliente>/`
- [ ] Documento "onboarding cliente": checklist asset richiesti (GLB personaggio
      con lista animazioni, logo SVG/PNG, palette, audio), tempi e formati
- [ ] 2-3 demo tematizzate pronte da mostrare in trattativa (forest / space / brand fittizio)

---

**Regola d'oro**: ogni feature nuova deve restare guidata da `game-config.json` —
se per personalizzarla serve toccare il codice, non è pronta per il white-label.
