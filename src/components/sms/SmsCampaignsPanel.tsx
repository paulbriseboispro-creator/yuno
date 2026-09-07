// Espace « Campagnes SMS » — une seule implémentation pour le club et pour
// l'organisateur (la portée est injectée). Solde et achat de crédits, vue
// d'ensemble de la base de contacts consentants, liste des campagnes, éditeur
// et rapport. Tant que SMS_MARKETING_LIVE est à false, tout se prépare mais
// rien ne part : bannière « Bientôt disponible » + boutons verrouillés.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CalendarDays, Crown, Loader2, MessageSquare, Plus, Sparkles, Trash2, UserMinus, UserPlus, Users, Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, type Locale } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ComingSoonBanner } from '@/components/ComingSoonBanner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { isPreviewActive } from '@/contexts/PreviewModeContext';
import { cn } from '@/lib/utils';
import { SMS_MARKETING_LIVE, type SmsScope } from '@/lib/smsMarketing';
import SmsCampaignEditor from './SmsCampaignEditor';
import SmsCampaignReport from './SmsCampaignReport';
import SmsCreditsDialog, { useSmsCreditsReturn } from './SmsCreditsDialog';
import { SmsStatusPill } from './SmsStatusPill';
import {
  SMS_CAMPAIGN_COLUMNS, fetchScopeEvents, fetchSmsBalance, scopeFilter, scopeRpcArgs,
  type EventLite, type SmsCampaignRow,
} from './smsApi';

const DATE_LOCALES: Record<string, Locale> = { fr, en: enUS, es };

interface Overview { active: number; vip: number; last_30d: number; unsubscribed: number; events: Array<{ event_id: string; title: string; start_at: string; contacts: number }> }

interface Props {
  scope: SmsScope;
  /** Chemin de la liste ; le rapport vit sur `${basePath}/:id`. */
  basePath: string;
  /** Rapport à afficher (id de campagne dans l'URL), sinon la liste. */
  selectedId?: string | null;
  /** Soirée pré-sélectionnée à l'ouverture de l'éditeur (`?event=`). */
  presetEventId?: string | null;
}

export default function SmsCampaignsPanel({ scope, basePath, selectedId, presetEventId }: Props) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const dateLocale = DATE_LOCALES[language] ?? enUS;

  const [campaigns, setCampaigns] = useState<SmsCampaignRow[]>([]);
  const [events, setEvents] = useState<EventLite[]>([]);
  const [balance, setBalance] = useState(0);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<SmsCampaignRow | null>(null);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [creditsMissing, setCreditsMissing] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    const f = scopeFilter(scope);
    const [{ data: rows }, evs, bal, { data: ov }] = await Promise.all([
      supabase.from('sms_campaigns').select(SMS_CAMPAIGN_COLUMNS).eq(f.column, f.value).order('created_at', { ascending: false }).limit(100),
      fetchScopeEvents(scope),
      fetchSmsBalance(scope),
      supabase.rpc('get_sms_contacts_overview', scopeRpcArgs(scope)),
    ]);
    setCampaigns((rows ?? []) as unknown as SmsCampaignRow[]);
    setEvents(evs);
    setBalance(bal);
    setOverview((ov as unknown as Overview) ?? null);
    setLoading(false);
  }, [scope]);

  useEffect(() => { void load(); }, [load]);
  useSmsCreditsReturn(load);

  // Une campagne en cours d'envoi : rafraîchir la liste sans que le pro recharge.
  const anyInFlight = campaigns.some((c) => c.status === 'sending');
  useEffect(() => {
    if (!anyInFlight || selectedId) return;
    const id = setInterval(() => { void load(); }, 6000);
    return () => clearInterval(id);
  }, [anyInFlight, selectedId, load]);

  // Ouverture directe de l'éditeur depuis une page soirée.
  useEffect(() => {
    if (presetEventId && !loading) { setEditing(null); setEditorOpen(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetEventId, loading]);

  const eventTitle = useMemo(() => new Map(events.map((e) => [e.id, e.title])), [events]);

  const openBuy = (missing: number | null) => { setCreditsMissing(missing); setCreditsOpen(true); };

  const openCampaign = (c: SmsCampaignRow) => {
    if (c.status === 'draft') { setEditing(c); setEditorOpen(true); return; }
    navigate(`${basePath}/${c.id}`);
  };

  const deleteDraft = async (c: SmsCampaignRow) => {
    if (isPreviewActive()) { toast.error(t('smsc.previewReadOnly')); return; }
    setDeleting(c.id);
    const { error } = await supabase.from('sms_campaigns').delete().eq('id', c.id).eq('status', 'draft');
    setDeleting(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t('smsc.list.draftDeleted'));
    void load();
  };

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (selectedId) {
    const c = campaigns.find((x) => x.id === selectedId);
    return (
      <>
        <SmsCampaignReport
          campaignId={selectedId}
          scope={scope}
          eventTitle={c?.event_id ? eventTitle.get(c.event_id) : null}
          onBack={() => navigate(basePath)}
          onBuyCredits={(m) => openBuy(m)}
          onChanged={() => void load()}
        />
        <SmsCreditsDialog open={creditsOpen} onClose={() => setCreditsOpen(false)} scope={scope} missing={creditsMissing} onCredited={() => void load()} />
      </>
    );
  }

  const segmentLabel = (c: SmsCampaignRow) => {
    const type = c.segment_filters?.type ?? 'all';
    return t(`smsc.segmentShort.${type}`);
  };

  return (
    <div className="space-y-5">
      {!SMS_MARKETING_LIVE && (
        <ComingSoonBanner title={t('smsCampaigns.comingSoonTitle')} description={t('smsc.comingSoonDesc')} />
      )}

      {/* Solde + audience */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="relative overflow-hidden border-white/[0.06] bg-gradient-to-br from-primary/15 via-background to-background sm:col-span-2 lg:col-span-2">
          <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-primary/20 blur-2xl" />
          <CardContent className="relative flex items-center justify-between gap-3 p-4">
            <div>
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground"><Wallet className="h-3.5 w-3.5" />{t('sms.balanceAvailable')}</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-3xl font-bold tabular-nums text-foreground">{balance.toLocaleString('fr-FR')}</span>
                <span className="text-sm text-muted-foreground">SMS</span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{t('smsc.creditExplain')}</p>
            </div>
            <Button size="sm" variant="outline" className="shrink-0 gap-1.5 border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary" onClick={() => openBuy(null)}>
              <Plus className="h-3.5 w-3.5" />{t('sms.recharge')}
            </Button>
          </CardContent>
        </Card>
        {[
          { icon: <Users className="h-3.5 w-3.5 text-sky-400" />, label: t('smsc.overview.active'), value: overview?.active ?? 0 },
          { icon: <UserPlus className="h-3.5 w-3.5 text-emerald-400" />, label: t('smsc.overview.last30d'), value: overview?.last_30d ?? 0 },
          { icon: <Crown className="h-3.5 w-3.5 text-amber-400" />, label: t('smsc.overview.vip'), value: overview?.vip ?? 0 },
        ].map((k) => (
          <Card key={k.label} className="border-white/[0.06] bg-surface/40">
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">{k.icon}{k.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><UserMinus className="h-3 w-3" />{t('smsc.overview.unsubscribed').replace('{n}', String(overview?.unsubscribed ?? 0))}</span>
        <span>{t('smsc.overview.consentNote')}</span>
      </div>

      {/* Liste */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{t('smsCampaigns.title')}</h2>
        <Button size="sm" className="gap-1.5" onClick={() => { setEditing(null); setEditorOpen(true); }}>
          <Plus className="h-4 w-4" />{t('smsCampaigns.newCampaign')}
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <Card className="border-white/[0.06] bg-surface/40">
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10"><MessageSquare className="h-7 w-7 text-primary/60" /></div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{t('smsCampaigns.empty')}</p>
              <p className="max-w-sm text-xs text-muted-foreground">{t('smsc.emptyHint')}</p>
            </div>
            <Button variant="outline" size="sm" className="mt-1 gap-1.5 border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary" onClick={() => { setEditing(null); setEditorOpen(true); }}>
              <Sparkles className="h-4 w-4" />{t('smsc.list.createFirst')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {campaigns.map((c) => {
            const delivered = c.delivered_count;
            const failed = c.failed_count + c.undelivered_count;
            const ev = c.event_id ? eventTitle.get(c.event_id) : null;
            return (
              <Card key={c.id} className="cursor-pointer border-white/[0.06] bg-surface/40 transition-colors hover:border-white/[0.14]" onClick={() => openCampaign(c)}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                        <SmsStatusPill status={c.status} />
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{c.body_template}</p>
                    </div>
                    {c.status === 'draft' && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); void deleteDraft(c); }} disabled={deleting === c.id}
                        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400" title={t('smsc.list.deleteDraft')}>
                        {deleting === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" />
                      {['sent', 'sending', 'paused'].includes(c.status)
                        ? t('smsc.list.sentOf').replace('{sent}', String(c.sent_count)).replace('{total}', String(c.total_recipients || c.estimated_recipients))
                        : t('smsCampaigns.estimatedCount').replace('{n}', String(c.estimated_recipients))}
                    </span>
                    <span>{segmentLabel(c)}{ev ? ` · ${ev}` : ''}</span>
                    {c.status === 'scheduled' && c.scheduled_at && (
                      <span className="flex items-center gap-1 text-amber-300"><CalendarDays className="h-3 w-3" />{format(new Date(c.scheduled_at), 'd MMM HH:mm', { locale: dateLocale })}</span>
                    )}
                    {c.sent_at && <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{format(new Date(c.sent_at), 'd MMM yyyy', { locale: dateLocale })}</span>}
                    {['sent', 'sending', 'paused'].includes(c.status) && (
                      <span className={cn(delivered > 0 && 'text-emerald-400')}>{t('smsc.list.deliveredN').replace('{n}', String(delivered))}</span>
                    )}
                    {failed > 0 && <span className="flex items-center gap-1 text-rose-400"><AlertTriangle className="h-3 w-3" />{t('smsCampaigns.failedCount').replace('{n}', String(failed))}</span>}
                  </div>
                  {c.error_message && c.status !== 'sent' && (
                    <p className="flex items-center gap-1 text-[11px] text-amber-300/90"><AlertTriangle className="h-3 w-3" />{c.error_message}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Base par soirée */}
      {overview && overview.events.length > 0 && (
        <Card className="border-white/[0.06] bg-surface/40">
          <CardContent className="p-4">
            <p className="mb-2 text-sm font-medium text-foreground">{t('smsc.overview.byEvent')}</p>
            <ul className="divide-y divide-white/[0.04]">
              {overview.events.map((e) => (
                <li key={e.event_id} className="flex items-center justify-between gap-3 py-2 text-xs">
                  <span className="min-w-0 truncate text-foreground">{e.title} <span className="text-muted-foreground">· {format(new Date(e.start_at), 'd MMM yyyy', { locale: dateLocale })}</span></span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{t('smsc.overview.contactsN').replace('{n}', String(e.contacts))}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <SmsCampaignEditor
        open={editorOpen}
        onClose={() => { setEditorOpen(false); setEditing(null); }}
        scope={scope}
        campaign={editing}
        events={events}
        balance={balance}
        onChanged={() => void load()}
        onBuyCredits={(m) => openBuy(m)}
        presetEventId={editing ? null : presetEventId}
      />
      <SmsCreditsDialog open={creditsOpen} onClose={() => setCreditsOpen(false)} scope={scope} missing={creditsMissing} onCredited={() => void load()} />
    </div>
  );
}
