import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Send, Loader2, Eye, ChevronLeft, ChevronRight,
  Sparkles, Users, Crown, UserCheck, UserX, Zap, TrendingUp, Calendar,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  buildPreviewHtml, newBlock, DEFAULT_THEME,
  type EmailBlock, type EmailTheme, type SocialLinks,
} from '@/lib/emailCampaign';
import EmailEditor from '@/components/email-editor/EmailEditor';
import { getTemplatePresets, type EmailType, type TemplatePreset } from '@/components/email-editor/templates';

export type SenderScope =
  | { kind: 'venue'; venueId: string; name: string; logoUrl?: string | null; city?: string | null }
  | { kind: 'organizer'; organizerId: string; name: string; logoUrl?: string | null; city?: string | null };

interface Props {
  scope: SenderScope;
  basePath: string;
}

const PROMO_SEGMENTS = [
  { value: 'all_subscribers', labelKey: 'em.seg.all_subscribers', icon: Users },
  { value: 'event_subscribers', labelKey: 'em.seg.event_subscribers', icon: Calendar },
  { value: 'vip', labelKey: 'em.seg.vip', icon: Crown },
  { value: 'big_spenders', labelKey: 'em.seg.big_spenders', icon: TrendingUp },
  { value: 'regulars', labelKey: 'em.seg.regulars', icon: UserCheck },
  { value: 'new_customers', labelKey: 'em.seg.new_customers', icon: Zap },
  { value: 'dormant', labelKey: 'em.seg.dormant', icon: UserX },
];

const INFO_SEGMENTS = [
  { value: 'event_buyers', labelKey: 'em.seg.event_buyers' },
  { value: 'event_table_buyers', labelKey: 'em.seg.event_table_buyers' },
  { value: 'event_all_buyers', labelKey: 'em.seg.event_all_buyers' },
];

export default function CampaignBuilder({ scope, basePath }: Props) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const params = useParams<{ id: string }>();
  const isNew = !params.id || params.id === 'new';
  const CAMPAIGN_VARIABLES = [
    { key: 'prenom', label: t('em.var.firstName') },
    { key: 'nom', label: t('em.var.lastName') },
  ];
  const TEMPLATE_PRESETS = getTemplatePresets(t);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState('');
  const [type, setType] = useState<EmailType>('informational');
  const [subject, setSubject] = useState('');
  const [preheader, setPreheader] = useState('');
  const [audienceType, setAudienceType] = useState<string>('event_buyers');
  const [eventId, setEventId] = useState<string>('');
  const [blocks, setBlocks] = useState<EmailBlock[]>([]);
  const [theme, setTheme] = useState<Required<EmailTheme>>({ ...DEFAULT_THEME });
  const [socialLinks, setSocialLinks] = useState<SocialLinks>({});
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const [events, setEvents] = useState<Array<{ id: string; title: string; start_at: string }>>([]);
  const [recipientCount, setRecipientCount] = useState(0);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState<string>('');

  const folder = scope.kind === 'venue' ? `venue/${scope.venueId}` : `org/${scope.organizerId}`;

  // Load events
  useEffect(() => {
    let q = supabase.from('events').select('id,title,start_at').order('start_at', { ascending: false }).limit(80);
    if (scope.kind === 'venue') {
      q = q.or(`venue_id.eq.${scope.venueId},partner_venue_id.eq.${scope.venueId}`);
    } else {
      q = q.or(`organizer_user_id.eq.${scope.organizerId},partner_organizer_id.eq.${scope.organizerId}`);
    }
    q.then(({ data }) => setEvents(data || []));
  }, [scope]);

  // Load existing campaign
  useEffect(() => {
    if (isNew || !params.id) return;
    supabase.from('email_campaigns').select('*').eq('id', params.id).maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setName(data.name);
        setType(data.type as EmailType);
        setSubject(data.subject);
        setPreheader(data.preheader || '');
        setAudienceType(data.audience_type || 'event_buyers');
        setEventId(data.event_id || '');
        setBlocks((data.blocks_json as any) || []);
        setTheme({ ...DEFAULT_THEME, ...((data as any).theme_json || {}) });
        setSocialLinks(((data as any).social_links_json || {}) as SocialLinks);
        setLogoUrl((data as any).logo_url || null);
        setCampaignId(data.id);
      });
  }, [params.id, isNew]);

  // Init defaults
  useEffect(() => {
    if (isNew && blocks.length === 0) {
      setBlocks([
        newBlock('header', { venue_name: scope.name, logo_url: scope.logoUrl || '' }),
        newBlock('text'),
      ]);
      setLogoUrl(scope.logoUrl || null);
      setAudienceType(type === 'informational' ? 'event_buyers' : 'all_subscribers');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, scope.name]);

  useEffect(() => {
    if (type === 'informational' && !INFO_SEGMENTS.some(s => s.value === audienceType)) {
      setAudienceType('event_buyers');
    } else if (type === 'promotional' && !PROMO_SEGMENTS.some(s => s.value === audienceType)) {
      setAudienceType('all_subscribers');
    }
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recipient count
  useEffect(() => {
    if (!audienceType) return;
    const needsEvent = type === 'informational' || audienceType === 'event_subscribers';
    if (needsEvent && !eventId) { setRecipientCount(0); return; }

    const rpcName = scope.kind === 'venue' ? 'count_campaign_recipients' : 'count_campaign_recipients_org';
    const args: any = scope.kind === 'venue'
      ? { p_venue_id: scope.venueId, p_type: type, p_audience_type: audienceType, p_event_id: eventId || null }
      : { p_organizer_user_id: scope.organizerId, p_type: type, p_audience_type: audienceType, p_event_id: eventId || null };
    supabase.rpc(rpcName as any, args).then(({ data }) => setRecipientCount((data as number) || 0));
  }, [scope, type, audienceType, eventId]);

  // Auto-inject the campaign-level logo into header blocks (for live preview)
  const blocksWithLogo = useMemo(() => blocks.map(b => {
    if (b.type === 'header' && !((b as any).logo_url) && logoUrl) {
      return { ...b, logo_url: logoUrl };
    }
    return b;
  }), [blocks, logoUrl]);

  const previewHtml = useMemo(() => buildPreviewHtml({
    blocks: blocksWithLogo, preheader, emailType: type,
    venueName: scope.name, city: scope.city,
    theme, socialLinks, flush: true,
  }), [blocksWithLogo, preheader, type, scope, theme, socialLinks]);

  const save = async (status?: string): Promise<string | null> => {
    setSaving(true);
    try {
      const payload: any = {
        name: name || t('em.toast.untitled'), type, subject: subject || t('em.toast.noSubject'),
        preheader, blocks_json: blocks, audience_type: audienceType,
        event_id: eventId || null,
        theme_json: theme,
        social_links_json: socialLinks,
        logo_url: logoUrl,
      };
      if (scope.kind === 'venue') payload.venue_id = scope.venueId;
      else payload.organizer_user_id = scope.organizerId;
      if (status) payload.status = status;
      if (status === 'scheduled' && scheduledAt) payload.scheduled_at = new Date(scheduledAt).toISOString();

      if (campaignId) {
        const { error } = await supabase.from('email_campaigns').update(payload).eq('id', campaignId);
        if (error) throw error;
        return campaignId;
      } else {
        const { data, error } = await supabase.from('email_campaigns').insert(payload).select('id').single();
        if (error) throw error;
        setCampaignId(data.id);
        return data.id;
      }
    } catch (e: any) {
      toast.error(e.message || t('em.toast.saveError'));
      return null;
    } finally { setSaving(false); }
  };

  const sendTest = async () => {
    const id = await save();
    if (!id) return;
    setSending(true);
    try {
      const { error } = await supabase.functions.invoke('send-campaign', { body: { campaign_id: id, send_test: true } });
      if (error) throw error;
      toast.success(t('em.toast.testSent'));
    } catch (e: any) {
      toast.error(e.message || t('em.toast.sendError'));
    } finally { setSending(false); }
  };

  const sendNow = async () => {
    const id = await save('sending');
    if (!id) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-campaign', { body: { campaign_id: id } });
      if (error) throw error;
      const sent = (data as any)?.sent ?? recipientCount;
      const failed = (data as any)?.failed ?? 0;
      toast.success(`${t('em.toast.sentPrefix')} ${sent} ${t('em.toast.emailsWord')}${failed ? ` · ${failed} ${t('em.toast.failuresWord')}` : ''}`);
      navigate(basePath);
    } catch (e: any) {
      toast.error(e.message || t('em.toast.sendError'));
      await supabase.from('email_campaigns').update({ status: 'failed', error_message: e.message }).eq('id', id);
    } finally { setSending(false); setConfirmOpen(false); }
  };

  const schedule = async () => {
    if (!scheduledAt) { toast.error(t('em.toast.pickDateTime')); return; }
    const id = await save('scheduled');
    if (id) { toast.success(t('em.toast.scheduled')); navigate(basePath); }
  };

  const applyTemplate = (tpl: TemplatePreset) => {
    setType(tpl.type);
    if (!subject) setSubject(tpl.subject);
    setBlocks(tpl.blocks({ name: scope.name, logoUrl: logoUrl || scope.logoUrl }));
    toast.success(`${t('em.toast.tplAppliedPre')}« ${tpl.name} »${t('em.toast.tplAppliedPost')}`);
  };

  const needsEvent = type === 'informational' || audienceType === 'event_subscribers';
  const audienceValid = !needsEvent || !!eventId;
  const canGoStep2 = audienceValid;
  const canGoStep3 = blocks.length > 0;
  const canSend = recipientCount > 0 && subject.trim().length > 0 && blocks.length > 0;

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => navigate(basePath)}><ArrowLeft className="w-5 h-5" /></Button>
            <div className="min-w-0">
              <h1 className="text-xl font-bold truncate">{isNew ? t('em.builder.newTitle') : t('em.builder.editTitle')}</h1>
              <p className="text-xs text-muted-foreground">{t('em.builder.step')} {step}/3 — {step === 1 ? t('em.builder.stepAudience') : step === 2 ? t('em.builder.stepDesign') : t('em.builder.stepReview')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => save()} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{t('em.builder.draft')}
            </Button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2">
          {[1, 2, 3].map(n => (
            <div key={n} className={`h-1.5 rounded-full ${step >= n ? 'bg-primary' : 'bg-muted'}`} />
          ))}
        </div>

        {/* ───────────── STEP 1 — AUDIENCE ───────────── */}
        {step === 1 && (
          <div className="grid lg:grid-cols-2 gap-4">
            <Card><CardContent className="p-4 space-y-4">
              <div>
                <Label>{t('em.builder.emailType')}</Label>
                <Tabs value={type} onValueChange={(v) => setType(v as EmailType)} className="mt-2">
                  <TabsList className="w-full grid grid-cols-2">
                    <TabsTrigger value="informational">{t('em.builder.info')}</TabsTrigger>
                    <TabsTrigger value="promotional">{t('em.builder.marketing')}</TabsTrigger>
                  </TabsList>
                </Tabs>
                <p className="text-xs text-muted-foreground mt-2">
                  {type === 'informational'
                    ? t('em.builder.infoHelp')
                    : t('em.builder.marketingHelp')}
                </p>
              </div>

              {type === 'informational' ? (
                <>
                  <div>
                    <Label>{t('em.builder.eventConcerned')}</Label>
                    <Select value={eventId} onValueChange={setEventId}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder={t('em.builder.chooseEvent')} /></SelectTrigger>
                      <SelectContent>{events.map(e => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.title} — {new Date(e.start_at).toLocaleDateString()}
                        </SelectItem>
                      ))}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{t('em.builder.audience')}</Label>
                    <Select value={audienceType} onValueChange={setAudienceType}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {INFO_SEGMENTS.map(s => <SelectItem key={s.value} value={s.value}>{t(s.labelKey)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <Label>{t('em.builder.clientSegment')}</Label>
                    <Select value={audienceType} onValueChange={setAudienceType}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PROMO_SEGMENTS.map(s => <SelectItem key={s.value} value={s.value}>{t(s.labelKey)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {audienceType === 'event_subscribers' && (
                    <div>
                      <Label>{t('em.builder.event')}</Label>
                      <Select value={eventId} onValueChange={setEventId}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder={t('em.builder.chooseEvent')} /></SelectTrigger>
                        <SelectContent>{events.map(e => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.title} — {new Date(e.start_at).toLocaleDateString()}
                          </SelectItem>
                        ))}</SelectContent>
                      </Select>
                    </div>
                  )}
                </>
              )}

              <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
                <div>
                  <div className="text-sm text-muted-foreground">{t('em.builder.estRecipients')}</div>
                  <div className="text-2xl font-bold">{recipientCount}</div>
                </div>
                <Users className="w-8 h-8 text-muted-foreground" />
              </div>
            </CardContent></Card>

            <Card><CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium"><Sparkles className="w-4 h-4 text-primary" /> {t('em.builder.startFromTemplate')}</div>
              <div className="grid gap-2">
                {TEMPLATE_PRESETS.filter(tpl => tpl.type === type).map(tpl => (
                  <button key={tpl.id} onClick={() => applyTemplate(tpl)}
                    className="text-left p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
                    <div className="font-medium text-sm">{tpl.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{tpl.subject}</div>
                  </button>
                ))}
              </div>
            </CardContent></Card>
          </div>
        )}

        {/* ───────────── STEP 2 — DESIGN & CONTENT ───────────── */}
        {step === 2 && (
          <EmailEditor
            blocks={blocks}
            onBlocksChange={setBlocks}
            theme={theme}
            onThemeChange={setTheme}
            socialLinks={socialLinks}
            onSocialLinksChange={setSocialLinks}
            logoUrl={logoUrl}
            onLogoUrlChange={setLogoUrl}
            subject={subject}
            onSubjectChange={setSubject}
            preheader={preheader}
            onPreheaderChange={setPreheader}
            name={name}
            onNameChange={setName}
            variables={CAMPAIGN_VARIABLES}
            bucketFolder={folder}
            events={events}
            preview={{ venueName: scope.name, city: scope.city, emailType: type }}
            onSendTest={sendTest}
            sending={sending}
          />
        )}

        {/* ───────────── STEP 3 — REVIEW & SEND ───────────── */}
        {step === 3 && (
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="space-y-4">
              <Card><CardContent className="p-4 space-y-3">
                <h3 className="font-semibold">{t('em.builder.summary')}</h3>
                <Row k={t('em.builder.kType')} v={type === 'informational' ? t('em.builder.info') : t('em.builder.marketing')} />
                <Row k={t('em.builder.kAudience')} v={
                  type === 'informational'
                    ? (INFO_SEGMENTS.find(s => s.value === audienceType) ? t(INFO_SEGMENTS.find(s => s.value === audienceType)!.labelKey) : audienceType)
                    : (PROMO_SEGMENTS.find(s => s.value === audienceType) ? t(PROMO_SEGMENTS.find(s => s.value === audienceType)!.labelKey) : audienceType)
                } />
                {(type === 'informational' || audienceType === 'event_subscribers') && (
                  <Row k={t('em.builder.kEvent')} v={events.find(e => e.id === eventId)?.title || '—'} />
                )}
                <Row k={t('em.builder.kRecipients')} v={String(recipientCount)} highlight />
                <Row k={t('em.builder.kSubject')} v={subject || '—'} />
                <Row k={t('em.builder.kSender')} v={`${scope.name} <…@yunoapp.eu>`} />
                {type === 'promotional' && (
                  <p className="text-xs text-muted-foreground bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2">
                    {t('em.builder.gdprSend')}
                  </p>
                )}
              </CardContent></Card>

              <Card><CardContent className="p-4 space-y-3">
                <Label>{t('em.builder.scheduling')}</Label>
                <Input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
                <p className="text-xs text-muted-foreground">{t('em.builder.schedulingHelp')}</p>
              </CardContent></Card>

              <Card><CardContent className="p-4 space-y-2">
                <Button variant="outline" onClick={sendTest} disabled={sending || saving} className="w-full">
                  {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}
                  {t('em.builder.sendTestMine')}
                </Button>
                {scheduledAt ? (
                  <Button onClick={schedule} disabled={!canSend} className="w-full">{t('em.builder.scheduleSend')}</Button>
                ) : (
                  <Button onClick={() => setConfirmOpen(true)} disabled={!canSend} className="w-full">
                    <Send className="w-4 h-4 mr-2" /> {t('em.builder.sendNow')}
                  </Button>
                )}
                {!canSend && (
                  <p className="text-xs text-destructive">
                    {recipientCount === 0
                      ? t('em.builder.warnNoRecipients')
                      : !subject.trim() ? t('em.builder.warnNoSubject') : t('em.builder.warnNoContent')}
                  </p>
                )}
              </CardContent></Card>
            </div>

            <div>
              <Label className="mb-2 block">{t('em.builder.finalPreview')}</Label>
              <div className="border rounded-lg overflow-hidden bg-muted/30 p-4 flex justify-center">
                <iframe srcDoc={previewHtml} className="bg-white rounded w-full"
                  style={{ height: 720, maxWidth: 600 }} title="preview" />
              </div>
            </div>
          </div>
        )}

        {/* Footer nav */}
        <div className="mt-6 flex justify-between">
          <Button variant="outline" onClick={() => setStep(s => (s > 1 ? ((s - 1) as any) : s))} disabled={step === 1}>
            <ChevronLeft className="w-4 h-4 mr-1" /> {t('em.builder.prev')}
          </Button>
          {step < 3 ? (
            <Button
              onClick={() => setStep(s => ((s + 1) as any))}
              disabled={(step === 1 && !canGoStep2) || (step === 2 && !canGoStep3)}>
              {t('em.builder.next')} <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : <span />}
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('em.builder.confirmTitle')}</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <p><strong>{t('em.builder.confirmType')}</strong> {type === 'promotional' ? t('em.builder.marketing') : t('em.builder.info')}</p>
            <p><strong>{t('em.builder.confirmRecipients')}</strong> {recipientCount}</p>
            <p><strong>{t('em.builder.confirmSubject')}</strong> {subject}</p>
            <p className="text-muted-foreground">{t('em.builder.confirmIrreversible')}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>{t('em.common.cancel')}</Button>
            <Button onClick={sendNow} disabled={sending}>
              {sending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{t('em.common.send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between text-sm border-b border-border last:border-0 py-1.5 gap-2">
      <span className="text-muted-foreground shrink-0">{k}</span>
      <span className={highlight ? 'font-bold text-primary text-right' : 'font-medium text-right break-all'}>{v}</span>
    </div>
  );
}
