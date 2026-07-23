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

export type ForYouReasonCode = 'dj' | 'venue' | 'similar' | 'genre' | 'taste';

export interface ForYouItem {
  event: EventCardData;
  reasonCode: ForYouReasonCode;
  reasonValue: string | null;
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

      setItems(data.map((r) => ({
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
        reasonCode: (r.reason_code || 'taste') as ForYouReasonCode,
        reasonValue: r.reason_value,
      })));
    })();

    return () => { cancelled = true; };
  }, [city, limit]);

  return items;
}
