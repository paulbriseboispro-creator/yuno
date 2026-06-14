import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, Reorder } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Edit2, Plus, Upload, X, Trash2, Wine, Coffee, Package, GripVertical, Save, ChevronDown } from 'lucide-react';
import { Drink } from '@/types';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { DrinkCatalogSearch } from '@/components/DrinkCatalogSearch';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED     = '#E8192C';
const T1      = 'rgba(255,255,255,0.96)';
const T2      = 'rgba(255,255,255,0.58)';
const T3      = 'rgba(255,255,255,0.36)';
const C_FAINT = 'rgba(255,255,255,0.06)';
const BORDER  = 'rgba(255,255,255,0.085)';
const F_BORDER= 'rgba(255,255,255,0.055)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const INNER_BG = 'rgba(255,255,255,0.032)';
const TILE_BG  = 'rgba(255,255,255,0.025)';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

type SortMode = 'recent' | 'price_asc' | 'price_desc' | 'custom';

const CATEGORY_TABS = [
  { key: 'all',   label: 'Tout',    icon: null },
  { key: 'drink', label: 'Boissons', icon: Wine },
  { key: 'shot',  label: 'Shots',    icon: null },
  { key: 'soft',  label: 'Softs',    icon: Coffee },
] as const;

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>{children}</p>;
}

function DarkInput({ id, value, onChange, placeholder, type = 'text', step }: {
  id?: string; value: string | number; onChange: (v: string) => void;
  placeholder?: string; type?: string; step?: string;
}) {
  return (
    <input id={id} type={type} value={value} step={step} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full px-3 py-2.5 rounded-xl text-[13px] transition-all duration-150"
      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
      onFocus={e => (e.target.style.borderColor = 'rgba(255,255,255,0.18)')}
      onBlur={e => (e.target.style.borderColor = BORDER)}
    />
  );
}

// ─── Reorder row (custom sort) ─────────────────────────────────────────────────
function ReorderSection({ title, icon: Icon, drinks, onReorder, onEdit, t }: {
  title: string; icon: any; drinks: Drink[];
  onReorder: (d: Drink[]) => void; onEdit: (d: Drink) => void; t: (k: string) => string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="w-4 h-4" style={{ color: T3 }} />}
        <p style={{ color: T1, fontSize: 13.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</p>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: C_FAINT, color: T3 }}>{drinks.length}</span>
      </div>
      <Reorder.Group axis="y" values={drinks} onReorder={onReorder} className="space-y-2">
        {drinks.map((drink) => (
          <Reorder.Item key={drink.id} value={drink} className="list-none" whileDrag={{ scale: 1.02, boxShadow: '0 8px 30px rgba(0,0,0,0.6)' }}>
            <div className="flex items-center gap-3 p-3 rounded-xl cursor-grab active:cursor-grabbing touch-none"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <GripVertical className="w-4 h-4 flex-shrink-0" style={{ color: T3 }} />
              <img src={drink.imgUrl} alt={drink.name} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p style={{ color: T1, fontSize: 13, fontWeight: 560 }} className="truncate">{drink.name}</p>
                <p style={{ color: T3, fontSize: 12 }} className="tabular-nums">€{drink.price.toFixed(2)}</p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); onEdit(drink); }}
                className="w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150"
                style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}>
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </Reorder.Item>
        ))}
      </Reorder.Group>
    </div>
  );
}

// ─── Grid card (non-custom sorts) ─────────────────────────────────────────────
function DrinkGridCard({ drink, onEdit, onDelete, t }: {
  drink: Drink; onEdit: (d: Drink) => void; onDelete: (id: string) => void; t: (k: string) => string;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <div style={{ background: TILE_BG, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
        <div className="aspect-square overflow-hidden">
          <img src={drink.imgUrl} alt={drink.name} className="h-full w-full object-cover" />
        </div>
        <div className="p-2.5 space-y-2">
          <p style={{ color: T1, fontSize: 13, fontWeight: 560 }} className="truncate">{drink.name}</p>
          <div>
            {drink.promoPrice ? (
              <div className="flex items-center gap-1.5">
                <span style={{ color: RED, fontSize: 13, fontWeight: 640 }} className="tabular-nums">€{drink.promoPrice.toFixed(2)}</span>
                <span style={{ color: T3, fontSize: 11, textDecoration: 'line-through' }} className="tabular-nums">€{drink.price.toFixed(2)}</span>
              </div>
            ) : (
              <span style={{ color: T1, fontSize: 13, fontWeight: 620 }} className="tabular-nums">€{drink.price.toFixed(2)}</span>
            )}
            {drink.presalePrice && (
              <div className="flex items-center gap-1 mt-0.5">
                <span style={{ color: '#818CF8', fontSize: 11 }} className="tabular-nums">Presale: €{drink.presalePrice.toFixed(2)}</span>
                {drink.presaleActive && <span style={{ color: '#818CF8', fontSize: 10 }}>✓</span>}
              </div>
            )}
          </div>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
            style={drink.active
              ? { background: 'rgba(52,211,153,0.12)', color: '#34D399' }
              : { background: C_FAINT, color: T3 }
            }>
            {drink.active ? t('owner.active') : t('owner.inactive')}
          </span>
          <div className="flex gap-1.5 pt-0.5">
            <button onClick={() => onEdit(drink)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11.5px] font-medium cursor-pointer transition-all duration-150"
              style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}>
              <Edit2 className="w-3 h-3" />{t('owner.modify')}
            </button>
            <button onClick={() => onDelete(drink.id)}
              className="w-7 h-7 flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150"
              style={{ background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.18)', color: '#FF5C63' }}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function CategorySection({ title, icon: Icon, drinks, onEdit, onDelete, t }: {
  title: string; icon: any; drinks: Drink[];
  onEdit: (d: Drink) => void; onDelete: (id: string) => void; t: (k: string) => string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="w-4 h-4" style={{ color: T3 }} />}
        <p style={{ color: T1, fontSize: 13.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</p>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: C_FAINT, color: T3 }}>{drinks.length}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {drinks.map((drink) => (
          <DrinkGridCard key={drink.id} drink={drink} onEdit={onEdit} onDelete={onDelete} t={t} />
        ))}
      </div>
    </div>
  );
}

// ─── Martini icon fallback ─────────────────────────────────────────────────────
function MartiniIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 22h8M12 11v11M3 3l9 8 9-8" />
    </svg>
  );
}

export default function OwnerMenu() {
  const { t } = useLanguage();
  const { venueId, loading: venueLoading } = useVenueContext();
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingDrink, setEditingDrink] = useState<Drink | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'drink' | 'shot' | 'soft'>('all');
  const [sortMode, setSortMode] = useState<SortMode>('custom');
  const [customOrder, setCustomOrder] = useState<Drink[]>([]);
  const [hasCustomChanges, setHasCustomChanges] = useState(false);
  const [imagePreview, setImagePreview] = useState('');
  const [clickCollectMode, setClickCollectMode] = useState(false);
  const [togglingCC, setTogglingCC] = useState(false);

  const [formData, setFormData] = useState({
    name: '', price: 0, promoPrice: null as number | null,
    presalePrice: null as number | null, presaleActive: false,
    imgUrl: '', desc: '', alcPct: 0, active: true,
    collection: 'drink' as 'drink' | 'shot' | 'soft',
  });

  useEffect(() => {
    if (!venueId) return;
    supabase.from('venues').select('click_collect_mode').eq('id', venueId).maybeSingle().then(({ data }) => {
      if (data) setClickCollectMode(data.click_collect_mode === true);
    });
  }, [venueId]);

  const handleToggleClickCollect = async () => {
    if (!venueId || togglingCC) return;
    setTogglingCC(true);
    const newValue = !clickCollectMode;
    try {
      const { error } = await supabase.from('venues').update({ click_collect_mode: newValue }).eq('id', venueId);
      if (error) throw error;
      setClickCollectMode(newValue);
      toast.success(newValue ? t('owner.clickCollectEnabled') : t('owner.clickCollectDisabled'));
    } catch (err) { toast.error(t('owner.errorSaving')); }
    finally { setTogglingCC(false); }
  };

  useEffect(() => {
    if (!venueId) return;
    fetchDrinks();
    const channel = supabase.channel('owner-drinks-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drinks', filter: `venue_id=eq.${venueId}` }, () => fetchDrinks())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [venueId]);

  const fetchDrinks = async () => {
    if (!venueId) return;
    try {
      const { data, error } = await supabase.from('drinks').select('*').eq('venue_id', venueId).order('position', { ascending: true });
      if (error) throw error;
      const mappedDrinks: Drink[] = (data || []).map((d: any) => ({
        id: d.id, name: d.name, description: d.description || '',
        price: Number(d.price),
        promoPrice: d.promo_price ? Number(d.promo_price) : undefined,
        presalePrice: d.presale_price ? Number(d.presale_price) : undefined,
        presaleActive: d.presale_active || false,
        alcPct: d.alc_pct ? Number(d.alc_pct) : undefined,
        imgUrl: d.img_url, venueId: d.venue_id, active: d.active,
        position: d.position || 0,
        collection: (d.collection || 'drink') as 'drink' | 'shot' | 'soft',
      }));
      setDrinks(mappedDrinks);
    } catch (error) { toast.error(t('owner.errorLoading')); }
    finally { setLoading(false); }
  };

  const sortedDrinks = useMemo(() => {
    if (sortMode === 'custom') return customOrder.length ? customOrder : drinks;
    const sorted = [...drinks];
    if (sortMode === 'recent') return sorted.reverse();
    if (sortMode === 'price_asc') return sorted.sort((a, b) => a.price - b.price);
    if (sortMode === 'price_desc') return sorted.sort((a, b) => b.price - a.price);
    return sorted;
  }, [drinks, sortMode, customOrder]);

  const filteredDrinks = useMemo(() => categoryFilter === 'all' ? sortedDrinks : sortedDrinks.filter(d => d.collection === categoryFilter), [sortedDrinks, categoryFilter]);

  const groupedDrinks = useMemo(() => ({
    drink: filteredDrinks.filter(d => d.collection === 'drink'),
    shot: filteredDrinks.filter(d => d.collection === 'shot'),
    soft: filteredDrinks.filter(d => d.collection === 'soft'),
  }), [filteredDrinks]);

  useEffect(() => {
    if (sortMode === 'custom' && customOrder.length === 0 && drinks.length > 0) setCustomOrder(drinks);
  }, [drinks, sortMode]);

  const handleCategoryReorder = useCallback((category: 'drink' | 'shot' | 'soft', newCategoryDrinks: Drink[]) => {
    setCustomOrder(prev => {
      const result: Drink[] = []; let catIdx = 0;
      for (const d of prev) {
        if (d.collection === category) { if (catIdx < newCategoryDrinks.length) result.push(newCategoryDrinks[catIdx++]); }
        else result.push(d);
      }
      return result;
    });
    setHasCustomChanges(true);
  }, []);

  const handleSaveCustomOrder = async () => {
    try {
      await Promise.all(customOrder.map((drink, i) => supabase.from('drinks').update({ position: i + 1 }).eq('id', drink.id)));
      setHasCustomChanges(false);
      toast.success(t('owner.orderSaved'));
      await fetchDrinks();
    } catch (error) { toast.error(t('owner.errorSaving')); }
  };

  const openEditDialog = (drink: Drink) => {
    setEditingDrink(drink); setImagePreview(drink.imgUrl);
    setFormData({ name: drink.name, price: drink.price, promoPrice: drink.promoPrice || null, presalePrice: drink.presalePrice || null, presaleActive: drink.presaleActive || false, imgUrl: drink.imgUrl, desc: drink.description || '', alcPct: drink.alcPct || 0, active: drink.active, collection: drink.collection });
  };

  const openCreateDialog = () => {
    setIsCreating(true); setImageFile(null); setImagePreview('');
    setFormData({ name: '', price: 0, promoPrice: null, presalePrice: null, presaleActive: false, imgUrl: '', desc: '', alcPct: 0, active: true, collection: 'drink' });
  };

  const closeDialog = () => { setEditingDrink(null); setIsCreating(false); setImageFile(null); setImagePreview(''); };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setImageFile(file); const r = new FileReader(); r.onloadend = () => setImagePreview(r.result as string); r.readAsDataURL(file); }
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (!formData.name || formData.price <= 0) { toast.error(t('owner.nameAndPriceRequired')); return; }
    if (!imagePreview && !editingDrink) { toast.error(t('owner.imageRequired')); return; }
    setIsSaving(true);
    try {
      let imageUrl = formData.imgUrl;
      if (imageFile) {
        const filePath = `drinks/${Date.now()}.${imageFile.name.split('.').pop()}`;
        const { error: uploadError } = await supabase.storage.from('drink-images').upload(filePath, imageFile);
        if (uploadError) throw uploadError;
        imageUrl = supabase.storage.from('drink-images').getPublicUrl(filePath).data.publicUrl;
      }
      const payload = { name: formData.name, price: formData.price, promo_price: formData.promoPrice, presale_price: formData.presalePrice, presale_active: formData.presaleActive, img_url: imageUrl, description: formData.desc, alc_pct: formData.alcPct, active: formData.active, collection: formData.collection };
      if (editingDrink) {
        const { error } = await supabase.from('drinks').update(payload).eq('id', editingDrink.id);
        if (error) throw error;
        toast.success(t('owner.drinkUpdated'));
      } else {
        const { error } = await supabase.from('drinks').insert({ ...payload, id: crypto.randomUUID(), venue_id: venueId, position: drinks.length + 1 });
        if (error) throw error;
        toast.success(t('owner.drinkCreated'));
      }
      await fetchDrinks(); closeDialog();
    } catch (error: any) { toast.error(t('owner.errorSaving')); }
    finally { setIsSaving(false); }
  };

  const handleToggleAllPresale = async () => {
    try {
      const anyActive = drinks.filter(d => d.presalePrice).some(d => d.presaleActive);
      const { error } = await supabase.from('drinks').update({ presale_active: !anyActive }).eq('venue_id', venueId).not('presale_price', 'is', null);
      if (error) throw error;
      toast.success(!anyActive ? t('owner.presaleActivatedAll') : t('owner.presaleDeactivatedAll'));
      await fetchDrinks();
    } catch (error) { toast.error(t('owner.errorSaving')); }
  };

  const handleDeleteDrink = async (drinkId: string) => {
    if (!confirm(t('owner.confirmDeleteDrink'))) return;
    try {
      const { error } = await supabase.from('drinks').delete().eq('id', drinkId);
      if (error) throw error;
      toast.success(t('owner.drinkDeleted'));
      await fetchDrinks();
    } catch (error) { toast.error(t('owner.errorSaving')); }
  };

  if (venueLoading) return <OwnerPageSkeleton />;

  return (
    <div className="min-h-screen pb-28" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />

      <OwnerHeader title={t('owner.menuManagement')} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 pt-2 space-y-4">
        {/* Stats strip */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px 22px' }}>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex gap-8">
              {[
                { label: 'Boissons', value: drinks.filter(d => d.collection === 'drink').length },
                { label: 'Shots', value: drinks.filter(d => d.collection === 'shot').length },
                { label: 'Softs', value: drinks.filter(d => d.collection === 'soft').length },
                { label: 'Actifs', value: drinks.filter(d => d.active).length },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div style={{ color: T3, fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
                  <div style={{ color: T1, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em' }} className="tabular-nums">{value}</div>
                </div>
              ))}
            </div>
            {/* Click & Collect toggle */}
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <Package className="w-4 h-4" style={{ color: T3 }} />
              <span style={{ color: T2, fontSize: 12.5 }}>{t('owner.clickCollectMode')}</span>
              <Switch checked={clickCollectMode} onCheckedChange={handleToggleClickCollect} disabled={togglingCC} />
            </div>
          </div>
        </div>

        {/* Actions bar */}
        <div className="flex flex-wrap items-center gap-3">
          {venueId && (
            <DrinkCatalogSearch venueId={venueId} onDrinkAdded={fetchDrinks} />
          )}
          <button
            onClick={openCreateDialog}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold cursor-pointer transition-all duration-150"
            style={{ background: RED, color: '#fff', boxShadow: `0 0 18px -6px ${RED}88` }}
          >
            <Plus className="w-4 h-4" />
            {t('owner.addManually')}
          </button>
          {drinks.some(d => d.presalePrice) && (
            <button
              onClick={handleToggleAllPresale}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium cursor-pointer transition-all duration-150"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
            >
              {drinks.some(d => d.presalePrice && d.presaleActive) ? t('owner.deactivateAllPresale') : t('owner.activateAllPresale')}
            </button>
          )}
          {/* Sort selector */}
          <div className="relative ml-auto">
            <select
              value={sortMode}
              onChange={e => {
                const v = e.target.value as SortMode;
                setSortMode(v);
                if (v === 'custom') { setCustomOrder(drinks); setHasCustomChanges(false); }
              }}
              className="appearance-none pr-8 pl-3 py-2 rounded-xl text-[13px] cursor-pointer"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
            >
              <option value="custom" style={{ background: '#0a0a0c' }}>{t('owner.sortCustom')}</option>
              <option value="recent" style={{ background: '#0a0a0c' }}>{t('owner.sortRecent')}</option>
              <option value="price_asc" style={{ background: '#0a0a0c' }}>{t('owner.sortPriceAsc')}</option>
              <option value="price_desc" style={{ background: '#0a0a0c' }}>{t('owner.sortPriceDesc')}</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: T3 }} />
          </div>
          {sortMode === 'custom' && hasCustomChanges && (
            <button
              onClick={handleSaveCustomOrder}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold cursor-pointer transition-all duration-150"
              style={{ background: `rgba(52,211,153,0.12)`, border: `1px solid rgba(52,211,153,0.25)`, color: '#34D399' }}
            >
              <Save className="w-3.5 h-3.5" />
              {t('owner.save') || 'Sauvegarder'}
            </button>
          )}
        </div>

        {/* Main card */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
          {/* Category tab bar */}
          <div className="flex gap-0.5 px-4 pt-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
            {CATEGORY_TABS.map(({ key, label, icon: Icon }) => {
              const count = key === 'all' ? drinks.length : drinks.filter(d => d.collection === key).length;
              const isActive = categoryFilter === key;
              return (
                <button
                  key={key}
                  onClick={() => setCategoryFilter(key as typeof categoryFilter)}
                  className="relative inline-flex items-center gap-1.5 px-4 py-3 text-[13px] font-[560] transition-colors duration-150 cursor-pointer"
                  style={{ color: isActive ? T1 : T3 }}
                >
                  {Icon && <Icon className="w-3.5 h-3.5" />}
                  {label}
                  <span style={{ color: isActive ? T2 : 'rgba(255,255,255,0.2)', fontSize: 11 }}>({count})</span>
                  {isActive && (
                    <span className="absolute left-3 right-3 rounded-full" style={{ bottom: -1, height: 2, background: RED, boxShadow: `0 0 10px rgba(232,25,44,0.6)` }} />
                  )}
                </button>
              );
            })}
          </div>

          {/* Content */}
          <div className="p-5">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
              </div>
            ) : filteredDrinks.length === 0 ? (
              <div className="text-center py-16">
                <Wine className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
                <p style={{ color: T3, fontSize: 13 }}>{t('owner.noDrinksDesc')}</p>
              </div>
            ) : (
              <div className="space-y-8">
                {sortMode === 'custom' ? (
                  <>
                    {groupedDrinks.drink.length > 0 && <ReorderSection title={t('venue.drinks')} icon={Wine} drinks={groupedDrinks.drink} onReorder={d => handleCategoryReorder('drink', d)} onEdit={openEditDialog} t={t} />}
                    {groupedDrinks.shot.length > 0 && <ReorderSection title={t('venue.shots')} icon={MartiniIcon} drinks={groupedDrinks.shot} onReorder={d => handleCategoryReorder('shot', d)} onEdit={openEditDialog} t={t} />}
                    {groupedDrinks.soft.length > 0 && <ReorderSection title={t('venue.softs')} icon={Coffee} drinks={groupedDrinks.soft} onReorder={d => handleCategoryReorder('soft', d)} onEdit={openEditDialog} t={t} />}
                  </>
                ) : (
                  <>
                    {groupedDrinks.drink.length > 0 && <CategorySection title={t('venue.drinks')} icon={Wine} drinks={groupedDrinks.drink} onEdit={openEditDialog} onDelete={handleDeleteDrink} t={t} />}
                    {groupedDrinks.shot.length > 0 && <CategorySection title={t('venue.shots')} icon={MartiniIcon} drinks={groupedDrinks.shot} onEdit={openEditDialog} onDelete={handleDeleteDrink} t={t} />}
                    {groupedDrinks.soft.length > 0 && <CategorySection title={t('venue.softs')} icon={Coffee} drinks={groupedDrinks.soft} onEdit={openEditDialog} onDelete={handleDeleteDrink} t={t} />}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit / Create dialog */}
      <Dialog open={!!editingDrink || isCreating} onOpenChange={closeDialog}>
        <DialogContent className="border-0 p-0 overflow-hidden max-h-[90vh] overflow-y-auto"
          style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18, maxWidth: 560 }}>
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>
              {editingDrink ? t('owner.editDrink') : t('owner.createDrink')}
            </DialogTitle>
            <DialogDescription className="sr-only">{editingDrink ? t('owner.editDrink') : t('owner.createDrink')}</DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-5">
            {/* Name */}
            <div>
              <FieldLabel>{t('owner.name')}</FieldLabel>
              <DarkInput value={formData.name} onChange={v => setFormData({ ...formData, name: v })} />
            </div>

            {/* Image */}
            <div>
              <FieldLabel>{t('owner.drinkImage')}</FieldLabel>
              {imagePreview ? (
                <div className="relative w-full h-40 rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
                  <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                  <button
                    onClick={() => { setImageFile(null); setImagePreview(''); setFormData({ ...formData, imgUrl: '' }); }}
                    className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer"
                    style={{ background: 'rgba(0,0,0,0.6)', border: `1px solid ${BORDER}`, color: '#FF5C63' }}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <input id="drink-image" type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                  <button
                    type="button"
                    onClick={() => document.getElementById('drink-image')?.click()}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-medium cursor-pointer transition-all duration-150"
                    style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
                  >
                    <Upload className="w-4 h-4" />{t('owner.addImage')}
                  </button>
                </>
              )}
            </div>

            {/* Prices */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>{t('owner.normalPrice')} (€)</FieldLabel>
                <DarkInput type="number" step="0.5" value={formData.price} onChange={v => setFormData({ ...formData, price: parseFloat(v) || 0 })} />
              </div>
              <div>
                <FieldLabel>{t('owner.promoPrice')} (€)</FieldLabel>
                <DarkInput type="number" step="0.5" value={formData.promoPrice || ''} onChange={v => setFormData({ ...formData, promoPrice: v ? parseFloat(v) : null })} placeholder={t('owner.optional')} />
              </div>
            </div>

            {/* Presale */}
            <div>
              <FieldLabel>{t('owner.presalePrice')} (€)</FieldLabel>
              <p style={{ color: T3, fontSize: 11.5, marginBottom: 6 }}>{t('owner.presalePriceDesc')}</p>
              <DarkInput type="number" step="0.5" value={formData.presalePrice || ''} onChange={v => setFormData({ ...formData, presalePrice: v ? parseFloat(v) : null })} placeholder={t('owner.optional')} />
            </div>

            {formData.presalePrice && (
              <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: 'rgba(129,140,248,0.06)', border: '1px solid rgba(129,140,248,0.2)' }}>
                <div>
                  <p style={{ color: '#A5B4FC', fontSize: 13, fontWeight: 560 }}>{t('owner.presaleActiveToggle')}</p>
                  <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{t('owner.presaleActiveDesc')}</p>
                </div>
                <Switch checked={formData.presaleActive} onCheckedChange={v => setFormData({ ...formData, presaleActive: v })} />
              </div>
            )}

            {/* Desc + Alc */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>{t('owner.description')}</FieldLabel>
                <DarkInput value={formData.desc} onChange={v => setFormData({ ...formData, desc: v })} />
              </div>
              <div>
                <FieldLabel>{t('owner.alcoholPct')} (%)</FieldLabel>
                <DarkInput type="number" step="0.1" value={formData.alcPct} onChange={v => setFormData({ ...formData, alcPct: parseFloat(v) || 0 })} />
              </div>
            </div>

            {/* Collection */}
            <div>
              <FieldLabel>{t('owner.collection')}</FieldLabel>
              <div className="relative">
                <select
                  value={formData.collection}
                  onChange={e => setFormData({ ...formData, collection: e.target.value as 'drink' | 'shot' | 'soft' })}
                  className="w-full appearance-none px-3 py-2.5 rounded-xl text-[13px] cursor-pointer"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
                >
                  <option value="drink" style={{ background: '#0a0a0c' }}>{t('owner.drinkNormal')}</option>
                  <option value="shot" style={{ background: '#0a0a0c' }}>{t('owner.shot')}</option>
                  <option value="soft" style={{ background: '#0a0a0c' }}>{t('owner.soft')}</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: T3 }} />
              </div>
            </div>

            {/* Active toggle */}
            <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <div>
                <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{t('owner.drinkActive')}</p>
                <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>Visible dans l'app cliente</p>
              </div>
              <Switch checked={formData.active} onCheckedChange={v => setFormData({ ...formData, active: v })} />
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex-1 py-3 rounded-xl text-[13.5px] font-semibold cursor-pointer transition-all duration-150"
                style={{ background: isSaving ? 'rgba(232,25,44,0.5)' : RED, color: '#fff', boxShadow: isSaving ? 'none' : `0 0 20px -6px ${RED}88` }}
              >
                {isSaving ? '…' : (editingDrink ? t('owner.update') : t('owner.create'))}
              </button>
              <button
                onClick={closeDialog}
                disabled={isSaving}
                className="px-5 py-3 rounded-xl text-[13.5px] font-medium cursor-pointer transition-all duration-150"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
              >
                {t('owner.cancel')}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
