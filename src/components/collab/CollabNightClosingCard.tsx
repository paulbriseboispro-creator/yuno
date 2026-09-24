import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Banknote, Check, Copy, HandCoins, Lock, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { OrgCard, OrgButton, OrgPill, RED, POS, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import {
  computeNightClosing, declareNightClosing, acceptNightClosing, disputeNightClosing, cancelNightClosing,
  closingErrorCode, type ClosingComputeResult, type ClosingDeclaration,
} from '@/lib/collabNightClosing';
import {
  declareSettlementSent, confirmSettlementReceived, disputeSettlement, resolveSettlementDispute,
  getSettlementBankDetails, settlementErrorCode,
} from '@/lib/collabSettlement';
import { tierFor } from '@/lib/splitRules';
import { ActionFigure, ActionOverlay, ActionResultCard } from '@/components/action/ActionOverlay';
import { formatIban, daysUntil } from '@/lib/promoterPayout';

const eur = (n: number | null | undefined) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(n ?? 0));

/**
 * Décompte de fin de soirée d'une collab à BARÈME. Se tait si le contrat
 * partage par pilier. Montée des deux côtés (club / organisateur), à toutes les
 * phases : avant et pendant la soirée elle explique la retenue et montre les
 * fonds sécurisés ; après, elle porte la déclaration du club, la validation de
 * l'organisateur et le suivi du paiement (Stripe depuis les fonds retenus, puis
 * SEPA pour le reste).
 */
export function CollabNightClosingCard({ eventId, viewerRole }: {
  eventId: string;
  viewerRole: 'venue' | 'organizer';
}) {
  const { language, t: tk } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const isVenue = viewerRole === 'venue';

  const [data, setData] = useState<ClosingComputeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ClosingDeclaration>({ bar: 0, doorCount: 0, doorTickets: 0, tablesExtra: 0, other: 0, otherLabel: '', note: '', evidence: '' });
  const [disputeReason, setDisputeReason] = useState('');
  const [bank, setBank] = useState<{ iban: string | null; bic: string | null } | null>(null);
  // Écran de répartition. Une seule étape : tout se joue dans UN appel serveur
  // (`accept_collab_night_closing` refige les chiffres, applique le barème,
  // alloue sur les jambes retenues et crée le lot SEPA). Afficher une liste
  // d'étapes serait inventer des jalons que le code ne sait pas observer.
  const [runOpen, setRunOpen] = useState(false);
  const [runStage, setRunStage] = useState(0);
  const [runResult, setRunResult] = useState<{ due: number; online: number; sepa: number } | null>(null);
  // Une seule bande : elle ne sert qu'au rythme de la barre, la liste d'étapes
  // reste masquée (`showSteps={false}`). Déclarée ICI, au-dessus du
  // `return null` de la ligne « carte non éligible » : l'ordre des hooks de
  // React doit être le même à chaque rendu.
  const runSteps = useMemo(() => [{ key: 'settle', label: tk('owner.closingrun.s1'), seconds: 2.4 }], [tk]);

  const refresh = useCallback(async () => {
    try {
      const res = await computeNightClosing(eventId);
      setData(res);
      const s = res?.settlement;
      if (s && viewerRole === 'venue' && ['pending', 'approved', 'disputed'].includes(s.status)) {
        try {
          const b = await getSettlementBankDetails(s.id);
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

  const closing = data?.closing ?? null;
  const rem = useMemo(() => (data?.tiers ? { mode: 'tiered_total' as const, tiers: data.tiers, tiers_mode: data.tiers_mode } : null), [data]);

  // Le formulaire s'amorce sur la déclaration existante (redéclaration).
  useEffect(() => {
    if (!closing) return;
    setForm({
      bar: Number(closing.declared_bar ?? 0),
      doorCount: Number(closing.declared_door_count ?? 0),
      doorTickets: Number(closing.declared_door_tickets ?? 0),
      tablesExtra: Number(closing.declared_tables_extra ?? 0),
      other: Number(closing.declared_other ?? 0),
      otherLabel: closing.declared_other_label ?? '',
      note: closing.declared_note ?? '',
      evidence: closing.declared_evidence ?? '',
    });
  }, [closing?.id, closing?.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data?.eligible || !rem) return null;

  const yuno = data.yuno ?? { tickets: 0, tickets_count: 0, tables: 0, tables_count: 0, drinks: 0, drinks_count: 0 };
  const yunoTotal = yuno.tickets + yuno.tables + yuno.drinks;
  const held = data.held_amount ?? 0;
  const proj = data.projection ?? { total: yunoTotal, pct: 0, due: 0, online: 0, sepa: 0 };
  const settlement = data.settlement ?? null;
  const accepted = closing?.status === 'accepted';

  // Ce que le formulaire en cours donnerait (côté club, avant d'envoyer).
  const draftDeclared = form.bar + form.doorTickets + form.tablesExtra + form.other;
  const draftTotal = yunoTotal + draftDeclared;
  const draft = tierFor(rem, draftTotal);
  const draftOnline = data.organizer_stripe_ready ? Math.min(draft.amount, held) : 0;
  const draftSepa = Math.max(0, Math.round((draft.amount - draftOnline) * 100) / 100);

  const errToast = (e: unknown) => {
    const code = closingErrorCode(e);
    const code2 = settlementErrorCode(e);
    const msg: Record<string, string> = {
      organizer_iban_missing: t("L'organisateur doit d'abord renseigner son IBAN (Console organisateur → Paiements) : une partie du dû passe par virement.", 'The organizer must first enter their IBAN (organizer Console → Payments): part of what is owed goes by bank transfer.', 'El organizador debe introducir primero su IBAN (Consola organizador → Pagos): parte de lo debido va por transferencia.'),
      iban_recently_changed: t("L'IBAN a changé il y a moins de 24 h — gel anti-fraude, réessaie demain.", 'The IBAN changed less than 24h ago — anti-fraud freeze, retry tomorrow.', 'El IBAN cambió hace menos de 24 h — bloqueo antifraude, reinténtalo mañana.'),
      settlement_already_open: t('Un règlement est déjà ouvert pour cette soirée.', 'A settlement is already open for this event.', 'Ya hay una liquidación abierta para esta noche.'),
      event_not_ended: t('La soirée doit être terminée pour déclarer le chiffre.', 'The night must be over before declaring the figures.', 'La noche debe haber terminado para declarar las cifras.'),
      closing_already_accepted: t('Ce décompte est déjà accepté : il ne bouge plus.', 'This closing is already accepted: it no longer changes.', 'Este cierre ya está aceptado: ya no cambia.'),
      closing_not_declared: t('La déclaration a changé entre-temps, recharge la carte.', 'The declaration changed meanwhile, reload the card.', 'La declaración cambió mientras tanto, recarga la tarjeta.'),
      support_session_forbidden: t('Interdit en accès assisté.', 'Not allowed in assisted access.', 'No permitido en acceso asistido.'),
    };
    toast.error(msg[code] ?? msg[code2] ?? (e as { message?: string })?.message ?? t('Erreur', 'Error', 'Error'));
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

  /**
   * Accepter le décompte — de l'argent, et irréversible. L'écran de
   * répartition remplace le toast : il nomme les deux montants que le pro veut
   * voir, ce que `accept_collab_night_closing` rend déjà (`due`, `online`,
   * `sepa`) et que personne ne lui montrait.
   */
  const acceptClosing = async (closingId: string) => {
    if (busy) return;
    setBusy(true);
    setRunStage(0);
    setRunResult(null);
    setRunOpen(true);
    try {
      const res = await acceptNightClosing(closingId);
      await refresh();
      setRunResult({
        due: Number(res.due) || 0,
        online: Number(res.online) || 0,
        sepa: Number(res.sepa) || 0,
      });
      setRunStage(1); // la répartition est écrite et l'écran est à jour
    } catch (e) {
      // L'écran se retire : un compteur figé par-dessus un refus d'argent ne
      // dirait rien à personne.
      setRunOpen(false);
      errToast(e);
    } finally {
      setBusy(false);
    }
  };

  const copy = (v: string) => { void navigator.clipboard.writeText(v); toast.success(t('Copié', 'Copied', 'Copiado')); };
  const num = (v: string) => Math.max(0, Number(String(v).replace(',', '.')) || 0);

  const tierLabel = (pct: number) => `${t('Palier', 'Tier', 'Tramo')} ${pct}%`;

  return (
    <OrgCard>
      <div className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <HandCoins className="h-4 w-4" style={{ color: RED }} />
          <h3 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>
            {t('Décompte de soirée — barème sur le CA', "Night closing — tiers on revenue", 'Cierre de noche — escala sobre facturación')}
          </h3>
          {closing && (
            <OrgPill tone={accepted ? 'success' : closing.status === 'disputed' ? 'warn' : 'info'} dot>
              {accepted ? t('Accepté', 'Accepted', 'Aceptado')
                : closing.status === 'disputed' ? t('Contesté', 'Disputed', 'Impugnado')
                : t('À valider par l\'organisateur', 'Awaiting organizer', 'Pendiente del organizador')}
            </OrgPill>
          )}
        </div>

        {/* ── Le barème et la retenue, dits pareil des deux côtés ── */}
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{t('Barème', 'Tiers', 'Escala')}</p>
            <ul className="mt-1 space-y-0.5 tabular-nums" style={{ fontSize: 12 }}>
              {[...rem.tiers].sort((a, b) => a.from - b.from).map((tier, i, arr) => {
                const next = arr[i + 1];
                const active = (accepted ? closing?.tier_pct : proj.pct) === tier.pct
                  && tier.from <= (accepted ? Number(closing?.total_revenue ?? 0) : proj.total)
                  && (!next || next.from > (accepted ? Number(closing?.total_revenue ?? 0) : proj.total));
                return (
                  <li key={i} className="flex justify-between gap-2" style={{ color: active ? T1 : T2, fontWeight: active ? 650 : 400 }}>
                    <span>{next ? `${eur(tier.from)} – ${eur(next.from)}` : `≥ ${eur(tier.from)}`}</span>
                    <span>{tier.pct}%</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-1" style={{ color: T3, fontSize: 10.5 }}>
              {rem.tiers_mode === 'marginal'
                ? t('Chaque tranche à son taux.', 'Each bracket at its own rate.', 'Cada tramo a su tasa.')
                : t('Le taux du palier atteint s\'applique à tout le total.', 'The rate reached applies to the whole total.', 'La tasa alcanzada se aplica a todo el total.')}
            </p>
          </div>
          <div className="rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            <p className="flex items-center gap-1.5" style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              <ShieldCheck className="h-3.5 w-3.5" style={{ color: POS }} /> {t('Sécurisé par Yuno', 'Secured by Yuno', 'Asegurado por Yuno')}
            </p>
            <p className="tabular-nums" style={{ color: T1, fontSize: 20, fontWeight: 700 }}>{eur(accepted ? closing?.held_amount : held)}</p>
            <p style={{ color: T3, fontSize: 11, lineHeight: 1.45 }}>
              {t(
                'Billets et tables vendus via Yuno, net des frais Stripe. Retenus sur la plateforme, ils ne sont versés à personne avant le décompte accepté : la part de l\'organisateur part d\'abord de là.',
                'Tickets and tables sold through Yuno, net of Stripe fees. Held on the platform, they are paid to nobody before the closing is accepted: the organizer\'s share comes out of this first.',
                'Entradas y mesas vendidas vía Yuno, netas de comisiones Stripe. Retenidas en la plataforma, no se pagan a nadie antes del cierre aceptado: la parte del organizador sale primero de aquí.',
              )}
            </p>
            {!data.organizer_stripe_ready && (
              <p className="mt-1 flex items-start gap-1.5" style={{ color: 'var(--acc-fcd34d)', fontSize: 11 }}>
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {isVenue
                  ? t("L'organisateur n'a pas de compte Stripe actif : tout son dû passera par virement de ta part.", 'The organizer has no active Stripe account: everything owed will go by bank transfer from you.', 'El organizador no tiene cuenta Stripe activa: todo lo debido irá por transferencia tuya.')
                  : t('Active ton compte Stripe (Paiements) pour être payé directement depuis ces fonds retenus. Sinon tout passe par un virement du club.', 'Activate your Stripe account (Payments) to be paid straight from these held funds. Otherwise everything goes through a bank transfer from the club.', 'Activa tu cuenta Stripe (Pagos) para cobrar directamente de estos fondos retenidos. Si no, todo irá por transferencia del club.')}
              </p>
            )}
          </div>
        </div>

        {/* ── Avant la fin : rien à déclarer encore ── */}
        {!data.event_ended && (
          <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.45 }}>
            {isVenue
              ? t('À la fin de la soirée, tu déclareras ici le chiffre hors Yuno (bar en caisse, billets à la porte, extras des tables). Yuno ajoutera ses propres ventes, appliquera le barème et l\'organisateur validera.', 'When the night is over, you will declare here the revenue outside Yuno (bar till, door tickets, table extras). Yuno adds its own sales, applies the tiers and the organizer validates.', 'Al final de la noche declararás aquí la facturación fuera de Yuno (caja de barra, entradas en puerta, extras de mesas). Yuno añade sus ventas, aplica la escala y el organizador valida.')
              : t('À la fin de la soirée, le club déclare le chiffre hors Yuno. Tu verras la même grille que lui et tu valideras ou contesteras. Rien ne part avant ta validation.', 'When the night is over, the club declares the revenue outside Yuno. You will see the same grid and validate or dispute. Nothing is paid before your validation.', 'Al final de la noche, el club declara la facturación fuera de Yuno. Verás la misma tabla y validarás o impugnarás. Nada se paga antes de tu validación.')}
          </p>
        )}

        {/* ── La grille : Yuno + déclaré = total → palier → dû ── */}
        {data.event_ended && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" style={{ fontSize: 12 }}>
              <Cell label={`${t('Billets via Yuno', 'Tickets via Yuno', 'Entradas vía Yuno')} · ${yuno.tickets_count}`} value={eur(accepted ? closing?.yuno_tickets : yuno.tickets)} />
              <Cell label={`${t('Tables via Yuno', 'Tables via Yuno', 'Mesas vía Yuno')} · ${yuno.tables_count}`} value={eur(accepted ? closing?.yuno_tables : yuno.tables)} />
              <Cell label={`${t('Boissons via Yuno', 'Drinks via Yuno', 'Bebidas vía Yuno')} · ${yuno.drinks_count}`} value={eur(accepted ? closing?.yuno_drinks : yuno.drinks)} />
            </div>

            {/* Déclaration du club : formulaire (club, tant que pas accepté) ou lecture. */}
            {isVenue && !accepted && (editing || !closing) ? (
              <div className="space-y-2 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <p style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>
                  {t('Ce que Yuno ne voit pas — déclaré par le club (TTC)', 'What Yuno cannot see — declared by the club (incl. VAT)', 'Lo que Yuno no ve — declarado por el club (IVA incl.)')}
                </p>
                <Field label={t('Bar en caisse, hors commandes Yuno (€)', 'Bar till, excluding Yuno orders (€)', 'Caja de barra, sin pedidos Yuno (€)')}
                  value={form.bar} onChange={(v) => setForm({ ...form, bar: num(v) })} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t('Billets vendus à la porte (nombre)', 'Door tickets (count)', 'Entradas en puerta (número)')}
                    value={form.doorCount} onChange={(v) => setForm({ ...form, doorCount: Math.round(num(v)) })} integer />
                  <Field label={t('Billets à la porte (€)', 'Door tickets (€)', 'Entradas en puerta (€)')}
                    value={form.doorTickets} onChange={(v) => setForm({ ...form, doorTickets: num(v) })} />
                </div>
                <Field label={t('Tables : consommations au-delà des formules, sur place (€)', 'Tables: spend beyond the packages, on site (€)', 'Mesas: consumo más allá de los paquetes, in situ (€)')}
                  value={form.tablesExtra} onChange={(v) => setForm({ ...form, tablesExtra: num(v) })} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t('Autre (€)', 'Other (€)', 'Otro (€)')}
                    value={form.other} onChange={(v) => setForm({ ...form, other: num(v) })} />
                  <TextField label={t('Libellé de « autre »', 'Label for "other"', 'Etiqueta de «otro»')}
                    value={form.otherLabel ?? ''} onChange={(v) => setForm({ ...form, otherLabel: v })} placeholder={t('vestiaire, entrées offertes…', 'cloakroom, comped entries…', 'guardarropa, entradas invitadas…')} />
                </div>
                <TextField label={t('Référence du ticket Z / justificatif', 'Z-report reference / evidence', 'Referencia del cierre de caja / justificante')}
                  value={form.evidence ?? ''} onChange={(v) => setForm({ ...form, evidence: v })} placeholder={t('n° de clôture de caisse, lien vers la photo…', 'till closing no., link to the photo…', 'n.º de cierre de caja, enlace a la foto…')} />
                <TextField label={t('Note pour l\'organisateur', 'Note for the organizer', 'Nota para el organizador')}
                  value={form.note ?? ''} onChange={(v) => setForm({ ...form, note: v })} />

                <div className="grid grid-cols-2 gap-2 pt-1" style={{ fontSize: 12 }}>
                  <Cell label={t('Total de la soirée', 'Night total', 'Total de la noche')} value={eur(draftTotal)} />
                  <Cell label={tierLabel(draft.pct)} value={eur(draft.amount)} strong />
                </div>
                <p style={{ color: T3, fontSize: 11, lineHeight: 1.45 }}>
                  {t('Dont', 'Of which', 'De los cuales')} <strong style={{ color: T2 }}>{eur(draftOnline)}</strong> {t('depuis les fonds retenus (virement Stripe automatique)', 'from the held funds (automatic Stripe transfer)', 'de los fondos retenidos (transferencia Stripe automática)')}
                  {draftSepa > 0 && <> {t('et', 'and', 'y')} <strong style={{ color: T2 }}>{eur(draftSepa)}</strong> {t('à virer par le club (SEPA, référence fournie).', 'to be wired by the club (SEPA, reference provided).', 'a transferir por el club (SEPA, referencia facilitada).')}</>}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <OrgButton variant="primary" size="sm" disabled={busy}
                    onClick={() => run(async () => { await declareNightClosing(eventId, form); setEditing(false); }, t('Déclaration envoyée à l\'organisateur', 'Declaration sent to the organizer', 'Declaración enviada al organizador'))}>
                    <Banknote className="h-4 w-4" /> {closing ? t('Renvoyer la déclaration', 'Resend the declaration', 'Reenviar la declaración') : t('Déclarer et envoyer', 'Declare and send', 'Declarar y enviar')}
                  </OrgButton>
                  {closing && (
                    <OrgButton variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(false)}>
                      {t('Annuler', 'Cancel', 'Cancelar')}
                    </OrgButton>
                  )}
                </div>
              </div>
            ) : closing ? (
              <div className="space-y-2 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>
                    {t('Déclaré par le club', 'Declared by the club', 'Declarado por el club')}
                    <span style={{ color: T3, fontWeight: 400 }}> · {t('version', 'version', 'versión')} {closing.revision}</span>
                  </p>
                  {accepted && <Lock className="h-3.5 w-3.5" style={{ color: T3 }} />}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" style={{ fontSize: 12 }}>
                  <Cell label={t('Bar en caisse', 'Bar till', 'Caja de barra')} value={eur(closing.declared_bar)} />
                  <Cell label={`${t('Billets porte', 'Door tickets', 'Entradas puerta')} · ${closing.declared_door_count}`} value={eur(closing.declared_door_tickets)} />
                  <Cell label={t('Extras tables', 'Table extras', 'Extras mesas')} value={eur(closing.declared_tables_extra)} />
                  <Cell label={closing.declared_other_label || t('Autre', 'Other', 'Otro')} value={eur(closing.declared_other)} />
                </div>
                {(closing.declared_evidence || closing.declared_note) && (
                  <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.45 }}>
                    {closing.declared_evidence && <>{t('Justificatif', 'Evidence', 'Justificante')} : <span style={{ color: T2 }}>{closing.declared_evidence}</span>{closing.declared_note ? ' · ' : ''}</>}
                    {closing.declared_note && <span style={{ color: T2 }}>{closing.declared_note}</span>}
                  </p>
                )}
                {closing.status === 'disputed' && (
                  <p className="flex items-start gap-1.5" style={{ color: 'var(--acc-fcd34d)', fontSize: 11.5 }}>
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {t('Contesté par l\'organisateur', 'Disputed by the organizer', 'Impugnado por el organizador')}{closing.dispute_reason ? ` : ${closing.dispute_reason}` : '.'}
                    {isVenue && <> {t('Corrige et renvoie la déclaration.', 'Correct and resend the declaration.', 'Corrige y reenvía la declaración.')}</>}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-2 pt-1" style={{ fontSize: 12 }}>
                  <Cell label={t('Total de la soirée', 'Night total', 'Total de la noche')} value={eur(proj.total)} />
                  <Cell label={tierLabel(proj.pct)} value={eur(proj.due)} strong />
                  <Cell label={t('Depuis les fonds retenus (Stripe)', 'From held funds (Stripe)', 'De los fondos retenidos (Stripe)')} value={eur(proj.online)} />
                  <Cell label={t('À virer par le club (SEPA)', 'To wire by the club (SEPA)', 'A transferir por el club (SEPA)')} value={eur(proj.sepa)} />
                </div>

                {/* Actions CLUB */}
                {isVenue && !accepted && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <OrgButton variant="secondary" size="sm" disabled={busy} onClick={() => setEditing(true)}>
                      {t('Corriger la déclaration', 'Correct the declaration', 'Corregir la declaración')}
                    </OrgButton>
                    <OrgButton variant="ghost" size="sm" disabled={busy}
                      onClick={() => run(() => cancelNightClosing(closing.id), t('Déclaration retirée', 'Declaration withdrawn', 'Declaración retirada'))}>
                      {t('Retirer', 'Withdraw', 'Retirar')}
                    </OrgButton>
                  </div>
                )}
                {isVenue && closing.status === 'declared' && (
                  <p style={{ color: T3, fontSize: 11.5 }}>{t("En attente de la validation de l'organisateur.", "Waiting for the organizer's validation.", 'Esperando la validación del organizador.')}</p>
                )}

                {/* Actions ORGANISATEUR : lui seul accepte. */}
                {!isVenue && closing.status === 'declared' && (
                  <div className="space-y-2 pt-1">
                    <p style={{ color: T1, fontSize: 12.5, fontWeight: 560 }}>
                      {t('Ces chiffres correspondent à ta soirée ?', 'Do these figures match your night?', '¿Estas cifras coinciden con tu noche?')}
                    </p>
                    {proj.sepa > 0 && !data.organizer_has_iban && (
                      <p className="flex items-start gap-1.5" style={{ color: 'var(--acc-fcd34d)', fontSize: 11.5 }}>
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {t('Une partie du dû passe par virement : renseigne ton IBAN dans Paiements avant d\'accepter.', 'Part of what is owed goes by bank transfer: enter your IBAN in Payments before accepting.', 'Parte de lo debido va por transferencia: introduce tu IBAN en Pagos antes de aceptar.')}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <OrgButton variant="primary" size="sm" disabled={busy}
                        onClick={() => { void acceptClosing(closing.id); }}>
                        <Check className="h-4 w-4" /> {t('Oui, j\'accepte le décompte', 'Yes, I accept the closing', 'Sí, acepto el cierre')}
                      </OrgButton>
                      <OrgButton variant="ghost" size="sm" disabled={busy}
                        onClick={() => run(() => disputeNightClosing(closing.id, disputeReason.trim() || undefined), t('Décompte contesté', 'Closing disputed', 'Cierre impugnado'))}>
                        {t('Non, je conteste', 'No, I dispute', 'No, impugno')}
                      </OrgButton>
                    </div>
                    <input
                      value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)}
                      placeholder={t('Motif si tu contestes (ex. « le bar a fait plus que ça »)', 'Reason if you dispute (e.g. "the bar did more than that")', 'Motivo si impugnas (p. ej. «la barra hizo más»)')}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 10, fontSize: 12, background: 'transparent', border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
                    />
                    <p style={{ color: T3, fontSize: 11, lineHeight: 1.45 }}>
                      {t('En acceptant, Yuno fige les chiffres et déclenche la répartition : ta part part des ventes Yuno retenues, le reste te sera viré par le club avec une référence à suivre ici.', 'By accepting, Yuno freezes the figures and triggers the split: your share comes out of the held Yuno sales, the rest is wired to you by the club with a reference tracked here.', 'Al aceptar, Yuno fija las cifras y activa el reparto: tu parte sale de las ventas Yuno retenidas, el resto te lo transfiere el club con una referencia que sigues aquí.')}
                    </p>
                  </div>
                )}
                {!isVenue && closing.status === 'disputed' && (
                  <p style={{ color: T3, fontSize: 11.5 }}>{t('Le club doit corriger et renvoyer sa déclaration.', 'The club has to correct and resend its declaration.', 'El club debe corregir y reenviar su declaración.')}</p>
                )}

                {/* Suivi du paiement une fois accepté */}
                {accepted && (
                  <div className="space-y-2 pt-1">
                    <p className="flex items-center gap-1.5" style={{ color: POS, fontSize: 12 }}>
                      <Check className="h-3.5 w-3.5" />
                      {t('Accepté le', 'Accepted on', 'Aceptado el')} {closing.accepted_at ? new Date(closing.accepted_at).toLocaleDateString(language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR') : ''}.
                      {' '}
                      {Number(closing.online_amount ?? 0) > 0 && t(`${eur(closing.online_amount)} partent par virement Stripe automatique vers l'organisateur, depuis les fonds retenus (sous l'heure).`, `${eur(closing.online_amount)} go by automatic Stripe transfer to the organizer, from the held funds (within the hour).`, `${eur(closing.online_amount)} van por transferencia Stripe automática al organizador, desde los fondos retenidos (en menos de una hora).`)}
                      {Number(closing.online_amount ?? 0) === 0 && Number(closing.sepa_amount ?? 0) === 0 && t('Rien n\'est dû à l\'organisateur sur cette soirée : les fonds retenus sont libérés au club.', 'Nothing is owed to the organizer for this night: the held funds are released to the club.', 'No se debe nada al organizador por esta noche: los fondos retenidos se liberan al club.')}
                    </p>
                    {settlement && (
                      <SepaSteps
                        settlement={settlement} isVenue={isVenue} bank={bank} busy={busy} run={run} copy={copy} t={t}
                        disputeReason={disputeReason} setDisputeReason={setDisputeReason}
                      />
                    )}
                  </div>
                )}
              </div>
            ) : (
              // Organisateur, soirée finie, rien déclaré encore.
              <p style={{ color: T3, fontSize: 11.5 }}>
                {t('Le club n\'a pas encore déclaré le chiffre de la soirée. Les fonds Yuno restent retenus jusqu\'au décompte.', 'The club has not declared the night\'s figures yet. Yuno funds stay held until the closing.', 'El club aún no ha declarado las cifras de la noche. Los fondos Yuno siguen retenidos hasta el cierre.')}
              </p>
            )}
          </div>
        )}
      </div>
      <ActionOverlay
        fixed
        open={runOpen}
        stage={runStage}
        showSteps={false}
        steps={runSteps}
        kicker={[tk('owner.closingrun.kicker'), tk('owner.closingrun.kickerDone')]}
        title={[tk('owner.closingrun.title'), tk('owner.closingrun.titleDone')]}
        finalWord={tk('owner.closingrun.final')}
        onClose={() => setRunOpen(false)}
        done={runResult ? (
          <ActionResultCard kicker={tk('owner.closingrun.cardKicker')}>
            <div style={{
              background: 'linear-gradient(135deg,rgba(232,25,44,0.14),rgba(232,25,44,0.04))',
              border: '1px solid rgba(232,25,44,0.22)', borderRadius: 12, padding: '12px 14px',
            }}>
              <ActionFigure value={eur(runResult.due)} label={tk('owner.closingrun.total')} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {([[runResult.online, 'owner.closingrun.stripe'], [runResult.sepa, 'owner.closingrun.sepa']] as const).map(([amount, key]) => (
                <div key={key} style={{ background: 'rgb(var(--ink)/0.025)', border: '1px solid rgb(var(--ink)/0.085)', borderRadius: 12, padding: '10px 12px' }}>
                  <ActionFigure size="secondary" value={eur(amount)} label={tk(key)} />
                </div>
              ))}
            </div>
          </ActionResultCard>
        ) : null}
      />
    </OrgCard>
  );
}

/** Le reste du dû, par virement : même cycle que le complément tables. */
function SepaSteps({ settlement: open, isVenue, bank, busy, run, copy, t, disputeReason, setDisputeReason }: {
  settlement: NonNullable<ClosingComputeResult['settlement']>;
  isVenue: boolean;
  bank: { iban: string | null; bic: string | null } | null;
  busy: boolean;
  run: (fn: () => Promise<unknown>, success: string) => Promise<void>;
  copy: (v: string) => void;
  t: (fr: string, en: string, es?: string) => string;
  disputeReason: string;
  setDisputeReason: (v: string) => void;
}) {
  const dleft = daysUntil(open.confirm_due_at);
  return (
    <div className="space-y-2 rounded-xl p-3" style={{ background: 'rgb(var(--ink)/0.02)', border: `1px solid ${BORDER}` }}>
      <div className="flex items-center justify-between">
        <span style={{ color: T2, fontSize: 12 }}>
          {t('Reste à virer par le club', 'Remainder to wire by the club', 'Resto a transferir por el club')} ·{' '}
          {open.status === 'pending' && t('en attente du virement', 'awaiting transfer', 'esperando transferencia')}
          {open.status === 'approved' && t('virement déclaré', 'transfer declared', 'transferencia declarada')}
          {open.status === 'paid' && t('reçu et confirmé', 'received and confirmed', 'recibido y confirmado')}
          {open.status === 'disputed' && t('litige', 'dispute', 'litigio')}
        </span>
        <strong style={{ color: open.status === 'paid' ? POS : T1, fontSize: 14 }}>{eur(open.amount)}</strong>
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
        <p style={{ color: dleft < 0 ? 'var(--acc-fcd34d)' : T3, fontSize: 11.5 }}>
          {dleft >= 0
            ? t(`Accusé de réception attendu sous ${dleft} j.`, `Acknowledgement expected within ${dleft} day(s).`, `Acuse de recibo esperado en ${dleft} día(s).`)
            : t('Délai dépassé — bascule en litige imminente.', 'Deadline passed — switching to dispute soon.', 'Plazo superado — pasará a litigio en breve.')}
        </p>
      )}
      {open.status === 'disputed' && open.dispute_reason && (
        <p style={{ color: 'var(--acc-fcd34d)', fontSize: 11.5 }}>
          {open.dispute_reason === 'auto:no_acknowledgement' ? t('Aucune réponse dans les délais.', 'No response within the deadline.', 'Sin respuesta dentro del plazo.') : open.dispute_reason}
        </p>
      )}

      {isVenue && open.status === 'pending' && (
        <OrgButton variant="primary" size="sm" disabled={busy}
          onClick={() => run(() => declareSettlementSent(open.id), t('Virement déclaré', 'Transfer declared', 'Transferencia declarada'))}>
          {t("J'ai effectué le virement", 'I made the transfer', 'He realizado la transferencia')}
        </OrgButton>
      )}
      {isVenue && open.status === 'approved' && (
        <p style={{ color: T3, fontSize: 11.5 }}>{t("En attente de la confirmation de l'organisateur.", "Waiting for the organizer's confirmation.", 'Esperando la confirmación del organizador.')}</p>
      )}
      {isVenue && open.status === 'disputed' && (
        <OrgButton variant="secondary" size="sm" disabled={busy}
          onClick={() => run(() => resolveSettlementDispute(open.id, 'redeclare'), t('Virement re-déclaré', 'Transfer re-declared', 'Transferencia redeclarada'))}>
          {t('Le virement est bien parti', 'The transfer did go out', 'La transferencia sí salió')}
        </OrgButton>
      )}
      {!isVenue && (open.status === 'approved' || open.status === 'disputed') && (
        <div className="space-y-2">
          <p style={{ color: T1, fontSize: 12.5, fontWeight: 560 }}>{t('Bien reçu sur ton compte ?', 'Received on your account?', '¿Recibido en tu cuenta?')}</p>
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
        <p style={{ color: T3, fontSize: 11.5 }}>{t('Le club a la référence et ton IBAN : il doit maintenant virer et le déclarer ici.', 'The club has the reference and your IBAN: it now has to wire and declare it here.', 'El club tiene la referencia y tu IBAN: ahora debe transferir y declararlo aquí.')}</p>
      )}
    </div>
  );
}

function Cell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg p-2.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <div style={{ color: T3, fontSize: 10.5 }}>{label}</div>
      <div className="tabular-nums" style={{ color: strong ? 'rgb(var(--ink))' : T1, fontSize: strong ? 15 : 13, fontWeight: strong ? 650 : 560 }}>{value}</div>
    </div>
  );
}

function Field({ label, value, onChange, integer }: { label: string; value: number; onChange: (v: string) => void; integer?: boolean }) {
  return (
    <label className="block">
      <span style={{ color: T3, fontSize: 10.5 }}>{label}</span>
      <input
        type="number" min={0} step={integer ? 1 : 0.01} inputMode="decimal"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.target.select()}
        style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 10, fontSize: 13, background: 'transparent', border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
      />
    </label>
  );
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span style={{ color: T3, fontSize: 10.5 }}>{label}</span>
      <input
        type="text" value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 10, fontSize: 13, background: 'transparent', border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
      />
    </label>
  );
}

export default CollabNightClosingCard;
