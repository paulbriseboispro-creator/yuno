/**
 * Données de l'écran Imports : la carte Shotgun et l'historique
 * (crm_imports_overview), la comparaison à la base (crm_import_check),
 * l'import par lots (crm_import_commit), l'annulation (crm_import_undo) et
 * la relecture immédiate de Shotgun (action ticketing_sync_now).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import type { BaseMatch } from '@/crm/lib/fileImport';

export interface ImportRow {
  id: string; kind: 'file' | 'manual'; title: string | null; consent: 'yes' | 'no';
  created_at: string; status: 'done' | 'undone'; undone_at: string | null;
  new: number; existing: number; dup: number; bad: number;
}

export interface ImportsOverview {
  connection: { state: 'on' | 'broken' | 'off'; status: string; org_name: string | null; last_ok_at: string | null; last_error_at: string | null } | null;
  sync: { day: string; new: number; existing: number } | null;
  imports: ImportRow[];
  legacy: { id: string; title: string | null; created_at: string; rows: number }[];
}

export function useImportsOverview() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({ queryKey: ['crm', qk, 'imports'], queryFn: () => rpc<ImportsOverview>('crm_imports_overview', args), staleTime: 30_000 });
}

/** Invalide tout ce qu'un import change : listes, segments, accueil, coquille. */
export function useInvalidateBase() {
  const { qk } = useCrmScope();
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['crm', qk] });
}

type CheckRes = { emails: (BaseMatch & { e: string })[]; phones: (BaseMatch & { p: string })[] };

/** Compare des e-mails et téléphones à la base, par paquets de 10 000. */
export async function checkAgainstBase(args: Record<string, unknown>, emails: string[], phones: string[]) {
  const byEmail = new Map<string, BaseMatch>();
  const byPhone = new Map<string, BaseMatch>();
  const step = 10_000;
  const n = Math.max(emails.length, phones.length);
  for (let i = 0; i < Math.max(1, n); i += step) {
    const r = await rpc<CheckRes>('crm_import_check', { ...args, p_emails: emails.slice(i, i + step), p_phones: phones.slice(i, i + step) });
    r.emails.forEach((m) => byEmail.set(m.e, m));
    r.phones.forEach((m) => byPhone.set(m.p, m));
  }
  return { byEmail, byPhone };
}

export interface CommitParams {
  rows: Record<string, string>[];
  consent: 'yes' | 'no';
  mode: 'complete' | 'keep';
  title: string;
  stats: { new: number; existing: number; dup: number; bad: number };
  kind?: 'file' | 'manual';
  onProgress?: (p: number) => void;
}

/**
 * Envoie les lignes par lots de 1 000. Un lot qui échoue annule l'import
 * entier (crm_import_undo) : jamais de base à moitié remplie.
 */
export async function commitImport(args: Record<string, unknown>, p: CommitParams): Promise<string> {
  const size = 1000;
  let list: string | null = null;
  const batches: Record<string, string>[][] = [];
  for (let i = 0; i < p.rows.length; i += size) batches.push(p.rows.slice(i, i + size));
  if (!batches.length) batches.push([]);
  try {
    for (let b = 0; b < batches.length; b++) {
      const last = b === batches.length - 1;
      const r: { list_import_id: string } = await rpc<{ list_import_id: string }>('crm_import_commit', {
        ...args, p_list_import_id: list, p_rows: batches[b], p_consent: p.consent, p_mode: p.mode,
        p_title: p.title, p_final: last, p_stats: b === 0 || last ? p.stats : null, p_kind: p.kind ?? 'file',
      }, { timeoutMs: 120_000 });
      list = r.list_import_id;
      p.onProgress?.((b + 1) / batches.length);
    }
    return list as string;
  } catch (e) {
    if (list) {
      try { await rpc('crm_import_undo', { ...args, p_list_import_id: list }); } catch { /* l'annulation a échoué : l'import reste annulable depuis l'historique */ }
    }
    throw e;
  }
}

export function undoImport(args: Record<string, unknown>, id: string) {
  return rpc<{ ok: boolean; contacts: number }>('crm_import_undo', { ...args, p_list_import_id: id });
}

/** Relance la lecture de Shotgun. Rend 'ok' | 'too_soon' | 'error'. */
export async function syncShotgunNow(scope: { venueId: string | null; organizerUserId: string | null }) {
  const { data, error } = await invokeEdgeFunction<{ ok?: boolean; error?: string }>('affiliate-ticket-sync', {
    body: { action: 'ticketing_sync_now', provider: 'shotgun', scope },
  });
  if (data?.ok) return 'ok' as const;
  const code = data?.error ?? (error as { message?: string } | null)?.message ?? '';
  return code.includes('too_soon') ? ('too_soon' as const) : ('error' as const);
}
