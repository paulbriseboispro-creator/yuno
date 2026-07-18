// Mode Live — bouteilles vendables SANS table (opt-in club + opt-out par
// bouteille). Retrait au bar via QR : la commande passe par le cart / checkout
// boissons classique avec kind='bottle', validée serveur contre vip_menu_items.
// Les bouteilles à mixer (needs_mixer) réutilisent MixerSuggestionDialog.
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Wine, Plus, Zap, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { MixerSuggestionDialog } from '@/components/vip/MixerSuggestionDialog';
import { useStore } from '@/store/useStore';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { useLiveMode } from '@/contexts/LiveModeContext';
import { useLiveInstantCheckout } from '@/hooks/useLiveInstantCheckout';
import { transitions } from '@/lib/motion';

interface BottleItem {
  id: string;
  name: string;
  brand: string | null;
  volume_cl: number | null;
  category: string;
  price: number;
  image_url: string | null;
  needs_mixer: boolean;
  max_mixers: number;
}

const MIXER_CATEGORIES = ['soft', 'mixer'];
const EXCLUDED_CATEGORIES = ['mixer', 'extra'];

export function LiveBottleSection() {
  const { session } = useLiveMode();
  const { t } = useLanguage();
  const { toast } = useToast();
  const addBottleToCart = useStore((state) => state.addBottleToCart);
  const [bottles, setBottles] = useState<BottleItem[]>([]);
  const [mixers, setMixers] = useState<BottleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingBottle, setPendingBottle] = useState<BottleItem | null>(null);
  // Le picker de mixers sert soit à ajouter au panier, soit à payer direct.
  const [pendingIntent, setPendingIntent] = useState<'add' | 'pay'>('add');
  const { payNow, payingId } = useLiveInstantCheckout(
    session ? { eventId: session.eventId, venueId: session.venueId } : null
  );

  const venueId = session?.venueId;

  useEffect(() => {
    if (!venueId) return;
    const fetchBottles = async () => {
      const { data } = await supabase
        .from('vip_menu_items')
        .select('id, name, brand, volume_cl, category, price, image_url, needs_mixer, max_mixers, solo_sale_enabled')
        .eq('venue_id', venueId)
        .eq('is_active', true)
        .order('position', { ascending: true });
      const items = ((data ?? []) as unknown as (BottleItem & { solo_sale_enabled?: boolean })[]);
      setBottles(
        items.filter(
          (i) => !EXCLUDED_CATEGORIES.includes(i.category) && i.solo_sale_enabled !== false
        )
      );
      setMixers(items.filter((i) => MIXER_CATEGORIES.includes(i.category)));
      setLoading(false);
    };
    fetchBottles();
  }, [venueId]);

  const addBottle = (bottle: BottleItem, selectedMixers: { id: string; name: string; price: number }[]) => {
    if (!session) return;
    addBottleToCart(
      { id: bottle.id, name: bottle.name, price: Number(bottle.price), imgUrl: bottle.image_url ?? undefined },
      selectedMixers,
      session.eventId,
      session.eventTitle
    );
    toast({ title: t('cart.added'), description: `${bottle.name} · ${t('live.bottlePickup')}` });
  };

  const payBottle = (bottle: BottleItem, selectedMixers: { id: string; name: string; price: number }[]) => {
    payNow({
      id: bottle.id,
      kind: 'bottle',
      mixerIds: selectedMixers.map((m) => m.id),
      fallbackAddToCart: () => addBottle(bottle, selectedMixers),
    });
  };

  // Ajouter/payer : si la bouteille exige un mixer, on ouvre le picker d'abord
  // en mémorisant l'intention (add vs pay).
  const handleAction = (bottle: BottleItem, intent: 'add' | 'pay') => {
    if (bottle.needs_mixer && mixers.length > 0) {
      setPendingIntent(intent);
      setPendingBottle(bottle);
      return;
    }
    if (intent === 'pay') payBottle(bottle, []);
    else addBottle(bottle, []);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (bottles.length === 0) {
    return <p className="py-8 text-center text-muted-foreground text-sm">{t('venue.noDrinks')}</p>;
  }

  return (
    <>
      <p
        className="mb-3 font-mono uppercase"
        style={{ fontSize: 10, letterSpacing: '0.08em', color: '#9A9A9A' }}
      >
        {t('live.bottlePickup')}
      </p>
      <div className="grid grid-cols-2 gap-3">
        {bottles.map((bottle) => {
          const paying = payingId === bottle.id;
          return (
            <div
              key={bottle.id}
              className="flex flex-col overflow-hidden"
              style={{ background: '#000', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}
            >
              {/* Cadre 3:4, bouteille toujours en object-contain (jamais crop) */}
              <div
                className="relative w-full"
                style={{ aspectRatio: '3 / 4', background: '#000' }}
              >
                {bottle.image_url ? (
                  <img
                    src={bottle.image_url}
                    alt={bottle.name}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-contain p-3 drop-shadow-[0_6px_14px_rgba(0,0,0,0.5)]"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Wine className="h-8 w-8" style={{ color: 'rgba(232,25,44,0.6)' }} />
                  </div>
                )}
                {bottle.needs_mixer && (
                  <span
                    className="absolute right-2 top-2 rounded px-1.5 py-0.5 font-mono font-bold uppercase"
                    style={{ fontSize: 8, letterSpacing: '0.06em', color: '#C8C8CC', background: 'rgba(10,10,10,0.7)', border: '1px solid rgba(255,255,255,0.12)' }}
                  >
                    🧊 {t('vipMenu.needsMixerBadge')}
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col px-3 pt-2.5">
                <p
                  className="font-display font-bold uppercase leading-tight text-white line-clamp-2"
                  style={{ fontSize: 12.5, letterSpacing: '-0.005em' }}
                >
                  {bottle.name}
                </p>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <span className="font-mono uppercase" style={{ fontSize: 9, letterSpacing: '0.06em', color: '#5A5A5E' }}>
                    {[bottle.brand, bottle.volume_cl ? `${bottle.volume_cl}cl` : null].filter(Boolean).join(' · ')}
                  </span>
                  <span className="font-mono font-bold text-white" style={{ fontSize: 14 }}>
                    {Number(bottle.price)}€
                  </span>
                </div>
              </div>

              {/* Double CTA : ajouter au panier / payer direct */}
              <div className="mt-2.5 grid grid-cols-[1fr_auto] gap-1.5 p-2.5 pt-0">
                <motion.button
                  type="button"
                  onClick={() => handleAction(bottle, 'add')}
                  disabled={paying}
                  whileTap={{ scale: 0.97 }}
                  transition={transitions.pressFeedback}
                  className="flex min-h-[44px] items-center justify-center gap-1.5 rounded font-mono font-bold uppercase outline-none disabled:opacity-40"
                  style={{ fontSize: 10.5, letterSpacing: '0.06em', color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('live.addToCart')}
                </motion.button>
                <motion.button
                  type="button"
                  onClick={() => handleAction(bottle, 'pay')}
                  disabled={paying}
                  whileTap={{ scale: 0.97 }}
                  transition={transitions.pressFeedback}
                  aria-label={t('live.payNow')}
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded px-3 font-mono font-bold uppercase text-white outline-none disabled:opacity-60"
                  style={{ fontSize: 10.5, letterSpacing: '0.06em', background: '#E8192C', boxShadow: '0 4px 14px rgba(232,25,44,0.3)' }}
                >
                  {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                  {!paying && t('live.payNow')}
                </motion.button>
              </div>
            </div>
          );
        })}
      </div>

      <MixerSuggestionDialog
        open={!!pendingBottle}
        onOpenChange={(open) => {
          if (!open) setPendingBottle(null);
        }}
        spiritName={pendingBottle?.name ?? ''}
        mixers={mixers.map((m) => ({ id: m.id, name: m.name, price: Number(m.price), image_url: m.image_url }))}
        maxMixers={pendingBottle?.max_mixers ?? 1}
        onConfirm={(selected) => {
          if (pendingBottle) {
            const mix = selected.map((m) => ({ id: m.id, name: m.name, price: Number(m.price) }));
            if (pendingIntent === 'pay') payBottle(pendingBottle, mix);
            else addBottle(pendingBottle, mix);
          }
          setPendingBottle(null);
        }}
      />
    </>
  );
}
