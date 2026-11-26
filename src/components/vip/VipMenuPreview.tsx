import { useEffect, useState } from 'react';
import { translate } from '@/i18n/orgTranslate';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Wine, ChevronDown, ChevronRight, ChevronUp, Plus, Minus, Search, Trash2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

// Carte bouteilles d'une table + précommande SANS paiement (D8, vague C3a).
// Carte = RPC get_table_menu(event). Le client coche, le total est indicatif et « à régler sur place ».
// Rien n'entre dans le paiement en ligne ; le navigateur n'envoie que { menuItemId, quantity }.

import {
  parseTableMenu, bumpBottleQty, clampBottleQty, preorderIndicativeTotal, toPreorderPayload,
  type TableMenuItem as MenuItem, type PreorderSelection,
} from '@/lib/tableBottles';

export type { PreorderSelection };

interface Props {
  eventId: string;
  /** Le client coche des bouteilles : { menuItemId, quantity } seulement, prix relus en base. */
  onPreorderChange?: (items: PreorderSelection[], indicativeTotal: number) => void;
  /** 'text' = liste écrite (accordéon) ; 'visual' = bouton « Voir la carte » avec images. */
  displayMode?: 'text' | 'visual';
  /** Minimum spend du pack, pour la barre de progression. */
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

export function VipMenuPreview({ eventId, onPreorderChange, displayMode = 'text', minimumSpend }: Props) {
  const { language, t } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  // Résumé de commande repliable (la « petite flèche ») dans le pied du Sheet visuel.
  const [cartOpen, setCartOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string>('all');

  // Carte lue par la RPC publique get_table_menu (club effectif, sinon carte de la soirée).
  const preorderMode = !!onPreorderChange;

  // Remonte la sélection au parent (TableCheckout) à chaque changement : quantités seulement.
  useEffect(() => {
    if (!onPreorderChange) return;
    onPreorderChange(toPreorderPayload(qty, items), preorderIndicativeTotal(items, qty));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qty, items]);

  useEffect(() => {
    if (!eventId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc('get_table_menu', { p_event_id: eventId });
      if (cancelled) return;
      setItems(error ? [] : parseTableMenu(data));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  if (loading) return null;

  // On masque les diluants (softs + mixers) : la carte reste centrée bouteilles.
  const visible = items.filter(i => i.category !== 'soft' && i.category !== 'mixer');
  if (visible.length === 0) return null;

  const priceOf = (i: MenuItem) => i.price;
  const isIncluded = (_i: MenuItem) => false;
  const showPrices = true;

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

  const bump = (id: string, delta: number) => setQty(prev => bumpBottleQty(prev, id, delta));
  const removeItem = (id: string) => {
    setQty(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };
  const preorderTotal = preorderMode ? preorderIndicativeTotal(visible, qty) : 0;
  const preorderCount = preorderMode
    ? Object.values(qty).reduce((a, b) => a + clampBottleQty(b), 0)
    : 0;
  // Bouteilles retenues dans le panier (ordre carte), pour le résumé avec photos.
  const selectedItems = preorderMode ? visible.filter(it => (qty[it.id] || 0) > 0) : [];
  // « Précommander » : la sélection est déjà remontée au parent en continu ; on ferme juste.
  const confirmPreorder = () => { setCartOpen(false); setOpen(false); };

  // Stepper +/- (pré-commande)
  const stepperFor = (it: MenuItem) => (qty[it.id] || 0) > 0 ? (
    <span className="flex items-center gap-1.5">
      <button type="button" onClick={() => bump(it.id, -1)} className="h-6 w-6 rounded-full flex items-center justify-center bg-white/[0.06] hover:bg-white/[0.12]">
        <Minus className="h-3 w-3 text-white" />
      </button>
      <span className="w-4 text-center text-[13px] font-bold tabular-nums text-white">{qty[it.id]}</span>
      <button type="button" onClick={() => bump(it.id, 1)} className="h-6 w-6 rounded-full flex items-center justify-center bg-primary hover:brightness-110">
        <Plus className="h-3 w-3 text-snow" />
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
  const minSpendBar = hasMin ? (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-1.5 text-[12px]">
        <span className="text-white/60">{tt('Consommation pré-commandée', 'Pre-ordered consumption', 'Consumo pre-pedido')}</span>
        <span className="tabular-nums text-white/80">{fmt(preorderTotal)} / {fmt(minimumSpend!)}</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgb(var(--ink)/0.08)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (preorderTotal / minimumSpend!) * 100)}%`, background: preorderTotal >= minimumSpend! ? 'var(--acc-34d399)' : '#E8192C' }} />
      </div>
      {preorderTotal >= minimumSpend! && preorderTotal > 0 && (
        <p className="text-[11px] mt-1" style={{ color: 'var(--acc-34d399)' }}>{tt('Minimum atteint', 'Minimum reached', 'Mínimo alcanzado')}</p>
      )}
    </div>
  ) : null;
  const preorderNote = (
    <p className="text-[11px] leading-relaxed" style={{ color: 'var(--tx-6a6a6e)' }}>
      {t('tblb.preorder.note')}
    </p>
  );
  const preorderSummary = (
    <>
      {hasMin ? minSpendBar : preorderCount > 0 ? (
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[12px] text-white/60">{preorderCount} {tt('bouteille(s) pré-commandée(s)', 'bottle(s) pre-ordered', 'botella(s) pre-pedida(s)')}</span>
          <span className="font-display font-bold tabular-nums text-primary text-[15px]">{fmt(preorderTotal)}</span>
        </div>
      ) : null}
      {preorderNote}
    </>
  );

  // Ligne de panier : vignette + nom + prix ligne + stepper + retirer.
  const cartRow = (it: MenuItem) => (
    <div key={it.id} className="flex items-center gap-2.5">
      <div className="h-11 w-11 flex-none rounded-lg overflow-hidden bg-black/40 flex items-center justify-center border border-white/[0.06]">
        {it.image_url
          ? <img src={it.image_url} alt={it.name} className="w-full h-full object-contain" loading="lazy" />
          : <Wine className="h-4 w-4" style={{ color: 'rgb(var(--ink)/0.18)' }} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-white/90 font-medium truncate">{it.name}</div>
        <div className="text-[11px] tabular-nums text-white/45">
          {fmt(priceOf(it))} × {qty[it.id]} = <span className="text-white/75">{fmt(priceOf(it) * (qty[it.id] || 0))}</span>
        </div>
      </div>
      {stepperFor(it)}
      <button
        type="button"
        onClick={() => removeItem(it.id)}
        aria-label={tt('Retirer du panier', 'Remove from cart', 'Quitar del carrito')}
        className="h-7 w-7 flex-none rounded-full flex items-center justify-center text-white/35 hover:text-white hover:bg-white/[0.08] transition-colors"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  // === MODE VISUEL : bouton « Voir la carte » → Sheet avec images ===
  if (displayMode === 'visual') {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-5 w-full flex items-center justify-between px-4 py-3.5 border border-white/[0.08] bg-[var(--sf-141414)] text-left"
          style={{ borderRadius: 10 }}
        >
          <span className="flex items-center gap-2.5">
            <Wine className="h-4 w-4 text-primary" />
            <span className="font-display font-bold uppercase text-white" style={{ fontSize: 13, letterSpacing: '0.01em' }}>
              {tt('Voir la carte', 'View the menu', 'Ver la carta')}
            </span>
            <span className="font-mono text-[10px] tracking-[0.08em]" style={{ color: 'var(--tx-7a7a7e)' }}>
              {visible.length} {tt('réf.', 'items', 'ref.')}
            </span>
          </span>
          {preorderMode && preorderCount > 0
            ? <span className="font-display font-bold tabular-nums text-primary text-[14px]">{fmt(preorderTotal)}</span>
            : <ChevronRight className="h-4 w-4" style={{ color: 'var(--tx-9a9a9a)' }} />}
        </button>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="h-[92vh] rounded-t-3xl bg-[var(--sf-0a0a0a)] border-white/[0.08] p-0 flex flex-col">
            <SheetHeader className="px-4 pt-4 pb-3 border-b border-white/[0.08]">
              <SheetTitle className="text-white flex items-center gap-2">
                <Wine className="h-5 w-5 text-primary" />
                {tt('La carte bouteilles', 'The bottle menu', 'La carta de botellas')}
              </SheetTitle>
            </SheetHeader>
            {/* Recherche + filtres par type d'alcool */}
            <div className="px-4 pt-3 pb-2.5 space-y-2.5 border-b border-white/[0.06]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--tx-7a7a7e)' }} />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={tt('Rechercher une bouteille…', 'Search a bottle…', 'Buscar una botella…')}
                  className="w-full h-10 pl-9 pr-3 rounded-lg text-[14px] text-white placeholder:text-[var(--tx-5a5a5e)] bg-[var(--sf-1f1f22)] border border-white/[0.08] focus:outline-none focus:border-primary/50"
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
                      : { background: 'rgb(var(--ink)/0.06)', color: 'rgb(var(--ink)/var(--ink-a70,0.7))' }}
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
                  <div className="font-mono uppercase text-[10px] font-bold tracking-[0.14em] mb-2.5" style={{ color: 'var(--tx-7a7a7e)' }}>{catLabel(cat)}</div>
                  <div className="grid grid-cols-2 gap-2.5">
                    {catItems.map(it => (
                      <div key={it.id} className="rounded-xl overflow-hidden border border-white/[0.08] bg-white/[0.02]">
                        <div className="aspect-[3/4] bg-black/40 flex items-center justify-center">
                          {it.image_url
                            ? <img src={it.image_url} alt={it.name} className="w-full h-full object-contain" loading="lazy" />
                            : <Wine className="h-8 w-8" style={{ color: 'rgb(var(--ink)/0.18)' }} />}
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
                <p className="text-center text-[13px] py-8" style={{ color: 'var(--tx-6a6a6e)' }}>
                  {tt('Aucune bouteille trouvée', 'No bottle found', 'Ninguna botella encontrada')}
                </p>
              )}
            </div>
            {preorderMode && (
              <div
                className="px-4 py-3 border-t border-white/[0.08] bg-[var(--sf-0a0a0a)] space-y-3"
                style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
              >
                {minSpendBar}

                {/* Résumé de commande repliable avec photos (la « petite flèche ») */}
                {selectedItems.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setCartOpen(o => !o)}
                      aria-expanded={cartOpen}
                      className="w-full flex items-center justify-between py-0.5"
                    >
                      <span className="text-[12px] text-white/70">
                        {preorderCount} {tt('bouteille(s)', 'bottle(s)', 'botella(s)')}
                        <span className="text-primary font-bold tabular-nums"> · {fmt(preorderTotal)}</span>
                      </span>
                      <span className="flex items-center gap-1 font-mono uppercase text-[10px] tracking-[0.08em]" style={{ color: 'var(--tx-9a9a9a)' }}>
                        {tt('Détails', 'Details', 'Detalles')}
                        <ChevronUp className="h-4 w-4 transition-transform" style={{ transform: cartOpen ? 'none' : 'rotate(180deg)' }} />
                      </span>
                    </button>
                    {cartOpen && (
                      <div className="mt-3 space-y-2.5 max-h-[34vh] overflow-y-auto pr-0.5">
                        {selectedItems.map(cartRow)}
                      </div>
                    )}
                  </div>
                )}

                {preorderNote}

                {/* Bouton précommander : valide la sélection et referme la carte */}
                <button
                  type="button"
                  onClick={confirmPreorder}
                  className="w-full h-12 rounded-full flex items-center justify-center gap-1.5 font-semibold text-[14px] text-snow transition-all active:scale-[0.98]"
                  style={preorderCount > 0
                    ? { background: '#E8192C', boxShadow: '0 8px 24px rgba(232,25,44,0.30)' }
                    : { background: 'rgb(var(--ink)/0.08)' }}
                >
                  {preorderCount > 0
                    ? <>{t('tblb.preorder.cta')}<span className="tabular-nums"> · {fmt(preorderTotal)}</span></>
                    : tt('Fermer', 'Close', 'Cerrar')}
                </button>
              </div>
            )}
          </SheetContent>
        </Sheet>
      </>
    );
  }

  // === MODE TEXTE : accordéon liste ===
  return (
    <div className="mt-5 border border-white/[0.08] bg-[var(--sf-141414)]" style={{ borderRadius: 10 }}>
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
          <span className="font-mono text-[10px] tracking-[0.08em]" style={{ color: 'var(--tx-7a7a7e)' }}>
            {visible.length} {tt('réf.', 'items', 'ref.')}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 transition-transform" style={{ color: 'var(--tx-9a9a9a)', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {cats.map(cat => (
            <div key={cat}>
              <div className="font-mono uppercase text-[9px] font-bold tracking-[0.14em] mb-2" style={{ color: 'var(--tx-7a7a7e)' }}>
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
            <div className="pt-2" style={{ borderTop: '1px solid rgb(var(--ink)/0.06)' }}>{preorderSummary}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
