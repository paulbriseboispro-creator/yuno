import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { Eye, Music, Tag, Disc3, Globe, Lock, Loader2 } from 'lucide-react';

const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const RED = '#E8192C';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';

type DesignRow = {
  title: string | null;
  description: string | null;
  poster_url: string | null;
  music_genres: string[] | null;
  event_type: string | null;
  visibility: string | null;
  discovery_status: string | null;
};

type Dj = {
  id: string;
  stage_name: string | null;
  first_name: string | null;
  last_name: string | null;
  profile_image_url: string | null;
  music_genres: string[] | null;
};

const EVENT_TYPE_LABELS: Record<string, [string, string, string]> = {
  club: ['Club', 'Club', 'Club'],
  after_party: ['After Party', 'After Party', 'After Party'],
  beach_club: ['Beach Club', 'Beach Club', 'Beach Club'],
  open_air: ['Open Air', 'Open Air', 'Open Air'],
  private_party: ['Soirée privée', 'Private party', 'Fiesta privada'],
};

/**
 * Aperçu LECTURE SEULE du DESIGN, pour la partie qui ne le tient pas.
 *
 * Verrouiller n'est pas aveugler (même règle que CollabOperationsPreview). Celui
 * qui fait tourner la billetterie sans tenir le design doit quand même voir
 * l'affiche, le titre, les genres et le line-up : c'est ce qui pousse ses ventes.
 * Sans cet aperçu, il devait demander une capture d'écran par message.
 *
 * Aucune écriture : le composant lit `events`, `event_djs` et `djs_public` — les
 * mêmes données que la page publique. Il ne contourne aucun garde-fou serveur, il
 * montre exactement ce que le public verra.
 */
export function CollabDesignPreview({ eventId, showChrome = true }: { eventId: string; showChrome?: boolean }) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [row, setRow] = useState<DesignRow | null>(null);
  const [djs, setDjs] = useState<Dj[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const [{ data: ev }, { data: links }] = await Promise.all([
        supabase
          .from('events')
          .select('title, description, poster_url, music_genres, event_type, visibility, discovery_status')
          .eq('id', eventId)
          .maybeSingle(),
        supabase.from('event_djs').select('dj_id').eq('event_id', eventId),
      ]);
      if (!active) return;
      setRow((ev as DesignRow | null) ?? null);

      const djIds = (links as { dj_id: string }[] | null)?.map((l) => l.dj_id) ?? [];
      if (djIds.length) {
        const { data: djRows } = await supabase
          .from('djs_public')
          .select('id, stage_name, first_name, last_name, profile_image_url, music_genres')
          .in('id', djIds);
        if (!active) return;
        // .in() ne garantit pas l'ordre — on rejoue celui d'event_djs.
        const byId = new Map((djRows as Dj[] | null)?.map((d) => [d.id, d]) ?? []);
        setDjs(djIds.map((id) => byId.get(id)).filter(Boolean) as Dj[]);
      } else {
        setDjs([]);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [eventId]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: T3 }} />
      </div>
    );
  }
  if (!row) {
    return <p style={{ color: T3, fontSize: 12 }}>{tt('Design indisponible.', 'Design unavailable.', 'Diseño no disponible.')}</p>;
  }

  const genres = row.music_genres ?? [];
  const typeLabel = row.event_type ? EVENT_TYPE_LABELS[row.event_type] : undefined;
  const isPublic = row.visibility === 'public';
  const discoveryPending = row.discovery_status === 'pending';

  return (
    <div className="space-y-4">
      {showChrome && (
        <div className="flex items-center gap-1.5" style={{ color: T3, fontSize: 11 }}>
          <Eye className="h-3.5 w-3.5" />
          {tt('Aperçu — lecture seule', 'Preview — read only', 'Vista previa — solo lectura')}
        </div>
      )}

      {/* Affiche + titre + type */}
      <div className="flex gap-3">
        {row.poster_url ? (
          <img
            src={getOptimizedImageUrl(row.poster_url, { width: 200 })}
            alt=""
            className="h-24 w-24 flex-none rounded-xl object-cover"
            style={{ border: `1px solid ${BORDER}` }}
          />
        ) : (
          <div className="flex h-24 w-24 flex-none items-center justify-center rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            <Disc3 className="h-6 w-6" style={{ color: T3 }} />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="truncate" style={{ color: T1, fontSize: 15, fontWeight: 640 }}>
            {row.title || tt('Sans titre', 'Untitled', 'Sin título')}
          </p>
          {typeLabel && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 11 }}>
              <Tag className="h-3 w-3" /> {tt(typeLabel[0], typeLabel[1], typeLabel[2])}
            </span>
          )}
          <div className="flex items-center gap-1.5" style={{ color: isPublic ? '#34D399' : T3, fontSize: 11 }}>
            {isPublic ? <Globe className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            {isPublic
              ? discoveryPending
                ? tt('Public · en attente de validation', 'Public · pending review', 'Público · pendiente de validación')
                : tt('Public · listé dans Explore', 'Public · listed in Explore', 'Público · listado en Explore')
              : tt('Privé · accès par lien', 'Private · link access', 'Privado · acceso por enlace')}
          </div>
        </div>
      </div>

      {/* Description */}
      {row.description && (
        <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{row.description}</p>
      )}

      {/* Genres musicaux */}
      {genres.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5" style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            <Music className="h-3 w-3" /> {tt('Genres musicaux', 'Music genres', 'Géneros musicales')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {genres.map((g) => (
              <span key={g} className="rounded-full px-2.5 py-1" style={{ background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.25)', color: RED, fontSize: 11.5, fontWeight: 540 }}>
                {g}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Line-up DJ */}
      <div>
        <p className="mb-1.5 flex items-center gap-1.5" style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          <Disc3 className="h-3 w-3" /> {tt('Line-up DJ', 'DJ line-up', 'Line-up DJ')}
        </p>
        {djs.length === 0 ? (
          <p style={{ color: T3, fontSize: 12 }}>{tt('Aucun DJ annoncé pour le moment.', 'No DJ announced yet.', 'Aún no hay DJ anunciado.')}</p>
        ) : (
          <div className="space-y-1.5">
            {djs.map((dj) => {
              const name = dj.stage_name || [dj.first_name, dj.last_name].filter(Boolean).join(' ') || tt('DJ', 'DJ', 'DJ');
              const genre = (dj.music_genres ?? [])[0];
              return (
                <div key={dj.id} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                  {dj.profile_image_url ? (
                    <img src={getOptimizedImageUrl(dj.profile_image_url, { width: 80 })} alt="" className="h-8 w-8 flex-none rounded-full object-cover object-top" />
                  ) : (
                    <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <Disc3 className="h-4 w-4" style={{ color: T3 }} />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{name}</p>
                    {genre && <p className="truncate" style={{ color: T3, fontSize: 11 }}>{genre}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default CollabDesignPreview;
