// Carte rappel boissons sur la confirmation billet — deuxième chance d'upsell
// pour ceux qui ont passé la page /order/upsell. Auto-éligible : rend null si
// le club ne vend pas de boissons, si l'upsell post-achat est coupé, ou si le
// client a déjà une commande boissons pour cette soirée.
// Voir docs/SYSTEME_VENTE_BOISSONS.md.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wine, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';

interface DrinksUpsellCardProps {
  ticketId: string;
  venueId?: string;
  eventId?: string;
}

export function DrinksUpsellCard({ ticketId, venueId, eventId }: DrinksUpsellCardProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [state, setState] = useState<{ show: boolean; hasPresale: boolean }>({ show: false, hasPresale: false });

  useEffect(() => {
    if (!venueId || !user) return;
    let cancelled = false;
    (async () => {
      try {
        // post_checkout_upsell_enabled pas encore dans types.ts (généré après
        // db push) → cast, même pattern que la page upsell.
        const { data: venue } = (await supabase
          .from('venues')
          .select('menu_enabled, post_checkout_upsell_enabled')
          .eq('id', venueId)
          .maybeSingle()) as unknown as { data: { menu_enabled: boolean | null; post_checkout_upsell_enabled: boolean | null } | null };
        if (!venue || venue.menu_enabled === false || venue.post_checkout_upsell_enabled === false) return;

        // Déjà une commande boissons pour cette soirée ? Pas de relance.
        if (eventId) {
          const { data: existing } = await supabase
            .from('orders')
            .select('id')
            .eq('user_id', user.id)
            .eq('event_id', eventId)
            .in('status', ['pending', 'paid'])
            .limit(1);
          if (existing && existing.length > 0) return;
        }

        const { data: rows } = await supabase
          .from('drinks')
          .select('presale_active, presale_price')
          .eq('venue_id', venueId)
          .eq('active', true)
          .limit(30);
        if (!rows || rows.length === 0) return;
        const hasPresale = rows.some((d) => d.presale_active && d.presale_price);
        if (!cancelled) setState({ show: true, hasPresale });
      } catch {
        // Best-effort.
      }
    })();
    return () => { cancelled = true; };
  }, [venueId, eventId, user]);

  if (!state.show) return null;

  // Wrapper de section inclus ici : quand la carte est inéligible (null), la
  // confirmation ne doit montrer ni bordure ni espace vide.
  return (
    <section className="py-7" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
      <p className="section-label-ruled mb-3">{t('drinksUpsell.title')}</p>
      <p className="font-sans mb-5" style={{ fontSize: '14px', lineHeight: 1.55, color: '#E5E5E5' }}>
        {state.hasPresale ? t('drinksUpsell.descPresale') : t('drinksUpsell.desc')}
      </p>
      <button className="btn btn--primary w-full" onClick={() => navigate(`/order/upsell?ticket=${ticketId}`)}>
        <Wine className="h-4 w-4 mr-2" />
        {t('drinksUpsell.cta')}
        <ArrowRight className="h-4 w-4 ml-2" />
      </button>
    </section>
  );
}
