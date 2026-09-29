import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeftRight, CalendarClock, Lock, Loader2 } from 'lucide-react';
import { OrgButton, OrgCard, OrgPill, OrgSectionLabel, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import {
  getCollabTransferStatement, freezeCollabTransferStatement, coorgErrorCode, eur,
  type CollabTransferStatement,
} from '@/lib/coorg';
import { useCoorgT, useCoorgErrorText } from '@/components/coorg/coorgUi';
import { CoorgTransferList } from '@/components/coorg/CoorgTransferList';
import { capturePosthog } from '@/lib/posthog';

/**
 * Contrat collab réglé SANS partage Stripe (« Répartir via Stripe ? » → Non).
 * Une partie encaisse tout ; cette carte montre, des deux côtés :
 *   • pendant la vente : la part de chacun, vente par vente (estimation vivante) ;
 *   • 48 h après la soirée (ou plus tôt, sur demande d'une partie qui tient
 *     l'argent) : le décompte FIGÉ et le virement à faire ;
 *   • puis le cycle promoteur : IBAN, « J'ai viré », « Bien reçu », relances,
 *     litige et arbitrage — la même mécanique que la co-organisation.
 * Se tait sur un contrat Stripe, sur un barème (le décompte de fin de soirée
 * porte déjà l'argent) et pour qui ne voit pas l'argent de sa structure.
 */
export function CollabTransferStatementCard({ eventId, tiered }: { eventId: string; tiered?: boolean }) {
  const { t, language } = useCoorgT();
  const errText = useCoorgErrorText();
  const [st, setSt] = useState<CollabTransferStatement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmFreeze, setConfirmFreeze] = useState(false);

  const load = useCallback(async () => {
    try {
      setSt(await getCollabTransferStatement(eventId));
    } catch (err) {
      console.warn('[collab-transfer] lecture', err);
      setSt(null);
    }
  }, [eventId]);
  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
      await load();
    } catch (err) {
      toast.error(errText(coorgErrorCode(err)));
    } finally {
      setBusy(null);
    }
  };

  if (tiered || !st?.ok || !st.figures?.ok || !st.event) return null;
  const f = st.figures;
  const names = st.names ?? {};
  const nameOf = (k: string) => names[k] || (k.startsWith('venue:') ? t('Le club', 'The club', 'El club') : t("L'organisateur", 'The organizer', 'El organizador'));
  const collectorName = nameOf(f.collector_key ?? '');
  const live = st.status === 'live';
  const fmtDate = (iso: string) => new Date(iso).toLocaleString(language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
  });
  const pillars = f.pillars;
  const rows = pillars ? ([
    { key: 'tickets', label: t('Billets', 'Tickets', 'Entradas'), p: pillars.tickets },
    { key: 'tables', label: t('Tables (acompte en ligne)', 'Tables (online deposit)', 'Mesas (depósito online)'), p: pillars.tables },
    { key: 'drinks', label: t('Boissons', 'Drinks', 'Bebidas'), p: pillars.drinks },
  ] as const).filter((r) => r.key !== 'drinks' || r.p.organizer > 0) : [];
  const transfer = f.transfer ?? null;

  return (
    <OrgCard className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <ArrowLeftRight className="h-4 w-4" style={{ color: T2 }} />
        <OrgSectionLabel>{t('Règlement par virement', 'Settlement by bank transfer', 'Liquidación por transferencia')}</OrgSectionLabel>
        <span className="ml-auto">
          <OrgPill tone={st.status === 'settled' ? 'success' : st.status === 'frozen' ? 'info' : 'muted'} dot={live}>
            {st.status === 'settled' ? t('Réglé', 'Settled', 'Liquidado')
              : st.status === 'frozen' ? t('Décompte arrêté', 'Statement closed', 'Liquidación cerrada')
                : t('Suivi en direct', 'Live tracking', 'Seguimiento en directo')}
          </OrgPill>
        </span>
      </div>
      <p className="mt-1" style={{ color: T3, fontSize: 12, lineHeight: 1.5 }}>
        {t(
          `${collectorName} encaisse toutes les ventes sur son compte. Yuno note la part de chacun à chaque vente, selon le contrat.`,
          `${collectorName} collects every sale on its own account. Yuno records each party's share on every sale, per the agreement.`,
          `${collectorName} cobra todas las ventas en su cuenta. Yuno anota la parte de cada uno en cada venta, según el contrato.`,
        )}
      </p>

      {rows.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-xl" style={{ border: `1px solid ${BORDER}` }}>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-2" style={{ background: INNER_BG, color: T3, fontSize: 11, fontWeight: 600 }}>
            <span>{t('Pilier', 'Pillar', 'Pilar')}</span>
            <span className="text-right">{t('Net', 'Net', 'Neto')}</span>
            <span className="text-right">{nameOf(f.org_key ?? '')}</span>
            <span className="text-right">{nameOf(f.venue_key ?? '')}</span>
          </div>
          {rows.map((r) => (
            <div key={r.key} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-2" style={{ borderTop: `1px solid ${BORDER}`, fontSize: 12.5 }}>
              <span style={{ color: T2 }}>{r.label} <span style={{ color: T3 }}>· {r.p.count}</span></span>
              <span className="text-right" style={{ color: T2 }}>{eur(r.p.net, language)}</span>
              <span className="text-right" style={{ color: T1 }}>{eur(r.p.organizer, language)}</span>
              <span className="text-right" style={{ color: T1 }}>{eur(r.p.venue, language)}</span>
            </div>
          ))}
        </div>
      )}
      {f.tables_basis === 'total_spend' && (
        <p className="mt-2" style={{ color: T3, fontSize: 11.5 }}>
          {t('Tables au total dépensé : elles se règlent par le décompte des tables de fin de soirée.',
            'Tables on total spend: they are settled by the end-of-night table statement.',
            'Mesas sobre el gasto total: se liquidan con la liquidación de mesas del final de la noche.')}
        </p>
      )}

      <div className="mt-3 rounded-xl p-3" style={{ background: INNER_BG }}>
        {transfer ? (
          <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>
            {live ? t('À ce stade', 'So far', 'Por ahora') : t('À régler', 'To settle', 'A liquidar')} : {nameOf(transfer.from)} → {nameOf(transfer.to)} · {eur(transfer.amount, language)}
          </p>
        ) : (
          <p style={{ color: T2, fontSize: 13 }}>{t('Rien à virer pour le moment.', 'Nothing to transfer yet.', 'Nada que transferir por ahora.')}</p>
        )}
        <p className="mt-1 flex items-center gap-1.5" style={{ color: T3, fontSize: 11.5 }}>
          {live ? <CalendarClock className="h-3 w-3 shrink-0" /> : <Lock className="h-3 w-3 shrink-0" />}
          {live
            ? t(
              `Décompte arrêté automatiquement le ${fmtDate(st.event.auto_freeze_at)} (48 h après la soirée, remboursements déduits), puis virement sous ${f.payment_terms_days ?? 15} jours.`,
              `Statement closed automatically on ${fmtDate(st.event.auto_freeze_at)} (48 h after the night, refunds deducted), then transfer within ${f.payment_terms_days ?? 15} days.`,
              `Liquidación cerrada automáticamente el ${fmtDate(st.event.auto_freeze_at)} (48 h después de la noche, reembolsos descontados), luego transferencia en ${f.payment_terms_days ?? 15} días.`,
            )
            : t(
              `Arrêté le ${fmtDate(st.frozen_at ?? st.event.auto_freeze_at)}. Ces chiffres ne bougent plus.`,
              `Closed on ${fmtDate(st.frozen_at ?? st.event.auto_freeze_at)}. These figures no longer change.`,
              `Cerrada el ${fmtDate(st.frozen_at ?? st.event.auto_freeze_at)}. Estas cifras ya no cambian.`,
            )}
        </p>
      </div>

      {live && st.event.ended && (st.my_parties ?? []).length > 0 && (
        <div className="mt-3">
          {!confirmFreeze ? (
            <OrgButton size="sm" variant="secondary" onClick={() => setConfirmFreeze(true)} disabled={!!busy}>
              <Lock className="h-3.5 w-3.5" /> {t('Arrêter le décompte maintenant', 'Close the statement now', 'Cerrar la liquidación ahora')}
            </OrgButton>
          ) : (
            <div className="rounded-xl p-3" style={{ border: `1px solid ${BORDER}` }}>
              <p style={{ color: T2, fontSize: 12.5 }}>
                {t('Après l’arrêt, un remboursement ne change plus le décompte : il se partage entre vous au prorata. Sans action, Yuno arrête le décompte tout seul 48 h après la soirée.',
                  'Once closed, a refund no longer changes the statement: you share it pro-rata. If you do nothing, Yuno closes it on its own 48 h after the night.',
                  'Tras el cierre, un reembolso ya no cambia la liquidación: se reparte entre vosotros a prorrata. Si no hacéis nada, Yuno la cierra sola 48 h después de la noche.')}
              </p>
              <div className="mt-2 flex gap-2">
                <OrgButton size="sm" variant="primary" disabled={!!busy}
                  onClick={() => run('freeze', async () => {
                    await freezeCollabTransferStatement(eventId);
                    capturePosthog('collab_transfer_statement_frozen', { event_id: eventId, manual: true });
                    setConfirmFreeze(false);
                  }, t('Décompte arrêté', 'Statement closed', 'Liquidación cerrada'))}>
                  {busy === 'freeze' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
                  {t('Arrêter', 'Close', 'Cerrar')}
                </OrgButton>
                <OrgButton size="sm" variant="ghost" onClick={() => setConfirmFreeze(false)}>{t('Annuler', 'Cancel', 'Cancelar')}</OrgButton>
              </div>
            </div>
          )}
        </div>
      )}

      {(st.transfers ?? []).length > 0 && (
        <div className="mt-4">
          <OrgSectionLabel>{t('Virement', 'Transfer', 'Transferencia')}</OrgSectionLabel>
          <CoorgTransferList transfers={st.transfers ?? []} nameOf={nameOf} eventId={eventId} busy={busy} run={run} />
        </div>
      )}
    </OrgCard>
  );
}
