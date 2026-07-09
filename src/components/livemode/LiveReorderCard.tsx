// Mode Live — « Recommander pareil » : repeuple le cart avec la dernière
// commande payée de la soirée en un tap. Les lignes crédit (isCreditRedemption)
// et les bouteilles sont exclues : on recommande la tournée de boissons.
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useStore } from '@/store/useStore';
import { useLanguage } from '@/contexts/LanguageContext';
import { useLiveMode } from '@/contexts/LiveModeContext';
import { Drink } from '@/types';
import { transitions } from '@/lib/motion';

interface OrderItemRow {
  drinkId?: string;
  id?: string;
  name?: string;
  qty?: number;
  quantity?: number;
  collection?: string;
  kind?: string;
  isCreditRedemption?: boolean;
}

export function LiveReorderCard() {
  const { user } = useAuth();
  const { session } = useLiveMode();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const addToCart = useStore((state) => state.addToCart);
  const [lastItems, setLastItems] = useState<OrderItemRow[]>([]);

  useEffect(() => {
    if (!user || !session) return;
    const fetchLast = async () => {
      const { data } = await supabase
        .from('orders')
        .select('items, total, status')
        .eq('user_id', user.id)
        .eq('event_id', session.eventId)
        .in('status', ['paid', 'confirmed', 'preparing', 'served'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const items = ((data?.items ?? []) as OrderItemRow[]).filter(
        (i) => !i.isCreditRedemption && i.kind !== 'bottle' && (i.drinkId || i.id)
      );
      setLastItems(items);
    };
    fetchLast();
  }, [user, session?.eventId]);

  if (!session || lastItems.length === 0) return null;

  const summary = lastItems
    .map((i) => `${i.qty ?? i.quantity ?? 1}× ${i.name ?? ''}`)
    .join(' · ');

  const handleReorder = async () => {
    // Re-résout les boissons en base : prix du moment, items désactivés exclus.
    const ids = lastItems.map((i) => i.drinkId ?? i.id).filter(Boolean) as string[];
    const { data } = await supabase
      .from('drinks')
      .select('*')
      .in('id', ids)
      .eq('active', true);
    const byId = new Map((data ?? []).map((d: Record<string, unknown>) => [d.id as string, d]));
    lastItems.forEach((item) => {
      const raw = byId.get((item.drinkId ?? item.id) as string);
      if (!raw) return;
      const drink: Drink = {
        id: raw.id as string,
        name: raw.name as string,
        description: (raw.description as string) || '',
        price: Number(raw.price),
        promoPrice: raw.promo_price ? Number(raw.promo_price) : undefined,
        presalePrice: raw.presale_price ? Number(raw.presale_price) : undefined,
        presaleActive: (raw.presale_active as boolean) || false,
        imgUrl: raw.img_url as string,
        venueId: raw.venue_id as string,
        active: raw.active as boolean,
        collection: raw.collection as Drink['collection'],
      };
      const qty = item.qty ?? item.quantity ?? 1;
      for (let i = 0; i < qty; i++) {
        addToCart(drink, session.eventId, session.eventTitle, session.eventStartAt);
      }
    });
    navigate('/cart');
  };

  return (
    <section className="mx-4 mt-4">
      <motion.button
        type="button"
        onClick={handleReorder}
        whileTap={{ scale: 0.98 }}
        transition={transitions.pressFeedback}
        className="flex w-full items-center gap-3 p-4 text-left"
        style={{
          background: 'rgba(232,25,44,0.06)',
          border: '1px solid rgba(232,25,44,0.35)',
          borderRadius: 10,
        }}
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'rgba(232,25,44,0.14)' }}
        >
          <RotateCcw className="h-4 w-4" style={{ color: '#E8192C' }} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block font-display font-bold uppercase text-white"
            style={{ fontSize: 13.5, letterSpacing: '-0.005em' }}
          >
            {t('live.reorderTitle')}
          </span>
          <span
            className="block truncate font-mono uppercase mt-0.5"
            style={{ fontSize: 10, letterSpacing: '0.05em', color: '#9A9A9A' }}
          >
            {summary}
          </span>
        </span>
        <span
          className="shrink-0 font-mono font-bold uppercase"
          style={{ fontSize: 10, letterSpacing: '0.1em', color: '#E8192C' }}
        >
          {t('live.reorderCta')}
        </span>
      </motion.button>
    </section>
  );
}
