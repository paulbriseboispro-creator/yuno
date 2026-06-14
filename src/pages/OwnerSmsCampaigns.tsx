import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  MessageSquare,
  Users,
  CalendarDays,
  Crown,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Lock,
  Rocket,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Signal,
  Wifi,
  Battery,
  Mic,
  Link,
  X,
  CornerDownLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format, type Locale } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';

const MAX_SMS_CHARS = 160;

const URL_REGEX = /https?:\/\/[^\s]+|www\.[^\s]+/g;

function parseMessageSegments(text: string): Array<{ type: 'text' | 'url'; content: string }> {
  const segments: Array<{ type: 'text' | 'url'; content: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'url', content: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }
  return segments;
}

type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled';

interface SmsCampaign {
  id: string;
  name: string;
  body_template: string;
  segment_filters: { type: string; event_id?: string };
  estimated_recipients: number;
  sent_count: number;
  failed_count: number;
  status: CampaignStatus;
  sent_at: string | null;
  created_at: string;
}

interface Event {
  id: string;
  title: string;
  start_at: string;
}

const DATE_LOCALES: Record<string, Locale> = { fr, en: enUS, es };

function PhonePreview({ message, senderName }: { message: string; senderName: string }) {
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-[230px] select-none">
        {/* Silent switch */}
        <div className="absolute left-[-3px] top-[80px] h-5 w-[3px] rounded-l bg-zinc-600" />
        {/* Volume up */}
        <div className="absolute left-[-3px] top-[114px] h-9 w-[3px] rounded-l bg-zinc-600" />
        {/* Volume down */}
        <div className="absolute left-[-3px] top-[160px] h-9 w-[3px] rounded-l bg-zinc-600" />
        {/* Power button */}
        <div className="absolute right-[-3px] top-[122px] h-14 w-[3px] rounded-r bg-zinc-600" />

        {/* Phone chassis */}
        <div
          className="overflow-hidden rounded-[42px] bg-black"
          style={{ border: '2.5px solid #3a3a3c', boxShadow: '0 0 0 0.5px rgba(255,255,255,0.06), 0 24px 64px rgba(0,0,0,0.85)' }}
        >
          {/* Dynamic Island */}
          <div className="flex justify-center bg-black pt-3 pb-0.5">
            <div
              className="flex h-[28px] w-[112px] items-center justify-end rounded-full pr-2"
              style={{ background: '#0a0a0a', border: '1px solid #1c1c1e' }}
            >
              {/* Front camera dot */}
              <div className="h-[9px] w-[9px] rounded-full bg-zinc-800" />
            </div>
          </div>

          {/* Status bar */}
          <div className="flex items-center justify-between bg-black px-5 pb-1.5 pt-0.5">
            <span className="text-[11px] font-semibold text-white">{timeStr}</span>
            <div className="flex items-center gap-[5px]">
              <Signal className="h-[11px] w-[11px] text-white" />
              <Wifi className="h-[11px] w-[11px] text-white" />
              <Battery className="h-[13px] w-[13px] text-white" />
            </div>
          </div>

          {/* Hairline separator */}
          <div className="bg-zinc-800" style={{ height: '0.5px' }} />

          {/* Messages app header */}
          <div className="bg-zinc-950">
            {/* Back row */}
            <div className="flex items-center px-3 pt-2 pb-0.5">
              <div className="flex items-center" style={{ color: '#0A84FF' }}>
                <ChevronLeft className="h-[15px] w-[15px]" strokeWidth={2.5} />
              </div>
            </div>
            {/* Avatar + name */}
            <div className="flex flex-col items-center gap-[3px] pb-3">
              <div className="flex h-[46px] w-[46px] items-center justify-center rounded-full overflow-hidden bg-black">
                <img src="/yuno-icon-192.png" alt="Yuno" className="h-full w-full object-cover" />
              </div>
              <div className="flex items-center gap-[2px] mt-0.5">
                <span
                  className="max-w-[150px] truncate text-[11px] font-semibold text-white"
                >
                  {senderName}
                </span>
                <ChevronRight className="h-[10px] w-[10px] text-white/40" />
              </div>
              <span className="text-[9px] text-zinc-500">SMS</span>
            </div>
          </div>

          {/* Thread */}
          <div className="min-h-[155px] bg-black px-3 pt-3">
            <p className="mb-3 text-center text-[9px] text-zinc-500">
              Aujourd'hui {timeStr}
            </p>
            <div className="flex justify-start">
              <div
                className="max-w-[76%] px-3 py-[7px]"
                style={{ background: '#2c2c2e', borderRadius: '16px 16px 16px 4px' }}
              >
                {message ? (
                  <p className="text-[10px] leading-[1.5] text-white whitespace-pre-wrap break-words">
                    {parseMessageSegments(message).map((seg, i) =>
                      seg.type === 'url' ? (
                        <span key={i} style={{ color: '#0A84FF', textDecoration: 'underline' }}>
                          {seg.content}
                        </span>
                      ) : (
                        <span key={i}>{seg.content}</span>
                      )
                    )}
                  </p>
                ) : (
                  <span className="text-[15px] leading-none text-zinc-400 tracking-[3px]">···</span>
                )}
              </div>
            </div>
          </div>

          {/* Input bar */}
          <div className="flex items-center gap-2 bg-black px-3 py-2">
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-zinc-700">
              <Plus className="h-[13px] w-[13px] text-zinc-400" />
            </div>
            <div className="flex flex-1 items-center justify-between rounded-full border border-zinc-700 px-3 py-[5px]">
              <span className="text-[9px] text-zinc-500">Message • SMS</span>
              <Mic className="h-[11px] w-[11px] text-zinc-500" />
            </div>
          </div>

          {/* Home indicator */}
          <div className="flex justify-center bg-black pb-3 pt-0.5">
            <div className="h-[4px] w-24 rounded-full bg-zinc-700" />
          </div>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground text-center">
        {message.length}/{MAX_SMS_CHARS}
      </p>
    </div>
  );
}

export default function OwnerSmsCampaigns() {
  const { venueId, venue, loading: venueLoading } = useVenueContext();
  const { t, language } = useLanguage();

  const [campaigns, setCampaigns] = useState<SmsCampaign[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [segmentType, setSegmentType] = useState<'all' | 'event' | 'vip'>('all');
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [showPastEvents, setShowPastEvents] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const dateLocale = DATE_LOCALES[language] ?? enUS;
  const now = new Date().toISOString();

  const upcomingEvents = useMemo(() => events.filter(e => e.start_at >= now), [events, now]);
  const pastEvents = useMemo(() => events.filter(e => e.start_at < now), [events, now]);
  const visibleEvents = showPastEvents ? events : upcomingEvents;

  const STATUS_META: Record<CampaignStatus, { label: string; icon: React.ReactNode; cls: string }> = {
    draft:     { label: t('smsCampaigns.statusDraft'),     icon: <Clock className="w-3 h-3" />,                      cls: 'bg-zinc-800 text-zinc-300' },
    scheduled: { label: t('smsCampaigns.statusScheduled'), icon: <Clock className="w-3 h-3" />,                      cls: 'bg-amber-900/60 text-amber-300' },
    sending:   { label: t('smsCampaigns.statusSending'),   icon: <Loader2 className="w-3 h-3 animate-spin" />,       cls: 'bg-blue-900/60 text-blue-300' },
    sent:      { label: t('smsCampaigns.statusSent'),      icon: <CheckCircle2 className="w-3 h-3" />,               cls: 'bg-emerald-900/60 text-emerald-300' },
    failed:    { label: t('smsCampaigns.statusFailed'),    icon: <XCircle className="w-3 h-3" />,                    cls: 'bg-rose-900/60 text-rose-300' },
    cancelled: { label: t('smsCampaigns.statusCancelled'), icon: <XCircle className="w-3 h-3" />,                    cls: 'bg-zinc-800 text-zinc-400' },
  };

  const loadData = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    try {
      const [campaignsRes, eventsRes, balanceRes] = await Promise.all([
        supabase
          .from('sms_campaigns')
          .select('id, name, body_template, segment_filters, estimated_recipients, sent_count, failed_count, status, sent_at, created_at')
          .eq('venue_id', venueId)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('events')
          .select('id, title, start_at')
          .or(`venue_id.eq.${venueId},partner_venue_id.eq.${venueId}`)
          .order('start_at', { ascending: false })
          .limit(60),
        supabase
          .from('sms_credit_balances')
          .select('balance')
          .eq('venue_id', venueId)
          .maybeSingle(),
      ]);
      if (campaignsRes.data) setCampaigns(campaignsRes.data as SmsCampaign[]);
      if (eventsRes.data) setEvents(eventsRes.data);
      setBalance(balanceRes.data?.balance ?? 0);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!venueId || !dialogOpen) return;
    if (segmentType === 'event' && !selectedEventId) { setRecipientCount(null); return; }
    let cancelled = false;
    setCountLoading(true);
    (async () => {
      const { data } = await supabase.rpc('count_sms_campaign_recipients', {
        p_venue_id: venueId,
        p_segment_type: segmentType,
        p_event_id: segmentType === 'event' ? selectedEventId : null,
      });
      if (!cancelled) { setRecipientCount(data ?? 0); setCountLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [venueId, dialogOpen, segmentType, selectedEventId]);

  const isValidUrl = (url: string): boolean => {
    try {
      const u = new URL(url.startsWith('www.') ? `https://${url}` : url);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  };

  const handleInsertLink = () => {
    const url = linkUrl.trim();
    if (!url) return;
    if (!isValidUrl(url)) { setLinkError(true); return; }
    setLinkError(false);
    const ta = textareaRef.current;
    const pos = ta ? ta.selectionStart : body.length;
    const insertion = body.length > 0 && body[pos - 1] !== ' ' ? ` ${url}` : url;
    const newBody = body.slice(0, pos) + insertion + body.slice(pos);
    setBody(newBody.slice(0, MAX_SMS_CHARS));
    setLinkUrl('');
    setShowLinkInput(false);
    // restore focus + cursor after React re-render
    requestAnimationFrame(() => {
      if (ta) {
        ta.focus();
        const newPos = pos + insertion.length;
        ta.setSelectionRange(newPos, newPos);
      }
    });
  };

  const resetDialog = () => {
    setName('');
    setBody('');
    setSegmentType('all');
    setSelectedEventId('');
    setRecipientCount(null);
    setShowPastEvents(false);
    setShowLinkInput(false);
    setLinkUrl('');
    setLinkError(false);
  };

  // handleSend kept for when coming-soon is lifted
  const handleSend = async () => {
    if (!venueId || !name.trim() || !body.trim()) return;
    if (segmentType === 'event' && !selectedEventId) { toast.error(t('smsCampaigns.errorSelectEvent')); return; }
    const count = recipientCount ?? 0;
    if (count === 0) { toast.error(t('smsCampaigns.errorNoRecipients')); return; }
    if (balance < count) { toast.error(t('smsCampaigns.errorInsufficientCredits').replace('{balance}', String(balance)).replace('{count}', String(count))); return; }
    setSending(true);
    try {
      const { data: campaign, error: campaignErr } = await supabase
        .from('sms_campaigns')
        .insert({
          venue_id: venueId,
          created_by: (await supabase.auth.getUser()).data.user!.id,
          name: name.trim(),
          body_template: body.trim(),
          segment_filters: { type: segmentType, ...(segmentType === 'event' ? { event_id: selectedEventId } : {}) },
          estimated_recipients: count,
          estimated_credits: count,
          status: 'sending',
        })
        .select('id').single();
      if (campaignErr || !campaign) throw new Error(t('smsCampaigns.errorCreateCampaign'));
      const { data: result, error: sendErr } = await supabase.functions.invoke('send-sms-campaign', {
        body: { campaign_id: campaign.id, venue_id: venueId, message_body: body.trim(), segment_type: segmentType, event_id: segmentType === 'event' ? selectedEventId : null },
      });
      if (sendErr) throw new Error(sendErr.message);
      if (result?.error) throw new Error(result.message ?? result.error);
      toast.success(t('smsCampaigns.successSent').replace('{count}', String(result.sent)));
      setDialogOpen(false);
      resetDialog();
      loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('smsCampaigns.errorSend'));
    } finally {
      setSending(false);
    }
  };

  if (venueLoading || loading) return <OwnerPageSkeleton />;

  const venueName = venue?.name ?? t('smsCampaigns.previewSender');

  return (
    <div className="min-h-screen bg-background pb-20">
      <OwnerHeader title={t('smsCampaigns.title')} />
      <div className="px-4 py-6 space-y-5 max-w-2xl mx-auto">

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MessageSquare className="w-4 h-4" />
            <span>{balance} {t('smsCampaigns.credits')}</span>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => { resetDialog(); setDialogOpen(true); }}>
            <Plus className="w-4 h-4" />
            {t('smsCampaigns.newCampaign')}
          </Button>
        </div>

        {campaigns.length === 0 ? (
          <Card className="border-white/[0.06] bg-surface/40">
            <CardContent className="flex flex-col items-center py-16 gap-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                <MessageSquare className="w-7 h-7 text-primary/60" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">{t('smsCampaigns.empty')}</p>
                <p className="text-xs text-muted-foreground max-w-xs">{t('smsCampaigns.emptyHint')}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-1 gap-1.5 border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary"
                onClick={() => { resetDialog(); setDialogOpen(true); }}
              >
                <Plus className="w-4 h-4" />
                {t('smsCampaigns.newCampaign')}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {campaigns.map((c) => {
              const meta = STATUS_META[c.status];
              const segKey = `smsCampaigns.segment${c.segment_filters?.type ? c.segment_filters.type.charAt(0).toUpperCase() + c.segment_filters.type.slice(1) : 'All'}`;
              return (
                <Card key={c.id} className="border-white/[0.06] bg-surface/40 overflow-hidden">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{c.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{c.body_template}</p>
                      </div>
                      <Badge className={cn("flex items-center gap-1 text-xs shrink-0", meta.cls)}>
                        {meta.icon}{meta.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {c.status === 'sent'
                          ? t('smsCampaigns.sentCount').replace('{n}', String(c.sent_count))
                          : t('smsCampaigns.estimatedCount').replace('{n}', String(c.estimated_recipients))}
                      </span>
                      <span>{t(segKey)}</span>
                      {c.sent_at && (
                        <span className="flex items-center gap-1">
                          <CalendarDays className="w-3 h-3" />
                          {format(new Date(c.sent_at), 'd MMM yyyy', { locale: dateLocale })}
                        </span>
                      )}
                    </div>
                    {c.status === 'sent' && c.failed_count > 0 && (
                      <p className="text-xs text-rose-400 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {t('smsCampaigns.failedCount').replace('{n}', String(c.failed_count))}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Campaign Design Dialog — two-column: form left, phone preview right */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!sending) { setDialogOpen(open); if (!open) resetDialog(); } }}>
        <DialogContent className="max-w-[820px] gap-0 p-0 overflow-hidden">

          {/* Header */}
          <div className="relative overflow-hidden bg-gradient-to-br from-primary/15 via-background to-background px-6 pt-5 pb-4 border-b border-white/[0.06]">
            <div className="absolute -top-6 -right-6 h-24 w-24 rounded-full bg-primary/20 blur-2xl" />
            <DialogHeader className="relative">
              <DialogTitle className="text-base">{t('smsCampaigns.newCampaign')}</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{t('smsCampaigns.dialogSubtitle')}</p>
            </DialogHeader>
          </div>

          {/* Two-column body */}
          <div className="flex min-h-0">

            {/* LEFT — form */}
            <div className="flex-1 px-6 py-5 space-y-4 overflow-y-auto border-r border-white/[0.06]">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t('smsCampaigns.labelName')}
                </Label>
                <Input
                  placeholder={t('smsCampaigns.namePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-surface/40 border-white/[0.08]"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {t('smsCampaigns.labelMessage')}
                  </Label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowLinkInput((v) => !v)}
                      className={cn(
                        "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors",
                        showLinkInput
                          ? "bg-primary/20 text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
                      )}
                      title={t('smsCampaigns.insertLink')}
                    >
                      <Link className="h-3 w-3" />
                      {t('smsCampaigns.insertLink')}
                    </button>
                    <span className={cn("text-xs", body.length > MAX_SMS_CHARS * 0.9 ? "text-amber-400" : "text-muted-foreground")}>
                      {body.length}/{MAX_SMS_CHARS}
                    </span>
                  </div>
                </div>

                {showLinkInput && (
                  <div className="space-y-1">
                    <div className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-2 py-1.5 transition-colors",
                      linkError
                        ? "border-rose-500/40 bg-rose-500/8"
                        : "border-primary/30 bg-primary/8"
                    )}>
                      <Link className={cn("h-3.5 w-3.5 shrink-0", linkError ? "text-rose-400/60" : "text-primary/60")} />
                      <input
                        autoFocus
                        type="url"
                        value={linkUrl}
                        onChange={(e) => { setLinkUrl(e.target.value); setLinkError(false); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleInsertLink(); } }}
                        placeholder={t('smsCampaigns.linkUrlPlaceholder')}
                        className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleInsertLink}
                        disabled={!linkUrl.trim()}
                        className={cn(
                          "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                          linkError ? "text-rose-400 hover:bg-rose-500/20" : "text-primary hover:bg-primary/20"
                        )}
                      >
                        <CornerDownLeft className="h-3 w-3" />
                        {t('smsCampaigns.insertLinkBtn')}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowLinkInput(false); setLinkUrl(''); setLinkError(false); }}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {linkError && (
                      <p className="flex items-center gap-1 text-[11px] text-rose-400 px-1">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        {t('smsCampaigns.invalidUrl')}
                      </p>
                    )}
                  </div>
                )}

                <Textarea
                  ref={textareaRef}
                  placeholder={t('smsCampaigns.messagePlaceholder')}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={4}
                  maxLength={MAX_SMS_CHARS}
                  className="bg-surface/40 border-white/[0.08] resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t('smsCampaigns.labelSegment')}
                </Label>
                <Select value={segmentType} onValueChange={(v) => setSegmentType(v as typeof segmentType)}>
                  <SelectTrigger className="bg-surface/40 border-white/[0.08]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      <span className="flex items-center gap-2"><Users className="w-4 h-4 text-sky-400" />{t('smsCampaigns.segmentAll')}</span>
                    </SelectItem>
                    <SelectItem value="event">
                      <span className="flex items-center gap-2"><CalendarDays className="w-4 h-4 text-violet-400" />{t('smsCampaigns.segmentEvent')}</span>
                    </SelectItem>
                    <SelectItem value="vip">
                      <span className="flex items-center gap-2"><Crown className="w-4 h-4 text-amber-400" />{t('smsCampaigns.segmentVip')}</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {segmentType === 'event' && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {t('smsCampaigns.labelEvent')}
                  </Label>
                  <Select value={selectedEventId} onValueChange={setSelectedEventId}>
                    <SelectTrigger className="bg-surface/40 border-white/[0.08]">
                      <SelectValue placeholder={t('smsCampaigns.selectEventPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {visibleEvents.length === 0 && !showPastEvents && (
                        <div className="px-3 py-2 text-xs text-muted-foreground">{t('smsCampaigns.noUpcomingEvents')}</div>
                      )}
                      {visibleEvents.map((ev) => (
                        <SelectItem key={ev.id} value={ev.id}>
                          {ev.title} — {format(new Date(ev.start_at), 'd MMM yyyy', { locale: dateLocale })}
                        </SelectItem>
                      ))}
                      {pastEvents.length > 0 && !showPastEvents && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setShowPastEvents(true); }}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground border-t border-white/[0.06] mt-1 pt-2"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                          {t('smsCampaigns.showPastEvents').replace('{n}', String(pastEvents.length))}
                        </button>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                  <p className="text-[11px] text-muted-foreground">{t('smsCampaigns.estimatedRecipients')}</p>
                  <p className="mt-0.5 text-lg font-semibold text-foreground">
                    {countLoading ? <Loader2 className="w-4 h-4 animate-spin inline" /> : recipientCount !== null ? recipientCount : '—'}
                  </p>
                </div>
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                  <p className="text-[11px] text-muted-foreground">{t('smsCampaigns.availableCredits')}</p>
                  <p className={cn("mt-0.5 text-lg font-semibold", balance < (recipientCount ?? 0) ? "text-rose-400" : "text-foreground")}>
                    {balance}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2.5 text-xs text-amber-300/80">
                <Rocket className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                <span>{t('smsCampaigns.sendComingSoonNotice')}</span>
              </div>
            </div>

            {/* RIGHT — phone preview */}
            <div className="hidden md:flex w-[280px] shrink-0 items-center justify-center bg-zinc-950/40 px-6 py-8">
              <PhonePreview message={body} senderName={venueName} />
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t border-white/[0.06] gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="border-white/[0.08]">
              {t('smsCampaigns.cancel')}
            </Button>
            <Button disabled className="gap-2 opacity-50 cursor-not-allowed">
              <Lock className="w-4 h-4" />
              {t('smsCampaigns.sendLockedLabel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
