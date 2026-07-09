// Mode Live — hero de contexte : le poster de la soirée en fond, le titre, la
// date, le line-up DJ et l'ambiance (genres musicaux). Donne au client le
// sentiment d'être À CETTE soirée, pas sur un menu générique. Purement visuel
// (aucune action) — l'ordering vit sous ce hero.
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Disc3, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { useLanguage } from '@/contexts/LanguageContext';
import { useLiveMode } from '@/contexts/LiveModeContext';
import { transitions } from '@/lib/motion';

interface LineupDj {
  id: string;
  name: string;
  image: string | null;
  genre: string | null;
}

export function LiveEventContext() {
  const { session } = useLiveMode();
  const { t, language } = useLanguage();
  const [poster, setPoster] = useState<string | null>(null);
  const [djs, setDjs] = useState<LineupDj[]>([]);
  const [genres, setGenres] = useState<string[]>([]);

  const eventId = session?.eventId;

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;

    const fetchContext = async () => {
      const { data: ev } = await supabase
        .from('events')
        .select('poster_url, image_url, music_genres')
        .eq('id', eventId)
        .maybeSingle();
      if (cancelled) return;
      if (ev) {
        setPoster((ev.poster_url as string) || (ev.image_url as string) || null);
        setGenres(((ev.music_genres as string[]) ?? []).slice(0, 3));
      }

      // Line-up : event_djs → djs_public (jamais la table djs, RLS anon).
      const { data: eventDjs } = await supabase
        .from('event_djs')
        .select('dj_id')
        .eq('event_id', eventId);
      const djIds = (eventDjs ?? []).map((e: { dj_id: string }) => e.dj_id).filter(Boolean);
      if (djIds.length > 0) {
        const { data: rows } = await supabase
          .from('djs_public')
          .select('id, stage_name, first_name, last_name, profile_image_url, music_genres')
          .in('id', djIds);
        if (cancelled) return;
        const ordered = djIds
          .map((id) => (rows ?? []).find((r: { id: string }) => r.id === id))
          .filter(Boolean)
          .slice(0, 4)
          .map((r: Record<string, unknown>) => ({
            id: r.id as string,
            name:
              (r.stage_name as string) ||
              [r.first_name, r.last_name].filter(Boolean).join(' ') ||
              'DJ',
            image: (r.profile_image_url as string) || null,
            genre: ((r.music_genres as string[]) ?? [])[0] ?? null,
          }));
        setDjs(ordered);
      }
    };

    fetchContext();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (!session) return null;

  const dateLabel = new Date(session.eventStartAt).toLocaleDateString(
    language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR',
    { weekday: 'long', day: 'numeric', month: 'long' }
  );

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={transitions.reveal}
      className="relative overflow-hidden"
    >
      {/* Poster en fond, fondu vers le noir de la surface */}
      <div className="relative h-56 w-full">
        {poster ? (
          <img
            src={getOptimizedImageUrl(poster, { width: 800, height: 600, quality: 72 })}
            alt={session.eventTitle}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: 'radial-gradient(120% 80% at 50% 0%, rgba(232,25,44,0.28), #0A0A0A 70%)' }}
          />
        )}
        {/* Voile + fondu bas pour la lisibilité et la continuité avec /live */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(10,10,10,0.35) 0%, rgba(10,10,10,0.55) 45%, #0A0A0A 100%)',
          }}
        />

        {/* Bloc titre + date, ancré en bas du poster */}
        <div className="absolute inset-x-0 bottom-0 px-4 pb-3">
          <div className="mx-auto max-w-lg">
            <span
              className="inline-flex items-center gap-1.5 font-mono font-bold uppercase"
              style={{ fontSize: 10, letterSpacing: '0.12em', color: '#E8192C' }}
            >
              <MapPin className="h-3 w-3" />
              {session.venueName}
            </span>
            <h1
              className="mt-1 font-display font-bold uppercase text-white"
              style={{ fontSize: 27, letterSpacing: '-0.02em', lineHeight: 1.02 }}
            >
              {session.eventTitle}
            </h1>
            <p
              className="mt-1 font-mono uppercase"
              style={{ fontSize: 10.5, letterSpacing: '0.08em', color: '#C8C8CC' }}
            >
              {dateLabel}
            </p>
          </div>
        </div>
      </div>

      {/* Line-up DJ + ambiance */}
      {(djs.length > 0 || genres.length > 0) && (
        <div className="mx-auto max-w-lg px-4 pb-1 pt-3">
          {djs.length > 0 && (
            <div className="mb-3">
              <p
                className="mb-2 flex items-center gap-1.5 font-mono font-bold uppercase"
                style={{ fontSize: 9.5, letterSpacing: '0.12em', color: '#5A5A5E' }}
              >
                <Disc3 className="h-3 w-3" style={{ color: '#E8192C' }} />
                {t('live.lineup')}
              </p>
              <div className="flex gap-2.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {djs.map((dj, i) => (
                  <div key={dj.id} className="flex shrink-0 items-center gap-2">
                    <span
                      className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full"
                      style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.1)' }}
                    >
                      {dj.image ? (
                        <img
                          src={getOptimizedImageUrl(dj.image, { width: 72, height: 72, quality: 70 })}
                          alt={dj.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Disc3 className="h-4 w-4" style={{ color: '#5A5A5E' }} />
                      )}
                    </span>
                    <span className="pr-1">
                      <span
                        className="block font-display font-bold uppercase text-white"
                        style={{ fontSize: 11.5, letterSpacing: '-0.005em', lineHeight: 1.1 }}
                      >
                        {i === 0 ? `★ ${dj.name}` : dj.name}
                      </span>
                      {dj.genre && (
                        <span
                          className="block font-mono uppercase"
                          style={{ fontSize: 8.5, letterSpacing: '0.06em', color: '#5A5A5E' }}
                        >
                          {dj.genre}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {genres.map((g) => (
                <span
                  key={g}
                  className="rounded-full px-2 py-0.5 font-mono font-bold uppercase"
                  style={{
                    fontSize: 8.5,
                    letterSpacing: '0.08em',
                    color: '#C8C8CC',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  {g}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </motion.section>
  );
}
