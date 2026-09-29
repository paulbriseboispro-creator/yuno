import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Banknote, Check, Loader2, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  adminCoorgTransferIssues, adminResolveCoorgTransfer, coorgErrorCode, eur, type CoorgTransferIssue,
} from '@/lib/coorg';

const T1 = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2 = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const T3 = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const BORDER = 'rgb(var(--ink)/0.085)';
const F_BORDER = 'rgb(var(--ink)/0.055)';
const TILE_BG = 'rgb(var(--ink)/0.025)';
const CARD_BG = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
const RED = '#E8192C';
const WARN = 'var(--acc-fcd34d)';

/**
 * Virements de co-organisation qui demandent Yuno : impayés à échéance
 * dépassée, ou contestés (par le bénéficiaire, ou automatiquement faute de
 * confirmation sous 7 jours). Yuno ne touche jamais aux fonds : trancher, c'est
 * constater — « réglé » (preuve reçue) ou « annulé » (accord entre les
 * parties) — avec un motif obligatoire, visible des deux parties.
 * La carte se tait tant qu'il n'y a rien à trancher.
 */
export function AdminCoorgTransfersCard() {
  const { language } = useLanguage();
  const L = (fr: string, en: string, es: string) => (language === 'fr' ? fr : language === 'es' ? es : en);
  const [rows, setRows] = useState<CoorgTransferIssue[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    adminCoorgTransferIssues().then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);

  const resolve = async (id: string, outcome: 'received' | 'cancelled') => {
    setBusy(id);
    try {
      await adminResolveCoorgTransfer(id, outcome, notes[id] ?? '');
      toast.success(L('Virement tranché', 'Transfer resolved', 'Transferencia resuelta'));
      load();
    } catch (e) {
      toast.error(coorgErrorCode(e) === 'note_required'
        ? L('Motif obligatoire', 'A reason is required', 'Motivo obligatorio')
        : L('Action impossible', 'Action failed', 'Acción imposible'));
    } finally {
      setBusy(null);
    }
  };

  if (!rows || rows.length === 0) return null;

  return (
    <div id="coorg" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 22 }}>
      <div className="flex items-center gap-2">
        <Banknote className="h-4 w-4" style={{ color: WARN }} />
        <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>
          {L('Virements de co-organisation à trancher', 'Co-organization transfers to resolve', 'Transferencias de coorganización por resolver')}
        </h3>
      </div>
      <p className="mt-1" style={{ color: T3, fontSize: 12 }}>
        {L('Yuno ne touche pas aux fonds : on constate, avec un motif que les deux parties verront.',
          'Yuno never holds the funds: you record the outcome, with a reason both parties will see.',
          'Yuno no toca los fondos: se constata, con un motivo que verán ambas partes.')}
      </p>
      <div className="mt-3 space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="rounded-xl p-3" style={{ background: TILE_BG, border: `1px solid ${F_BORDER}` }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>
                {r.from_name ?? r.from} → {r.to_name ?? r.to}
              </span>
              <span style={{ color: T1, fontSize: 15, fontWeight: 700 }}>{eur(r.amount, language)}</span>
              <span className="rounded-full px-2 py-0.5" style={{
                fontSize: 11, fontWeight: 600,
                background: r.status === 'disputed' ? 'rgba(232,25,44,0.12)' : 'rgba(252,211,77,0.14)',
                color: r.status === 'disputed' ? RED : WARN,
              }}>
                {r.status === 'disputed'
                  ? L('Contesté', 'Disputed', 'Impugnado')
                  : L(`${r.days_late ?? 0} j de retard`, `${r.days_late ?? 0} d late`, `${r.days_late ?? 0} d de retraso`)}
              </span>
            </div>
            <p className="mt-1" style={{ color: T2, fontSize: 12 }}>
              <Link to={`/admin/events?q=${encodeURIComponent(r.event_title ?? '')}`} style={{ color: T2, textDecoration: 'underline' }}>
                {r.event_title ?? r.event_id}
              </Link>
              {' · '}{r.source === 'collab' ? L('Contrat collab sans Stripe', 'Collab agreement without Stripe', 'Contrato collab sin Stripe') : L('Co-organisation', 'Co-organisation', 'Coorganización')}
              {' · '}{r.reference}
              {r.sent_reference ? ` · ${L('réf. payeur', 'payer ref.', 'ref. pagador')} ${r.sent_reference}` : ''}
              {r.reminder_count > 0 ? ` · ${r.reminder_count} ${L('relance(s)', 'reminder(s)', 'recordatorio(s)')}` : ''}
            </p>
            {r.dispute_reason && (
              <p className="mt-1" style={{ color: T3, fontSize: 11.5 }}>
                {L('Motif', 'Reason', 'Motivo')} : {r.dispute_reason === 'auto:no_acknowledgement'
                  ? L('réception non confirmée sous 7 jours', 'receipt not confirmed within 7 days', 'recepción no confirmada en 7 días')
                  : r.dispute_reason}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={notes[r.id] ?? ''}
                onChange={(e) => setNotes((m) => ({ ...m, [r.id]: e.target.value }))}
                placeholder={L('Motif (obligatoire) : preuve reçue, accord des parties…', 'Reason (required): proof received, parties agreed…', 'Motivo (obligatorio): prueba recibida, acuerdo…')}
                className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5"
                style={{ background: 'rgb(var(--ink)/0.04)', border: `1px solid ${F_BORDER}`, color: T1, fontSize: 12 }}
              />
              <button
                onClick={() => resolve(r.id, 'received')}
                disabled={busy === r.id || !(notes[r.id] ?? '').trim()}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 disabled:opacity-40"
                style={{ background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.22)', color: 'var(--acc-34d399)', fontSize: 11.5, fontWeight: 600 }}>
                {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {L('Réglé', 'Paid', 'Pagado')}
              </button>
              <button
                onClick={() => resolve(r.id, 'cancelled')}
                disabled={busy === r.id || !(notes[r.id] ?? '').trim()}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 disabled:opacity-40"
                style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, color: T2, fontSize: 11.5, fontWeight: 600 }}>
                <X className="h-3.5 w-3.5" /> {L('Annulé', 'Cancelled', 'Anulado')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
