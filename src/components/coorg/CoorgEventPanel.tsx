import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  CalendarClock, Check, CheckCircle2, Clock, Download, FileSignature, HandCoins, Info, Loader2, Mail, Plus, Receipt,
  ShieldCheck, Trash2, UserPlus, Users, X, Zap,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import {
  OrgCard, OrgButton, OrgPill, OrgSectionLabel, OrgTabs, DarkInput, DarkTextarea, FieldLabel,
  RED, POS, T1, T2, T3, BORDER, INNER_BG,
} from '@/components/org-ui';
import {
  getEventCoorg, respondCohostInvitation, updateEventCohost, endEventCohost,
  saveCoorgDeal, signCoorgDeal, addCoorgLedgerLine, voidCoorgLedgerLine, approveCoorgSettlement,
  coorgErrorCode, eur, PAYMENT_TERMS_DAYS, cancelCohostEmailInvite, coorgStripeSplitBlocker,
  type CoorgState, type CoorgParty, type CohostAccess, type PaymentTermsDays,
} from '@/lib/coorg';
import { COORG_TERMS_VERSION, coorgArticles, generateCoorgAgreementPDF } from '@/lib/coorgAgreement';
import { capturePosthog } from '@/lib/posthog';
import { PartyAvatar, PartyRolePill, useCoorgT, useCoorgErrorText } from './coorgUi';
import { CoorgInviteDialog } from './CoorgInviteDialog';
import { CoorgTransferList } from './CoorgTransferList';
import { CoorgSalesLinksCard } from './CoorgSalesLinksCard';

/**
 * La co-organisation d'UNE soirée, vue depuis n'importe laquelle de ses
 * parties (club ou organisateur, principale ou co-hôte). Quatre temps, dans
 * l'ordre où ils se vivent :
 *   1. qui co-organise (parties, invitations, accès, CRM partagé) ;
 *   2. l'accord — facultatif — sur les parts, accepté ou signé par tous ;
 *   3. après la soirée, le décompte que tout le monde valide ;
 *   4. les virements, déclarés par le payeur, confirmés par le bénéficiaire.
 * Rien d'argent n'est affiché à qui ne tient pas l'argent de sa structure.
 */
export function CoorgEventPanel({ eventId }: { eventId: string }) {
  const { t, language } = useCoorgT();
  const errText = useCoorgErrorText();
  const [state, setState] = useState<CoorgState | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await getEventCoorg(eventId);
      setState(s);
    } catch (err) {
      console.error('[coorg] lecture', err);
      setState(null);
    } finally {
      setLoading(false);
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

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin" style={{ color: T3 }} /></div>;
  }
  if (!state || !state.ok) {
    return (
      <OrgCard className="p-6 text-center">
        <p style={{ color: T2, fontSize: 13 }}>
          {t('Cette soirée n’est pas accessible depuis ce compte.', 'This event is not available from this account.', 'Este evento no está disponible desde esta cuenta.')}
        </p>
      </OrgCard>
    );
  }

  const nameOf = (key: string) => state.parties.find((p) => p.key === key)?.name
    ?? state.invitations.find((i) => i.party === key)?.name ?? key;
  const isPrincipal = state.me?.role === 'lead' || state.me?.role === 'partner';
  const pendingMine = state.invitations.filter((i) => i.status === 'pending' && i.mine);
  const pendingOthers = state.invitations.filter((i) => i.status === 'pending' && !i.mine);
  const cohostCount = state.parties.filter((p) => p.role === 'cohost').length
    + pendingOthers.length + (state.email_invitations ?? []).length;

  return (
    <div className="space-y-4">
      {/* Invitation reçue : décider d'abord */}
      {pendingMine.map((inv) => (
        <OrgCard key={inv.id} className="p-5" style={{ borderColor: 'rgba(232,25,44,0.35)' }}>
          <div className="flex flex-wrap items-center gap-3">
            <UserPlus className="h-5 w-5" style={{ color: RED }} />
            <div className="min-w-0 flex-1">
              <p style={{ color: T1, fontSize: 14, fontWeight: 650 }}>
                {t('On t’invite à co-organiser cette soirée', 'You are invited to co-organize this event', 'Te invitan a coorganizar este evento')}
              </p>
              <p style={{ color: T2, fontSize: 12.5, marginTop: 2 }}>
                {inv.access === 'editor'
                  ? t('Accès édition', 'Editor access', 'Acceso edición')
                  : t('Accès lecture', 'Viewer access', 'Acceso lectura')}
                {inv.share_crm ? ` · ${t('CRM partagé', 'Shared CRM', 'CRM compartido')}` : ''}
                {inv.message ? ` · « ${inv.message} »` : ''}
              </p>
            </div>
            <OrgButton size="sm" variant="ghost" disabled={!!busy}
              onClick={() => run('decline', () => respondCohostInvitation(inv.id, false))}>
              {t('Décliner', 'Decline', 'Rechazar')}
            </OrgButton>
            <OrgButton size="sm" variant="primary" disabled={!!busy}
              onClick={() => run('accept', async () => {
                await respondCohostInvitation(inv.id, true);
                capturePosthog('coorg_cohost_responded', { event_id: eventId, accepted: true });
              }, t('Tu co-organises la soirée', 'You now co-organize the event', 'Ahora coorganizas el evento'))}>
              {busy === 'accept' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {t('Accepter', 'Accept', 'Aceptar')}
            </OrgButton>
          </div>
        </OrgCard>
      ))}

      {/* 1. Parties */}
      <OrgCard className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <OrgSectionLabel>{t('Qui co-organise', 'Who co-organizes', 'Quién coorganiza')}</OrgSectionLabel>
            <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>
              {t(
                'Chaque partie retrouve la soirée dans sa Console : ventes, analyses, clients.',
                'Every party finds the event in its Console: sales, analytics, customers.',
                'Cada parte encuentra el evento en su Consola: ventas, análisis, clientes.',
              )}
            </p>
          </div>
          {state.can_invite && (
            <OrgButton size="sm" variant="primary" onClick={() => setInviteOpen(true)} disabled={cohostCount >= 8}>
              <UserPlus className="h-4 w-4" /> {t('Inviter un co-hôte', 'Invite a co-host', 'Invitar a un coanfitrión')}
            </OrgButton>
          )}
        </div>

        <div className="space-y-2">
          {state.parties.map((p) => (
            <PartyRow
              key={p.key}
              party={p}
              isMe={state.my_parties.includes(p.key) || state.me?.party === p.key}
              canManage={isPrincipal && (state.me?.level ?? 0) >= 2 && p.role === 'cohost'}
              busy={busy}
              onAccess={(a) => p.cohost_id && run(`acc:${p.key}`, () => updateEventCohost(p.cohost_id!, a))}
              onCrm={(v) => p.cohost_id && run(`crm:${p.key}`, () => updateEventCohost(p.cohost_id!, undefined, v))}
              onRemove={() => p.cohost_id && run(`rm:${p.key}`, () => endEventCohost(p.cohost_id!),
                t('Co-hôte retiré', 'Co-host removed', 'Coanfitrión retirado'))}
              onLeave={() => p.cohost_id && run(`leave:${p.key}`, () => endEventCohost(p.cohost_id!),
                t('Tu as quitté la co-organisation', 'You left the co-organization', 'Has dejado la coorganización'))}
            />
          ))}
          {pendingOthers.map((inv) => (
            <div key={inv.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ border: `1px dashed ${BORDER}` }}>
              <PartyAvatar name={inv.name ?? ''} url={inv.avatar_url} kind={inv.party.startsWith('venue:') ? 'venue' : 'org'} />
              <div className="min-w-0 flex-1">
                <p className="truncate" style={{ color: T2, fontSize: 13.5, fontWeight: 600 }}>{inv.name}</p>
                <p style={{ color: T3, fontSize: 11.5 }}>
                  <Clock className="mr-1 inline h-3 w-3" />{t('Invitation envoyée', 'Invitation sent', 'Invitación enviada')}
                </p>
              </div>
              {isPrincipal && (
                <OrgButton size="sm" variant="ghost" disabled={!!busy}
                  onClick={() => run(`cancel:${inv.id}`, () => endEventCohost(inv.id), t('Invitation annulée', 'Invitation cancelled', 'Invitación cancelada'))}>
                  <X className="h-3.5 w-3.5" /> {t('Annuler', 'Cancel', 'Cancelar')}
                </OrgButton>
              )}
            </div>
          ))}
          {(state.email_invitations ?? []).map((inv) => (
            <div key={inv.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ border: `1px dashed ${BORDER}` }}>
              <PartyAvatar name={inv.name ?? inv.email} kind="org" />
              <div className="min-w-0 flex-1">
                <p className="truncate" style={{ color: T2, fontSize: 13.5, fontWeight: 600 }}>{inv.name || inv.email}</p>
                <p className="truncate" style={{ color: T3, fontSize: 11.5 }}>
                  <Mail className="mr-1 inline h-3 w-3" />
                  {inv.name ? `${inv.email} · ` : ''}
                  {t('Invitation par email, pas encore sur Yuno', 'Email invitation, not on Yuno yet', 'Invitación por email, aún no en Yuno')}
                </p>
              </div>
              {isPrincipal && (
                <OrgButton size="sm" variant="ghost" disabled={!!busy}
                  onClick={() => run(`cancelmail:${inv.id}`, () => cancelCohostEmailInvite(inv.id), t('Invitation annulée', 'Invitation cancelled', 'Invitación cancelada'))}>
                  <X className="h-3.5 w-3.5" /> {t('Annuler', 'Cancel', 'Cancelar')}
                </OrgButton>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
          <Info className="mt-0.5 h-4 w-4 flex-none" style={{ color: T3 }} />
          <p style={{ color: T2, fontSize: 11.5, lineHeight: 1.5 }}>
            {state.event.has_stripe_collab
              ? t(
                'Le contrat collab club × organisateur répartit l’argent entre ses DEUX signataires, par Stripe ou par virement selon leur choix. Les co-hôtes n’y sont jamais ajoutés : leur part se règle par l’accord ci-dessous, en virement.',
                'The club × organizer collab agreement splits the money between its TWO signatories, through Stripe or by bank transfer as they chose. Co-hosts are never added to it: their share is settled through the agreement below, by bank transfer.',
                'El contrato collab club × organizador reparte el dinero entre sus DOS firmantes, con Stripe o por transferencia según su elección. Los coanfitriones nunca se añaden: su parte se liquida con el acuerdo de abajo, por transferencia.',
              )
              : t(
                'Les ventes en ligne sont encaissées par l’hôte principal, comme d’habitude. Entre DEUX organisations, l’accord peut répartir chaque vente par Stripe (« Répartir via Stripe ? » → Oui). Sinon — et toujours à plus de deux — aucun compte Stripe n’est exigé des co-hôtes : Yuno calcule le décompte, le fait valider par tous et suit les virements.',
                'Online sales are collected by the main host, as usual. Between TWO organizations, the agreement can split every sale through Stripe (“Split through Stripe?” → Yes). Otherwise — and always with more than two — co-hosts need no Stripe account: Yuno computes the statement, has everyone approve it and tracks the transfers.',
                'Las ventas online las cobra el anfitrión principal, como siempre. Entre DOS organizaciones, el acuerdo puede repartir cada venta con Stripe («¿Repartir con Stripe?» → Sí). Si no — y siempre con más de dos —, los coanfitriones no necesitan cuenta de Stripe: Yuno calcula la liquidación, la hace validar por todos y sigue las transferencias.',
              )}
          </p>
        </div>
      </OrgCard>

      {/* Qui fait vendre : un lien de vente suivi par partie */}
      {state.me && <CoorgSalesLinksCard eventId={eventId} canCreate={(state.me.level ?? 0) >= 1} />}

      {/* 2. Accord */}
      {state.deal !== undefined && (state.deal || state.can_deal) && state.parties.length >= 2 && (
        <DealCard state={state} eventId={eventId} busy={busy} run={run} nameOf={nameOf} />
      )}

      {/* 3. Décompte + 4. Virements */}
      {state.deal?.status === 'active' && state.settlement && (
        <SettlementCard state={state} eventId={eventId} busy={busy} run={run} nameOf={nameOf} language={language} />
      )}

      <CoorgInviteDialog open={inviteOpen} onOpenChange={setInviteOpen} eventId={eventId} onInvited={load} />
    </div>
  );
}

function PartyRow({ party, isMe, canManage, busy, onAccess, onCrm, onRemove, onLeave }: {
  party: CoorgParty; isMe: boolean; canManage: boolean; busy: string | null;
  onAccess: (a: CohostAccess) => void; onCrm: (v: boolean) => void; onRemove: () => void; onLeave: () => void;
}) {
  const { t } = useCoorgT();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="rounded-xl px-3 py-2.5" style={{ border: `1px solid ${BORDER}` }}>
      <div className="flex flex-wrap items-center gap-3">
        <PartyAvatar name={party.name} url={party.avatar_url} kind={party.kind} />
        <div className="min-w-0 flex-1">
          <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>
            {party.name}{isMe && <span style={{ color: T3, fontWeight: 500 }}> · {t('toi', 'you', 'tú')}</span>}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <PartyRolePill role={party.role} access={party.access} kind={party.kind} />
            {party.share_crm && (
              <OrgPill tone="muted"><Users className="h-3 w-3" /> {t('CRM partagé', 'Shared CRM', 'CRM compartido')}</OrgPill>
            )}
          </div>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <OrgTabs
              size="sm"
              value={party.access as CohostAccess}
              onChange={(a) => onAccess(a)}
              tabs={[
                { value: 'editor', label: t('Édition', 'Editor', 'Edición') },
                { value: 'viewer', label: t('Lecture', 'Viewer', 'Lectura') },
              ]}
            />
            <label className="flex items-center gap-1.5" style={{ color: T3, fontSize: 11.5 }}>
              <Switch checked={party.share_crm} onCheckedChange={onCrm} disabled={!!busy} />
              CRM
            </label>
            {confirm ? (
              <>
                <OrgButton size="sm" variant="danger" onClick={onRemove} disabled={!!busy}>{t('Retirer', 'Remove', 'Retirar')}</OrgButton>
                <OrgButton size="sm" variant="ghost" onClick={() => setConfirm(false)}>{t('Non', 'No', 'No')}</OrgButton>
              </>
            ) : (
              <OrgButton size="sm" variant="ghost" onClick={() => setConfirm(true)}><Trash2 className="h-3.5 w-3.5" /></OrgButton>
            )}
          </div>
        )}
        {!canManage && isMe && party.role === 'cohost' && (
          confirm ? (
            <div className="flex gap-2">
              <OrgButton size="sm" variant="danger" onClick={onLeave} disabled={!!busy}>{t('Quitter', 'Leave', 'Salir')}</OrgButton>
              <OrgButton size="sm" variant="ghost" onClick={() => setConfirm(false)}>{t('Non', 'No', 'No')}</OrgButton>
            </div>
          ) : (
            <OrgButton size="sm" variant="ghost" onClick={() => setConfirm(true)}>{t('Quitter', 'Leave', 'Salir')}</OrgButton>
          )
        )}
      </div>
    </div>
  );
}

type Runner = (key: string, fn: () => Promise<unknown>, ok?: string) => Promise<void>;

function DealCard({ state, eventId, busy, run, nameOf }: {
  state: CoorgState; eventId: string; busy: string | null; run: Runner; nameOf: (k: string) => string;
}) {
  const { t, language } = useCoorgT();
  const deal = state.deal;
  const [editing, setEditing] = useState(false);
  const [shares, setShares] = useState<Record<string, string>>({});
  const [formal, setFormal] = useState(false);
  const [clauses, setClauses] = useState('');
  const [terms, setTerms] = useState<PaymentTermsDays>(15);
  const [stripeSplit, setStripeSplit] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  const openEditor = () => {
    const init: Record<string, string> = {};
    const even = Math.floor(100 / state.parties.length);
    state.parties.forEach((p, i) => {
      const cur = deal?.shares?.[p.key];
      init[p.key] = cur !== undefined ? String(cur)
        : String(i === 0 ? 100 - even * (state.parties.length - 1) : even);
    });
    setShares(init);
    setFormal(deal?.formal ?? false);
    setClauses(deal?.clauses ?? '');
    setTerms(deal?.payment_terms_days ?? 15);
    setStripeSplit(deal?.stripe_split ?? false);
    setEditing(true);
  };

  const total = useMemo(
    () => Object.values(shares).reduce((s, v) => s + (Number(v.replace(',', '.')) || 0), 0),
    [shares],
  );

  const numericShares = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(shares)) {
      const n = Number(v.replace(',', '.'));
      if (v.trim() !== '' && n > 0) out[k] = Math.round(n * 100) / 100;
    }
    return out;
  }, [shares]);
  // « Répartir via Stripe ? » : seulement entre DEUX organisations, sans club.
  const stripeBlocker = coorgStripeSplitBlocker(state, numericShares);
  const stripeOn = stripeSplit && !stripeBlocker;

  const save = () => {
    const out = numericShares;
    void run('deal', async () => {
      await saveCoorgDeal(eventId, out, formal, clauses, terms, stripeOn);
      capturePosthog('coorg_deal_saved', { event_id: eventId, parties: Object.keys(out).length, formal, payment_terms_days: terms, stripe_split: stripeOn });
      setEditing(false);
    }, t('Accord envoyé aux parties', 'Agreement sent to the parties', 'Acuerdo enviado a las partes'));
  };

  // Soirée commencée + accord actif : l'accord signé tient (serveur : deal_locked).
  const frozen = deal?.status === 'active' && new Date(state.event.start_at).getTime() <= Date.now();
  const locked = (state.settlement && state.settlement.status !== 'open') || frozen;
  const mySigning = deal ? state.my_parties.filter((k) => deal.shares[k] !== undefined && !deal.signatures[k]) : [];

  return (
    <OrgCard className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <OrgSectionLabel>
            {deal?.formal
              ? t('Contrat de co-organisation', 'Co-organization contract', 'Contrato de coorganización')
              : t('Accord de partage', 'Sharing agreement', 'Acuerdo de reparto')}
          </OrgSectionLabel>
          <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>
            {t(
              'Facultatif. Sans accord : dashboards et CRM partagés, l’argent reste à qui l’encaisse.',
              'Optional. Without an agreement: shared dashboards and CRM, money stays with whoever collects it.',
              'Opcional. Sin acuerdo: paneles y CRM compartidos, el dinero queda para quien lo cobra.',
            )}
          </p>
        </div>
        {deal && (
          <OrgPill tone={deal.status === 'active' ? 'success' : deal.status === 'pending' ? 'warn' : 'muted'} dot>
            {deal.status === 'active' ? t('Actif', 'Active', 'Activo')
              : deal.status === 'pending' ? t('En attente des parties', 'Awaiting parties', 'Pendiente de las partes')
                : t('Annulé', 'Cancelled', 'Cancelado')}
          </OrgPill>
        )}
      </div>

      {!editing && deal && deal.status !== 'cancelled' && (
        <div className="space-y-2">
          {Object.entries(deal.shares)
            .sort(([a], [b]) => {
              const ia = state.parties.findIndex((p) => p.key === a);
              const ib = state.parties.findIndex((p) => p.key === b);
              return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
            })
            .map(([k, pct]) => {
            const sig = deal.signatures[k];
            return (
              <div key={k} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: INNER_BG }}>
                <span className="flex-1 truncate" style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{nameOf(k)}</span>
                <span style={{ color: T1, fontSize: 15, fontWeight: 700 }}>{pct} %</span>
                {sig
                  ? <OrgPill tone="success"><CheckCircle2 className="h-3 w-3" /> {deal.formal ? t('Signé', 'Signed', 'Firmado') : t('Validé', 'Approved', 'Validado')}</OrgPill>
                  : <OrgPill tone="warn"><Clock className="h-3 w-3" /> {t('En attente', 'Pending', 'Pendiente')}</OrgPill>}
              </div>
            );
          })}
          <p className="flex items-center gap-1.5 px-1" style={{ color: T2, fontSize: 12 }}>
            <CalendarClock className="h-3.5 w-3.5" style={{ color: T3 }} />
            {t('Soldes à virer sous', 'Balances paid within', 'Saldos a transferir en')} <b style={{ color: T1 }}>{deal.payment_terms_days ?? 15} {t('jours', 'days', 'días')}</b>
            {' '}{t('après la validation du décompte · relances automatiques', 'of the statement’s approval · automatic reminders', 'tras validar la liquidación · recordatorios automáticos')}
          </p>
          {deal.stripe_split && (
            <div className="rounded-xl p-3" style={{ background: INNER_BG }}>
              <p className="flex items-center gap-1.5" style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>
                <Zap className="h-3.5 w-3.5" style={{ color: POS }} />
                {t('Chaque vente en ligne est répartie par Stripe', 'Every online sale is split through Stripe', 'Cada venta online se reparte con Stripe')}
              </p>
              <p className="mt-1" style={{ color: T3, fontSize: 11.5, lineHeight: 1.5 }}>
                {t('Chacun reçoit sa part sur son compte Stripe 48 h après la soirée. Le décompte ne règle plus que le reste : frais avancés, recettes hors Yuno.',
                  'Each party gets its share on its Stripe account 48 h after the event. The statement only settles the rest: advanced costs, off-Yuno revenue.',
                  'Cada parte recibe su parte en su cuenta de Stripe 48 h después del evento. La liquidación solo salda el resto: gastos adelantados, ingresos fuera de Yuno.')}
              </p>
              {state.parties.filter((p) => deal.shares[p.key] !== undefined && p.stripe_ready === false).map((p) => (
                <p key={p.key} className="mt-1.5" style={{ color: RED, fontSize: 11.5, lineHeight: 1.5 }}>
                  {t(`${p.name} n’a pas encore activé Stripe : tant que c’est le cas, les ventes vont à l’hôte et sa part se règle par le décompte.`,
                    `${p.name} has not activated Stripe yet: until then, sales go to the host and its share is settled through the statement.`,
                    `${p.name} aún no ha activado Stripe: mientras tanto, las ventas van al anfitrión y su parte se liquida con la liquidación.`)}
                </p>
              ))}
            </div>
          )}
          {deal.clauses && (
            <p className="rounded-xl p-3" style={{ background: INNER_BG, color: T2, fontSize: 12.5, whiteSpace: 'pre-wrap' }}>{deal.clauses}</p>
          )}

          {deal.formal && (
            <button type="button" onClick={() => setShowTerms((v) => !v)} className="text-left" style={{ color: T3, fontSize: 12, textDecoration: 'underline' }}>
              {showTerms ? t('Masquer les termes', 'Hide the terms', 'Ocultar los términos') : t('Lire les termes du contrat', 'Read the contract terms', 'Leer los términos del contrato')}
            </button>
          )}
          {showTerms && (
            <div className="space-y-2 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              {coorgArticles({ stripeSplit: deal.stripe_split }).map((a, i) => (
                <div key={i}>
                  <p style={{ color: T1, fontSize: 12.5, fontWeight: 650 }}>{i + 1}. {a.title[language as 'fr' | 'en' | 'es'] ?? a.title.en}</p>
                  <p style={{ color: T2, fontSize: 12, lineHeight: 1.5 }}>{a.body[language as 'fr' | 'en' | 'es'] ?? a.body.en}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            {deal.formal && (
              <OrgButton size="sm" variant="ghost" onClick={() => void generateCoorgAgreementPDF({
                language, eventTitle: state.event.title, version: deal.version,
                eventDate: new Date(state.event.start_at).toLocaleDateString(language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR'),
                termsVersion: deal.terms_version || COORG_TERMS_VERSION, clauses: deal.clauses,
                paymentTermsDays: deal.payment_terms_days ?? 15,
                stripeSplit: deal.stripe_split,
                parties: Object.entries(deal.shares).map(([k, pct]) => ({
                  key: k, name: nameOf(k), pct, signedAt: deal.signatures[k]?.at ?? null,
                })),
              })}>
                <Download className="h-3.5 w-3.5" /> PDF
              </OrgButton>
            )}
            {state.can_deal && !locked && (
              <OrgButton size="sm" variant="secondary" onClick={openEditor}>{t('Modifier les parts', 'Edit shares', 'Editar partes')}</OrgButton>
            )}
            {mySigning.map((k) => (
              <OrgButton key={k} size="sm" variant="primary" disabled={!!busy}
                onClick={() => run(`sign:${k}`, async () => {
                  await signCoorgDeal(eventId, k, deal.version);
                  capturePosthog('coorg_deal_signed', { event_id: eventId, formal: deal.formal });
                }, deal.formal ? t('Contrat signé', 'Contract signed', 'Contrato firmado') : t('Accord validé', 'Agreement approved', 'Acuerdo validado'))}>
                <FileSignature className="h-4 w-4" />
                {deal.formal ? t('Signer', 'Sign', 'Firmar') : t('Valider', 'Approve', 'Validar')}
                {state.my_parties.length > 1 ? ` · ${nameOf(k)}` : ''}
              </OrgButton>
            ))}
          </div>
        </div>
      )}

      {!editing && (!deal || deal.status === 'cancelled') && state.can_deal && (
        <OrgButton variant="secondary" onClick={openEditor}>
          <HandCoins className="h-4 w-4" /> {t('Définir les parts de chacun', 'Set each party’s share', 'Definir la parte de cada uno')}
        </OrgButton>
      )}

      {editing && (
        <div className="space-y-3">
          {state.parties.map((p) => (
            <div key={p.key} className="flex items-center gap-3">
              <PartyAvatar name={p.name} url={p.avatar_url} kind={p.kind} size={28} />
              <span className="min-w-0 flex-1 truncate" style={{ color: T1, fontSize: 13 }}>{p.name}</span>
              <div className="w-24">
                <DarkInput inputMode="numeric" value={shares[p.key] ?? ''} onChange={(v) => setShares((s) => ({ ...s, [p.key]: v }))} placeholder="0" />
              </div>
              <span style={{ color: T3, fontSize: 13 }}>%</span>
            </div>
          ))}
          <p style={{ color: Math.abs(total - 100) < 0.01 ? POS : RED, fontSize: 12, fontWeight: 600 }}>
            {t('Total', 'Total', 'Total')} : {Math.round(total * 100) / 100} %
            {Math.abs(total - 100) >= 0.01 && ` — ${t('il faut 100 %', 'must be 100%', 'debe ser 100 %')}`}
          </p>
          <p style={{ color: T3, fontSize: 11.5 }}>
            {t('Une partie à 0 % reste hors décompte : elle partage dashboards et CRM, pas l’argent.',
              'A party at 0% stays out of the statement: it shares dashboards and CRM, not money.',
              'Una parte al 0 % queda fuera de la liquidación: comparte paneles y CRM, no el dinero.')}
          </p>
          <div>
            <FieldLabel>{t('Forme', 'Form', 'Forma')}</FieldLabel>
            <OrgTabs
              size="sm"
              value={formal ? 'formal' : 'simple'}
              onChange={(v) => setFormal(v === 'formal')}
              tabs={[
                { value: 'simple', label: t('Simple accord', 'Simple agreement', 'Acuerdo simple') },
                { value: 'formal', label: t('Contrat signé', 'Signed contract', 'Contrato firmado') },
              ]}
            />
            <p className="mt-1.5" style={{ color: T3, fontSize: 11.5 }}>
              {formal
                ? t('Chaque partie signe électroniquement les termes Yuno (horodatage, compte, navigateur), PDF téléchargeable.',
                  'Each party e-signs the Yuno terms (timestamp, account, browser), downloadable PDF.',
                  'Cada parte firma electrónicamente los términos Yuno (fecha, cuenta, navegador), PDF descargable.')
                : t('Chaque partie clique « Valider » : même décompte, sans contrat formel.',
                  'Each party clicks “Approve”: same statement, no formal contract.',
                  'Cada parte pulsa «Validar»: misma liquidación, sin contrato formal.')}
            </p>
          </div>
          {!stripeBlocker && (
            <div>
              <FieldLabel>{t('Répartir l’argent automatiquement via Stripe ?', 'Split the money automatically through Stripe?', '¿Repartir el dinero automáticamente con Stripe?')}</FieldLabel>
              <OrgTabs
                size="sm"
                value={stripeSplit ? 'yes' : 'no'}
                onChange={(v) => setStripeSplit(v === 'yes')}
                tabs={[
                  { value: 'no', label: t('Non', 'No', 'No') },
                  { value: 'yes', label: t('Oui', 'Yes', 'Sí') },
                ]}
              />
              <p className="mt-1.5" style={{ color: T3, fontSize: 11.5, lineHeight: 1.45 }}>
                {stripeSplit
                  ? t('Chaque vente en ligne est coupée par Stripe selon les parts, et chacun reçoit la sienne sur son compte 48 h après la soirée. Les deux organisations ont besoin d’un compte Stripe actif ; sinon la vente va à l’hôte et se règle par le décompte.',
                    'Every online sale is split by Stripe per the shares, and each party gets its own on its account 48 h after the event. Both organizations need an active Stripe account; otherwise the sale goes to the host and is settled through the statement.',
                    'Cada venta online se divide con Stripe según las partes y cada una recibe la suya en su cuenta 48 h después del evento. Ambas organizaciones necesitan una cuenta de Stripe activa; si no, la venta va al anfitrión y se liquida con la liquidación.')
                  : t('L’hôte encaisse les ventes ; Yuno calcule le décompte après la soirée et suit le virement de la part de l’autre. Aucun compte Stripe exigé du partenaire.',
                    'The host collects the sales; Yuno computes the statement after the event and tracks the transfer of the other party’s share. No Stripe account required from the partner.',
                    'El anfitrión cobra las ventas; Yuno calcula la liquidación tras el evento y sigue la transferencia de la parte del otro. No se exige cuenta de Stripe al socio.')}
              </p>
              {stripeSplit && state.parties.filter((p) => numericShares[p.key] !== undefined && p.stripe_ready === false).map((p) => (
                <p key={p.key} className="mt-1" style={{ color: RED, fontSize: 11.5 }}>
                  {t(`${p.name} n’a pas encore de compte Stripe actif.`, `${p.name} has no active Stripe account yet.`, `${p.name} aún no tiene una cuenta de Stripe activa.`)}
                </p>
              ))}
            </div>
          )}
          <div>
            <FieldLabel>{t('Délai de paiement', 'Payment terms', 'Plazo de pago')}</FieldLabel>
            <OrgTabs
              size="sm"
              value={String(terms)}
              onChange={(v) => setTerms(Number(v) as PaymentTermsDays)}
              tabs={PAYMENT_TERMS_DAYS.map((d) => ({ value: String(d), label: `${d} ${t('jours', 'days', 'días')}` }))}
            />
            <p className="mt-1.5" style={{ color: T3, fontSize: 11.5 }}>
              {t('Après la validation du décompte, chaque payeur a ce délai pour virer. Yuno relance avant l’échéance, puis tous les 3 jours de retard ; à 7 jours toutes les parties sont prévenues.',
                'Once the statement is approved, each payer has this long to transfer. Yuno reminds before the due date, then every 3 days late; at 7 days every party is told.',
                'Tras validar la liquidación, cada pagador tiene este plazo para transferir. Yuno recuerda antes del vencimiento y cada 3 días de retraso; a los 7 días se avisa a todas las partes.')}
            </p>
          </div>
          <div>
            <FieldLabel>{t('Clauses particulières (facultatif)', 'Specific clauses (optional)', 'Cláusulas particulares (opcional)')}</FieldLabel>
            <DarkTextarea value={clauses} onChange={setClauses} rows={3}
              placeholder={t('Ex. : chaque partie paie ses artistes ; la déco est à la charge de…', 'E.g. each party pays its artists; decor is paid by…', 'Ej.: cada parte paga a sus artistas; la decoración corre a cargo de…')} />
          </div>
          <div className="flex justify-end gap-2">
            <OrgButton variant="ghost" onClick={() => setEditing(false)}>{t('Annuler', 'Cancel', 'Cancelar')}</OrgButton>
            <OrgButton variant="primary" onClick={save} disabled={!!busy || Math.abs(total - 100) >= 0.01}>
              {busy === 'deal' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {t('Proposer aux parties', 'Propose to the parties', 'Proponer a las partes')}
            </OrgButton>
          </div>
        </div>
      )}
    </OrgCard>
  );
}

const CATEGORIES: { value: string; fr: string; en: string; es: string }[] = [
  { value: 'artists', fr: 'Artistes', en: 'Artists', es: 'Artistas' },
  { value: 'venue', fr: 'Lieu / location', en: 'Venue / rental', es: 'Local / alquiler' },
  { value: 'production', fr: 'Son, lumière, déco', en: 'Sound, light, decor', es: 'Sonido, luz, decoración' },
  { value: 'marketing', fr: 'Promotion', en: 'Promotion', es: 'Promoción' },
  { value: 'staff', fr: 'Staff / sécurité', en: 'Staff / security', es: 'Personal / seguridad' },
  { value: 'bar', fr: 'Bar hors Yuno', en: 'Bar outside Yuno', es: 'Barra fuera de Yuno' },
  { value: 'door', fr: 'Entrées à la porte', en: 'Door sales', es: 'Entradas en puerta' },
  { value: 'other', fr: 'Autre', en: 'Other', es: 'Otro' },
];

function SettlementCard({ state, eventId, busy, run, nameOf, language }: {
  state: CoorgState; eventId: string; busy: string | null; run: Runner; nameOf: (k: string) => string; language: string;
}) {
  const { t } = useCoorgT();
  const s = state.settlement!;
  const fig = s.figures;
  const deal = state.deal!;
  const myPool = state.my_parties.filter((k) => deal.shares[k] !== undefined);
  const [form, setForm] = useState({ party: myPool[0] ?? '', kind: 'expense' as 'expense' | 'revenue', label: '', amount: '', category: 'artists' });
  const open = s.status === 'open';
  const catLabel = (v: string) => {
    const c = CATEGORIES.find((x) => x.value === v) ?? CATEGORIES[CATEGORIES.length - 1];
    return t(c.fr, c.en, c.es);
  };

  // Une validation compte si elle porte sur la version ET les chiffres affichés.
  const approvalsFresh = (k: string) => !!s.approvals[k] && s.approvals[k].version === s.version
    && (!s.fingerprint || !s.approvals[k].fp || s.approvals[k].fp === s.fingerprint);
  const myToApprove = myPool.filter((k) => !approvalsFresh(k));

  return (
    <>
      <OrgCard className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <OrgSectionLabel>{t('Décompte de la soirée', 'Event statement', 'Liquidación del evento')}</OrgSectionLabel>
            <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>
              {t('Ventes Yuno calculées en direct, frais et recettes hors Yuno déclarés par chaque partie.',
                'Yuno sales computed live, costs and off-Yuno revenue declared by each party.',
                'Ventas Yuno calculadas en directo, gastos e ingresos fuera de Yuno declarados por cada parte.')}
            </p>
          </div>
          <OrgPill tone={s.status === 'settled' ? 'success' : s.status === 'approved' ? 'info' : 'warn'} dot>
            {s.status === 'settled' ? t('Soldé', 'Settled', 'Liquidado')
              : s.status === 'approved' ? t('Validé · virements en cours', 'Approved · transfers in progress', 'Validado · transferencias en curso')
                : t('Ouvert', 'Open', 'Abierto')}
          </OrgPill>
        </div>

        {fig.ok && fig.parties && (
          <>
            <div className="grid grid-cols-3 gap-2">
              {[
                { l: t('Recettes', 'Revenue', 'Ingresos'), v: fig.revenue },
                { l: t('Frais', 'Costs', 'Gastos'), v: fig.expenses },
                { l: t('Résultat', 'Result', 'Resultado'), v: fig.pot },
              ].map((x) => (
                <div key={x.l} className="rounded-xl p-3" style={{ background: INNER_BG }}>
                  <p style={{ color: T3, fontSize: 11 }}>{x.l}</p>
                  <p style={{ color: T1, fontSize: 17, fontWeight: 700 }}>{eur(x.v, language)}</p>
                </div>
              ))}
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr style={{ color: T3, fontSize: 11 }}>
                    <th className="py-1.5 font-semibold">{t('Partie', 'Party', 'Parte')}</th>
                    <th className="py-1.5 text-right font-semibold">{t('Part', 'Share', 'Parte')}</th>
                    <th className="py-1.5 text-right font-semibold">{t('Encaissé Yuno', 'Collected via Yuno', 'Cobrado Yuno')}</th>
                    <th className="py-1.5 text-right font-semibold">{t('Hors Yuno', 'Off Yuno', 'Fuera de Yuno')}</th>
                    <th className="py-1.5 text-right font-semibold">{t('Frais avancés', 'Costs paid', 'Gastos pagados')}</th>
                    <th className="py-1.5 text-right font-semibold">{t('Droit', 'Entitled', 'Derecho')}</th>
                    <th className="py-1.5 text-right font-semibold">{t('Solde', 'Balance', 'Saldo')}</th>
                    <th className="py-1.5 text-right font-semibold">{t('Validé', 'Approved', 'Validado')}</th>
                  </tr>
                </thead>
                <tbody>
                  {fig.parties.map((p) => (
                    <tr key={p.party} style={{ borderTop: `1px solid ${BORDER}`, color: T1 }}>
                      <td className="py-2 font-semibold">{p.name}</td>
                      <td className="py-2 text-right">{p.pct} %</td>
                      <td className="py-2 text-right">{eur(p.yuno, language)}</td>
                      <td className="py-2 text-right">{eur(p.declared_revenue, language)}</td>
                      <td className="py-2 text-right">{eur(p.expenses, language)}</td>
                      <td className="py-2 text-right">{eur(p.entitled, language)}</td>
                      <td className="py-2 text-right font-bold" style={{ color: p.balance > 0.004 ? POS : p.balance < -0.004 ? RED : T2 }}>
                        {p.balance > 0.004 ? '+' : ''}{eur(p.balance, language)}
                      </td>
                      <td className="py-2 text-right">
                        {approvalsFresh(p.party) || !open
                          ? <CheckCircle2 className="ml-auto h-4 w-4" style={{ color: POS }} />
                          : <Clock className="ml-auto h-4 w-4" style={{ color: T3 }} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2" style={{ color: T3, fontSize: 11 }}>
              {t('Solde positif = à recevoir, négatif = à verser. « Encaissé Yuno » = net après frais de service, remboursements et frais Stripe.',
                'Positive balance = to receive, negative = to pay. “Collected via Yuno” = net after service fees, refunds and Stripe fees.',
                'Saldo positivo = a recibir, negativo = a pagar. «Cobrado Yuno» = neto tras gastos de servicio, reembolsos y comisiones Stripe.')}
            </p>
          </>
        )}

        {/* Lignes déclarées */}
        <div className="mt-4">
          <OrgSectionLabel>{t('Frais et recettes déclarés', 'Declared costs and revenue', 'Gastos e ingresos declarados')}</OrgSectionLabel>
          <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
            {t('Ne déclare que l’argent qui n’est PAS passé par Yuno : bar en caisse, entrées à la porte, solde des tables réglé sur place, tables saisies à la main.',
              'Only declare money that did NOT go through Yuno: bar till, door entries, table balances paid on site, manually entered tables.',
              'Declara solo el dinero que NO pasó por Yuno: caja de barra, entradas en puerta, saldo de mesas pagado en el local, mesas introducidas a mano.')}
          </p>
          <div className="mt-2 space-y-1.5">
            {(state.ledger ?? []).length === 0 && (
              <p style={{ color: T3, fontSize: 12 }}>{t('Aucune ligne pour l’instant.', 'No line yet.', 'Ninguna línea por ahora.')}</p>
            )}
            {(state.ledger ?? []).map((l) => (
              <div key={l.id} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: INNER_BG }}>
                <Receipt className="h-3.5 w-3.5 flex-none" style={{ color: l.kind === 'expense' ? RED : POS }} />
                <span className="min-w-0 flex-1 truncate" style={{ color: T1, fontSize: 12.5 }}>
                  {l.label} <span style={{ color: T3 }}>· {catLabel(l.category)} · {nameOf(l.party)}</span>
                </span>
                <span style={{ color: l.kind === 'expense' ? RED : POS, fontSize: 13, fontWeight: 700 }}>
                  {l.kind === 'expense' ? '−' : '+'}{eur(l.amount, language)}
                </span>
                {l.mine && open && (
                  <button type="button" onClick={() => run(`void:${l.id}`, () => voidCoorgLedgerLine(l.id))} disabled={!!busy}>
                    <Trash2 className="h-3.5 w-3.5" style={{ color: T3 }} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {open && myPool.length > 0 && (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr_120px_auto]">
              <OrgTabs
                size="sm"
                value={form.kind}
                onChange={(k) => setForm((f) => ({ ...f, kind: k, category: k === 'revenue' ? 'bar' : 'artists' }))}
                tabs={[
                  { value: 'expense', label: t('Frais', 'Cost', 'Gasto') },
                  { value: 'revenue', label: t('Recette', 'Revenue', 'Ingreso') },
                ]}
              />
              <DarkInput value={form.label} onChange={(v) => setForm((f) => ({ ...f, label: v }))}
                placeholder={form.kind === 'expense'
                  ? t('Ex. : cachet DJ, location son…', 'E.g. DJ fee, sound rental…', 'Ej.: caché DJ, alquiler de sonido…')
                  : t('Ex. : bar en caisse (ticket Z)…', 'E.g. bar till (Z report)…', 'Ej.: caja de barra (ticket Z)…')} />
              <DarkInput inputMode="numeric" value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} placeholder="€" />
              <OrgButton size="sm" variant="secondary" disabled={!!busy || !form.label.trim() || !(Number(form.amount.replace(',', '.')) > 0)}
                onClick={() => run('line', async () => {
                  await addCoorgLedgerLine({
                    eventId, party: form.party || myPool[0], kind: form.kind, label: form.label.trim(),
                    amount: Number(form.amount.replace(',', '.')), category: form.category,
                  });
                  setForm((f) => ({ ...f, label: '', amount: '' }));
                })}>
                <Plus className="h-3.5 w-3.5" /> {t('Ajouter', 'Add', 'Añadir')}
              </OrgButton>
              <div className="flex flex-wrap gap-1.5 sm:col-span-4">
                {CATEGORIES.filter((c) => (form.kind === 'revenue' ? ['bar', 'door', 'other'] : ['artists', 'venue', 'production', 'marketing', 'staff', 'other']).includes(c.value)).map((c) => (
                  <button key={c.value} type="button" onClick={() => setForm((f) => ({ ...f, category: c.value }))}
                    className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                    style={form.category === c.value ? { background: 'rgb(var(--ink)/0.1)', color: T1 } : { color: T3, border: `1px solid ${BORDER}` }}>
                    {t(c.fr, c.en, c.es)}
                  </button>
                ))}
                {myPool.length > 1 && (
                  <select value={form.party} onChange={(e) => setForm((f) => ({ ...f, party: e.target.value }))}
                    className="rounded-full px-2 py-1 text-[11px]" style={{ background: INNER_BG, color: T2, border: `1px solid ${BORDER}` }}>
                    {myPool.map((k) => <option key={k} value={k}>{nameOf(k)}</option>)}
                  </select>
                )}
              </div>
            </div>
          )}
        </div>

        {open && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            <p style={{ color: T2, fontSize: 12, maxWidth: 520 }}>
              {state.event.ended
                ? t('Chaque partie de l’accord valide ce décompte. Dès que tout le monde l’a fait, il est figé et les virements apparaissent.',
                  'Each party to the agreement approves this statement. Once everyone has, it is frozen and the transfers appear.',
                  'Cada parte del acuerdo valida esta liquidación. Cuando todos lo hayan hecho, queda fijada y aparecen las transferencias.')
                : t('Le décompte se valide après la soirée. Déclare déjà tes frais au fil de l’eau.',
                  'The statement is approved after the event. Declare your costs as you go.',
                  'La liquidación se valida tras el evento. Declara ya tus gastos sobre la marcha.')}
            </p>
            {state.event.ended && myToApprove.map((k) => (
              <OrgButton key={k} size="sm" variant="primary" disabled={!!busy}
                onClick={() => run(`approve:${k}`, async () => {
                  await approveCoorgSettlement(eventId, k, s.version, s.fingerprint);
                  capturePosthog('coorg_settlement_approved', { event_id: eventId, parties: Object.keys(deal.shares).length });
                }, t('Décompte validé', 'Statement approved', 'Liquidación validada'))}>
                <ShieldCheck className="h-4 w-4" /> {t('Valider le décompte', 'Approve statement', 'Validar liquidación')}
                {myPool.length > 1 ? ` · ${nameOf(k)}` : ''}
              </OrgButton>
            ))}
          </div>
        )}
      </OrgCard>

      {(state.transfers ?? []).length > 0 && (
        <OrgCard className="p-5">
          <OrgSectionLabel>{t('Virements', 'Transfers', 'Transferencias')}</OrgSectionLabel>
          <CoorgTransferList transfers={state.transfers ?? []} nameOf={nameOf} eventId={eventId} busy={busy} run={run} />
        </OrgCard>
      )}
    </>
  );
}
