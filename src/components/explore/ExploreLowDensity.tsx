import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Armchair, ArrowRight, Bell, Building2, Check, ChevronRight, Heart, Martini, Ticket, Users, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useFavorites } from '@/hooks/useFavorites';
import { eventTargetPath } from '@/lib/eventNavigation';
import { eventPriceLabel } from '@/lib/eventPriceLabel';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { FadeInView } from '@/components/motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { DensityEvent, DensityVenue, ZoneDensity } from '@/hooks/useZoneDensity';

/* ============================================================
   Explore faible densité — les trois écrans du design
   « Explore Paris - faible densite » (claude.design), branchés
   sur les vraies données de zone (useZoneDensity) :

     'single' -> ExploreSingleNight  (1 soirée : la faire découvrir)
     'empty'  -> ExploreEmptyMarket  (0 soirée : capter la demande)
     'low'    -> ExploreFewDates     (2+ soirées, semaine creuse)

   Esthétique : DESIGN_SYSTEM_PUBLIC.md (Space Grotesk uppercase,
   metadata JetBrains Mono, hex durs, radius tranchant, rouge unique).
   ============================================================ */

const dfLocale = (lang: string) => (lang === 'fr' ? fr : lang === 'es' ? es : enUS);

/** Libellé relatif d'une date proche (badge des grandes cartes). */
function relativeBadge(startAt: string, language: string, t: (k: string) => string): string {
  const locale = dfLocale(language);
  const start = new Date(startAt);
  const now = new Date();
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const diffDays = Math.round((startDay - day0) / 86400000);
  if (diffDays <= 0) return t('explore.ld.tonight');
  if (diffDays === 1) return t('explore.tomorrow');
  if (diffDays < 7) return t('explore.ld.thisDay').replace('{day}', format(start, 'EEE', { locale }));
  return format(start, 'EEE d MMM', { locale });
}

/** Types d'offres d'une soirée, dans l'ordre de lecture du design. */
function offerParts(e: DensityEvent, t: (k: string) => string): string[] {
  const parts: string[] = [];
  if (e.hasGuestList) parts.push(t('explore.ld.guestList'));
  if (e.hasTickets) parts.push(t('explore.ld.tickets'));
  if (e.hasTables || e.tablesOnly) parts.push(t('explore.ld.tables'));
  return parts;
}

function alertFlagKey(city: string) {
  return `yuno_market_alert:${city.trim().toLowerCase()}`;
}
function hasAlertFlag(city: string): boolean {
  try { return localStorage.getItem(alertFlagKey(city)) === '1'; } catch { return false; }
}
function setAlertFlag(city: string) {
  try { localStorage.setItem(alertFlagKey(city), '1'); } catch { /* stockage indisponible : l'inscription serveur a eu lieu */ }
}

/* ── Bandeau marché (sous le header, remplace la rangée de chips) ── */

export function MarketTicker({ density, city }: { density: ZoneDensity; city: string }) {
  const { t, language } = useLanguage();
  const locale = dfLocale(language);

  let right = '';
  if (density.status === 'single') {
    right = `1 ${t('explore.ld.date')} · ${format(new Date(density.upcoming[0].startAt), 'EEE dd.MM', { locale })}`;
  } else if (density.status === 'empty') {
    right = t('explore.ld.openDates0');
  } else {
    const hostsUnit = density.venues.some(v => v.isOrganizer)
      ? t('explore.ld.hostsShort')
      : t('explore.ld.clubs');
    right = `${density.upcoming.length} ${t('explore.ld.dates')} · ${density.offersCount} ${t('explore.ld.offers')} · ${density.clubsCount} ${hostsUnit}`;
  }
  const live = density.status !== 'empty';

  return (
    <div
      className="flex items-center gap-3.5 overflow-hidden whitespace-nowrap"
      style={{ padding: '9px 20px', background: '#0E0E10', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
    >
      <span
        className="flex items-center gap-1.5 font-mono font-bold uppercase shrink-0"
        style={{ fontSize: '9.5px', letterSpacing: '0.14em', color: live ? '#E8192C' : '#5A5A5E' }}
      >
        {live && <span className="dot-live" style={{ width: 6, height: 6 }} />}
        {t('explore.ld.market')} {city}
      </span>
      <span className="font-mono uppercase truncate" style={{ fontSize: '9.5px', letterSpacing: '0.12em', color: '#9A9A9A' }}>
        {right}
      </span>
    </div>
  );
}

/* ── Rangée des trois piliers ── */

function PillarStrip() {
  const { t } = useLanguage();
  const items = [
    { icon: Ticket, label: t('explore.ld.tickets') },
    { icon: Armchair, label: t('explore.ld.vipTables') },
    { icon: Martini, label: t('explore.ld.drinks') },
  ];
  return (
    <div
      className="grid items-center"
      style={{
        gridTemplateColumns: 'repeat(3,1fr)',
        margin: '20px 20px 0',
        padding: '11px 14px',
        background: '#0E0E10',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
      }}
    >
      {items.map(({ icon: Icon, label }) => (
        <span
          key={label}
          className="flex items-center justify-center gap-1.5 font-mono uppercase"
          style={{ fontSize: '9.5px', letterSpacing: '0.06em', color: '#9A9A9A' }}
        >
          <Icon className="h-3 w-3 shrink-0" style={{ color: '#E8192C' }} />
          {label}
        </span>
      ))}
    </div>
  );
}

/* ── Dialogue d'alerte marché (launch_waitlist) ── */

function MarketAlertDialog({
  open,
  onOpenChange,
  city,
  onRegistered,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  city: string;
  onRegistered: () => void;
}) {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase.auth.getUser().then(({ data }) => {
      const userEmail = data.user?.email;
      if (userEmail) setEmail(prev => prev || userEmail);
    });
  }, [open]);

  const submit = async () => {
    const clean = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(clean)) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('launch_waitlist').insert([{ email: clean, city: city.trim() }]);
      if (error) {
        if (error.code === '23505') {
          // Déjà inscrit (unicité sur l'email) : c'est un succès du point de vue utilisateur.
          setAlertFlag(city);
          onRegistered();
          toast.info(t('explore.ld.dlgAlready'));
          onOpenChange(false);
        } else {
          toast.error(t('common.error'));
        }
      } else {
        setAlertFlag(city);
        onRegistered();
        toast.success(t('explore.ld.dlgDone').replace('{city}', city));
        onOpenChange(false);
      }
    } catch {
      toast.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold uppercase tracking-wider">
            {t('explore.ld.dlgTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm" style={{ color: '#9A9A9A' }}>
            {t('explore.ld.dlgBody').replace('{city}', city)}
          </p>
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder={t('explore.ld.dlgEmail')}
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            className="text-sm bg-background/90 border-border/50 focus:border-primary"
          />
          <button
            onClick={submit}
            disabled={loading || !/^\S+@\S+\.\S+$/.test(email.trim())}
            className="w-full font-semibold disabled:opacity-50"
            style={{
              height: 44,
              borderRadius: 999,
              background: '#E8192C',
              color: '#fff',
              fontSize: 14,
              border: 'none',
              boxShadow: '0 10px 28px rgba(232,25,44,.32)',
            }}
          >
            {t('explore.ld.dlgSubmit')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Formulaire de contact pro (« Tu fais la nuit ici ? ») ──
   /pro exige un compte : un gérant de club qui découvre Yuno depuis une ville
   vide n'en a pas. On capte le lead ici (table pro_contact_leads, alerte
   super admin émise côté base) — zéro compte, zéro friction. */

function ProLeadDialog({
  open,
  onOpenChange,
  city,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  city: string;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [club, setClub] = useState('');
  const [leadCity, setLeadCity] = useState(city);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { setLeadCity(prev => prev || city); }, [city]);
  useEffect(() => {
    if (!open) return;
    supabase.auth.getUser().then(({ data }) => {
      const userEmail = data.user?.email;
      if (userEmail) setEmail(prev => prev || userEmail);
    });
  }, [open]);

  const valid = name.trim().length > 0 && /^\S+@\S+\.\S+$/.test(email.trim());

  const submit = async () => {
    if (!valid) return;
    setLoading(true);
    try {
      // Pas de .select() : la lecture de la table est réservée au super admin,
      // un RETURNING ferait échouer l'insert anon sous RLS.
      const { error } = await supabase.from('pro_contact_leads').insert([{
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || null,
        club_name: club.trim() || null,
        city: leadCity.trim() || null,
        message: message.trim() || null,
        source: 'explore',
      }]);
      if (error) {
        toast.error(t('common.error'));
      } else {
        toast.success(t('explore.ld.proDone'));
        onOpenChange(false);
      }
    } catch {
      toast.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold uppercase tracking-wider">
            {t('explore.ld.proTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm" style={{ color: '#9A9A9A' }}>
            {t('explore.ld.proBody')}
          </p>
          <Input
            placeholder={t('explore.ld.proName')}
            value={name}
            onChange={e => setName(e.target.value)}
            className="text-sm bg-background/90 border-border/50 focus:border-primary"
          />
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder={t('explore.ld.dlgEmail')}
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="text-sm bg-background/90 border-border/50 focus:border-primary"
          />
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={t('explore.ld.proPhone')}
            value={phone}
            onChange={e => setPhone(e.target.value)}
            className="text-sm bg-background/90 border-border/50 focus:border-primary"
          />
          <div className="flex gap-2">
            <Input
              placeholder={t('explore.ld.proClub')}
              value={club}
              onChange={e => setClub(e.target.value)}
              className="flex-1 text-sm bg-background/90 border-border/50 focus:border-primary"
            />
            <Input
              placeholder={t('explore.ld.proCity')}
              value={leadCity}
              onChange={e => setLeadCity(e.target.value)}
              className="w-28 text-sm bg-background/90 border-border/50 focus:border-primary"
            />
          </div>
          <textarea
            placeholder={t('explore.ld.proMessage')}
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={3}
            maxLength={2000}
            className="w-full rounded-md border px-3 py-2 text-sm bg-background/90 border-border/50 focus:border-primary focus:outline-none resize-none"
          />
          <button
            onClick={submit}
            disabled={loading || !valid}
            className="w-full font-semibold disabled:opacity-50"
            style={{
              height: 44,
              borderRadius: 999,
              background: '#E8192C',
              color: '#fff',
              fontSize: 14,
              border: 'none',
              boxShadow: '0 10px 28px rgba(232,25,44,.32)',
            }}
          >
            {t('explore.ld.proSubmit')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Grande carte 1:1 de la soirée mise en avant ── */

function FeaturedNightCard({ event, variant }: { event: DensityEvent; variant: 'single' | 'low' }) {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { isFavorite, toggleFavorite } = useFavorites();
  const locale = dfLocale(language);
  const favType = event.isAffiliate ? 'affiliate_event' : 'event';
  const liked = isFavorite(favType, event.id);

  const poster = event.posterUrl
    ? getOptimizedImageUrl(event.posterUrl, { width: 800, height: 800, quality: 80, resize: 'cover' })
    : null;
  const badge = event.isLive ? t('explore.ld.liveNow') : relativeBadge(event.startAt, language, t);
  const priceLabel = eventPriceLabel(event, t);
  const offers = offerParts(event, t).join(' · ');

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={event.title}
      onClick={() => navigate(eventTargetPath(event))}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(eventTargetPath(event)); } }}
      className="relative overflow-hidden cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      style={{
        margin: variant === 'single' ? '12px 20px 0' : '16px 20px 0',
        borderRadius: 20,
        aspectRatio: '1/1',
        background: 'linear-gradient(160deg,#1a0f12 0%,#3a1020 62%,#0f0f12 100%)',
      }}
    >
      {poster && (
        <img src={poster} alt={event.title} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
      )}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(to top, rgba(6,6,8,0.96) 10%, rgba(6,6,8,0.25) 55%, transparent 82%)' }}
      />

      {/* Badge date relative */}
      <div
        className="absolute font-mono font-bold uppercase"
        style={{ top: 13, left: 13, fontSize: '9px', letterSpacing: '0.14em', color: '#fff', background: '#E8192C', padding: '4px 9px', borderRadius: 3 }}
      >
        {badge}
      </div>

      {/* Rareté (3c) ou favori (3a) en haut à droite */}
      {variant === 'low' && event.percentSold > 20 && event.percentSold < 100 ? (
        <div className="absolute flex items-center gap-1" style={{ top: 13, right: 13 }}>
          <Zap className="h-3 w-3 text-amber-400" />
          <span className="font-mono font-bold text-amber-400" style={{ fontSize: '9.5px', letterSpacing: '0.08em' }}>
            {Math.round(event.percentSold)}%
          </span>
        </div>
      ) : (
        <button
          onClick={e => { e.stopPropagation(); toggleFavorite(favType, event.id); }}
          className="absolute flex items-center justify-center rounded-full"
          style={{ top: 11, right: 11, width: 32, height: 32, background: 'rgba(10,10,12,0.55)', border: '1px solid rgba(255,255,255,0.14)', backdropFilter: 'blur(8px)' }}
          aria-label={liked ? t('explore.removeFav') : t('explore.addFav')}
        >
          <Heart className={cn('h-[15px] w-[15px] transition-all', liked ? 'fill-primary text-primary' : 'text-white/70')} />
        </button>
      )}

      <div className="absolute" style={{ left: 18, right: 18, bottom: 18 }}>
        {variant === 'single' ? (
          <p className="font-mono uppercase" style={{ fontSize: '9.5px', letterSpacing: '0.12em', color: '#9A9AA4', margin: '0 0 7px' }}>
            {format(new Date(event.startAt), 'EEE dd.MM', { locale })} · {format(new Date(event.startAt), 'HH:mm')} → {format(new Date(event.endAt), 'HH:mm')}
          </p>
        ) : (
          <p className="font-mono uppercase truncate" style={{ fontSize: '9.5px', letterSpacing: '0.12em', color: '#9A9AA4', margin: '0 0 6px' }}>
            {event.venueName}{event.venueName ? ' · ' : ''}{format(new Date(event.startAt), 'HH:mm')}{event.genres[0] ? ` · ${event.genres[0]}` : ''}
          </p>
        )}
        <h2
          className="font-display font-bold uppercase"
          style={{
            fontSize: variant === 'single' ? 'clamp(26px, 8vw, 34px)' : 'clamp(22px, 7vw, 28px)',
            lineHeight: 0.94,
            letterSpacing: '-0.03em',
            color: '#fff',
            margin: variant === 'single' ? '0 0 10px' : '0 0 11px',
          }}
        >
          {event.title}
        </h2>
        {variant === 'single' ? (
          <div className="flex items-center gap-2 flex-wrap">
            {event.venueName && (
              <span className="flex items-center gap-1.5 font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.06em', color: '#E5E5E5', padding: '5px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>
                {event.isOrganizerLed
                  ? <Users className="h-[11px] w-[11px]" style={{ color: '#9A9A9A' }} />
                  : <Building2 className="h-[11px] w-[11px]" style={{ color: '#9A9A9A' }} />}
                {event.venueName}
              </span>
            )}
            {event.genres[0] && (
              <span className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.06em', color: '#E5E5E5', padding: '5px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>
                {event.genres[0]}
              </span>
            )}
            {event.venueCity && (
              <span className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.06em', color: '#E5E5E5', padding: '5px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>
                {event.venueCity}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {priceLabel && (
              <span className="flex items-center justify-center font-mono font-bold uppercase" style={{ height: 34, padding: '0 15px', borderRadius: 999, background: '#E8192C', color: '#fff', fontSize: '11px', letterSpacing: '0.06em' }}>
                {priceLabel}
              </span>
            )}
            {/* La pastille « Tables uniquement » dit déjà tout : pas de rappel d'offres. */}
            {offers && !event.tablesOnly && (
              <span className="font-mono uppercase truncate" style={{ fontSize: '10px', letterSpacing: '0.06em', color: '#9A9AA4' }}>
                {offers}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tuile info du bloc « La soirée en clair » ── */

function InfoTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex flex-col gap-[5px]" style={{ padding: '13px 14px', background: '#0E0E10', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14 }}>
      <p className="font-mono font-semibold uppercase" style={{ fontSize: '9px', letterSpacing: '0.14em', color: '#65656F', margin: 0 }}>{label}</p>
      <p className="font-display font-bold" style={{ fontSize: 16, lineHeight: 1.05, color: '#fff', margin: 0, letterSpacing: '-0.01em' }}>{value}</p>
      <p className="font-mono" style={{ fontSize: '9.5px', letterSpacing: '0.05em', color: '#65656F', margin: 0 }}>{sub}</p>
    </div>
  );
}

function SectionKicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono uppercase" style={{ fontSize: '10.5px', letterSpacing: '0.14em', color: '#65656F', margin: '0 0 11px' }}>
      {children}
    </p>
  );
}

/* ══════════════════════════════════════════════════
   3a — UNE SEULE SOIRÉE DANS LA ZONE
   ══════════════════════════════════════════════════ */

export function ExploreSingleNight({
  event,
  venue,
  city,
  onOpenCityPicker,
}: {
  event: DensityEvent;
  venue: DensityVenue | null;
  city: string;
  onOpenCityPicker: () => void;
}) {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const locale = dfLocale(language);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertSet, setAlertSet] = useState(() => hasAlertFlag(city));
  useEffect(() => { setAlertSet(hasAlertFlag(city)); }, [city]);

  const start = new Date(event.startAt);
  const weekday = format(start, 'EEEE', { locale });
  const offers = offerParts(event, t);
  const priceLabel = eventPriceLabel(event, t);
  const soldOut = event.percentSold >= 100;

  const entriesValue = event.tablesOnly
    ? t('explore.tablesOnly')
    : offers[0] || t('explore.ld.onSpot');
  // Guest list seule = entrée gratuite : on l'écrit, on ne laisse pas un tiret.
  const entriesSub =
    [offers.slice(1).join(' + '), priceLabel].filter(Boolean).join(' · ')
    || (event.hasGuestList && !event.tablesOnly ? t('explore.free') : '—');

  // « En vente » seulement quand il y a des billets ; une guest list ouverte
  // ne vend rien, elle est « ouverte ».
  const statusValue = soldOut
    ? t('explore.ld.soldOut')
    : event.isLive
      ? t('explore.ld.liveNow')
      : event.hasTickets || event.tablesOnly || event.hasTables
        ? t('explore.ld.onSale')
        : t('explore.ld.open');
  const statusSub = soldOut ? t('explore.ld.comeBack') : t('explore.ld.openToAll');

  // Le lieu physique : club Yuno (cliquable), sinon le lieu saisi sur l'event.
  const placeName = venue && !venue.isOrganizer ? venue.name : event.locationName;
  const placeClickable = !!venue && !venue.isOrganizer;
  // Le lieu porte son logo qu'il soit cliquable ou non : un club Yuno le tient
  // de `venues`, un lieu en texte libre de la soirée elle-même. Sans logo,
  // une icône — jamais un cadre vide.
  const placeLogoUrl = (venue && !venue.isOrganizer ? venue.logoUrl || venue.coverUrl : null) || event.locationLogoUrl;
  const showPlace = !!placeName || !!event.venueAddress;

  // L'organisateur (soirées org-led) : sa propre carte, cliquable si profil public.
  const showOrganizer = !!event.isOrganizerLed && !!event.organizerName;
  const organizerClickable = !!event.organizerIsPublic && !!event.organizerSlug;

  const goVenue = () => {
    if (!placeClickable || !venue) return;
    if (venue.isAffiliate) {
      if (venue.slug) navigate(`/affiliate-venue/${venue.slug}`);
    } else {
      navigate(`/club/${venue.id}`);
    }
  };

  const goOrganizer = () => {
    if (organizerClickable) navigate(`/o/${event.organizerSlug}`);
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', width: '100%' }}>
      {/* La seule date : une info, pas une navigation */}
      <FadeInView>
        <div className="flex items-center justify-between" style={{ padding: '18px 20px 0' }}>
          <p className="font-mono font-semibold uppercase" style={{ fontSize: '10px', letterSpacing: '0.16em', color: '#65656F', margin: 0 }}>
            {t('explore.ld.onlyDateIn')} {city}
          </p>
          <span className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.08em', color: '#65656F' }}>
            {format(start, 'MMM', { locale })}
          </span>
        </div>

        <FeaturedNightCard event={event} variant="single" />
      </FadeInView>

      {/* Uniquement ce que le club renseigne à la création de l'event */}
      <FadeInView style={{ padding: '22px 20px 0' }}>
        <SectionKicker>{t('explore.ld.nightInClear')}</SectionKicker>
        <div className="grid gap-[9px]" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <InfoTile
            label={t('explore.ld.when')}
            value={`${format(start, 'HH:mm')} → ${format(new Date(event.endAt), 'HH:mm')}`}
            sub={format(start, 'EEE d MMM', { locale })}
          />
          <InfoTile
            label={t('explore.ld.music')}
            value={event.genres[0] || '—'}
            sub={event.genres.length > 1 ? event.genres.slice(1, 3).join(' · ') : t('explore.ld.genreAnnounced')}
          />
          <InfoTile label={t('explore.ld.entries')} value={entriesValue} sub={entriesSub} />
          <InfoTile label={t('explore.ld.status')} value={statusValue} sub={statusSub} />
        </div>
      </FadeInView>

      {/* L'organisateur — les soirées org-led ont leur propre maison */}
      {showOrganizer && (
        <FadeInView style={{ padding: '22px 20px 0' }}>
          <SectionKicker>{t('explore.ld.organizer')}</SectionKicker>
          <div
            role={organizerClickable ? 'button' : undefined}
            tabIndex={organizerClickable ? 0 : undefined}
            onClick={goOrganizer}
            onKeyDown={e => { if (organizerClickable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); goOrganizer(); } }}
            className={cn('flex items-center gap-3', organizerClickable && 'cursor-pointer')}
            style={{ padding: '13px 14px', background: '#0E0E10', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16 }}
          >
            <div className="relative flex items-center justify-center shrink-0 overflow-hidden" style={{ width: 52, height: 52, borderRadius: 999, background: 'linear-gradient(145deg,#3a1020,#12070c)' }}>
              {event.organizerAvatarUrl ? (
                <img
                  src={getOptimizedImageUrl(event.organizerAvatarUrl, { width: 104, height: 104, quality: 75, resize: 'cover' })}
                  alt={event.organizerName || ''}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <Users className="h-5 w-5" style={{ color: '#9A9A9A' }} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-display font-bold truncate" style={{ fontSize: 16, lineHeight: 1.1, color: '#fff', margin: '0 0 4px' }}>
                {event.organizerName}
              </p>
              <p className="font-mono truncate uppercase" style={{ fontSize: '10px', lineHeight: 1.4, color: '#65656F', margin: 0, letterSpacing: '0.04em' }}>
                {t('explore.ld.organizerRole')}
              </p>
            </div>
            {organizerClickable && <ChevronRight className="h-4 w-4 shrink-0" style={{ color: '#5A5A5E' }} />}
          </div>
        </FadeInView>
      )}

      {/* Le lieu, deuxième porte d'entrée quand il n'y a qu'une date */}
      {showPlace && (
        <FadeInView style={{ padding: '22px 20px 0' }}>
          <SectionKicker>{t('explore.ld.venue')}</SectionKicker>
          <div
            role={placeClickable ? 'button' : undefined}
            tabIndex={placeClickable ? 0 : undefined}
            onClick={goVenue}
            onKeyDown={e => { if (placeClickable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); goVenue(); } }}
            className={cn('flex items-center gap-3', placeClickable && 'cursor-pointer')}
            style={{ padding: '13px 14px', background: '#0E0E10', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16 }}
          >
            <div className="relative flex items-center justify-center shrink-0 overflow-hidden" style={{ width: 52, height: 52, borderRadius: 12, background: 'linear-gradient(145deg,#3b1158,#0f0712)' }}>
              {placeLogoUrl ? (
                <img
                  src={getOptimizedImageUrl(placeLogoUrl, { width: 104, height: 104, quality: 75, resize: 'cover' })}
                  alt={placeName || ''}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <Building2 className="h-5 w-5" style={{ color: '#9A9A9A' }} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-display font-bold truncate" style={{ fontSize: 16, lineHeight: 1.1, color: '#fff', margin: '0 0 4px' }}>
                {placeName || event.venueAddress}
              </p>
              <p className="font-mono truncate" style={{ fontSize: '10px', lineHeight: 1.4, color: '#65656F', margin: 0, letterSpacing: '0.04em' }}>
                {placeName
                  ? [event.venueAddress, event.venueCity].filter(Boolean).join(' · ')
                  : event.venueCity}
              </p>
            </div>
            {placeClickable && <ChevronRight className="h-4 w-4 shrink-0" style={{ color: '#5A5A5E' }} />}
          </div>
        </FadeInView>
      )}

      {/* Une seule date : la suite de la découverte est ailleurs */}
      <FadeInView style={{ padding: '22px 20px 0' }}>
        <SectionKicker>{t('explore.ld.notYourNight').replace('{day}', weekday)}</SectionKicker>
        <div className="flex flex-col gap-[9px]" style={{ padding: '15px 16px 16px', background: '#0E0E10', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 16 }}>
          <p className="font-display font-bold" style={{ fontSize: 17, lineHeight: 1.15, color: '#fff', margin: 0 }}>
            {t('explore.ld.alertTitle')}
          </p>
          <p className="font-mono" style={{ fontSize: '10.5px', lineHeight: 1.55, color: '#65656F', margin: 0 }}>
            {t('explore.ld.alertBody').replace('{city}', city)}
          </p>
          <div className="flex gap-2" style={{ marginTop: 3 }}>
            <button
              onClick={() => setAlertOpen(true)}
              className="flex flex-1 items-center justify-center gap-[7px] font-mono font-bold"
              style={{ height: 42, borderRadius: 12, background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.30)', fontSize: '11.5px', letterSpacing: '0.04em', color: '#E8192C' }}
            >
              {alertSet ? <Check className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
              {alertSet ? t('explore.ld.alertSet') : t('explore.ld.alertCta')}
            </button>
            <button
              onClick={onOpenCityPicker}
              className="flex flex-1 items-center justify-center gap-[7px] font-mono font-semibold"
              style={{ height: 42, borderRadius: 12, background: '#141417', border: '1px solid rgba(255,255,255,0.12)', fontSize: '11.5px', letterSpacing: '0.04em', color: '#E5E5E5' }}
            >
              {t('explore.ld.elsewhere')}
            </button>
          </div>
        </div>
      </FadeInView>

      <PillarStrip />

      {/* Un seul objet à découvrir : le CTA ouvre la fiche, il ne réserve rien */}
      <FadeInView style={{ padding: '14px 20px 0' }}>
        <button
          onClick={() => navigate(eventTargetPath(event))}
          className="flex w-full items-center justify-center gap-2 font-mono font-bold"
          style={{ height: 48, borderRadius: 14, background: '#E8192C', color: '#fff', fontSize: 13, letterSpacing: '0.03em', border: 'none', boxShadow: '0 10px 28px rgba(232,25,44,.32)' }}
        >
          {t('explore.ld.discoverNight')}
          <ArrowRight className="h-[15px] w-[15px]" />
        </button>
      </FadeInView>

      <MarketAlertDialog open={alertOpen} onOpenChange={setAlertOpen} city={city} onRegistered={() => setAlertSet(true)} />
    </div>
  );
}

/* ══════════════════════════════════════════════════
   3b — AUCUNE SOIRÉE DANS LA ZONE
   ══════════════════════════════════════════════════ */

export function ExploreEmptyMarket({
  city,
  elsewhere,
  elsewhereCityCount,
}: {
  city: string;
  elsewhere: DensityEvent[];
  elsewhereCityCount: number;
}) {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const locale = dfLocale(language);
  const [alertOpen, setAlertOpen] = useState(false);
  const [proOpen, setProOpen] = useState(false);
  const [alertSet, setAlertSet] = useState(() => hasAlertFlag(city));
  useEffect(() => { setAlertSet(hasAlertFlag(city)); }, [city]);

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', width: '100%' }}>
      {/* État vide qui vend le marché, pas le vide */}
      <FadeInView style={{ padding: '26px 20px 0' }}>
        <div style={{ padding: '22px 18px', border: '1px solid rgba(232,25,44,0.28)', background: 'rgba(232,25,44,0.04)', borderRadius: 4 }}>
          <p className="font-mono font-semibold uppercase" style={{ fontSize: '9px', letterSpacing: '0.14em', color: '#E8192C', margin: '0 0 10px' }}>
            {t('explore.ld.nothingOnSaleIn')} {city}
          </p>
          <p className="font-display font-bold uppercase" style={{ fontSize: 'clamp(24px, 7.5vw, 29px)', lineHeight: 0.98, letterSpacing: '-0.025em', color: '#fff', margin: '0 0 10px' }}>
            {t('explore.ld.openMarket')}
          </p>
          <p style={{ fontSize: 13, lineHeight: 1.5, color: '#E5E5E5', margin: '0 0 16px' }}>
            {t('explore.ld.demandBody').replace('{city}', city)}
          </p>
          <button
            onClick={() => setAlertOpen(true)}
            className="flex w-full items-center justify-center gap-2 font-semibold"
            style={{ height: 44, borderRadius: 999, background: '#E8192C', color: '#fff', fontSize: 14, border: 'none', boxShadow: '0 10px 28px rgba(232,25,44,.32)' }}
          >
            {alertSet && <Check className="h-4 w-4" />}
            {alertSet ? t('explore.ld.alertSet') : t('explore.ld.notifyCta')}
          </button>
        </div>
      </FadeInView>

      {/* Ailleurs sur Yuno : autorisé uniquement à 0 soirée */}
      {elsewhere.length > 0 && (
        <FadeInView style={{ padding: '28px 0 0' }}>
          <div className="flex items-end justify-between" style={{ padding: '0 20px', marginBottom: 14 }}>
            <div>
              <p className="font-mono uppercase" style={{ fontSize: '10.5px', letterSpacing: '0.14em', color: '#65656F', margin: '0 0 6px' }}>
                {t('explore.ld.elsewhere')}
              </p>
              <h2 className="font-display font-bold" style={{ fontSize: 21, color: '#fff', letterSpacing: '-0.01em', lineHeight: 1.1, margin: 0 }}>
                {t('explore.ld.upcomingNights')}
              </h2>
            </div>
            <span className="font-mono uppercase" style={{ fontSize: '11px', color: '#65656F' }}>
              {elsewhereCityCount} {t(elsewhereCityCount > 1 ? 'explore.ld.cities' : 'explore.ld.city')}
            </span>
          </div>
          <div
            className="flex overflow-x-auto items-start"
            style={{ gap: 12, padding: '0 20px 8px', scrollbarWidth: 'none' } as React.CSSProperties}
          >
            {elsewhere.map(e => (
              <div
                key={e.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(eventTargetPath(e))}
                onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); navigate(eventTargetPath(e)); } }}
                className="shrink-0 overflow-hidden cursor-pointer"
                style={{ width: 200, background: '#141417', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20 }}
              >
                <div className="relative" style={{ aspectRatio: '1/1', background: 'linear-gradient(160deg,#1a0f12,#3a1020 70%,#0f0f12)' }}>
                  {e.posterUrl && (
                    <img
                      src={getOptimizedImageUrl(e.posterUrl, { width: 400, height: 400, quality: 75, resize: 'cover' })}
                      alt={e.title}
                      className="absolute inset-0 h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                  {e.venueCity && (
                    <span className="absolute font-mono font-bold uppercase" style={{ top: 10, left: 10, fontSize: '9px', letterSpacing: '0.14em', color: '#E5E5E5', background: 'rgba(10,10,10,0.6)', border: '1px solid rgba(255,255,255,0.2)', padding: '3px 8px', borderRadius: 3, backdropFilter: 'blur(8px)' }}>
                      {e.venueCity}
                    </span>
                  )}
                </div>
                <div style={{ padding: '12px 14px 14px' }}>
                  <p className="font-mono uppercase truncate" style={{ fontSize: '10px', letterSpacing: '0.05em', color: '#65656F', margin: '0 0 4px' }}>
                    {e.venueName}{e.venueName ? ' · ' : ''}{format(new Date(e.startAt), 'dd.MM')}
                  </p>
                  <p className="font-display font-bold uppercase line-clamp-2" style={{ fontSize: 17, lineHeight: 1.05, color: '#fff', margin: '0 0 10px' }}>
                    {e.title}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="font-mono" style={{ fontSize: '10.5px', color: '#9A9A9A', letterSpacing: '0.04em' }}>
                      {format(new Date(e.startAt), 'HH:mm')}
                    </span>
                    <span className="font-mono font-bold" style={{ fontSize: 13, color: '#E8192C' }}>
                      {eventPriceLabel(e, t) || (e.hasGuestList ? t('explore.ld.guestList') : '')}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </FadeInView>
      )}

      {/* Tu fais la nuit ici ? — formulaire de contact, pas /pro (qui exige un compte) */}
      <FadeInView style={{ padding: '26px 20px 0' }}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setProOpen(true)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setProOpen(true); } }}
          className="flex items-center justify-between gap-3 cursor-pointer"
          style={{ padding: '16px 18px', background: '#141414', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4 }}
        >
          <div>
            <p className="font-mono font-semibold uppercase" style={{ fontSize: '9px', letterSpacing: '0.14em', color: '#5A5A5E', margin: '0 0 6px' }}>
              {t('explore.ld.doYouRunNight')}
            </p>
            <p className="font-display font-bold uppercase" style={{ fontSize: 18, lineHeight: 1, color: '#fff', margin: 0, letterSpacing: '-0.02em' }}>
              {t('explore.ld.openClub')}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0" style={{ color: '#E8192C' }} />
        </div>
      </FadeInView>

      <MarketAlertDialog open={alertOpen} onOpenChange={setAlertOpen} city={city} onRegistered={() => setAlertSet(true)} />
      <ProLeadDialog open={proOpen} onOpenChange={setProOpen} city={city} />
    </div>
  );
}

/* ══════════════════════════════════════════════════
   3c — QUELQUES DATES : LA SEMAINE À ARBITRER
   ══════════════════════════════════════════════════ */

type FewDatesChip = 'all' | 'guestlist' | 'tables' | 'cheap';
const CHEAP_MAX_PRICE = 20;

export function ExploreFewDates({ density }: { density: ZoneDensity }) {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const locale = dfLocale(language);
  const [chip, setChip] = useState<FewDatesChip>('all');

  const counts = useMemo(() => ({
    guestlist: density.upcoming.filter(e => e.hasGuestList).length,
    tables: density.upcoming.filter(e => e.hasTables || e.tablesOnly).length,
    cheap: density.upcoming.filter(e => e.minPrice !== null && e.minPrice <= CHEAP_MAX_PRICE && !e.tablesOnly).length,
  }), [density.upcoming]);

  const filtered = useMemo(() => {
    if (chip === 'guestlist') return density.upcoming.filter(e => e.hasGuestList);
    if (chip === 'tables') return density.upcoming.filter(e => e.hasTables || e.tablesOnly);
    if (chip === 'cheap') return density.upcoming.filter(e => e.minPrice !== null && e.minPrice <= CHEAP_MAX_PRICE && !e.tablesOnly);
    return density.upcoming;
  }, [density.upcoming, chip]);

  const featured = filtered[0];
  const rest = filtered.slice(1, 11);

  const chips: Array<{ key: FewDatesChip; label: string; count?: number }> = [
    { key: 'all', label: t('explore.ld.all') },
    ...(counts.guestlist > 0 ? [{ key: 'guestlist' as const, label: t('explore.ld.guestList'), count: counts.guestlist }] : []),
    ...(counts.tables > 0 ? [{ key: 'tables' as const, label: t('explore.ld.tables'), count: counts.tables }] : []),
    ...(counts.cheap > 0 ? [{ key: 'cheap' as const, label: `-${CHEAP_MAX_PRICE}€` }] : []),
  ];

  const goVenue = (v: DensityVenue) => {
    if (v.isOrganizer) {
      if (v.slug) navigate(`/o/${v.slug}`);
    } else if (v.isAffiliate) {
      if (v.slug) navigate(`/affiliate-venue/${v.slug}`);
    } else {
      navigate(`/club/${v.id}`);
    }
  };

  // Des orgas dans le rail ? Les titres suivent (« clubs & orgas »).
  const hasOrgGroups = density.venues.some(v => v.isOrganizer);

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', width: '100%' }}>
      {/* Filtres d'offre — seulement ceux qui ont de la matière */}
      {chips.length > 1 && (
        <div className="flex gap-2 overflow-x-auto" style={{ padding: '13px 20px 0', scrollbarWidth: 'none' } as React.CSSProperties}>
          {chips.map(c => {
            const active = chip === c.key;
            return (
              <button
                key={c.key}
                onClick={() => setChip(active && c.key !== 'all' ? 'all' : c.key)}
                className="font-mono font-semibold whitespace-nowrap shrink-0"
                style={{
                  fontSize: '12.5px',
                  padding: '8px 13px',
                  borderRadius: 10,
                  lineHeight: 1,
                  border: `1px solid ${active ? '#E8192C' : 'rgba(255,255,255,0.14)'}`,
                  background: active ? '#E8192C' : '#141417',
                  color: active ? '#fff' : '#9A9AA4',
                }}
              >
                {c.label}
                {c.count !== undefined && (
                  <span style={{ color: active ? 'rgba(255,255,255,0.7)' : '#5A5A5E' }}> {c.count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* La date la plus proche, en grand */}
      {featured && (
        <FadeInView>
          <FeaturedNightCard event={featured} variant="low" />
        </FadeInView>
      )}

      {/* Les autres dates de la zone */}
      {rest.length > 0 && (
        <FadeInView style={{ paddingTop: 22 }}>
          <div className="flex items-end justify-between" style={{ padding: '0 20px', marginBottom: 11 }}>
            <div>
              <p className="font-mono uppercase" style={{ fontSize: '10.5px', letterSpacing: '0.14em', color: '#65656F', margin: '0 0 6px' }}>
                {t('explore.ld.otherDates').replace('{n}', String(rest.length))}
              </p>
              <h2 className="font-display font-bold" style={{ fontSize: 21, color: '#fff', letterSpacing: '-0.01em', lineHeight: 1.1, margin: 0 }}>
                {t('explore.ld.restOfMonth')}
              </h2>
            </div>
            <button
              onClick={() => navigate('/events')}
              className="flex items-center gap-0.5 font-mono font-semibold"
              style={{ fontSize: '11.5px', color: '#E8192C', background: 'none', border: 'none', padding: 0 }}
            >
              {t('explore.ld.agenda')}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex overflow-x-auto items-start" style={{ gap: 10, padding: '0 20px 8px', scrollbarWidth: 'none' } as React.CSSProperties}>
            {rest.map(e => (
              <div
                key={e.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(eventTargetPath(e))}
                onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); navigate(eventTargetPath(e)); } }}
                className="shrink-0 overflow-hidden cursor-pointer"
                style={{ width: 172, background: '#141417', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16 }}
              >
                <div className="relative" style={{ aspectRatio: '1/1', background: 'linear-gradient(145deg,#0d3545,#060f14)' }}>
                  {e.posterUrl && (
                    <img
                      src={getOptimizedImageUrl(e.posterUrl, { width: 400, height: 400, quality: 75, resize: 'cover' })}
                      alt={e.title}
                      className="absolute inset-0 h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                  <span className="absolute font-mono font-bold uppercase" style={{ top: 9, left: 9, fontSize: '9px', letterSpacing: '0.12em', color: '#fff', background: 'rgba(10,10,10,0.72)', border: '1px solid rgba(255,255,255,0.14)', padding: '3px 7px', borderRadius: 3, backdropFilter: 'blur(8px)' }}>
                    {format(new Date(e.startAt), 'EEE d', { locale })}
                  </span>
                </div>
                <div style={{ padding: '11px 13px 13px' }}>
                  <p className="font-mono uppercase truncate" style={{ fontSize: '9.5px', letterSpacing: '0.06em', color: '#65656F', margin: '0 0 4px' }}>
                    {e.venueName || e.venueCity}
                  </p>
                  <p className="font-display font-bold truncate" style={{ fontSize: 15, lineHeight: 1.05, color: '#fff', margin: '0 0 4px' }}>
                    {e.title}
                  </p>
                  <p className="font-mono" style={{ fontSize: '10px', color: '#65656F', margin: '0 0 10px', letterSpacing: '0.04em' }}>
                    {format(new Date(e.startAt), 'HH:mm')}{e.genres[0] ? ` · ${e.genres[0]}` : ''}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.08em', color: '#9A9AA4' }}>
                      {offerParts(e, t).length > 0
                        ? `${offerParts(e, t).length} ${t(offerParts(e, t).length > 1 ? 'explore.ld.offers' : 'explore.ld.offer')}`
                        : ''}
                    </span>
                    <span className="font-mono font-bold" style={{ fontSize: '12.5px', color: '#E8192C' }}>
                      {e.tablesOnly
                        ? t('explore.ld.tables').toLowerCase()
                        : eventPriceLabel(e, t) || (e.hasGuestList ? t('explore.ld.guestList') : '')}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </FadeInView>
      )}

      {/* Deuxième axe de lecture : par lieu */}
      {density.venues.length > 0 && (
        <FadeInView style={{ paddingTop: 24 }}>
          <div className="flex items-end justify-between" style={{ padding: '0 20px', marginBottom: 13 }}>
            <div>
              <p className="font-mono uppercase" style={{ fontSize: '10.5px', letterSpacing: '0.14em', color: '#65656F', margin: '0 0 6px' }}>
                {t('explore.ld.otherWay')}
              </p>
              <h2 className="font-display font-bold" style={{ fontSize: 21, color: '#fff', letterSpacing: '-0.01em', lineHeight: 1.1, margin: 0 }}>
                {t(hasOrgGroups ? 'explore.ld.hostsOfZone' : 'explore.ld.clubsOfZone').replace('{n}', String(density.venues.length))}
              </h2>
            </div>
            <span className="font-mono uppercase" style={{ fontSize: '11px', color: '#65656F' }}>
              {density.venues.length} {t(hasOrgGroups ? 'explore.ld.hostsShort' : 'explore.ld.places')}
            </span>
          </div>
          <div className="flex overflow-x-auto items-start" style={{ gap: 10, padding: '0 20px 8px', scrollbarWidth: 'none' } as React.CSSProperties}>
            {density.venues.slice(0, 10).map(v => {
              const soon = new Date(v.nextStartAt).getTime() - Date.now() < 7 * 86400000;
              const priceBit = v.tablesOnly && v.minPrice === null
                ? t('explore.ld.tables').toLowerCase()
                : eventPriceLabel({ minPrice: v.minPrice, tablesOnly: false }, t);
              return (
                <div
                  key={`${v.isAffiliate ? 'aff' : 'v'}:${v.id}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => goVenue(v)}
                  onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); goVenue(v); } }}
                  className="shrink-0 overflow-hidden cursor-pointer"
                  style={{ width: 152, border: `1px solid ${soon ? 'rgba(232,25,44,0.30)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 16 }}
                >
                  <div className="relative" style={{ aspectRatio: '1/1', background: 'linear-gradient(145deg,#3a1020,#12070c)' }}>
                    {v.coverUrl && (
                      <img
                        src={getOptimizedImageUrl(v.coverUrl, { width: 320, height: 320, quality: 75, resize: 'cover' })}
                        alt={v.name}
                        className="absolute inset-0 h-full w-full object-cover"
                        loading="lazy"
                      />
                    )}
                    <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(6,6,8,0.92) 0%, rgba(6,6,8,0.35) 42%, transparent 68%)' }} />
                    <span
                      className="absolute font-mono font-bold uppercase"
                      style={{
                        top: 8, left: 8, fontSize: '8.5px', letterSpacing: '0.14em', color: '#fff',
                        background: soon ? '#E8192C' : 'rgba(10,10,10,0.72)',
                        border: soon ? 'none' : '1px solid rgba(255,255,255,0.14)',
                        padding: '3px 7px', borderRadius: 3,
                      }}
                    >
                      {relativeBadge(v.nextStartAt, language, t)}
                    </span>
                    <div className="absolute" style={{ left: 11, right: 11, bottom: 11 }}>
                      <p className="font-display font-bold truncate" style={{ fontSize: 15, lineHeight: 1.05, color: '#fff', margin: '0 0 3px' }}>
                        {v.name}
                      </p>
                      <p className="font-mono uppercase truncate" style={{ fontSize: '9.5px', letterSpacing: '0.06em', color: '#B4B4BC', margin: 0 }}>
                        {v.dateCount} {v.dateCount > 1 ? t('explore.ld.dates') : t('explore.ld.date')}{priceBit ? ` · ${priceBit}` : ''}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </FadeInView>
      )}

      <PillarStrip />

      {/* Pas de CTA fixe : rien de singulier à réserver */}
      <FadeInView style={{ padding: '14px 20px 0' }}>
        <button
          onClick={() => navigate('/events')}
          className="flex w-full items-center justify-center gap-2 font-mono font-semibold"
          style={{ height: 46, borderRadius: 14, background: '#141417', border: '1px solid rgba(255,255,255,0.14)', color: '#fff', fontSize: 13 }}
        >
          {t('explore.ld.seeDates').replace('{n}', String(density.upcoming.length))}
          <ArrowRight className="h-[15px] w-[15px]" />
        </button>
      </FadeInView>
    </div>
  );
}
