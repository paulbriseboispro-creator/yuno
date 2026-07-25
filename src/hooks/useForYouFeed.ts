import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { EventCardData } from '@/components/explore/EventCard';

// Module « Pour toi » (Explore) — données autonomes.
//
// Contrairement à l'ancien rail, ce hook ne recoupe RIEN avec ce qui est déjà
// à l'écran : la RPC renvoie des cartes complètes sur un horizon de 45 jours.
// C'est ce qui lui permet de sortir le samedi parfait dans trois semaines,
// que le reste de la page (bornée à la semaine) ne verra jamais.
//
// La RPC a le droit de se taire : elle renvoie 0 ligne s'il n'y a pas au moins
// 3 soirées qui passent sa porte (z-score dans le vivier de la ville, clubs et
// DJs suivis). Un tableau vide ici signifie « rien à recommander », pas
// « erreur » — le front masque simplement la section.
//
// La RPC ne renvoie plus UNE raison par carte mais la LISTE ORDONNÉE de tous
// les arguments personnels que la carte mérite (du plus spécifique au plus
// générique, terminée par `taste`). C'est ce hook qui tranche, carte par carte,
// en choisissant le premier argument encore inédit sur la rangée : deux cartes
// ne se justifient jamais deux fois pareil. Sans cette passe, un fan mono-genre
// avec une seule soirée aimée reverrait « Comme X » collé sur chaque carte.

export type ForYouReasonCode =
  | 'dj'
  | 'venue'
  | 'venue_return'
  | 'similar'
  | 'top_genre'
  | 'genre'
  | 'budget'
  | 'new_venue'
  | 'taste';

interface RawReason {
  code: ForYouReasonCode;
  value: string | null;
}

export interface ForYouItem {
  event: EventCardData;
  reasonCode: ForYouReasonCode;
  reasonValue: string | null;
}

interface ForYouRow {
  event_id: string;
  event_slug: string | null;
  organizer_slug: string | null;
  event_title: string;
  poster_url: string | null;
  starts_at: string;
  ends_at: string | null;
  venue_id: string | null;
  venue_name: string | null;
  venue_city: string | null;
  organizer_name: string | null;
  min_price: number | null;
  genres: string[] | null;
  reasons: RawReason[] | null;
}

// Clé d'unicité d'un argument : même code + même valeur = même justification.
// Deux DJ suivis distincts (« BYAO joue » / « ANDREFLO joue ») ou deux clubs
// distincts gardent des clés différentes et coexistent ; c'est voulu, la
// variété vient de vrais signaux, pas d'un habillage.
const reasonKey = (r: RawReason) => `${r.code}|${(r.value ?? '').trim().toLowerCase()}`;

// Attribue à chaque carte, dans l'ordre d'affichage (déjà trié par score), le
// premier argument encore inutilisé sur la rangée. Si tout est déjà pris (profil
// à signal unique), on retombe sur l'argument le moins servi — jamais deux fois
// le même tant qu'une alternative existe. `taste` clôt chaque liste : repli garanti.
function assignDiverseReasons(rows: ForYouRow[]): RawReason[] {
  const used = new Map<string, number>();
  return rows.map((row) => {
    const list = row.reasons?.length ? row.reasons : [{ code: 'taste' as const, value: null }];
    let chosen = list.find((r) => !used.has(reasonKey(r)));
    if (!chosen) {
      chosen = list.reduce((best, r) =>
        (used.get(reasonKey(r)) ?? 0) < (used.get(reasonKey(best)) ?? 0) ? r : best);
    }
    used.set(reasonKey(chosen), (used.get(reasonKey(chosen)) ?? 0) + 1);
    return chosen;
  });
}

export function useForYouFeed(city: string | null, limit = 12) {
  const [items, setItems] = useState<ForYouItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || cancelled) return;

      const { data, error } = await supabase.rpc('get_for_you_feed', {
        p_city: city || undefined,
        p_limit: limit,
      });
      if (cancelled || error || !Array.isArray(data)) {
        if (error) console.error('for-you feed error:', error.message);
        return;
      }

      const rows = data as unknown as ForYouRow[];
      const reasons = assignDiverseReasons(rows);

      setItems(rows.map((r, i) => ({
        event: {
          id: r.event_id,
          slug: r.event_slug,
          organizerSlug: r.organizer_slug,
          title: r.event_title,
          posterUrl: r.poster_url,
          startAt: r.starts_at,
          endAt: r.ends_at,
          // Même composition que l'Explorer : « Organisateur · Club » quand la
          // soirée est portée par un organisateur dans un club partenaire.
          venueName: r.organizer_name
            ? `${r.organizer_name}${r.venue_name ? ` · ${r.venue_name}` : ''}`
            : r.venue_name || '',
          venueSlug: r.venue_id || '',
          venueCity: r.venue_city || '',
          minPrice: r.min_price,
          genres: r.genres || [],
          interestedCount: 0,
          percentSold: 0,
          tablesRemaining: null,
          isTrending: false,
          isOrganizerLed: Boolean(r.organizer_name),
          organizerName: r.organizer_name ?? undefined,
        },
        reasonCode: reasons[i].code,
        reasonValue: reasons[i].value,
      })));
    })();

    return () => { cancelled = true; };
  }, [city, limit]);

  return items;
}
