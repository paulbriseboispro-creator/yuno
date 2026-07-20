import { supabase } from '@/integrations/supabase/client';
import { normalizeSplitRules } from './splitRules';
import type { AmendmentPDFData } from './generateAmendmentPDF';
import type { Lang } from './collabContractTerms';

/** La ligne event_collab_amendments, telle que le front la lit. */
export interface CollabAmendmentRow {
  id: string;
  contract_id: string | null;
  series_contract_id: string | null;
  venue_id: string;
  organizer_user_id: string;
  responsibilities: Record<string, string> | null;
  split_rules: Record<string, unknown> | null;
  prev_responsibilities: Record<string, string> | null;
  prev_split_rules: Record<string, unknown> | null;
  reason: string | null;
  proposed_by: string;
  venue_signed_at: string | null;
  org_signed_at: string | null;
  venue_signed_ip?: string | null;
  org_signed_ip?: string | null;
  effective_at?: string | null;
  created_at: string;
}

/**
 * Charge tout ce que l'avenant a besoin d'afficher : identités légales des deux
 * parties, sujet, delta, signatures.
 *
 * Source UNIQUE pour l'aperçu PDF et pour l'écran de relecture avant signature.
 * Les deux doivent dire exactement la même chose — sinon on signe autre chose
 * que ce qu'on a lu, ce qui vide la case « j'ai lu et j'accepte » de son sens.
 */
export async function loadAmendmentPdfData(
  row: CollabAmendmentRow,
  ctx: { subject: string; recurring: boolean; proposerLabel: string; language?: Lang; fallbackOrgName?: string },
): Promise<AmendmentPDFData> {
  const [{ data: venue }, { data: orgProfile }, { data: prof }] = await Promise.all([
    supabase.from('venues')
      .select('name, legal_name, legal_address, siret, vat_number').eq('id', row.venue_id).maybeSingle(),
    supabase.from('organizer_profiles' as never)
      .select('display_name, legal_name, legal_address, siret, vat_number')
      .eq('user_id' as never, row.organizer_user_id as never).maybeSingle(),
    supabase.from('profiles').select('first_name, last_name').eq('id', row.organizer_user_id).maybeSingle(),
  ]);

  const op = orgProfile as unknown as {
    display_name?: string | null; legal_name?: string | null; legal_address?: string | null;
    siret?: string | null; vat_number?: string | null;
  } | null;
  const pr = prof as { first_name?: string | null; last_name?: string | null } | null;
  const orgName = op?.display_name
    || [pr?.first_name, pr?.last_name].filter(Boolean).join(' ')
    || ctx.fallbackOrgName
    || 'Organisateur';

  return {
    amendmentId: row.id,
    contractRef: row.series_contract_id ?? row.contract_id ?? row.id,
    recurring: ctx.recurring,
    subject: ctx.subject,
    venue: {
      name: venue?.name || 'Club',
      legalName: venue?.legal_name,
      legalAddress: venue?.legal_address,
      registrationNumber: venue?.siret,
      vatNumber: venue?.vat_number,
    },
    organizer: {
      name: orgName,
      legalName: op?.legal_name,
      legalAddress: op?.legal_address,
      registrationNumber: op?.siret,
      vatNumber: op?.vat_number,
    },
    prevResponsibilities: row.prev_responsibilities,
    nextResponsibilities: row.responsibilities,
    prevSplit: normalizeSplitRules(row.prev_split_rules),
    nextSplit: normalizeSplitRules(row.split_rules),
    reason: row.reason,
    proposedByLabel: ctx.proposerLabel,
    proposedAt: new Date(row.created_at),
    venueSignedAt: row.venue_signed_at ? new Date(row.venue_signed_at) : null,
    venueSignedIp: row.venue_signed_ip ?? null,
    orgSignedAt: row.org_signed_at ? new Date(row.org_signed_at) : null,
    orgSignedIp: row.org_signed_ip ?? null,
    effectiveAt: row.effective_at ? new Date(row.effective_at) : null,
    language: ctx.language ?? 'fr',
  };
}
