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
 *   day  → une vague par heure, jusqu'à 23 h (fenêtre 60 min) ;
 *   days → une vague par heure, N jours de suite (fenêtre 60 min).
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
  /** Mode journée mais moins de 2 h avant 23 h. */
  | 'late'
  /** Plusieurs jours sans « pas d'envoi la nuit » : des vagues partiront la nuit. */
  | 'night'
  /** Le plafond du jour coupe une journée : le reste repart le lendemain. */
  | 'dayCap'
  /** Le plan s'étale sur 3 jours ou plus : le message doit rester d'actualité. */
  | 'stale'
  /** Le plan déborde du cadre demandé (journée → lendemain, N jours → N+k). */
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

/** Heures pleines entre `from` et 23 h le même jour (au moins 1). */
function hoursUntilNight(from: Date): number {
  const end = atHour(from, ACTIVE_DAY_END_HOUR);
  return Math.max(1, Math.floor((end.getTime() - from.getTime()) / HOUR));
}

/**
 * Cadre choisi (mode, jours, départ) → plafond par fenêtre qui le tient.
 * C'est la « proposition » de l'écran ; le pro peut la remplacer.
 */
export function suggestRate(input: Pick<PlanInput, 'total' | 'start' | 'mode' | 'days' | 'quietHours'>): number {
  const total = Math.max(0, Math.floor(input.total));
  if (total === 0) return MIN_RATE;
  if (input.mode === 'hour') return Math.max(MIN_RATE, Math.ceil(total / 4));

  const first = input.quietHours ? skipNight(input.start) : input.start;
  const firstDayHours = hoursUntilNight(first);
  if (input.mode === 'day') return Math.max(MIN_RATE, Math.ceil(total / firstDayHours));

  const days = Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.floor(input.days || MIN_DAYS)));
  const perDay = input.quietHours ? ACTIVE_DAY_END_HOUR - ACTIVE_DAY_START_HOUR : 24;
  const hours = firstDayHours + (days - 1) * perDay;
  return Math.max(MIN_RATE, Math.ceil(total / hours));
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
  if (input.mode === 'day' && hoursUntilNight(input.quietHours ? skipNight(input.start) : input.start) < 2 && total >= SMALL_AUDIENCE) {
    warnings.add('late');
  }
  if (input.mode === 'days' && !input.quietHours) warnings.add('night');
  if (spanDays >= 3) warnings.add('stale');
  if (input.mode === 'hour' && endAt && endAt.getTime() - input.start.getTime() > HOUR) warnings.add('longer');
  if (input.mode === 'day' && spanDays > 1) warnings.add('longer');
  if (input.mode === 'days' && spanDays > Math.min(MAX_DAYS, Math.max(MIN_DAYS, input.days))) warnings.add('longer');

  return { windowMinutes, rate, suggestedRate, waves, days, endAt, spanDays, warnings: [...warnings] };
}
