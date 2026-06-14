import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Wine, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { OrgCard, RED, T1, T3, BORDER, INNER_BG } from '@/components/org-ui';

interface Drink {
  id: string;
  name: string;
  price: number;
  img_url: string | null;
  collection: string | null;
  active: boolean;
}

interface Props {
  eventId: string;
}

/**
 * Shows the drinks menu of the partner venue on the organizer's event page.
 * Visible only when the event is hosted at a partner club with an active partnership
 * (which means drinks revenue can flow through the configured split).
 */
export function OrgEventDrinksMenu({ eventId }: Props) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [venue, setVenue] = useState<{ id: string; name: string } | null>(null);
  const [splitPct, setSplitPct] = useState<{ org: number; venue: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: ev } = await supabase
        .from('events')
        .select('id, venue_id, partner_venue_id, organizer_user_id, partner_organizer_id, revenue_split_rules')
        .eq('id', eventId)
        .maybeSingle();

      if (cancelled || !ev) { setLoading(false); return; }

      const hostVenueId = ev.venue_id || ev.partner_venue_id;
      if (!hostVenueId) { setLoading(false); return; }

      const { data: venueRow } = await supabase
        .from('venues').select('id, name').eq('id', hostVenueId).maybeSingle();
      if (cancelled) return;
      if (venueRow) setVenue(venueRow);

      // Resolve partnership default rules to know if drinks revenue is shared
      const orgId = ev.organizer_user_id || ev.partner_organizer_id;
      let rules = ev.revenue_split_rules as any;
      if (!rules && orgId) {
        const { data: partnership } = await supabase
          .from('venue_organizer_partnerships')
          .select('default_split_rules, status')
          .eq('venue_id', hostVenueId)
          .eq('organizer_user_id', orgId)
          .eq('status', 'active')
          .maybeSingle();
        rules = partnership?.default_split_rules ?? null;
      }
      if (rules?.drinks) {
        setSplitPct({
          org: Number(rules.drinks.organizer_pct ?? 0),
          venue: Number(rules.drinks.venue_pct ?? 100),
        });
      } else {
        setSplitPct({ org: 0, venue: 100 });
      }

      const { data: ds } = await supabase
        .from('drinks')
        .select('id, name, price, img_url, collection, active')
        .eq('venue_id', hostVenueId)
        .eq('active', true)
        .order('position', { ascending: true })
        .limit(24);
      if (!cancelled) setDrinks(ds || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  if (loading || !venue) return null;
  if (drinks.length === 0) return null;

  return (
    <OrgCard style={{ padding: 20 }}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2" style={{ color: T1, fontSize: 15, fontWeight: 600 }}>
          <Wine className="h-4 w-4" style={{ color: RED }} />
          {t('Carte des boissons', 'Drinks menu')}
        </span>
        <Link
          to={`/club/${venue.id}`}
          className="inline-flex items-center gap-1 hover:underline"
          style={{ color: RED, fontSize: 11.5 }}
        >
          {venue.name} <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      <p className="mt-1" style={{ color: T3, fontSize: 11.5 }}>
        {splitPct && splitPct.org > 0
          ? t(
              `Servies par ${venue.name} — votre part sur les boissons : ${splitPct.org}%`,
              `Served by ${venue.name} — your drinks share: ${splitPct.org}%`,
              `Servidas por ${venue.name} — tu parte sobre las bebidas: ${splitPct.org}%`,
            )
          : t(
              `Servies par ${venue.name} — la totalité des ventes boissons revient au club.`,
              `Served by ${venue.name} — drinks revenue stays with the club.`,
              `Servidas por ${venue.name} — los ingresos de bebidas son íntegros para el club.`,
            )}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {drinks.map((d) => (
          <div
            key={d.id}
            className="flex flex-col items-center rounded-xl p-2 text-center"
            style={{ border: `1px solid ${BORDER}`, background: INNER_BG }}
          >
            {d.img_url ? (
              <img
                src={d.img_url}
                alt={d.name}
                className="aspect-square w-full rounded-md object-contain"
                style={{ background: 'rgba(0,0,0,0.4)' }}
                loading="lazy"
              />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center rounded-md" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <Wine className="h-6 w-6" style={{ color: T3 }} />
              </div>
            )}
            <p className="mt-1.5 line-clamp-2" style={{ color: T1, fontSize: 11.5, fontWeight: 560 }}>{d.name}</p>
            <p className="mt-0.5" style={{ color: RED, fontSize: 11.5, fontWeight: 600 }}>
              {Number(d.price).toFixed(2)} €
            </p>
          </div>
        ))}
      </div>
    </OrgCard>
  );
}
