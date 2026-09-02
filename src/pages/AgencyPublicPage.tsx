import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Share2, MapPin, AtSign, Globe, MessageCircle, Heart, BadgeCheck, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { eventPriceLabel, affiliateMinPrice } from '@/lib/eventPriceLabel';
import { useFavorites } from '@/hooks/useFavorites';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { fr, es, enUS, type Locale } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { shareContent } from '@/lib/share';
import { publicUrl } from '@/lib/native';
import { smartOpenEvent } from '@/lib/appDeepLink';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { useAffiliateVisitorTracking, trackAffiliateClick } from '@/hooks/useAffiliateVisitorTracking';
import { OutboundLink } from '@/components/OutboundLink';
import { OfferBadges } from '@/components/affiliate/OfferBadges';

/* ============================================================
   AgencyPublicPage — /rp/:slug

   La VRAIE page in-Yuno d'une agence RP (madbynight & co). Rien à
   voir avec le linktree /p/:slug (vitrine hors-app QR/bio Insta) :
   ici c'est une page marketplace au design ÉDITORIAL public
   (docs/DESIGN_SYSTEM_PUBLIC.md) — hero cinématique, titres
   Space Grotesk géants, metadata JetBrains Mono, filets rouges,
   cartes soirée `.event-card`, rail de clubs. Navigation Yuno
   (BottomNav conservée).

   Données :
     • affiliates par linktree_slug (identité publique)
     • affiliate_events (bras externe, published/featured, à venir)
     • RPC get_agency_linktree_yuno_events (soirées Yuno sous
       contrat actif — SECURITY DEFINER, données marketplace)
     • RPC get_agency_public_venues (clubs Yuno sous contrat)
     • affiliate_venues (clubs externes de l'agence)

   Tracking : mêmes vues/clics que le linktree (l'agence retrouve
   ce trafic dans ses analytics sans rien changer).
   ============================================================ */

type RpProfile = {
  id: string;
  user_id: string | null;
  name: string;
  city: string | null;
  bio: string | null;
  avatar_url: string | null;
  /** Bannière 1:1 choisie par l'agence (profil agence) — sinon fallback auto. */
  banner_url: string | null;
  instagram: string | null;
  tiktok: string | null;
  website: string | null;
  whatsapp: string | null;
  linktree_slug: string | null;
  /** Identité maître de l'entité fusionnée. NULL = affilié sans agence → pas d'abonnement. */
  agency_id: string | null;
};

type RpEvent = {
  id: string;
  name: string;
  slug: string;               // vide pour une soirée Yuno
  event_date: string;         // yyyy-MM-dd
  start_time: string | null;  // HH:MM
  flyer_url: string | null;
  price_from: number | null;
  is_free: boolean;
  is_sold_out: boolean;
  genres: string[];
  venueName: string | null;
  venueCity: string | null;
  yuno_event_id: string | null;
  has_tables?: boolean;
  tables_only?: boolean;
  has_guest_list?: boolean;
  guest_list_type?: string | null;
};

type RpClub = {
  key: string;
  name: string;
  city: string | null;
  imageUrl: string | null;
  isYuno: boolean;
  /** Path interne : /club/:id (Yuno) ou /affiliate-venue/:slug (externe). */
  path: string | null;
};

/** Ligne renvoyée par get_agency_linktree_yuno_events. */
type YunoEventRow = {
  event_id: string;
  title: string;
  start_at: string;
  venue_id: string | null;
  venue_name: string | null;
  venue_city: string | null;
  poster_url: string | null;
  music_genres: string[] | null;
  price_from: number | null;
  is_free: boolean;
};

/** Ligne renvoyée par get_agency_public_venues. */
type YunoVenueRow = {
  venue_id: string;
  name: string;
  city: string | null;
  logo_url: string | null;
  cover_url: string | null;
};

// ── Carte soirée éditoriale (réutilise `.event-card` de la marketplace) ──────
// On ne réutilise pas <EventCard> tel quel : il navigue en interne alors qu'ici
// le clic doit tracer la conversion affiliée + ouvrir « app d'abord » les
// soirées Yuno. Même habillage, comportement propre à la page RP.
function RpEventCard({
  ev, onOpen, locale,
}: { ev: RpEvent; onOpen: () => void; locale: Locale }) {
  const { t } = useLanguage();
  const { isFavorite, toggleFavorite } = useFavorites();
  const favType = ev.yuno_event_id ? 'event' : 'affiliate_event';
  const liked = isFavorite(favType, ev.id);

  // start_time arrive en "HH:MM:SS" (colonne Postgres `time`) : normaliser en
  // "HH:MM" avant de rebâtir l'ISO, sinon "…T22:30:00:00" = Invalid Date et le
  // format() ci-dessous throw → toute la page RP publique tombe en erreur.
  const startHm = (ev.start_time || '22:00').slice(0, 5);
  const when = new Date(`${ev.event_date}T${startHm}:00`);
  const dateLabel = Number.isNaN(when.getTime()) ? '' : format(when, 'dd MMM', { locale }).toUpperCase();
  const timeLabel = startHm;

  // Le prix passe par la porte unique : « tables uniquement » n'est jamais un
  // prix, et un price_from à zéro n'est pas un gratuit.
  const priceText = eventPriceLabel({ minPrice: affiliateMinPrice(ev), tablesOnly: ev.tables_only }, t);
  const priceNode = priceText
    ? <span className="font-mono font-bold shrink-0" style={{ fontSize: '12px', color: '#E8192C', letterSpacing: '0.02em' }}>{priceText.toUpperCase()}</span>
    : null;

  return (
    <article
      onClick={onOpen}
      role="button"
      tabIndex={0}
      aria-label={ev.name}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(); } }}
      className="event-card group flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: '1/1' }}>
        {ev.flyer_url ? (
          <>
            <img src={ev.flyer_url} alt={ev.name} loading="lazy" className="event-card-img h-full w-full object-cover" />
            <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.10)' }} />
          </>
        ) : (
          <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, #1a0f12 0%, #3a1020 100%)' }} />
        )}

        {ev.is_sold_out && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
            <span className="font-mono font-bold tracking-[0.18em] text-white px-3 py-1" style={{ fontSize: '10px', background: '#E8192C', borderRadius: '2px' }}>
              {t('promoterLinktree.soldOut').toUpperCase()}
            </span>
          </div>
        )}

        {/* Badges — partenaire (violet) pour l'externe, sinon genre */}
        <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1.5">
          {!ev.yuno_event_id && (
            <span className="font-mono font-bold tracking-[0.14em]" style={{ fontSize: '9px', color: '#C084FC', background: 'rgba(192,132,252,0.15)', border: '1px solid rgba(192,132,252,0.3)', borderRadius: '2px', padding: '2px 6px' }}>
              {t('explore.partner')}
            </span>
          )}
          {ev.genres.slice(0, 1).map(g => (
            <span key={g} className="genre-tag" style={{ whiteSpace: 'nowrap' }}>{g}</span>
          ))}
        </div>

        {/* Cœur en bas à droite comme <EventCard> : en haut il recouvrait le badge genre */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleFavorite(favType, ev.id); }}
          className="absolute bottom-2.5 right-2.5 z-10 flex items-center justify-center rounded-full w-7 h-7 transition-all"
          style={{ background: 'rgba(10,10,10,0.55)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)' }}
          aria-label={liked ? t('explore.removeFav') : t('explore.addFav')}
        >
          <Heart className={cn('h-3.5 w-3.5 transition-all', liked ? 'fill-primary text-primary' : 'text-white/60')} />
        </button>
      </div>

      <div className="flex flex-col flex-1 px-3.5 py-3 gap-1.5" style={{ background: '#141414' }}>
        {ev.venueName && (
          <p className="font-mono truncate" style={{ fontSize: '10px', color: '#9A9A9A', letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1 }}>
            {ev.venueName}
          </p>
        )}
        <h3 className="font-display line-clamp-2" style={{ fontSize: 'clamp(14px, 2.5vw, 17px)', fontWeight: 700, color: '#FFFFFF', textTransform: 'uppercase', lineHeight: 1.05, letterSpacing: '-0.005em' }}>
          {ev.name}
        </h3>
        <OfferBadges flags={ev} />
        <div className="flex-1" />
        <div className="flex items-center justify-between gap-2 pt-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <p className="font-mono" style={{ fontSize: '11px', color: '#9A9A9A', letterSpacing: '0.04em' }}>
            {dateLabel} · {timeLabel}
          </p>
          {priceNode}
        </div>
      </div>
    </article>
  );
}

function LoadingSkeleton() {
  return (
    <div className="min-h-screen pb-28" style={{ background: '#0A0A0A' }}>
      <Skeleton className="w-full rounded-none" style={{ aspectRatio: '16 / 11' }} />
      <div style={{ maxWidth: 768, margin: '0 auto' }} className="px-5">
        <div className="flex items-end gap-4" style={{ marginTop: -40 }}>
          <Skeleton className="rounded-full" style={{ width: 88, height: 88 }} />
        </div>
        <Skeleton className="h-12 w-3/4 mt-5" />
        <Skeleton className="h-4 w-1/2 mt-4" />
        <div className="grid grid-cols-2 gap-3 mt-10">
          <Skeleton className="w-full rounded-[10px]" style={{ aspectRatio: '3 / 4' }} />
          <Skeleton className="w-full rounded-[10px]" style={{ aspectRatio: '3 / 4' }} />
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function AgencyPublicPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { language, t } = useLanguage();
  const reduceMotion = useReducedMotion();

  const [profile, setProfile] = useState<RpProfile | null>(null);
  const [events, setEvents] = useState<RpEvent[]>([]);
  const [clubs, setClubs] = useState<RpClub[]>([]);
  const [loading, setLoading] = useState(true);
  // Abonnement à l'agence (identité maître). Absent d'affiliate sans agency_id.
  const [followersCount, setFollowersCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);

  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const isOwner = !!(user?.id && profile?.user_id && user.id === profile.user_id);

  // Vues comptées dans les analytics de l'agence, comme le linktree.
  useAffiliateVisitorTracking({ affiliateId: profile?.id ?? '', isOwner });

  useEffect(() => {
    if (!slug) return;
    let active = true;
    (async () => {
      setLoading(true);
      try {
        // Cast any : banner_url n'est pas encore dans les types générés.
        const { data: aff } = await (supabase as any)
          .from('affiliates')
          .select('id, user_id, name, city, bio, avatar_url, banner_url, instagram, tiktok, website, whatsapp, linktree_slug, agency_id')
          .eq('linktree_slug', slug)
          .eq('is_active', true)
          .maybeSingle();
        if (!aff) {
          // Ancien slug (agence renommée) → redirection vers l'URL canonique.
          const { data: canonical } = await supabase.rpc('resolve_affiliate_slug', { p_slug: slug });
          if (canonical && canonical !== slug) {
            navigate(`/rp/${canonical}`, { replace: true });
            return;
          }
          if (active) { setProfile(null); setLoading(false); }
          return;
        }

        const today = new Date().toISOString().split('T')[0];
        const [externalRes, yunoRes, yunoVenuesRes, externalVenuesRes] = await Promise.all([
          supabase
            .from('affiliate_events')
            .select('id, name, slug, event_date, start_time, flyer_url, price_from, is_free, is_sold_out, genres, has_tables, tables_only, has_guest_list, guest_list_type, affiliate_venues(name, city)')
            .eq('affiliate_id', aff.id)
            .in('status', ['published', 'featured'])
            .gte('event_date', today)
            .order('event_date', { ascending: true })
            .limit(120),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase as any).rpc('get_agency_linktree_yuno_events', { p_affiliate_id: aff.id }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase as any).rpc('get_agency_public_venues', { p_affiliate_id: aff.id }),
          supabase
            .from('affiliate_venues')
            .select('id, name, city, neighborhood, slug, logo_url, cover_image_url')
            .eq('affiliate_id', aff.id)
            .eq('is_active', true)
            .order('sort_order', { ascending: true })
            .limit(24),
        ]);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const external: RpEvent[] = ((externalRes.data ?? []) as any[]).map(e => {
          const v = Array.isArray(e.affiliate_venues) ? e.affiliate_venues[0] ?? null : e.affiliate_venues;
          return {
            id: e.id,
            name: e.name,
            slug: e.slug,
            event_date: e.event_date,
            start_time: e.start_time ? e.start_time.slice(0, 5) : null,
            flyer_url: e.flyer_url ?? null,
            price_from: e.price_from ?? null,
            is_free: !!e.is_free,
            is_sold_out: !!e.is_sold_out,
            genres: (e.genres ?? []).filter(Boolean),
            venueName: v?.name ?? null,
            venueCity: v?.city ?? null,
            yuno_event_id: null,
            has_tables: !!e.has_tables,
            tables_only: !!e.tables_only,
            has_guest_list: !!e.has_guest_list,
            guest_list_type: e.guest_list_type ?? null,
          };
        });

        const pad = (n: number) => String(n).padStart(2, '0');
        const yuno: RpEvent[] = ((yunoRes?.data ?? []) as YunoEventRow[]).map(row => {
          const when = new Date(row.start_at);
          return {
            id: row.event_id,
            name: row.title,
            slug: '',
            event_date: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`,
            start_time: `${pad(when.getHours())}:${pad(when.getMinutes())}`,
            flyer_url: row.poster_url,
            price_from: row.price_from,
            is_free: row.is_free,
            is_sold_out: false,
            genres: (row.music_genres ?? []).filter(Boolean),
            venueName: row.venue_name,
            venueCity: row.venue_city,
            yuno_event_id: row.event_id,
          };
        });

        const seen = new Set(external.map(e => e.id));
        const merged = [...external, ...yuno.filter(e => !seen.has(e.id))].sort((a, b) => {
          const d = a.event_date.localeCompare(b.event_date);
          return d !== 0 ? d : (a.start_time ?? '').localeCompare(b.start_time ?? '');
        });

        // Clubs : Yuno d'abord (sous contrat), puis les salles du bras externe.
        const yunoClubs: RpClub[] = ((yunoVenuesRes?.data ?? []) as YunoVenueRow[]).map(v => ({
          key: `yuno-${v.venue_id}`,
          name: v.name,
          city: v.city,
          imageUrl: v.cover_url || v.logo_url,
          isYuno: true,
          path: `/club/${v.venue_id}`,
        }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const externalClubs: RpClub[] = ((externalVenuesRes.data ?? []) as any[]).map(v => ({
          key: `ext-${v.id}`,
          name: v.name,
          city: [v.neighborhood, v.city].filter(Boolean).join(' · ') || null,
          imageUrl: v.cover_image_url || v.logo_url,
          isYuno: false,
          path: v.slug ? `/affiliate-venue/${v.slug}` : null,
        }));

        if (active) {
          setProfile(aff as unknown as RpProfile);
          setEvents(merged);
          setClubs([...yunoClubs, ...externalClubs]);
          setLoading(false);
        }
      } catch (err) {
        console.error('[AgencyPublicPage] fetch error:', err);
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [slug]);

  // Abonnés de l'agence : compteur public + état de l'utilisateur courant.
  // On ne fait rien pour un affilié sans identité d'agence (agency_id NULL).
  const agencyId = profile?.agency_id ?? null;
  useEffect(() => {
    if (!agencyId) { setFollowersCount(0); setIsFollowing(false); return; }
    let active = true;
    (async () => {
      // agency_followers pas encore dans les types générés → cast (regen après push).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const [{ count }, followedRes] = await Promise.all([
        sb.from('agency_followers').select('id', { count: 'exact', head: true }).eq('agency_id', agencyId),
        user?.id
          ? sb.from('agency_followers').select('id').eq('agency_id', agencyId).eq('user_id', user.id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (!active) return;
      setFollowersCount(count ?? 0);
      setIsFollowing(!!followedRes.data);
    })();
    return () => { active = false; };
  }, [agencyId, user?.id]);

  const toggleFollow = async () => {
    if (!agencyId || followBusy) return;
    if (!user?.id) {
      toast.info(t('affiliate.loginToFollow'));
      navigate('/auth');
      return;
    }
    // Optimiste : le pouce doit sentir le tap ; on annule si l'écriture échoue.
    const was = isFollowing;
    setFollowBusy(true);
    setIsFollowing(!was);
    setFollowersCount(c => was ? Math.max(0, c - 1) : c + 1);
    const { error } = was
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? await (supabase as any).from('agency_followers').delete().eq('agency_id', agencyId).eq('user_id', user.id)
      : await (supabase.rpc as unknown as (n: string, p: Record<string, unknown>) => Promise<{ error: unknown }>)(
          'follow_agency', { p_agency_id: agencyId, p_source: 'rp_page' });
    if (error) {
      setIsFollowing(was);
      setFollowersCount(c => was ? c + 1 : Math.max(0, c - 1));
      toast.error(t('subscribe.error'));
    }
    setFollowBusy(false);
  };

  const openEvent = (ev: RpEvent) => {
    // Le clic (FK affiliate_event_id) ne se compte que sur les soirées externes.
    if (!ev.yuno_event_id && profile) {
      trackAffiliateClick({ affiliateId: profile.id, affiliateEventId: ev.id, isInternal: isOwner });
    }
    if (ev.yuno_event_id) { smartOpenEvent(`/event/${ev.yuno_event_id}`, navigate); return; }
    // On reste dans Yuno : la fiche affiliée porte le contexte + l'interstitiel
    // de sortie vers la billetterie externe.
    navigate(`/affiliate-event/${ev.slug}`);
  };

  const handleShare = async () => {
    const outcome = await shareContent({ title: profile?.name || '', url: publicUrl() });
    if (outcome === 'copied') toast.success(t('share.copied'));
  };

  // Villes distinctes couvertes (stat éditoriale) — sources fiables : ville de
  // l'agence + villes des soirées.
  const cityCount = useMemo(() => {
    const set = new Set<string>();
    if (profile?.city) set.add(profile.city.trim().toLowerCase());
    events.forEach(e => { if (e.venueCity) set.add(e.venueCity.trim().toLowerCase()); });
    return set.size;
  }, [profile?.city, events]);

  if (loading) return <LoadingSkeleton />;

  if (!profile) {
    return (
      <div className="min-h-screen pb-28 flex flex-col items-center justify-center px-6 text-center" style={{ background: '#0A0A0A' }}>
        <span className="font-mono font-bold" style={{ color: '#E8192C', letterSpacing: '0.16em', fontSize: '18px', marginBottom: 16 }}>YUNO</span>
        <h1 className="font-display text-white uppercase" style={{ fontSize: '24px', fontWeight: 700, marginBottom: 8 }}>
          {t('affiliate.rpNotFoundTitle')}
        </h1>
        <p className="font-mono" style={{ color: '#5A5A5E', fontSize: '13px', maxWidth: 300 }}>
          {t('affiliate.rpNotFoundBody')}
        </p>
      </div>
    );
  }

  const websiteHref = profile.website
    ? (/^https?:\/\//i.test(profile.website) ? profile.website : `https://${profile.website}`)
    : null;
  const whatsappHref = profile.whatsapp ? `https://wa.me/${profile.whatsapp.replace(/[^0-9]/g, '')}` : null;
  const socialPillStyle: React.CSSProperties = {
    fontSize: '11px', letterSpacing: '0.06em', color: '#E5E5E5', padding: '7px 13px',
    borderRadius: '999px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
    textDecoration: 'none', textTransform: 'uppercase',
  };

  // Backdrop : la bannière 1:1 choisie par l'agence prime ; sinon l'affiche de
  // la prochaine soirée donne l'énergie nightlife ; sinon l'avatar ; sinon un
  // dégradé nuit. Avec une bannière personnalisée, le hero passe au carré
  // (plein écran mobile, hauteur plafonnée sur desktop → recadrage centré).
  const customBanner = profile.banner_url;
  const heroBackdrop = customBanner || events.find(e => e.flyer_url)?.flyer_url || profile.avatar_url;
  const stats = [
    { value: events.length, label: t('promoterLinktree.eventPlural') },
    clubs.length > 0 ? { value: clubs.length, label: t('affiliate.clubs') } : null,
    cityCount > 1 ? { value: cityCount, label: t('affiliate.cities') } : null,
  ].filter(Boolean) as { value: number; label: string }[];

  const hasSocials = !!(profile.instagram || profile.tiktok || websiteHref || whatsappHref);

  return (
    <div className="min-h-screen pb-28" style={{ background: '#0A0A0A' }}>

      {/* ══ HERO CINÉMATIQUE ══════════════════════════════════ */}
      <section className="relative overflow-hidden" style={{ aspectRatio: customBanner ? '1 / 1' : '16 / 11', maxHeight: customBanner ? 640 : undefined, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        {heroBackdrop ? (
          <motion.img
            initial={reduceMotion ? false : { scale: 1.08, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            src={getOptimizedImageUrl(heroBackdrop, { width: 1200, quality: 78 })}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: 'saturate(1.05)' }}
          />
        ) : (
          <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, #1a0808 0%, #3d0f18 55%, #0A0A0A 100%)' }} />
        )}
        {/* Fondu bas vers la page + légère vignette haute pour les boutons.
            Aucun texte n'est posé sur l'image (le nom vit dans le bloc identité
            en dessous) : le voile ne doit donc PAS couvrir le centre, sinon la
            bannière de l'agence sort délavée. */}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, #0A0A0A 3%, rgba(10,10,10,0.45) 20%, rgba(10,10,10,0) 52%, rgba(10,10,10,0) 82%, rgba(10,10,10,0.30) 100%)' }} />

        {/* Top bar flottante : back + share */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-start justify-between" style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 8px) 16px 0' }}>
          <button
            onClick={() => navigate(-1)}
            aria-label={t('affiliate.back')}
            className="flex items-center justify-center hover:opacity-80 transition-opacity"
            style={{ width: 36, height: 36, borderRadius: '2px', background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            onClick={handleShare}
            aria-label={t('affiliate.share')}
            className="flex items-center justify-center hover:opacity-80 transition-opacity"
            style={{ width: 36, height: 36, borderRadius: '2px', background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            <Share2 className="h-4 w-4" />
          </button>
        </div>
      </section>

      {/* ══ BLOC IDENTITÉ ═════════════════════════════════════ */}
      <div style={{ maxWidth: 768, margin: '0 auto' }} className="px-5">
        {/* Photo carrée à angles ronds (comme le profil DJ), chevauche le hero.
            Plus aucun élément rouge dessus. */}
        <div
          className="overflow-hidden animate-hero-label"
          style={{ width: 92, height: 92, borderRadius: 14, border: '3px solid #0A0A0A', boxShadow: '0 0 0 1px rgba(255,255,255,0.12)', background: '#191919', marginTop: -62, marginBottom: 14, position: 'relative', zIndex: 10 }}
        >
          {profile.avatar_url
            ? <img src={getOptimizedImageUrl(profile.avatar_url, { width: 200, height: 200, resize: 'cover' })} alt={profile.name} className="w-full h-full object-cover object-top" />
            : <div className="w-full h-full flex items-center justify-center font-display font-bold" style={{ fontSize: '34px', color: '#E5E5E5' }}>{(profile.name[0] || '?').toUpperCase()}</div>
          }
        </div>

        {/* Badge partenaire — sur le fond sombre, jamais sur la photo */}
        <div className="animate-hero-body" style={{ marginBottom: 12 }}>
          <span
            className="font-mono font-bold inline-flex items-center"
            style={{ fontSize: '10px', color: '#E8192C', background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.28)', borderRadius: '2px', padding: '4px 10px', letterSpacing: '0.16em' }}
          >
            {t('affiliate.rp').toUpperCase()} · {t('affiliate.yunoPartner').toUpperCase()}
          </span>
        </div>

        <h1
          className="font-display font-bold text-white uppercase animate-hero-h1"
          style={{ fontSize: 'clamp(38px, 11vw, 84px)', letterSpacing: '-0.03em', lineHeight: 0.88, margin: 0 }}
        >
          {profile.name}
        </h1>

        {profile.city && (
          <p className="font-mono uppercase flex items-center gap-1.5 animate-hero-body" style={{ fontSize: '11px', color: '#9A9A9A', letterSpacing: '0.06em', marginTop: 12 }}>
            <MapPin className="h-3.5 w-3.5" />
            {profile.city}
          </p>
        )}

        {profile.bio && (
          <p className="font-serif italic animate-hero-body" style={{ fontSize: '15px', color: '#9A9A9A', lineHeight: 1.6, maxWidth: 480, marginTop: 16 }}>
            {profile.bio.length > 220 ? `${profile.bio.slice(0, 220).trimEnd()}…` : profile.bio}
          </p>
        )}

        {hasSocials && (
          <div className="flex flex-wrap items-center gap-2 animate-hero-cta" style={{ marginTop: 18 }}>
            {profile.instagram && (
              <OutboundLink href={`https://instagram.com/${profile.instagram.replace('@', '')}`} className="inline-flex items-center gap-1.5 font-mono hover:opacity-80 transition-opacity" style={socialPillStyle}>
                <AtSign className="h-3 w-3" style={{ color: '#E8192C' }} />
                {profile.instagram.replace('@', '')}
              </OutboundLink>
            )}
            {profile.tiktok && (
              <OutboundLink href={`https://tiktok.com/@${profile.tiktok.replace('@', '')}`} className="inline-flex items-center gap-1.5 font-mono hover:opacity-80 transition-opacity" style={socialPillStyle}>
                TikTok
              </OutboundLink>
            )}
            {websiteHref && (
              <OutboundLink href={websiteHref} className="inline-flex items-center gap-1.5 font-mono hover:opacity-80 transition-opacity" style={socialPillStyle}>
                <Globe className="h-3 w-3" style={{ color: '#E8192C' }} />
                {t('affiliate.website')}
              </OutboundLink>
            )}
            {whatsappHref && (
              <OutboundLink href={whatsappHref} className="inline-flex items-center gap-1.5 font-mono hover:opacity-80 transition-opacity" style={socialPillStyle}>
                <MessageCircle className="h-3 w-3" style={{ color: '#E8192C' }} />
                WhatsApp
              </OutboundLink>
            )}
          </div>
        )}

        {/* S'abonner à l'agence — pilule pleine qui bascule en outline « Abonné »
            (même design que le bouton d'abonnement DJ). Identité maître requise. */}
        {agencyId && (
          <div className="flex items-center gap-3 animate-hero-cta" style={{ marginTop: 18 }}>
            <Button
              variant={isFollowing ? 'outline' : 'default'}
              size="sm"
              onClick={toggleFollow}
              disabled={followBusy}
              aria-pressed={isFollowing}
              className={cn(
                'h-8 px-3 rounded-[10px] text-xs font-medium transition-all',
                isFollowing && 'border-border text-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Bell className="h-5 w-5" />
              <span className="ml-1">{isFollowing ? t('affiliate.subscribed') : t('affiliate.subscribe')}</span>
            </Button>
            {followersCount > 0 && (
              <span style={{ fontSize: '13px', color: '#9A9A9A' }}>
                {followersCount.toLocaleString()} {t('affiliate.subscribers').toLowerCase()}
              </span>
            )}
          </div>
        )}

        {/* Stats éditoriales */}
        {stats.length > 0 && (
          <div className="flex items-stretch animate-hero-cta" style={{ marginTop: 26, borderTop: '1px solid rgba(255,255,255,0.07)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            {stats.map((s, i) => (
              <div key={s.label} className="flex-1 flex flex-col" style={{ padding: '16px 0', borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.07)' : 'none', paddingLeft: i > 0 ? 18 : 0 }}>
                <span className="font-display font-bold text-white" style={{ fontSize: 'clamp(26px, 7vw, 34px)', letterSpacing: '-0.03em', lineHeight: 1 }}>
                  {s.value}
                </span>
                <span className="font-mono uppercase" style={{ fontSize: '9px', color: '#5A5A5E', letterSpacing: '0.14em', marginTop: 6 }}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ══ BANDEAU DÉFILANT — clubs animés ═══════════════════ */}
      {clubs.length >= 3 && (
        <div className="marquee-strip" style={{ marginTop: 28 }} aria-hidden="true">
          <div className="marquee-inner">
            {[...clubs, ...clubs].map((c, i) => (
              <span key={`${c.key}-${i}`} className={cn('marquee-item', c.isYuno && 'marquee-item--accent')}>
                {c.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ══ CONTENU ═══════════════════════════════════════════ */}
      <div style={{ maxWidth: 768, margin: '0 auto' }}>

        {/* ── PROCHAINES SOIRÉES ── */}
        <section style={{ padding: 'clamp(30px, 5vw, 42px) 20px', borderBottom: clubs.length > 0 ? '1px solid rgba(255,255,255,0.07)' : 'none' }}>
          <p className="section-label-ruled mb-6">{t('affiliate.upcomingEvents')}</p>
          {events.length === 0 ? (
            <p className="font-mono text-center" style={{ fontSize: '12px', color: '#5A5A5E', letterSpacing: '0.06em', padding: '28px 0 8px' }}>
              {t('affiliate.rpUpcomingEmpty')}
            </p>
          ) : (
            <div className="stagger-grid grid grid-cols-2 gap-3">
              {events.map(ev => (
                <RpEventCard key={ev.id} ev={ev} onOpen={() => openEvent(ev)} locale={dateLocale} />
              ))}
            </div>
          )}
        </section>

        {/* ── CLUBS (rail éditorial) ── */}
        {clubs.length > 0 && (
          <section style={{ padding: 'clamp(30px, 5vw, 42px) 0' }}>
            <div className="px-5">
              <p className="section-label-ruled mb-6">{t('affiliate.clubs')}</p>
            </div>
            <div className="flex gap-3 overflow-x-auto scrollbar-hide px-5 pb-1" style={{ scrollSnapType: 'x mandatory', scrollPaddingLeft: '20px' }}>
              {clubs.map(club => (
                <button
                  key={club.key}
                  onClick={() => club.path && navigate(club.path)}
                  className="shrink-0 text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  style={{ width: 158, cursor: club.path ? 'pointer' : 'default', scrollSnapAlign: 'start', borderRadius: 10 }}
                  aria-label={club.name}
                >
                  <div className="relative w-full overflow-hidden" style={{ aspectRatio: '4 / 5', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: '#141414' }}>
                    {club.imageUrl
                      ? <img src={getOptimizedImageUrl(club.imageUrl, { width: 320, quality: 80 })} alt={club.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                      : <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'linear-gradient(160deg, #1a0f12 0%, #3a1020 100%)' }}><MapPin className="h-6 w-6" style={{ color: '#5A5A5E' }} /></div>
                    }
                    <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(10,10,10,0.92) 0%, rgba(10,10,10,0) 55%)' }} />
                    {club.isYuno && (
                      <span className="absolute top-2 left-2 font-mono font-bold" style={{ fontSize: '8px', color: '#fff', background: '#E8192C', borderRadius: '2px', padding: '2px 6px', letterSpacing: '0.12em' }}>
                        YUNO
                      </span>
                    )}
                    <div className="absolute bottom-0 left-0 right-0" style={{ padding: '10px' }}>
                      <p className="font-display font-bold text-white uppercase" style={{ fontSize: '13px', letterSpacing: '-0.005em', lineHeight: 1.1 }}>
                        {club.name}
                      </p>
                      {club.city && (
                        <p className="font-mono truncate" style={{ fontSize: '9px', color: '#9A9A9A', letterSpacing: '0.06em', marginTop: 2 }}>
                          {club.city}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ── PIED — tampon partenaire vérifié + marque Yuno ── */}
        <footer style={{ padding: '48px 20px 16px', textAlign: 'center', borderTop: clubs.length > 0 ? 'none' : '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center justify-center mx-auto" style={{ width: 42, height: 42, borderRadius: '50%', background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.28)', marginBottom: 16 }}>
            <BadgeCheck className="h-5 w-5" style={{ color: '#E8192C' }} />
          </div>
          <p className="font-mono uppercase" style={{ fontSize: '10px', color: '#9A9A9A', letterSpacing: '0.16em', marginBottom: 6 }}>
            {t('affiliate.rpVerifiedPartner')}
          </p>
          <p className="font-display font-bold text-white uppercase" style={{ fontSize: '16px', letterSpacing: '-0.01em', marginBottom: 24 }}>
            {profile.name}
          </p>
          <p className="font-mono" style={{ fontSize: '10px', color: '#3A3A3E', letterSpacing: '0.12em' }}>
            POWERED BY <span style={{ color: '#5A5A5E', fontWeight: 700 }}>YUNO</span>
          </p>
        </footer>

      </div>
    </div>
  );
}
