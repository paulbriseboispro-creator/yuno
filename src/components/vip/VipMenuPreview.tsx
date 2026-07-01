import { useEffect, useState } from 'react';
import { translate } from '@/i18n/orgTranslate';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Wine, ChevronDown, Plus, Minus } from 'lucide-react';

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

export interface PreorderSelection {
  menuItemId: string;
  quantity: number;
  unitPrice: number;
  itemName: string;
}

interface Props {
  venueId: string;
  packId?: string | null;
  zoneId?: string | null;
  visibility: string | null | undefined;
  /** Quand le club autorise la pré-commande ET que les prix sont visibles, le client peut
   *  sélectionner des bouteilles à préparer pour son arrivée. */
  preorderEnabled?: boolean;
  onPreorderChange?: (items: PreorderSelection[]) => void;
}

const CAT_ORDER = ['champagne', 'cognac', 'whisky', 'vodka', 'gin', 'rum', 'tequila', 'wine', 'soft', 'mixer', 'extra', 'other'];
const CAT_LABEL: Record<string, [string, string, string]> = {
  champagne: ['Champagne', 'Champagne', 'Champán'], vodka: ['Vodka', 'Vodka', 'Vodka'],
  whisky: ['Whisky', 'Whisky', 'Whisky'], gin: ['Gin', 'Gin', 'Ginebra'], rum: ['Rhum', 'Rum', 'Ron'],
  tequila: ['Tequila', 'Tequila', 'Tequila'], cognac: ['Cognac', 'Cognac', 'Coñac'], wine: ['Vin', 'Wine', 'Vino'],
  soft: ['Soft', 'Soft', 'Refresco'], mixer: ['Diluant', 'Mixer', 'Refresco'], extra: ['Extra', 'Extra', 'Extra'],
  other: ['Autre', 'Other', 'Otro'],
};

export function VipMenuPreview({ venueId, packId, zoneId, visibility, preorderEnabled, onPreorderChange }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [elig, setElig] = useState<Eligibility[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});

  const showMenu = visibility === 'no_prices' || visibility === 'full';
  const showPrices = visibility === 'full';
  // Pré-commande possible seulement si le club l'autorise ET que les prix sont affichés
  // (le client doit voir ce qu'il engage).
  const preorderMode = !!preorderEnabled && showPrices && !!onPreorderChange;

  // Remonte la sélection de pré-commande au parent (TableCheckout) à chaque changement.
  useEffect(() => {
    if (!preorderMode || !onPreorderChange) return;
    const scopedE = elig.filter(e => (packId && e.pack_id === packId) || (zoneId && e.zone_id === zoneId));
    const eById = new Map(scopedE.map(e => [e.menu_item_id, e]));
    const itemsById = new Map(items.map(i => [i.id, i]));
    const sel: PreorderSelection[] = Object.entries(qty).flatMap(([id, q]) => {
      const it = itemsById.get(id);
      if (!it || q <= 0) return [];
      const e = eById.get(id);
      const price = e?.custom_price != null ? e.custom_price : it.price;
      return [{ menuItemId: id, quantity: q, unitPrice: price, itemName: it.name }];
    });
    onPreorderChange(sel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qty, preorderMode, items, elig]);

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

  const bump = (id: string, delta: number) => {
    setQty(prev => {
      const nv = Math.max(0, (prev[id] || 0) + delta);
      const next = { ...prev };
      if (nv === 0) delete next[id]; else next[id] = nv;
      return next;
    });
  };
  const preorderTotal = preorderMode
    ? visible.reduce((sum, it) => sum + priceOf(it) * (qty[it.id] || 0), 0)
    : 0;
  const preorderCount = preorderMode
    ? Object.values(qty).reduce((a, b) => a + b, 0)
    : 0;

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
                    {preorderMode && !isIncluded(it) ? (
                      <span className="flex-none flex items-center gap-2">
                        <span className="text-[12px] tabular-nums text-white/70 w-14 text-right">{fmt(priceOf(it))}</span>
                        {(qty[it.id] || 0) > 0 ? (
                          <span className="flex items-center gap-1.5">
                            <button type="button" onClick={() => bump(it.id, -1)} className="h-6 w-6 rounded-full flex items-center justify-center bg-white/[0.06] hover:bg-white/[0.12]">
                              <Minus className="h-3 w-3 text-white" />
                            </button>
                            <span className="w-4 text-center text-[13px] font-bold tabular-nums text-white">{qty[it.id]}</span>
                            <button type="button" onClick={() => bump(it.id, 1)} className="h-6 w-6 rounded-full flex items-center justify-center bg-primary hover:brightness-110">
                              <Plus className="h-3 w-3 text-white" />
                            </button>
                          </span>
                        ) : (
                          <button type="button" onClick={() => bump(it.id, 1)} className="h-6 w-6 rounded-full flex items-center justify-center bg-white/[0.06] hover:bg-white/[0.12]">
                            <Plus className="h-3 w-3 text-white" />
                          </button>
                        )}
                      </span>
                    ) : (
                      <span className="flex-none text-[12px] tabular-nums">
                        {isIncluded(it)
                          ? <span className="font-mono uppercase text-[9px] font-bold tracking-[0.08em] text-primary">{tt('Inclus', 'Included', 'Incluido')}</span>
                          : showPrices
                            ? <span className="text-white/70">{fmt(priceOf(it))}</span>
                            : <span className="text-white/30 font-mono text-[10px] tracking-[0.06em]">{tt('sur place', 'in venue', 'en el local')}</span>}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {preorderMode ? (
            <div className="pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              {preorderCount > 0 && (
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[12px] text-white/60">{preorderCount} {tt('bouteille(s) pré-commandée(s)', 'bottle(s) pre-ordered', 'botella(s) pre-pedida(s)')}</span>
                  <span className="font-display font-bold tabular-nums text-primary text-[15px]">{fmt(preorderTotal)}</span>
                </div>
              )}
              <p className="text-[11px] leading-relaxed" style={{ color: '#6A6A6E' }}>
                {tt(
                  'Pré-commandez vos bouteilles : le club les prépare pour votre arrivée. Réglées à la table le soir même.',
                  'Pre-order your bottles: the club prepares them for your arrival. Settled at the table on the night.',
                  'Pre-pide tus botellas: el club las prepara para tu llegada. Se pagan en la mesa esa noche.',
                )}
              </p>
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed pt-1" style={{ color: '#6A6A6E' }}>
              {tt(
                'Aperçu de la carte. Vous commanderez vos bouteilles à table, le soir même.',
                'Menu preview. You\'ll order your bottles at the table on the night.',
                'Vista previa de la carta. Pedirás tus botellas en la mesa esa misma noche.',
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
