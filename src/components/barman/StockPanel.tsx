import { useEffect, useState } from 'react';
import { PackageX } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const T1     = 'rgba(255,255,255,0.96)';
const T3     = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const TILE_BG = 'rgba(255,255,255,0.025)';

interface DrinkStock {
  id: string;
  name: string;
  collection: string;
  out_of_stock: boolean;
}

interface Props {
  venueId: string;
}

/**
 * Panneau « Stock » du barman : marquer un produit en rupture en un switch.
 * Le produit reste au menu client, grisé « Épuisé », et la rupture remonte
 * en direct dans la station Bar du centre de commandement owner (la table
 * drinks est déjà publiée en realtime). Écrit via le RPC SECURITY DEFINER
 * staff_set_drink_stock — le barman ne touche jamais prix ni curation.
 */
export function StockPanel({ venueId }: Props) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [drinks, setDrinks] = useState<DrinkStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !venueId) return;
    setLoading(true);
    (supabase as any)
      .from('drinks')
      .select('id, name, collection, out_of_stock')
      .eq('venue_id', venueId)
      .eq('active', true)
      .order('name')
      .then(({ data }: { data: DrinkStock[] | null }) => {
        setDrinks(data || []);
        setLoading(false);
      });
  }, [open, venueId]);

  const toggle = async (drink: DrinkStock, out: boolean) => {
    setPending(drink.id);
    const { error } = await supabase.rpc('staff_set_drink_stock' as never, {
      p_drink_id: drink.id,
      p_out: out,
    } as never);
    setPending(null);
    if (error) {
      toast.error(t('barman.stock.error'));
      return;
    }
    setDrinks(prev => prev.map(d => (d.id === drink.id ? { ...d, out_of_stock: out } : d)));
    toast.success(out
      ? t('barman.stock.markedOut').replace('{name}', drink.name)
      : t('barman.stock.markedBack').replace('{name}', drink.name));
  };

  const outCount = drinks.filter(d => d.out_of_stock).length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="h-11 w-11 flex-none p-0 sm:h-8 sm:w-auto sm:px-3 gap-1.5 relative">
          <PackageX className="h-4 w-4" />
          <span className="hidden sm:inline text-xs">{t('barman.stock.button')}</span>
          {outCount > 0 && (
            <span
              className="absolute right-0.5 top-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold tabular-nums sm:-top-1 sm:-right-1"
              style={{ background: '#E8192C', color: '#fff' }}
            >
              {outCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        {/* Safe areas iOS : le panneau est plein écran en hauteur — le titre passerait
            sous l'encoche et la dernière ligne sous la barre d'accueil. */}
        <SheetHeader style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
          <SheetTitle>{t('barman.stock.title')}</SheetTitle>
          <SheetDescription>{t('barman.stock.desc')}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-1.5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}>
          {loading && <p style={{ color: T3, fontSize: 13 }}>…</p>}
          {!loading && drinks.length === 0 && (
            <p style={{ color: T3, fontSize: 13 }}>{t('barman.stock.empty')}</p>
          )}
          {drinks.map(drink => (
            <div
              key={drink.id}
              className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl"
              style={{ background: TILE_BG, border: `1px solid ${BORDER}`, opacity: drink.out_of_stock ? 0.75 : 1 }}
            >
              <div className="min-w-0">
                <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560, textDecoration: drink.out_of_stock ? 'line-through' : 'none' }}>
                  {drink.name}
                </p>
                <p style={{ color: T3, fontSize: 10.5, textTransform: 'capitalize' }}>{drink.collection}</p>
              </div>
              <div className="flex items-center gap-2 flex-none">
                {drink.out_of_stock && (
                  <span style={{ color: '#FF5C63', fontSize: 10.5, fontWeight: 600 }}>{t('barman.stock.outBadge')}</span>
                )}
                <Switch
                  checked={drink.out_of_stock}
                  disabled={pending === drink.id}
                  onCheckedChange={(checked) => toggle(drink, checked)}
                />
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
