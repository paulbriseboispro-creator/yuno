import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { BottleImageEditor } from './BottleImageEditor';
import { composeBottleBlob, DEFAULT_BOTTLE_TRANSFORM, type BottleTransform } from '@/lib/bottleImage';
import {
  Wine,
  Plus,
  Edit2,
  Trash2,
  GlassWater,
  Loader2,
  Image as ImageIcon,
  Settings2,
  Upload,
  X,
} from 'lucide-react';

interface VipMenuItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  brand: string | null;
  volume_cl: number | null;
  price: number;
  image_url: string | null;
  is_active: boolean;
  position: number;
  needs_mixer: boolean;
  max_mixers: number;
}

interface VipMenuEligibility {
  id: string;
  menu_item_id: string;
  zone_id: string | null;
  pack_id: string | null;
  is_included: boolean;
  included_quantity: number;
  custom_price: number | null;
}

interface TableZone {
  id: string;
  name: string;
  color: string;
}

interface TablePack {
  id: string;
  name: string;
  zone_id: string;
  included_bottles_quota: number;
}

interface VipMenuManagerProps {
  venueId: string;
}

const CATEGORIES = [
  { value: 'champagne', label: 'Champagne', icon: '🍾' },
  { value: 'vodka', label: 'Vodka', icon: '🍸' },
  { value: 'whisky', label: 'Whisky', icon: '🥃' },
  { value: 'gin', label: 'Gin', icon: '🍹' },
  { value: 'rum', labelKey: 'vipMenu.rum', icon: '🍹' },
  { value: 'tequila', label: 'Tequila', icon: '🥃' },
  { value: 'wine', labelKey: 'vipMenu.wine', icon: '🍷' },
  { value: 'cognac', label: 'Cognac', icon: '🥃' },
  { value: 'mixer', labelKey: 'vipMenu.mixerDiluent', icon: '🧊' },
];

const isMixerCategory = (category: string) => category === 'mixer';

export function VipMenuManager({ venueId }: VipMenuManagerProps) {
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<VipMenuItem[]>([]);
  const [eligibilities, setEligibilities] = useState<VipMenuEligibility[]>([]);
  const [zones, setZones] = useState<TableZone[]>([]);
  const [packs, setPacks] = useState<TablePack[]>([]);
  // Réglages club (idée #2 / #3) : vitrine menu dans le tunnel + pré-commande.
  const [menuVisibility, setMenuVisibility] = useState<'hidden' | 'no_prices' | 'full'>('hidden');
  const [preorderEnabled, setPreorderEnabled] = useState(false);

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEligibilityDialog, setShowEligibilityDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<VipMenuItem | null>(null);
  const [selectedItemForEligibility, setSelectedItemForEligibility] = useState<VipMenuItem | null>(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [saving, setSaving] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [imageTransform, setImageTransform] = useState<BottleTransform>(DEFAULT_BOTTLE_TRANSFORM);
  const [imageAdjusted, setImageAdjusted] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'champagne',
    brand: '',
    volume_cl: 75,
    price: 0,
    image_url: '',
    needs_mixer: false,
    max_mixers: 1,
  });

  const getCategoryLabel = (cat: typeof CATEGORIES[number]) => {
    if (cat.labelKey) return t(cat.labelKey);
    return cat.label;
  };

  useEffect(() => {
    fetchData();
  }, [venueId]);

  const fetchData = async () => {
    if (!venueId) return;
    setLoading(true);

    try {
      const [itemsRes, eligRes, zonesRes, packsRes, venueRes] = await Promise.all([
        supabase.from('vip_menu_items').select('*').eq('venue_id', venueId).order('category').order('position'),
        supabase.from('vip_menu_eligibility').select('*'),
        supabase.from('table_zones').select('id, name, color').eq('venue_id', venueId),
        supabase.from('table_packs').select('id, name, zone_id, included_bottles_quota').eq('venue_id', venueId),
        supabase.from('venues').select('vip_menu_visibility, vip_preorder_enabled').eq('id', venueId).single(),
      ]);

      setItems(itemsRes.data || []);
      setEligibilities(eligRes.data || []);
      setZones(zonesRes.data || []);
      setPacks(packsRes.data || []);
      if (venueRes.data) {
        setMenuVisibility((venueRes.data.vip_menu_visibility as 'hidden' | 'no_prices' | 'full') || 'hidden');
        setPreorderEnabled(!!venueRes.data.vip_preorder_enabled);
      }
    } catch (error) {
      console.error('Error fetching VIP menu data:', error);
      toast.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setImageTransform(DEFAULT_BOTTLE_TRANSFORM);
      setImageAdjusted(false);
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleTransformChange = (t: BottleTransform) => {
    setImageTransform(t);
    setImageAdjusted(true);
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview('');
    setImageTransform(DEFAULT_BOTTLE_TRANSFORM);
    setImageAdjusted(false);
    setFormData(p => ({ ...p, image_url: '' }));
  };

  const handleSaveItem = async () => {
    if (!formData.name) {
      toast.error(t('vipMenu.nameRequired'));
      return;
    }
    if (!isMixerCategory(formData.category) && formData.price <= 0) {
      toast.error(t('vipMenu.nameAndPriceRequired'));
      return;
    }

    setSaving(true);
    try {
      let imageUrl = formData.image_url;

      // Bake the owner's chosen framing into a transparent WebP at the card ratio.
      // Re-compose on a fresh upload, or when an existing image was re-framed.
      const shouldCompose = !!imagePreview && (!!imageFile || imageAdjusted);
      if (shouldCompose) {
        try {
          const blob = await composeBottleBlob(imagePreview, imageTransform);
          const fileName = `vip-menu/${venueId}/${Date.now()}.webp`;
          const { error: uploadError } = await supabase.storage
            .from('drink-images')
            .upload(fileName, blob, { contentType: 'image/webp' });
          if (uploadError) throw uploadError;
          const { data: { publicUrl } } = supabase.storage.from('drink-images').getPublicUrl(fileName);
          imageUrl = publicUrl;
        } catch (composeErr) {
          // A new file must succeed; re-framing an existing cross-origin image may
          // taint the canvas — in that case keep the current image silently.
          if (imageFile) throw composeErr;
          console.warn('Could not re-frame existing image, keeping current:', composeErr);
        }
      }

      // A mixer item can never itself require a mixer.
      const needsMixer = !isMixerCategory(formData.category) && formData.needs_mixer;
      const maxMixers = needsMixer ? Math.max(1, formData.max_mixers) : 1;

      if (editingItem) {
        const { error } = await supabase.from('vip_menu_items').update({
          name: formData.name, description: formData.description || null, category: formData.category,
          brand: formData.brand || null, volume_cl: formData.volume_cl || null, price: formData.price,
          image_url: imageUrl || null, needs_mixer: needsMixer, max_mixers: maxMixers,
          updated_at: new Date().toISOString(),
        }).eq('id', editingItem.id);
        if (error) throw error;
        toast.success(t('vipMenu.itemUpdated'));
      } else {
        const { error } = await supabase.from('vip_menu_items').insert({
          venue_id: venueId, name: formData.name, description: formData.description || null,
          category: formData.category, brand: formData.brand || null, volume_cl: formData.volume_cl || null,
          price: formData.price, image_url: imageUrl || null, needs_mixer: needsMixer, max_mixers: maxMixers,
          position: items.length,
        });
        if (error) throw error;
        toast.success(t('vipMenu.itemAdded'));
      }

      setShowAddDialog(false);
      setEditingItem(null);
      resetForm();
      fetchData();
    } catch (error) {
      console.error('Error saving item:', error);
      toast.error(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm(t('vipMenu.deleteConfirm'))) return;
    try {
      const { error } = await supabase.from('vip_menu_items').delete().eq('id', itemId);
      if (error) throw error;
      toast.success(t('vipMenu.itemDeleted'));
      fetchData();
    } catch (error) {
      console.error('Error deleting item:', error);
      toast.error(t('common.error'));
    }
  };

  const handleToggleActive = async (item: VipMenuItem) => {
    try {
      const { error } = await supabase.from('vip_menu_items').update({ is_active: !item.is_active }).eq('id', item.id);
      if (error) throw error;
      fetchData();
    } catch (error) {
      console.error('Error toggling active:', error);
      toast.error(t('common.error'));
    }
  };

  const handleSaveEligibility = async (
    zoneId: string | null, packId: string | null, isIncluded: boolean,
    includedQuantity: number, customPrice: number | null
  ) => {
    if (!selectedItemForEligibility) return;
    setSaving(true);
    try {
      const existing = eligibilities.find(
        e => e.menu_item_id === selectedItemForEligibility.id && e.zone_id === zoneId && e.pack_id === packId
      );
      if (existing) {
        const { error } = await supabase.from('vip_menu_eligibility').update({
          is_included: isIncluded, included_quantity: includedQuantity, custom_price: customPrice,
        }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('vip_menu_eligibility').insert({
          menu_item_id: selectedItemForEligibility.id, zone_id: zoneId, pack_id: packId,
          is_included: isIncluded, included_quantity: includedQuantity, custom_price: customPrice,
        });
        if (error) throw error;
      }
      toast.success(t('vipMenu.eligibilityUpdated'));
      fetchData();
    } catch (error) {
      console.error('Error saving eligibility:', error);
      toast.error(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveEligibility = async (eligibilityId: string) => {
    try {
      const { error } = await supabase.from('vip_menu_eligibility').delete().eq('id', eligibilityId);
      if (error) throw error;
      toast.success(t('vipMenu.eligibilityDeleted'));
      fetchData();
    } catch (error) {
      console.error('Error removing eligibility:', error);
      toast.error(t('common.error'));
    }
  };

  const resetForm = () => {
    setFormData({ name: '', description: '', category: 'champagne', brand: '', volume_cl: 75, price: 0, image_url: '', needs_mixer: false, max_mixers: 1 });
    setImageFile(null);
    setImagePreview('');
    setImageTransform(DEFAULT_BOTTLE_TRANSFORM);
    setImageAdjusted(false);
  };

  const openEditDialog = (item: VipMenuItem) => {
    setEditingItem(item);
    setFormData({
      name: item.name, description: item.description || '', category: item.category,
      brand: item.brand || '', volume_cl: item.volume_cl || 75, price: item.price, image_url: item.image_url || '',
      needs_mixer: item.needs_mixer ?? false, max_mixers: item.max_mixers ?? 1,
    });
    setImageFile(null);
    setImagePreview(item.image_url || '');
    setImageTransform(DEFAULT_BOTTLE_TRANSFORM);
    setImageAdjusted(false);
    setShowAddDialog(true);
  };

  const openEligibilityDialog = (item: VipMenuItem) => {
    setSelectedItemForEligibility(item);
    setShowEligibilityDialog(true);
  };

  const getCategoryIcon = (category: string) => {
    return CATEGORIES.find(c => c.value === category)?.icon || '📦';
  };

  const filteredItems = activeCategory === 'all' ? items : items.filter(i => i.category === activeCategory);
  const getItemEligibilities = (itemId: string) => eligibilities.filter(e => e.menu_item_id === itemId);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const saveVisibility = async (v: 'hidden' | 'no_prices' | 'full') => {
    const prev = menuVisibility;
    setMenuVisibility(v);
    const { error } = await supabase.from('venues').update({ vip_menu_visibility: v }).eq('id', venueId);
    if (error) { setMenuVisibility(prev); toast.error(t('common.error')); }
    else toast.success(tt('Vitrine menu mise à jour', 'Menu preview updated', 'Vista del menú actualizada'));
  };

  const savePreorder = async (val: boolean) => {
    setPreorderEnabled(val);
    const { error } = await supabase.from('venues').update({ vip_preorder_enabled: val }).eq('id', venueId);
    if (error) { setPreorderEnabled(!val); toast.error(t('common.error')); }
  };

  const VIS_OPTS: { v: 'hidden' | 'no_prices' | 'full'; label: string; desc: string }[] = [
    { v: 'hidden', label: tt('Masquée', 'Hidden', 'Oculta'), desc: tt('Le client ne voit pas la carte avant de payer.', "Guests can't see the menu before paying.", 'El cliente no ve la carta antes de pagar.') },
    { v: 'no_prices', label: tt('Sans prix', 'No prices', 'Sin precios'), desc: tt('Le client voit les bouteilles, sans les prix.', 'Guests see the bottles, without prices.', 'El cliente ve las botellas, sin precios.') },
    { v: 'full', label: tt('Complète', 'Full', 'Completa'), desc: tt('Le client voit bouteilles et prix.', 'Guests see bottles and prices.', 'El cliente ve botellas y precios.') },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Wine className="h-5 w-5" />
            {t('vipMenu.title')}
          </h3>
          <p className="text-sm text-muted-foreground">{t('vipMenu.description')}</p>
        </div>
        <Button onClick={() => { resetForm(); setEditingItem(null); setShowAddDialog(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          {t('vipMenu.addItem')}
        </Button>
      </div>

      {/* Réglages vitrine — idée #2 / #3 */}
      <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-4">
        <div>
          <p className="text-sm font-medium mb-0.5">{tt('Carte visible pendant la réservation', 'Menu visible during booking', 'Carta visible durante la reserva')}</p>
          <p className="text-xs text-muted-foreground">{tt("Laissez le client découvrir votre carte bouteilles dans le tunnel de réservation de table.", 'Let guests discover your bottle menu inside the table booking flow.', 'Deja que el cliente descubra tu carta de botellas en el flujo de reserva.')}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {VIS_OPTS.map(opt => (
            <button
              key={opt.v}
              type="button"
              onClick={() => saveVisibility(opt.v)}
              className={`text-left rounded-lg border p-3 transition-colors ${menuVisibility === opt.v ? 'border-primary bg-primary/10' : 'border-border/60 hover:bg-muted/40'}`}
            >
              <span className="text-sm font-semibold">{opt.label}</span>
              <span className="block text-[11px] text-muted-foreground mt-0.5 leading-snug">{opt.desc}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between pt-1">
          <div>
            <p className="text-sm font-medium">{tt('Pré-commande de bouteilles', 'Bottle pre-ordering', 'Pre-pedido de botellas')}</p>
            <p className="text-xs text-muted-foreground">{tt('Le client peut réserver ses bouteilles dès le paiement de la table.', 'Guests can reserve their bottles when they pay for the table.', 'El cliente puede reservar sus botellas al pagar la mesa.')}</p>
          </div>
          <Switch checked={preorderEnabled} onCheckedChange={savePreorder} />
        </div>
      </div>

      {/* Category Tabs */}
      <ScrollArea className="w-full">
        <div className="flex gap-2 pb-2">
          <Button variant={activeCategory === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setActiveCategory('all')}>
            {t('vipMenu.all')} ({items.length})
          </Button>
          {CATEGORIES.map(cat => {
            const count = items.filter(i => i.category === cat.value).length;
            if (count === 0) return null;
            return (
              <Button key={cat.value} variant={activeCategory === cat.value ? 'default' : 'outline'} size="sm" onClick={() => setActiveCategory(cat.value)}>
                {cat.icon} {getCategoryLabel(cat)} ({count})
              </Button>
            );
          })}
        </div>
      </ScrollArea>

      {/* Items Grid */}
      {filteredItems.length === 0 ? (
        <Card className="p-8 bg-surface border-0 text-center">
          <Wine className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">{t('vipMenu.noItems')}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.map(item => {
            const itemEligibilities = getItemEligibilities(item.id);
            return (
              <Card key={item.id} className={`p-4 bg-surface border-0 ${!item.is_active ? 'opacity-50' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className="w-16 h-16 rounded-lg bg-gradient-to-b from-white/[0.06] to-black/30 ring-1 ring-white/5 flex items-center justify-center shrink-0 overflow-hidden">
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.name} className="w-full h-full object-contain p-1 drop-shadow-[0_4px_10px_rgba(0,0,0,0.45)]" />
                    ) : (
                      <span className="text-2xl">{getCategoryIcon(item.category)}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-semibold truncate">{item.name}</h4>
                        {item.brand && <p className="text-xs text-muted-foreground">{item.brand}</p>}
                      </div>
                      <span className="font-bold text-primary whitespace-nowrap">{item.price}€</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge variant="outline" className="text-xs">
                        {getCategoryIcon(item.category)} {getCategoryLabel(CATEGORIES.find(c => c.value === item.category)!)}
                      </Badge>
                      {item.volume_cl && <span className="text-xs text-muted-foreground">{item.volume_cl}cl</span>}
                      {item.needs_mixer && (
                        <Badge variant="secondary" className="text-[10px] gap-1">
                          🧊 {t('vipMenu.needsMixerBadge')}{item.max_mixers > 1 ? ` ×${item.max_mixers}` : ''}
                        </Badge>
                      )}
                    </div>
                    {itemEligibilities.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {itemEligibilities.slice(0, 3).map(elig => {
                          const zone = zones.find(z => z.id === elig.zone_id);
                          const pack = packs.find(p => p.id === elig.pack_id);
                          return (
                            <Badge key={elig.id} variant="secondary" className="text-[10px]"
                              style={zone ? { backgroundColor: zone.color + '20', color: zone.color } : {}}>
                              {zone?.name || pack?.name}
                              {elig.is_included && ` (${elig.included_quantity} incl.)`}
                            </Badge>
                          );
                        })}
                        {itemEligibilities.length > 3 && (
                          <Badge variant="secondary" className="text-[10px]">+{itemEligibilities.length - 3}</Badge>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1 mt-3 pt-3 border-t border-border">
                  <Button variant="ghost" size="sm" onClick={() => openEligibilityDialog(item)}>
                    <Settings2 className="h-4 w-4 mr-1" />
                    {t('vipMenu.eligibility')}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(item)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleToggleActive(item)}>
                    {item.is_active ? '✓' : '○'}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteItem(item.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingItem ? t('vipMenu.editItem') : t('vipMenu.newItem')}</DialogTitle>
            <DialogDescription>
              {isMixerCategory(formData.category) ? t('vipMenu.addMixerDesc') : t('vipMenu.addBottleDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>{t('vipMenu.name')} *</Label>
                <Input value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                  placeholder={isMixerCategory(formData.category) ? "Coca-Cola" : "Ruinart Blanc de Blancs"} />
              </div>
              <div className={isMixerCategory(formData.category) ? 'col-span-1' : ''}>
                <Label>{t('vipMenu.category')}</Label>
                <Select value={formData.category} onValueChange={v => setFormData(p => ({ ...p, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(cat => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.icon} {getCategoryLabel(cat)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isMixerCategory(formData.category) ? (
                <div>
                  <Label>{t('vipMenu.supplementPrice')}</Label>
                  <Input type="number" value={formData.price} onChange={e => setFormData(p => ({ ...p, price: parseFloat(e.target.value) || 0 }))} placeholder="0" />
                  <p className="text-xs text-muted-foreground mt-1">{t('vipMenu.supplementHint')}</p>
                </div>
              ) : (
                <>
                  <div>
                    <Label>{t('vipMenu.brand')}</Label>
                    <Input value={formData.brand} onChange={e => setFormData(p => ({ ...p, brand: e.target.value }))} placeholder="Ruinart" />
                  </div>
                  <div>
                    <Label>{t('vipMenu.price')} *</Label>
                    <Input type="number" value={formData.price} onChange={e => setFormData(p => ({ ...p, price: parseFloat(e.target.value) || 0 }))} placeholder="250" />
                  </div>
                  <div>
                    <Label>{t('vipMenu.volume')}</Label>
                    <Input type="number" value={formData.volume_cl || ''} onChange={e => setFormData(p => ({ ...p, volume_cl: parseInt(e.target.value) || null }))} placeholder="75" />
                  </div>
                  <div className="col-span-2">
                    <Label>{t('vipMenu.descriptionLabel')}</Label>
                    <Textarea value={formData.description} onChange={e => setFormData(p => ({ ...p, description: e.target.value }))} placeholder={t('vipMenu.descPlaceholder')} rows={2} />
                  </div>

                  {/* Mixer rule */}
                  <div className="col-span-2 rounded-lg border border-border bg-muted/20 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <Label className="cursor-pointer">{t('vipMenu.needsMixer')}</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">{t('vipMenu.needsMixerHint')}</p>
                      </div>
                      <Switch
                        checked={formData.needs_mixer}
                        onCheckedChange={v => setFormData(p => ({ ...p, needs_mixer: v }))}
                      />
                    </div>
                    {formData.needs_mixer && (
                      <div className="flex items-center justify-between gap-3 pt-1">
                        <div className="min-w-0">
                          <Label>{t('vipMenu.maxMixers')}</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">{t('vipMenu.maxMixersHint')}</p>
                        </div>
                        <Input
                          type="number"
                          min={1}
                          max={10}
                          className="w-20 shrink-0"
                          value={formData.max_mixers}
                          onChange={e => setFormData(p => ({ ...p, max_mixers: Math.max(1, parseInt(e.target.value) || 1) }))}
                        />
                      </div>
                    )}
                  </div>

                  <div className="col-span-2">
                    <Label>{t('vipMenu.image')}</Label>
                    {imagePreview ? (
                      <BottleImageEditor
                        src={imagePreview}
                        transform={imageTransform}
                        onChange={handleTransformChange}
                        onClear={clearImage}
                      />
                    ) : (
                      <div className="w-full h-32 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-primary/50 transition-colors cursor-pointer"
                        onClick={() => document.getElementById('vip-menu-image')?.click()}>
                        <Upload className="h-6 w-6" />
                        <span className="text-sm">{t('vipMenu.clickToAddPhoto')}</span>
                      </div>
                    )}
                    <Input type="file" accept="image/*" onChange={handleImageChange} className="hidden" id="vip-menu-image" />
                    <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{t('vipMenu.imageFormatHint')}</p>
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 sticky bottom-0 -mx-6 -mb-6 px-6 py-4 bg-card border-t border-border">
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>{t('common.cancel')}</Button>
              <Button onClick={handleSaveItem} disabled={saving || !formData.name || (!isMixerCategory(formData.category) && formData.price <= 0)}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('common.save')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Eligibility Dialog */}
      <Dialog open={showEligibilityDialog} onOpenChange={setShowEligibilityDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('vipMenu.eligibilityFor').replace('{name}', selectedItemForEligibility?.name || '')}</DialogTitle>
            <DialogDescription>{t('vipMenu.eligibilityDesc')}</DialogDescription>
          </DialogHeader>
          {selectedItemForEligibility && (
            <EligibilityEditor
              item={selectedItemForEligibility}
              eligibilities={getItemEligibilities(selectedItemForEligibility.id)}
              zones={zones}
              packs={packs}
              onSave={handleSaveEligibility}
              onRemove={handleRemoveEligibility}
              saving={saving}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Sub-component for eligibility editing
interface EligibilityEditorProps {
  item: VipMenuItem;
  eligibilities: VipMenuEligibility[];
  zones: TableZone[];
  packs: TablePack[];
  onSave: (zoneId: string | null, packId: string | null, isIncluded: boolean, qty: number, price: number | null) => void;
  onRemove: (id: string) => Promise<void>;
  saving: boolean;
}

function EligibilityEditor({ item, eligibilities, zones, packs, onSave, onRemove, saving }: EligibilityEditorProps) {
  const { t } = useLanguage();
  const [showInclusionForm, setShowInclusionForm] = useState(false);
  const [editingEligibility, setEditingEligibility] = useState<VipMenuEligibility | null>(null);
  const [selectedZone, setSelectedZone] = useState<string>('');
  const [selectedPack, setSelectedPack] = useState<string>('');
  const [includedQty, setIncludedQty] = useState(1);
  const [customPrice, setCustomPrice] = useState<string>('');

  const resetForm = () => {
    setSelectedZone('');
    setSelectedPack('');
    setIncludedQty(1);
    setCustomPrice('');
    setEditingEligibility(null);
    setShowInclusionForm(false);
  };

  const handleEditInclusion = (elig: VipMenuEligibility) => {
    setEditingEligibility(elig);
    setSelectedZone(elig.zone_id || '');
    setSelectedPack(elig.pack_id || '');
    setIncludedQty(elig.included_quantity || 1);
    setCustomPrice(elig.custom_price?.toString() || '');
    setShowInclusionForm(true);
  };

  const handleAddInclusion = async () => {
    if (!selectedZone && !selectedPack) {
      toast.error(t('vipMenu.selectRequired'));
      return;
    }
    if (editingEligibility) {
      const zoneChanged = (editingEligibility.zone_id || '') !== selectedZone;
      const packChanged = (editingEligibility.pack_id || '') !== selectedPack;
      if (zoneChanged || packChanged) {
        await onRemove(editingEligibility.id);
      }
    }
    onSave(selectedZone || null, selectedPack || null, true, includedQty, customPrice ? parseFloat(customPrice) : null);
    resetForm();
  };

  const handleActivateGlobal = () => {
    onSave(null, null, false, 0, null);
  };

  const packsForZone = selectedZone ? packs.filter(p => p.zone_id === selectedZone) : packs;
  const globalAvailability = eligibilities.find(e => !e.zone_id && !e.pack_id && !e.is_included);
  const includedEligibilities = eligibilities.filter(e => e.is_included);

  return (
    <div className="space-y-6">
      {/* Global availability */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label className="font-medium">{t('vipMenu.availableForPurchase')}</Label>
            <p className="text-xs text-muted-foreground">{t('vipMenu.sellableAsExtra')}</p>
          </div>
          {globalAvailability ? (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-400">
                {t('vipMenu.activeLabel')} • {globalAvailability.custom_price ?? item.price}€
              </Badge>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onRemove(globalAvailability.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={handleActivateGlobal} disabled={saving}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />}
              {t('vipMenu.activate')}
            </Button>
          )}
        </div>
      </div>

      <div className="border-t border-border" />

      {/* Inclusions */}
      <div className="space-y-3">
        <div>
          <Label className="font-medium">{t('vipMenu.includedItems')}</Label>
          <p className="text-xs text-muted-foreground">{t('vipMenu.slotCostDesc')}</p>
        </div>

        {includedEligibilities.length > 0 && (
          <div className="space-y-2">
            {includedEligibilities.map(elig => {
              const zone = zones.find(z => z.id === elig.zone_id);
              const pack = packs.find(p => p.id === elig.pack_id);
              return (
                <div key={elig.id} className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                      ×{elig.included_quantity}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs text-muted-foreground">{t('vipMenu.slotCost')}:</span>
                        <span className="text-xs font-medium">{elig.included_quantity}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {zone && (
                          <Badge className="text-xs" style={{ backgroundColor: zone.color + '20', color: zone.color, border: `1px solid ${zone.color}40` }}>
                            {t('vipMenu.zone')}: {zone.name}
                          </Badge>
                        )}
                        {pack && (
                          <Badge variant="outline" className="text-xs">{t('vipMenu.pack')}: {pack.name}</Badge>
                        )}
                      </div>
                      {elig.custom_price && (
                        <p className="text-xs text-muted-foreground mt-1">{t('vipMenu.supplementPriceOpt')}: {elig.custom_price}€</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted" onClick={() => handleEditInclusion(elig)}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => onRemove(elig.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!showInclusionForm ? (
          <Button variant="outline" className="w-full border-dashed" onClick={() => setShowInclusionForm(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t('vipMenu.addInclusion')}
          </Button>
        ) : (
          <div className="space-y-3 p-4 border border-primary/30 rounded-lg bg-primary/5">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                {editingEligibility ? t('vipMenu.editInclusion') : t('vipMenu.newInclusion')}
              </Label>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={resetForm}>{t('common.cancel')}</Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t('vipMenu.zone')} *</Label>
                <Select value={selectedZone || '_none'} onValueChange={(v) => { setSelectedZone(v === '_none' ? '' : v); setSelectedPack(''); }}>
                  <SelectTrigger className="h-9"><SelectValue placeholder={t('vipMenu.select')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">{t('vipMenu.unspecified')}</SelectItem>
                    {zones.map(zone => (
                      <SelectItem key={zone.id} value={zone.id}>
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: zone.color }} />
                          {zone.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t('vipMenu.pack')} *</Label>
                <Select value={selectedPack || '_none'} onValueChange={(v) => setSelectedPack(v === '_none' ? '' : v)}>
                  <SelectTrigger className="h-9"><SelectValue placeholder={t('vipMenu.select')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">{t('vipMenu.unspecified')}</SelectItem>
                    {packsForZone.map(pack => (
                      <SelectItem key={pack.id} value={pack.id}>
                        {pack.name} {pack.included_bottles_quota > 0 && `(${pack.included_bottles_quota} slots)`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {selectedPack && (() => {
              const pack = packs.find(p => p.id === selectedPack);
              if (pack && pack.included_bottles_quota > 0) {
                return (
                  <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                    <p className="text-sm text-blue-400">
                      ℹ️ <strong>{t('vipMenu.packOffersSlots').replace('{name}', pack.name).replace('{count}', String(pack.included_bottles_quota))}</strong>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('vipMenu.packSlotExplain').replace('{count}', String(pack.included_bottles_quota))}
                    </p>
                  </div>
                );
              }
              return null;
            })()}

            {(!selectedZone && !selectedPack) && (
              <p className="text-xs text-amber-500">⚠️ {t('vipMenu.selectRequired')}</p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t('vipMenu.slotCost')}</Label>
                <Input type="number" className="h-9" min={1} value={includedQty} onChange={e => setIncludedQty(parseInt(e.target.value) || 1)} />
                <p className="text-xs text-muted-foreground mt-1">{t('vipMenu.slotCostHint')}</p>
              </div>
              <div>
                <Label className="text-xs">{t('vipMenu.supplementPriceOpt')}</Label>
                <Input type="number" className="h-9" placeholder={`${item.price}€`} value={customPrice} onChange={e => setCustomPrice(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-1">{t('vipMenu.ifBeyondQuota')}</p>
              </div>
            </div>

            <Button className="w-full" onClick={handleAddInclusion} disabled={saving || (!selectedZone && !selectedPack)}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingEligibility ? t('vipMenu.saveChanges') : t('vipMenu.addTheInclusion')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
