/**
 * TableCreditNotes — les avoirs (C2) d'une table, vus par le pro dans Commandes › Tables VIP.
 * Même RPC que la page de confirmation du client (`get_sale_credit_notes`, ouverte aux parties de la vente).
 * Rien ne s'affiche tant qu'aucun avoir n'existe pour cette réservation.
 */
import { useCallback, useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { deliverCreditNote } from '@/lib/generateCreditNotePDF';
import type { CreditNoteDoc } from '@/lib/creditNote';
import type { DocLang } from '@/lib/generateDocuments';
import { formatMoneyAuto } from '@/lib/money';

interface Row { id: string; credit_number: string; amount: number; created_at: string; invoice_number: string }

export function TableCreditNotes({ reservationId }: { reservationId: string }) {
  const { t, language } = useLanguage();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRows([]);
    supabase.rpc('get_sale_credit_notes', {
      p_ticket_id: null, p_table_reservation_id: reservationId, p_order_id: null,
    }).then(({ data }) => { if (live && Array.isArray(data)) setRows(data as unknown as Row[]); });
    return () => { live = false; };
  }, [reservationId]);

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
  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          onClick={() => download(row)}
          disabled={busy === row.id}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left cursor-pointer"
          style={{ background: 'rgb(var(--ink)/0.032)', border: '1px solid rgb(var(--ink)/0.085)', color: 'rgb(var(--ink)/var(--ink-a96,0.96))', fontSize: 13 }}
        >
          <FileText className="h-3.5 w-3.5" />
          {t('credit.download').replace('{number}', row.credit_number).replace('{amount}', formatMoneyAuto(-Number(row.amount)))}
        </button>
      ))}
    </div>
  );
}
