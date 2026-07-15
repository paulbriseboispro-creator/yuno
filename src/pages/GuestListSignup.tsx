import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useEventRoute } from '@/hooks/useEventRoute';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ArrowLeft, Users, Clock, Wine, CheckCircle, Ticket, LogIn, PartyPopper } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import { PARIS_TIMEZONE, fromParisTime } from '@/lib/timezone';
import { fr, es, enUS } from 'date-fns/locale';
import QRCode from 'qrcode';
import { PublicPage } from '@/components/PublicPage';

interface GuestListInfo {
  id: string;
  quota: number;
  quotaFemale: number | null;
  quotaMale: number | null;
  freeBeforeTime: string;
  includesDrink: boolean;
  eventTitle: string;
  eventStartAt: string;
  eventEndAt: string;
  eventImageUrl: string | null;
  venueId: string;
  venueName: string;
  shareToken: string;
}

export default function GuestListSignup() {
  const { eventId, basePath, venueSlug: slug } = useEventRoute();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { user, loading: authLoading } = useAuth();
  const token = searchParams.get('token');
  const ref = searchParams.get('ref');
  const genderFromUrl = searchParams.get('gender') as 'female' | 'male' | null;
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const [guestList, setGuestList] = useState<GuestListInfo | null>(null);
  const [entriesCount, setEntriesCount] = useState(0);
  const [femaleCount, setFemaleCount] = useState(0);
  const [maleCount, setMaleCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [qrImage, setQrImage] = useState('');

  // Form (gender only - rest comes from profile)
  // Pre-fill from URL param when coming from a gender-specific share link
  const [gender, setGender] = useState(genderFromUrl || '');
  // Guest registration (no account) — same unified pattern as ticket/table checkout.
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');

  // Countdown
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    fetchGuestList();
    // `user` is included so the "already registered" check re-runs once auth
    // resolves (it can settle after the first fetch, otherwise it's missed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, eventId, user]);

  useEffect(() => {
    if (!guestList) return;
    // free_before_time is a Paris wall-clock time on the event's Paris calendar date
    // (rolling to the next day if it lands before the start, e.g. event 23:00 /
    // free-before 01:30). Resolve it to a real UTC instant so the countdown is
    // correct in ANY timezone — the old setHours() used the browser's local time,
    // so a guest in NY/Madrid saw a countdown off by hours.
    const eventStart = new Date(guestList.eventStartAt);
    const parisDay = formatInTimeZone(eventStart, PARIS_TIMEZONE, 'yyyy-MM-dd');
    let deadline = fromParisTime(`${parisDay}T${guestList.freeBeforeTime}:00`);
    if (deadline < eventStart) {
      const nextDay = formatInTimeZone(new Date(eventStart.getTime() + 86400000), PARIS_TIMEZONE, 'yyyy-MM-dd');
      deadline = fromParisTime(`${nextDay}T${guestList.freeBeforeTime}:00`);
    }

    const tick = () => {
      const diff = deadline.getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft(t('guestList.expired'));
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setTimeLeft(days > 0 ? `${days}${t('guestList.unitDay')} ${h}h ${m}min` : `${h}h ${m}min`);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [guestList, t]);

  // Realtime fill updates — dedicated effect so the channel is actually cleaned up
  // (previously the cleanup was returned from the async fetch and silently dropped,
  // leaking a channel on every token/eventId change).
  useEffect(() => {
    const glId = guestList?.id;
    if (!glId) return;
    const channel = supabase
      .channel(`gl-entries-${glId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'guest_list_entries',
        filter: `guest_list_id=eq.${glId}`,
      }, () => {
        supabase
          .rpc('get_guest_list_public_fill', { _guest_list_id: glId })
          .maybeSingle()
          .then(
            ({ data: fillUpdate }) => {
              const f = fillUpdate as { total_count: number; female_count: number; male_count: number } | null;
              if (f) {
                setEntriesCount(f.total_count || 0);
                setFemaleCount(f.female_count || 0);
                setMaleCount(f.male_count || 0);
              }
            },
            () => { /* keep the previous count if the realtime re-count fails */ },
          );
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [guestList?.id]);

  const fetchGuestList = async () => {
    try {
      let data: any = null;
      if (token) {
        // Token-based lookup goes through a SECURITY DEFINER RPC so we don't
        // expose share_token enumeration via the public SELECT policy.
        const { data: glRow } = await supabase
          .rpc('get_guest_list_by_token', { _token: token })
          .maybeSingle();
        if (glRow) {
          const { data: ev } = await supabase
            .from('events')
            .select('id, title, start_at, end_at, venue_id, partner_venue_id, poster_url')
            .eq('id', (glRow as any).event_id)
            .maybeSingle();
          data = { ...(glRow as any), events: ev };
        }
      } else if (eventId) {
        // Multi-part model: an event can carry several parts (club/DJ/promoter).
        // maybeSingle() used to throw PGRST116 as soon as ≥2 parts were readable
        // (e.g. an owner who sees all their own parts) → the page showed "not
        // found" for a list that exists. Prefer the club part, else the first.
        const { data: glRows } = await supabase
          .from('guest_lists')
          .select('*, events!inner(id, title, start_at, end_at, venue_id, partner_venue_id, poster_url)')
          .eq('is_active', true)
          .eq('event_id', eventId);
        data = (glRows || []).find((r: { holder_type?: string }) => r.holder_type === 'club')
          ?? (glRows || [])[0] ?? null;
      } else {
        setLoading(false);
        return;
      }

      if (!data) {
        setLoading(false);
        return;
      }

      // Co-soirée org-led : le club physique est partner_venue_id.
      const eventVenueId = (data.events as any).venue_id ?? (data.events as any).partner_venue_id;
      const { data: venue } = eventVenueId
        ? await supabase.from('venues').select('name').eq('id', eventVenueId).single()
        : { data: null };

      setGuestList({
        id: data.id,
        quota: data.quota,
        quotaFemale: data.quota_female,
        quotaMale: data.quota_male,
        freeBeforeTime: data.free_before_time?.substring(0, 5) || '02:00',
        includesDrink: data.includes_drink,
        eventTitle: (data.events as any).title,
        eventStartAt: (data.events as any).start_at,
        eventEndAt: (data.events as any).end_at,
        eventImageUrl: (data.events as any).poster_url || null,
        venueId: eventVenueId,
        venueName: venue?.name || '',
        shareToken: data.share_token,
      });

      // Fetch counts via la RPC agrégée SECURITY DEFINER : un count() direct sur
      // guest_list_entries renvoie 0 EN SILENCE pour un visiteur anonyme (aucune
      // policy SELECT anon) → une liste PLEINE s'affichait grande ouverte sur le
      // canal le plus utilisé (le lien partagé), et l'échec ne surgissait qu'au
      // moment de confirmer. Même fix que la page club (TicketSelection).
      const { data: fillRaw } = await supabase
        .rpc('get_guest_list_public_fill', { _guest_list_id: data.id })
        .maybeSingle();
      const fill = fillRaw as { total_count: number; female_count: number; male_count: number } | null;
      setEntriesCount(fill?.total_count || 0);
      if (data.quota_female !== null || data.quota_male !== null) {
        setFemaleCount(fill?.female_count || 0);
        setMaleCount(fill?.male_count || 0);
      }

      // Check if user already registered
      if (user) {
        const { count: existingCount } = await supabase
          .from('guest_list_entries')
          .select('*', { count: 'exact', head: true })
          .eq('guest_list_id', data.id)
          .eq('user_id', user.id)
          .neq('status', 'cancelled');
        
        if (existingCount && existingCount > 0) {
          setAlreadyRegistered(true);
        }
      }

      // Realtime fill updates are wired in a dedicated effect keyed on guestList.id
      // (see below) — returning the cleanup from this async function discarded it,
      // leaking a channel on every token/eventId change.
    } catch (err) {
      console.error('Error fetching guest list:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!guestList) return;

    // Validate gender required if quotas are set
    if ((guestList.quotaFemale !== null || guestList.quotaMale !== null) && !gender) {
      toast.error(t('guestList.genderRequired'));
      return;
    }
    // Guests register without an account — validate their contact info.
    if (!user && (!guestName.trim() || !guestEmail.trim() || !guestPhone.trim())) {
      toast.error(t('tickets.fillRequired'));
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-guest-list-entry', {
        body: {
          shareToken: token || guestList.shareToken,
          gender: gender || undefined,
          promoterCode: ref || undefined,
          // Guest contact info — used by the function only when no JWT is present.
          ...(user ? {} : {
            guestFullName: guestName.trim(),
            guestEmail: guestEmail.trim(),
            guestPhone: guestPhone.trim(),
          }),
        },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      // Generate QR image
      if (data.entry?.qrCode) {
        const qrUrl = await QRCode.toDataURL(data.entry.qrCode, {
          width: 250,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
        });
        setQrImage(qrUrl);
      }

      setSuccess(true);
      toast.success(t('guestList.registrationSuccess'));

      // Sync gender to the user's profile so the DJ audience analytics can use it
      // as a primary source (rather than relying on guest_list_entries coverage).
      if (user && gender) {
        supabase.from('profiles').update({ gender }).eq('id', user.id).then(() => {/* best-effort */});
      }
    } catch (err: any) {
      let msg = err?.message || t('guestList.registrationError');
      // supabase-js wraps a non-2xx function response; the real message is in the body.
      try {
        if (err?.context && typeof err.context.json === 'function') {
          const body = await err.context.json();
          if (body?.error) msg = body.error;
        }
      } catch { /* ignore body parse errors */ }
      // Graceful fallback until the guest-capable edge function is deployed: a guest
      // who can't yet be registered without an account is routed to login instead of
      // hitting a dead-end error. Once the function ships, guests succeed here.
      if (!user && /authentication required|log in/i.test(msg)) {
        navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      if (msg.includes('full')) {
        toast.error(t('guestList.full'));
      } else if (msg.includes('already registered')) {
        toast.error(t('guestList.alreadyRegistered'));
      } else if (msg.includes('quota reached')) {
        toast.error(t('guestList.quotaReached'));
      } else {
        toast.error(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!guestList) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
        <p className="text-muted-foreground mb-4">{t('guestList.notFound')}</p>
        <Button variant="outline" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('common.back')}
        </Button>
      </div>
    );
  }

  // ── Event ended ──
  const eventEnded = new Date(guestList.eventEndAt) < new Date();
  if (eventEnded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-sm w-full border-border/50">
          <CardContent className="p-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto">
              <PartyPopper className="h-9 w-9 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-bold">{t('guestList.eventOver')}</h2>
            <p className="text-sm text-muted-foreground">{guestList.eventTitle}</p>
            <Button className="w-full" onClick={() => navigate('/')}>
              🎉 {t('guestList.discoverNextParty')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isFull = entriesCount >= guestList.quota
    || (genderFromUrl === 'female' && guestList.quotaFemale !== null && femaleCount >= guestList.quotaFemale)
    || (genderFromUrl === 'male' && guestList.quotaMale !== null && maleCount >= guestList.quotaMale);
  const remaining = genderFromUrl === 'female' && guestList.quotaFemale !== null
    ? Math.max(0, guestList.quotaFemale - femaleCount)
    : genderFromUrl === 'male' && guestList.quotaMale !== null
    ? Math.max(0, guestList.quotaMale - maleCount)
    : guestList.quota - entriesCount;

  // ── Success state ──
  if (success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-sm w-full border-border/50">
          <CardContent className="p-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center mx-auto">
              <CheckCircle className="h-9 w-9 text-primary" />
            </div>
            <h2 className="text-xl font-bold">{t('guestList.confirmed')}</h2>
            <p className="text-sm text-muted-foreground">{guestList.eventTitle}</p>
            <div className="text-sm space-y-1 text-muted-foreground">
              <p>
                <Clock className="h-3.5 w-3.5 inline mr-1" />
                {t('guestList.freeBefore')} {guestList.freeBeforeTime}
              </p>
              {guestList.includesDrink && (
                <p className="text-primary">
                  <Wine className="h-3.5 w-3.5 inline mr-1" />
                  {t('guestList.drinkIncluded')}
                </p>
              )}
            </div>
            {qrImage && (
              <img src={qrImage} alt="QR Code" className="mx-auto rounded-lg" />
            )}
            <p className="text-xs text-muted-foreground">{t('guestList.showQR')}</p>
            <Button className="w-full" onClick={() => navigate('/my-orders')}>
              <Ticket className="h-4 w-4 mr-2" />
              {t('guestList.viewInOrders')}
            </Button>
            <Button variant="outline" className="w-full" onClick={() => navigate(slug ? `/club/${slug}` : `${basePath}`, { state: { eventId } })}>
              {t('common.backToHome')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Auth gate: not logged in ──
  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        {/* Header */}
        <div className="sticky top-0 z-40 border-b border-border/40 bg-surface/80 backdrop-blur-md">
          <div className="flex items-center gap-3 px-4 h-14">
            <Button variant="ghost" size="icon" onClick={() => eventId ? navigate(`${basePath}`, { state: { eventId } }) : navigate('/')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="font-semibold truncate">{t('guestList.title')}</h1>
          </div>
        </div>

        <PublicPage variant="flow">
        <div className="max-w-lg mx-auto p-4 space-y-6">
          {/* Event Banner */}
          {guestList.eventImageUrl && (
            <div className="rounded-xl overflow-hidden border border-border/30">
              <img
                src={guestList.eventImageUrl}
                alt={guestList.eventTitle}
                className="w-full h-auto object-cover"
              />
            </div>
          )}

          {/* Event Info */}
          <div className="text-center space-y-2 pt-2">
            <h2 className="text-2xl font-bold">{guestList.eventTitle}</h2>
            <p className="text-muted-foreground">{guestList.venueName}</p>
            <p className="text-sm">
              {formatInTimeZone(new Date(guestList.eventStartAt), PARIS_TIMEZONE, 'EEEE d MMMM · HH:mm', { locale: dateLocale })}
            </p>
          </div>

          {/* Guest List Perks */}
          <div className="flex flex-wrap justify-center gap-2">
            <Badge className="bg-primary/15 text-primary border border-primary/20 text-sm px-3 py-1">
              {t('guestList.free')} — 0 €
            </Badge>
            <Badge variant="secondary" className="text-sm px-3 py-1 border border-border/50">
              <Clock className="h-3.5 w-3.5 mr-1.5" />
              {t('guestList.freeBefore')} {guestList.freeBeforeTime}
            </Badge>
            {guestList.includesDrink && (
              <Badge className="bg-primary/15 text-primary border border-primary/20 text-sm px-3 py-1">
                <Wine className="h-3.5 w-3.5 mr-1.5" />
                {t('guestList.drinkIncluded')}
              </Badge>
            )}
          </div>

          {/* Spots counter */}
          {!isFull && (
            <div className="bg-primary/8 border border-primary/15 rounded-xl p-5 text-center">
              <p className="text-3xl font-bold text-primary">{remaining}</p>
              <p className="text-sm text-muted-foreground">{t('guestList.spotsLeft')}</p>
              {timeLeft && (
                <p className="text-xs text-muted-foreground mt-1">⏱ {timeLeft}</p>
              )}
            </div>
          )}

          {/* Guest registration — no account required (account creation is offered
              after success via /guest/finalize, not as a wall before it). */}
          {!isFull && (
            <Card className="border border-border/50">
              <CardContent className="p-4 space-y-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">{t('guestList.yourDetails')}</p>
                  <p className="text-xs text-muted-foreground">{t('guestList.guestSubtitle')}</p>
                </div>

                <button
                  type="button"
                  onClick={() => navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)}
                  className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <LogIn className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>{t('guest.haveAccountQuestion')}{' '}
                    <span className="text-primary font-semibold underline underline-offset-2">{t('guest.logIn')}</span>
                  </span>
                </button>

                <div className="space-y-1.5">
                  <Label htmlFor="gls-name" className="text-xs text-muted-foreground">{t('guestList.fullName')} *</Label>
                  <Input id="gls-name" value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder={t('guestList.namePlaceholder')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gls-email" className="text-xs text-muted-foreground">{t('guestList.email')} *</Label>
                  <Input id="gls-email" type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} placeholder={t('guestList.emailPlaceholder')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gls-phone" className="text-xs text-muted-foreground">{t('guestList.phone')} *</Label>
                  <Input id="gls-phone" type="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder={t('guestList.phonePlaceholder')} />
                </div>

                {/* Gender selection if quotas */}
                {(guestList.quotaFemale !== null || guestList.quotaMale !== null) && (
                  <div>
                    <p className="text-sm font-medium mb-2">{t('guestList.gender')} *</p>
                    {genderFromUrl ? (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border/50 bg-muted/40">
                        <span className="text-sm font-medium">
                          {genderFromUrl === 'female' ? `♀ ${t('guestList.female')}` : `♂ ${t('guestList.male')}`}
                        </span>
                      </div>
                    ) : (
                      <Select value={gender} onValueChange={setGender}>
                        <SelectTrigger>
                          <SelectValue placeholder={t('guestList.selectGender')} />
                        </SelectTrigger>
                        <SelectContent>
                          {(guestList.quotaFemale === null || guestList.quotaFemale > 0) && (
                            <SelectItem value="female">{t('guestList.female')}</SelectItem>
                          )}
                          {(guestList.quotaMale === null || guestList.quotaMale > 0) && (
                            <SelectItem value="male">{t('guestList.male')}</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}

                {/* Summary */}
                <div className="border-t border-border pt-3 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Guest List — {guestList.eventTitle}</span>
                    <span className="font-bold text-primary">0 €</span>
                  </div>
                  {guestList.includesDrink && (
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>🍸 {t('guestList.drinkIncluded')}</span>
                      <span>{t('guestList.included')}</span>
                    </div>
                  )}
                </div>

                <Button
                  className="w-full h-12 font-semibold"
                  onClick={handleConfirm}
                  disabled={submitting || !guestName.trim() || !guestEmail.trim() || !guestPhone.trim()}
                >
                  {submitting ? '...' : t('guestList.confirmRegistration')}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
        </PublicPage>
      </div>
    );
  }

  // ── Logged in: confirmation page ──
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-40 border-b border-border/40 bg-surface/80 backdrop-blur-md">
        <div className="flex items-center gap-3 px-4 h-14">
          <Button variant="ghost" size="icon" onClick={() => eventId ? navigate(`${basePath}`, { state: { eventId } }) : navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="font-semibold truncate">{t('guestList.title')}</h1>
        </div>
      </div>

      <PublicPage variant="flow">
      <div className="max-w-lg mx-auto p-4 space-y-6">
        {/* Event Banner */}
        {guestList.eventImageUrl && (
          <div className="rounded-xl overflow-hidden border border-border/30">
            <img
              src={guestList.eventImageUrl}
              alt={guestList.eventTitle}
              className="w-full h-auto object-cover"
            />
          </div>
        )}

        {/* Event Info */}
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold">{guestList.eventTitle}</h2>
          <p className="text-muted-foreground">{guestList.venueName}</p>
          <p className="text-sm">
            {formatInTimeZone(new Date(guestList.eventStartAt), PARIS_TIMEZONE, 'EEEE d MMMM · HH:mm', { locale: dateLocale })}
          </p>
        </div>

        {/* Badges */}
        <div className="flex flex-wrap justify-center gap-2">
          <Badge className="bg-primary/15 text-primary border border-primary/20 text-sm px-3 py-1">
            {t('guestList.free')} — 0 €
          </Badge>
          <Badge variant="secondary" className="text-sm px-3 py-1 border border-border/50">
            <Clock className="h-3.5 w-3.5 mr-1.5" />
            {t('guestList.freeBefore')} {guestList.freeBeforeTime}
          </Badge>
          {guestList.includesDrink && (
            <Badge className="bg-primary/15 text-primary border border-primary/20 text-sm px-3 py-1">
              <Wine className="h-3.5 w-3.5 mr-1.5" />
              {t('guestList.drinkIncluded')}
            </Badge>
          )}
        </div>

        {/* Counter */}
        <div className="text-center">
          {isFull ? (
            <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-5">
              <p className="text-lg font-bold text-destructive">{t('guestList.full')}</p>
              <Button className="mt-3" onClick={() => navigate(`${basePath}`, { state: { eventId } })}>
                <Ticket className="h-4 w-4 mr-2" />
                {t('guestList.buyTicket')}
              </Button>
            </div>
          ) : (
            <div className="bg-primary/8 border border-primary/15 rounded-xl p-5">
              <p className="text-3xl font-bold text-primary">{remaining}</p>
              <p className="text-sm text-muted-foreground">{t('guestList.spotsLeft')}</p>
              {timeLeft && (
                <p className="text-xs text-muted-foreground mt-1">⏱ {timeLeft}</p>
              )}
            </div>
          )}
        </div>

        {/* Confirmation card (logged in) */}
        {!isFull && !alreadyRegistered && (
          <Card className="border border-border/50">
            <CardContent className="p-4 space-y-4">
              <div className="rounded-lg bg-muted/50 p-3 space-y-1">
                <p className="text-sm font-medium">{t('guestList.registeredAs')}</p>
                <p className="text-sm text-muted-foreground">{user.email}</p>
              </div>

              {/* Gender selection if quotas */}
              {(guestList.quotaFemale !== null || guestList.quotaMale !== null) && (
                <div>
                  <p className="text-sm font-medium mb-2">{t('guestList.gender')} *</p>
                  {genderFromUrl ? (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border/50 bg-muted/40">
                      <span className="text-sm font-medium">
                        {genderFromUrl === 'female' ? `♀ ${t('guestList.female')}` : `♂ ${t('guestList.male')}`}
                      </span>
                    </div>
                  ) : (
                    <Select value={gender} onValueChange={setGender}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('guestList.selectGender')} />
                      </SelectTrigger>
                      <SelectContent>
                        {(guestList.quotaFemale === null || guestList.quotaFemale > 0) && (
                          <SelectItem value="female">{t('guestList.female')}</SelectItem>
                        )}
                        {(guestList.quotaMale === null || guestList.quotaMale > 0) && (
                          <SelectItem value="male">{t('guestList.male')}</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {/* Summary */}
              <div className="border-t border-border pt-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Guest List — {guestList.eventTitle}</span>
                  <span className="font-bold text-primary">0 €</span>
                </div>
                {guestList.includesDrink && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>🍸 {t('guestList.drinkIncluded')}</span>
                    <span>{t('guestList.included')}</span>
                  </div>
                )}
              </div>

              <Button
                className="w-full h-12 font-semibold"
                onClick={handleConfirm}
                disabled={submitting}
              >
                {submitting ? '...' : t('guestList.confirmRegistration')}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Already registered state */}
        {alreadyRegistered && (
          <Card className="border border-primary/30 bg-primary/5">
            <CardContent className="p-6 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center mx-auto">
                <CheckCircle className="h-9 w-9 text-primary" />
              </div>
              <h3 className="text-lg font-bold">{t('guestList.alreadyOnList')}</h3>
              <p className="text-sm text-muted-foreground">{t('guestList.alreadyOnListDesc')}</p>
              <Button className="w-full" onClick={() => navigate('/my-orders')}>
                <Ticket className="h-4 w-4 mr-2" />
                {t('guestList.viewInOrders')}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
      </PublicPage>
    </div>
  );
}
