import { useEffect, useState } from 'react';
import { translate } from '@/i18n/orgTranslate';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Wine, ChevronDown, ChevronRight, Plus, Minus, Search } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

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
  /** 'text' = liste écrite (accordéon) ; 'visual' = bouton « Voir la carte » avec images. */
  displayMode?: 'text' | 'visual';
  /** Minimum spend du pack, pour la barre de progression de pré-commande. */
  minimumSpend?: number;
}

const CAT_ORDER = ['champagne', 'cognac', 'whisky', 'vodka', 'gin', 'rum', 'tequila', 'wine', 'soft', 'mixer', 'extra', 'other'];
const CAT_LABEL: Record<string, [string, string, string]> = {
  champagne: ['Champagne', 'Champagne', 'Champán'], vodka: ['Vodka', 'Vodka', 'Vodka'],
  whisky: ['Whisky', 'Whisky', 'Whisky'], gin: ['Gin', 'Gin', 'Ginebra'], rum: ['Rhum', 'Rum', 'Ron'],
  tequila: ['Tequila', 'Tequila', 'Tequila'], cognac: ['Cognac', 'Cognac', 'Coñac'], wine: ['Vin', 'Wine', 'Vino'],
  soft: ['Soft', 'Soft', 'Refresco'], mixer: ['Diluant', 'Mixer', 'Refresco'], extra: ['Extra', 'Extra', 'Extra'],
  other: ['Autre', 'Other', 'Otro'],
};

export function VipMenuPreview({ venueId, packId, zoneId, visibility, preorderEnabled, onPreorderChange, displayMode = 'text', minimumSpend }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [elig, setElig] = useState<Eligibility[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string>('all');

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
  // On masque les diluants (softs + mixers) — la carte reste centrée bouteilles.
  const visible = (eligIds.size > 0 ? items.filter(i => eligIds.has(i.id)) : items)
    .filter(i => i.category !== 'soft' && i.category !== 'mixer');
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

  // Stepper +/- (pré-commande)
  const stepperFor = (it: MenuItem) => (qty[it.id] || 0) > 0 ? (
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
  );

  // Contrôle de droite en mode texte : stepper (pré-commande) ou prix / inclus / sur place
  const rowControl = (it: MenuItem) => (preorderMode && !isIncluded(it)) ? (
    <span className="flex-none flex items-center gap-2">
      <span className="text-[12px] tabular-nums text-white/70 w-14 text-right">{fmt(priceOf(it))}</span>
      {stepperFor(it)}
    </span>
  ) : (
    <span className="flex-none text-[12px] tabular-nums">
      {isIncluded(it)
        ? <span className="font-mono uppercase text-[9px] font-bold tracking-[0.08em] text-primary">{tt('Inclus', 'Included', 'Incluido')}</span>
        : showPrices
          ? <span className="text-white/70">{fmt(priceOf(it))}</span>
          : <span className="text-white/30 font-mono text-[10px] tracking-[0.06em]">{tt('sur place', 'in venue', 'en el local')}</span>}
    </span>
  );

  // Récap pré-commande + barre de progression (vs minimum spend si connu)
  const hasMin = !!minimumSpend && minimumSpend > 0;
  const preorderSummary = (
    <>
      {hasMin ? (
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1.5 text-[12px]">
            <span className="text-white/60">{tt('Consommation pré-commandée', 'Pre-ordered consumption', 'Consumo pre-pedido')}</span>
            <span className="tabular-nums text-white/80">{fmt(preorderTotal)} / {fmt(minimumSpend!)}</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (preorderTotal / minimumSpend!) * 100)}%`, background: preorderTotal >= minimumSpend! ? '#34d399' : '#E8192C' }} />
          </div>
          {preorderTotal >= minimumSpend! && preorderTotal > 0 && (
            <p className="text-[11px] mt-1" style={{ color: '#34d399' }}>{tt('Minimum atteint', 'Minimum reached', 'Mínimo alcanzado')}</p>
          )}
        </div>
      ) : preorderCount > 0 ? (
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[12px] text-white/60">{preorderCount} {tt('bouteille(s) pré-commandée(s)', 'bottle(s) pre-ordered', 'botella(s) pre-pedida(s)')}</span>
          <span className="font-display font-bold tabular-nums text-primary text-[15px]">{fmt(preorderTotal)}</span>
        </div>
      ) : null}
      <p className="text-[11px] leading-relaxed" style={{ color: '#6A6A6E' }}>
        {tt(
          'Pré-commandez vos bouteilles : le club les prépare pour votre arrivée. Réglées à la table le soir même.',
          'Pre-order your bottles: the club prepares them for your arrival. Settled at the table on the night.',
          'Pre-pide tus botellas: el club las prepara para tu llegada. Se pagan en la mesa esa noche.',
        )}
      </p>
    </>
  );

  const readonlyNote = (
    <p className="text-[11px] leading-relaxed pt-1" style={{ color: '#6A6A6E' }}>
      {tt(
        'Aperçu de la carte. Vous commanderez vos bouteilles à table, le soir même.',
        'Menu preview. You\'ll order your bottles at the table on the night.',
        'Vista previa de la carta. Pedirás tus botellas en la mesa esa misma noche.',
      )}
    </p>
  );

  // === MODE VISUEL : bouton « Voir la carte » → Sheet avec images ===
  if (displayMode === 'visual') {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-5 w-full flex items-center justify-between px-4 py-3.5 border border-white/[0.08] bg-[#141414] text-left"
          style={{ borderRadius: 10 }}
        >
          <span className="flex items-center gap-2.5">
            <Wine className="h-4 w-4 text-primary" />
            <span className="font-display font-bold uppercase text-white" style={{ fontSize: 13, letterSpacing: '0.01em' }}>
              {tt('Voir la carte', 'View the menu', 'Ver la carta')}
            </span>
            <span className="font-mono text-[10px] tracking-[0.08em]" style={{ color: '#7A7A7E' }}>
              {visible.length} {tt('réf.', 'items', 'ref.')}
            </span>
          </span>
          {preorderMode && preorderCount > 0
            ? <span className="font-display font-bold tabular-nums text-primary text-[14px]">{fmt(preorderTotal)}</span>
            : <ChevronRight className="h-4 w-4" style={{ color: '#9A9A9A' }} />}
        </button>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="h-[92vh] rounded-t-3xl bg-[#0A0A0A] border-white/[0.08] p-0 flex flex-col">
            <SheetHeader className="px-4 pt-4 pb-3 border-b border-white/[0.08]">
              <SheetTitle className="text-white flex items-center gap-2">
                <Wine className="h-5 w-5 text-primary" />
                {tt('La carte bouteilles', 'The bottle menu', 'La carta de botellas')}
              </SheetTitle>
            </SheetHeader>
            {/* Recherche + filtres par type d'alcool */}
            <div className="px-4 pt-3 pb-2.5 space-y-2.5 border-b border-white/[0.06]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: '#7A7A7E' }} />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={tt('Rechercher une bouteille…', 'Search a bottle…', 'Buscar una botella…')}
                  className="w-full h-10 pl-9 pr-3 rounded-lg text-[14px] text-white placeholder:text-[#5A5A5E] bg-[#1F1F22] border border-white/[0.08] focus:outline-none focus:border-primary/50"
                />
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                {['all', ...cats].map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCatFilter(c)}
                    className="flex-none h-8 px-3 rounded-full text-[12px] font-medium whitespace-nowrap transition-colors"
                    style={catFilter === c
                      ? { background: 'hsl(var(--primary))', color: 'white' }
                      : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)' }}
                  >
                    {c === 'all' ? tt('Tout', 'All', 'Todo') : catLabel(c)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pt-4 space-y-5 pb-6">
              {(catFilter === 'all' ? cats : cats.filter(c => c === catFilter)).map(cat => {
                const q = search.trim().toLowerCase();
                const catItems = byCat.get(cat)!.filter(it => !q || `${it.name} ${it.brand || ''}`.toLowerCase().includes(q));
                if (catItems.length === 0) return null;
                return (
                <div key={cat}>
                  <div className="font-mono uppercase text-[10px] font-bold tracking-[0.14em] mb-2.5" style={{ color: '#7A7A7E' }}>{catLabel(cat)}</div>
                  <div className="grid grid-cols-2 gap-2.5">
                    {catItems.map(it => (
                      <div key={it.id} className="rounded-xl overflow-hidden border border-white/[0.08] bg-white/[0.02]">
                        <div className="aspect-[3/4] bg-black/40 flex items-center justify-center">
                          {it.image_url
                            ? <img src={it.image_url} alt={it.name} className="w-full h-full object-contain" loading="lazy" />
                            : <Wine className="h-8 w-8" style={{ color: 'rgba(255,255,255,0.18)' }} />}
                        </div>
                        <div className="p-2.5">
                          <div className="text-[13px] text-white/90 font-medium truncate">{it.name}</div>
                          {it.brand && <div className="text-[11px] text-white/40 truncate">{it.brand}</div>}
                          <div className="flex items-center justify-between mt-2 gap-2">
                            {isIncluded(it)
                              ? <span className="font-mono uppercase text-[9px] font-bold tracking-[0.08em] text-primary">{tt('Inclus', 'Included', 'Incluido')}</span>
                              : <span className="text-[13px] tabular-nums text-white/80">{fmt(priceOf(it))}</span>}
                            {preorderMode && !isIncluded(it) && stepperFor(it)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                );
              })}
              {(catFilter === 'all' ? cats : cats.filter(c => c === catFilter))
                .every(cat => byCat.get(cat)!.every(it => { const q = search.trim().toLowerCase(); return q && !`${it.name} ${it.brand || ''}`.toLowerCase().includes(q); })) && (
                <p className="text-center text-[13px] py-8" style={{ color: '#6A6A6E' }}>
                  {tt('Aucune bouteille trouvée', 'No bottle found', 'Ninguna botella encontrada')}
                </p>
              )}
            </div>
            {preorderMode && (
              <div className="px-4 py-3 border-t border-white/[0.08] bg-[#0A0A0A]">{preorderSummary}</div>
            )}
          </SheetContent>
        </Sheet>
      </>
    );
  }

  // === MODE TEXTE : accordéon liste ===
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
                    {rowControl(it)}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {preorderMode ? (
            <div className="pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>{preorderSummary}</div>
          ) : readonlyNote}
        </div>
      )}
    </div>
  );
}
