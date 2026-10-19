/**
 * Premiers pas : le modèle du guide des premiers pas d'un compte CRM
 * (docs/designs/CRM_FIRST_STEPS_PLAN.md). Pur et testé : l'état vient de la
 * RPC crm_first_steps, qui relit chaque étape dans la base ; ici on ne fait que
 * l'ordonner, dire laquelle est la prochaine et quand le guide se montre.
 *
 * Règles tirées de la recherche du 19/10 : cinq étapes au plus (plus « Votre
 * espace est ouvert », déjà cochée), chacune une action, cochée par les vraies
 * données ; jamais une serrure (toute étape s'ouvre à tout moment) ; le guide se
 * masque, se reporte et se rouvre, et ne se rejoue jamais tout seul.
 */
import { CRM_ROUTES } from '@/crm/shell/nav';

export type FirstStepKey = 'shotgun' | 'identity' | 'email' | 'automation' | 'claude' | 'segments' | 'team';

/** Les cinq étapes qui comptent dans la barre, dans l'ordre conseillé. */
export const CORE_STEPS = ['shotgun', 'identity', 'email', 'automation', 'claude'] as const satisfies readonly FirstStepKey[];
/** « Pour aller plus loin » : facultatives, repliées, hors de la barre. */
export const EXTRA_STEPS = ['segments', 'team'] as const satisfies readonly FirstStepKey[];

/** Âge du compte CRM au-delà duquel le guide ne s'affiche plus d'office. */
export const AUTO_SHOW_DAYS = 60;

export interface FirstStepsData {
  now: string;
  steps: {
    shotgun: { done: boolean; state: 'off' | 'importing' | 'on' | 'broken'; org: string | null; tickets: number | null; events: number | null; buyers: number | null };
    identity: { done: boolean; missing: string[] };
    email: { done: boolean; n: number; draft: { id: string; name: string | null; updated_at: string } | null };
    automation: { done: boolean; recipes: number; scenarios: number };
    claude: { done: boolean };
    segments: { done: boolean; n: number };
    team: { done: boolean; n: number };
  };
  /** Acheteurs venus d'un e-mail Yuno, une fois un premier e-mail parti. */
  outcome: { buyers: number } | null;
  next_night: { id: string; title: string | null; start_at: string; days_to: number } | null;
  offer: { status: string; offer: string | null; offer_until: string | null; trial_ends_at: string | null } | null;
  opened_at: string | null;
  yunits: number;
  holder: { is_me: boolean; first_name: string | null };
  pref: { dismissed_at: string | null; snoozed_until: string | null; finished_at: string | null };
}

export type StepStatus = 'done' | 'running' | 'broken' | 'todo';

export interface GuideStep {
  key: FirstStepKey;
  core: boolean;
  status: StepStatus;
  /** Seul le titulaire du compte peut la faire (Shotgun, l'équipe). */
  holderOnly: boolean;
  /** La personne qui regarde ne peut pas la faire elle-même. */
  notMine: boolean;
  /** Durée annoncée, en minutes. */
  minutes: number;
  /** Où mène le bouton de l'étape. */
  href: string;
  /** Repère `data-yc-guide` de l'élément à montrer sur la page de l'étape. */
  target: string;
}

export interface GuideCaps {
  /** La personne est titulaire de l'espace. */
  holder: boolean;
  /** Elle peut écrire (campagnes, recettes, segments). */
  write: boolean;
}

const MINUTES: Record<FirstStepKey, number> = { shotgun: 3, identity: 2, email: 10, automation: 2, claude: 2, segments: 1, team: 1 };
const HOLDER_ONLY: Record<FirstStepKey, boolean> = { shotgun: true, identity: false, email: false, automation: false, claude: false, segments: false, team: true };
const TARGET: Record<FirstStepKey, string> = {
  shotgun: 'shotgun-connect', identity: 'sender-identity', email: 'email-templates', automation: 'automation-recos',
  claude: 'claude-add', segments: 'segments-new', team: 'team-invite',
};

/** Le premier e-mail : la galerie de modèles, déjà reliée à la prochaine soirée ; un brouillon se reprend. */
export function emailHref(d: FirstStepsData): string {
  const draft = d.steps.email.draft;
  if (!d.steps.email.done && draft) return CRM_ROUTES.emailStudio(draft.id);
  return d.next_night ? `${CRM_ROUTES.emailTemplates}?event=${encodeURIComponent(d.next_night.id)}` : CRM_ROUTES.emailTemplates;
}

export function stepHref(key: FirstStepKey, d: FirstStepsData): string {
  switch (key) {
    case 'shotgun': return d.steps.shotgun.state === 'off' ? `${CRM_ROUTES.connectors}?v=wizard&s=1` : CRM_ROUTES.connectors;
    case 'identity': return CRM_ROUTES.emailSettings;
    case 'email': return emailHref(d);
    case 'automation': return CRM_ROUTES.automations;
    case 'claude': return `${CRM_ROUTES.connectors}?v=claude`;
    case 'segments': return `${CRM_ROUTES.segments}?new=rec`;
    case 'team': return `${CRM_ROUTES.accountSection('team')}?invite=1`;
  }
}

/** Les pages où l'aide d'une étape a un sens (la carte compacte s'y montre). */
export function stepPaths(key: FirstStepKey): string[] {
  switch (key) {
    case 'shotgun': case 'claude': return [CRM_ROUTES.connectors];
    case 'identity': return [CRM_ROUTES.emailSettings];
    case 'email': return [CRM_ROUTES.emailTemplates, CRM_ROUTES.emailCampaigns, CRM_ROUTES.emails];
    case 'automation': return [CRM_ROUTES.automations];
    case 'segments': return [CRM_ROUTES.segments];
    case 'team': return [CRM_ROUTES.accountSection('team')];
  }
}

export function onStepPage(key: FirstStepKey, pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '');
  return stepPaths(key).some((x) => p === x || p.startsWith(`${x}/`));
}

function statusOf(key: FirstStepKey, d: FirstStepsData): StepStatus {
  if (key === 'shotgun') {
    const s = d.steps.shotgun.state;
    if (s === 'broken') return 'broken';
    if (s === 'importing') return 'running';
    return s === 'on' ? 'done' : 'todo';
  }
  return d.steps[key].done ? 'done' : 'todo';
}

export function buildSteps(d: FirstStepsData, caps: GuideCaps): GuideStep[] {
  const make = (key: FirstStepKey, core: boolean): GuideStep => ({
    key,
    core,
    status: statusOf(key, d),
    holderOnly: HOLDER_ONLY[key],
    notMine: HOLDER_ONLY[key] ? !caps.holder : !caps.write && key !== 'claude',
    minutes: MINUTES[key],
    href: stepHref(key, d),
    target: TARGET[key],
  });
  return [...CORE_STEPS.map((k) => make(k, true)), ...EXTRA_STEPS.map((k) => make(k, false))];
}

/** Une étape compte comme faite dans la barre ; un import en cours vaut connexion faite. */
export const isDone = (s: GuideStep) => s.status === 'done' || s.status === 'running';

/**
 * Progression de la barre : « Votre espace est ouvert » est offerte (le compte
 * existe), puis les cinq étapes. 1 sur 6 au premier jour, jamais 0.
 */
export function progressOf(steps: GuideStep[]): { done: number; total: number } {
  const core = steps.filter((s) => s.core);
  return { done: 1 + core.filter(isDone).length, total: 1 + core.length };
}

export const allCoreDone = (steps: GuideStep[]) => steps.filter((s) => s.core).every(isDone);

/**
 * La prochaine étape : la première non faite que la personne peut faire ;
 * à défaut (un membre de l'équipe qui attend le titulaire), la première non faite.
 */
export function nextStep(steps: GuideStep[]): GuideStep | null {
  const open = steps.filter((s) => s.core && !isDone(s));
  return open.find((s) => !s.notMine) ?? open[0] ?? null;
}

/** L'étape qui suit `key` dans l'ordre conseillé, encore à faire et faisable. */
export function stepAfter(steps: GuideStep[], key: FirstStepKey): GuideStep | null {
  const order = steps.filter((s) => s.core);
  const i = order.findIndex((s) => s.key === key);
  const rest = [...order.slice(i + 1), ...order.slice(0, Math.max(i, 0))];
  return rest.find((s) => !isDone(s) && !s.notMine) ?? null;
}

export interface GuideContext {
  holder: boolean;
  write: boolean;
  /** Aperçu démo, accès assisté ou compte démo : jamais d'office, rien d'enregistré. */
  passive: boolean;
  now?: Date;
}

/**
 * Le guide s'affiche-t-il d'office (carte de l'Accueil, entrée du menu) ?
 * Le titulaire seul, sur un compte de moins de 60 jours, tant qu'il ne l'a ni
 * masqué, ni reporté, ni terminé. Les autres l'ouvrent depuis Aide.
 */
export function autoShow(d: FirstStepsData, ctx: GuideContext): boolean {
  if (!ctx.holder || ctx.passive) return false;
  const now = ctx.now ?? new Date(d.now);
  const p = d.pref;
  if (p.dismissed_at || p.finished_at) return false;
  if (p.snoozed_until && new Date(p.snoozed_until) > now) return false;
  if (d.opened_at && now.getTime() - new Date(d.opened_at).getTime() > AUTO_SHOW_DAYS * 86_400_000) return false;
  return true;
}

/** Qui peut ouvrir le guide (depuis Aide ou le menu du profil) : tout le monde sauf un lecteur. */
export const canOpenGuide = (ctx: Pick<GuideContext, 'holder' | 'write'>) => ctx.holder || ctx.write;

/** Fondateur : l'offre est-elle encore offerte ? */
export function founderUntil(d: FirstStepsData, now = new Date(d.now)): string | null {
  const o = d.offer;
  if (!o || o.offer !== 'founder' || !o.offer_until) return null;
  return new Date(o.offer_until) > now ? o.offer_until : null;
}
