import { useState, useEffect, useMemo } from 'react';
import { OwnerHeader } from '@/components/OwnerHeader';
import { useSearchParams } from 'react-router-dom';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { Bell, Send, Loader2, Users, Sparkles, CalendarClock, Coins } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  PUSH_TEMPLATES, renderPushTemplate,
  type PushTemplate,
} from '@/lib/pushTemplates';
import { eventPath } from '@/lib/eventUrl';
import AIContentGenerator from '@/components/campaigns/AIContentGenerator';
import PushHistoryCard from '@/components/push/PushHistoryCard';
import FollowersNudge from '@/components/push/FollowersNudge';
import { usePushCampaigns } from '@/hooks/usePushCampaigns';
import type { PushFilter } from '@/lib/pushHistory';
import { PUBLIC_BASE_URL } from '@/lib/native';
import { capturePosthog } from '@/lib/posthog';
import { useTabParam } from '@/hooks/useTabParam';
import { Segmented } from '@/components/event-report/ui';
import PushCenterView from '@/components/push/PushCenterView';
import PushCreditsCard from '@/components/push/PushCreditsCard';
import { usePushCredits } from '@/hooks/usePushCenter';
import { campaignCost, type PushCredits } from '@/lib/pushEngine';

// ─── Yuno Design Tokens (pro dashboard) ──────────────────────────────────────
const RED        = '#E8192C';
const POS        = 'var(--acc-34d399)';
const T1         = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2         = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const T3         = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const BORDER     = 'rgb(var(--ink)/0.085)';
const F_BORDER   = 'rgb(var(--ink)/0.055)';
const INNER_BG   = 'rgb(var(--ink)/0.032)';
const TILE_BG    = 'rgb(var(--ink)/0.025)';
const CARD_BG    = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';

const inputStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
  color: T1, fontSize: 13, padding: '9px 12px', width: '100%', outline: 'none',
};

const labelStyle: React.CSSProperties = {
  display: 'block', color: T3, fontSize: 11, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6,
};

type VenueEvent = {
  id: string;
  title: string;
  start_at: string;
  slug: string | null;
};

// Un organisateur ne tient pas de bar : le modèle « Flash boissons » n'a pas
// de sens chez lui.
const ORG_HIDDEN_TEMPLATES = new Set(['flash_drinks']);
const HISTORY_PAGE_SIZE = 20;

const RFM_SEGMENTS = ['champions', 'loyal', 'promising', 'new', 'at_risk', 'dormant', 'lost'] as const;
const RFM_LABEL_KEYS: Record<string, string> = {
  champions: 'seg.champions', loyal: 'seg.loyal', promising: 'seg.promising',
  new: 'seg.new', at_risk: 'seg.atRisk', dormant: 'seg.dormant', lost: 'seg.lost',
};

export default function OwnerPush() {
  const { t, language } = useLanguage();
  const { venueId, venue, loading: venueLoading, scope: dashScope, organizerUserId } = useVenueContext();
  // Même page pour le club et pour l'organisateur (Console Organisateur →
  // Marketing & CRM → Notifications push). Tout ce qui est venue-scopé
  // (automatisations, RFM, segments sauvegardés, assistant IA) reste au club.
  const isOrg = dashScope === 'organizer';
  const ready = isOrg ? !!organizerUserId : !!venueId;
  const scopeBody = isOrg ? { organizer_user_id: organizerUserId } : { venue_id: venueId };
  // Deux onglets adressables (barre latérale) : ce que Yuno envoie pour toi,
  // et tes propres campagnes (crédits).
  const [tab, setTab] = useTabParam<'auto' | 'campaigns'>('auto', ['auto', 'campaigns'] as const);

  const [template, setTemplate] = useState<PushTemplate | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('/');
  const [manuallyEdited, setManuallyEdited] = useState(false);
  // Contenu IA appliqué « dans les 3 langues » : chaque destinataire recevra
  // sa langue à l'envoi. Purgé dès que l'owner édite le texte à la main
  // (le texte affiché divergerait des deux autres langues).
  const [i18nContent, setI18nContent] = useState<{ title_i18n: Record<string, string>; body_i18n: Record<string, string> } | null>(null);
  const [offer, setOffer] = useState('');
  const [count, setCount] = useState('');
  const [events, setEvents] = useState<VenueEvent[]>([]);
  const [eventId, setEventId] = useState<string>('');
  const [audience, setAudience] = useState<string>('followers');
  const [rfmSegment, setRfmSegment] = useState<string>('champions');
  const [reach, setReach] = useState<number | null>(null);
  const [reachLoading, setReachLoading] = useState(false);
  const [reachError, setReachError] = useState<string | null>(null);
  // Règles Yuno des push manuels (send-push-campaign → filter_manual_push_recipients).
  const [quietHours, setQuietHours] = useState(false);
  const [heldBack, setHeldBack] = useState(0);
  const [policyKind, setPolicyKind] = useState<'marketing' | 'event' | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<PushFilter>('manual');
  const [historyPage, setHistoryPage] = useState(0);
  const [orgProfile, setOrgProfile] = useState<{ name: string; slug: string | null } | null>(null);
  const [savedSegments, setSavedSegments] = useState<Array<{ id: string; name: string }>>([]);
  const [scheduledAt, setScheduledAt] = useState<string>(''); // datetime-local ; vide = envoi immédiat
  const [bestSlot, setBestSlot] = useState<{ dow: number; hour: number } | null>(null);
  // Ce que l'envoi coûtera (réponse du dry_run) : 1 crédit pour une campagne
  // marketing, gratuit pour un message aux détenteurs d'une soirée.
  const [dryCredits, setDryCredits] = useState<PushCredits | null>(null);
  const [eventInfoLeft, setEventInfoLeft] = useState<number | null>(null);
  const [marketingLast24h, setMarketingLast24h] = useState(0);

  const scope = audience === 'rfm' ? `rfm:${rfmSegment}` : audience;
  const needsEvent = audience === 'event_tickets' || audience === 'checked_in';
  const selectedEvent = events.find((e) => e.id === eventId);

  // Soirées de la portée (ce soir + à venir) pour le ciblage et les variables.
  useEffect(() => {
    if (!ready) return;
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    let q = supabase
      .from('events')
      .select('id, title, start_at, slug');
    q = isOrg
      ? q.or(`organizer_user_id.eq.${organizerUserId},partner_organizer_id.eq.${organizerUserId}`)
      : q.eq('venue_id', venueId as string);
    q
      .gte('start_at', twelveHoursAgo)
      .order('start_at', { ascending: true })
      .limit(20)
      .then(({ data }) => {
        const rows = (data || []) as VenueEvent[];
        setEvents(rows);
        if (rows.length > 0) setEventId((prev) => prev || rows[0].id);
      });
  }, [ready, isOrg, venueId, organizerUserId]);

  // Nom et adresse publique de l'organisation (variables + lien à partager).
  useEffect(() => {
    if (!isOrg || !organizerUserId) return;
    supabase
      .from('organizer_profiles')
      .select('display_name, slug')
      .eq('user_id', organizerUserId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setOrgProfile({ name: data.display_name, slug: data.slug });
      });
  }, [isOrg, organizerUserId]);

  const history = usePushCampaigns(
    isOrg ? { organizerUserId } : { venueId },
    historyFilter,
    historyPage,
    HISTORY_PAGE_SIZE,
  );
  const reloadHistory = history.reload;
  const creditsScope = isOrg ? { organizerUserId } : { venueId };
  const { credits, loading: creditsLoading, reload: reloadCredits } = usePushCredits(creditsScope);

  // Meilleur créneau d'envoi (user_send_profiles agrégés par get_audience_notifications).
  // Best-effort : sans données, le hint ne s'affiche pas.
  useEffect(() => {
    if (!ready) return;
    (async () => {
      try {
        const { data } = await supabase.rpc('get_audience_notifications' as never, {
          p_subject_type: isOrg ? 'organizer' : 'venue', p_subject_id: isOrg ? organizerUserId : venueId,
        } as never);
        const bs = (data as { best_send?: { dow: number | null; hour: number | null } } | null)?.best_send;
        if (bs && typeof bs.dow === 'number' && typeof bs.hour === 'number') setBestSlot({ dow: bs.dow, hour: bs.hour });
      } catch { /* hint optionnel */ }
    })();
  }, [ready, isOrg, venueId, organizerUserId]);

  const hostName = isOrg ? (orgProfile?.name || '') : (venue?.name || '');

  // Interpolation live du template tant que l'owner n'a pas édité à la main.
  const templateValues = useMemo(() => ({
    venue: hostName,
    event: selectedEvent?.title || '',
    offer,
    count,
  }), [hostName, selectedEvent?.title, offer, count]);

  useEffect(() => {
    if (!template || manuallyEdited) return;
    setTitle(renderPushTemplate(t(template.titleKey), templateValues));
    setBody(renderPushTemplate(t(template.bodyKey), templateValues));
  }, [template, templateValues, manuallyEdited, t]);

  const pickTemplate = (tpl: PushTemplate) => {
    setTemplate(tpl);
    setManuallyEdited(false);
    setI18nContent(null);
    setAudience(tpl.suggestedAudience);
    setOffer('');
    setCount('');
  };

  // Pré-sélection de modèle via ?prefill=<templateKey> — utilisée par les
  // alertes live ops (« Push flash drinks » quand le bar peut absorber plus).
  const [searchParams] = useSearchParams();
  // Un lien « Push » depuis un segment ou une alerte ouvre directement l'envoi.
  useEffect(() => {
    if (searchParams.get('prefill') || searchParams.get('segment')) setTab('campaigns');
  }, [searchParams, setTab]);
  useEffect(() => {
    const prefill = searchParams.get('prefill');
    if (!prefill) return;
    const tpl = PUSH_TEMPLATES.find((candidate) => candidate.key === prefill);
    if (tpl) pickTemplate(tpl);
     
  }, [searchParams]);

  // Segments sauvegardés du club (page Clients) — ciblables en push.
  useEffect(() => {
    if (!venueId) return;
    supabase
      .from('venue_segments' as never)
      .select('id, name')
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setSavedSegments(((data as unknown) as Array<{ id: string; name: string }>) || []));
  }, [venueId]);

  // Pré-sélection d'un segment via ?segment=<uuid> (bouton « Push » de la page Clients).
  useEffect(() => {
    const seg = searchParams.get('segment');
    if (seg) setAudience(`segment:${seg}`);
  }, [searchParams]);

  // URL par défaut : la soirée sélectionnée, sinon la page du club.
  // Organisateur : `/event/<uuid>` est toujours résolu (la forme à slug exige
  // le slug d'orga), et la page publique est `/o/<slug>`.
  useEffect(() => {
    if (isOrg) {
      if (selectedEvent) setUrl(`/event/${selectedEvent.id}`);
      else if (orgProfile?.slug) setUrl(`/o/${orgProfile.slug}`);
      return;
    }
    if (selectedEvent) {
      setUrl(eventPath({ id: selectedEvent.id, slug: selectedEvent.slug, isOrganizerLed: false, venueSlug: venueId || undefined }));
    } else if (venueId) {
      setUrl(`/club/${venueId}`);
    }
  }, [isOrg, selectedEvent, venueId, orgProfile?.slug]);

  // Portée estimée (dry_run débouncé). En cas d'échec on REMONTE la cause
  // (403 owner/manager, erreur segments…) au lieu d'un « … » silencieux.
  useEffect(() => {
    if (!ready) return;
    if (needsEvent && !eventId) { setReach(0); return; }
    setReachLoading(true);
    setReachError(null);
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('send-push-campaign', {
          body: {
            title: '·', body: '·', dry_run: true,
            ...scopeBody, scope,
            ...(needsEvent ? { event_id: eventId } : {}),
            // Heures calmes jugées à l'heure d'ENVOI, planifiée ou non.
            ...(scheduledAt && new Date(scheduledAt).getTime() > Date.now() ? { scheduled_at: new Date(scheduledAt).toISOString() } : {}),
          },
        });
        if (error) {
          // FunctionsHttpError : le body JSON porte la vraie cause.
          let detail = error.message;
          try {
            const ctx = (error as { context?: Response }).context;
            if (ctx) detail = (await ctx.json())?.error || detail;
          } catch { /* body illisible */ }
          console.error('[Push] dry_run failed:', detail);
          setReach(null);
          setReachError(detail);
          return;
        }
        setReach(typeof data?.targeted === 'number' ? data.targeted : null);
        setQuietHours(!!data?.quiet_hours);
        setHeldBack(typeof data?.held_back === 'number' ? data.held_back : 0);
        setPolicyKind(data?.policy === 'event' || data?.policy === 'marketing' ? data.policy : null);
        setDryCredits(data?.credits ?? null);
        setEventInfoLeft(typeof data?.event_info_left === 'number' ? data.event_info_left : null);
        setMarketingLast24h(typeof data?.marketing_last_24h === 'number' ? data.marketing_last_24h : 0);
        if (data?.error) setReachError(String(data.error));
      } catch (e) {
        console.error('[Push] dry_run failed:', e);
        setReach(null);
        setReachError(e instanceof Error ? e.message : 'unknown');
      } finally {
        setReachLoading(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [ready, isOrg, venueId, organizerUserId, scope, eventId, needsEvent, scheduledAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const pad2 = (n: number) => String(n).padStart(2, '0');

  // Prochaine occurrence locale du meilleur créneau, au format datetime-local.
  const nextBestSlotLocal = (): string | null => {
    if (!bestSlot) return null;
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(bestSlot.hour);
    d.setDate(d.getDate() + ((bestSlot.dow - d.getDay() + 7) % 7));
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 7);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };

  // Prochain 10 h (fin des heures calmes), au format datetime-local.
  const nextTenLocal = (): string => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    if (d.getHours() >= 10) d.setDate(d.getDate() + 1);
    d.setHours(10);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };

  const bestSlotDayLabel = (): string => {
    if (!bestSlot) return '';
    // extract(dow) SQL et getDay() JS partagent 0 = dimanche.
    const ref = new Date();
    ref.setDate(ref.getDate() + ((bestSlot.dow - ref.getDay() + 7) % 7));
    const tag = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
    return ref.toLocaleDateString(tag, { weekday: 'long' });
  };

  const handleSend = async () => {
    if (!ready || !title.trim() || !body.trim()) return;
    if (scheduledAt && new Date(scheduledAt).getTime() <= Date.now()) {
      toast.error(t('ownerPush.schedulePast'));
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-push-campaign', {
        body: {
          title: title.trim(), body: body.trim(), url: url.trim() || '/',
          ...scopeBody, scope,
          ...(needsEvent ? { event_id: eventId } : {}),
          template_key: template?.key || 'custom',
          ...(i18nContent ? { title_i18n: i18nContent.title_i18n, body_i18n: i18nContent.body_i18n } : {}),
          ...(scheduledAt ? { scheduled_at: new Date(scheduledAt).toISOString() } : {}),
        },
      });
      if (error) {
        // supabase-js enveloppe les non-2xx ; extraire le vrai message (429 → rate limit).
        let msg = error.message;
        try {
          const errAny = error as { context?: { json?: () => Promise<{ error?: string }> } };
          if (errAny.context?.json) {
            const bodyJson = await errAny.context.json();
            if (bodyJson?.error === 'campaign_rate_limited') {
              toast.error(t('pe.send.rateLimited'));
              return;
            }
            if (bodyJson?.error === 'no_credits') {
              toast.error(t('pe.send.noCredits'));
              reloadCredits();
              return;
            }
            if (bodyJson?.error === 'event_info_limit') {
              toast.error(t('pe.send.eventInfoLimit'));
              return;
            }
            if (bodyJson?.error === 'quiet_hours') {
              toast.error(t('ph.policy.quietToast'));
              return;
            }
            if (bodyJson?.error === 'no_eligible_recipients') {
              toast.error(t('ph.policy.noEligibleToast'));
              return;
            }
            if (bodyJson?.error) msg = bodyJson.error;
          }
        } catch { /* garder msg */ }
        throw new Error(msg);
      }
      capturePosthog('push_campaign_sent', {
        scope: isOrg ? 'organizer' : 'venue',
        venue_id: isOrg ? null : venueId,
        organizer_user_id: isOrg ? organizerUserId : null,
        audience: scope,
        template: template?.key || 'custom',
        scheduled: !!scheduledAt,
        recipients: data?.sent ?? null,
      });
      if (scheduledAt) toast.success(t('ownerPush.scheduledToast'));
      else toast.success(t('ownerPush.sentToast').replace('{count}', String(data?.sent || 0)));
      setConfirmOpen(false);
      setTemplate(null);
      setTitle(''); setBody(''); setManuallyEdited(false); setI18nContent(null);
      setScheduledAt('');
      setHistoryPage(0);
      reloadHistory();
      reloadCredits();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('ownerPush.sendError'));
    } finally {
      setSending(false);
    }
  };

  if (venueLoading || !ready) return <OwnerPageSkeleton />;

  // Garde-fous des campagnes manuelles, lus dans le dry_run (le serveur tranche).
  const isMarketing = campaignCost(scope) === 1;
  const liveCredits = dryCredits ?? credits;
  const blockedKey = isMarketing
    ? ((liveCredits?.remaining ?? 1) <= 0 ? 'pe.send.noCreditsShort'
      : (liveCredits && marketingLast24h >= liveCredits.marketingPer24h ? 'pe.send.rateLimitedShort' : ''))
    : (eventInfoLeft === 0 ? 'pe.send.eventInfoLimitShort' : '');
  const blocked = blockedKey !== '';

  const audienceOptions = isOrg
    ? [
      { value: 'event_tickets', label: t('ownerPush.audEventTickets') },
      { value: 'checked_in', label: t('ownerPush.audCheckedIn') },
      { value: 'followers', label: t('ph.audOrgFollowers') },
      { value: 'all_customers', label: t('ownerPush.audAllCustomers') },
    ]
    : [
      { value: 'event_tickets', label: t('ownerPush.audEventTickets') },
      { value: 'checked_in', label: t('ownerPush.audCheckedIn') },
      { value: 'followers', label: t('ownerPush.audFollowers') },
      { value: 'rfm', label: t('ownerPush.audRfm') },
      { value: 'all_customers', label: t('ownerPush.audAllCustomers') },
    ];
  const templates = isOrg ? PUSH_TEMPLATES.filter((tpl) => !ORG_HIDDEN_TEMPLATES.has(tpl.key)) : PUSH_TEMPLATES;
  const publicPath = isOrg ? (orgProfile?.slug ? `/o/${orgProfile.slug}` : null) : `/club/${venueId}`;
  const publicUrl = publicPath ? `${PUBLIC_BASE_URL}${publicPath}` : null;

  return (
    <div className="min-h-screen pb-16" style={{ background: 'var(--sf-000000)' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      {/* Club : l'en-tête collant de ses autres pages (titre, cloche, langue,
          profil). L'organisateur a déjà la barre de son layout. */}
      {!isOrg && <OwnerHeader title={t('ownerPush.title')} />}

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">

        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          {isOrg ? (
            <div className="flex items-center gap-3">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-xl flex-none"
                style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}
              >
                <Bell className="h-4 w-4" style={{ color: RED }} />
              </div>
              <div>
                <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
                  {t('ownerPush.title')}
                </h1>
                <p style={{ color: T3, fontSize: 12.5, marginTop: 3 }}>{t('pe.subtitle')}</p>
              </div>
            </div>
          ) : (
            <p style={{ color: T3, fontSize: 12.5 }}>{t('pe.subtitle')}</p>
          )}
          <Segmented<'auto' | 'campaigns'>
            label={t('pe.tabs.label')}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'auto', label: t('pe.tabs.auto') },
              { value: 'campaigns', label: t('pe.tabs.campaigns') },
            ]}
          />
        </div>

        {history.data && (
          <FollowersNudge
            followers={history.data.followers}
            pageUrl={publicUrl}
            fileSlug={isOrg ? (orgProfile?.slug || 'yuno') : (venueId || 'yuno')}
          />
        )}

        {/* ─── Automatiques : ce que Yuno envoie pour les soirées ─────────── */}
        {tab === 'auto' && (
          <PushCenterView scope={isOrg ? { organizerUserId } : { venueId }} />
        )}

        {tab === 'campaigns' && (<>
        <PushCreditsCard credits={credits} loading={creditsLoading} scope={creditsScope} onChanged={reloadCredits} />

        {/* ─── Notifications MANUELLES ─────────────────────────────────── */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22 }}>
          <div className="flex items-start gap-2.5 mb-4">
            <Sparkles className="h-4 w-4 mt-0.5 flex-none" style={{ color: T2 }} />
            <div>
              <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
                {t('ownerPush.manualSectionTitle')}
              </h3>
              <p style={{ color: T3, fontSize: 12.5, marginTop: 3, lineHeight: 1.5 }}>{t('ownerPush.manualSectionSubtitle')}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {templates.map((tpl) => (
              <button
                key={tpl.key}
                onClick={() => pickTemplate(tpl)}
                className="text-left p-3.5 rounded-xl transition-all duration-150"
                style={{
                  background: template?.key === tpl.key ? 'rgba(232,25,44,0.08)' : TILE_BG,
                  border: `1px solid ${template?.key === tpl.key ? 'rgba(232,25,44,0.35)' : F_BORDER}`,
                }}
              >
                <span style={{ fontSize: 22 }}>{tpl.emoji}</span>
                <p style={{ color: T1, fontSize: 13, fontWeight: 600, marginTop: 8 }}>{t(`ownerPush.tplName.${tpl.key}`)}</p>
                <p style={{ color: T3, fontSize: 11.5, marginTop: 3, lineHeight: 1.4 }}>{t(`ownerPush.tplDesc.${tpl.key}`)}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Étape 2 — Composition + ciblage */}
        {template && (
          <div className="grid lg:grid-cols-[1fr,340px] gap-6 items-start">
            <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22 }} className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
                  {t('ownerPush.composeTitle')}
                </h3>
                {!isOrg && <AIContentGenerator
                  channel="push"
                  eventId={eventId || null}
                  segment={scope}
                  onApply={(c) => { setTitle(c.title); setBody(c.body); setManuallyEdited(true); setI18nContent(null); }}
                  onApplyAll={(v, lang) => {
                    setTitle(v[lang].title);
                    setBody(v[lang].body);
                    setManuallyEdited(true);
                    setI18nContent({
                      title_i18n: { en: v.en.title, fr: v.fr.title, es: v.es.title },
                      body_i18n: { en: v.en.body, fr: v.fr.body, es: v.es.body },
                    });
                  }}
                />}
              </div>

              {/* Variables spécifiques au template */}
              {(template.variables.includes('offer') || template.variables.includes('count')) && (
                <div className="grid grid-cols-2 gap-4">
                  {template.variables.includes('offer') && (
                    <div>
                      <label style={labelStyle}>{t('ownerPush.offerLabel')}</label>
                      <input value={offer} onChange={(e) => setOffer(e.target.value)} placeholder={t('ownerPush.offerPlaceholder')} style={inputStyle} maxLength={60} />
                    </div>
                  )}
                  {template.variables.includes('count') && (
                    <div>
                      <label style={labelStyle}>{t('ownerPush.countLabel')}</label>
                      <input value={count} onChange={(e) => setCount(e.target.value)} placeholder="20" style={inputStyle} inputMode="numeric" maxLength={5} />
                    </div>
                  )}
                </div>
              )}

              <div>
                <label style={labelStyle}>{t('ownerPush.titleLabel')}</label>
                <input
                  value={title}
                  onChange={(e) => { setTitle(e.target.value); setManuallyEdited(true); setI18nContent(null); }}
                  maxLength={80}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t('ownerPush.bodyLabel')}</label>
                <textarea
                  value={body}
                  onChange={(e) => { setBody(e.target.value); setManuallyEdited(true); setI18nContent(null); }}
                  maxLength={200}
                  rows={3}
                  style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }}
                />
                {i18nContent && (
                  <div className="flex items-center gap-2 mt-2">
                    <span style={{ color: POS, fontSize: 10.5, fontWeight: 700, border: '1px solid rgba(52,211,153,0.3)', background: 'rgba(52,211,153,0.08)', borderRadius: 5, padding: '2px 6px', letterSpacing: '0.05em' }}>
                      EN · FR · ES
                    </span>
                    <span style={{ color: T3, fontSize: 11 }}>{t('ownerPush.multilangHint')}</span>
                  </div>
                )}
              </div>
              <div>
                <label style={labelStyle}>{t('ownerPush.urlLabel')}</label>
                <input value={url} onChange={(e) => setUrl(e.target.value)} style={inputStyle} />
              </div>

              {/* Ciblage */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label style={labelStyle}>{t('ownerPush.eventLabel')}</label>
                  <Select value={eventId} onValueChange={setEventId} disabled={events.length === 0}>
                    <SelectTrigger style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, color: T1, fontSize: 13, height: 'auto', padding: '9px 12px' }}>
                      <SelectValue placeholder={t('ownerPush.eventNone')} />
                    </SelectTrigger>
                    <SelectContent>
                      {events.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.title} · {new Date(e.start_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label style={labelStyle}>{t('ownerPush.audienceLabel')}</label>
                  <Select value={audience} onValueChange={setAudience}>
                    <SelectTrigger style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, color: T1, fontSize: 13, height: 'auto', padding: '9px 12px' }}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {audienceOptions.map((a) => (
                        <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                      ))}
                      {savedSegments.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>{t('ownerPush.audSavedSegments')}</SelectLabel>
                          {savedSegments.map((sg) => (
                            <SelectItem key={sg.id} value={`segment:${sg.id}`}>{sg.name}</SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {audience === 'rfm' && (
                <div>
                  <label style={labelStyle}>{t('ownerPush.rfmLabel')}</label>
                  <Select value={rfmSegment} onValueChange={setRfmSegment}>
                    <SelectTrigger style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, color: T1, fontSize: 13, height: 'auto', padding: '9px 12px' }}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RFM_SEGMENTS.map((s) => (
                        <SelectItem key={s} value={s}>{t(RFM_LABEL_KEYS[s])}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {needsEvent && events.length === 0 && (
                <p style={{ color: T3, fontSize: 12 }}>{t('ownerPush.needEvent')}</p>
              )}

              {/* Programmation (optionnelle) — l'infra scheduled_at + cron existait déjà */}
              <div>
                <label style={labelStyle}>{t('ownerPush.scheduleLabel')}</label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  style={{ ...inputStyle, colorScheme: 'dark' }}
                />
                <p style={{ color: T3, fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>{t('ownerPush.scheduleHelp')}</p>
                {bestSlot && (
                  <p className="flex items-center gap-2 flex-wrap" style={{ color: T2, fontSize: 11.5, marginTop: 8 }}>
                    <Sparkles className="h-3 w-3" style={{ color: POS }} />
                    {t('ownerPush.bestSlotHint')
                      .replace('{day}', bestSlotDayLabel())
                      .replace('{hour}', `${bestSlot.hour}h`)}
                    <button
                      onClick={() => { const v = nextBestSlotLocal(); if (v) setScheduledAt(v); }}
                      className="underline underline-offset-2 cursor-pointer transition-all duration-150"
                      style={{ color: POS, fontSize: 11.5, fontWeight: 600 }}
                    >
                      {t('ownerPush.bestSlotUse')}
                    </button>
                  </p>
                )}
              </div>

              {/* Ce que coûte l'envoi : 1 crédit (marketing) ou gratuit (info soirée) */}
              {(() => {
                const cost = campaignCost(scope);
                const left = dryCredits?.remaining ?? credits?.remaining ?? null;
                const text = cost === 0
                  ? (eventInfoLeft == null ? t('pe.cost.eventInfo') : t('pe.cost.eventInfoLeft').replace('{n}', String(eventInfoLeft)))
                  : (left == null ? t('pe.cost.oneCredit') : (left === 1 ? t('pe.cost.oneCreditLeftOne') : t('pe.cost.oneCreditLeft')).replace('{n}', String(left)));
                return (
                  <p className="flex items-center gap-2" style={{ color: blocked ? RED : T2, fontSize: 12 }}>
                    <Coins className="h-3.5 w-3.5 flex-none" />{text}
                    {blocked && <span style={{ color: RED }}> · {t(blockedKey)}</span>}
                  </p>
                );
              })()}

              {/* Portée + envoi */}
              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="flex items-center gap-2 tabular-nums" style={{ color: T2, fontSize: 12.5 }}>
                  {reachLoading
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: T3 }} />
                    : <Users className="h-3.5 w-3.5" style={{ color: (reach ?? 0) > 0 ? POS : T3 }} />}
                  {!reachLoading && reach === null && reachError
                    ? t('ownerPush.reachError')
                    : t('ownerPush.reach').replace('{count}', String(reach ?? '…'))}
                </span>
                <button
                  onClick={() => setConfirmOpen(true)}
                  disabled={sending || quietHours || blocked || !title.trim() || !body.trim() || (needsEvent && !eventId) || (reach ?? 0) === 0}
                  className="inline-flex items-center justify-center gap-2 rounded-xl text-[13px] font-semibold transition-all duration-150"
                  style={{
                    background: RED, color: '#fff', padding: '11px 18px',
                    boxShadow: `0 0 18px -6px ${RED}88`,
                    opacity: (sending || quietHours || blocked || !title.trim() || !body.trim() || (needsEvent && !eventId) || (reach ?? 0) === 0) ? 0.5 : 1,
                  }}
                >
                  {scheduledAt ? <CalendarClock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                  {scheduledAt ? t('ownerPush.scheduleCta') : t('ownerPush.sendCta')}
                </button>
              </div>

              {/* Règles Yuno : heures calmes et personnes protégées */}
              {!reachLoading && quietHours && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl p-3" style={{ background: 'rgba(252,211,77,0.07)', border: '1px solid rgba(252,211,77,0.22)' }}>
                  <p style={{ color: T2, fontSize: 12, lineHeight: 1.5, flex: '1 1 260px' }}>{t('ph.policy.quiet')}</p>
                  <button
                    type="button"
                    onClick={() => setScheduledAt(nextTenLocal())}
                    className="rounded-lg px-3 py-1.5 text-[12px] font-semibold"
                    style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }}
                  >
                    {t('ph.policy.scheduleAt10')}
                  </button>
                </div>
              )}
              {!reachLoading && !quietHours && heldBack > 0 && (
                <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.5 }}>
                  {(heldBack === 1 ? t('ph.policy.heldBackOne') : t('ph.policy.heldBack')).replace('{n}', String(heldBack))}
                </p>
              )}
              {!reachLoading && policyKind === 'event' && (reach ?? 0) > 0 && (
                <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.5 }}>{t('ph.policy.eventNote')}</p>
              )}

              {/* Explication quand la portée est vide ou en erreur — jamais un « … » muet */}
              {!reachLoading && !quietHours && heldBack === 0 && (reach === 0 || (reach === null && reachError)) && (
                <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.5 }}>
                  {reach === 0 ? t('ownerPush.reachZeroHint') : reachError}
                </p>
              )}
            </div>

            {/* Aperçu notification iOS */}
            <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22 }}>
              <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 16 }}>
                {t('ownerPush.preview')}
              </h3>
              <div
                className="rounded-2xl p-3.5"
                style={{ background: 'rgb(var(--glass-30-30-32)/0.92)', border: '1px solid rgb(var(--ink)/0.10)', backdropFilter: 'blur(20px)' }}
              >
                <div className="flex items-start gap-2.5">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-[9px] flex-none"
                    style={{ background: 'var(--sf-050505)', border: '1px solid rgb(var(--ink)/0.12)' }}
                  >
                    <span style={{ color: RED, fontWeight: 800, fontSize: 13 }}>Y</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate" style={{ color: 'rgb(var(--ink))', fontSize: 13, fontWeight: 600 }}>
                        {title || t('ownerPush.previewTitleFallback')}
                      </p>
                      <span style={{ color: 'rgb(var(--ink)/var(--ink-a40,0.4))', fontSize: 11 }}>{t('ownerPush.previewNow')}</span>
                    </div>
                    <p style={{ color: 'rgb(var(--ink)/var(--ink-a75,0.75))', fontSize: 12.5, lineHeight: 1.45, marginTop: 2 }}>
                      {body || t('ownerPush.previewBodyFallback')}
                    </p>
                  </div>
                </div>
              </div>
              <p style={{ color: T3, fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>{t('pe.rateNote')}</p>
            </div>
          </div>
        )}

        {/* Historique : toutes les campagnes, avec ouvertures, acheteurs et CA */}
        <PushHistoryCard
          data={history.data}
          loading={history.loading}
          error={history.error}
          fetchedAt={history.fetchedAt}
          filter={historyFilter}
          onFilter={setHistoryFilter}
          page={historyPage}
          onPage={setHistoryPage}
          pageSize={HISTORY_PAGE_SIZE}
          onChanged={() => { reloadHistory(); reloadCredits(); }}
        />
        </>)}
      </div>

      {/* Confirmation d'envoi */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ownerPush.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {scheduledAt
                ? t('ownerPush.confirmBodyScheduled')
                    .replace('{count}', String(reach ?? 0))
                    .replace('{date}', scheduledAt ? new Date(scheduledAt).toLocaleString(language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
                : t('ownerPush.confirmBody').replace('{count}', String(reach ?? 0))}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t('ownerPush.cancel')}
            </Button>
            <Button onClick={handleSend} disabled={sending}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              {t('ownerPush.confirmCta')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
