import { useMemo, useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Minus, Plus, Search, Martini, Zap, Wine, CupSoda, Sparkles } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { haptics } from '@/lib/haptics';
import {
  ServiceMenuItem, ServiceQuickItem, ServiceReservation, TableServiceInfo,
  CartLine, cartTotal, fmtEuro, menuSection, ComposerSection,
} from './serviceTypes';

const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const RED = '#E8192C';

type SectionKey = ComposerSection | 'quick';

interface OrderComposerSheetProps {
  open: boolean;
  reservation: ServiceReservation | null;
  info: TableServiceInfo | null;
  menuItems: ServiceMenuItem[];
  quickItems: ServiceQuickItem[];
  busy: boolean;
  disabled: boolean;
  onSubmit: (lines: CartLine[], opts: { directServe: boolean; note?: string }) => void;
  onClose: () => void;
}

/**
 * Prise de commande à la table. Deux destinations, un seul modèle mental :
 * « Envoyer au bar » crée une commande (le crédit ne bouge pas encore),
 * « Déjà servi » écrit directement le grand livre (le crédit bouge tout de
 * suite). Les bouteilles à diluant proposent leurs mixers en ligne.
 */
export function OrderComposerSheet({
  open,
  reservation,
  info,
  menuItems,
  quickItems,
  busy,
  disabled,
  onSubmit,
  onClose,
}: OrderComposerSheetProps) {
  const { t } = useLanguage();
  const [section, setSection] = useState<SectionKey>('bottles');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) {
      setLines([]);
      setNote('');
      setSearch('');
      setSection('bottles');
    }
  }, [open]);

  const mixers = useMemo(() => menuItems.filter(m => m.category === 'mixer'), [menuItems]);

  const sections = useMemo(() => {
    const map: Record<SectionKey, (ServiceMenuItem | ServiceQuickItem)[]> = {
      bottles: [],
      softs: [],
      extras: [],
      quick: quickItems,
    };
    menuItems.forEach(m => map[menuSection(m.category)].push(m));
    return map;
  }, [menuItems, quickItems]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q) {
      const all: (ServiceMenuItem | ServiceQuickItem)[] = [...menuItems, ...quickItems];
      return all.filter(i => `${i.name} ${(i as ServiceMenuItem).brand || ''}`.toLowerCase().includes(q));
    }
    return sections[section];
  }, [search, section, sections, menuItems, quickItems]);

  const lineFor = (id: string) => lines.find(l => (l.menuItem?.id || l.quickItem?.id) === id);

  const setQuantity = (item: ServiceMenuItem | ServiceQuickItem, delta: number) => {
    haptics.selection();
    setLines(prev => {
      const isMenu = (item as ServiceMenuItem).category !== undefined;
      const id = item.id;
      const existing = prev.find(l => (l.menuItem?.id || l.quickItem?.id) === id);
      if (!existing) {
        if (delta <= 0) return prev;
        return [
          ...prev,
          isMenu
            ? { menuItem: item as ServiceMenuItem, quantity: delta, mixers: [] }
            : { quickItem: item as ServiceQuickItem, quantity: delta, mixers: [] },
        ];
      }
      const nextQty = existing.quantity + delta;
      if (nextQty <= 0) return prev.filter(l => l !== existing);
      return prev.map(l => (l === existing ? { ...l, quantity: nextQty } : l));
    });
  };

  const toggleMixer = (line: CartLine, mixer: ServiceMenuItem) => {
    haptics.selection();
    setLines(prev =>
      prev.map(l => {
        if (l !== line) return l;
        const existing = l.mixers.find(m => m.item.id === mixer.id);
        const max = (l.menuItem?.maxMixers || 1) * l.quantity;
        const count = l.mixers.reduce((s, m) => s + m.quantity, 0);
        if (existing) return { ...l, mixers: l.mixers.filter(m => m.item.id !== mixer.id) };
        if (count >= max) return l;
        return { ...l, mixers: [...l.mixers, { item: mixer, quantity: 1 }] };
      })
    );
  };

  if (!reservation) return null;

  const total = cartTotal(lines);
  const hasQuickLines = lines.some(l => l.quickItem);
  const creditLeft = info ? Math.max(0, info.budget - info.consumed) : 0;
  const extraAfter = Math.max(0, total - creditLeft);

  const sectionTabs: { key: SectionKey; label: string; icon: typeof Wine }[] = [
    { key: 'bottles', label: t('vipnight.bottles'), icon: Wine },
    { key: 'softs', label: t('vipnight.softsMixers'), icon: CupSoda },
    { key: 'extras', label: t('vipnight.extras'), icon: Sparkles },
    ...(quickItems.length > 0 ? [{ key: 'quick' as SectionKey, label: t('vipnight.quickItems'), icon: Zap }] : []),
  ];

  return (
    <Sheet open={open} onOpenChange={o => !o && onClose()}>
      <SheetContent side="bottom" className="flex h-[88vh] flex-col gap-0 rounded-t-3xl p-0">
        <SheetHeader className="shrink-0 px-4 pb-2 pr-12 pt-5 sm:px-6">
          <SheetTitle className="text-left">
            {t('vipnight.orderFor').replace('{name}', reservation.fullName)}
          </SheetTitle>
          {reservation.assignedTableName && (
            <p className="text-left text-sm text-muted-foreground">
              {t('vipnight.table')} {reservation.assignedTableName} · {reservation.zoneName}
            </p>
          )}
        </SheetHeader>

        {/* Recherche + sections */}
        <div className="shrink-0 space-y-2 px-4 sm:px-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: T3 }} />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('vipnight.searchItem')}
              className="h-10 pl-9"
            />
          </div>
          {!search && (
            <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {sectionTabs.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSection(key)}
                  className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150"
                  style={
                    section === key
                      ? { background: RED, color: '#fff' }
                      : { background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T2 }
                  }
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Liste d'items */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2 sm:px-6">
          {visibleItems.length === 0 ? (
            <p className="py-10 text-center text-sm" style={{ color: T3 }}>
              {menuItems.length === 0 && quickItems.length === 0 ? t('vipnight.emptyMenu') : t('vipnight.noResults')}
            </p>
          ) : (
            <div className="space-y-1.5">
              {visibleItems.map(item => {
                const isMenu = (item as ServiceMenuItem).category !== undefined;
                const menu = isMenu ? (item as ServiceMenuItem) : null;
                const quick = !isMenu ? (item as ServiceQuickItem) : null;
                const price = menu?.price ?? quick?.defaultPrice ?? 0;
                const line = lineFor(item.id);
                const qty = line?.quantity || 0;
                return (
                  <div
                    key={`${isMenu ? 'm' : 'q'}-${item.id}`}
                    className="rounded-xl px-3 py-2.5"
                    style={{
                      background: qty > 0 ? 'rgba(232,25,44,0.07)' : 'rgba(255,255,255,0.032)',
                      border: `1px solid ${qty > 0 ? 'rgba(232,25,44,0.3)' : BORDER}`,
                    }}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>
                          {item.name}
                        </p>
                        <p className="truncate tabular-nums" style={{ color: T3, fontSize: 11 }}>
                          {menu?.brand ? `${menu.brand} · ` : ''}
                          {menu?.volumeCl ? `${menu.volumeCl}cl · ` : ''}
                          {price === 0 ? t('vipnight.included') : fmtEuro(price)}
                          {quick && ` · ${t('vipnight.quickOnlyDirect')}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {qty > 0 && (
                          <>
                            <button
                              type="button"
                              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg"
                              style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, color: T1 }}
                              onClick={() => setQuantity(item, -1)}
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                            <span className="w-6 text-center tabular-nums" style={{ color: T1, fontSize: 14, fontWeight: 700 }}>
                              {qty}
                            </span>
                          </>
                        )}
                        <button
                          type="button"
                          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg"
                          style={{ background: qty > 0 ? RED : 'rgba(255,255,255,0.06)', border: `1px solid ${qty > 0 ? RED : BORDER}`, color: qty > 0 ? '#fff' : T1 }}
                          onClick={() => setQuantity(item, 1)}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Mixers pour bouteilles à diluant */}
                    {menu?.needsMixer && qty > 0 && mixers.length > 0 && line && (
                      <div className="mt-2 border-t pt-2" style={{ borderColor: BORDER }}>
                        <p className="mb-1.5 flex items-center gap-1" style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          <Martini className="h-3 w-3" />
                          {t('vipnight.chooseMixers')} · {line.mixers.reduce((s, m) => s + m.quantity, 0)}/{menu.maxMixers * qty}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {mixers.map(mixer => {
                            const active = line.mixers.some(m => m.item.id === mixer.id);
                            return (
                              <button
                                key={mixer.id}
                                type="button"
                                onClick={() => toggleMixer(line, mixer)}
                                className="cursor-pointer rounded-full px-2.5 py-1 text-xs transition-all duration-150"
                                style={
                                  active
                                    ? { background: 'rgba(232,25,44,0.15)', border: '1px solid rgba(232,25,44,0.5)', color: '#FCA5A5' }
                                    : { background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: T2 }
                                }
                              >
                                {mixer.name}
                                {mixer.price > 0 && <span className="tabular-nums"> +{fmtEuro(mixer.price)}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pied : total, impact crédit, note, CTA */}
        <div
          className="shrink-0 space-y-2.5 border-t bg-background/95 px-4 pt-3 backdrop-blur sm:px-6"
          style={{ paddingBottom: 'calc(0.875rem + env(safe-area-inset-bottom, 0px))' }}
        >
          {lines.length > 0 ? (
            <>
              <div className="flex items-baseline justify-between">
                <span style={{ color: T2, fontSize: 12.5 }}>
                  {t('vipnight.total')}
                  <span className="ml-2 tabular-nums" style={{ color: T3, fontSize: 11 }}>
                    {extraAfter > 0
                      ? t('vipnight.creditExtra').replace('{amount}', fmtEuro(extraAfter))
                      : t('vipnight.creditCovered')}
                  </span>
                </span>
                <span className="tabular-nums" style={{ color: T1, fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em' }}>
                  {fmtEuro(total)}
                </span>
              </div>
              <Input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={t('vipnight.notePlaceholder')}
                className="h-9 text-sm"
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="h-12 min-w-0 flex-1 font-semibold hover:bg-muted"
                  disabled={busy || disabled}
                  onClick={() => onSubmit(lines, { directServe: true, note: note.trim() || undefined })}
                >
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <span className="truncate">{t('vipnight.serveDirect')}</span>}
                </Button>
                <Button
                  className="h-12 min-w-0 flex-1 font-semibold"
                  disabled={busy || disabled || hasQuickLines}
                  onClick={() => onSubmit(lines, { directServe: false, note: note.trim() || undefined })}
                >
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <span className="truncate">{t('vipnight.sendToBar')}</span>}
                </Button>
              </div>
              {hasQuickLines && (
                <p className="text-center" style={{ color: T3, fontSize: 10.5 }}>
                  {t('vipnight.quickOnlyDirectHint')}
                </p>
              )}
            </>
          ) : (
            <p className="py-2 text-center text-sm" style={{ color: T3 }}>
              {t('vipnight.cartEmpty')}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
