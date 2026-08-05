import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Banknote, Check, Copy, HandCoins, TriangleAlert } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { OrgCard, OrgButton, OrgPill, RED, POS, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import {
  computeSettlement, prepareSettlement, declareSettlementSent, confirmSettlementReceived,
  disputeSettlement, resolveSettlementDispute, cancelSettlement, getSettlementBankDetails,
  settlementErrorCode, type SettlementComputeResult,
} from '@/lib/collabSettlement';
import { formatIban, euro, daysUntil } from '@/lib/promoterPayout';

/**
 * Règlement du complément tables d'une co-soirée (base « total dépensé »).
 *
 * Ne s'affiche que si le contrat partage les tables sur le total dépensé
 * (split_rules.tables.basis = 'total_spend'). Même philosophie que le règlement
 * promoteur : le club vire par SEPA, l'organisateur confirme la réception —
 * personne ne solde unilatéralement, Yuno horodate l'accord.
 */
export function CollabTableSettlementCard({ eventId, viewerRole }: {
  eventId: string;
  viewerRole: 'venue' | 'organizer';
}) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const [data, setData] = useState<SettlementComputeResult | null>(null);
  const [bank, setBank] = useState<{ iban: string | null; bic: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');

  const isVenue = viewerRole === 'venue';

  const refresh = useCallback(async () => {
    try {
      const res = await computeSettlement(eventId);
      setData(res);
      if (res?.open_settlement && viewerRole === 'venue' && ['pending', 'approved', 'disputed'].includes(res.open_settlement.status)) {
        try {
          const b = await getSettlementBankDetails(res.open_settlement.id);
          setBank({ iban: b.iban, bic: b.bic });
        } catch { setBank(null); }
      } else {
        setBank(null);
      }
    } catch {
      // Pas partie prenante, ou RPC pas encore déployée : la carte se tait.
      setData(null);
    }
  }, [eventId, viewerRole]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!data?.eligible) return null;

  const open = data.open_settlement ?? null;
  const due = data.amount_due ?? 0;
  const settled = data.already_settled ?? 0;
  const pct = data.organizer_pct ?? 0;

  const errToast = (e: unknown) => {
    const code = settlementErrorCode(e);
    const msg: Record<string, string> = {
      organizer_iban_missing: t("L'organisateur n'a pas renseigné son IBAN (app organisateur → Paiements).", 'The organizer has not entered their IBAN yet (organizer app → Payments).', 'El organizador aún no ha introducido su IBAN (app de organizador → Pagos).'),
      iban_recently_changed: t("L'IBAN a changé il y a moins de 24 h — gel anti-fraude, réessaie demain.", 'The IBAN changed less than 24h ago — anti-fraud freeze, retry tomorrow.', 'El IBAN cambió hace menos de 24 h — bloqueo antifraude, reinténtalo mañana.'),
      settlement_already_open: t('Un règlement est déjà ouvert pour cette soirée.', 'A settlement is already open for this event.', 'Ya hay una liquidación abierta para esta noche.'),
      event_not_ended: t('La soirée doit être terminée pour figer le total dépensé.', 'The night must be over before the total spend can be frozen.', 'La noche debe haber terminado para fijar el gasto total.'),
    };
    toast.error(msg[code] ?? t('Erreur', 'Error', 'Error'));
  };

  const run = async (fn: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      await refresh();
    } catch (e) { errToast(e); } finally { setBusy(false); }
  };

  const copy = (v: string) => { void navigator.clipboard.writeText(v); toast.success(t('Copié', 'Copied', 'Copiado')); };

  const dleft = open ? daysUntil(open.confirm_due_at) : null;

  return (
    <OrgCard>
      <div className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <HandCoins className="h-4 w-4" style={{ color: RED }} />
          <h3 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>
            {t('Complément tables — total dépensé', 'Tables top-up — total spend', 'Complemento mesas — gasto total')}
          </h3>
          <OrgPill tone="muted">{pct}% {t('orga', 'org', 'org')}</OrgPill>
        </div>

        {/* Le calcul, lisible par les deux parties : mêmes chiffres, même vérité. */}
        <div className="grid grid-cols-2 gap-2" style={{ fontSize: 12 }}>
          <Cell label={t('Total dépensé (tables)', 'Total spend (tables)', 'Gasto total (mesas)')} value={euro(data.night_revenue ?? 0)} />
          <Cell label={t("Part orga (%s%)".replace('%s', String(pct)), `Org share (${pct}%)`, `Parte org (${pct}%)`)} value={euro(data.organizer_theoretical ?? 0)} />
          <Cell label={t('Déjà versé via Stripe (acomptes)', 'Already paid via Stripe (deposits)', 'Ya pagado vía Stripe (anticipos)')} value={euro(data.organizer_prepaid ?? 0)} />
          <Cell label={t('Complément dû', 'Top-up owed', 'Complemento debido')} value={euro(open ? open.amount : Math.max(0, due))} strong />
        </div>

        {settled > 0 && (
          <p className="flex items-center gap-1.5" style={{ color: POS, fontSize: 12 }}>
            <Check className="h-3.5 w-3.5" />
            {t('Complément déjà réglé et confirmé :', 'Top-up already settled and confirmed:', 'Complemento ya liquidado y confirmado:')} {euro(settled)}
          </p>
        )}

        {!data.event_ended && (
          <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.45 }}>
            {t(
              'Chiffres provisoires : le calcul se fige à la fin de la soirée, quand le total dépensé est connu.',
              'Provisional numbers: the calculation freezes once the night is over and the total spend is known.',
              'Cifras provisionales: el cálculo se fija al terminar la noche, cuando se conoce el gasto total.',
            )}
          </p>
        )}

        {/* ── Aucun lot ouvert ── */}
        {!open && data.event_ended && due > 0 && (
          isVenue ? (
            <div className="space-y-2">
              {!data.organizer_has_iban && (
                <p className="flex items-start gap-1.5" style={{ color: '#FCD34D', fontSize: 11.5 }}>
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {t("L'organisateur doit d'abord renseigner son IBAN (app organisateur → Paiements).", 'The organizer must first enter their IBAN (organizer app → Payments).', 'El organizador debe introducir primero su IBAN (app de organizador → Pagos).')}
                </p>
              )}
              <OrgButton variant="primary" size="sm" onClick={() => run(() => prepareSettlement(eventId), t('Règlement préparé', 'Settlement prepared', 'Liquidación preparada'))} disabled={busy}>
                <Banknote className="h-4 w-4" /> {t('Préparer le virement', 'Prepare the transfer', 'Preparar la transferencia')}
              </OrgButton>
            </div>
          ) : (
            <p style={{ color: T3, fontSize: 11.5 }}>
              {data.organizer_has_iban
                ? t('Le club prépare le virement de fin de soirée depuis cette même carte.', 'The club prepares the end-of-night transfer from this same card.', 'El club prepara la transferencia de fin de noche desde esta misma tarjeta.')
                : t('Renseigne ton IBAN dans Paiements pour recevoir ce virement.', 'Enter your IBAN in Payments to receive this transfer.', 'Introduce tu IBAN en Pagos para recibir esta transferencia.')}
            </p>
          )
        )}

        {/* ── Lot ouvert ── */}
        {open && (
          <div className="space-y-2 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            <div className="flex items-center justify-between">
              <span style={{ color: T2, fontSize: 12 }}>
                {open.status === 'pending' && t('Virement préparé', 'Transfer prepared', 'Transferencia preparada')}
                {open.status === 'approved' && t('Virement déclaré', 'Transfer declared', 'Transferencia declarada')}
                {open.status === 'disputed' && t('Litige', 'Dispute', 'Litigio')}
              </span>
              <strong style={{ color: T1, fontSize: 14 }}>{euro(open.amount)}</strong>
            </div>

            {open.transfer_reference && (
              <button type="button" onClick={() => copy(open.transfer_reference!)} className="flex items-center gap-1.5" style={{ color: T2, fontSize: 12 }}>
                <span className="font-mono">{open.transfer_reference}</span> <Copy className="h-3 w-3" style={{ color: T3 }} />
              </button>
            )}

            {isVenue && bank?.iban && open.status !== 'paid' && (
              <button type="button" onClick={() => copy(bank.iban!)} className="flex items-center gap-1.5" style={{ color: T2, fontSize: 12 }}>
                <span className="font-mono">{formatIban(bank.iban)}</span>
                {bank.bic && <span style={{ color: T3 }}>({bank.bic})</span>}
                <Copy className="h-3 w-3" style={{ color: T3 }} />
              </button>
            )}

            {open.status === 'approved' && dleft != null && (
              <p style={{ color: dleft < 0 ? '#FCD34D' : T3, fontSize: 11.5 }}>
                {dleft >= 0
                  ? t(`Accusé de réception attendu sous ${dleft} j.`, `Acknowledgement expected within ${dleft} day(s).`, `Acuse de recibo esperado en ${dleft} día(s).`)
                  : t('Délai dépassé — bascule en litige imminente.', 'Deadline passed — switching to dispute soon.', 'Plazo superado — pasará a litigio en breve.')}
              </p>
            )}

            {open.status === 'disputed' && open.dispute_reason && (
              <p style={{ color: '#FCD34D', fontSize: 11.5 }}>
                {open.dispute_reason === 'auto:no_acknowledgement'
                  ? t('Aucune réponse dans les délais.', 'No response within the deadline.', 'Sin respuesta dentro del plazo.')
                  : open.dispute_reason}
              </p>
            )}

            {/* Actions côté CLUB */}
            {isVenue && open.status === 'pending' && (
              <div className="flex gap-2 pt-1">
                <OrgButton variant="primary" size="sm" disabled={busy}
                  onClick={() => run(() => declareSettlementSent(open.id), t('Virement déclaré', 'Transfer declared', 'Transferencia declarada'))}>
                  {t("J'ai effectué le virement", 'I made the transfer', 'He realizado la transferencia')}
                </OrgButton>
                <OrgButton variant="ghost" size="sm" disabled={busy}
                  onClick={() => run(() => cancelSettlement(open.id), t('Règlement annulé', 'Settlement cancelled', 'Liquidación cancelada'))}>
                  {t('Annuler', 'Cancel', 'Cancelar')}
                </OrgButton>
              </div>
            )}
            {isVenue && open.status === 'approved' && (
              <p style={{ color: T3, fontSize: 11.5 }}>
                {t("En attente de la confirmation de l'organisateur.", "Waiting for the organizer's confirmation.", 'Esperando la confirmación del organizador.')}
              </p>
            )}
            {isVenue && open.status === 'disputed' && (
              <div className="flex gap-2 pt-1">
                <OrgButton variant="secondary" size="sm" disabled={busy}
                  onClick={() => run(() => resolveSettlementDispute(open.id, 'redeclare'), t('Virement re-déclaré', 'Transfer re-declared', 'Transferencia redeclarada'))}>
                  {t('Le virement est bien parti', 'The transfer did go out', 'La transferencia sí salió')}
                </OrgButton>
                <OrgButton variant="ghost" size="sm" disabled={busy}
                  onClick={() => run(() => resolveSettlementDispute(open.id, 'cancel'), t('Règlement annulé', 'Settlement cancelled', 'Liquidación cancelada'))}>
                  {t('Annuler le lot', 'Cancel the batch', 'Cancelar el lote')}
                </OrgButton>
              </div>
            )}

            {/* Actions côté ORGANISATEUR : lui seul solde. Un litige reste
                confirmable — l'argent a pu arriver en retard. */}
            {!isVenue && (open.status === 'approved' || open.status === 'disputed') && (
              <div className="space-y-2 pt-1">
                <p style={{ color: T1, fontSize: 12.5, fontWeight: 560 }}>
                  {t('Bien reçu sur ton compte ?', 'Received on your account?', '¿Recibido en tu cuenta?')}
                </p>
                <div className="flex gap-2">
                  <OrgButton variant="primary" size="sm" disabled={busy}
                    onClick={() => run(() => confirmSettlementReceived(open.id), t('Réception confirmée', 'Receipt confirmed', 'Recepción confirmada'))}>
                    <Check className="h-4 w-4" /> {t('Oui, bien reçu', 'Yes, received', 'Sí, recibido')}
                  </OrgButton>
                  {open.status === 'approved' && (
                    <OrgButton variant="ghost" size="sm" disabled={busy}
                      onClick={() => run(() => disputeSettlement(open.id, disputeReason.trim() || undefined), t('Litige ouvert', 'Dispute opened', 'Litigio abierto'))}>
                      {t('Rien reçu', 'Nothing received', 'Nada recibido')}
                    </OrgButton>
                  )}
                </div>
                {open.status === 'approved' && (
                  <input
                    value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)}
                    placeholder={t('Motif si rien reçu (facultatif)', 'Reason if nothing received (optional)', 'Motivo si no recibiste nada (opcional)')}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 10, fontSize: 12, background: 'transparent', border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
                  />
                )}
              </div>
            )}
            {!isVenue && open.status === 'pending' && (
              <p style={{ color: T3, fontSize: 11.5 }}>
                {t('Le club a préparé le virement — il doit maintenant le déclarer parti.', 'The club prepared the transfer — it now has to declare it sent.', 'El club preparó la transferencia — ahora debe declararla enviada.')}
              </p>
            )}
          </div>
        )}
      </div>
    </OrgCard>
  );
}

function Cell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg p-2.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <div style={{ color: T3, fontSize: 10.5 }}>{label}</div>
      <div style={{ color: strong ? '#fff' : T1, fontSize: strong ? 15 : 13, fontWeight: strong ? 650 : 560 }}>{value}</div>
    </div>
  );
}

export default CollabTableSettlementCard;
