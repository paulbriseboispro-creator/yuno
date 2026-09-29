import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { CollabResponsibilities, CollabSide } from '@/utils/collabResponsibilities';
import { externalCollectors, type ExternalCollector } from '@/lib/splitRules';

/**
 * Séquence canonique « proposer une collaboration sur une soirée », partagée par
 * les deux sens (club → organisateur et organisateur → club) et par les deux
 * moments (à la création de la soirée, ou plus tard sur une soirée existante).
 *
 * Trois étapes, dans cet ordre, parce qu'elles sont interdépendantes :
 *
 *  1. RATTACHER le partenaire sur `events` (colonne miroir selon le sens). Seul le
 *     LEAD peut le faire — le trigger protect_event_columns_from_partner refuse
 *     l'écriture au partenaire invité.
 *  2. OUVRIR le contrat via create_event_collab_contract, qui pré-signe le côté
 *     appelant et laisse le contrat en 'pending_signatures'. Tant que les deux
 *     n'ont pas signé, `events.revenue_split_rules` reste NULL et le CONTRACT
 *     GUARD bloque les ventes.
 *  3. PRÉVENIR le partenaire (e-mail + push).
 *
 * Si l'étape 2 échoue, l'étape 1 est annulée. Sans ce retour arrière on laisserait
 * une soirée affichée comme co-organisée mais sans contrat : elle ne pourrait
 * jamais vendre, et rien à l'écran ne dirait pourquoi.
 *
 * L'appel RPC passe `p_responsibilities` à dessein : deux surcharges de
 * create_event_collab_contract coexistent en base (3 et 4 arguments), et seule la
 * version 4 arguments persiste l'axe responsabilités. Omettre le paramètre
 * résoudrait silencieusement l'ancienne surcharge.
 */
export interface ProposeCollabArgs {
  eventId: string;
  /** L'autre partie : un organizer_user_id côté club, un venue_id côté organisateur. */
  partnerId: string;
  /** Valeur de l'enum Postgres `event_mode` — jamais le libellé du formulaire. */
  mode: 'co_event' | 'venue_rental' | 'org_hosted';
  responsibilities: CollabResponsibilities;
  cancellationPolicy?: 'pro_rata_refund' | 'no_refund_after_event';
  /** Rattachement précédent, restauré si l'ouverture du contrat échoue. */
  previousPartnerId?: string | null;
  previousMode?: string | null;
}

export function useProposeCollab(side: CollabSide, scopeId: string | null | undefined) {
  const [proposing, setProposing] = useState(false);

  const ownCol = side === 'venue' ? 'venue_id' : 'organizer_user_id';
  const partnerCol = side === 'venue' ? 'partner_organizer_id' : 'partner_venue_id';

  const propose = useCallback(async (args: ProposeCollabArgs) => {
    if (!scopeId) throw new Error('No scope');
    setProposing(true);
    try {
      const { error: linkErr } = await supabase
        .from('events')
        .update({
          [partnerCol]: args.partnerId,
          event_mode: args.mode,
          collab_responsibilities: args.responsibilities,
        } as never)
        .eq('id', args.eventId)
        .eq(ownCol, scopeId);
      if (linkErr) throw linkErr;

      const { error: contractErr } = await supabase.rpc('create_event_collab_contract' as never, {
        p_event_id: args.eventId,
        p_cancellation_policy: args.cancellationPolicy ?? 'pro_rata_refund',
        p_responsibilities: args.responsibilities,
      } as never);

      if (contractErr) {
        await supabase
          .from('events')
          .update({
            [partnerCol]: args.previousPartnerId ?? null,
            event_mode: args.previousMode ?? null,
            collab_responsibilities: null,
          } as never)
          .eq('id', args.eventId)
          .eq(ownCol, scopeId);
        throw contractErr;
      }

      // Best-effort : le contrat est la source de vérité et attend déjà dans
      // l'inbox du partenaire. Un envoi raté ne doit pas annuler la proposition.
      try {
        await supabase.functions.invoke('notify-split-proposal', {
          body: { kind: 'event', id: args.eventId, action: 'proposed', proposer_side: side },
        });
      } catch (e) {
        console.warn('[propose-collab] notify failed', e);
      }
    } finally {
      setProposing(false);
    }
  }, [side, scopeId, ownCol, partnerCol]);

  /**
   * « Réglé entre vous » : même rattachement, puis `set_event_collab_external_agreement`
   * au lieu d'un contrat. Aucune signature : la vente ouvre tout de suite, chaque
   * pilier est encaissé en direct par la partie choisie (bar toujours au club).
   * Un échec défait le rattachement, comme pour un contrat.
   */
  const proposeExternal = useCallback(async (args: Omit<ProposeCollabArgs, 'cancellationPolicy'> & {
    tickets: ExternalCollector;
    tables: ExternalCollector;
  }) => {
    if (!scopeId) throw new Error('No scope');
    setProposing(true);
    try {
      const { error: linkErr } = await supabase
        .from('events')
        .update({
          [partnerCol]: args.partnerId,
          event_mode: args.mode,
          collab_responsibilities: args.responsibilities,
        } as never)
        .eq('id', args.eventId)
        .eq(ownCol, scopeId);
      if (linkErr) throw linkErr;

      const { error: agreeErr } = await supabase.rpc('set_event_collab_external_agreement' as never, {
        p_event_id: args.eventId,
        p_tickets: args.tickets,
        p_tables: args.tables,
      } as never);
      if (agreeErr) {
        await supabase
          .from('events')
          .update({
            [partnerCol]: args.previousPartnerId ?? null,
            event_mode: args.previousMode ?? null,
            collab_responsibilities: null,
          } as never)
          .eq('id', args.eventId)
          .eq(ownCol, scopeId);
        throw agreeErr;
      }
    } finally {
      setProposing(false);
    }
  }, [scopeId, ownCol, partnerCol]);

  return { propose, proposeExternal, proposing };
}

/**
 * Le contrat vivant d'une soirée, s'il existe. Un contrat 'cancelled' ne compte
 * pas : une proposition refusée doit pouvoir être renvoyée.
 */
export async function fetchLiveEventContract(eventId: string) {
  const { data } = await supabase
    .from('event_collab_contracts' as never)
    .select('id, status')
    .eq('event_id' as never, eventId as never)
    .neq('status' as never, 'cancelled' as never)
    .maybeSingle();
  return (data as unknown as { id: string; status: string } | null) ?? null;
}

/**
 * L'accord vivant d'une soirée : un contrat Yuno (signé ou en attente) OU un
 * accord « réglé entre vous » posé sur les règles de la soirée. Tant que l'un
 * existe, le partenaire et le mode sont engagés.
 */
export type LiveEventAgreement =
  | { kind: 'contract'; id: string; status: string }
  | { kind: 'external'; tickets: ExternalCollector; tables: ExternalCollector };

export async function fetchLiveEventAgreement(eventId: string): Promise<LiveEventAgreement | null> {
  const [contract, { data: ev }] = await Promise.all([
    fetchLiveEventContract(eventId),
    supabase.from('events').select('revenue_split_rules').eq('id', eventId).maybeSingle(),
  ]);
  if (contract) return { kind: 'contract', ...contract };
  const ext = externalCollectors((ev as { revenue_split_rules?: unknown } | null)?.revenue_split_rules);
  return ext ? { kind: 'external', ...ext } : null;
}
