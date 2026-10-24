/**
 * Données de l'écran Imports de Yuno Tickets (copie de src/crm/data/imports.ts) :
 * ce que les ventes Yuno apportent à la base et l'historique
 * (tix_imports_overview), la comparaison à la base (tix_import_check), l'import
 * par lots (tix_import_commit, qui écrit par import_contact_list) et
 * l'annulation (tix_import_undo). Pas de synchro de billetterie : la base se
 * remplit à chaque vente.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useTixScope } from '@/tickets/clients/scope';
import type { BaseMatch } from '@/crm/lib/fileImport';

export interface ImportRow {
  id: string; kind: 'file' | 'manual'; title: string | null; consent: 'yes' | 'no';
  created_at: string; status: 'done' | 'undone'; undone_at: string | null;
  new: number; existing: number; dup: number; bad: number;
}

export interface ImportsOverview {
  /** Personnes entrées par une vente Yuno (billet, table, guest list), dont ces 30 derniers jours. */
  sales: { people: number; month: number; last_at: string | null } | null;
  imports: ImportRow[];
  legacy: { id: string; title: string | null; created_at: string; rows: number }[];
}

export function useImportsOverview() {
  const { rpc: args, qk, ready } = useTixScope();
  return useQuery({ enabled: ready, queryKey: ['tix-cli', qk, 'imports'], queryFn: () => rpc<ImportsOverview>('tix_imports_overview', args), staleTime: 30_000 });
}

/** Invalide tout ce qu'un import change : listes, segments, catalogue. */
export function useInvalidateBase() {
  const { qk } = useTixScope();
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['tix-cli', qk] });
}

type CheckRes = { emails: (BaseMatch & { e: string })[]; phones: (BaseMatch & { p: string })[] };

/** Compare des e-mails et téléphones à la base, par paquets de 10 000. */
export async function checkAgainstBase(args: Record<string, unknown>, emails: string[], phones: string[]) {
  const byEmail = new Map<string, BaseMatch>();
  const byPhone = new Map<string, BaseMatch>();
  const step = 10_000;
  const n = Math.max(emails.length, phones.length);
  for (let i = 0; i < Math.max(1, n); i += step) {
    const r = await rpc<CheckRes>('tix_import_check', { ...args, p_emails: emails.slice(i, i + step), p_phones: phones.slice(i, i + step) });
    r.emails.forEach((m) => byEmail.set(m.e, m));
    r.phones.forEach((m) => byPhone.set(m.p, m));
  }
  return { byEmail, byPhone };
}

/** Origines d'un accord, celles de l'import de la Console (import_contact_list). */
export const CONSENT_SOURCES = ['in_person', 'website_form', 'ticketing', 'social', 'other_tool', 'other'] as const;
export type ConsentSource = typeof CONSENT_SOURCES[number];

/** L'attestation de Yuno Tickets, quand le pro dit avoir l'accord (décision de Paul du 22/10). */
export interface Attestation {
  source: ConsentSource;
  /** Précision libre (« formulaire du site, case cochée »). */
  details?: string;
  /** Date depuis laquelle ces accords sont recueillis (AAAA-MM-JJ). */
  since?: string | null;
}

export interface CommitParams {
  rows: Record<string, string>[];
  consent: 'yes' | 'no';
  attestation?: Attestation | null;
  mode: 'complete' | 'keep';
  title: string;
  stats: { new: number; existing: number; dup: number; bad: number };
  kind?: 'file' | 'manual';
  /** Pays des numéros sans indicatif (ISO 2). */
  country?: string;
  onProgress?: (p: number) => void;
}

/**
 * Envoie les lignes par lots de 1 000. Un lot qui échoue annule l'import
 * entier (tix_import_undo) : jamais de base à moitié remplie.
 */
export async function commitImport(args: Record<string, unknown>, p: CommitParams): Promise<string> {
  const size = 1000;
  let list: string | null = null;
  const batches: Record<string, string>[][] = [];
  for (let i = 0; i < p.rows.length; i += size) batches.push(p.rows.slice(i, i + size));
  if (!batches.length) batches.push([]);
  const att = p.consent === 'yes' ? p.attestation ?? null : null;
  try {
    for (let b = 0; b < batches.length; b++) {
      const last = b === batches.length - 1;
      const r: { list_import_id: string } = await rpc<{ list_import_id: string }>('tix_import_commit', {
        ...args, p_list_import_id: list, p_rows: batches[b], p_consent: p.consent, p_mode: p.mode,
        p_title: p.title, p_final: last, p_stats: b === 0 || last ? p.stats : null, p_kind: p.kind ?? 'file',
        p_consent_source: att?.source ?? null, p_consent_details: att?.details?.trim() || null,
        p_collected_since: att?.since || null, p_default_country: p.country ?? 'FR',
      }, { timeoutMs: 120_000 });
      list = r.list_import_id;
      p.onProgress?.((b + 1) / batches.length);
    }
    return list as string;
  } catch (e) {
    if (list) {
      try { await rpc('tix_import_undo', { ...args, p_list_import_id: list }); } catch { /* l'annulation a échoué : l'import reste annulable depuis l'historique */ }
    }
    throw e;
  }
}

export function undoImport(args: Record<string, unknown>, id: string) {
  return rpc<{ ok: boolean; contacts: number }>('tix_import_undo', { ...args, p_list_import_id: id });
}
