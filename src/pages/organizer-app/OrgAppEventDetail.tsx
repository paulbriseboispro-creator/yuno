import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { ArrowLeft, Copy, ExternalLink, Ticket, BarChart3, ScanLine, AlertCircle, CreditCard, Sparkles, Radio, Loader2, Lock, Eye, CalendarClock, Building2, Megaphone, Music, Users, LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganizerStripe } from '@/hooks/useOrganizerStripe';
import { useEventCollabContract } from '@/hooks/useEventCollabContract';
import { SplitContractBanner } from '@/components/SplitContractBanner';
import { CollabMessageThread } from '@/components/collab/CollabMessageThread';
import { OrgEventTablesPanel } from '@/components/organizer-app/OrgEventTablesPanel';
import { OrgEventDrinksMenu } from '@/components/organizer-app/OrgEventDrinksMenu';
import { OrgBilletterieDialog } from '@/components/organizer-app/OrgBilletterieDialog';
import { PurchaseSourceBreakdown } from '@/components/analytics/PurchaseSourceBreakdown';
import { useEventNetGain } from '@/hooks/useEventNetGain';
import {
  OrgPage, OrgCard, OrgPill, OrgButton,
  RED, T1, T3,
} from '@/components/org-ui';

export default function OrgAppEventDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  const { user } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const [event, setEvent] = useState<any>(null);
  const [clubName, setClubName] = useState<string>('');
  const [stats, setStats] = useState({ sold: 0, revenue: 0, checkins: 0 });
  const [loading, setLoading] = useState(true);
  const [billetterieOpen, setBilletterieOpen] = useState(false);
  const { canSell, status: stripeStatus, loading: stripeLoading } = useOrganizerStripe(user?.id);
  const netGain = useEventNetGain(user?.id ? eventId : null, { kind: 'organizer', organizerUserId: user?.id || '' });
  const { status: contractStatus, isLoading: contractLoading } = useEventCollabContract(eventId, 'organizer');

  useEffect(() => {
    if (!user || !eventId) return;
    (async () => {
      // Match events I lead (organizer_user_id) AND co-events a club proposed to
      // me (partner_organizer_id) — otherwise a proposed collaboration couldn't be
      // opened, so its accept/decline banner stayed invisible.
      const { data: ev } = await supabase
        .from('events')
        .select('*')
        .eq('id', eventId)
        .or(`organizer_user_id.eq.${user.id},partner_organizer_id.eq.${user.id}`)
        .maybeSingle();

      if (!ev) { navigate('/organizer-app/events'); return; }
      setEvent(ev);

      // For the collab thread: resolve the partner club's name (lead or partner venue).
      const clubVenueId = ev.partner_venue_id ?? ev.venue_id;
      if (clubVenueId) {
        const { data: v } = await supabase.from('venues').select('name').eq('id', clubVenueId).maybeSingle();
        if (v) setClubName(v.name);
      }

      const { data: tickets } = await supabase
        .from('tickets')
        .select('total_price, service_fee, insurance_fee, entry_scanned')
        .eq('event_id', eventId)
        .eq('status', 'paid');

      setStats({
        sold: tickets?.length ?? 0,
        // Club revenue excludes Yuno fees (service + insurance) — never Yuno's cut.
        revenue: (tickets ?? []).reduce((s, t: any) => s + (Number(t.total_price ?? 0) - Number(t.service_fee ?? 0) - Number(t.insurance_fee ?? 0)), 0),
        checkins: (tickets ?? []).filter((t: any) => t.entry_scanned).length,
      });
      setLoading(false);
    })();
  }, [user, eventId, navigate]);

  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const eventLink = event ? `${window.location.origin}/event/${event.id}` : '';
  const copyLink = () => { navigator.clipboard.writeText(eventLink); toast.success(t('Lien copié', 'Link copied')); };

  if (loading || !event) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} /></div>;
  }

  // Co-event access gate. A club can PROPOSE a co-event to this organizer; until the
  // organizer signs the contract, they get a READ-ONLY preview (check the details +
  // the proposed split via the contract banner) instead of full management. Only the
  // event owner (org-led events) or an accepted contract unlocks ticketing/tables/
  // drinks editing — otherwise the partner could reshape the club's billetterie before
  // ever agreeing to the deal.
  const isOwner = !!user && event.organizer_user_id === user.id;
  // Wait for the contract before deciding for non-owners, else an accepted co-event
  // briefly flashes the read-only preview before the management UI loads in.
  if (!isOwner && contractLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} /></div>;
  }
  const contractAccepted = contractStatus === 'active' || contractStatus === 'locked' || contractStatus === 'closed';
  const canManage = isOwner || contractAccepted;
  const isCollab = !!(event.partner_venue_id || event.partner_organizer_id || event.event_mode === 'co_event');
  const ticketingLive = !!event.ticketing_enabled;
  const openTicketing = () => navigate('/organizer-app/ticketing');
  const fmtWhen = (iso: string) => new Date(iso).toLocaleString(
    language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-US',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' },
  );

  return (
    <OrgPage className="mx-auto max-w-5xl">
      <button onClick={() => navigate('/organizer-app/events')} className="mb-4 inline-flex items-center gap-1 text-[13px]" style={{ color: T3 }}>
        <ArrowLeft className="h-4 w-4" /> {t('Retour', 'Back')}
      </button>

      <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 style={{ color: T1, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>{event.title}</h1>
          <div className="mt-2 flex gap-2">
            <OrgPill tone={event.visibility === 'public' ? 'success' : 'muted'}>
              {event.visibility === 'public' ? t('Public', 'Public') : event.visibility === 'private' ? t('Privé', 'Private') : t('Non listé', 'Unlisted')}
            </OrgPill>
            {event.discovery_status === 'pending' && event.visibility === 'public' && (
              <OrgPill tone="warn">{t('En attente de validation', 'Pending review')}</OrgPill>
            )}
            {!canManage && <OrgPill tone="warn">{t('Aperçu', 'Preview', 'Vista previa')}</OrgPill>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <OrgButton size="sm" variant="secondary" onClick={() => navigate(`/organizer-app/events/${eventId}/live`)}>
              <Radio className="h-4 w-4" /> {t('Live', 'Live')}
            </OrgButton>
          )}
          {canManage && (
            <OrgButton size="sm" variant="secondary" onClick={copyLink}>
              <Copy className="h-4 w-4" /> {t('Copier le lien', 'Copy link')}
            </OrgButton>
          )}
          <OrgButton size="sm" variant="secondary" href={eventLink}>
            <ExternalLink className="h-4 w-4" /> {t('Voir', 'View')}
          </OrgButton>
        </div>
      </header>

      <div className="space-y-4">
        {!canManage && (
          <OrgCard>
            <div className="flex items-start gap-3 p-5">
              <Eye className="mt-0.5 h-5 w-5 shrink-0" style={{ color: RED }} />
              <div>
                <p style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t('Aperçu de la soirée', 'Event preview', 'Vista previa del evento')}</p>
                <p className="mt-1" style={{ color: T3, fontSize: 12.5, lineHeight: 1.5 }}>
                  {t(
                    `${clubName || 'Un club'} te propose de co-organiser cette soirée. Consulte les détails et le contrat ci-dessous, puis signe-le pour ouvrir la gestion de la billetterie, des tables et des boissons. Tant que tu n'as pas signé, rien n'est modifiable.`,
                    `${clubName || 'A club'} invites you to co-host this event. Review the details and the contract below, then sign it to unlock ticketing, tables and drinks management. Nothing is editable until you sign.`,
                    `${clubName || 'Un club'} te propone coorganizar este evento. Revisa los detalles y el contrato y fírmalo para gestionar entradas, mesas y bebidas. Nada es editable hasta que firmes.`,
                  )}
                </p>
              </div>
            </div>
          </OrgCard>
        )}

        <SplitContractBanner eventId={event.id} side="organizer" />

        {(event.event_mode === 'co_event' || event.partner_venue_id || event.partner_organizer_id) && (
          <CollabMessageThread eventId={event.id} authorRole="organizer" venueLabel={clubName} />
        )}

        {canManage ? (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              <StatCard icon={Ticket} label={t('Vendus', 'Sold')} value={stats.sold} />
              <StatCard icon={BarChart3} label={t('Revenu', 'Revenue')} value={`${stats.revenue.toFixed(2)} €`} />
              <StatCard icon={ScanLine} label={t('Check-ins', 'Check-ins')} value={stats.checkins} />
              <StatCard icon={Sparkles} label={t('Mon gain net', 'My net share')} value={netGain.loading ? '…' : `${netGain.netEuros.toFixed(2)} €`}
                sub={t('Après frais Stripe & Yuno + part partenaire', 'After Stripe & Yuno fees + partner share')} accent />
            </div>

            {/* Collab mini-dashboard — quick access to every tool for this night. */}
            {isCollab && (
              <OrgCard>
                <div className="p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <LayoutGrid className="h-4 w-4" style={{ color: RED }} />
                    <h2 style={{ color: T1, fontSize: 15, fontWeight: 600 }}>{t('Outils de la soirée', 'Event tools', 'Herramientas de la noche')}</h2>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    <ToolTile icon={Radio} label={t('Live', 'Live')} onClick={() => navigate(`/organizer-app/events/${eventId}/live`)} />
                    {/* org_hosted: le club gère la billetterie → pas de tuile de gestion côté orga. */}
                    {event.event_mode !== 'org_hosted' && (
                      <ToolTile icon={Ticket} label={t('Billetterie', 'Ticketing')}
                        onClick={() => (ticketingLive ? openTicketing() : setBilletterieOpen(true))} />
                    )}
                    <ToolTile icon={BarChart3} label={t('Analyse', 'Analytics', 'Análisis')} onClick={() => navigate(`/organizer-app/analytics?event=${eventId}`)} />
                    <ToolTile icon={Megaphone} label={t('Promoteurs', 'Promoters', 'Promotores')} onClick={() => navigate(`/organizer-app/promoters/event/${eventId}`)} />
                    <ToolTile icon={Users} label={t('Guest list', 'Guest list')} onClick={() => navigate('/organizer-app/guest-list')} />
                    <ToolTile icon={ScanLine} label={t('Check-in', 'Check-in')} onClick={() => navigate('/organizer-app/checkin')} />
                    <ToolTile icon={Music} label={t('Booking DJ', 'Book DJ')} onClick={() => navigate('/organizer-app/book-dj')} />
                    <ToolTile icon={ExternalLink} label={t('Page publique', 'Public page', 'Página pública')} href={eventLink} />
                  </div>
                </div>
              </OrgCard>
            )}

            <OrgCard>
              <div className="p-6">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h2 style={{ color: T1, fontSize: 16, fontWeight: 600 }}>{t('Billetterie', 'Ticketing')}</h2>
                  {event.event_mode !== 'org_hosted' && (stripeLoading || canSell) && (
                    ticketingLive ? (
                      <OrgButton size="sm" variant="primary" onClick={openTicketing}>
                        <Ticket className="h-4 w-4" />{t('Gérer la billetterie', 'Manage ticketing')}
                      </OrgButton>
                    ) : (
                      <OrgButton size="sm" variant="primary" onClick={() => setBilletterieOpen(true)}>
                        <Ticket className="h-4 w-4" />{t('Activer la billetterie', 'Activate ticketing')}
                      </OrgButton>
                    )
                  )}
                </div>
                {event.event_mode === 'org_hosted' ? (
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
                        <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{t('Activez Stripe pour vendre des billets', 'Activate Stripe to sell tickets')}</p>
                        <p className="mt-1" style={{ color: T3, fontSize: 11.5 }}>
                          {stripeStatus === 'pending'
                            ? t('Onboarding incomplet — terminez la configuration dans Réglages.', 'Onboarding incomplete — finish configuration in Settings.')
                            : t('Vous devez configurer vos paiements avant de créer des billets.', 'You must configure payments before creating tickets.')}
                        </p>
                      </div>
                    </div>
                    <OrgButton size="sm" variant="primary" onClick={() => navigate('/organizer-app/payments')}>
                      <CreditCard className="h-4 w-4" />{t('Configurer les paiements', 'Configure payments')}
                    </OrgButton>
                  </div>
                ) : (
                  <p style={{ color: T3, fontSize: 13 }}>
                    {t('Configurez vos tarifs, palliers de prix, présale et liste privée depuis la page Billetterie unifiée.',
                       'Configure your tiers, price rounds, presale and private list from the unified Ticketing page.')}
                  </p>
                )}
              </div>
            </OrgCard>

            {user && <OrgEventTablesPanel eventId={event.id} organizerUserId={user.id} />}
            <OrgEventDrinksMenu eventId={event.id} />
            <PurchaseSourceBreakdown eventId={event.id} />
          </>
        ) : (
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
      </div>

      <OrgBilletterieDialog
        eventId={event.id}
        open={billetterieOpen}
        onOpenChange={setBilletterieOpen}
        onCreate={() => { setBilletterieOpen(false); openTicketing(); }}
        onActivated={() => setEvent((e: any) => (e ? { ...e, ticketing_enabled: true } : e))}
      />
    </OrgPage>
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
