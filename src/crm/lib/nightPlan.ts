/**
 * Plans de soirée (migration 20261122100000) : les règles pures de l'écran.
 * Le serveur décide (crm_night_plan_launch, _crm_night_plan_filter) ; ce
 * fichier ne fait que les MONTRER avant le lancement, avec les mêmes chiffres
 * (crm_night_plan_rules). Testé dans __tests__/nightPlan.test.ts.
 */
import type { CrmTemplateKind } from '@/crm/lib/emailTemplates';

export interface NightPlanRules {
  spacing_h: number; last_spacing_h: number;
  cap_short: number; cap_long: number; short_days: number;
  lead_min: number; stagger_min: number; end_margin_h: number;
}

/** Miroir de crm_night_plan_rules() (à garder identique, testé). */
export const NIGHT_PLAN_RULES: NightPlanRules = {
  spacing_h: 36, last_spacing_h: 20,
  cap_short: 2, cap_long: 3, short_days: 7,
  lead_min: 120, stagger_min: 15, end_margin_h: 2,
};

/** Le modèle de la Console qui sert de brouillon à chaque audience (son angle). */
export const TEMPLATE_FOR_AUDIENCE: Record<string, CrmTemplateKind> = {
  early: 'annonce',
  concept: 'lineup',
  lineup: 'lineup',
  genre: 'annonce',
  once_local: 'retour',
  last_minute: 'lastcall',
  likely: 'annonce',
};

export function templateFor(audience: string): CrmTemplateKind {
  return TEMPLATE_FOR_AUDIENCE[audience] ?? 'annonce';
}

/** Au plus N e-mails du plan par personne : 2 si la soirée est à moins de 7 jours, 3 sinon. */
export function capFor(daysLeft: number, r: NightPlanRules = NIGHT_PLAN_RULES): number {
  return daysLeft < r.short_days ? r.cap_short : r.cap_long;
}

export interface PlannedAudience { key: string; moment: string; send_at: string; order?: number }
export interface PlannedSend { key: string; moment: string; at: Date; late: boolean }

/**
 * Les heures de départ telles que le serveur les posera : au plus tôt 2 h après
 * le lancement, 15 min d'écart entre deux audiences d'un même moment, dans
 * l'ordre conseillé ; jamais dans les 2 h avant le début (`late`).
 */
export function scheduleFor(auds: PlannedAudience[], startAt: string, now: Date = new Date(), r: NightPlanRules = NIGHT_PLAN_RULES): PlannedSend[] {
  const sorted = [...auds].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const lead = now.getTime() + r.lead_min * 60_000;
  const limit = new Date(startAt).getTime() - r.end_margin_h * 3_600_000;
  let prev: string | null = null;
  let k = 0;
  return sorted.map((a) => {
    if (a.moment !== prev) { k = 0; prev = a.moment; } else { k += 1; }
    const t = Math.max(new Date(a.send_at).getTime(), lead) + r.stagger_min * 60_000 * k;
    return { key: a.key, moment: a.moment, at: new Date(t), late: t > limit };
  });
}

/** Raison d'une personne écartée par le plan ou par les règles Yuno → clé de texte. */
export function protectedKey(reason: string): string {
  switch (reason) {
    case 'plan_holder': case 'plan_holder_after_queue': return 'holder';
    case 'plan_cap': return 'cap';
    case 'plan_spacing': return 'spacing';
    case 'suppressed': case 'suppressed_after_queue': return 'suppressed';
    case 'opted_out_after_queue': return 'optout';
    case 'pressure_24h': case 'pressure_7d': case 'fatigue': case 'averse': return 'pressure';
    default: return 'other';
  }
}

/** Les raisons regroupées comme l'écran les dit. */
export function groupProtected(p: Record<string, number> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(p ?? {})) {
    const g = protectedKey(k);
    out[g] = (out[g] ?? 0) + (Number(v) || 0);
  }
  return out;
}
