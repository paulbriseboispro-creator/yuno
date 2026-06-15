import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Search, Upload, X, Trash2, Check, Clock, XCircle, Pencil, Wine, Martini, Coffee, Filter, type LucideIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED        = '#E8192C';
const POS        = '#34D399';
const NEG        = '#FF5C63';
const T1         = 'rgba(255,255,255,0.96)';
const T2         = 'rgba(255,255,255,0.58)';
const T3         = 'rgba(255,255,255,0.36)';
const C_FAINT    = 'rgba(255,255,255,0.06)';
const BORDER     = 'rgba(255,255,255,0.085)';
const F_BORDER   = 'rgba(255,255,255,0.055)';
const INNER_BG   = 'rgba(255,255,255,0.032)';
const TILE_BG    = 'rgba(255,255,255,0.025)';
const CARD_BG    = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const inputStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
  color: T1, fontSize: 13, padding: '9px 12px', width: '100%', outline: 'none',
};

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 16px',
  borderRadius: 10, background: RED, border: '1px solid rgba(232,25,44,0.5)',
  color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 14px',
  borderRadius: 10, background: INNER_BG, border: `1px solid ${BORDER}`,
  color: T2, fontSize: 12.5, fontWeight: 560, cursor: 'pointer',
};

interface CatalogDrink { id: string; name: string; category: string; image_url: string | null; description: string | null; alc_pct: number | null; brand: string | null; created_at: string; }
interface DrinkRequest { id: string; venue_id: string; drink_name: string; category: string; brand: string | null; description: string | null; image_url: string | null; status: string; admin_notes: string | null; created_at: string; venue?: { name: string }; }

const DrinkCard = ({ drink, index, onEdit, onDelete, t }: { drink: CatalogDrink; index: number; onEdit: (d: CatalogDrink) => void; onDelete: (id: string) => void; t: (k: string) => string }) => (
  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.02 }}>
    <div style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden', height: '100%' }}>
      <div className="aspect-square overflow-hidden" style={{ background: TILE_BG }}>
        {drink.image_url
          ? <img src={drink.image_url} alt={drink.name} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center" style={{ color: T3, fontSize: 12 }}>{t('adminDrinks.noImage')}</div>}
      </div>
      <div style={{ padding: 16 }}>
        <h3 className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{drink.name}</h3>
        {drink.brand && <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>{drink.brand}</p>}
        <div className="flex items-center gap-2 mt-2 min-h-[1.5rem]">
          {drink.alc_pct !== null && drink.alc_pct > 0 && (
            <span className="tabular-nums" style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 999, background: C_FAINT, border: `1px solid ${BORDER}`, color: T2, fontSize: 11, fontWeight: 600 }}>{drink.alc_pct}%</span>
          )}
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={() => onEdit(drink)} style={{ ...secondaryBtn, flex: 1 }} className="transition-all duration-150">
            <Pencil className="h-4 w-4" />{t('adminDrinks.edit')}
          </button>
          <button onClick={() => onDelete(drink.id)} className="shrink-0 cursor-pointer transition-all duration-150" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 10, background: 'rgba(255,92,99,0.1)', border: '1px solid rgba(255,92,99,0.25)', color: NEG }}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  </motion.div>
);

// ─── Status pill (request state) ──────────────────────────────────────────────
function StatusPill({ status }: { status: string }) {
  const map: Record<string, { color: string; bg: string; border: string; Icon: LucideIcon }> = {
    pending: { color: '#FCD34D', bg: 'rgba(234,179,8,0.06)', border: 'rgba(234,179,8,0.3)', Icon: Clock },
    approved: { color: POS, bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.25)', Icon: Check },
    rejected: { color: NEG, bg: 'rgba(255,92,99,0.1)', border: 'rgba(255,92,99,0.25)', Icon: XCircle },
  };
  const cfg = map[status] || map.pending;
  const { Icon } = cfg;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color, fontSize: 11, fontWeight: 600 }}>
      <Icon className="h-3 w-3" />{status}
    </span>
  );
}

export default function AdminDrinkCatalog() {
  const { t } = useLanguage();
  const [catalog, setCatalog] = useState<CatalogDrink[]>([]);
  const [requests, setRequests] = useState<DrinkRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'catalog' | 'requests'>('catalog');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingDrink, setEditingDrink] = useState<CatalogDrink | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [formData, setFormData] = useState({ name: '', category: 'drink', description: '', brand: '', alc_pct: 0 });

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const [catalogRes, requestsRes] = await Promise.all([supabase.from('drink_catalog').select('*').order('name'), supabase.from('drink_requests').select('*, venue:venues(name)').order('created_at', { ascending: false })]);
      if (catalogRes.data) setCatalog(catalogRes.data);
      if (requestsRes.data) setRequests(requestsRes.data as DrinkRequest[]);
    } catch (error) { console.error('Error fetching data:', error); }
    finally { setLoading(false); }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) { setImageFile(file); const reader = new FileReader(); reader.onloadend = () => setImagePreview(reader.result as string); reader.readAsDataURL(file); } };

  const openCreateDialog = () => { setEditingDrink(null); resetForm(); setIsDialogOpen(true); };
  const openEditDialog = (drink: CatalogDrink) => { setEditingDrink(drink); setFormData({ name: drink.name, category: drink.category, description: drink.description || '', brand: drink.brand || '', alc_pct: drink.alc_pct || 0 }); setImagePreview(drink.image_url || ''); setImageFile(null); setIsDialogOpen(true); };

  const handleSave = async () => {
    if (!formData.name) { toast.error(t('adminDrinks.nameRequired')); return; }
    setIsSaving(true);
    try {
      let imageUrl = editingDrink?.image_url || null;
      if (imageFile) { const fileExt = imageFile.name.split('.').pop(); const fileName = `catalog/${Date.now()}.${fileExt}`; const { error: uploadError } = await supabase.storage.from('drink-images').upload(fileName, imageFile); if (uploadError) throw uploadError; const { data: { publicUrl } } = supabase.storage.from('drink-images').getPublicUrl(fileName); imageUrl = publicUrl; }
      const drinkData = { name: formData.name, category: formData.category, description: formData.description || null, brand: formData.brand || null, alc_pct: formData.alc_pct || null, image_url: imageUrl };
      if (editingDrink) { const { error } = await supabase.from('drink_catalog').update(drinkData).eq('id', editingDrink.id); if (error) throw error; toast.success(t('adminDrinks.drinkModified')); }
      else { const { error } = await supabase.from('drink_catalog').insert(drinkData); if (error) throw error; toast.success(t('adminDrinks.drinkAdded')); }
      setIsDialogOpen(false); resetForm(); fetchData();
    } catch (error) { toast.error((error instanceof Error && error.message) || t('adminDrinks.saveError')); }
    finally { setIsSaving(false); }
  };

  const handleApproveRequest = async (request: DrinkRequest) => {
    try {
      const { data: catalogEntry, error: catalogError } = await supabase.from('drink_catalog').insert({ name: request.drink_name, category: request.category, brand: request.brand, description: request.description, image_url: request.image_url }).select().single();
      if (catalogError) throw catalogError;
      await supabase.from('drink_requests').update({ status: 'approved', catalog_drink_id: catalogEntry.id }).eq('id', request.id);
      toast.success(t('adminDrinks.requestApproved')); fetchData();
    } catch (error) { toast.error((error instanceof Error && error.message) || 'Error'); }
  };

  const handleRejectRequest = async (requestId: string) => { try { await supabase.from('drink_requests').update({ status: 'rejected' }).eq('id', requestId); toast.success(t('adminDrinks.requestRejected')); fetchData(); } catch { toast.error('Error'); } };

  const handleDeleteCatalog = async (id: string) => {
    if (!confirm(t('adminDrinks.confirmDelete'))) return;
    try { await supabase.from('drink_catalog').delete().eq('id', id); toast.success(t('adminDrinks.drinkDeleted')); fetchData(); } catch { toast.error('Error'); }
  };

  const resetForm = () => { setFormData({ name: '', category: 'drink', description: '', brand: '', alc_pct: 0 }); setImageFile(null); setImagePreview(''); };

  const filteredCatalog = catalog.filter(drink => { const matchesSearch = drink.name.toLowerCase().includes(searchTerm.toLowerCase()) || drink.brand?.toLowerCase().includes(searchTerm.toLowerCase()); const matchesCategory = selectedCategory === 'all' || drink.category === selectedCategory; return matchesSearch && matchesCategory; });

  const groupedDrinks = filteredCatalog.reduce((acc, drink) => { const category = drink.category || 'other'; if (!acc[category]) acc[category] = []; acc[category].push(drink); return acc; }, {} as Record<string, CatalogDrink[]>);

  const categoryConfig: Record<string, { label: string; icon: React.ReactNode }> = {
    drink: { label: t('adminDrinks.drinks'), icon: <Wine className="h-4 w-4" /> },
    shot: { label: t('adminDrinks.shots'), icon: <Martini className="h-4 w-4" /> },
    soft: { label: t('adminDrinks.softs'), icon: <Coffee className="h-4 w-4" /> },
    other: { label: t('adminDrinks.others'), icon: <Wine className="h-4 w-4" /> },
  };
  const categoryOrder = ['drink', 'shot', 'soft', 'other'];
  const pendingRequests = requests.filter(r => r.status === 'pending');
  const categoryCounts = catalog.reduce((acc, drink) => { const c = drink.category || 'other'; acc[c] = (acc[c] || 0) + 1; return acc; }, {} as Record<string, number>);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
        <div className="h-12 w-12 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
      </div>
    );
  }

  const tabs: { id: 'catalog' | 'requests'; label: string; count?: number; badge?: number }[] = [
    { id: 'catalog', label: t('adminDrinks.catalog'), count: catalog.length },
    { id: 'requests', label: t('adminDrinks.requests'), badge: pendingRequests.length },
  ];

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      {/* Ambient vignette */}
      <div className="fixed inset-0 pointer-events-none z-0" style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>{t('adminDrinks.title')}</h1>
            <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>{t('adminDrinks.subtitle')}</p>
          </div>
          <button onClick={openCreateDialog} style={primaryBtn} className="w-full sm:w-auto transition-all duration-150">
            <Plus className="h-4 w-4" />{t('adminDrinks.add')}
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
          {tabs.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="relative inline-flex items-center gap-2 px-4 py-3 transition-colors duration-150 cursor-pointer"
                style={{ color: isActive ? T1 : T3, fontSize: 13.5, fontWeight: 560, background: 'transparent', border: 'none' }}
              >
                <span>{tab.label}{tab.count !== undefined ? ` (${tab.count})` : ''}</span>
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="tabular-nums" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: RED, color: '#fff', fontSize: 10.5, fontWeight: 700 }}>{tab.badge}</span>
                )}
                {isActive && (
                  <span className="absolute left-3 right-3 rounded-full" style={{ bottom: -1, height: 2, background: RED, boxShadow: '0 0 10px rgba(232,25,44,0.6)' }} />
                )}
              </button>
            );
          })}
        </div>

        {/* Catalog tab */}
        {activeTab === 'catalog' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T3 }} />
                <input placeholder={t('adminDrinks.searchPlaceholder')} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ ...inputStyle, paddingLeft: 38 }} />
              </div>
              <div className="flex gap-1 overflow-x-auto no-scrollbar pb-1 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}` }}>
                <button
                  onClick={() => setSelectedCategory('all')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg shrink-0 cursor-pointer transition-all duration-150"
                  style={selectedCategory === 'all'
                    ? { color: '#fff', background: RED, boxShadow: `0 0 14px -4px ${RED}88`, fontSize: 12.5, fontWeight: 600 }
                    : { color: T3, fontSize: 12.5, fontWeight: 600 }}
                >
                  <Filter className="h-3.5 w-3.5" />{t('adminDrinks.all')} ({catalog.length})
                </button>
                {categoryOrder.map(cat => {
                  const config = categoryConfig[cat];
                  const count = categoryCounts[cat] || 0;
                  if (count === 0) return null;
                  const isActive = selectedCategory === cat;
                  return (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg shrink-0 cursor-pointer transition-all duration-150"
                      style={isActive
                        ? { color: '#fff', background: RED, boxShadow: `0 0 14px -4px ${RED}88`, fontSize: 12.5, fontWeight: 600 }
                        : { color: T3, fontSize: 12.5, fontWeight: 600 }}
                    >
                      {config.icon}{config.label} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedCategory === 'all' ? (
              categoryOrder.map(category => {
                const drinks = groupedDrinks[category];
                if (!drinks || drinks.length === 0) return null;
                const config = categoryConfig[category];
                return (
                  <div key={category} className="space-y-4">
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                      {config.icon}
                      <h2 style={{ color: T1, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{config.label}</h2>
                      <span className="tabular-nums" style={{ display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 999, background: C_FAINT, border: `1px solid ${F_BORDER}`, color: T3, fontSize: 11, fontWeight: 600 }}>{drinks.length}</span>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {drinks.map((drink, index) => <DrinkCard key={drink.id} drink={drink} index={index} onEdit={openEditDialog} onDelete={handleDeleteCatalog} t={t} />)}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredCatalog.map((drink, index) => <DrinkCard key={drink.id} drink={drink} index={index} onEdit={openEditDialog} onDelete={handleDeleteCatalog} t={t} />)}
              </div>
            )}
            {filteredCatalog.length === 0 && (
              <div className="text-center py-12">
                <Wine className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
                <p className="text-xs" style={{ color: T3 }}>{t('adminDrinks.noDrinkFound')}</p>
              </div>
            )}
          </div>
        )}

        {/* Requests tab */}
        {activeTab === 'requests' && (
          <div className="space-y-4">
            {requests.length === 0 ? (
              <div className="text-center py-12">
                <Clock className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
                <p className="text-xs" style={{ color: T3 }}>{t('adminDrinks.noRequests')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {requests.map((request) => (
                  <div key={request.id} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, boxShadow: CARD_SHADOW, padding: 16, overflow: 'hidden', opacity: request.status !== 'pending' ? 0.6 : 1 }}>
                    <div className="flex items-start gap-4">
                      {request.image_url && <img src={request.image_url} alt="" className="w-16 h-16 rounded-lg object-cover flex-none" style={{ border: `1px solid ${BORDER}` }} />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{request.drink_name}</h3>
                          <StatusPill status={request.status} />
                        </div>
                        <p style={{ color: T3, fontSize: 12.5, marginTop: 4 }}>{request.venue?.name} • {request.category}{request.brand && ` • ${request.brand}`}</p>
                        {request.description && <p style={{ color: T2, fontSize: 12.5, marginTop: 4 }}>{request.description}</p>}
                      </div>
                      {request.status === 'pending' && (
                        <div className="flex gap-2 flex-none">
                          <button onClick={() => handleApproveRequest(request)} className="cursor-pointer transition-all duration-150" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 10, background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: POS }}>
                            <Check className="h-4 w-4" />
                          </button>
                          <button onClick={() => handleRejectRequest(request.id)} className="cursor-pointer transition-all duration-150" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 10, background: 'rgba(255,92,99,0.1)', border: '1px solid rgba(255,92,99,0.25)', color: NEG }}>
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create / edit dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md" style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, color: T1 }}>
          <DialogHeader><DialogTitle style={{ color: T1 }}>{editingDrink ? t('adminDrinks.editDrink') : t('adminDrinks.addToCatalog')}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label style={{ color: T2, fontSize: 12.5, fontWeight: 560 }}>{t('adminDrinks.nameLabel')}</label>
              <input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} style={inputStyle} />
            </div>
            <div className="space-y-2">
              <label style={{ color: T2, fontSize: 12.5, fontWeight: 560 }}>{t('adminDrinks.categoryLabel')}</label>
              <select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} style={{ ...inputStyle, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer' }}>
                <option value="drink">{t('adminDrinks.drink')}</option>
                <option value="shot">{t('adminDrinks.shot')}</option>
                <option value="soft">{t('adminDrinks.soft')}</option>
              </select>
            </div>
            <div className="space-y-2">
              <label style={{ color: T2, fontSize: 12.5, fontWeight: 560 }}>{t('adminDrinks.brand')}</label>
              <input value={formData.brand} onChange={(e) => setFormData({ ...formData, brand: e.target.value })} style={inputStyle} />
            </div>
            <div className="space-y-2">
              <label style={{ color: T2, fontSize: 12.5, fontWeight: 560 }}>{t('adminDrinks.alcPct')}</label>
              <input type="number" step="0.1" value={formData.alc_pct} onChange={(e) => setFormData({ ...formData, alc_pct: parseFloat(e.target.value) || 0 })} style={inputStyle} />
            </div>
            <div className="space-y-2">
              <label style={{ color: T2, fontSize: 12.5, fontWeight: 560 }}>{t('adminDrinks.image')}</label>
              {imagePreview && (
                <div className="relative w-full h-32 rounded-lg overflow-hidden mb-2" style={{ border: `1px solid ${BORDER}` }}>
                  <img src={imagePreview} alt="" className="w-full h-full object-cover" />
                  <button onClick={() => { setImageFile(null); setImagePreview(''); }} className="absolute top-2 right-2 cursor-pointer" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8, background: 'rgba(255,92,99,0.15)', border: '1px solid rgba(255,92,99,0.3)', color: NEG }}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
              <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" id="catalog-image" />
              <button type="button" onClick={() => document.getElementById('catalog-image')?.click()} style={{ ...secondaryBtn, width: '100%' }} className="transition-all duration-150">
                <Upload className="h-4 w-4" />{imagePreview ? t('adminDrinks.changeImage') : t('adminDrinks.addImage')}
              </button>
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => { setIsDialogOpen(false); resetForm(); }} style={secondaryBtn} className="transition-all duration-150">{t('adminDrinks.cancel')}</button>
            <button onClick={handleSave} disabled={isSaving} style={{ ...primaryBtn, opacity: isSaving ? 0.5 : 1 }} className="transition-all duration-150">{isSaving ? '...' : editingDrink ? t('adminDrinks.save') : t('adminDrinks.add')}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
