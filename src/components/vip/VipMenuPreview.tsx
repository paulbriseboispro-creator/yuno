import { useEffect, useState } from 'react';
import { translate } from '@/i18n/orgTranslate';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Wine, ChevronDown } from 'lucide-react';

// Vitrine menu VIP dans le tunnel de réservation (idée #2).
// Read-only. Respecte le réglage club `vip_menu_visibility` :
//   'hidden'    -> ne rend rien
//   'no_prices' -> bouteilles sans prix
//   'full'      -> bouteilles + prix
// Restreint aux items éligibles au pack/zone (vip_menu_eligibility) quand le club a curé,
// sinon montre tout le menu actif du club.

interface MenuItem {
  id: string;
  name: string;
  category: string;
  brand: string | null;
  price: number;
  image_url: string | null;
  volume_cl: number | null;
}

interface Eligibility {
  menu_item_id: string;
  pack_id: string | null;
  zone_id: string | null;
  custom_price: number | null;
  is_included: boolean | null;
}

interface Props {
  venueId: string;
  packId?: string | null;
  zoneId?: string | null;
  visibility: string | null | undefined;
}

const CAT_ORDER = ['champagne', 'cognac', 'whisky', 'vodka', 'gin', 'rum', 'tequila', 'wine', 'soft', 'mixer', 'extra', 'other'];
const CAT_LABEL: Record<string, [string, string, string]> = {
  champagne: ['Champagne', 'Champagne', 'Champán'], vodka: ['Vodka', 'Vodka', 'Vodka'],
  whisky: ['Whisky', 'Whisky', 'Whisky'], gin: ['Gin', 'Gin', 'Ginebra'], rum: ['Rhum', 'Rum', 'Ron'],
  tequila: ['Tequila', 'Tequila', 'Tequila'], cognac: ['Cognac', 'Cognac', 'Coñac'], wine: ['Vin', 'Wine', 'Vino'],
  soft: ['Soft', 'Soft', 'Refresco'], mixer: ['Diluant', 'Mixer', 'Refresco'], extra: ['Extra', 'Extra', 'Extra'],
  other: ['Autre', 'Other', 'Otro'],
};

export function VipMenuPreview({ venueId, packId, zoneId, visibility }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [elig, setElig] = useState<Eligibility[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const showMenu = visibility === 'no_prices' || visibility === 'full';
  const showPrices = visibility === 'full';

  useEffect(() => {
    if (!showMenu || !venueId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [itemsRes, eligRes] = await Promise.all([
        supabase.from('vip_menu_items').select('id, name, category, brand, price, image_url, volume_cl')
          .eq('venue_id', venueId).eq('is_active', true).order('category').order('position'),
        supabase.from('vip_menu_eligibility').select('menu_item_id, pack_id, zone_id, custom_price, is_included'),
      ]);
      if (cancelled) return;
      setItems((itemsRes.data as MenuItem[]) || []);
      setElig((eligRes.data as Eligibility[]) || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [venueId, showMenu]);

  if (!showMenu || loading) return null;

  // Éligibilité : lignes qui ciblent CE pack ou CETTE zone.
  const scoped = elig.filter(e => (packId && e.pack_id === packId) || (zoneId && e.zone_id === zoneId));
  const eligIds = new Set(scoped.map(e => e.menu_item_id));
  const eligById = new Map(scoped.map(e => [e.menu_item_id, e]));

  // Si le club a curé pour ce pack/zone, on restreint ; sinon menu complet actif.
  const visible = eligIds.size > 0 ? items.filter(i => eligIds.has(i.id)) : items;
  if (visible.length === 0) return null;

  const priceOf = (i: MenuItem) => {
    const e = eligById.get(i.id);
    return e?.custom_price != null ? e.custom_price : i.price;
  };
  const isIncluded = (i: MenuItem) => eligById.get(i.id)?.is_included === true;

  // Regroupement par catégorie, ordre canonique.
  const byCat = new Map<string, MenuItem[]>();
  for (const it of visible) {
    const arr = byCat.get(it.category) || [];
    arr.push(it);
    byCat.set(it.category, arr);
  }
  const cats = [...byCat.keys()].sort((a, b) => {
    const ia = CAT_ORDER.indexOf(a); const ib = CAT_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const catLabel = (c: string) => { const l = CAT_LABEL[c]; return l ? tt(l[0], l[1], l[2]) : c; };
  const fmt = (n: number) => (n % 1 === 0 ? `${n}€` : `${n.toFixed(2)}€`);

  return (
    <div className="mt-5 border border-white/[0.08] bg-[#141414]" style={{ borderRadius: 10 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3.5 text-left"
      >
        <span className="flex items-center gap-2.5">
          <Wine className="h-4 w-4 text-primary" />
          <span className="font-display font-bold uppercase text-white" style={{ fontSize: 13, letterSpacing: '0.01em' }}>
            {tt('La carte bouteilles', 'The bottle menu', 'La carta de botellas')}
          </span>
          <span className="font-mono text-[10px] tracking-[0.08em]" style={{ color: '#7A7A7E' }}>
            {visible.length} {tt('réf.', 'items', 'ref.')}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 transition-transform" style={{ color: '#9A9A9A', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {cats.map(cat => (
            <div key={cat}>
              <div className="font-mono uppercase text-[9px] font-bold tracking-[0.14em] mb-2" style={{ color: '#7A7A7E' }}>
                {catLabel(cat)}
              </div>
              <div className="space-y-1.5">
                {byCat.get(cat)!.map(it => (
                  <div key={it.id} className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] text-white/90 truncate">
                      {it.name}
                      {it.brand && <span className="text-white/40"> · {it.brand}</span>}
                      {it.volume_cl ? <span className="text-white/30 text-[11px]"> {it.volume_cl}cl</span> : null}
                    </span>
                    <span className="flex-none text-[12px] tabular-nums">
                      {isIncluded(it)
                        ? <span className="font-mono uppercase text-[9px] font-bold tracking-[0.08em] text-primary">{tt('Inclus', 'Included', 'Incluido')}</span>
                        : showPrices
                          ? <span className="text-white/70">{fmt(priceOf(it))}</span>
                          : <span className="text-white/30 font-mono text-[10px] tracking-[0.06em]">{tt('sur place', 'in venue', 'en el local')}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[11px] leading-relaxed pt-1" style={{ color: '#6A6A6E' }}>
            {tt(
              'Aperçu de la carte. Vous commanderez vos bouteilles à table, le soir même.',
              'Menu preview. You\'ll order your bottles at the table on the night.',
              'Vista previa de la carta. Pedirás tus botellas en la mesa esa misma noche.',
            )}
          </p>
        </div>
      )}
    </div>
  );
}
