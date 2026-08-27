import type { LevelConfig, MovementConfig, SegmentKind } from '../config/types';
import { createRng, pick } from '../core/rng';

/** Un segmento pianificato del percorso, con lunghezza in metri. */
export interface PlannedSegment {
  kind: SegmentKind;
  length: number;
  /** Delta di direzione (rad) per le curve. */
  yawDelta: number;
  /** Delta di quota (m) per salite/discese. */
  elevDelta: number;
  /** Larghezza della strada in questo segmento (m). */
  width: number;
  /** Distanza d di inizio (compilata in seguito). */
  startD: number;
  /** Indice checkpoint (solo kind='checkpoint'). */
  checkpointIndex?: number;
}

/**
 * Genera la ricetta del livello: procedurale ma CONTROLLATA (seed fisso,
 * struttura in quattro fasi di difficoltà, checkpoint alle frazioni richieste).
 * La lunghezza totale è dimensionata su durata x velocità media.
 */
export function planLevel(level: LevelConfig, movement: MovementConfig): PlannedSegment[] {
  const rng = createRng(level.seed);
  const W = level.trackWidth;

  // Velocità media stimata dalla rampa.
  const ramp = movement.speedRamp;
  let avgMult = 0;
  for (let t = 0; t < level.duration; t += 1) {
    let m = ramp[0][1];
    for (const [time, mult] of ramp) if (t >= time) m = mult;
    avgMult += m;
  }
  avgMult /= level.duration;
  const targetLength = movement.baseSpeed * avgMult * level.duration;

  let plan: PlannedSegment[];
  if (level.layout !== 'auto') {
    plan = level.layout.map((kind) => makeSegment(kind, rng, W));
  } else {
    plan = autoPlan(level, rng, W, targetLength);
  }

  // Scala le lunghezze per centrare la durata target (checkpoint/finish esclusi).
  const fixed = plan.filter((s) => s.kind === 'checkpoint' || s.kind === 'finish');
  const flexible = plan.filter((s) => !fixed.includes(s));
  const fixedLen = fixed.reduce((a, s) => a + s.length, 0);
  const flexLen = flexible.reduce((a, s) => a + s.length, 0);
  const scale = Math.max(0.5, (targetLength - fixedLen) / flexLen);
  for (const s of flexible) s.length = Math.round(s.length * scale);

  // Compila startD.
  let d = 0;
  for (const s of plan) { s.startD = d; d += s.length; }
  return plan;
}

function makeSegment(kind: SegmentKind, rng: () => number, W: number): PlannedSegment {
  const seg: PlannedSegment = { kind, length: 60, yawDelta: 0, elevDelta: 0, width: W, startD: 0 };
  switch (kind) {
    case 'straight': seg.length = 50 + rng() * 30; break;
    case 'coin-area': seg.length = 55 + rng() * 25; break;
    case 'curve-left': seg.length = 55 + rng() * 20; seg.yawDelta = +(0.55 + rng() * 0.5); break;
    case 'curve-right': seg.length = 55 + rng() * 20; seg.yawDelta = -(0.55 + rng() * 0.5); break;
    case 'hill-up': seg.length = 55 + rng() * 20; seg.elevDelta = 6 + rng() * 5; break;
    case 'hill-down': seg.length = 55 + rng() * 20; seg.elevDelta = -(6 + rng() * 5); break;
    case 'bridge': seg.length = 40; seg.width = W * 0.62; break;
    case 'gap': seg.length = 34; break;
    case 'narrow': seg.length = 45; seg.width = W * 0.55; break;
    case 'obstacle-area': seg.length = 65 + rng() * 25; break;
    case 'enemy-area': seg.length = 65 + rng() * 25; break;
    case 'powerup-area': seg.length = 40; break;
    case 'checkpoint': seg.length = 16; break;
    case 'canyon': seg.length = 75 + rng() * 25; seg.width = W * 0.7; break;
    case 'final-run': seg.length = 90; break;
    case 'finish': seg.length = 30; break;
  }
  return seg;
}

/** Ricetta a quattro fasi: tutorial -> combinazioni -> ritmo -> gran finale. */
function autoPlan(level: LevelConfig, rng: () => number, W: number, targetLength: number): PlannedSegment[] {
  const mk = (k: SegmentKind) => makeSegment(k, rng, W);
  const plan: PlannedSegment[] = [];
  const curves: SegmentKind[] = ['curve-left', 'curve-right'];
  const hills: SegmentKind[] = ['hill-up', 'hill-down'];

  // Fase 1 (0-25%): tutorial naturale, molte monete, pochi ostacoli.
  plan.push(mk('straight'));
  plan.push(mk('coin-area'));
  plan.push(mk(pick(rng, curves)));
  plan.push(mk('coin-area'));
  plan.push(mk('hill-up'));
  plan.push(mk('powerup-area'));

  // Fase 2 (25-50%): prime combinazioni di ostacoli.
  plan.push(mk('obstacle-area'));
  plan.push(mk(pick(rng, curves)));
  plan.push(mk('bridge'));
  plan.push(mk('coin-area'));
  plan.push(mk('gap'));
  plan.push(mk('hill-down'));
  plan.push(mk('obstacle-area'));

  // Fase 3 (50-75%): nemici, salti, ritmo più alto.
  plan.push(mk('enemy-area'));
  plan.push(mk(pick(rng, curves)));
  plan.push(mk('powerup-area'));
  plan.push(mk('narrow'));
  plan.push(mk('coin-area'));
  plan.push(mk('gap'));
  plan.push(mk(pick(rng, hills)));
  plan.push(mk('enemy-area'));

  // Fase 4 (75-100%): sezione spettacolare, canyon e volata finale.
  plan.push(mk('canyon'));
  plan.push(mk(pick(rng, curves)));
  plan.push(mk('obstacle-area'));
  plan.push(mk('enemy-area'));
  plan.push(mk('bridge'));
  plan.push(mk('coin-area'));
  plan.push(mk('final-run'));
  plan.push(mk('finish'));

  // Inserisce i checkpoint alle frazioni richieste della lunghezza corrente.
  const total = plan.reduce((a, s) => a + s.length, 0);
  let cpIndex = 0;
  for (const frac of level.checkpoints) {
    const targetD = frac * total;
    let acc = 0;
    for (let i = 0; i < plan.length; i++) {
      acc += plan[i].length;
      if (acc >= targetD) {
        const cp = mk('checkpoint');
        cp.checkpointIndex = cpIndex++;
        plan.splice(i + 1, 0, cp);
        break;
      }
    }
  }
  void targetLength;
  return plan;
}
