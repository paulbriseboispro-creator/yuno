import { useEffect, useState } from 'react';
import { Sparkles, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { makeDjT } from '@/i18n/djTranslate';
import { useVenueContext } from '@/hooks/useVenueContext';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FadeInView } from '@/components/motion';

type BookerEvent = { id: string; title: string; start_at: string };

type DJMatch = {
  user_id: string;
  dj_id: string;
  handle: string | null;
  slug: string | null;
  stage_name: string | null;
  city: string | null;
  profile_image_url: string | null;
  music_genres: string[] | null;
  is_verified: boolean | null;
  similarity: number;
};

/**
 * « Les DJs qui collent à ta soirée » — matching sémantique (embeddings pgvector)
 * entre l'univers de la soirée (titre, genres, lieu, description) et celui du DJ
 * (nom de scène, genres, bio, ville). Complémentaire au classement par complétude
 * de profil du marketplace : ici c'est l'affinité musicale qui parle.
 *
 * Best-effort : masqué s'il n'y a pas de soirée à venir, pas d'embedding encore
 * calculé (le cron passe toutes les 5 min) ou aucun match au-dessus du seuil.
 */
export function DJMatchRail() {
  const { language } = useLanguage();
  const tt = makeDjT(language);
  const { scope, venueId, organizerUserId } = useVenueContext();

  const [events, setEvents] = useState<BookerEvent[]>([]);
  const [eventId, setEventId] = useState<string>('');
  const [matches, setMatches] = useState<DJMatch[]>([]);
  const [loading, setLoading] = useState(false);

  // Soirées à venir du booker (club ou organisateur).
  useEffect(() => {
    const isOrg = scope === 'organizer';
    if (isOrg ? !organizerUserId : !venueId) return;
    let cancelled = false;
    (async () => {
      let q = supabase
        .from('events')
        .select('id, title, start_at')
        .gte('start_at', new Date().toISOString())
        .order('start_at', { ascending: true })
        .limit(12);
      q = isOrg
        ? q.eq('organizer_user_id', organizerUserId!)
        : q.eq('venue_id', venueId!);
      const { data } = await q;
      if (cancelled) return;
      const rows = (data || []) as BookerEvent[];
      setEvents(rows);
      if (rows.length > 0) setEventId((prev) => prev || rows[0].id);
    })();
    return () => { cancelled = true; };
  }, [scope, venueId, organizerUserId]);

  // Matching sémantique pour la soirée sélectionnée.
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      // RPC pas encore dans les types générés (regen après db push).
      const { data, error } = await supabase.rpc('match_djs_for_event' as never, {
        p_event_id: eventId, p_limit: 6,
      } as never);
      if (cancelled) return;
      setMatches(!error && Array.isArray(data) ? (data as DJMatch[]) : []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  if (events.length === 0) return null;
  if (!loading && matches.length === 0) return null;

  const openDj = (dj: DJMatch) => {
    const target = dj.handle || dj.slug;
    if (target) window.open(`/dj/${target}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <FadeInView>
      <div
        style={{
          background: 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c',
          border: '1px solid rgba(255,255,255,0.085)',
          borderRadius: 16,
          padding: 18,
        }}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" style={{ color: 'rgba(255,255,255,0.58)' }} />
            <h3 style={{ color: 'rgba(255,255,255,0.96)', fontSize: 14.5, fontWeight: 600 }}>
              {tt('Les DJs qui collent à ta soirée', 'DJs who fit your night', 'DJs que encajan con tu fiesta')}
            </h3>
            <span
              style={{
                color: 'rgba(255,255,255,0.36)', fontSize: 10, fontWeight: 700,
                border: '1px solid rgba(255,255,255,0.085)', borderRadius: 5,
                padding: '1px 5px', letterSpacing: '0.08em',
              }}
            >
              IA
            </span>
          </div>
          {events.length > 1 && (
            <Select value={eventId} onValueChange={setEventId}>
              <SelectTrigger className="h-8 w-[200px] border-white/[0.08] bg-white/[0.03] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {events.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {loading ? (
          <div className="flex gap-3 overflow-hidden">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[132px] w-[128px] flex-none animate-pulse rounded-xl"
                style={{ background: 'rgba(255,255,255,0.04)' }}
              />
            ))}
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {matches.map((dj) => (
              <button
                key={dj.dj_id}
                type="button"
                onClick={() => openDj(dj)}
                className="flex-none text-left transition-opacity hover:opacity-85"
                style={{
                  width: 128,
                  background: 'rgba(255,255,255,0.032)',
                  border: '1px solid rgba(255,255,255,0.055)',
                  borderRadius: 12,
                  padding: 10,
                }}
              >
                <div
                  className="mb-2 overflow-hidden rounded-lg"
                  style={{ width: '100%', aspectRatio: '1 / 1', background: 'rgba(255,255,255,0.05)' }}
                >
                  {dj.profile_image_url && (
                    <img
                      src={getOptimizedImageUrl(dj.profile_image_url, { width: 200 })}
                      alt={dj.stage_name || ''}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
                <p
                  className="truncate"
                  style={{ color: 'rgba(255,255,255,0.96)', fontSize: 12.5, fontWeight: 600 }}
                >
                  {dj.stage_name || '—'}
                </p>
                {dj.city && (
                  <p className="mt-0.5 flex items-center gap-1 truncate" style={{ color: 'rgba(255,255,255,0.36)', fontSize: 10.5 }}>
                    <MapPin className="h-2.5 w-2.5 flex-none" />
                    {dj.city}
                  </p>
                )}
                <p className="mt-1 truncate" style={{ color: '#E8192C', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em' }}>
                  {Math.round(dj.similarity * 100)}% {tt('affinité', 'match', 'afinidad')}
                </p>
              </button>
            ))}
          </div>
        )}

        <p style={{ color: 'rgba(255,255,255,0.36)', fontSize: 10.5, marginTop: 10, lineHeight: 1.5 }}>
          {tt(
            'Affinité calculée entre l’univers de ta soirée (genres, ambiance, lieu) et celui du DJ. À toi de juger le reste.',
            'Affinity computed between your night’s universe (genres, vibe, venue) and the DJ’s. You judge the rest.',
            'Afinidad calculada entre el universo de tu fiesta (géneros, ambiente, lugar) y el del DJ. El resto lo juzgas tú.',
          )}
        </p>
      </div>
    </FadeInView>
  );
}
