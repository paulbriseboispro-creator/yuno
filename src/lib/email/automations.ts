// ─────────────────────────────────────────────────────────────────────────────
// Automatisations email — les recettes (client TS).
//
// Une recette = un interrupteur, un délai, un modèle Email Studio, un objet.
// Le moteur (collect_email_automations, cron 5 min) monte une campagne enfant
// par (recette, soirée) et la remplit contact par contact ; tout le ciblage et
// toutes les exclusions vivent en SQL. Ici : la table des recettes que
// l'écran affiche, et les types des RPC de rapport.
// Doctrine : docs/designs/EMAIL_AUTOMATION_PLAN.md.
// ─────────────────────────────────────────────────────────────────────────────

import type { StarterKey } from './starters';

export type AutomationKind =
  | 'welcome' | 'abandoned_checkout' | 'last_call' | 'post_event_thanks' | 'post_event_missed' | 'win_back';

export const AUTOMATION_KINDS: readonly AutomationKind[] = [
  'abandoned_checkout', 'last_call', 'post_event_thanks', 'post_event_missed', 'welcome', 'win_back',
];

/**
 * Recettes qui ont un sens pour Yuno lui-même (portée plateforme, super admin) :
 * pas de « dernier appel » à toute la base pour chaque soirée de chaque club.
 */
export const PLATFORM_AUTOMATION_KINDS: readonly AutomationKind[] = [
  'welcome', 'abandoned_checkout', 'post_event_thanks', 'post_event_missed', 'win_back',
];

export interface AutomationMeta {
  kind: AutomationKind;
  /** Modèle Yuno créé d'un clic quand la recette n'a pas encore de modèle. */
  starter: StarterKey;
  /** Choix de délai proposés, dans l'unité de `unit`. */
  delays: readonly number[];
  defaultDelay: number;
  unit: 'hours' | 'days';
  /** Sens du délai, pour le libellé : après le déclencheur, ou avant le début. */
  direction: 'after' | 'before' | 'dormant';
  /** La recette exige un scan à la porte pour savoir qui est venu. */
  needsScan?: boolean;
}

export const AUTOMATION_META: Record<AutomationKind, AutomationMeta> = {
  abandoned_checkout: { kind: 'abandoned_checkout', starter: 'auto_abandoned_checkout', delays: [1, 2, 4, 12], defaultDelay: 2, unit: 'hours', direction: 'after' },
  last_call: { kind: 'last_call', starter: 'auto_last_call', delays: [12, 24, 48, 72], defaultDelay: 24, unit: 'hours', direction: 'before' },
  post_event_thanks: { kind: 'post_event_thanks', starter: 'auto_post_event_thanks', delays: [6, 12, 24, 48], defaultDelay: 12, unit: 'hours', direction: 'after', needsScan: true },
  post_event_missed: { kind: 'post_event_missed', starter: 'auto_post_event_missed', delays: [12, 24, 48, 72], defaultDelay: 24, unit: 'hours', direction: 'after', needsScan: true },
  welcome: { kind: 'welcome', starter: 'auto_welcome', delays: [1, 6, 24, 48], defaultDelay: 24, unit: 'hours', direction: 'after' },
  win_back: { kind: 'win_back', starter: 'auto_win_back', delays: [45, 60, 90, 120], defaultDelay: 90, unit: 'days', direction: 'dormant' },
};

/** Délai en heures tel que stocké (`email_automations.delay_hours`). */
export function delayToHours(meta: AutomationMeta, value: number): number {
  return meta.unit === 'days' ? value * 24 : value;
}
export function hoursToDelay(meta: AutomationMeta, hours: number): number {
  return meta.unit === 'days' ? Math.round(hours / 24) : hours;
}

/** Ligne `email_automations` telle que lue par l'écran. */
export interface EmailAutomationRow {
  id: string;
  kind: AutomationKind;
  enabled: boolean;
  enabled_at: string | null;
  delay_hours: number;
  template_id: string | null;
  subject: string | null;
}

export type AutomationSkipReason =
  | 'bought' | 'guest_list' | 'unsubscribed' | 'suppressed' | 'no_consent' | 'cooldown' | 'event_over'
  // Règles Yuno (email_send_policy) et « une soirée, un message » entre expéditeurs.
  | 'already_event' | 'pressure_24h' | 'pressure_7d' | 'fatigue' | 'averse';

/** Une entrée de `get_email_automation_stats`. */
export interface AutomationStats {
  id: string;
  kind: AutomationKind;
  enabled: boolean;
  enabled_at: string | null;
  delay_hours: number;
  template_id: string | null;
  subject: string | null;
  /** En file, pas encore posés dans une campagne enfant. */
  pending: number;
  queued: number;
  skipped: Partial<Record<AutomationSkipReason, number>>;
  last_queued_at: string | null;
  campaigns: number;
  sent: number;
  delivered: number;
  opens: number;
  clickers: number;
  unsubscribes: number;
  campaign_ids: string[];
}

/** Réponse de `get_email_send_time_insights`. */
export interface SendTimeInsights {
  sample: number;
  /** 24 entrées, heure de Paris. */
  by_hour: number[];
  /** 7 entrées, lundi = index 0. */
  by_dow: number[];
  best_hour: number | null;
  /** 1 = lundi … 7 = dimanche. */
  best_dow: number | null;
}

/** Réponse de `get_campaign_resend_stats`. */
export interface ResendStats {
  parent_id: string;
  parent_name: string;
  is_child: boolean;
  enabled: boolean;
  delay_hours: number;
  subject: string | null;
  done_at: string | null;
  parent_sent_at: string | null;
  /** Évalué, personne à renvoyer (tout le monde avait ouvert). */
  nobody: boolean;
  child: {
    id: string; name: string; status: string; sent: number; delivered: number;
    opens: number; clicks: number; clickers: number; unsubscribes: number; bounced: number;
  } | null;
}

export const RESEND_DELAYS: readonly number[] = [24, 48, 72];
