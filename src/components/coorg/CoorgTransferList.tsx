import { useState } from 'react';
import { BellRing, CalendarClock, Check, HandCoins, TriangleAlert } from 'lucide-react';
import { OrgButton, OrgPill, DarkInput, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import {
  setCoorgTransferIban, declareCoorgTransferSent, confirmCoorgTransfer, nudgeCoorgTransfer, eur,
  transferDaysLate, canNudgeTransfer, type CoorgTransfer,
} from '@/lib/coorg';
import { capturePosthog } from '@/lib/posthog';
import { useCoorgT } from './coorgUi';

type Runner = (key: string, fn: () => Promise<unknown>, ok?: string) => Promise<void>;

/**
 * Les virements d'un décompte, de banque à banque : le bénéficiaire donne son
 * IBAN, le payeur annonce « J'ai viré », SEUL le bénéficiaire confirme « Bien
 * reçu » (ou conteste), relance une fois par 24 h. Partagé par la
 * co-organisation (N parties) et le contrat collab réglé SANS Stripe : un seul
 * cycle, les mêmes RPC, le même suivi (échéances, relances, litige, arbitrage).
 */
export function CoorgTransferList({ transfers, nameOf, eventId, busy, run }: {
  transfers: CoorgTransfer[];
  nameOf: (key: string) => string;
  eventId: string;
  busy: string | null;
  run: Runner;
}) {
  const { t, language } = useCoorgT();
  const [ibans, setIbans] = useState<Record<string, string>>({});
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [disputes, setDisputes] = useState<Record<string, string>>({});
  return (
    <>
    <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>
      {t('De banque à banque. Le payeur déclare, seul le bénéficiaire confirme.',
        'Bank to bank. The payer declares, only the payee confirms.',
        'De banco a banco. El pagador declara, solo el beneficiario confirma.')}
    </p>
    <div className="mt-3 space-y-2">
      {transfers.map((tr) => { const late = transferDaysLate(tr); return (
        <div key={tr.id} className="rounded-xl p-3" style={{ border: `1px solid ${BORDER}` }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>
              {nameOf(tr.from)} → {nameOf(tr.to)}
            </span>
            <span style={{ color: T1, fontSize: 15, fontWeight: 700 }}>{eur(tr.amount, language)}</span>
            <OrgPill tone={tr.status === 'received' ? 'success' : tr.status === 'disputed' ? 'danger' : tr.status === 'sent' ? 'info' : tr.status === 'cancelled' ? 'muted' : late !== null ? 'danger' : 'warn'}>
              {tr.status === 'received' ? t('Reçu', 'Received', 'Recibido')
                : tr.status === 'sent' ? t('Annoncé', 'Announced', 'Anunciado')
                  : tr.status === 'disputed' ? t('Contesté', 'Disputed', 'Impugnado')
                    : tr.status === 'cancelled' ? t('Annulé', 'Cancelled', 'Cancelado')
                      : late !== null ? (late === 0 ? t('Dû aujourd’hui', 'Due today', 'Vence hoy') : t(`En retard · ${late} j`, `Late · ${late} d`, `Con retraso · ${late} d`))
                        : t('À faire', 'To do', 'Pendiente')}
            </OrgPill>
          </div>
          <p className="mt-1" style={{ color: T3, fontSize: 11.5 }}>
            {t('Référence', 'Reference', 'Referencia')} <b style={{ color: T2 }}>{tr.reference}</b>
            {tr.payee_iban ? ` · IBAN ${tr.payee_iban.replace(/(.{4})/g, '$1 ').trim()}` : ''}
            {tr.dispute_reason ? ` · ${t('Motif', 'Reason', 'Motivo')} : ${tr.dispute_reason === 'auto:no_acknowledgement'
              ? t('réception non confirmée dans les 7 jours', 'receipt not confirmed within 7 days', 'recepción no confirmada en 7 días')
              : tr.dispute_reason}` : ''}
          </p>
          <TransferTimeline tr={tr} language={language} />

          {tr.i_receive && !tr.payee_iban && (tr.status === 'pending' || tr.status === 'disputed') && (
            <div className="mt-2 flex gap-2">
              <DarkInput value={ibans[tr.id] ?? ''} onChange={(v) => setIbans((m) => ({ ...m, [tr.id]: v }))} placeholder="FR76 …" />
              <OrgButton size="sm" variant="secondary" disabled={!!busy}
                onClick={() => run(`iban:${tr.id}`, () => setCoorgTransferIban(tr.id, ibans[tr.id] ?? ''))}>
                {t('Donner mon IBAN', 'Share my IBAN', 'Dar mi IBAN')}
              </OrgButton>
            </div>
          )}
          {tr.i_pay && (tr.status === 'pending' || tr.status === 'disputed') && (
            <div className="mt-2 flex gap-2">
              <DarkInput value={refs[tr.id] ?? ''} onChange={(v) => setRefs((m) => ({ ...m, [tr.id]: v }))}
                placeholder={t('Référence du virement (facultatif)', 'Transfer reference (optional)', 'Referencia de la transferencia (opcional)')} />
              <OrgButton size="sm" variant="primary" disabled={!!busy}
                onClick={() => run(`sent:${tr.id}`, () => declareCoorgTransferSent(tr.id, refs[tr.id]),
                  t('Virement annoncé', 'Transfer announced', 'Transferencia anunciada'))}>
                <HandCoins className="h-4 w-4" /> {t('J’ai viré', 'I have paid', 'He transferido')}
              </OrgButton>
            </div>
          )}
          {tr.i_receive && (tr.status === 'sent' || tr.status === 'pending' || tr.status === 'disputed') && (
            <div className="mt-2 flex flex-wrap gap-2">
              {canNudgeTransfer(tr) && tr.status !== 'sent' && (
                <OrgButton size="sm" variant="secondary" disabled={!!busy}
                  onClick={() => run(`nudge:${tr.id}`, async () => {
                    await nudgeCoorgTransfer(tr.id);
                    capturePosthog('coorg_transfer_nudged', { event_id: eventId, days_late: late ?? 0 });
                  }, t('Relance envoyée', 'Reminder sent', 'Recordatorio enviado'))}>
                  <BellRing className="h-3.5 w-3.5" /> {t('Relancer', 'Send a reminder', 'Recordar')}
                </OrgButton>
              )}
              <OrgButton size="sm" variant="primary" disabled={!!busy}
                onClick={() => run(`recv:${tr.id}`, () => confirmCoorgTransfer(tr.id, true),
                  t('Réception confirmée', 'Receipt confirmed', 'Recepción confirmada'))}>
                <Check className="h-4 w-4" /> {t('Bien reçu', 'Received', 'Recibido')}
              </OrgButton>
              {tr.status === 'sent' && (
                <>
                  <DarkInput value={disputes[tr.id] ?? ''} onChange={(v) => setDisputes((m) => ({ ...m, [tr.id]: v }))}
                    placeholder={t('Rien reçu ? Explique', 'Nothing received? Explain', '¿Nada recibido? Explica')} className="max-w-xs" />
                  <OrgButton size="sm" variant="danger" disabled={!!busy || !(disputes[tr.id] ?? '').trim()}
                    onClick={() => run(`disp:${tr.id}`, () => confirmCoorgTransfer(tr.id, false, disputes[tr.id]))}>
                    <TriangleAlert className="h-3.5 w-3.5" /> {t('Contester', 'Dispute', 'Impugnar')}
                  </OrgButton>
                </>
              )}
            </div>
          )}
          {tr.resolved_by_admin && tr.admin_note && (
            <p className="mt-2 rounded-lg px-2.5 py-1.5" style={{ background: INNER_BG, color: T2, fontSize: 11.5 }}>
              {t('Tranché par Yuno', 'Resolved by Yuno', 'Resuelto por Yuno')} · {tr.admin_note}
            </p>
          )}
        </div>
      ); })}
    </div>
    </>
  );
}

/** Échéance, relances, délai de confirmation : ce que Yuno surveille pour ce virement. */
function TransferTimeline({ tr, language }: { tr: CoorgTransfer; language: string }) {
  const { t } = useCoorgT();
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR', {
    day: 'numeric', month: 'short', timeZone: 'Europe/Paris',
  });
  const bits: string[] = [];
  if (tr.status === 'pending' && tr.due_at) bits.push(`${t('À virer avant le', 'Due by', 'Pagar antes del')} ${fmt(tr.due_at)}`);
  if (tr.status === 'sent' && tr.confirm_due_at) bits.push(`${t('Réception à confirmer avant le', 'Receipt to confirm by', 'Confirmar recepción antes del')} ${fmt(tr.confirm_due_at)}`);
  if ((tr.reminder_count ?? 0) > 0 && tr.status !== 'received' && tr.status !== 'cancelled') {
    const n = tr.reminder_count ?? 0;
    bits.push(n === 1 ? t('1 relance envoyée', '1 reminder sent', '1 recordatorio enviado') : t(`${n} relances envoyées`, `${n} reminders sent`, `${n} recordatorios enviados`));
  }
  if (tr.escalated_at && tr.status === 'pending') bits.push(t('toutes les parties prévenues', 'every party notified', 'todas las partes avisadas'));
  if (tr.status === 'received' && tr.received_at) bits.push(`${t('Reçu le', 'Received on', 'Recibido el')} ${fmt(tr.received_at)}`);
  if (!bits.length) return null;
  return (
    <p className="mt-1 flex items-center gap-1.5" style={{ color: T3, fontSize: 11.5 }}>
      <CalendarClock className="h-3 w-3 shrink-0" /> {bits.join(' · ')}
    </p>
  );
}
