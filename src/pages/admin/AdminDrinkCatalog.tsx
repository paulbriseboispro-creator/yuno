import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Search, Upload, X, Trash2, Check, Clock, XCircle, Pencil, Wine, Martini, Coffee, Filter } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';

interface CatalogDrink { id: string; name: string; category: string; image_url: string | null; description: string | null; alc_pct: number | null; brand: string | null; created_at: string; }
interface DrinkRequest { id: string; venue_id: string; drink_name: string; category: string; brand: string | null; description: string | null; image_url: string | null; status: string; admin_notes: string | null; created_at: string; venue?: { name: string }; }

const DrinkCard = ({ drink, index, onEdit, onDelete, t }: { drink: CatalogDrink; index: number; onEdit: (d: CatalogDrink) => void; onDelete: (id: string) => void; t: (k: string) => string }) => (
  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.02 }}>
    <Card className="overflow-hidden h-full">
      <div className="aspect-square overflow-hidden bg-muted">
        {drink.image_url ? <img src={drink.image_url} alt={drink.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-muted-foreground">{t('adminDrinks.noImage')}</div>}
      </div>
      <CardContent className="p-4">
        <h3 className="font-semibold truncate">{drink.name}</h3>
        {drink.brand && <p className="text-sm text-muted-foreground">{drink.brand}</p>}
        <div className="flex items-center gap-2 mt-2">{drink.alc_pct !== null && drink.alc_pct > 0 && <Badge variant="outline">{drink.alc_pct}%</Badge>}</div>
        <div className="flex gap-2 mt-3">
          <Button variant="outline" size="sm" className="flex-1" onClick={() => onEdit(drink)}><Pencil className="h-4 w-4 mr-2" />{t('adminDrinks.edit')}</Button>
          <Button variant="destructive" size="icon" className="shrink-0" onClick={() => onDelete(drink.id)}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </CardContent>
    </Card>
  </motion.div>
);

export default function AdminDrinkCatalog() {
  const { t } = useLanguage();
  const [catalog, setCatalog] = useState<CatalogDrink[]>([]);
  const [requests, setRequests] = useState<DrinkRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
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
    } catch (error: any) { toast.error(error.message || t('adminDrinks.saveError')); }
    finally { setIsSaving(false); }
  };

  const handleApproveRequest = async (request: DrinkRequest) => {
    try {
      const { data: catalogEntry, error: catalogError } = await supabase.from('drink_catalog').insert({ name: request.drink_name, category: request.category, brand: request.brand, description: request.description, image_url: request.image_url }).select().single();
      if (catalogError) throw catalogError;
      await supabase.from('drink_requests').update({ status: 'approved', catalog_drink_id: catalogEntry.id }).eq('id', request.id);
      toast.success(t('adminDrinks.requestApproved')); fetchData();
    } catch (error: any) { toast.error(error.message || 'Error'); }
  };

  const handleRejectRequest = async (requestId: string) => { try { await supabase.from('drink_requests').update({ status: 'rejected' }).eq('id', requestId); toast.success(t('adminDrinks.requestRejected')); fetchData(); } catch { toast.error('Error'); } };

  const handleDeleteCatalog = async (id: string) => {
    if (!confirm(t('adminDrinks.confirmDelete'))) return;
    try { await supabase.from('drink_catalog').delete().eq('id', id); toast.success(t('adminDrinks.drinkDeleted')); fetchData(); } catch { toast.error('Error'); }
  };

  const resetForm = () => { setFormData({ name: '', category: 'drink', description: '', brand: '', alc_pct: 0 }); setImageFile(null); setImagePreview(''); };

  const filteredCatalog = catalog.filter(drink => { const matchesSearch = drink.name.toLowerCase().includes(searchTerm.toLowerCase()) || drink.brand?.toLowerCase().includes(searchTerm.toLowerCase()); const matchesCategory = selectedCategory === 'all' || drink.category === selectedCategory; return matchesSearch && matchesCategory; });

  const groupedDrinks = filteredCatalog.reduce((acc, drink) => { const category = drink.category || 'other'; if (!acc[category]) acc[category] = []; acc[category].push(drink); return acc; }, {} as Record<string, CatalogDrink[]>);

  const categoryConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
    drink: { label: t('adminDrinks.drinks'), icon: <Wine className="h-5 w-5" />, color: 'bg-blue-500/10 text-blue-600 border-blue-500/30' },
    shot: { label: t('adminDrinks.shots'), icon: <Martini className="h-5 w-5" />, color: 'bg-orange-500/10 text-orange-600 border-orange-500/30' },
    soft: { label: t('adminDrinks.softs'), icon: <Coffee className="h-5 w-5" />, color: 'bg-green-500/10 text-green-600 border-green-500/30' },
    other: { label: t('adminDrinks.others'), icon: <Wine className="h-5 w-5" />, color: 'bg-gray-500/10 text-gray-600 border-gray-500/30' },
  };
  const categoryOrder = ['drink', 'shot', 'soft', 'other'];
  const pendingRequests = requests.filter(r => r.status === 'pending');
  const categoryCounts = catalog.reduce((acc, drink) => { const c = drink.category || 'other'; acc[c] = (acc[c] || 0) + 1; return acc; }, {} as Record<string, number>);

  if (loading) return <div className="flex min-h-screen items-center justify-center"><div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div><h1 className="text-2xl sm:text-3xl font-bold">{t('adminDrinks.title')}</h1><p className="text-muted-foreground">{t('adminDrinks.subtitle')}</p></div>
        <Button onClick={openCreateDialog} className="w-full sm:w-auto"><Plus className="h-4 w-4 mr-2" />{t('adminDrinks.add')}</Button>
      </div>

      <Tabs defaultValue="catalog">
        <TabsList>
          <TabsTrigger value="catalog">{t('adminDrinks.catalog')} ({catalog.length})</TabsTrigger>
          <TabsTrigger value="requests" className="relative">{t('adminDrinks.requests')}{pendingRequests.length > 0 && <Badge className="ml-2 bg-destructive text-destructive-foreground">{pendingRequests.length}</Badge>}</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="space-y-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder={t('adminDrinks.searchPlaceholder')} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" /></div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              <Button variant={selectedCategory === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setSelectedCategory('all')} className="gap-2 shrink-0"><Filter className="h-4 w-4" />{t('adminDrinks.all')} ({catalog.length})</Button>
              {categoryOrder.map(cat => { const config = categoryConfig[cat]; const count = categoryCounts[cat] || 0; if (count === 0) return null; return <Button key={cat} variant={selectedCategory === cat ? 'default' : 'outline'} size="sm" onClick={() => setSelectedCategory(cat)} className="gap-2 shrink-0">{config.icon}{config.label} ({count})</Button>; })}
            </div>
          </div>

          {selectedCategory === 'all' ? (
            categoryOrder.map(category => { const drinks = groupedDrinks[category]; if (!drinks || drinks.length === 0) return null; const config = categoryConfig[category]; return (<div key={category} className="space-y-4"><div className={`flex items-center gap-3 p-3 rounded-lg border ${config.color}`}>{config.icon}<h2 className="text-lg font-semibold">{config.label}</h2><Badge variant="secondary">{drinks.length}</Badge></div><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{drinks.map((drink, index) => <DrinkCard key={drink.id} drink={drink} index={index} onEdit={openEditDialog} onDelete={handleDeleteCatalog} t={t} />)}</div></div>); })
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{filteredCatalog.map((drink, index) => <DrinkCard key={drink.id} drink={drink} index={index} onEdit={openEditDialog} onDelete={handleDeleteCatalog} t={t} />)}</div>
          )}
          {filteredCatalog.length === 0 && <div className="text-center py-12 text-muted-foreground">{t('adminDrinks.noDrinkFound')}</div>}
        </TabsContent>

        <TabsContent value="requests" className="space-y-4">
          {requests.length === 0 ? <div className="text-center py-12 text-muted-foreground">{t('adminDrinks.noRequests')}</div> : (
            <div className="space-y-3">
              {requests.map((request) => (
                <Card key={request.id} className={request.status !== 'pending' ? 'opacity-60' : ''}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      {request.image_url && <img src={request.image_url} alt="" className="w-16 h-16 rounded-lg object-cover" />}
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{request.drink_name}</h3>
                          <Badge variant={request.status === 'pending' ? 'outline' : request.status === 'approved' ? 'default' : 'destructive'}>
                            {request.status === 'pending' && <Clock className="h-3 w-3 mr-1" />}{request.status === 'approved' && <Check className="h-3 w-3 mr-1" />}{request.status === 'rejected' && <XCircle className="h-3 w-3 mr-1" />}{request.status}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{request.venue?.name} • {request.category}{request.brand && ` • ${request.brand}`}</p>
                        {request.description && <p className="text-sm mt-1">{request.description}</p>}
                      </div>
                      {request.status === 'pending' && <div className="flex gap-2"><Button size="sm" onClick={() => handleApproveRequest(request)}><Check className="h-4 w-4" /></Button><Button size="sm" variant="destructive" onClick={() => handleRejectRequest(request.id)}><X className="h-4 w-4" /></Button></div>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editingDrink ? t('adminDrinks.editDrink') : t('adminDrinks.addToCatalog')}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>{t('adminDrinks.nameLabel')}</Label><Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} /></div>
            <div><Label>{t('adminDrinks.categoryLabel')}</Label><select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="drink">{t('adminDrinks.drink')}</option><option value="shot">{t('adminDrinks.shot')}</option><option value="soft">{t('adminDrinks.soft')}</option></select></div>
            <div><Label>{t('adminDrinks.brand')}</Label><Input value={formData.brand} onChange={(e) => setFormData({ ...formData, brand: e.target.value })} /></div>
            <div><Label>{t('adminDrinks.alcPct')}</Label><Input type="number" step="0.1" value={formData.alc_pct} onChange={(e) => setFormData({ ...formData, alc_pct: parseFloat(e.target.value) || 0 })} /></div>
            <div><Label>{t('adminDrinks.image')}</Label>{imagePreview && <div className="relative w-full h-32 rounded-lg overflow-hidden border mb-2"><img src={imagePreview} alt="" className="w-full h-full object-cover" /><Button size="icon" variant="destructive" className="absolute top-2 right-2" onClick={() => { setImageFile(null); setImagePreview(''); }}><X className="h-4 w-4" /></Button></div>}<Input type="file" accept="image/*" onChange={handleImageChange} className="hidden" id="catalog-image" /><Button type="button" variant="outline" className="w-full" onClick={() => document.getElementById('catalog-image')?.click()}><Upload className="h-4 w-4 mr-2" />{imagePreview ? t('adminDrinks.changeImage') : t('adminDrinks.addImage')}</Button></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsDialogOpen(false); resetForm(); }}>{t('adminDrinks.cancel')}</Button>
            <Button onClick={handleSave} disabled={isSaving}>{isSaving ? '...' : editingDrink ? t('adminDrinks.save') : t('adminDrinks.add')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
