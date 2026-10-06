/**
 * Ligne `email_campaigns` ⇄ campagne de travail du Studio. Partagé par
 * l'Email Studio de la Suite et celui de la Console CRM : les deux lisent et
 * écrivent une campagne exactement de la même façon.
 */
import {
  migrateV1Audience, migrateV1Blocks, migrateV1SocialLinks, migrateV1Theme, normalizeTheme, normalizeV2Blocks,
  type AudienceExclusions, type AudienceSel, type EmailBlock, type SocialLinks, type StudioCampaign, type ThrottlePlan,
} from '@/lib/email';
import type { StudioScope } from './hooks';

export interface CampaignRow {
  id: string;
  name: string;
  type: string;
  status: string;
  subject: string;
  subject_b: string | null;
  ab_enabled: boolean | null;
  preheader: string | null;
  blocks_json: unknown;
  blocks_version: number | null;
  theme_json: unknown;
  social_links_json: unknown;
  logo_url: string | null;
  event_id: string | null;
  audience_type: string | null;
  segment_id: string | null;
  audiences_json: unknown;
  exclusions_json: unknown;
  scheduled_at: string | null;
  throttle_per_hour: number | null;
  throttle_window_minutes: number | null;
  throttle_plan: unknown;
  quiet_hours: boolean | null;
  followup_enabled: boolean | null;
  followup_delay_hours: number | null;
  followup_template_id: string | null;
  parent_campaign_id: string | null;
  resend_enabled: boolean | null;
  resend_delay_hours: number | null;
  resend_subject: string | null;
  /** Langue de l'e-mail (pied de page, balises Yuno). Absent sur les anciennes lignes. */
  language?: string | null;
  /** IA qui a préparé le brouillon via le MCP Yuno. */
  ai_author?: string | null;
  ai_updated_at?: string | null;
}

/** Plan de lissage relu depuis la base ; forme inconnue ⇒ on repart de la proposition. */
export function normalizeThrottlePlan(raw: unknown): ThrottlePlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<ThrottlePlan>;
  if (r.mode !== 'hour' && r.mode !== 'day' && r.mode !== 'days') return null;
  const days = Math.min(7, Math.max(2, Math.floor(Number(r.days) || 2)));
  return { mode: r.mode, days, custom: !!r.custom };
}

export function rowToCampaign(row: CampaignRow, venueName: string): StudioCampaign {
  const isV2 = Number(row.blocks_version || 1) >= 2;
  const blocks: EmailBlock[] = isV2
    ? normalizeV2Blocks(row.blocks_json)
    : migrateV1Blocks(row.blocks_json, venueName);
  const theme = isV2 ? normalizeTheme(row.theme_json) : migrateV1Theme(row.theme_json);
  const rawAudiences = Array.isArray(row.audiences_json) ? (row.audiences_json as AudienceSel[]) : [];
  const audiences = rawAudiences.length > 0
    ? rawAudiences
    : migrateV1Audience(row.audience_type, row.segment_id);
  const rawExcl = (row.exclusions_json && typeof row.exclusions_json === 'object'
    ? row.exclusions_json : {}) as AudienceExclusions;

  const toLocalInput = (iso: string | null): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()) || d.getTime() < Date.now()) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return {
    id: row.id,
    name: row.name,
    type: row.type === 'informational' ? 'informational' : 'promotional',
    status: row.status,
    subject: row.subject === '—' ? '' : row.subject || '',
    subjectB: row.subject_b || '',
    abOn: !!row.ab_enabled,
    preheader: row.preheader || '',
    blocks,
    theme,
    socialLinks: isV2 ? ((row.social_links_json || {}) as SocialLinks) : migrateV1SocialLinks(row.social_links_json),
    logoUrl: row.logo_url,
    eventId: row.event_id,
    audiences,
    exclusions: rawExcl,
    scheduledAt: toLocalInput(row.scheduled_at),
    throttlePerHour: row.throttle_per_hour,
    throttleWindowMinutes: row.throttle_window_minutes === 15 ? 15 : 60,
    throttlePlan: normalizeThrottlePlan(row.throttle_plan),
    quietHours: !!row.quiet_hours,
    followupEnabled: !!row.followup_enabled,
    followupDelayHours: Math.min(168, Math.max(1, Math.floor(Number(row.followup_delay_hours) || 24))),
    followupTemplateId: row.followup_template_id,
    parentCampaignId: row.parent_campaign_id,
    resendEnabled: !!row.resend_enabled,
    resendDelayHours: Math.min(168, Math.max(12, Math.floor(Number(row.resend_delay_hours) || 48))),
    resendSubject: row.resend_subject || '',
    language: row.language === 'en' || row.language === 'es' || row.language === 'fr' ? row.language : null,
    aiAuthor: row.ai_author || null,
    aiUpdatedAt: row.ai_updated_at || null,
  };
}

/** audience_type héritée : miroir de la sélection v2 pour la compat lecture. */
export function legacyAudienceType(c: StudioCampaign): { audience_type: string | null; segment_id: string | null } {
  if (c.type === 'informational') {
    const kind = c.audiences[0]?.kind || 'event_buyers';
    return { audience_type: kind, segment_id: null };
  }
  // Console CRM : audiences {kind:'crm'} résolues par _crm_campaign_audience.
  // Le miroir hérité n'a aucun chemin pour elles : 'imported_list' garantit
  // qu'une liste vidée ne parte jamais à toute la base.
  if (c.audiences.some((a) => (a.kind as string) === 'crm')) return { audience_type: 'imported_list', segment_id: null };
  if (c.audiences.length === 1) {
    const a = c.audiences[0];
    if (a.kind === 'segment') return { audience_type: 'custom_segment', segment_id: a.segmentId || null };
    // 'imported_list' n'a AUCUN chemin de résolution v1 : si audiences_json
    // se vidait, la campagne ne partirait à personne — jamais à toute la base.
    if (a.kind === 'import' || a.kind === 'contact_segment') return { audience_type: 'imported_list', segment_id: null };
    return { audience_type: a.kind, segment_id: null };
  }
  return { audience_type: c.audiences.length > 0 ? 'all_subscribers' : null, segment_id: null };
}

export function campaignToRow(c: StudioCampaign, scope: StudioScope): Record<string, unknown> {
  const legacy = legacyAudienceType(c);
  const payload: Record<string, unknown> = {
    name: c.name || 'Campagne',
    type: c.type,
    subject: c.subject || '—',
    subject_b: c.abOn ? (c.subjectB || null) : null,
    ab_enabled: c.abOn && !!c.subjectB.trim(),
    preheader: c.preheader,
    blocks_json: c.blocks,
    blocks_version: 2,
    theme_json: c.theme,
    social_links_json: c.socialLinks,
    logo_url: c.logoUrl,
    event_id: c.eventId,
    audiences_json: c.type === 'promotional' ? c.audiences : [],
    exclusions_json: c.exclusions,
    audience_type: legacy.audience_type,
    scheduled_at: c.scheduledAt ? new Date(c.scheduledAt).toISOString() : null,
    throttle_per_hour: c.throttlePerHour,
    throttle_window_minutes: c.throttlePerHour != null && c.throttleWindowMinutes === 15 ? 15 : 60,
    throttle_plan: c.throttlePerHour != null ? c.throttlePlan : null,
    quiet_hours: c.quietHours,
    // La relance n'a de sens que pour une campagne marketing reliée à une
    // soirée : sans soirée, le moteur n'a rien à surveiller.
    followup_enabled: c.followupEnabled && c.type === 'promotional' && !!c.eventId,
    followup_delay_hours: c.followupDelayHours,
    followup_template_id: c.followupTemplateId,
    // Renvoi aux non-ouvreurs : campagne marketing seulement.
    resend_enabled: c.resendEnabled && c.type === 'promotional',
    resend_delay_hours: c.resendDelayHours,
    resend_subject: c.resendSubject.trim() || null,
  };
  // Langue posée par le MCP (ou plus tard par le Studio) : réécrite telle
  // quelle, jamais effacée par une sauvegarde d'un écran qui ne la montre pas.
  if (c.language) payload.language = c.language;
  if (scope.kind === 'venue') payload.segment_id = legacy.segment_id;
  return payload;
}
