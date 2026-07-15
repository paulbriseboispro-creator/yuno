import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useEventRoute } from '@/hooks/useEventRoute';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useScrollIntoViewOnFocus } from '@/hooks/useScrollIntoViewOnFocus';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckoutSteps } from '@/components/CheckoutSteps';
import { PhoneInputWithCountry } from '@/components/PhoneInputWithCountry';
import { StickyCheckoutFooter } from '@/components/StickyCheckoutFooter';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { getStoredPromoCodeForVenue } from '@/hooks/usePromoterTracking';
import { formatInTimeZone } from 'date-fns-tz';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { fr, es, enUS } from 'date-fns/locale';
import { toast } from 'sonner';
import { ArrowLeft, Clock, Wine, CheckCircle, Ticket, LogIn, PartyPopper, Calendar } from 'lucide-react';
import QRCode from 'qrcode';
import { haptics } from '@/lib/haptics';
import { PublicPage } from '@/components/PublicPage';

interface GuestListInfo {
  id: string;
  quota: number;
  quotaFemale: number | null;
  quotaMale: number | null;
  freeBeforeTime: string;
  includesDrink: boolean;
  shareToken: string;
  eventTitle: string;
  eventStartAt: string;
  eventEndAt: string;
  eventImageUrl: string | null;
  venueId: string | null;
  venueName: string;
}

/**
 * Public guest-list checkout — the normal Yuno reservation flow for a guest list
 * surfaced on the club page (visible_on_club_page). Reached from TicketSelection's
 * "Continue" footer, NOT from a share link. The token-based share link still lands
 * on GuestListSignup. Direct URL access is gated to publicly-visible lists.
 */
export default function GuestListCheckout() {
  const { eventId, basePath } = useEventRoute();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  // Clavier iOS : garder le champ focus visible (formulaire long).
  useScrollIntoViewOnFocus();
  const { user, loading: authLoading } = useAuth();
  const ref = searchParams.get('ref');
  // Gendered guest lists arrive here as ?gender=female|male (one card per gender),
  // so the gender is already decided — no in-page picker.
  const genderParam = searchParams.get('gender') as 'female' | 'male' | null;
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const [guestList, setGuestList] = useState<GuestListInfo | null>(null);
  const [entriesCount, setEntriesCount] = useState(0);
  const [genderCount, setGenderCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [venuePlan, setVenuePlan] = useState<string>('core');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [gender, setGender] = useState<string>(genderParam || '');
  const [qrImage, setQrImage] = useState('');
  const [timeLeft, setTimeLeft] = useState('');
  // Guest registration (no account) — mirrors the ticket/table guest flow.
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');

  const backToSelection = () =>
    navigate(eventId ? `${basePath}/billets` : '/', { state: { eventId } });

  useEffect(() => {
    fetchGuestList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, user]);

  useEffect(() => {
    if (!guestList) return;
    const timer = setInterval(() => {
      const eventDate = new Date(guestList.eventStartAt);
      const [hours, minutes] = guestList.freeBeforeTime.split(':').map(Number);
      const deadline = new Date(eventDate);
      deadline.setHours(hours, minutes, 0, 0);
      if (deadline < eventDate) deadline.setDate(deadline.getDate() + 1);

      const diff = deadline.getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft(t('guestList.expired'));
        clearInterval(timer);
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setTimeLeft(days > 0 ? `${days}${t('guestList.unitDay')} ${h}h ${m}min` : `${h}h ${m}min`);
    }, 1000);
    return () => clearInterval(timer);
  }, [guestList, t]);

  const fetchGuestList = async () => {
    if (!eventId) { setLoading(false); return; }
    try {
      // Public-only gate: a direct URL must point at a list the club chose to show.
      const { data: glRows } = await supabase
        .from('guest_lists')
        .select('id, quota, quota_female, quota_male, free_before_time, includes_drink, share_token, holder_type, events!inner(id, title, start_at, end_at, venue_id, poster_url)')
        .eq('event_id', eventId)
        .eq('is_active', true)
        .eq('visible_on_club_page', true);
      // Liste club prioritaire ; sinon la première part marquée « publique » (visibilité
      // choisie dans son preset). Les parts non visibles restent accessibles par lien.
      const gl = (glRows || []).find((r: { holder_type?: string }) => r.holder_type === 'club') ?? (glRows || [])[0] ?? null;

      if (!gl) { setLoading(false); return; }

      const ev = (gl as any).events;
      let venueName = '';
      if (ev?.venue_id) {
        const { data: venue } = await supabase.from('venues').select('name').eq('id', ev.venue_id).maybeSingle();
        venueName = venue?.name || '';
        const { data: sub } = await supabase.from('venue_subscriptions').select('subscription_plan').eq('venue_id', ev.venue_id).in('status', ['active', 'trialing']).maybeSingle();
        setVenuePlan(sub?.subscription_plan || 'core');
      }

      setGuestList({
        id: gl.id,
        quota: gl.quota,
        quotaFemale: gl.quota_female,
        quotaMale: gl.quota_male,
        freeBeforeTime: gl.free_before_time?.substring(0, 5) || '02:00',
        includesDrink: gl.includes_drink,
        shareToken: gl.share_token,
        eventTitle: ev.title,
        eventStartAt: ev.start_at,
        eventEndAt: ev.end_at,
        eventImageUrl: ev.poster_url || null,
        venueId: ev.venue_id || null,
        venueName,
      });

      // Fill counts via the aggregated SECURITY DEFINER RPC. A direct count() on
      // guest_list_entries returns 0 SILENTLY for an anonymous visitor (no anon
      // SELECT policy) — a FULL list then rendered wide open on the club page,
      // over-promising capacity until submit. Same fix as GuestListSignup.
      const { data: fillRaw } = await supabase
        .rpc('get_guest_list_public_fill', { _guest_list_id: gl.id })
        .maybeSingle();
      const fill = fillRaw as { total_count: number; female_count: number; male_count: number } | null;
      setEntriesCount(fill?.total_count || 0);
      if (genderParam === 'female') setGenderCount(fill?.female_count || 0);
      else if (genderParam === 'male') setGenderCount(fill?.male_count || 0);

      if (user) {
        const { count: existing } = await supabase
          .from('guest_list_entries')
          .select('*', { count: 'exact', head: true })
          .eq('guest_list_id', gl.id)
          .eq('user_id', user.id)
          .neq('status', 'cancelled');
        if (existing && existing > 0) setAlreadyRegistered(true);
      }
    } catch (err) {
      console.error('Error fetching guest list:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!guestList || submitting) return;
    if ((guestList.quotaFemale !== null || guestList.quotaMale !== null) && !gender) {
      toast.error(t('guestList.genderRequired'));
      return;
    }
    // Guests register without an account — validate their contact info up front.
    if (!user && (!guestName.trim() || !guestEmail.trim() || !guestPhone.trim())) {
      toast.error(t('tickets.fillRequired'));
      return;
    }

    setSubmitting(true);
    try {
      const promoterCode = ref || (guestList.venueId ? getStoredPromoCodeForVenue(guestList.venueId) : null) || undefined;
      const { data, error } = await supabase.functions.invoke('create-guest-list-entry', {
        body: {
          shareToken: guestList.shareToken,
          gender: gender || undefined,
          promoterCode,
          // Guest contact info — the function uses these only when no valid JWT
          // is present, creating an entry with user_id = null.
          ...(user ? {} : {
            guestFullName: guestName.trim(),
            guestEmail: guestEmail.trim(),
            guestPhone: guestPhone.trim(),
          }),
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.entry?.qrCode) {
        const qrUrl = await QRCode.toDataURL(data.entry.qrCode, {
          width: 250,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
        });
        setQrImage(qrUrl);
      }

      setSuccess(true);
      haptics.success();
      toast.success(t('guestList.registrationSuccess'));
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
      // hitting a dead-end error. Once the function ships, guests succeed and never
      // reach this branch.
      if (!user && /authentication required|log in/i.test(msg)) {
        navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      if (msg.includes('full')) toast.error(t('guestList.full'));
      else if (msg.includes('already registered')) toast.error(t('guestList.alreadyRegistered'));
      else if (msg.includes('quota reached')) toast.error(t('guestList.quotaReached'));
      else toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading ──
  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0A0A0A' }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // ── Not found / not public ──
  if (!guestList) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-4" style={{ background: '#0A0A0A' }}>
        <p className="font-mono uppercase text-[11px] tracking-[0.06em] text-[#9A9A9A]">{t('guestList.notFound')}</p>
        <Button variant="outline" onClick={backToSelection}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('common.back')}
        </Button>
      </div>
    );
  }

  const eventEnded = new Date(guestList.eventEndAt) < new Date();
  // Gendered card: cap against this gender's quota AND the overall list quota.
  const genderQuota = genderParam === 'female' ? guestList.quotaFemale : genderParam === 'male' ? guestList.quotaMale : null;
  const effectiveQuota = genderParam && genderQuota !== null ? genderQuota : guestList.quota;
  const effectiveCount = genderParam ? genderCount : entriesCount;
  const isFull = effectiveCount >= effectiveQuota || entriesCount >= guestList.quota;
  const remaining = Math.max(0, Math.min(effectiveQuota - effectiveCount, guestList.quota - entriesCount));
  // A gender picker is only needed as a fallback for a gendered list reached without ?gender.
  const genderRequired = (guestList.quotaFemale !== null || guestList.quotaMale !== null) && !genderParam;
  const displayTitle = genderParam === 'female'
    ? `${t('guestList.title')} ${t('guestList.female')}`
    : genderParam === 'male'
      ? `${t('guestList.title')} ${t('guestList.male')}`
      : t('guestList.title');

  // ── Event ended ──
  if (eventEnded) {
    return (
      <CheckoutShell title={displayTitle} onBack={backToSelection}>
        <div className="max-w-lg mx-auto px-4 pt-10 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-white/[0.06] flex items-center justify-center mx-auto">
            <PartyPopper className="h-9 w-9 text-white/40" />
          </div>
          <h2 className="text-xl font-bold">{t('guestList.eventOver')}</h2>
          <p className="text-sm text-white/45">{guestList.eventTitle}</p>
          <Button className="w-full" onClick={() => navigate('/')}>🎉 {t('guestList.discoverNextParty')}</Button>
        </div>
      </CheckoutShell>
    );
  }

  // ── Success (QR) ──
  if (success) {
    return (
      <CheckoutShell title={displayTitle} onBack={() => navigate('/my-orders')}>
        <div className="max-w-lg mx-auto px-4 pt-6 pb-10">
          <CheckoutSteps currentStep={3} />
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 border border-emerald-500/25 bg-[#141414] p-6 text-center space-y-4"
            style={{ borderRadius: 12, backgroundColor: 'rgba(16,185,129,0.04)' }}
          >
            <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto">
              <CheckCircle className="h-9 w-9 text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold">{t('guestList.confirmed')}</h2>
            <p className="text-sm text-white/45">{guestList.eventTitle}</p>
            <div className="text-sm space-y-1 text-white/55">
              <p><Clock className="h-3.5 w-3.5 inline mr-1" />{t('guestList.freeBefore')} {guestList.freeBeforeTime}</p>
              {guestList.includesDrink && (
                <p className="text-emerald-400"><Wine className="h-3.5 w-3.5 inline mr-1" />{t('guestList.drinkIncluded')}</p>
              )}
            </div>
            {qrImage && <img src={qrImage} alt="QR Code" className="mx-auto rounded-lg" />}
            <p className="text-xs text-white/40">{t('guestList.showQR')}</p>
            <Button className="w-full" onClick={() => navigate('/my-orders')}>
              <Ticket className="h-4 w-4 mr-2" />{t('guestList.viewInOrders')}
            </Button>
          </motion.div>
        </div>
      </CheckoutShell>
    );
  }

  return (
    <CheckoutShell title={displayTitle} onBack={backToSelection}>
      <PublicPage variant="flow">
      <div className="max-w-lg mx-auto px-4 pt-4 pb-36">
        <CheckoutSteps currentStep={2} />

        {/* Event card */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 border border-white/[0.08] bg-[#141414] p-3 flex items-center gap-3"
          style={{ borderRadius: 10 }}
        >
          {guestList.eventImageUrl && (
            <div className="w-16 h-16 shrink-0 overflow-hidden bg-white/[0.04]" style={{ borderRadius: 6 }}>
              <img
                src={getOptimizedImageUrl(guestList.eventImageUrl, { width: 128, height: 128, quality: 82 })}
                alt={guestList.eventTitle}
                className="w-full h-full object-cover object-center"
              />
            </div>
          )}
          <div className="min-w-0">
            <p className="font-display font-bold uppercase text-white leading-tight" style={{ fontSize: '15px', letterSpacing: '-0.005em' }}>{guestList.eventTitle}</p>
            {guestList.venueName && <p className="text-[11px] text-white/45 mt-0.5">{guestList.venueName}</p>}
            <p className="font-mono uppercase text-[#9A9A9A] flex items-center gap-1.5 mt-1.5" style={{ fontSize: '10px', letterSpacing: '0.04em' }}>
              <Calendar className="h-3 w-3 shrink-0" />
              {formatInTimeZone(new Date(guestList.eventStartAt), PARIS_TIMEZONE, 'EEE d MMM · HH:mm', { locale: dateLocale })}
            </p>
          </div>
        </motion.div>

        {/* Perks */}
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-sm">
            {t('guestList.free')} — 0 €
          </span>
          <span className="text-[11px] font-medium text-white/55 bg-white/[0.04] border border-white/[0.08] px-2.5 py-1 rounded-sm flex items-center gap-1.5">
            <Clock className="h-3 w-3" />{t('guestList.freeBefore')} {guestList.freeBeforeTime}
          </span>
          {guestList.includesDrink && (
            <span className="text-[11px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-sm flex items-center gap-1.5">
              <Wine className="h-3 w-3" />{t('guestList.drinkIncluded')}
            </span>
          )}
        </div>

        {/* Spots */}
        {!isFull && (
          <div className="mt-3 border border-emerald-500/15 p-4 text-center" style={{ backgroundColor: 'rgba(16,185,129,0.06)', borderRadius: 10 }}>
            <p className="text-3xl font-bold text-emerald-400">{remaining}</p>
            <p className="text-sm text-white/45">{t('guestList.spotsLeft')}</p>
            {timeLeft && <p className="text-xs text-white/40 mt-1">⏱ {timeLeft}</p>}
          </div>
        )}

        {/* States */}
        {isFull ? (
          <div className="mt-4 border border-red-500/20 p-5 text-center" style={{ backgroundColor: 'rgba(239,68,68,0.06)', borderRadius: 10 }}>
            <p className="text-lg font-bold text-red-400">{t('guestList.full')}</p>
            <Button className="mt-3" onClick={backToSelection}>
              <Ticket className="h-4 w-4 mr-2" />{t('guestList.buyTicket')}
            </Button>
          </div>
        ) : alreadyRegistered ? (
          <div className="mt-4 border border-emerald-500/25 p-6 text-center space-y-3" style={{ backgroundColor: 'rgba(16,185,129,0.05)', borderRadius: 10 }}>
            <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto">
              <CheckCircle className="h-8 w-8 text-emerald-400" />
            </div>
            <h3 className="text-base font-bold">{t('guestList.alreadyOnList')}</h3>
            <p className="text-sm text-white/45">{t('guestList.alreadyOnListDesc')}</p>
            <Button className="w-full" onClick={() => navigate('/my-orders')}>
              <Ticket className="h-4 w-4 mr-2" />{t('guestList.viewInOrders')}
            </Button>
          </div>
        ) : !user ? (
          /* Guest registration — no account required (mirrors the ticket/table guest flow).
             Account creation becomes an optional upsell after success, not a wall before it. */
          <div className="mt-5 border border-white/[0.08] bg-[#141414] p-4 space-y-4" style={{ borderRadius: 10 }}>
            <div className="space-y-1">
              <p className="text-sm font-medium">{t('guestList.yourDetails')}</p>
              <p className="text-xs text-white/45">{t('guestList.guestSubtitle')}</p>
            </div>

            <button
              type="button"
              onClick={() => navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)}
              className="flex items-center gap-1.5 text-[12px] text-white/55 hover:text-white transition-colors"
            >
              <LogIn className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>{t('guest.haveAccountQuestion')}{' '}
                <span className="text-emerald-400 font-semibold underline underline-offset-2">{t('guest.logIn')}</span>
              </span>
            </button>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="gl-name" className="text-xs text-white/55">{t('guestList.fullName')} *</Label>
                <Input id="gl-name" value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder={t('guestList.namePlaceholder')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gl-email" className="text-xs text-white/55">{t('guestList.email')} *</Label>
                <Input id="gl-email" type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} placeholder={t('guestList.emailPlaceholder')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gl-phone" className="text-xs text-white/55">{t('guestList.phone')} *</Label>
                <PhoneInputWithCountry id="gl-phone" value={guestPhone} onChange={setGuestPhone} />
              </div>
            </div>

            {genderRequired && (
              <div>
                <p className="text-sm font-medium mb-2">{t('guestList.gender')} *</p>
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
              </div>
            )}

            <div className="border-t border-white/[0.08] pt-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-white/70">{displayTitle} — {guestList.eventTitle}</span>
                <span className="font-bold text-emerald-400">0 €</span>
              </div>
              {guestList.includesDrink && (
                <div className="flex justify-between text-sm text-white/45">
                  <span>🍸 {t('guestList.drinkIncluded')}</span>
                  <span>{t('guestList.included')}</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Logged-in confirmation form */
          <div className="mt-5 border border-white/[0.08] bg-[#141414] p-4 space-y-4" style={{ borderRadius: 10 }}>
            <div className="rounded-lg bg-white/[0.04] p-3 space-y-1">
              <p className="text-sm font-medium">{t('guestList.registeredAs')}</p>
              <p className="text-sm text-white/45">{user.email}</p>
            </div>

            {genderRequired && (
              <div>
                <p className="text-sm font-medium mb-2">{t('guestList.gender')} *</p>
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
              </div>
            )}

            <div className="border-t border-white/[0.08] pt-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-white/70">{displayTitle} — {guestList.eventTitle}</span>
                <span className="font-bold text-emerald-400">0 €</span>
              </div>
              {guestList.includesDrink && (
                <div className="flex justify-between text-sm text-white/45">
                  <span>🍸 {t('guestList.drinkIncluded')}</span>
                  <span>{t('guestList.included')}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      </PublicPage>

      {/* Sticky confirm — shown on the registration form (logged-in or guest) */}
      {!isFull && !alreadyRegistered && (
        <StickyCheckoutFooter
          amount={0}
          label={`${displayTitle} · ${t('guestList.free')}`}
          buttonText={t('guestList.confirmRegistration')}
          isLoading={submitting}
          disabled={(genderRequired && !gender) || (!user && (!guestName.trim() || !guestEmail.trim() || !guestPhone.trim()))}
          onClick={handleConfirm}
        />
      )}

      {/* Powered by Yuno — Core plan only */}
      {(venuePlan === 'core' || venuePlan === 'collab') && (
        <div className="pb-6 pt-2 flex items-center justify-center gap-2" style={{ opacity: 0.45 }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#fff', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Powered by</span>
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '10px', fontWeight: 800, color: '#E8192C', letterSpacing: '0.08em', textTransform: 'uppercase' }}>YUNO</span>
        </div>
      )}
    </CheckoutShell>
  );
}

function CheckoutShell({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: '#0A0A0A' }}>
      <header
        className="sticky top-0 z-40"
        style={{ background: 'rgba(10,10,10,0.90)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="flex items-center gap-3 px-4 h-12">
          <button
            onClick={onBack}
            className="h-8 w-8 flex items-center justify-center bg-white/[0.06] hover:bg-white/[0.10] transition-colors"
            style={{ borderRadius: 2 }}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <p className="font-mono uppercase truncate flex-1" style={{ fontSize: '11px', letterSpacing: '0.06em', color: '#9A9A9A' }}>{title}</p>
        </div>
      </header>
      {children}
    </div>
  );
}
