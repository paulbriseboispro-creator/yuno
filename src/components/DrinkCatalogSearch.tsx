import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Plus, X, Send, Loader2, Check, Wine, Martini, Coffee, Grid3X3 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';

interface CatalogDrink {
  id: string;
  name: string;
  category: string;
  image_url: string | null;
  description: string | null;
  alc_pct: number | null;
  brand: string | null;
}

interface DrinkCatalogSearchProps {
  venueId: string;
  onDrinkAdded: () => void;
}

const categoryConfig = {
  drink: { labelKey: 'drinkCat.catDrinks', icon: Wine, emoji: '🍹' },
  shot: { labelKey: 'drinkCat.catShots', icon: Martini, emoji: '🥃' },
  soft: { labelKey: 'drinkCat.catSofts', icon: Coffee, emoji: '🥤' },
  other: { labelKey: 'drinkCat.catOther', icon: Grid3X3, emoji: '🍸' },
};

export function DrinkCatalogSearch({ venueId, onDrinkAdded }: DrinkCatalogSearchProps) {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<'search' | 'browse'>('browse');
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<CatalogDrink[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDrink, setSelectedDrink] = useState<CatalogDrink | null>(null);
  const [price, setPrice] = useState('');
  const [presalePrice, setPresalePrice] = useState('');
  const [collection, setCollection] = useState<'drink' | 'shot' | 'soft'>('drink');
  const [isSaving, setIsSaving] = useState(false);
  
  // Already added drinks (to exclude from catalog)
  const [addedDrinkNames, setAddedDrinkNames] = useState<Set<string>>(new Set());
  
  // Browse mode state
  const [browseCatalog, setBrowseCatalog] = useState<CatalogDrink[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseCategory, setBrowseCategory] = useState<'drink' | 'shot' | 'soft' | 'other'>('drink');
  
  // Request dialog
  const [showRequestDialog, setShowRequestDialog] = useState(false);
  const [requestName, setRequestName] = useState('');
  const [requestCategory, setRequestCategory] = useState<'drink' | 'shot' | 'soft'>('drink');
  const [requestBrand, setRequestBrand] = useState('');
  const [requestDescription, setRequestDescription] = useState('');
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      setResults([]);
      setSelectedDrink(null);
      setPrice('');
      setPresalePrice('');
      setCollection('drink');
      setMode('browse');
    } else {
      // Fetch already added drinks when dialog opens
      fetchAddedDrinks();
    }
  }, [isOpen]);

  const fetchAddedDrinks = async () => {
    try {
      const { data, error } = await supabase
        .from('drinks')
        .select('name')
        .eq('venue_id', venueId);
      
      if (error) throw error;
      setAddedDrinkNames(new Set((data || []).map(d => d.name.toLowerCase())));
    } catch (error) {
      console.error('Error fetching added drinks:', error);
    }
  };

  // Fetch catalog for browse mode
  useEffect(() => {
    if (isOpen && mode === 'browse' && addedDrinkNames.size >= 0) {
      fetchBrowseCatalog();
    }
  }, [isOpen, mode, browseCategory, addedDrinkNames]);

  const fetchBrowseCatalog = async () => {
    setBrowseLoading(true);
    try {
      const { data, error } = await supabase
        .from('drink_catalog')
        .select('*')
        .eq('category', browseCategory)
        .order('name', { ascending: true });

      if (error) throw error;
      // Filter out already added drinks
      const filtered = (data || []).filter(d => !addedDrinkNames.has(d.name.toLowerCase()));
      setBrowseCatalog(filtered);
    } catch (error) {
      console.error('Error fetching catalog:', error);
    } finally {
      setBrowseLoading(false);
    }
  };

  useEffect(() => {
    const searchCatalog = async () => {
      if (mode !== 'search' || !searchTerm || searchTerm.length < 2) {
        setResults([]);
        return;
      }

      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('drink_catalog')
          .select('*')
          .or(`name.ilike.%${searchTerm}%,brand.ilike.%${searchTerm}%`)
          .limit(30);

        if (error) throw error;
        // Filter out already added drinks
        const filtered = (data || []).filter(d => !addedDrinkNames.has(d.name.toLowerCase()));
        setResults(filtered);
      } catch (error) {
        console.error('Error searching catalog:', error);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(searchCatalog, 300);
    return () => clearTimeout(debounce);
  }, [searchTerm, mode]);

  const handleSelectDrink = (drink: CatalogDrink) => {
    setSelectedDrink(drink);
    setCollection((drink.category as 'drink' | 'shot' | 'soft') || 'drink');
  };

  const handleAddDrink = async () => {
    if (!selectedDrink || !price || parseFloat(price) <= 0) {
      toast.error(t('drinkCatalog.enterValidPrice'));
      return;
    }

    setIsSaving(true);
    try {
      const presalePriceValue = presalePrice && parseFloat(presalePrice) > 0 ? parseFloat(presalePrice) : null;
      
      const { error } = await supabase.from('drinks').insert({
        id: crypto.randomUUID(),
        name: selectedDrink.name,
        price: parseFloat(price),
        presale_price: presalePriceValue,
        presale_active: false,
        img_url: selectedDrink.image_url || '/placeholder.svg',
        description: selectedDrink.description || '',
        alc_pct: selectedDrink.alc_pct,
        active: true,
        venue_id: venueId,
        collection: collection,
      });

      if (error) throw error;

      toast.success(t('drinkCat.addedToMenu').replace('{name}', selectedDrink.name));
      setIsOpen(false);
      onDrinkAdded();
    } catch (error: any) {
      console.error('Error adding drink:', error);
      toast.error(t('drinkCatalog.addError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRequestNewDrink = () => {
    setRequestName(searchTerm);
    setShowRequestDialog(true);
  };

  // Reusable drink card component
  const DrinkCard = ({ drink, onSelect }: { drink: CatalogDrink; onSelect: (d: CatalogDrink) => void }) => (
    <motion.button
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      onClick={() => onSelect(drink)}
      className="flex flex-col items-center p-3 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-all text-center group"
    >
      {drink.image_url ? (
        <img
          src={drink.image_url}
          alt={drink.name}
          className="w-20 h-20 rounded-lg object-cover mb-2"
        />
      ) : (
        <div className="w-20 h-20 rounded-lg bg-muted flex items-center justify-center mb-2">
          <span className="text-2xl">{categoryConfig[drink.category as keyof typeof categoryConfig]?.emoji || '🍹'}</span>
        </div>
      )}
      <p className="font-medium text-sm line-clamp-2">{drink.name}</p>
      <div className="flex items-center gap-1 mt-1">
        <Badge variant="secondary" className="text-xs">
          {(() => {
            const cfg = categoryConfig[drink.category as keyof typeof categoryConfig];
            return cfg ? t(cfg.labelKey) : drink.category;
          })()}
        </Badge>
        {drink.alc_pct && (
          <span className="text-xs text-muted-foreground">{drink.alc_pct}%</span>
        )}
      </div>
      <Plus className="h-5 w-5 text-primary mt-2 opacity-0 group-hover:opacity-100 transition-opacity" />
    </motion.button>
  );

  const submitDrinkRequest = async () => {
    if (!requestName.trim()) {
      toast.error(t('drinkCatalog.enterDrinkName'));
      return;
    }

    setIsSubmittingRequest(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase.from('drink_requests').insert({
        venue_id: venueId,
        requested_by: user.id,
        drink_name: requestName,
        category: requestCategory,
        brand: requestBrand || null,
        description: requestDescription || null,
      });

      if (error) throw error;

      toast.success(t('drinkCatalog.requestSent'));
      setShowRequestDialog(false);
      setIsOpen(false);
      setRequestName('');
      setRequestBrand('');
      setRequestDescription('');
    } catch (error: any) {
      console.error('Error submitting request:', error);
      toast.error(t('drinkCatalog.requestError'));
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  return (
    <>
      <Button onClick={() => setIsOpen(true)} className="w-full sm:w-auto">
        <Plus className="mr-2 h-5 w-5" />
        {t('drinkCat.addDrink')}
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('drinkCat.addDrink')}</DialogTitle>
            <DialogDescription>
              {t('drinkCat.searchOrRequest')}
            </DialogDescription>
          </DialogHeader>

          {!selectedDrink ? (
            <div className="flex-1 overflow-hidden flex flex-col">
              {/* Mode tabs */}
              <Tabs value={mode} onValueChange={(v) => setMode(v as 'search' | 'browse')} className="w-full">
                <TabsList className="w-full mb-4">
                  <TabsTrigger value="browse" className="flex-1">
                    <Grid3X3 className="h-4 w-4 mr-2" />
                    {t('drinkCat.browse')}
                  </TabsTrigger>
                  <TabsTrigger value="search" className="flex-1">
                    <Search className="h-4 w-4 mr-2" />
                    {t('drinkCat.search')}
                  </TabsTrigger>
                </TabsList>

                {/* Search mode */}
                <TabsContent value="search" className="mt-0 flex-1 overflow-hidden flex flex-col">
                  <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder={t('drinkCat.typeNamePlaceholder')}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 pr-10"
                      autoFocus={mode === 'search'}
                    />
                    {searchTerm && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
                        onClick={() => { setSearchTerm(''); setResults([]); }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  <ScrollArea className="flex-1 h-[350px]">
                    {loading ? (
                      <div className="py-8 text-center">
                        <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground mt-2">{t('drinkCat.searching')}</p>
                      </div>
                    ) : searchTerm.length < 2 ? (
                      <div className="py-8 text-center text-muted-foreground">
                        <Search className="h-12 w-12 mx-auto mb-3 opacity-50" />
                        <p>{t('drinkCat.minCharsHint')}</p>
                      </div>
                    ) : results.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pr-4">
                        {results.map((drink) => (
                          <DrinkCard key={drink.id} drink={drink} onSelect={handleSelectDrink} />
                        ))}
                      </div>
                    ) : (
                      <div className="py-8 text-center">
                        <p className="text-muted-foreground mb-4">
                          {t('drinkCat.noDrinksFound').replace('{term}', searchTerm)}
                        </p>
                        <Button onClick={handleRequestNewDrink} variant="outline">
                          <Send className="h-4 w-4 mr-2" />
                          {t('drinkCat.requestThis')}
                        </Button>
                      </div>
                    )}
                  </ScrollArea>
                </TabsContent>

                {/* Browse mode */}
                <TabsContent value="browse" className="mt-0 flex-1 overflow-hidden flex flex-col">
                  {/* Category pills */}
                  <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
                    {(['drink', 'shot', 'soft', 'other'] as const).map((cat) => {
                      const config = categoryConfig[cat];
                      return (
                        <Button
                          key={cat}
                          variant={browseCategory === cat ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setBrowseCategory(cat)}
                          className="shrink-0"
                        >
                          <config.icon className="h-4 w-4 mr-1" />
                          {t(config.labelKey)}
                        </Button>
                      );
                    })}
                  </div>

                  <ScrollArea className="flex-1 h-[350px]">
                    {browseLoading ? (
                      <div className="py-8 text-center">
                        <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground mt-2">{t('drinkCat.loading')}</p>
                      </div>
                    ) : browseCatalog.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pr-4">
                        {browseCatalog.map((drink) => (
                          <DrinkCard key={drink.id} drink={drink} onSelect={handleSelectDrink} />
                        ))}
                      </div>
                    ) : (
                      <div className="py-8 text-center text-muted-foreground">
                        <p>{t('drinkCat.noCategory')}</p>
                        <Button onClick={() => { setMode('search'); }} variant="outline" className="mt-4">
                          <Search className="h-4 w-4 mr-2" />
                          {t('drinkCat.searchByName')}
                        </Button>
                      </div>
                    )}
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </div>
          ) : (
            <div className="flex-1 space-y-6 overflow-y-auto pr-1">
              {/* Selected drink preview */}
              <div className="flex items-center gap-4 p-4 rounded-xl bg-muted/50 border border-border">
                {selectedDrink.image_url ? (
                  <img
                    src={selectedDrink.image_url}
                    alt={selectedDrink.name}
                    className="w-24 h-24 rounded-lg object-cover"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-lg bg-muted flex items-center justify-center">
                    <span className="text-3xl">🍹</span>
                  </div>
                )}
                <div className="flex-1">
                  <h3 className="text-lg font-semibold">{selectedDrink.name}</h3>
                  {selectedDrink.brand && (
                    <p className="text-sm text-muted-foreground">{selectedDrink.brand}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="secondary">
                      {selectedDrink.category === 'drink' ? t('drinkCat.categoryDrink') : selectedDrink.category === 'shot' ? t('drinkCat.catShots') : t('drinkCat.catSofts')}
                    </Badge>
                    {selectedDrink.alc_pct && (
                      <span className="text-sm text-muted-foreground">{selectedDrink.alc_pct}% alc.</span>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedDrink(null)}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {/* Price inputs */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="price" className="text-base font-medium">
                    {t('drinkCat.salePrice')}
                  </Label>
                  <div className="relative">
                    <Input
                      id="price"
                      type="number"
                      step="0.5"
                      min="0"
                      placeholder="0.00"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className="text-2xl font-bold h-14 pr-12"
                      autoFocus
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xl font-bold text-muted-foreground">
                      €
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="presalePrice" className="text-base font-medium">
                    {t('drinkCat.presalePrice')}
                  </Label>
                  <div className="relative">
                    <Input
                      id="presalePrice"
                      type="number"
                      step="0.5"
                      min="0"
                      placeholder={t('drinkCat.presalePlaceholder')}
                      value={presalePrice}
                      onChange={(e) => setPresalePrice(e.target.value)}
                      className="h-12 pr-12"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-lg text-muted-foreground">
                      €
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('drinkCat.presaleDesc')}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-base font-medium">{t('drinkCat.displayCategory')}</Label>
                  <Select value={collection} onValueChange={(v) => setCollection(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="drink">🍹 {t('drinkCat.catDrinks')}</SelectItem>
                      <SelectItem value="shot">🥃 {t('drinkCat.catShots')}</SelectItem>
                      <SelectItem value="soft">🥤 {t('drinkCat.catSofts')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {selectedDrink && (
            <DialogFooter className="mt-4 shrink-0 border-t border-border pt-4 bg-background sticky bottom-0">
              <Button variant="outline" onClick={() => setSelectedDrink(null)}>
                {t('drinkCat.back')}
              </Button>
              <Button 
                onClick={handleAddDrink} 
                disabled={isSaving || !price || parseFloat(price) <= 0}
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                {t('drinkCat.addToMenu')}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Request new drink dialog */}
      <Dialog open={showRequestDialog} onOpenChange={setShowRequestDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('drinkCat.requestTitle')}</DialogTitle>
            <DialogDescription>
              {t('drinkCat.requestDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="requestName">{t('drinkCat.drinkName')}</Label>
              <Input
                id="requestName"
                value={requestName}
                onChange={(e) => setRequestName(e.target.value)}
                placeholder={t('drinkCat.nameExample')}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('drinkCat.category')}</Label>
              <Select value={requestCategory} onValueChange={(v) => setRequestCategory(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="drink">🍹 {t('drinkCat.catDrinks')}</SelectItem>
                  <SelectItem value="shot">🥃 {t('drinkCat.catShots')}</SelectItem>
                  <SelectItem value="soft">🥤 {t('drinkCat.catSofts')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="requestBrand">{t('drinkCat.brand')}</Label>
              <Input
                id="requestBrand"
                value={requestBrand}
                onChange={(e) => setRequestBrand(e.target.value)}
                placeholder={t('drinkCat.brandExample')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="requestDescription">{t('drinkCat.description')}</Label>
              <Input
                id="requestDescription"
                value={requestDescription}
                onChange={(e) => setRequestDescription(e.target.value)}
                placeholder={t('drinkCat.descExample')}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRequestDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={submitDrinkRequest} disabled={isSubmittingRequest || !requestName.trim()}>
              {isSubmittingRequest ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              {t('drinkCat.submitRequest')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
