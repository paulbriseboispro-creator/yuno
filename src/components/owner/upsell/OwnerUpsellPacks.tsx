import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Package, Trash2, Info, Pencil } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';

interface DrinkPack {
  id: string;
  name: string;
  description: string | null;
  drink_count: number;
  pack_price: number;
  original_price: number;
  is_active: boolean;
  allowed_collections: string[] | null;
}

export function OwnerUpsellPacks({ venueId }: { venueId: string }) {
  const { t } = useLanguage();
  const [packs, setPacks] = useState<DrinkPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPack, setEditingPack] = useState<DrinkPack | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [drinkCount, setDrinkCount] = useState(3);
  const [packPrice, setPackPrice] = useState('');
  const [originalPrice, setOriginalPrice] = useState('');
  const [allowedCollections, setAllowedCollections] = useState<string[]>(['drink', 'shot', 'soft']);

  useEffect(() => {
    fetchPacks();
  }, [venueId]);

  const fetchPacks = async () => {
    const { data, error } = await supabase
      .from('upsell_drink_packs')
      .select('*')
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setPacks(data.map(p => ({
        ...p,
        pack_price: Number(p.pack_price),
        original_price: Number(p.original_price),
      })));
    }
    setLoading(false);
  };

  const resetForm = () => {
    setName('');
    setDescription('');
    setDrinkCount(3);
    setPackPrice('');
    setOriginalPrice('');
    setAllowedCollections(['drink', 'shot', 'soft']);
    setEditingPack(null);
  };

  const openEdit = (pack: DrinkPack) => {
    setEditingPack(pack);
    setName(pack.name);
    setDescription(pack.description || '');
    setDrinkCount(pack.drink_count);
    setPackPrice(pack.pack_price.toString());
    setOriginalPrice(pack.original_price.toString());
    setAllowedCollections(pack.allowed_collections || ['drink', 'shot', 'soft']);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim() || !packPrice || !originalPrice) {
      toast.error(t('owner.fillRequired'));
      return;
    }

    const payload = {
      venue_id: venueId,
      name: name.trim(),
      description: description.trim() || null,
      drink_count: drinkCount,
      pack_price: parseFloat(packPrice),
      original_price: parseFloat(originalPrice),
      allowed_collections: allowedCollections,
    };

    if (editingPack) {
      const { error } = await supabase
        .from('upsell_drink_packs')
        .update(payload)
        .eq('id', editingPack.id);
      if (error) { toast.error(error.message); return; }
      toast.success(t('upsell.packUpdated'));
    } else {
      const { error } = await supabase
        .from('upsell_drink_packs')
        .insert(payload);
      if (error) { toast.error(error.message); return; }
      toast.success(t('upsell.packCreated'));
    }

    setDialogOpen(false);
    resetForm();
    fetchPacks();
  };

  const toggleActive = async (pack: DrinkPack) => {
    await supabase
      .from('upsell_drink_packs')
      .update({ is_active: !pack.is_active })
      .eq('id', pack.id);
    fetchPacks();
  };

  const deletePack = async (id: string) => {
    const { error } = await supabase.from('upsell_drink_packs').delete().eq('id', id);
    if (error) {
      console.error('Delete error:', error);
      toast.error(error.message);
      return;
    }
    toast.success(t('upsell.packDeleted'));
    fetchPacks();
  };

  const discountPercent = packPrice && originalPrice
    ? Math.round((1 - parseFloat(packPrice) / parseFloat(originalPrice)) * 100)
    : 0;

  const collections = [
    { value: 'drink', label: t('venue.drinks') },
    { value: 'shot', label: t('venue.shots') },
    { value: 'soft', label: t('venue.softs') },
  ];

  if (loading) {
    return <div className="flex justify-center py-8"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Context info */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/10">
        <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground">{t('upsell.packsContextInfo')}</p>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
        <DialogTrigger asChild>
          <Button className="w-full gap-2">
            <Plus className="h-4 w-4" />
            {t('upsell.createPack')}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingPack ? t('upsell.editPack') : t('upsell.createPack')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('upsell.packName')}</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: 5 Consos" />
            </div>
            <div>
              <Label>{t('upsell.packDescription')}</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder={t('upsell.packDescPlaceholder')} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>{t('upsell.drinkCount')}</Label>
                <Input type="number" min={1} value={drinkCount} onChange={e => setDrinkCount(parseInt(e.target.value) || 1)} />
              </div>
              <div>
                <Label>{t('upsell.packPrice')}</Label>
                <Input type="number" step="0.01" min={0} value={packPrice} onChange={e => setPackPrice(e.target.value)} placeholder="35" />
              </div>
              <div>
                <Label>{t('upsell.originalPrice')}</Label>
                <Input type="number" step="0.01" min={0} value={originalPrice} onChange={e => setOriginalPrice(e.target.value)} placeholder="50" />
              </div>
            </div>
            {discountPercent > 0 && (
              <p className="text-sm text-green-500 font-medium">
                → {t('upsell.savingPercent').replace('{percent}', discountPercent.toString())}
              </p>
            )}
            <div>
              <Label className="mb-2 block">{t('upsell.allowedCategories')}</Label>
              <div className="flex gap-3">
                {collections.map(c => (
                  <label key={c.value} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={allowedCollections.includes(c.value)}
                      onCheckedChange={(checked) => {
                        setAllowedCollections(prev =>
                          checked ? [...prev, c.value] : prev.filter(v => v !== c.value)
                        );
                      }}
                    />
                    <span className="text-sm">{c.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <Button onClick={handleSave} className="w-full">{t('common.save')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pack list */}
      {packs.length === 0 ? (
        <div className="text-center py-8">
          <Package className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">{t('upsell.noPacksYet')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {packs.map(pack => {
            const saving = Math.round((1 - pack.pack_price / pack.original_price) * 100);
            return (
              <motion.div key={pack.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Card className={`p-4 border ${pack.is_active ? 'border-primary/20' : 'border-border/30 opacity-60'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-sm truncate">{pack.name}</h3>
                        {saving > 0 && (
                          <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-500 border-green-500/20">
                            -{saving}%
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {pack.drink_count} {t('upsell.drinksFor')} <span className="font-bold text-foreground">{pack.pack_price}€</span>
                        {' '}<span className="line-through">{pack.original_price}€</span>
                      </p>
                      {pack.description && (
                        <p className="text-xs text-muted-foreground mt-1">{pack.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={pack.is_active} onCheckedChange={() => toggleActive(pack)} />
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(pack)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deletePack(pack.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
