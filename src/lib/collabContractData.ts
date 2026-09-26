import { supabase } from '@/integrations/supabase/client';
import { normalizeSplitRules, readRemuneration } from './splitRules';
import type { CollabContractPDFData } from './generateContractPDF';
import type { Lang } from './collabContractTerms';
import type { EventCollabContractRow } from '@/hooks/useEventCollabContract';
import type { EventCollabSeriesContractRow } from '@/hooks/useEventCollabSeriesContract';

type OrgProfileName = { full_name?: string | null; first_name?: string | null; last_name?: string | null; business_name?: string | null } | null;
// Le nom PUBLIC de l'organisateur (organizer_profiles.display_name) d'abord :
// `profiles` n'est pas lisible par le club partenaire (RLS), et le contrat
// affichait alors « Organisateur » à la place du nom de l'autre partie — un
// club qui signe doit voir avec qui.
const resolveOrgName = (o: OrgProfileName, publicName?: string | null) =>
  publicName || o?.full_name || [o?.first_name, o?.last_name].filter(Boolean).join(' ') || o?.business_name || 'Organisateur';

/**
 * Profil public + identité légale de l'organisateur d'un contrat. Les colonnes
 * légales ne se lisent plus en direct (20260926140000) : la RPC ne les rend
 * qu'aux parties du contrat (l'orga, son équipe, le club) et au super admin.
 */
async function fetchOrganizerLegalProfile(organizerUserId: string): Promise<{
  data: {
    display_name: string | null; bde_verified: boolean | null;
    legal_name: string | null; legal_address: string | null; siret: string | null; vat_number: string | null;
  } | null;
}> {
  const [{ data: pub }, { data: legalRows }] = await Promise.all([
    supabase.from('organizer_profiles').select('display_name, bde_verified').eq('user_id', organizerUserId).maybeSingle(),
    supabase.rpc('get_organizer_legal_identity', { p_organizer_user_id: organizerUserId }),
  ]);
  const legal = (Array.isArray(legalRows) ? legalRows[0] : legalRows) ?? null;
  if (!pub && !legal) return { data: null };
  return {
    data: {
      display_name: pub?.display_name ?? null,
      bde_verified: pub?.bde_verified ?? null,
      legal_name: legal?.legal_name ?? null,
      legal_address: legal?.legal_address ?? null,
      siret: legal?.siret ?? null,
      vat_number: legal?.vat_number ?? null,
    },
  };
}

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
    fetchOrganizerLegalProfile(contract.organizer_user_id),
  ]);
  const orgName = resolveOrgName(org as OrgProfileName, (orgProfile as { display_name?: string | null } | null)?.display_name);
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
    // Barème sur le CA de la soirée (contrat à décompte). Null = partage par pilier.
    remuneration: readRemuneration(contract.split_rules),
    // Répartition des responsabilités telle que portée par le contrat. Sur un
    // contrat signé AVANT la version 2026-07-20, termsVersion gèle la version
    // d'origine, qui n'a pas l'article : rien ne s'affiche, et c'est voulu.
    responsibilities: (contract.responsibilities as Record<string, string> | null) ?? null,
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
    isBde: !!(orgProfile as { bde_verified?: boolean } | null)?.bde_verified,
  };
}

/**
 * Same as loadCollabContractPdfData but for a recurring FRAMEWORK contract (contrat-cadre):
 * keyed on a template/series instead of a single event. `seriesLabel` is the human series
 * description ("Résidence · tous les vendredis · 23:00") shown where an event title would be.
 * Always recurring=true → the "Engagement récurrent" article is rendered.
 */
export async function loadCollabSeriesContractPdfData(
  contract: EventCollabSeriesContractRow,
  seriesLabel: string,
  language: Lang = 'fr',
): Promise<CollabContractPDFData> {
  const [{ data: venue }, { data: org }, { data: orgProfile }] = await Promise.all([
    supabase.from('venues').select('name, legal_name, legal_address, siret, vat_number').eq('id', contract.venue_id).maybeSingle(),
    supabase.from('profiles').select('*').eq('id', contract.organizer_user_id).maybeSingle(),
    fetchOrganizerLegalProfile(contract.organizer_user_id),
  ]);
  const orgName = resolveOrgName(org as OrgProfileName, (orgProfile as { display_name?: string | null } | null)?.display_name);
  const termsVersion = (contract.terms_snapshot as { terms_version?: string } | null)?.terms_version ?? null;

  return {
    contractId: contract.id,
    venueName: venue?.name || 'Club',
    organizerName: orgName,
    eventTitle: seriesLabel,
    eventDate: null,
    splitRules: normalizeSplitRules(contract.split_rules) ?? {
      tickets: { organizer_pct: 0, venue_pct: 100 },
      tables: { organizer_pct: 0, venue_pct: 100 },
      drinks: { organizer_pct: 0, venue_pct: 100 },
    },
    cancellationPolicy: contract.cancellation_policy,
    // Barème sur le CA de la soirée (contrat à décompte). Null = partage par pilier.
    remuneration: readRemuneration(contract.split_rules),
    // Répartition des responsabilités telle que portée par le contrat. Sur un
    // contrat signé AVANT la version 2026-07-20, termsVersion gèle la version
    // d'origine, qui n'a pas l'article : rien ne s'affiche, et c'est voulu.
    responsibilities: (contract.responsibilities as Record<string, string> | null) ?? null,
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
    recurring: true,
    isBde: !!(orgProfile as { bde_verified?: boolean } | null)?.bde_verified,
  };
}
