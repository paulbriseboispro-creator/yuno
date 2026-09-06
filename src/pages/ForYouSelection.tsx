import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { EventCard, type EventCardData } from '@/components/explore/EventCard';
import { Button } from '@/components/ui/button';

/**
 * /for-you/:id — la page qu'ouvre un push « {count} soirées pour toi ».
 *
 * Le push a été calculé pour UNE personne à UN instant : cette page montre
 * EXACTEMENT les soirées annoncées (discovery_selections), dans l'ordre du
 * classement, et rien d'autre. Avant : le tap ouvrait le feed Explore, où la
 * personne devait retrouver seule ce qu'on lui avait promis — et souvent ne
 * le trouvait pas (mauvaise ville, club démo). Une notif qui promet trois
 * soirées doit atterrir sur ces trois soirées : c'est là que la conversion
 * se joue.
 *
 * Design system PUBLIC (éditorial) : mêmes cartes que l'Explore.
 */

type Selection = {
  id: string;
  event_ids: string[];
  affiliate_event_ids: string[];
  city: string | null;
  genres: string[];
  created_at: string;
};

type EventRow = {
  id: string;
  title: string;
  slug: string | null;
  poster_url: string | null;
  start_at: string;
  end_at: string;
  venue_id: string | null;
  location_city: string | null;
  location_name: string | null;
  music_genres: string[] | null;
  organizer_user_id: string | null;
  event_type: string | null;
  tables_enabled: boolean | null;
  venues: { name: string; city: string | null } | { name: string; city: string | null }[] | null;
};

type AffiliateRow = {
  id: string;
  name: string;
  slug: string;
  flyer_url: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  genres: string[] | null;
  price_from: number | null;
  is_free: boolean | null;
  tables_only: boolean | null;
  affiliate_venues: { id: string; name: string; city: string | null } | { id: string; name: string; city: string | null }[] | null;
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default function ForYouSelection() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user, loading: authLoading } = useAuth();

  const [selection, setSelection] = useState<Selection | null>(null);
  const [cards, setCards] = useState<EventCardData[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      // La sélection est personnelle : on revient ici après connexion.
      navigate(`/auth?redirect=${encodeURIComponent(`/for-you/${id}`)}`, { replace: true });
      return;
    }
    if (!id) { setState('missing'); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('open_discovery_selection' as never, { p_id: id } as never);
      const sel = one(data as Selection[] | Selection | null);
      if (cancelled) return;
      if (error || !sel) { setState('missing'); return; }
      setSelection(sel);

      const eventIds = sel.event_ids || [];
      const affIds = sel.affiliate_event_ids || [];
      const [evRes, affRes, roundsRes, orgRes] = await Promise.all([
        eventIds.length
          ? supabase.from('events')
              .select('id, title, slug, poster_url, start_at, end_at, venue_id, location_city, location_name, music_genres, organizer_user_id, event_type, tables_enabled, venues(name, city)')
              .in('id', eventIds)
          : Promise.resolve({ data: [] as EventRow[] }),
        affIds.length
          ? supabase.from('affiliate_events')
              .select('id, name, slug, flyer_url, event_date, start_time, end_time, genres, price_from, is_free, tables_only, affiliate_venues(id, name, city)')
              .in('id', affIds)
          : Promise.resolve({ data: [] as AffiliateRow[] }),
        eventIds.length
          ? supabase.from('ticket_rounds').select('event_id, price, is_active').in('event_id', eventIds).eq('is_active', true)
          : Promise.resolve({ data: [] as { event_id: string; price: number }[] }),
        eventIds.length
          ? supabase.from('organizer_profiles').select('user_id, display_name, slug')
          : Promise.resolve({ data: [] as { user_id: string; display_name: string; slug: string | null }[] }),
      ]);
      if (cancelled) return;

      const minPrice = new Map<string, number>();
      for (const r of (roundsRes.data || []) as { event_id: string; price: number }[]) {
        minPrice.set(r.event_id, Math.min(minPrice.get(r.event_id) ?? Infinity, Number(r.price)));
      }
      const orgs = new Map<string, { display_name: string; slug: string | null }>();
      for (const o of (orgRes.data || []) as { user_id: string; display_name: string; slug: string | null }[]) {
        orgs.set(o.user_id, { display_name: o.display_name, slug: o.slug });
      }

      const yunoCards: EventCardData[] = ((evRes.data || []) as EventRow[]).map((e) => {
        const venue = one(e.venues);
        const org = e.organizer_user_id ? orgs.get(e.organizer_user_id) : undefined;
        const venueName = org
          ? `${org.display_name}${venue ? ` · ${venue.name}` : ''}`
          : venue?.name || e.location_name || '';
        return {
          id: e.id,
          slug: e.slug,
          organizerSlug: org?.slug ?? null,
          title: e.title,
          posterUrl: e.poster_url,
          startAt: e.start_at,
          endAt: e.end_at,
          venueName,
          venueSlug: e.venue_id || '',
          venueCity: venue?.city || e.location_city || '',
          minPrice: minPrice.get(e.id) ?? null,
          tablesOnly: !!e.tables_enabled && !minPrice.has(e.id),
          genres: e.music_genres || [],
          interestedCount: 0,
          percentSold: 0,
          tablesRemaining: null,
          isTrending: false,
          eventType: e.event_type || 'club',
          isOrganizerLed: !!e.organizer_user_id,
          organizerName: org?.display_name,
        };
      });

      const partnerCards: EventCardData[] = ((affRes.data || []) as AffiliateRow[]).map((ae) => {
        const venue = one(ae.affiliate_venues);
        const startAt = `${ae.event_date}T${(ae.start_time || '23:00').substring(0, 5)}:00`;
        const endAt = `${ae.event_date}T${(ae.end_time || '05:30').substring(0, 5)}:00`;
        return {
          id: ae.id,
          title: ae.name,
          posterUrl: ae.flyer_url,
          startAt,
          endAt,
          venueName: venue?.name || '',
          venueSlug: venue?.id || '',
          venueCity: venue?.city || '',
          minPrice: ae.is_free ? 0 : ae.price_from ?? null,
          tablesOnly: !!ae.tables_only,
          genres: ae.genres || [],
          interestedCount: 0,
          percentSold: 0,
          tablesRemaining: null,
          isTrending: false,
          eventType: 'affiliate',
          isAffiliate: true,
          affiliateEventSlug: ae.slug,
        };
      });

      // Ordre du classement (celui du push), soirées passées écartées.
      const order = new Map<string, number>();
      eventIds.forEach((eid, i) => order.set(eid, i));
      affIds.forEach((eid, i) => order.set(eid, eventIds.length + i));
      const now = Date.now();
      const all = [...yunoCards, ...partnerCards]
        .filter((c) => new Date(c.endAt || c.startAt).getTime() > now)
        .sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));

      setCards(all);
      setState('ready');
    })();
    return () => { cancelled = true; };
  }, [id, user, authLoading, navigate]);

  const subtitle = useMemo(() => {
    if (!selection) return '';
    const parts: string[] = [];
    if (selection.genres?.[0]) parts.push(selection.genres[0]);
    if (selection.city) parts.push(selection.city);
    return parts.join(' · ');
  }, [selection]);

  const countLabel = t('forYou.count').replace('{count}', String(cards.length));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-white/[0.07]">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/explore')}
            aria-label={t('forYou.back')}
            className="h-9 w-9 -ml-2 inline-flex items-center justify-center rounded-full hover:bg-white/5"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <p className="font-mono uppercase tracking-[0.14em] text-[10px] text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-primary" />
              {t('forYou.kicker')}
            </p>
            <h1 className="font-display font-bold uppercase text-lg leading-tight truncate">
              {state === 'ready' ? countLabel : t('forYou.title')}
            </h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-24 pt-4">
        {state === 'loading' && (
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="aspect-[3/4] rounded-sm bg-white/[0.04] animate-pulse" />
            ))}
          </div>
        )}

        {state === 'missing' && (
          <div className="py-16 text-center space-y-4">
            <p className="text-muted-foreground">{t('forYou.missing')}</p>
            <Button onClick={() => navigate('/explore')}>{t('forYou.explore')}</Button>
          </div>
        )}

        {state === 'ready' && (
          <>
            {subtitle && (
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground mb-3">
                {subtitle}
              </p>
            )}
            {cards.length === 0 ? (
              <div className="py-16 text-center space-y-4">
                <p className="text-muted-foreground">{t('forYou.expired')}</p>
                <Button onClick={() => navigate('/explore')}>{t('forYou.explore')}</Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {cards.map((c) => <EventCard key={c.id} event={c} />)}
              </div>
            )}
            <div className="mt-8 text-center">
              <Button variant="outline" onClick={() => navigate(selection?.city ? `/explore?city=${encodeURIComponent(selection.city)}` : '/explore')}>
                {t('forYou.seeAll')}
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
