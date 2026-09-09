/**
 * Plan de lissage d'une campagne — le calcul que l'écran Planification montre
 * AVANT l'envoi (« quand partent combien d'emails »).
 *
 * Le worker `send-campaign` ne connaît qu'un plafond par fenêtre glissante
 * (`throttle_per_hour` sur `throttle_window_minutes`), les heures calmes
 * (23 h → 9 h, opt-in) et le plafond du jour de la rampe de chauffe. Ce module
 * rejoue exactement ces trois règles pour projeter les vagues : ce qui est
 * affiché est ce que le serveur fera, à la cadence du cron près (5 min).
 *
 * Trois modes, un seul moteur :
 *   hour → 4 vagues, une par quart d'heure (fenêtre 15 min) ;
 *   day  → une vague par heure pendant 24 h à partir du départ (fenêtre 60 min) ;
 *   days → une vague par heure pendant N × 24 h à partir du départ.
 * Les fenêtres sont GLISSANTES depuis le départ, jamais calendaires : un
 * envoi lancé à 17 h 30 « sur la journée » finit le lendemain vers 17 h 30,
 * la nuit étant sautée si le pro l'a coupée.
 *
 * Pur, sans I/O : testable et réutilisable (récap, rapport).
 */
import type { ThrottleMode, ThrottlePlan } from './types';

/** Fin de la journée active = début des heures calmes du worker (QUIET_START_HOUR). */
export const ACTIVE_DAY_END_HOUR = 23;
/** Reprise après la nuit = fin des heures calmes du worker (QUIET_END_HOUR). */
export const ACTIVE_DAY_START_HOUR = 9;
/** Plancher du plafond par fenêtre (CHECK `email_campaigns_throttle_check`). */
export const MIN_RATE = 10;
export const MIN_DAYS = 2;
export const MAX_DAYS = 7;
/** En dessous, lisser n'apporte presque rien : tout part en quelques minutes. */
export const SMALL_AUDIENCE = 300;
/** Au-delà de ce volume par jour, on conseille d'étaler sur plusieurs jours. */
const COMFORT_PER_DAY = 2500;
const MAX_WAVES = 4000;

export interface PlanInput {
  /** Destinataires nets (après dédoublonnage et suppression). */
  total: number;
  /** Départ : maintenant, ou la date planifiée. */
  start: Date;
  mode: ThrottleMode;
  /** Mode `days` uniquement. */
  days: number;
  /** « Pas d'envoi la nuit » coché : aucune vague entre 23 h et 9 h. */
  quietHours: boolean;
  /** Plafond par fenêtre choisi par le pro (sinon la proposition). */
  rate?: number | null;
  /** Plafond du jour de l'expéditeur (rampe de chauffe). 0 / null = inconnu. */
  dayCap?: number | null;
  /** Déjà envoyés aujourd'hui par cet expéditeur. */
  dayUsed?: number;
}

export interface PlanWave { at: Date; count: number }
export interface PlanDay { date: Date; waves: PlanWave[]; count: number }

export type PlanWarning =
  /** Audience sous SMALL_AUDIENCE : le lissage est inutile, pas nuisible. */
  | 'small'
  /** Plusieurs jours sans « pas d'envoi la nuit » : des vagues partiront la nuit. */
  | 'night'
  /** Le plafond du jour coupe une journée : le reste repart le lendemain. */
  | 'dayCap'
  /** Le plan s'étale sur 3 jours ou plus : le message doit rester d'actualité. */
  | 'stale'
  /** Le plan déborde de la fenêtre demandée (1 h, 24 h, N × 24 h depuis le départ). */
  | 'longer';

export interface ThrottlePlanResult {
  windowMinutes: 15 | 60;
  /** Plafond par fenêtre réellement retenu. */
  rate: number;
  /** Ce que Yuno propose pour tenir le cadre (mode, jours). */
  suggestedRate: number;
  waves: PlanWave[];
  days: PlanDay[];
  /** Heure de la dernière vague (null si rien à envoyer). */
  endAt: Date | null;
  /** Nombre de jours calendaires couverts. */
  spanDays: number;
  warnings: PlanWarning[];
}

const HOUR = 3_600_000;

function atHour(d: Date, hour: number): Date {
  const x = new Date(d);
  x.setHours(hour, 0, 0, 0);
  return x;
}

function nextDayAt(d: Date, hour: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + 1);
  x.setHours(hour, 0, 0, 0);
  return x;
}

function isNight(d: Date): boolean {
  const h = d.getHours();
  return h >= ACTIVE_DAY_END_HOUR || h < ACTIVE_DAY_START_HOUR;
}

/** Prochain instant hors des heures calmes (inchangé si déjà de jour). */
function skipNight(d: Date): Date {
  if (!isNight(d)) return d;
  return d.getHours() >= ACTIVE_DAY_END_HOUR ? nextDayAt(d, ACTIVE_DAY_START_HOUR) : atHour(d, ACTIVE_DAY_START_HOUR);
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Vagues horaires disponibles dans une fenêtre de `hours` h à partir de
 * `from`, la nuit sautée si `quietHours` (au moins 1).
 */
function activeHourlySlots(from: Date, hours: number, quietHours: boolean): number {
  const end = from.getTime() + hours * HOUR;
  let n = 0;
  let t = new Date(from);
  while (t.getTime() < end && n < hours) {
    if (quietHours && isNight(t)) { t = skipNight(t); continue; }
    n++;
    t = new Date(t.getTime() + HOUR);
  }
  return Math.max(1, n);
}

/** Fenêtre du cadre choisi, en heures depuis le départ. */
function frameHours(mode: ThrottleMode, days: number): number {
  if (mode === 'hour') return 1;
  if (mode === 'day') return 24;
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.floor(days || MIN_DAYS))) * 24;
}

/**
 * Cadre choisi (mode, jours, départ) → plafond par fenêtre qui le tient.
 * C'est la « proposition » de l'écran ; le pro peut la remplacer.
 */
export function suggestRate(input: Pick<PlanInput, 'total' | 'start' | 'mode' | 'days' | 'quietHours'>): number {
  const total = Math.max(0, Math.floor(input.total));
  if (total === 0) return MIN_RATE;
  if (input.mode === 'hour') return Math.max(MIN_RATE, Math.ceil(total / 4));

  const slots = activeHourlySlots(input.start, frameHours(input.mode, input.days), input.quietHours);
  return Math.max(MIN_RATE, Math.ceil(total / slots));
}

/**
 * Recommandation de cadre selon la taille de l'audience et le plafond du jour.
 * Petit volume → une heure ; volume courant → la journée ; gros volume → assez
 * de jours pour rester sous ~2 500/jour ET sous le plafond de chauffe.
 */
export function recommendPlan(total: number, dayCap?: number | null): ThrottlePlan {
  if (total <= 500) return { mode: 'hour', days: MIN_DAYS };
  if (total <= COMFORT_PER_DAY && (!dayCap || total <= dayCap)) return { mode: 'day', days: MIN_DAYS };
  const byComfort = Math.ceil(total / COMFORT_PER_DAY);
  const byCap = dayCap && dayCap > 0 ? Math.ceil(total / dayCap) : 1;
  const days = Math.min(MAX_DAYS, Math.max(MIN_DAYS, byComfort, byCap));
  return { mode: 'days', days };
}

/** Projette les vagues : quand, combien, avec nuit et plafond du jour. */
export function computeThrottlePlan(input: PlanInput): ThrottlePlanResult {
  const total = Math.max(0, Math.floor(input.total));
  const windowMinutes: 15 | 60 = input.mode === 'hour' ? 15 : 60;
  const suggestedRate = suggestRate(input);
  const rate = Math.max(MIN_RATE, Math.floor(input.rate ?? suggestedRate) || suggestedRate);
  const warnings = new Set<PlanWarning>();
  const dayCap = input.dayCap && input.dayCap > 0 ? Math.floor(input.dayCap) : null;
  const todayKey = dayKey(new Date());

  const waves: PlanWave[] = [];
  let remaining = total;
  let t = new Date(input.start);
  const sentByDay = new Map<string, number>();
  if (dayCap && input.dayUsed) sentByDay.set(todayKey, Math.max(0, Math.floor(input.dayUsed)));

  while (remaining > 0 && waves.length < MAX_WAVES) {
    if (input.quietHours) t = skipNight(t);
    const key = dayKey(t);
    let n = Math.min(rate, remaining);
    if (dayCap) {
      const left = dayCap - (sentByDay.get(key) || 0);
      if (left <= 0) {
        warnings.add('dayCap');
        t = nextDayAt(t, input.quietHours ? ACTIVE_DAY_START_HOUR : 0);
        continue;
      }
      n = Math.min(n, left);
    }
    waves.push({ at: new Date(t), count: n });
    sentByDay.set(key, (sentByDay.get(key) || 0) + n);
    remaining -= n;
    t = new Date(t.getTime() + windowMinutes * 60_000);
  }

  const days: PlanDay[] = [];
  for (const w of waves) {
    const last = days[days.length - 1];
    if (last && dayKey(last.date) === dayKey(w.at)) {
      last.waves.push(w);
      last.count += w.count;
    } else {
      days.push({ date: atHour(w.at, 0), waves: [w], count: w.count });
    }
  }

  const endAt = waves.length ? waves[waves.length - 1].at : null;
  const spanDays = days.length;

  if (total > 0 && total < SMALL_AUDIENCE) warnings.add('small');
  if (input.mode !== 'hour' && !input.quietHours) warnings.add('night');
  if (spanDays >= 3) warnings.add('stale');
  // Déborde de la fenêtre : la dernière vague part après départ + cadre
  // (la nuit sautée compte dans la fenêtre : c'est le pro qui l'a coupée).
  const frameEnd = input.start.getTime() + frameHours(input.mode, input.days) * HOUR;
  if (endAt && endAt.getTime() >= frameEnd) warnings.add('longer');

  return { windowMinutes, rate, suggestedRate, waves, days, endAt, spanDays, warnings: [...warnings] };
}
