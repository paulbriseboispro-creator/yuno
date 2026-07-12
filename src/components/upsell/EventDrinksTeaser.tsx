// Teaser boissons sur la page soirée — l'éducation AVANT l'achat du billet.
//
// Remplace l'ancien « détour club » (les cartes soirée renvoyaient vers la page
// club pour exposer la carte boissons) : maintenant que la navigation va direct
// à la soirée, ce bandeau rappelle que les boissons se commandent dans l'app
// (prix presale après l'achat du billet, retrait sans file au bar le soir J).
// Purement informatif : l'achat se fait sur /order/upsell (post-checkout) et en
// Mode Live. Voir docs/SYSTEME_VENTE_BOISSONS.md.
//
// Anon-safe : ne lit que des colonnes accessibles aux visiteurs non connectés
// (venues.menu_enabled est dans PUBLIC_VENUE_COLUMNS, drinks est public).
// Rend null tant que l'éligibilité n'est pas confirmée — zéro layout shift.
import { useEffect, useState } from 'react';
import { Wine, QrCode, Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { FadeInView } from '@/components/motion';

interface EventDrinksTeaserProps {
  venueId: string;
  /** Si fourni, vérifie events.alcohol_free (soirée sans alcool → pas de teaser). */
  eventId?: string;
}

export function EventDrinksTeaser({ venueId, eventId }: EventDrinksTeaserProps) {
  const { t } = useLanguage();
  const [state, setState] = useState<{ show: boolean; hasPresale: boolean }>({ show: false, hasPresale: false });

  useEffect(() => {
    if (!venueId) return;
    let cancelled = false;
    (async () => {
      try {
        if (eventId) {
          const { data: ev } = await supabase
            .from('events')
            .select('alcohol_free')
            .eq('id', eventId)
            .maybeSingle();
          if (ev?.alcohol_free) return;
        }
        const { data: venue } = await supabase
          .from('venues')
          .select('menu_enabled')
          .eq('id', venueId)
          .maybeSingle();
        if (!venue || venue.menu_enabled === false) return;
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
        // Best-effort : un teaser qui ne charge pas ne doit rien casser.
      }
    })();
    return () => { cancelled = true; };
  }, [venueId, eventId]);

  if (!state.show) return null;

  return (
    <FadeInView as="section" style={{ padding: 'clamp(28px, 4vw, 36px) 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center justify-between mb-4">
        <p className="section-label-ruled">{t('drinksTeaser.title')}</p>
        {state.hasPresale && (
          <span
            className="font-mono uppercase shrink-0"
            style={{ fontSize: '9.5px', letterSpacing: '0.1em', color: '#E8192C', background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.3)', borderRadius: 3, padding: '3px 7px' }}
          >
            {t('drinksTeaser.presaleBadge')}
          </span>
        )}
      </div>
      <p className="font-sans mb-4" style={{ fontSize: '13.5px', color: '#9A9A9A', lineHeight: 1.55 }}>
        {state.hasPresale ? t('drinksTeaser.descPresale') : t('drinksTeaser.desc')}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {[
          { Icon: Wine, label: t('drinksTeaser.step1') },
          { Icon: QrCode, label: t('drinksTeaser.step2') },
          { Icon: Zap, label: t('drinksTeaser.step3') },
        ].map(({ Icon, label }) => (
          <div
            key={label}
            className="flex flex-col items-center text-center gap-2"
            style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '12px 8px' }}
          >
            <Icon style={{ width: 16, height: 16, color: '#E8192C' }} />
            <span className="font-sans" style={{ fontSize: '11px', color: '#E5E5E5', lineHeight: 1.3 }}>{label}</span>
          </div>
        ))}
      </div>
    </FadeInView>
  );
}
