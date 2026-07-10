import { useState, useEffect, useMemo } from 'react';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { Bell, Send, Loader2, Clock, Users, Zap, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  PUSH_TEMPLATES, PUSH_AUTOMATIONS, renderPushTemplate,
  type PushTemplate, type PushAutomation,
} from '@/lib/pushTemplates';
import { eventPath } from '@/lib/eventUrl';
import AIContentGenerator from '@/components/campaigns/AIContentGenerator';

// ─── Yuno Design Tokens (pro dashboard) ──────────────────────────────────────
const RED        = '#E8192C';
const POS        = '#34D399';
const T1         = 'rgba(255,255,255,0.96)';
const T2         = 'rgba(255,255,255,0.58)';
const T3         = 'rgba(255,255,255,0.36)';
const C_FAINT    = 'rgba(255,255,255,0.06)';
const BORDER     = 'rgba(255,255,255,0.085)';
const F_BORDER   = 'rgba(255,255,255,0.055)';
const INNER_BG   = 'rgba(255,255,255,0.032)';
const TILE_BG    = 'rgba(255,255,255,0.025)';
const CARD_BG    = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

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

type Campaign = {
  id: string;
  title: string;
  body: string;
  segment: string;
  sent_count: number;
  failed_count?: number;
  targeted_count?: number;
  template_key?: string | null;
  source?: string | null;
  created_at: string;
};

const RFM_SEGMENTS = ['champions', 'loyal', 'promising', 'new', 'at_risk', 'dormant', 'lost'] as const;
const RFM_LABEL_KEYS: Record<string, string> = {
  champions: 'seg.champions', loyal: 'seg.loyal', promising: 'seg.promising',
  new: 'seg.new', at_risk: 'seg.atRisk', dormant: 'seg.dormant', lost: 'seg.lost',
};

export default function OwnerPush() {
  const { t } = useLanguage();
  const { venueId, venue, loading: venueLoading } = useVenueContext();

  const [template, setTemplate] = useState<PushTemplate | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('/');
  const [manuallyEdited, setManuallyEdited] = useState(false);
  const [offer, setOffer] = useState('');
  const [count, setCount] = useState('');
  const [events, setEvents] = useState<VenueEvent[]>([]);
  const [eventId, setEventId] = useState<string>('');
  const [audience, setAudience] = useState<string>('followers');
  const [rfmSegment, setRfmSegment] = useState<string>('champions');
  const [reach, setReach] = useState<number | null>(null);
  const [reachLoading, setReachLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [clicks, setClicks] = useState<Record<string, number>>({});
  const [historyLoading, setHistoryLoading] = useState(true);
  const [automations, setAutomations] = useState<Record<string, boolean>>({});
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  const scope = audience === 'rfm' ? `rfm:${rfmSegment}` : audience;
  const needsEvent = audience === 'event_tickets' || audience === 'checked_in';
  const selectedEvent = events.find((e) => e.id === eventId);

  // Soirées du club (ce soir + à venir) pour le ciblage et les variables.
  useEffect(() => {
    if (!venueId) return;
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    supabase
      .from('events')
      .select('id, title, start_at, slug')
      .eq('venue_id', venueId)
      .gte('start_at', twelveHoursAgo)
      .order('start_at', { ascending: true })
      .limit(20)
      .then(({ data }) => {
        const rows = (data || []) as VenueEvent[];
        setEvents(rows);
        if (rows.length > 0) setEventId((prev) => prev || rows[0].id);
      });
  }, [venueId]);

  const fetchHistory = async () => {
    if (!venueId) return;
    const { data } = await supabase
      .from('push_campaigns' as never)
      .select('*')
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false })
      .limit(20);
    const rows = ((data as unknown) as Campaign[]) || [];
    setCampaigns(rows);
    setHistoryLoading(false);
    if (rows.length > 0) {
      const { data: eventsData } = await supabase
        .from('push_campaign_events' as never)
        .select('campaign_id')
        .eq('event_type', 'clicked')
        .in('campaign_id', rows.map((r) => r.id));
      const counts: Record<string, number> = {};
      (((eventsData as unknown) as Array<{ campaign_id: string }>) || []).forEach((e) => {
        counts[e.campaign_id] = (counts[e.campaign_id] || 0) + 1;
      });
      setClicks(counts);
    }
  };

  useEffect(() => { fetchHistory(); }, [venueId]); // eslint-disable-line react-hooks/exhaustive-deps

  // État des automatisations du club (toggles opt-in, désactivés par défaut).
  useEffect(() => {
    if (!venueId) return;
    supabase
      .from('venue_push_automations' as never)
      .select('automation_key, enabled')
      .eq('venue_id', venueId)
      .then(({ data }) => {
        const map: Record<string, boolean> = {};
        (((data as unknown) as Array<{ automation_key: string; enabled: boolean }>) || [])
          .forEach((r) => { map[r.automation_key] = r.enabled; });
        setAutomations(map);
      });
  }, [venueId]);

  const toggleAutomation = async (key: string) => {
    if (!venueId || togglingKey) return;
    setTogglingKey(key);
    const next = !automations[key];
    // Optimiste : la carte réagit tout de suite, on revient en arrière si erreur.
    setAutomations((p) => ({ ...p, [key]: next }));
    try {
      const { error } = await supabase
        .from('venue_push_automations' as never)
        .upsert(
          { venue_id: venueId, automation_key: key, enabled: next, updated_at: new Date().toISOString() } as never,
          { onConflict: 'venue_id,automation_key' },
        );
      if (error) throw error;
      toast.success(next ? t('ownerPush.autoEnabled') : t('ownerPush.autoDisabled'));
    } catch {
      setAutomations((p) => ({ ...p, [key]: !next }));
      toast.error(t('ownerPush.autoError'));
    } finally {
      setTogglingKey(null);
    }
  };

  // Valeurs d'aperçu pour les cartes d'automatisation (soirée à venir la plus proche).
  const autoPreviewValues = useMemo(() => ({
    venue: venue?.name || '',
    event: events[0]?.title || t('ownerPush.autoSampleEvent'),
  }), [venue?.name, events, t]);

  // Interpolation live du template tant que l'owner n'a pas édité à la main.
  const templateValues = useMemo(() => ({
    venue: venue?.name || '',
    event: selectedEvent?.title || '',
    offer,
    count,
  }), [venue?.name, selectedEvent?.title, offer, count]);

  useEffect(() => {
    if (!template || manuallyEdited) return;
    setTitle(renderPushTemplate(t(template.titleKey), templateValues));
    setBody(renderPushTemplate(t(template.bodyKey), templateValues));
  }, [template, templateValues, manuallyEdited, t]);

  const pickTemplate = (tpl: PushTemplate) => {
    setTemplate(tpl);
    setManuallyEdited(false);
    setAudience(tpl.suggestedAudience);
    setOffer('');
    setCount('');
  };

  // URL par défaut : la soirée sélectionnée, sinon la page du club.
  useEffect(() => {
    if (selectedEvent) {
      setUrl(eventPath({ id: selectedEvent.id, slug: selectedEvent.slug, isOrganizerLed: false, venueSlug: venueId || undefined }));
    } else if (venueId) {
      setUrl(`/club/${venueId}`);
    }
  }, [selectedEvent, venueId]);

  // Portée estimée (dry_run débouncé).
  useEffect(() => {
    if (!venueId) return;
    if (needsEvent && !eventId) { setReach(0); return; }
    setReachLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { data } = await supabase.functions.invoke('send-push-campaign', {
          body: {
            title: '·', body: '·', dry_run: true,
            venue_id: venueId, scope,
            ...(needsEvent ? { event_id: eventId } : {}),
          },
        });
        setReach(typeof data?.targeted === 'number' ? data.targeted : null);
      } catch {
        setReach(null);
      } finally {
        setReachLoading(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [venueId, scope, eventId, needsEvent]);

  const handleSend = async () => {
    if (!venueId || !title.trim() || !body.trim()) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-push-campaign', {
        body: {
          title: title.trim(), body: body.trim(), url: url.trim() || '/',
          venue_id: venueId, scope,
          ...(needsEvent ? { event_id: eventId } : {}),
          template_key: template?.key || 'custom',
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
              toast.error(t('ownerPush.rateLimited'));
              return;
            }
            if (bodyJson?.error) msg = bodyJson.error;
          }
        } catch { /* garder msg */ }
        throw new Error(msg);
      }
      toast.success(t('ownerPush.sentToast').replace('{count}', String(data?.sent || 0)));
      setConfirmOpen(false);
      setTemplate(null);
      setTitle(''); setBody(''); setManuallyEdited(false);
      fetchHistory();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('ownerPush.sendError'));
    } finally {
      setSending(false);
    }
  };

  if (venueLoading || !venueId) return <OwnerPageSkeleton />;

  const audienceOptions = [
    { value: 'event_tickets', label: t('ownerPush.audEventTickets') },
    { value: 'checked_in', label: t('ownerPush.audCheckedIn') },
    { value: 'followers', label: t('ownerPush.audFollowers') },
    { value: 'rfm', label: t('ownerPush.audRfm') },
    { value: 'all_customers', label: t('ownerPush.audAllCustomers') },
  ];

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">

        {/* Header */}
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
            <p style={{ color: T3, fontSize: 12.5, marginTop: 3 }}>{t('ownerPush.subtitle')}</p>
          </div>
        </div>

        {/* ─── Notifications AUTOMATIQUES ──────────────────────────────── */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22 }}>
          <div className="flex items-start gap-2.5 mb-1">
            <Zap className="h-4 w-4 mt-0.5 flex-none" style={{ color: RED }} />
            <div>
              <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
                {t('ownerPush.autoSectionTitle')}
              </h3>
              <p style={{ color: T3, fontSize: 12.5, marginTop: 3, lineHeight: 1.5 }}>{t('ownerPush.autoSectionSubtitle')}</p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3 mt-4">
            {PUSH_AUTOMATIONS.map((auto: PushAutomation) => {
              const on = !!automations[auto.key];
              const previewTitle = renderPushTemplate(t(auto.titleKey), autoPreviewValues);
              const previewBody = renderPushTemplate(t(auto.bodyKey), autoPreviewValues);
              return (
                <div
                  key={auto.key}
                  className="p-4 rounded-xl transition-all duration-150"
                  style={{
                    background: on ? 'rgba(232,25,44,0.07)' : TILE_BG,
                    border: `1px solid ${on ? 'rgba(232,25,44,0.28)' : F_BORDER}`,
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span style={{ fontSize: 20, lineHeight: 1 }}>{auto.emoji}</span>
                      <div className="min-w-0">
                        <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{t(`ownerPush.autoName.${auto.key}`)}</p>
                        <p style={{ color: T3, fontSize: 11.5, marginTop: 2, lineHeight: 1.45 }}>{t(`ownerPush.autoWhen.${auto.key}`)}</p>
                      </div>
                    </div>
                    <Switch checked={on} onCheckedChange={() => toggleAutomation(auto.key)} disabled={togglingKey === auto.key} />
                  </div>

                  {/* Aperçu du message envoyé automatiquement */}
                  <div className="rounded-lg p-2.5 mt-3" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                    <p className="truncate" style={{ color: T2, fontSize: 11.5, fontWeight: 600 }}>{previewTitle}</p>
                    <p style={{ color: T3, fontSize: 11, lineHeight: 1.4, marginTop: 2 }}>{previewBody}</p>
                  </div>

                  <div className="flex items-center gap-1.5 mt-2.5">
                    <Users className="h-3 w-3" style={{ color: T3 }} />
                    <span style={{ color: T3, fontSize: 10.5 }}>{t(auto.audienceKey)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <p style={{ color: T3, fontSize: 11, marginTop: 14, lineHeight: 1.5 }}>{t('ownerPush.autoFootnote')}</p>
        </div>

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
            {PUSH_TEMPLATES.map((tpl) => (
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
                <AIContentGenerator
                  channel="push"
                  eventId={eventId || null}
                  segment={scope}
                  onApply={(c) => { setTitle(c.title); setBody(c.body); setManuallyEdited(true); }}
                />
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
                  onChange={(e) => { setTitle(e.target.value); setManuallyEdited(true); }}
                  maxLength={80}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t('ownerPush.bodyLabel')}</label>
                <textarea
                  value={body}
                  onChange={(e) => { setBody(e.target.value); setManuallyEdited(true); }}
                  maxLength={200}
                  rows={3}
                  style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }}
                />
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

              {/* Portée + envoi */}
              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="flex items-center gap-2 tabular-nums" style={{ color: T2, fontSize: 12.5 }}>
                  {reachLoading
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: T3 }} />
                    : <Users className="h-3.5 w-3.5" style={{ color: (reach ?? 0) > 0 ? POS : T3 }} />}
                  {t('ownerPush.reach').replace('{count}', String(reach ?? '…'))}
                </span>
                <button
                  onClick={() => setConfirmOpen(true)}
                  disabled={sending || !title.trim() || !body.trim() || (needsEvent && !eventId) || (reach ?? 0) === 0}
                  className="inline-flex items-center justify-center gap-2 rounded-xl text-[13px] font-semibold transition-all duration-150"
                  style={{
                    background: RED, color: '#fff', padding: '11px 18px',
                    boxShadow: `0 0 18px -6px ${RED}88`,
                    opacity: (sending || !title.trim() || !body.trim() || (needsEvent && !eventId) || (reach ?? 0) === 0) ? 0.5 : 1,
                  }}
                >
                  <Send className="h-4 w-4" />
                  {t('ownerPush.sendCta')}
                </button>
              </div>
            </div>

            {/* Aperçu notification iOS */}
            <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22 }}>
              <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 16 }}>
                {t('ownerPush.preview')}
              </h3>
              <div
                className="rounded-2xl p-3.5"
                style={{ background: 'rgba(30,30,32,0.92)', border: '1px solid rgba(255,255,255,0.10)', backdropFilter: 'blur(20px)' }}
              >
                <div className="flex items-start gap-2.5">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-[9px] flex-none"
                    style={{ background: '#050505', border: '1px solid rgba(255,255,255,0.12)' }}
                  >
                    <span style={{ color: RED, fontWeight: 800, fontSize: 13 }}>Y</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate" style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>
                        {title || t('ownerPush.previewTitleFallback')}
                      </p>
                      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{t('ownerPush.previewNow')}</span>
                    </div>
                    <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12.5, lineHeight: 1.45, marginTop: 2 }}>
                      {body || t('ownerPush.previewBodyFallback')}
                    </p>
                  </div>
                </div>
              </div>
              <p style={{ color: T3, fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>{t('ownerPush.rateNote')}</p>
            </div>
          </div>
        )}

        {/* Historique */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22 }}>
          <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 18 }}>
            {t('ownerPush.history')}
          </h3>
          {historyLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="text-center py-10 px-4">
              <Bell className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
              <p className="text-xs" style={{ color: T3 }}>{t('ownerPush.noCampaigns')}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {campaigns.map((c) => (
                <div
                  key={c.id}
                  className="flex items-start justify-between gap-3 p-3 rounded-xl"
                  style={{ background: TILE_BG, border: `1px solid ${F_BORDER}` }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-[560] truncate" style={{ color: T1, fontSize: 13 }}>{c.title}</p>
                    <p className="truncate" style={{ color: T3, fontSize: 12, marginTop: 2 }}>{c.body}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {c.source === 'auto' && (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
                          style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.25)', color: RED, fontSize: 10, fontWeight: 600 }}
                        >
                          <Zap className="h-2.5 w-2.5" />
                          {t('ownerPush.autoBadge')}
                        </span>
                      )}
                      {c.template_key && c.template_key !== 'custom' && (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full"
                          style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2, fontSize: 10, fontWeight: 600 }}
                        >
                          {t(`ownerPush.tplName.${c.template_key}`)}
                        </span>
                      )}
                      <span className="flex items-center gap-1 tabular-nums" style={{ color: T3, fontSize: 10 }}>
                        <Clock className="h-3 w-3" />
                        {new Date(c.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span
                      className="inline-flex items-center px-2.5 py-1 rounded-full tabular-nums"
                      style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: POS, fontSize: 11, fontWeight: 600 }}
                    >
                      {t('ownerPush.sent').replace('{count}', String(c.sent_count))}
                    </span>
                    <span className="tabular-nums" style={{ color: T3, fontSize: 10 }}>
                      {t('ownerPush.clicked').replace('{count}', String(clicks[c.id] || 0))}
                      {c.sent_count > 0 && <> · CTR {Math.round(((clicks[c.id] || 0) / c.sent_count) * 100)}%</>}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation d'envoi */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ownerPush.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('ownerPush.confirmBody').replace('{count}', String(reach ?? 0))}
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
