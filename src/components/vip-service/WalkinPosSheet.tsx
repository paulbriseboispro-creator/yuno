import { useMemo, useState, useEffect } from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft, Plus, Minus, Search, ChevronRight, UserPlus, Users, MapPin,
  Loader2, Check, ShoppingBag, Wine,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { haptics } from '@/lib/haptics';
import {
  ServiceMenuItem, ServiceReservation, TableServiceInfo, CartLine,
  ComposerSection, menuSection, cartTotal, fmtEuro,
} from './serviceTypes';

const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.60)';
const T3 = 'rgba(255,255,255,0.38)';
const C_FAINT = 'rgba(255,255,255,0.05)';
const BORDER = 'rgba(255,255,255,0.09)';
const RED = '#E8192C';
const GOLD = '#E7C15A';

const SECTION_ORDER: ComposerSection[] = ['bottles', 'softs', 'extras'];
const SECTION_KEY: Record<ComposerSection, string> = {
  bottles: 'vipnight.bottles',
  softs: 'vipnight.softsMixers',
  extras: 'vipnight.extras',
};

type Zone = { id: string; name: string; color: string };
type Step = 'cart' | 'link' | 'bill';
export type WalkinTarget =
  | { kind: 'existing'; reservation: ServiceReservation }
  | { kind: 'walkin'; zoneId: string; fullName: string | null; guestCount: number };

interface WalkinPosSheetProps {
  open: boolean;
  /** Article pré-ajouté au panier à l'ouverture (tap sur la carte). */
  seedItemId?: string | null;
  venueName?: string | null;
  eventTitle?: string | null;
  menuItems: ServiceMenuItem[];
  reservations: ServiceReservation[];
  serviceInfo: Map<string, TableServiceInfo>;
  zones: Zone[];
  disabled: boolean;
  onCommit: (target: WalkinTarget, lines: CartLine[]) => Promise<void>;
  onClose: () => void;
}

/**
 * Service en table « point de vente » pour l'hôte VIP :
 *   1. Panier — ajoute les bouteilles.
 *   2. Relier — à une table existante OU un walk-in (table sans résa Yuno).
 *   3. Addition — plein écran, montrable au client, puis « Paiement validé »
 *      (réglé au club). L'écriture ne part QU'à cette validation.
 */
export function WalkinPosSheet({
  open, seedItemId, venueName, eventTitle, menuItems, reservations, serviceInfo, zones, disabled, onCommit, onClose,
}: WalkinPosSheetProps) {
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>('cart');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<WalkinTarget | null>(null);
  // Champs walk-in
  const [walkinName, setWalkinName] = useState('');
  const [walkinGuests, setWalkinGuests] = useState(2);
  const [walkinZoneId, setWalkinZoneId] = useState<string | null>(null);
  const [mode, setMode] = useState<'existing' | 'walkin' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep('cart'); setQty({}); setSearch(''); setTarget(null);
      setWalkinName(''); setWalkinGuests(2); setWalkinZoneId(null); setMode(null); setBusy(false);
    } else if (seedItemId) {
      setQty({ [seedItemId]: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const menuById = useMemo(() => {
    const m = new Map<string, ServiceMenuItem>();
    menuItems.forEach(i => m.set(i.id, i));
    return m;
  }, [menuItems]);

  const lines: CartLine[] = useMemo(
    () => Object.entries(qty)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => ({ menuItem: menuById.get(id)!, quantity: q, mixers: [] }))
      .filter(l => l.menuItem),
    [qty, menuById]
  );
  const total = cartTotal(lines);
  const count = lines.reduce((s, l) => s + l.quantity, 0);

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const g: Record<ComposerSection, ServiceMenuItem[]> = { bottles: [], softs: [], extras: [] };
    menuItems
      .filter(m => !q || `${m.name} ${m.brand || ''}`.toLowerCase().includes(q))
      .forEach(m => g[menuSection(m.category)].push(m));
    return g;
  }, [menuItems, search]);

  const seatedReservations = useMemo(
    () => reservations
      .filter(r => !['finished', 'no_show', 'denied'].includes(r.vipStatus))
      .sort((a, b) => {
        const rank = (r: ServiceReservation) => (r.vipStatus === 'active' ? 0 : r.vipStatus === 'placed' ? 1 : r.hasArrived ? 2 : 3);
        return rank(a) - rank(b) || a.fullName.localeCompare(b.fullName);
      }),
    [reservations]
  );

  const bump = (id: string, delta: number) => {
    haptics.selection();
    setQty(prev => {
      const next = Math.max(0, (prev[id] || 0) + delta);
      const copy = { ...prev };
      if (next === 0) delete copy[id]; else copy[id] = next;
      return copy;
    });
  };

  const targetValid =
    (mode === 'existing' && target?.kind === 'existing') ||
    (mode === 'walkin' && !!walkinZoneId);

  const goToBill = () => {
    if (mode === 'walkin' && walkinZoneId) {
      setTarget({ kind: 'walkin', zoneId: walkinZoneId, fullName: walkinName.trim() || null, guestCount: walkinGuests });
    }
    setStep('bill');
  };

  const commit = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await onCommit(target, lines);
    } finally {
      setBusy(false);
    }
  };

  const billName =
    target?.kind === 'existing'
      ? target.reservation.fullName
      : (walkinName.trim() || t('vippos.walkinFallbackName'));
  const billTable =
    target?.kind === 'existing'
      ? target.reservation.assignedTableName || target.reservation.zoneName
      : zones.find(z => z.id === walkinZoneId)?.name || '';

  return (
    <Sheet open={open} onOpenChange={o => !o && onClose()}>
      <SheetContent side="bottom" className="flex h-[96vh] flex-col gap-0 rounded-t-3xl p-0" style={{ background: '#08080a' }}>
        {/* ── En-tête ── */}
        <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-4">
          {step !== 'cart' ? (
            <button
              type="button"
              onClick={() => { haptics.selection(); setStep(step === 'bill' ? 'link' : 'cart'); }}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl"
              style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'rgba(232,25,44,0.12)' }}>
              <ShoppingBag className="h-4 w-4" style={{ color: RED }} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p style={{ color: T1, fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>
              {step === 'cart' ? t('vippos.cartTitle') : step === 'link' ? t('vippos.linkTitle') : t('vippos.billTitle')}
            </p>
            {count > 0 && step !== 'bill' && (
              <p className="tabular-nums" style={{ color: T3, fontSize: 11.5 }}>
                {t('vippos.itemsCount').replace('{n}', String(count))} · {fmtEuro(total)}
              </p>
            )}
          </div>
        </div>

        {/* ── ÉTAPE 1 : PANIER ── */}
        {step === 'cart' && (
          <>
            <div className="shrink-0 px-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: T3 }} />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('vipnight.searchItem')} className="h-10 pl-9" />
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {menuItems.length === 0 ? (
                <p className="py-12 text-center text-sm" style={{ color: T3 }}>{t('vipnight.emptyMenu')}</p>
              ) : (
                SECTION_ORDER.map(section => {
                  const items = grouped[section];
                  if (items.length === 0) return null;
                  return (
                    <div key={section}>
                      <p className="mb-1.5 px-0.5" style={{ color: T3, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        {t(SECTION_KEY[section])}
                      </p>
                      <div className="space-y-1.5">
                        {items.map(m => {
                          const q = qty[m.id] || 0;
                          return (
                            <div
                              key={m.id}
                              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
                              style={{ background: q > 0 ? 'rgba(232,25,44,0.08)' : C_FAINT, border: `1px solid ${q > 0 ? 'rgba(232,25,44,0.32)' : BORDER}` }}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{m.name}</p>
                                <p className="tabular-nums" style={{ color: T3, fontSize: 11 }}>
                                  {m.volumeCl ? `${m.volumeCl}cl · ` : ''}{m.price === 0 ? t('vipnight.included') : fmtEuro(m.price)}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                {q > 0 && (
                                  <>
                                    <button type="button" onClick={() => bump(m.id, -1)} className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg" style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, color: T1 }}>
                                      <Minus className="h-4 w-4" />
                                    </button>
                                    <span className="w-6 text-center tabular-nums" style={{ color: T1, fontSize: 14, fontWeight: 700 }}>{q}</span>
                                  </>
                                )}
                                <button type="button" onClick={() => bump(m.id, 1)} className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg" style={{ background: q > 0 ? RED : 'rgba(255,255,255,0.06)', border: `1px solid ${q > 0 ? RED : BORDER}`, color: q > 0 ? '#fff' : T1 }}>
                                  <Plus className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <Footer>
              <PrimaryButton disabled={count === 0} onClick={() => { haptics.selection(); setStep('link'); }}>
                {t('vippos.next')} · {fmtEuro(total)}
                <ChevronRight className="h-4 w-4" />
              </PrimaryButton>
            </Footer>
          </>
        )}

        {/* ── ÉTAPE 2 : RELIER ── */}
        {step === 'link' && (
          <>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
              {/* Walk-in */}
              <button
                type="button"
                onClick={() => { haptics.selection(); setMode('walkin'); setTarget(null); }}
                className="flex w-full cursor-pointer items-center gap-3 rounded-2xl p-3.5 text-left transition-all duration-150"
                style={{ background: mode === 'walkin' ? 'rgba(231,193,90,0.10)' : C_FAINT, border: `1px solid ${mode === 'walkin' ? 'rgba(231,193,90,0.5)' : BORDER}` }}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'rgba(231,193,90,0.14)' }}>
                  <UserPlus className="h-5 w-5" style={{ color: GOLD }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block" style={{ color: T1, fontSize: 14, fontWeight: 700 }}>{t('vippos.walkinCard')}</span>
                  <span className="block" style={{ color: T3, fontSize: 11.5 }}>{t('vippos.walkinSub')}</span>
                </span>
                {mode === 'walkin' && <Check className="h-5 w-5" style={{ color: GOLD }} />}
              </button>

              {mode === 'walkin' && (
                <div className="space-y-3 rounded-2xl p-3.5" style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
                  <div>
                    <label className="mb-1 block" style={{ color: T3, fontSize: 11 }}>{t('vippos.walkinName')}</label>
                    <Input value={walkinName} onChange={e => setWalkinName(e.target.value)} placeholder={t('vippos.walkinFallbackName')} className="h-10" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: T2, fontSize: 13 }}>{t('vippos.walkinGuests')}</span>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setWalkinGuests(g => Math.max(1, g - 1))} className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg" style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, color: T1 }}><Minus className="h-4 w-4" /></button>
                      <span className="w-6 text-center tabular-nums" style={{ color: T1, fontSize: 15, fontWeight: 700 }}>{walkinGuests}</span>
                      <button type="button" onClick={() => setWalkinGuests(g => g + 1)} className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg" style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, color: T1 }}><Plus className="h-4 w-4" /></button>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block" style={{ color: T3, fontSize: 11 }}>{t('vippos.walkinZone')}</label>
                    {zones.length === 0 ? (
                      <p style={{ color: T3, fontSize: 12 }}>{t('vippos.noZone')}</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {zones.map(z => (
                          <button
                            key={z.id}
                            type="button"
                            onClick={() => { haptics.selection(); setWalkinZoneId(z.id); }}
                            className="flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150"
                            style={walkinZoneId === z.id ? { background: RED, color: '#fff' } : { background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T2 }}
                          >
                            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: z.color }} />
                            {z.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Résas existantes */}
              {seatedReservations.length > 0 && (
                <div>
                  <p className="mb-1.5 px-0.5" style={{ color: T3, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {t('vippos.existingTitle')}
                  </p>
                  <div className="space-y-1.5">
                    {seatedReservations.map(r => {
                      const sel = mode === 'existing' && target?.kind === 'existing' && target.reservation.id === r.id;
                      const info = serviceInfo.get(r.id);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => { haptics.selection(); setMode('existing'); setTarget({ kind: 'existing', reservation: r }); }}
                          className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl p-3 text-left transition-all duration-150"
                          style={{ background: sel ? 'rgba(232,25,44,0.08)' : C_FAINT, border: `1px solid ${sel ? 'rgba(232,25,44,0.4)' : BORDER}` }}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 700 }}>{r.fullName}</p>
                            <p className="flex items-center gap-2" style={{ color: T3, fontSize: 11 }}>
                              <span className="inline-flex items-center gap-1">
                                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: r.zoneColor }} />
                                {r.assignedTableName ? <span style={{ color: T2, fontWeight: 600 }}><MapPin className="mr-0.5 inline h-3 w-3" />{r.assignedTableName}</span> : r.zoneName}
                              </span>
                              <span className="inline-flex items-center gap-0.5 tabular-nums"><Users className="h-3 w-3" /> {r.guestCount}</span>
                              {info && info.creditLeft > 0 && <span className="tabular-nums" style={{ color: GOLD }}>{fmtEuro(info.creditLeft)} {t('vipnight.creditLeft').toLowerCase()}</span>}
                            </p>
                          </div>
                          {sel && <Check className="h-5 w-5 shrink-0" style={{ color: RED }} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <Footer>
              <PrimaryButton disabled={!targetValid} onClick={() => { haptics.selection(); goToBill(); }}>
                {t('vippos.pay')} · {fmtEuro(total)}
                <ChevronRight className="h-4 w-4" />
              </PrimaryButton>
            </Footer>
          </>
        )}

        {/* ── ÉTAPE 3 : ADDITION (plein écran, montrable au client) ── */}
        {step === 'bill' && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
              <div className="mx-auto max-w-md">
                {/* En-tête club */}
                <div className="border-b pb-5 pt-3 text-center" style={{ borderColor: BORDER }}>
                  <p style={{ color: GOLD, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase' }}>
                    {venueName || 'Yuno'}
                  </p>
                  {eventTitle && <p className="mt-1" style={{ color: T3, fontSize: 11.5 }}>{eventTitle}</p>}
                  <p className="mt-4" style={{ color: T1, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>{billName}</p>
                  {billTable && (
                    <p className="mt-1 inline-flex items-center gap-1" style={{ color: T2, fontSize: 12.5 }}>
                      <MapPin className="h-3.5 w-3.5" style={{ color: T3 }} />{billTable}
                    </p>
                  )}
                </div>

                {/* Lignes */}
                <div className="space-y-0.5 py-4">
                  {lines.map(l => (
                    <div key={l.menuItem!.id} className="flex items-baseline gap-3 py-2">
                      <span className="tabular-nums" style={{ color: GOLD, fontSize: 14, fontWeight: 700, minWidth: 26 }}>{l.quantity}×</span>
                      <span className="min-w-0 flex-1" style={{ color: T1, fontSize: 14.5, fontWeight: 500 }}>{l.menuItem!.name}</span>
                      <span className="tabular-nums" style={{ color: T2, fontSize: 14, fontWeight: 600 }}>{fmtEuro(l.menuItem!.price * l.quantity)}</span>
                    </div>
                  ))}
                </div>

                {/* Total */}
                <div className="flex items-baseline justify-between border-t pt-4" style={{ borderColor: BORDER }}>
                  <span style={{ color: T2, fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('vippos.total')}</span>
                  <span className="tabular-nums" style={{ color: GOLD, fontSize: 40, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1 }}>{fmtEuro(total)}</span>
                </div>
                <p className="mt-3 flex items-center justify-center gap-1.5 text-center" style={{ color: T3, fontSize: 11.5 }}>
                  <Wine className="h-3.5 w-3.5" />{t('vippos.paidAtClub')}
                </p>
              </div>
            </div>
            <Footer>
              <button
                type="button"
                disabled={busy || disabled}
                onClick={commit}
                className="flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl font-bold transition-transform active:scale-[0.99] disabled:opacity-50"
                style={{ background: GOLD, color: '#1a1206', fontSize: 16 }}
              >
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Check className="h-5 w-5" />{t('vippos.confirmPaid')}</>}
              </button>
            </Footer>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="shrink-0 border-t px-4 pt-3"
      style={{ borderColor: BORDER, background: 'rgba(8,8,10,0.96)', paddingBottom: 'calc(0.875rem + env(safe-area-inset-bottom, 0px))' }}
    >
      {children}
    </div>
  );
}

function PrimaryButton({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-13 w-full cursor-pointer items-center justify-center gap-1.5 rounded-2xl font-bold transition-transform active:scale-[0.99] disabled:opacity-40"
      style={{ background: RED, color: '#fff', fontSize: 15, height: 52 }}
    >
      {children}
    </button>
  );
}
