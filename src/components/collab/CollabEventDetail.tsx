import { canSideEdit } from '@/utils/collabResponsibilities';
import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import {
  ArrowLeft, Copy, ExternalLink, Ticket, BarChart3, ScanLine, AlertCircle, CreditCard,
  Sparkles, Radio, Loader2, Lock, Eye, CalendarClock, Building2, Megaphone, Music, Users,
  LayoutGrid, TrendingUp, Wine, UserPlus, Trophy, UsersRound, Target, Pencil, Check, X,
  ChevronDown, FileText, MessageSquare, Euro,
} from 'lucide-react';
import { toast } from 'sonner';
import { useOrganizerStripe } from '@/hooks/useOrganizerStripe';
import { useEventCollabContract } from '@/hooks/useEventCollabContract';
import { useEventNetGain } from '@/hooks/useEventNetGain';
import { useCollabReadOnly } from '@/hooks/useCollabReadOnly';
import { SplitContractBanner } from '@/components/SplitContractBanner';
import { CollabMessageThread } from '@/components/collab/CollabMessageThread';
import { CollabSignFooter } from '@/components/collab/CollabSignFooter';
import { PayoutStatusNote } from '@/components/collab/PayoutStatusNote';
import { CollabConversionClose } from '@/components/collab/CollabConversionClose';
import { OrgEventTablesPanel } from '@/components/organizer-app/OrgEventTablesPanel';
import { OrgEventDrinksMenu } from '@/components/organizer-app/OrgEventDrinksMenu';
import { OrgBilletterieDialog } from '@/components/organizer-app/OrgBilletterieDialog';
import { PurchaseSourceBreakdown } from '@/components/analytics/PurchaseSourceBreakdown';
import { EventAudienceDemographics } from '@/components/analytics/EventAudienceDemographics';
import { EventLiveModule } from '@/components/owner/co-event/EventLiveModule';
import { EventPostAnalysisView } from '@/components/owner/co-event/EventPostAnalysisView';
import { EventGuestListModule } from '@/components/owner/co-event/EventGuestListModule';
import { EventInvoicesModule } from '@/components/owner/co-event/EventInvoicesModule';
import { OwnerTicketOrders } from '@/components/owner/OwnerTicketOrders';
import { OwnerVipOrders } from '@/components/owner/OwnerVipOrders';
import { OwnerDrinkOrders } from '@/components/owner/OwnerDrinkOrders';
import { OwnerHeader } from '@/components/OwnerHeader';
import { ticketRevenue, tableRevenue, orderRevenue } from '@/utils/fees';
import { getEffectiveSplit } from '@/utils/coEventSplit';
import { normalizeSplitRules } from '@/lib/splitRules';
import {
  OrgPage, OrgCard, OrgPill, OrgButton,
  RED, T1, T2, T3, BORDER, INNER_BG,
} from '@/components/org-ui';

type ViewerRole = 'venue' | 'organizer';
type Phase = 'before' | 'live' | 'after';

function computePhase(startAt: string, endAt: string): Phase {
  const now = Date.now();
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (Number.isFinite(start) && now < start) return 'before';
  if (Number.isFinite(end) && now <= end) return 'live';
  return 'after';
}

interface Stats {
  sold: number;
  ticketsSold: number;
  caSoiree: number;
  myShare: number;
  checkins: number;
  tableGuests: number;
  glEntries: number;
}

/**
 * Shared collaboration event dashboard rendered for BOTH the club (viewerRole="venue",
 * /owner/collab/event/:id) and the organizer (viewerRole="organizer",
 * /organizer-app/events/:id). The layout follows the organizer design; every
 * transparency surface (revenue, splits, contract, communication, audience, verdict,
 * orders, invoices) is shown to both sides so the two entities see the same information.
 * Money is scoped to the viewer's own share; management actions stay role-specific.
 */
export default function CollabEventDetail({ viewerRole }: { viewerRole: ViewerRole }) {
  const { eventId } = useParams<{ eventId: string }>();
  const { user } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const isVenue = viewerRole === 'venue';
  const isOrganizer = viewerRole === 'organizer';
  // Côté du spectateur pour l'axe RESPONSABILITÉS : la billetterie peut être
  // confiée au club seul sur n'importe quelle co-soirée, pas seulement en
  // org_hosted. On lit le domaine, pas le mode.
  const viewerSide: 'venue' | 'organizer' = isVenue ? 'venue' : 'organizer';

  const [event, setEvent] = useState<any>(null);
  const [clubName, setClubName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  const [myVenue, setMyVenue] = useState<{ id: string; name: string } | null>(null);
  // Club sans Stripe Connect = sa part de chaque vente ne peut pas lui être
  // versée (transfer failed). On l'avertit AVANT la première vente — le prompt
  // d'activation n'existait que côté organisateur.
  const [venueStripeReady, setVenueStripeReady] = useState<boolean | null>(null);
  const [stats, setStats] = useState<Stats>({ sold: 0, ticketsSold: 0, caSoiree: 0, myShare: 0, checkins: 0, tableGuests: 0, glEntries: 0 });
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [billetterieOpen, setBilletterieOpen] = useState(false);

  const { canSell, status: stripeStatus, loading: stripeLoading } = useOrganizerStripe(user?.id);
  const { isReadOnly } = useCollabReadOnly();
  const { status: contractStatus, isLoading: contractLoading } = useEventCollabContract(eventId, viewerRole);

  const scopeId = isVenue ? myVenue?.id : user?.id;
  const gainScope = isVenue
    ? { kind: 'venue' as const, venueId: myVenue?.id || '' }
    : { kind: 'organizer' as const, organizerUserId: user?.id || '' };
  const netGain = useEventNetGain(scopeId ? eventId ?? null : null, gainScope);

  useEffect(() => {
    if (!user || !eventId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);

      // Venue viewer: resolve the club this owner runs (for scope + framing).
      let venueRow: { id: string; name: string } | null = null;
      if (isVenue) {
        const { data: v } = await supabase.from('venues').select('id, name, stripe_account_id, stripe_charges_enabled').eq('owner_id', user.id).limit(1).maybeSingle();
        if (cancelled) return;
        venueRow = (v as any) ?? null;
        setMyVenue(venueRow ? { id: (venueRow as any).id, name: (venueRow as any).name } : null);
        setVenueStripeReady(Boolean((v as any)?.stripe_account_id && (v as any)?.stripe_charges_enabled));
      }

      // Event row. Organizer must match a night they lead OR a club proposed to them.
      let evQuery: any = supabase.from('events')
        .select('id, title, description, poster_url, start_at, end_at, is_active, visibility, discovery_status, ticketing_enabled, organizer_user_id, partner_organizer_id, venue_id, partner_venue_id, event_mode, collab_responsibilities, revenue_split_rules, split_locked_at, collab_goal_type, collab_goal_value')
        .eq('id', eventId);
      if (isOrganizer) evQuery = evQuery.or(`organizer_user_id.eq.${user.id},partner_organizer_id.eq.${user.id}`);
      const { data: ev } = await evQuery.maybeSingle();
      if (cancelled) return;
      if (!ev) { setNotFound(true); setLoading(false); return; }
      setEvent(ev);

      // Club name: organizer sees the partner club; venue is the club itself.
      const clubVenueId = ev.partner_venue_id ?? ev.venue_id;
      if (isVenue) {
        setClubName(venueRow?.name ?? '');
      } else if (clubVenueId) {
        const { data: v } = await supabase.from('venues').select('name').eq('id', clubVenueId).maybeSingle();
        if (!cancelled && v) setClubName((v as any).name);
      }

      // Partner organizer identity (name + public slug).
      const orgId = ev.organizer_user_id ?? ev.partner_organizer_id;
      if (orgId) {
        const { data: prof } = await supabase
          .from('organizer_profiles' as any)
          .select('display_name, slug')
          .eq('user_id', orgId)
          .maybeSingle();
        if (!cancelled && prof) { setOrgName((prof as any).display_name ?? ''); setOrgSlug((prof as any).slug ?? null); }
      }

      // Revenue stats — shared night revenue + the viewer's own share.
      // Boissons : lues côté CLUB uniquement (RLS orders = owner du venue ; et le
      // bar est 100 % club par défaut). Sans elles, un club qui vit du bar voyait
      // un « CA de la soirée » qui ignorait sa recette principale.
      const [{ data: tickets }, { data: reservations }, { data: gl }, { data: drinkOrders }] = await Promise.all([
        supabase.from('tickets').select('total_price, service_fee, insurance_fee, quantity, entry_scanned').eq('event_id', eventId).eq('status', 'paid'),
        supabase.from('table_reservations').select('total_price, service_fee, management_fee, guests_count').eq('event_id', eventId).eq('status', 'confirmed'),
        supabase.from('guest_list_entries').select('id, guest_lists!inner(event_id)').eq('guest_lists.event_id', eventId),
        isVenue
          ? supabase.from('orders').select('total, service_fee, refund_amount').eq('event_id', eventId).eq('status', 'paid')
          : Promise.resolve({ data: null } as any),
      ]);
      if (cancelled) return;

      const tk = (tickets ?? []) as any[];
      const tr = (reservations ?? []) as any[];
      const entries = (gl ?? []) as any[];
      const dr = (drinkOrders ?? []) as any[];
      // CA hors frais Yuno (les frais Yuno ne sont jamais du revenu).
      const ticketCA = tk.reduce((s, x) => s + ticketRevenue(x).gross, 0);
      const tableCA = tr.reduce((s, x) => s + tableRevenue(x).gross, 0);
      const drinksCA = dr.reduce((s, x) => s + orderRevenue(x).gross, 0);
      const shareKey = isVenue ? 'venue_pct' : 'organizer_pct';
      const ticketPct = (getEffectiveSplit(ev.revenue_split_rules, 'ticket', ev.event_mode) as any)[shareKey] / 100;
      const tablePct = (getEffectiveSplit(ev.revenue_split_rules, 'table', ev.event_mode) as any)[shareKey] / 100;
      const drinksPct = (getEffectiveSplit(ev.revenue_split_rules, 'order', ev.event_mode) as any)[shareKey] / 100;

      setStats({
        sold: tk.length,
        ticketsSold: tk.reduce((s, x) => s + (x.quantity || 1), 0),
        caSoiree: ticketCA + tableCA + drinksCA,
        myShare: ticketCA * ticketPct + tableCA * tablePct + drinksCA * drinksPct,
        checkins: tk.filter((x) => x.entry_scanned).length,
        tableGuests: tr.reduce((s, x) => s + (x.guests_count || 0), 0),
        glEntries: entries.length,
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, eventId, viewerRole]); // eslint-disable-line react-hooks/exhaustive-deps

  const phase = useMemo<Phase>(() => (event ? computePhase(event.start_at, event.end_at) : 'before'), [event]);

  const venueRole = useMemo<'lead_venue' | 'partner_venue' | 'unknown'>(() => {
    if (!isVenue || !event || !myVenue) return 'unknown';
    if (event.venue_id === myVenue.id) return 'lead_venue';
    if (event.partner_venue_id === myVenue.id) return 'partner_venue';
    return 'unknown';
  }, [isVenue, event, myVenue]);

  const eventLink = event ? `${window.location.origin}/event/${event.id}` : '';
  const copyLink = () => { navigator.clipboard.writeText(eventLink); toast.success(t('Lien copié', 'Link copied', 'Enlace copiado')); };
  const fmtWhen = (iso: string) => new Date(iso).toLocaleString(
    language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-US',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' },
  );

  // ── Loading / not-found, in the right chrome ───────────────────────────────
  if (loading) {
    return (
      <Chrome isVenue={isVenue} title={t('Collaboration', 'Collaboration', 'Colaboración')}>
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} /></div>
      </Chrome>
    );
  }
  if (notFound || !event) {
    return (
      <Chrome isVenue={isVenue} title={t('Collaboration', 'Collaboration', 'Colaboración')}>
        <OrgCard><div className="p-8 text-center" style={{ color: T3, fontSize: 13 }}>
          {t('Soirée introuvable.', 'Event not found.', 'Evento no encontrado.')}
          <div className="mt-4">
            <OrgButton variant="secondary" onClick={() => navigate(isVenue ? '/owner/collaborations' : '/organizer-app/events')}>
              <ArrowLeft className="h-4 w-4" /> {isVenue ? t('Collaborations', 'Collaborations', 'Colaboraciones') : t('Événements', 'Events', 'Eventos')}
            </OrgButton>
          </div>
        </div></OrgCard>
      </Chrome>
    );
  }

  // ── Access / role derived flags ────────────────────────────────────────────
  const isOwner = isOrganizer && !!user && event.organizer_user_id === user.id;
  if (isOrganizer && !isOwner && contractLoading) {
    return (
      <Chrome isVenue={isVenue} title={t('Collaboration', 'Collaboration', 'Colaboración')}>
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} /></div>
      </Chrome>
    );
  }
  const contractAccepted = contractStatus === 'active' || contractStatus === 'locked' || contractStatus === 'closed';
  // The club always manages its own surfaces; the organizer unlocks once the
  // contract is signed (otherwise a partner could reshape the deal before agreeing).
  const canManage = isVenue || isOwner || contractAccepted;
  const isCollab = !!(event.partner_venue_id || event.partner_organizer_id || event.event_mode === 'co_event');
  // Back target: clubs always come from the collab hub; organizers come from the
  // hub for co-events but from their events list for their own solo nights.
  const backTo = isVenue ? '/owner/collaborations' : (isCollab ? '/organizer-app/collaborations' : '/organizer-app/events');
  const backLabel = (isVenue || isCollab) ? t('Collaborations', 'Collaborations', 'Colaboraciones') : t('Événements', 'Events', 'Eventos');
  const isPartnerVenue = venueRole === 'partner_venue';
  const canEditGoal = isVenue && venueRole === 'lead_venue' && !isReadOnly;
  const ticketingLive = !!event.ticketing_enabled;
  const clubVenueIdForLive = event.venue_id ?? event.partner_venue_id;

  const navTo = {
    live: isVenue ? '/owner/live' : `/organizer-app/events/${eventId}/live`,
    analytics: isVenue ? '/owner/analytics' : `/organizer-app/analytics?event=${eventId}`,
    promoters: isVenue ? '/owner/promoters' : `/organizer-app/promoters/event/${eventId}`,
    guestList: isVenue ? '/owner/guest-list' : '/organizer-app/guest-list',
    checkin: isVenue ? '/owner/live' : '/organizer-app/checkin',
    bookDj: isVenue ? '/owner/book-dj' : '/organizer-app/book-dj',
    ticketing: isVenue ? '/owner/ticketing' : '/organizer-app/ticketing',
  };
  const openTicketing = () => navigate(navTo.ticketing);

  const phasePill =
    phase === 'before' ? { tone: 'info' as const, label: t('À venir', 'Upcoming', 'Próximo') }
    : phase === 'live' ? { tone: 'success' as const, label: t('En direct', 'Live', 'En directo') }
    : { tone: 'muted' as const, label: t('Terminée', 'Ended', 'Finalizado') };

  const goalParticipants = stats.ticketsSold + stats.tableGuests + stats.glEntries;

  const inner = (
    <>
      <button onClick={() => navigate(backTo)} className="mb-4 inline-flex items-center gap-1 text-[13px]" style={{ color: T3, background: 'transparent', border: 'none' }}>
        <ArrowLeft className="h-4 w-4" /> {backLabel}
      </button>

      <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 style={{ color: T1, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>{event.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {isCollab && <OrgPill tone="default">{t('Co-événement', 'Co-event', 'Coevento')}</OrgPill>}
            <OrgPill tone={phasePill.tone}>{phasePill.label}</OrgPill>
            <OrgPill tone={event.visibility === 'public' ? 'success' : 'muted'}>
              {event.visibility === 'public' ? t('Public', 'Public', 'Público') : event.visibility === 'private' ? t('Privé', 'Private', 'Privado') : t('Non listé', 'Unlisted', 'No listado')}
            </OrgPill>
            {event.split_locked_at && <OrgPill tone="muted"><Lock className="h-3 w-3" /> {t('Répartition verrouillée', 'Split locked', 'Reparto bloqueado')}</OrgPill>}
            {!canManage && <OrgPill tone="warn">{t('Aperçu', 'Preview', 'Vista previa')}</OrgPill>}
          </div>
          {/* Collaborating identities — club ↔ organizer */}
          {isCollab && (
            <div className="mt-3 flex flex-wrap items-center gap-2" style={{ fontSize: 12.5 }}>
              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }}>
                <Building2 className="h-3.5 w-3.5" style={{ color: RED }} /> <span className="truncate max-w-[38vw]">{clubName || t('Le club', 'The club', 'El club')}</span>
              </span>
              <span style={{ color: T3 }}>·</span>
              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }}>
                <Megaphone className="h-3.5 w-3.5" style={{ color: RED }} />
                {orgSlug ? (
                  <Link to={`/o/${orgSlug}`} className="inline-flex items-center gap-1 truncate max-w-[38vw]" style={{ color: T1, textDecoration: 'none' }}>
                    {orgName || t('Organisateur', 'Organizer', 'Organizador')} <ExternalLink className="h-3 w-3" />
                  </Link>
                ) : <span className="truncate max-w-[38vw]">{orgName || t('Organisateur', 'Organizer', 'Organizador')}</span>}
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <OrgButton size="sm" variant="secondary" onClick={() => navigate(navTo.live)}>
              <Radio className="h-4 w-4" /> {t('Live', 'Live', 'Live')}
            </OrgButton>
          )}
          {canManage && (
            <OrgButton size="sm" variant="secondary" onClick={copyLink}>
              <Copy className="h-4 w-4" /> {t('Copier le lien', 'Copy link', 'Copiar enlace')}
            </OrgButton>
          )}
          <OrgButton size="sm" variant="secondary" href={eventLink}>
            <ExternalLink className="h-4 w-4" /> {t('Voir', 'View', 'Ver')}
          </OrgButton>
        </div>
      </header>

      <div className="space-y-4">
        {/* Read-only preview (organizer not yet signed) */}
        {!canManage && (
          <OrgCard>
            <div className="flex items-start gap-3 p-5">
              <Eye className="mt-0.5 h-5 w-5 shrink-0" style={{ color: RED }} />
              <div>
                <p style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t('Aperçu de la soirée', 'Event preview', 'Vista previa del evento')}</p>
                <p className="mt-1" style={{ color: T3, fontSize: 12.5, lineHeight: 1.5 }}>
                  {t(
                    `${clubName || 'Un club'} te propose de co-organiser cette soirée. Consulte les détails et le contrat ci-dessous, puis signe-le pour ouvrir la gestion. Tant que tu n'as pas signé, rien n'est modifiable.`,
                    `${clubName || 'A club'} invites you to co-host this event. Review the details and the contract below, then sign it to unlock management. Nothing is editable until you sign.`,
                    `${clubName || 'Un club'} te propone coorganizar este evento. Revisa los detalles y el contrato y fírmalo para gestionar. Nada es editable hasta que firmes.`,
                  )}
                </p>
              </div>
            </div>
          </OrgCard>
        )}

        {/* Contract — kept high for trust + sign action */}
        <SplitContractBanner eventId={event.id} side={viewerRole} />

        {/* Club sans Stripe : sa part de chaque vente resterait bloquée chez Yuno
            (versement en échec). Avertir AVANT la première vente, avec le lien
            direct vers l'activation — miroir du prompt organisateur plus bas. */}
        {isVenue && venueStripeReady === false && (
          <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.22)' }}>
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" style={{ color: RED }} />
              <div className="flex-1">
                <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>
                  {t('Connectez Stripe pour recevoir votre part', 'Connect Stripe to receive your share', 'Conecta Stripe para recibir tu parte')}
                </p>
                <p className="mt-1" style={{ color: T3, fontSize: 11.5 }}>
                  {t(
                    'Sans compte Stripe actif, votre part de chaque vente ne peut pas vous être versée après la soirée. L\'activation prend quelques minutes.',
                    'Without an active Stripe account, your share of each sale cannot be paid out to you after the event. Activation takes a few minutes.',
                    'Sin una cuenta de Stripe activa, tu parte de cada venta no puede pagarse después del evento. La activación tarda unos minutos.',
                  )}
                </p>
              </div>
            </div>
            <OrgButton size="sm" variant="primary" onClick={() => navigate('/owner/billing')}>
              <CreditCard className="h-4 w-4" />{t('Activer Stripe', 'Activate Stripe', 'Activar Stripe')}
            </OrgButton>
          </div>
        )}

        {/* Communication — synced both sides */}
        {isCollab && (
          <CollabMessageThread eventId={event.id} authorRole={viewerRole} venueLabel={clubName} organizerLabel={orgName} />
        )}

        {canManage ? (
          <>
            {/* Money — shared night revenue, your own share */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard icon={Ticket} label={t('Vendus', 'Sold', 'Vendidos')} value={stats.sold} />
              <StatCard icon={BarChart3} label={t('CA de la soirée', 'Night revenue', 'Ingresos de la noche')} value={`${stats.caSoiree.toFixed(2)} €`}
                sub={isVenue
                  ? t('Billets + tables + bar, hors frais Yuno', 'Tickets + tables + bar, excl. Yuno fees', 'Entradas + mesas + bar, sin comisión Yuno')
                  : t('Billets + tables, hors frais Yuno', 'Tickets + tables, excl. Yuno fees', 'Entradas + mesas, sin comisión Yuno')} />
              <StatCard icon={TrendingUp} label={t('Ma part du CA', 'My revenue share', 'Mi parte de ingresos')} value={`${stats.myShare.toFixed(2)} €`}
                sub={t('Avant frais Stripe', 'Before Stripe fees', 'Antes de comisiones Stripe')} />
              <StatCard icon={ScanLine} label={t('Check-ins', 'Check-ins', 'Check-ins')} value={stats.checkins} />
              <StatCard icon={Sparkles} label={t('Mon gain net', 'My net share', 'Mi ganancia neta')} value={netGain.loading ? '…' : `${netGain.netEuros.toFixed(2)} €`}
                sub={t('Après frais Stripe & Yuno + part partenaire', 'After Stripe & Yuno fees + partner share', 'Tras comisiones Stripe y Yuno + parte del socio')} accent />
            </div>

            <PayoutStatusNote gain={netGain} className="-mt-1" />

            {/* Quick access to every tool for this night */}
            {isCollab && (
              <OrgCard>
                <div className="p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <LayoutGrid className="h-4 w-4" style={{ color: RED }} />
                    <h2 style={{ color: T1, fontSize: 15, fontWeight: 600 }}>{t('Outils de la soirée', 'Event tools', 'Herramientas de la noche')}</h2>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    <ToolTile icon={Radio} label={t('Live', 'Live', 'Live')} onClick={() => navigate(navTo.live)} />
                    {canSideEdit(event.collab_responsibilities, event.event_mode, 'ticketing', viewerSide) && (
                      <ToolTile icon={Ticket} label={t('Billetterie', 'Ticketing', 'Entradas')}
                        onClick={() => (isVenue || ticketingLive ? openTicketing() : setBilletterieOpen(true))} />
                    )}
                    <ToolTile icon={BarChart3} label={t('Analyse', 'Analytics', 'Análisis')} onClick={() => navigate(navTo.analytics)} />
                    <ToolTile icon={Megaphone} label={t('Promoteurs', 'Promoters', 'Promotores')} onClick={() => navigate(navTo.promoters)} />
                    <ToolTile icon={Users} label={t('Guest list', 'Guest list', 'Guest list')} onClick={() => navigate(navTo.guestList)} />
                    <ToolTile icon={ScanLine} label={t('Check-in', 'Check-in', 'Check-in')} onClick={() => navigate(navTo.checkin)} />
                    <ToolTile icon={Music} label={t('Booking DJ', 'Book DJ', 'Reservar DJ')} onClick={() => navigate(navTo.bookDj)} />
                    <ToolTile icon={ExternalLink} label={t('Page publique', 'Public page', 'Página pública')} href={eventLink} />
                  </div>
                </div>
              </OrgCard>
            )}

            {/* Organizer-only inline management (ticketing activation + tables + drinks) */}
            {isOrganizer && (
              <>
                <OrgCard>
                  <div className="p-6">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <h2 style={{ color: T1, fontSize: 16, fontWeight: 600 }}>{t('Billetterie', 'Ticketing', 'Entradas')}</h2>
                      {canSideEdit(event.collab_responsibilities, event.event_mode, 'ticketing', 'organizer') && (stripeLoading || canSell) && (
                        ticketingLive ? (
                          <OrgButton size="sm" variant="primary" onClick={openTicketing}>
                            <Ticket className="h-4 w-4" />{t('Gérer la billetterie', 'Manage ticketing', 'Gestionar entradas')}
                          </OrgButton>
                        ) : (
                          <OrgButton size="sm" variant="primary" onClick={() => setBilletterieOpen(true)}>
                            <Ticket className="h-4 w-4" />{t('Activer la billetterie', 'Activate ticketing', 'Activar entradas')}
                          </OrgButton>
                        )
                      )}
                    </div>
                    {!canSideEdit(event.collab_responsibilities, event.event_mode, 'ticketing', 'organizer') ? (
                      <p className="flex items-start gap-2" style={{ color: T3, fontSize: 13 }}>
                        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                        {t(
                          'Sur cette soirée, le club gère seul la billetterie. Vous vous concentrez sur le marketing et le partage.',
                          'For this event the club alone manages ticketing. You focus on marketing and sharing.',
                          'En esta noche, el club gestiona solo la venta de entradas. Tú te enfocas en el marketing y la difusión.',
                        )}
                      </p>
                    ) : !stripeLoading && !canSell ? (
                      <div className="space-y-3 rounded-xl p-4" style={{ background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.22)' }}>
                        <div className="flex items-start gap-2">
                          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" style={{ color: RED }} />
                          <div className="flex-1">
                            <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{t('Activez Stripe pour vendre des billets', 'Activate Stripe to sell tickets', 'Activa Stripe para vender entradas')}</p>
                            <p className="mt-1" style={{ color: T3, fontSize: 11.5 }}>
                              {stripeStatus === 'pending'
                                ? t('Onboarding incomplet — terminez la configuration dans Réglages.', 'Onboarding incomplete — finish configuration in Settings.', 'Onboarding incompleto: termina la configuración en Ajustes.')
                                : t('Vous devez configurer vos paiements avant de créer des billets.', 'You must configure payments before creating tickets.', 'Debes configurar tus pagos antes de crear entradas.')}
                            </p>
                          </div>
                        </div>
                        <OrgButton size="sm" variant="primary" onClick={() => navigate('/organizer-app/payments')}>
                          <CreditCard className="h-4 w-4" />{t('Configurer les paiements', 'Configure payments', 'Configurar pagos')}
                        </OrgButton>
                      </div>
                    ) : (
                      <p style={{ color: T3, fontSize: 13 }}>
                        {t('Configurez vos tarifs, palliers de prix, présale et liste privée depuis la page Billetterie unifiée.',
                           'Configure your tiers, price rounds, presale and private list from the unified Ticketing page.',
                           'Configura tus tarifas, tramos de precio, preventa y lista privada desde la página de Entradas unificada.')}
                      </p>
                    )}
                  </div>
                </OrgCard>

                {user && <OrgEventTablesPanel eventId={event.id} organizerUserId={user.id} />}
                <OrgEventDrinksMenu eventId={event.id} />
              </>
            )}

            {/* ── Shared transparency block — identical info both sides ───────── */}
            {isCollab && (
              <Section icon={Target} title={t('Objectif commun', 'Shared goal', 'Objetivo común')}
                sub={t("La cible que vous visez tous les deux.", 'The target you both rally around.', 'El objetivo que ambos perseguís.')}>
                <CollabGoal
                  eventId={event.id}
                  goalType={event.collab_goal_type}
                  goalValue={event.collab_goal_value}
                  ticketsSold={stats.ticketsSold}
                  revenue={stats.caSoiree}
                  participants={goalParticipants}
                  canEdit={canEditGoal}
                  onSaved={(gt, gv) => setEvent((prev: any) => (prev ? { ...prev, collab_goal_type: gt, collab_goal_value: gv } : prev))}
                />
              </Section>
            )}

            {isCollab && scopeId && (
              <Section icon={UsersRound} title={t('Qui est venu', 'Who showed up', 'Quién vino')}
                sub={t('Âge, sexe et villes du public — agrégé et anonyme.', "The crowd's age, gender and cities — aggregated and anonymous.", 'Edad, sexo y ciudades del público, agregado y anónimo.')}>
                <EventAudienceDemographics scope={{ kind: viewerRole === 'venue' ? 'venue' : 'organizer', id: scopeId }} eventId={event.id} />
              </Section>
            )}

            {isCollab && phase === 'live' && (
              <Section icon={Radio} title={t('En direct', 'Live now', 'En directo')}
                sub={t('Ventes, scans et affluence en temps réel.', 'Sales, scans and crowd in real time.', 'Ventas, escaneos y aforo en tiempo real.')}>
                <EventLiveModule eventId={event.id} venueId={clubVenueIdForLive} />
              </Section>
            )}
            {isCollab && phase === 'after' && (
              <Section icon={Trophy} title={t('Le verdict', 'The verdict', 'El veredicto')}
                sub={t(
                  'Cette soirée a-t-elle été un succès ? Chiffres de la soirée entière, avant répartition entre partenaires.',
                  'Was this night a success? Whole-night figures, before the partner split.',
                  '¿Fue un éxito esta noche? Cifras de la noche completa, antes del reparto entre socios.',
                )}>
                <EventPostAnalysisView key={event.id} eventId={event.id}
                  venueId={isVenue ? (myVenue?.id ?? null) : null}
                  organizerUserId={isOrganizer ? user?.id : null} />
              </Section>
            )}

            {/* Proof — acquisition sources + the revenue split */}
            <Section icon={TrendingUp} title={t('La soirée en preuve', 'The night, proven', 'La noche, en pruebas')}
              sub={t("D'où viennent les ventes et comment le revenu se partage.", 'Where the sales come from and how revenue splits.', 'De dónde vienen las ventas y cómo se reparte el ingreso.')}>
              <OrgCard><div className="p-5"><PurchaseSourceBreakdown eventId={event.id} /></div></OrgCard>
              {event.revenue_split_rules && (
                <OrgCard>
                  <div className="p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <Euro className="h-4 w-4" style={{ color: RED }} />
                      <h3 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t('Contrat de partage', 'Revenue split contract', 'Contrato de reparto')}</h3>
                    </div>
                    <SplitContractView rules={event.revenue_split_rules} t={t} />
                  </div>
                </OrgCard>
              )}
            </Section>

            {/* Details — every operational table behind one drawer */}
            {isCollab && (
              <DetailsDrawer
                eventId={event.id}
                isVenue={isVenue}
                guestReadOnly={isOrganizer || isPartnerVenue}
                t={t}
              />
            )}

            {/* Conversion close — only clubs on the free collab plan */}
            {isVenue && isCollab && <CollabConversionClose venueName={myVenue?.name} phase={phase} />}
          </>
        ) : (
          // Organizer preview (not signed): show poster + details only
          <OrgCard>
            <div className="p-6">
              <div className="flex gap-4">
                {event.poster_url ? (
                  <img src={event.poster_url} alt="" className="h-28 w-20 flex-none rounded-lg object-cover" style={{ border: '1px solid rgba(255,255,255,0.08)' }} />
                ) : (
                  <div className="flex h-28 w-20 flex-none items-center justify-center rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <Building2 className="h-6 w-6" style={{ color: T3 }} />
                  </div>
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2" style={{ color: T1, fontSize: 13 }}>
                    <CalendarClock className="h-4 w-4 shrink-0" style={{ color: T3 }} />
                    <span className="capitalize">{fmtWhen(event.start_at)}</span>
                  </div>
                  {clubName && (
                    <div className="flex items-center gap-2" style={{ color: T1, fontSize: 13 }}>
                      <Building2 className="h-4 w-4 shrink-0" style={{ color: T3 }} />
                      <span>{clubName}</span>
                    </div>
                  )}
                  {event.description && (
                    <p style={{ color: T3, fontSize: 12.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{event.description}</p>
                  )}
                  <div className="pt-1">
                    <OrgButton size="sm" variant="secondary" href={eventLink}>
                      <ExternalLink className="h-4 w-4" /> {t('Voir la page de la soirée', 'View the event page', 'Ver la página del evento')}
                    </OrgButton>
                  </div>
                </div>
              </div>
            </div>
          </OrgCard>
        )}

        {/* Signer sans remonter : la page est longue, et « Examiner » mène ici. */}
        {isCollab && (
          <CollabSignFooter
            eventId={event.id}
            side={viewerRole}
            eventTitle={event.title}
            onSigned={() => window.location.reload()}
          />
        )}
      </div>

      {isOrganizer && (
        <OrgBilletterieDialog
          eventId={event.id}
          open={billetterieOpen}
          onOpenChange={setBilletterieOpen}
          onCreate={() => { setBilletterieOpen(false); openTicketing(); }}
          onActivated={() => setEvent((e: any) => (e ? { ...e, ticketing_enabled: true } : e))}
        />
      )}
    </>
  );

  return <Chrome isVenue={isVenue} title={t('Collaboration', 'Collaboration', 'Colaboración')}>{inner}</Chrome>;
}

/* ── Outer chrome — owner gradient + header for venue, OrgPage for organizer ── */
function Chrome({ isVenue, title, children }: { isVenue: boolean; title: string; children: React.ReactNode }) {
  if (isVenue) {
    return (
      <div className="min-h-screen dashboard-gradient-bg">
        <OwnerHeader title={title} />
        <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 max-w-5xl">{children}</div>
      </div>
    );
  }
  return <OrgPage className="mx-auto max-w-5xl">{children}</OrgPage>;
}

/* ── Section wrapper — chapter header (icon + title + subtitle) ─────────────── */
function Section({ icon: Icon, title, sub, children }: { icon: any; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-xl" style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}` }}>
          <Icon className="h-4 w-4" style={{ color: RED }} />
        </div>
        <div>
          <h2 style={{ color: T1, fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</h2>
          {sub && <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>{sub}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function ToolTile({ icon: Icon, label, onClick, href }: { icon: any; label: string; onClick?: () => void; href?: string }) {
  const inner = (
    <>
      <Icon className="h-5 w-5" style={{ color: RED }} />
      <span style={{ color: T1, fontSize: 12, fontWeight: 540 }}>{label}</span>
    </>
  );
  const cls = 'flex flex-col items-center justify-center gap-2 rounded-xl p-4 text-center transition-colors hover:bg-white/[0.03]';
  const style = { border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.015)' } as const;
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls} style={style}>{inner}</a>
  ) : (
    <button onClick={onClick} className={cls} style={style}>{inner}</button>
  );
}

function StatCard({ icon: Icon, label, value, sub, accent }: { icon: any; label: string; value: number | string; sub?: string; accent?: boolean }) {
  return (
    <OrgCard style={accent ? { boxShadow: `0 0 0 1px rgba(232,25,44,0.2), 0 1px 0 rgba(255,255,255,.05) inset` } : undefined}>
      <div className="p-4">
        <div className="mb-1 flex items-center justify-between">
          <span style={{ color: accent ? RED : T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</span>
          <Icon className="h-4 w-4" style={{ color: accent ? RED : T3 }} />
        </div>
        <div style={{ color: accent ? RED : T1, fontSize: 22, fontWeight: 700 }}>{value}</div>
        {sub && <div style={{ color: T3, fontSize: 10, marginTop: 2 }}>{sub}</div>}
      </div>
    </OrgCard>
  );
}

/* ── Shared goal — the objectif commun both parties rally around ────────────── */
function CollabGoal({ eventId, goalType, goalValue, ticketsSold, revenue, participants, canEdit, onSaved }: {
  eventId: string;
  goalType: string | null;
  goalValue: number | null;
  ticketsSold: number;
  revenue: number;
  participants: number;
  canEdit: boolean;
  onSaved: (gt: string | null, gv: number | null) => void;
}) {
  const { language } = useLanguage();
  const tt = (frv: string, en: string, es?: string) => translate(language, frv, en, es);
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<'tickets' | 'revenue' | 'attendees'>((goalType as any) || 'tickets');
  const [value, setValue] = useState<string>(goalValue ? String(goalValue) : '');
  const [saving, setSaving] = useState(false);

  const hasGoal = !!goalType && !!goalValue && goalValue > 0;
  const current = goalType === 'revenue' ? revenue : goalType === 'attendees' ? participants : ticketsSold;
  const pct = hasGoal ? Math.min(100, Math.round((current / (goalValue as number)) * 100)) : 0;
  const reached = hasGoal && current >= (goalValue as number);

  const typeOptions: { key: 'tickets' | 'revenue' | 'attendees'; label: string }[] = [
    { key: 'tickets', label: tt('Billets', 'Tickets', 'Entradas') },
    { key: 'revenue', label: tt('CA', 'Revenue', 'Ingresos') },
    { key: 'attendees', label: tt('Participants', 'Guests', 'Asistentes') },
  ];
  const unit = (ty: string, n: number) => (ty === 'revenue' ? `${Math.round(n).toLocaleString()} €` : n.toLocaleString());

  const save = async () => {
    const v = Number(value);
    if (!v || v <= 0) { toast.error(tt('Entre une cible valide.', 'Enter a valid target.', 'Indica un objetivo válido.')); return; }
    setSaving(true);
    const { error } = await (supabase.from('events') as any).update({ collab_goal_type: type, collab_goal_value: v }).eq('id', eventId);
    setSaving(false);
    if (error) { toast.error(tt('Échec de l\'enregistrement.', 'Could not save.', 'No se pudo guardar.')); return; }
    onSaved(type, v);
    setEditing(false);
    toast.success(tt('Objectif commun défini.', 'Shared goal set.', 'Objetivo común definido.'));
  };

  const clear = async () => {
    setSaving(true);
    const { error } = await (supabase.from('events') as any).update({ collab_goal_type: null, collab_goal_value: null }).eq('id', eventId);
    setSaving(false);
    if (error) { toast.error(tt('Échec.', 'Failed.', 'Error.')); return; }
    onSaved(null, null);
    setEditing(false);
  };

  if (!hasGoal && !canEdit) {
    return <OrgCard><div className="p-5" style={{ color: T3, fontSize: 12.5 }}>{tt('Aucun objectif commun défini pour le moment.', 'No shared goal set yet.', 'Aún no hay objetivo común.')}</div></OrgCard>;
  }

  if (editing) {
    return (
      <OrgCard>
        <div className="p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: T1 }}>
            <Target className="h-4 w-4" style={{ color: RED }} /> {tt('Objectif commun', 'Shared goal', 'Objetivo común')}
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {typeOptions.map((o) => (
              <button key={o.key} type="button" onClick={() => setType(o.key)} className="h-8 rounded-full px-3 text-xs font-medium transition-colors"
                style={{ background: type === o.key ? 'rgba(232,25,44,0.14)' : INNER_BG, border: `1px solid ${type === o.key ? 'rgba(232,25,44,0.3)' : BORDER}`, color: type === o.key ? RED : T2 }}>
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input type="number" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder={type === 'revenue' ? '5000' : '300'}
              className="h-10 min-w-0 flex-1 rounded-xl px-3 text-sm outline-none" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: '#fff' }} />
            <span className="flex-none text-xs" style={{ color: T3 }}>{type === 'revenue' ? '€' : ''}</span>
            <OrgButton size="sm" variant="primary" onClick={save} disabled={saving}><Check className="h-4 w-4" /> {tt('Définir', 'Set', 'Definir')}</OrgButton>
            <OrgButton size="sm" variant="secondary" onClick={() => setEditing(false)} disabled={saving}><X className="h-4 w-4" /></OrgButton>
          </div>
          {hasGoal && (
            <button type="button" onClick={clear} disabled={saving} className="mt-2 text-[11px] transition-colors" style={{ color: T3 }}>
              {tt('Retirer l\'objectif', 'Remove goal', 'Quitar objetivo')}
            </button>
          )}
        </div>
      </OrgCard>
    );
  }

  if (!hasGoal && canEdit) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-medium transition-colors"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.14)', color: T2 }}>
        <Target className="h-4 w-4" /> {tt('Définir un objectif commun', 'Set a shared goal', 'Definir un objetivo común')}
      </button>
    );
  }

  const goalTypeLabel = goalType === 'revenue' ? tt('de CA', 'in revenue', 'de ingresos')
    : goalType === 'attendees' ? tt('participants', 'guests', 'asistentes')
    : tt('billets', 'tickets', 'entradas');

  return (
    <OrgCard>
      <div className="p-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide" style={{ color: reached ? '#34D399' : RED }}>
            <Target className="h-3.5 w-3.5" /> {tt('Objectif commun', 'Shared goal', 'Objetivo común')}
          </div>
          {canEdit && (
            <button type="button" onClick={() => setEditing(true)} style={{ color: T3 }} aria-label={tt('Modifier', 'Edit', 'Editar')}>
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="mb-2 flex items-end justify-between gap-3">
          <div className="text-lg font-bold tabular-nums" style={{ color: T1 }}>
            {unit(goalType as string, current)} <span className="text-sm font-medium" style={{ color: T3 }}>/ {unit(goalType as string, goalValue as number)} {goalTypeLabel}</span>
          </div>
          <div className="text-2xl font-bold tabular-nums" style={{ color: reached ? '#34D399' : RED }}>{pct}%</div>
        </div>
        <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(pct === 0 ? 0 : 3, pct)}%`, background: reached ? '#34D399' : RED }} />
        </div>
        {reached && (
          <p className="mt-2 text-xs font-medium" style={{ color: '#34D399' }}>
            {tt('Objectif atteint. Bravo à vous deux.', 'Goal reached. Nice work, both of you.', 'Objetivo alcanzado. Bien hecho, los dos.')}
          </p>
        )}
      </div>
    </OrgCard>
  );
}

/* ── Split contract view — normalized split rules per category ──────────────── */
function SplitContractView({ rules, t }: { rules: any; t: (fr: string, en: string, es?: string) => string }) {
  const normalized = normalizeSplitRules(rules);
  if (!normalized) return <p style={{ color: T3, fontSize: 13 }}>{t('Aucun contrat.', 'No contract.', 'Sin contrato.')}</p>;
  const entries = Object.entries(normalized).filter(([, v]) => typeof v === 'object' && v !== null);
  const catLabel = (k: string) => k === 'tickets' ? t('Billets', 'Tickets', 'Entradas') : k === 'tables' ? t('Tables', 'Tables', 'Mesas') : k === 'drinks' ? t('Boissons', 'Drinks', 'Bebidas') : k.replace(/_/g, ' ');
  return (
    <div className="space-y-2" style={{ fontSize: 13 }}>
      {entries.map(([key, val]: [string, any]) => (
        <div key={key} className="flex items-center justify-between rounded-lg p-2.5" style={{ background: INNER_BG }}>
          <span style={{ color: T2 }}>{catLabel(key)}</span>
          <div className="flex gap-3" style={{ fontSize: 12 }}>
            <span style={{ color: T3 }}>{t('Club', 'Club', 'Club')} <strong style={{ color: T1 }}>{val.venue_pct ?? val.venue ?? 0}%</strong></span>
            <span style={{ color: T3 }}>{t('Orga', 'Org', 'Org')} <strong style={{ color: T1 }}>{val.organizer_pct ?? val.organizer ?? 0}%</strong></span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Details drawer — every operational table behind one toggle ─────────────── */
function DetailsDrawer({ eventId, isVenue, guestReadOnly, t }: { eventId: string; isVenue: boolean; guestReadOnly: boolean; t: (fr: string, en: string, es?: string) => string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex h-12 w-full items-center justify-between rounded-xl px-4 transition-colors hover:bg-white/[0.03]"
        style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
        <span className="flex items-center gap-2" style={{ color: T1, fontSize: 13.5, fontWeight: 540 }}>
          <FileText className="h-4 w-4" style={{ color: T3 }} />
          {t('Détails de gestion', 'Management details', 'Detalles de gestión')}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: T3 }} />
      </button>
      {open && (
        <div className="space-y-4">
          <DrawerCard icon={UserPlus} title={t('Guest list', 'Guest list', 'Guest list')}>
            <EventGuestListModule eventId={eventId} readOnly={guestReadOnly} />
          </DrawerCard>
          <DrawerCard icon={Ticket} title={t('Commandes billets', 'Ticket orders', 'Pedidos de entradas')}>
            {isVenue ? <OwnerTicketOrders eventId={eventId} /> : <OwnerTicketOrders eventIds={[eventId]} />}
          </DrawerCard>
          <DrawerCard icon={Wine} title={t('Réservations VIP', 'VIP reservations', 'Reservas VIP')}>
            {isVenue ? <OwnerVipOrders eventId={eventId} /> : <OwnerVipOrders eventIds={[eventId]} />}
          </DrawerCard>
          <DrawerCard icon={ScanLine} title={t('Boissons vendues', 'Drinks sold', 'Bebidas vendidas')}>
            <OwnerDrinkOrders eventId={eventId} />
          </DrawerCard>
          <EventInvoicesModule eventId={eventId} />
        </div>
      )}
    </div>
  );
}

function DrawerCard({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <OrgCard>
      <div className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Icon className="h-4 w-4" style={{ color: T3 }} />
          <h3 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{title}</h3>
        </div>
        {children}
      </div>
    </OrgCard>
  );
}
