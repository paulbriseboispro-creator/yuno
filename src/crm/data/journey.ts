/**
 * Données du Parcours client (migration 20261005100000) : une lecture,
 * `crm_journey`, qui suit les e-mails envoyés à la main message par message —
 * reçu, ouvert, clic, achat (billet sous 7 jours après un clic), retour
 * (rachat pour une autre soirée sous 90 jours). Les montants arrivent à null
 * pour un rôle sans accès au chiffre d'affaires ; les adresses de relance ne
 * partent qu'à un rôle qui écrit.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import type { Lifecycle } from '@/crm/data/clients';
import type { SourceKey } from '@/crm/data/analytics';

export type JrPeriod = '7d' | '30d' | '90d' | '12m';
export type JrChannel = 'all' | 'email' | 'sms' | 'ig';
export type JrSeg = 'all' | Lifecycle;

export const JR_PERIODS: JrPeriod[] = ['7d', '30d', '90d', '12m'];
export const JR_CHANNELS: JrChannel[] = ['all', 'email', 'sms', 'ig'];
export const JR_SEGS: JrSeg[] = ['all', 'nou', 'occ', 'hab', 'end', 'none'];

export interface JrFilters {
  period: JrPeriod;
  event: string | null;
  campaign: string | null;
  channel: JrChannel;
  seg: JrSeg;
  cmp: boolean;
}

export type SegCounts = Record<Lifecycle, number>;

export interface JrStep {
  k: 0 | 1 | 2 | 3;
  lost: number;
  reach: number;
  by_campaign: { id: string; name: string; n: number }[];
  by_seg: SegCounts;
  /** Audience exacte de « Relancer » (rôle qui écrit, 2 000 au plus). */
  emails: string[] | null;
}

export type JrPathKey = 'm_click' | 'mm_click' | 'm_noclick' | `src_${SourceKey}`;

export interface JrCampaign {
  id: string; name: string; sent_at: string; event_id: string | null; event_title: string | null;
  received: number; opened: number; clicked: number; ticket_clicks: number; buyers: number; back: number;
  revenue: number | null; within2d: number; buyers_seg: SegCounts;
}

export type JrEventKind = 'mail' | 'auto' | 'open' | 'click' | 'buy';

export interface JrPerson {
  kind: 'bought' | 'clicked' | 'opened' | 'direct';
  email: string; first_name: string | null; last_name: string | null;
  lifecycle: Lifecycle; nights: number; email_ok: boolean; phone_ok: boolean;
  events: { at: string; t: JrEventKind; s: string | null; amount: number | null; qty: number | null; ev_at: string | null }[];
}

export interface Journey {
  period: JrPeriod; from: string; to: string; days: number; seg: JrSeg; channel: JrChannel;
  campaign: { id: string; sent_at: string } | null;
  /** Reçu, ouvert, clic, achat, retour — par personne. */
  funnel: [number, number, number, number, number];
  prev: [number, number, number, number, number] | null;
  /** Personnes touchées sur 14 cases ; null quand une campagne est choisie. */
  spark: number[] | null;
  /** Acheteurs sur 6 cases ; null quand une campagne est choisie. */
  bars: number[] | null;
  steps: JrStep[];
  delays: { n: number; b: [number, number, number, number]; median_h: number | null; prev_median_h: number | null; touches: number | null };
  paths: { total: number; with_msg: number; without_msg: number; list: { key: JrPathKey; n: number }[] } | null;
  cover: { buyers: number; attributed: number } | null;
  campaigns: JrCampaign[];
  examples: JrPerson[];
  options: { campaigns: { id: string; name: string; sent_at: string; event_id: string | null }[] };
  thanks_auto: boolean;
  has_campaigns: boolean;
  has_connection: boolean;
}

export function useJourney(f: JrFilters) {
  const { rpc: a, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'journey', f.period, f.event, f.campaign, f.channel, f.seg],
    queryFn: () => rpc<Journey>('crm_journey', {
      ...a, p_period: f.period, p_event: f.event, p_campaign: f.campaign, p_channel: f.channel, p_seg: f.seg,
    }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
