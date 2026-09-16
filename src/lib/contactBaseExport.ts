// Export de la base de contacts unifiée — une seule fabrique.
//
// Appelée depuis « Ma base de contacts » et depuis la page Clients (club et
// organisateur) : le pro qui exporte « ses clients » obtient le fichier
// importé mis à jour au fil des campagnes ET les personnes venues par Yuno,
// avec l'engagement et les segments de chacun. La RPC `export_contact_base`
// rend un en-tête de colonnes + des lignes en tableaux (12 000 lignes en
// moins d'une seconde) ; ici on traduit les en-têtes et les valeurs codées,
// puis on livre le même tableur que les listes de porte (feuille de partage
// dans l'app native, téléchargement sur le web).

import { supabase } from '@/integrations/supabase/client';
import { deliverRoster } from '@/lib/rosterExport';
import { fmtN } from '@/lib/contactBase';

export type ExportOutcome = 'downloaded' | 'shared' | 'cancelled' | 'failed' | 'empty';

const DATE_COLS = new Set(['last_opened_at', 'last_clicked_at', 'unsubscribed_at', 'last_purchase_at', 'first_seen_at', 'last_seen_at']);
const BOOL_COLS = new Set(['has_account', 'email_ok', 'phone_ok', 'bounced']);

export async function exportContactBase(opts: {
  scopeArgs: { p_venue_id: string | null; p_organizer_user_id: string | null };
  scopeName: string;
  t: (k: string) => string;
  language: string;
}): Promise<{ outcome: ExportOutcome; rows: number; error?: string }> {
  const { scopeArgs, scopeName, t, language } = opts;
  const { data, error } = await supabase.rpc('export_contact_base' as never, scopeArgs as never);
  if (error) return { outcome: 'failed', rows: 0, error: error.message };
  const d = data as unknown as { columns: string[]; rows: unknown[][] } | null;
  if (!d || !Array.isArray(d.rows) || d.rows.length === 0) return { outcome: 'empty', rows: 0 };
  const cols = d.columns;
  const statusIdx = cols.indexOf('status');
  const originIdx = cols.indexOf('origin');
  const columns = cols.map((k) => ({ key: k, label: t(`cbase.col.${k}`), weight: k === 'email' ? 18 : k === 'segments' ? 22 : 9 }));
  const rows = d.rows.map((r) => {
    const o: Record<string, string | number | null> = {};
    cols.forEach((k, i) => {
      const v = r[i];
      if (v == null) { o[k] = ''; return; }
      if (i === statusIdx) { o[k] = t(`cbase.status.${String(v)}`); return; }
      if (i === originIdx) { o[k] = t(`cbase.origin.${String(v)}`); return; }
      if (DATE_COLS.has(k)) { o[k] = new Date(String(v)).toLocaleDateString(); return; }
      if (BOOL_COLS.has(k)) { o[k] = v ? t('cbase.yes') : t('cbase.no'); return; }
      o[k] = typeof v === 'number' ? v : String(v);
    });
    return o;
  });
  const outcome = await deliverRoster({
    kind: t('cbase.exportKind'),
    eventTitle: scopeName || 'Yuno',
    eventSubtitle: '',
    columns,
    rows,
    nameKey: 'email',
  }, 'xlsx', new Date().toLocaleString());
  return { outcome: outcome as ExportOutcome, rows: d.rows.length };
}

export function exportedCountLabel(n: number, language: string): string {
  return fmtN(n, language);
}
