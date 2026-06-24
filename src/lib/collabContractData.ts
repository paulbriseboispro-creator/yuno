import { supabase } from '@/integrations/supabase/client';
import { normalizeSplitRules } from './splitRules';
import type { CollabContractPDFData } from './generateContractPDF';
import type { Lang } from './collabContractTerms';
import type { EventCollabContractRow } from '@/hooks/useEventCollabContract';

/**
 * Load everything the contract PDF / pre-signature dialog needs from a contract row:
 * party names + legal identity (venues + organizer_profiles), event title/date, split,
 * signatures, and the frozen terms version (terms_snapshot.terms_version). Single source
 * for the download, the PDF preview, and the review dialog so they never disagree.
 */
export async function loadCollabContractPdfData(
  contract: EventCollabContractRow,
  language: Lang = 'fr',
): Promise<CollabContractPDFData> {
  const [{ data: ev }, { data: venue }, { data: org }, { data: orgProfile }] = await Promise.all([
    supabase.from('events').select('title, start_at').eq('id', contract.event_id).maybeSingle(),
    supabase.from('venues').select('name, legal_name, legal_address, siret, vat_number').eq('id', contract.venue_id).maybeSingle(),
    supabase.from('profiles').select('*').eq('id', contract.organizer_user_id).maybeSingle(),
    supabase.from('organizer_profiles').select('legal_name, legal_address, siret, vat_number').eq('user_id', contract.organizer_user_id).maybeSingle(),
  ]);
  const o = org as { full_name?: string | null; first_name?: string | null; last_name?: string | null; business_name?: string | null } | null;
  const orgName = o?.full_name || [o?.first_name, o?.last_name].filter(Boolean).join(' ') || o?.business_name || 'Organisateur';
  const ev2 = ev as { title?: string | null; start_at?: string | null } | null;
  const termsVersion = (contract.terms_snapshot as { terms_version?: string } | null)?.terms_version ?? null;

  return {
    contractId: contract.id,
    venueName: venue?.name || 'Club',
    organizerName: orgName,
    eventTitle: ev2?.title ?? undefined,
    eventDate: ev2?.start_at ? new Date(ev2.start_at) : null,
    splitRules: normalizeSplitRules(contract.split_rules) ?? {
      tickets: { organizer_pct: 0, venue_pct: 100 },
      tables: { organizer_pct: 0, venue_pct: 100 },
      drinks: { organizer_pct: 0, venue_pct: 100 },
    },
    cancellationPolicy: contract.cancellation_policy,
    venueLegal: {
      legalName: venue?.legal_name,
      legalAddress: venue?.legal_address,
      registrationNumber: venue?.siret,
      vatNumber: venue?.vat_number,
    },
    organizerLegal: {
      legalName: orgProfile?.legal_name,
      legalAddress: orgProfile?.legal_address,
      registrationNumber: orgProfile?.siret,
      vatNumber: orgProfile?.vat_number,
    },
    venueSignedAt: contract.venue_signed_at ? new Date(contract.venue_signed_at) : null,
    venueSignedName: venue?.name ?? undefined,
    venueSignedIp: contract.venue_signed_ip,
    orgSignedAt: contract.org_signed_at ? new Date(contract.org_signed_at) : null,
    orgSignedName: orgName,
    orgSignedIp: contract.org_signed_ip,
    language,
    termsVersion,
  };
}
