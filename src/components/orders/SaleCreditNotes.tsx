/**
 * SaleCreditNotes — les avoirs (D15) d'une vente, sous le bouton « Télécharger le reçu » de la page de confirmation.
 * Le client connecté voit ceux de SA vente (RPC get_sale_credit_notes, même règle que la RLS) ; un invité sans compte les
 * reçoit par le lien de l'e-mail de remboursement (/avoir/<jeton>). Rien ne s'affiche tant qu'aucun avoir n'existe.
 */
import { useCallback, useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { deliverCreditNote } from '@/lib/generateCreditNotePDF';
import type { CreditNoteDoc } from '@/lib/creditNote';
import type { DocLang } from '@/lib/generateDocuments';

interface Row { id: string; credit_number: string; amount: number; created_at: string; invoice_number: string }

export function SaleCreditNotes({ kind, id }: { kind: 'ticket' | 'table' | 'order'; id: string | null | undefined }) {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    // Sans session, la RPC est fermée (401) : l'invité sans compte passe par le lien de l'e-mail.
    if (!id || !user) return;
    let live = true;
    supabase.rpc('get_sale_credit_notes', {
      p_ticket_id: kind === 'ticket' ? id : null,
      p_table_reservation_id: kind === 'table' ? id : null,
      p_order_id: kind === 'order' ? id : null,
    }).then(({ data }) => { if (live && Array.isArray(data)) setRows(data as unknown as Row[]); });
    return () => { live = false; };
  }, [kind, id, user]);

  const download = useCallback(async (row: Row) => {
    setBusy(row.id);
    try {
      const { data, error } = await supabase.rpc('get_credit_note_doc', { p_id: row.id });
      if (error || !data) throw error ?? new Error('credit_note_unavailable');
      const outcome = await deliverCreditNote(data as unknown as CreditNoteDoc, language as DocLang);
      if (outcome === 'failed') toast.error(t('credit.downloadError'));
    } catch {
      toast.error(t('credit.downloadError'));
    } finally {
      setBusy(null);
    }
  }, [language, t]);

  if (rows.length === 0) return null;
  const money = new Intl.NumberFormat(language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB', { style: 'currency', currency: 'EUR' });
  return (
    <>
      {rows.map((row) => (
        <button key={row.id} className="btn btn--ghost w-full" onClick={() => download(row)} disabled={busy === row.id}>
          {busy === row.id
            ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
            : <FileText className="h-4 w-4 mr-2" />}
          {t('credit.download').replace('{number}', row.credit_number).replace('{amount}', money.format(-Number(row.amount)))}
        </button>
      ))}
    </>
  );
}
