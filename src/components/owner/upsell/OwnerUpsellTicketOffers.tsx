import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Trash2, Info, Package, Tag, Percent, ArrowRight, Check, Shirt, Pencil } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import {
  UInfoBanner, UButton, UInput, UFieldLabel, UEmpty, ULoading, UIconButton,
  DIALOG_STYLE, CARD_BG, INNER_BG, BORDER, T1, T2, T3, RED,
} from './upsell-ui';

interface TicketUpsellOffer {
  id: string;
  offer_type: string;
  name: string;
  description: string | null;
  drink_count: number | null;
  pack_price: number | null;
  original_price: number | null;
  discounted_price: number | null;
  regular_price: number | null;
  cloakroom_price: number | null;
  cloakroom_regular_price: number | null;
  combo_qty: number | null;
  combo_discount_percent: number | null;
  is_active: boolean;
  priority: number;
}

type TemplateType = 'drink_pack' | 'single_drink_discount' | 'cloakroom' | 'drink_combo';

interface TemplateConfig {
  type: TemplateType;
  icon: typeof Package;
  titleKey: string;
  descKey: string;
  exampleKey: string;
}

const TEMPLATES: TemplateConfig[] = [
  { type: 'drink_pack', icon: Package, titleKey: 'upsell.ticketTplDrinkPackTitle', descKey: 'upsell.ticketTplDrinkPackDesc', exampleKey: 'upsell.ticketTplDrinkPackExample' },
  { type: 'single_drink_discount', icon: Tag, titleKey: 'upsell.ticketTplSingleDrinkTitle', descKey: 'upsell.ticketTplSingleDrinkDesc', exampleKey: 'upsell.ticketTplSingleDrinkExample' },
  { type: 'cloakroom', icon: Shirt, titleKey: 'upsell.ticketTplCloakroomTitle', descKey: 'upsell.ticketTplCloakroomDesc', exampleKey: 'upsell.ticketTplCloakroomExample' },
  { type: 'drink_combo', icon: Percent, titleKey: 'upsell.ticketTplComboTitle', descKey: 'upsell.ticketTplComboDesc', exampleKey: 'upsell.ticketTplComboExample' },
];

const OFFER_ICON_TONE: Record<string, string> = {
  drink_pack: '#FBBF24',
  single_drink_discount: '#34D399',
  cloakroom: '#60A5FA',
  drink_combo: '#A78BFA',
};

export function OwnerUpsellTicketOffers({ venueId }: { venueId: string }) {
  const { t } = useLanguage();
  const [offers, setOffers] = useState<TicketUpsellOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOffer, setEditingOffer] = useState<TicketUpsellOffer | null>(null);
  const [step, setStep] = useState<'template' | 'config'>('template');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateType | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [drinkCount, setDrinkCount] = useState(3);
  const [packPrice, setPackPrice] = useState(25);
  const [originalPrice, setOriginalPrice] = useState(36);
  const [discountedPrice, setDiscountedPrice] = useState(13);
  const [regularPrice, setRegularPrice] = useState(15);
  const [cloakroomPrice, setCloakroomPrice] = useState(3);
  const [cloakroomRegularPrice, setCloakroomRegularPrice] = useState(4);
  const [comboQty, setComboQty] = useState(3);
  const [comboDiscountPercent, setComboDiscountPercent] = useState(20);

  useEffect(() => { fetchOffers(); }, [venueId]);

  const fetchOffers = async () => {
    const { data } = await supabase
      .from('ticket_upsell_offers')
      .select('*')
      .eq('venue_id', venueId)
      .order('priority', { ascending: true });
    if (data) setOffers(data as any);
    setLoading(false);
  };

  const resetForm = () => {
    setSelectedTemplate(null);
    setStep('template');
    setEditingOffer(null);
    setName('');
    setDescription('');
    setDrinkCount(3);
    setPackPrice(25);
    setOriginalPrice(36);
    setDiscountedPrice(13);
    setRegularPrice(15);
    setCloakroomPrice(3);
    setCloakroomRegularPrice(4);
    setComboQty(3);
    setComboDiscountPercent(20);
  };

  const getAutoName = (type: TemplateType | null): string => {
    switch (type) {
      case 'drink_pack': return t('upsell.ticketAutoNameDrinkPack').replace('{count}', String(drinkCount)).replace('{price}', String(packPrice));
      case 'single_drink_discount': return t('upsell.ticketAutoNameDrink').replace('{price}', String(discountedPrice));
      case 'cloakroom': return t('upsell.ticketAutoNameCloakroom').replace('{price}', String(cloakroomPrice));
      case 'drink_combo': return t('upsell.ticketAutoNameCombo').replace('{count}', String(comboQty)).replace('{percent}', String(comboDiscountPercent));
      default: return '';
    }
  };

  const selectTemplate = (type: TemplateType) => {
    setSelectedTemplate(type);
    setStep('config');
  };

  const openEdit = (offer: TicketUpsellOffer) => {
    setEditingOffer(offer);
    setSelectedTemplate(offer.offer_type as TemplateType);
    setName(offer.name);
    setDescription(offer.description || '');
    setDrinkCount(offer.drink_count || 3);
    setPackPrice(Number(offer.pack_price) || 25);
    setOriginalPrice(Number(offer.original_price) || 36);
    setDiscountedPrice(Number(offer.discounted_price) || 13);
    setRegularPrice(Number(offer.regular_price) || 15);
    setCloakroomPrice(Number(offer.cloakroom_price) || 3);
    setCloakroomRegularPrice(Number(offer.cloakroom_regular_price) || 4);
    setComboQty(offer.combo_qty || 3);
    setComboDiscountPercent(Number(offer.combo_discount_percent) || 20);
    setStep('config');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const autoName = getAutoName(selectedTemplate);

    const payload: any = {
      venue_id: venueId,
      offer_type: selectedTemplate,
      name: name || autoName,
      description: description || null,
      drink_count: selectedTemplate === 'drink_pack' ? drinkCount : selectedTemplate === 'drink_combo' ? comboQty : null,
      pack_price: selectedTemplate === 'drink_pack' ? packPrice : null,
      original_price: selectedTemplate === 'drink_pack' ? originalPrice : null,
      discounted_price: selectedTemplate === 'single_drink_discount' ? discountedPrice : null,
      regular_price: selectedTemplate === 'single_drink_discount' ? regularPrice : null,
      cloakroom_price: selectedTemplate === 'cloakroom' ? cloakroomPrice : null,
      cloakroom_regular_price: selectedTemplate === 'cloakroom' ? cloakroomRegularPrice : null,
      combo_qty: selectedTemplate === 'drink_combo' ? comboQty : null,
      combo_discount_percent: selectedTemplate === 'drink_combo' ? comboDiscountPercent : null,
    };

    if (editingOffer) {
      const { error } = await supabase.from('ticket_upsell_offers').update(payload).eq('id', editingOffer.id);
      if (error) { toast.error(error.message); return; }
      toast.success(t('upsell.ticketOfferUpdated'));
    } else {
      payload.priority = offers.length;
      const { error } = await supabase.from('ticket_upsell_offers').insert(payload);
      if (error) { toast.error(error.message); return; }
      toast.success(t('upsell.ticketOfferCreated'));
    }
    setDialogOpen(false);
    resetForm();
    fetchOffers();
  };

  const toggleActive = async (offer: TicketUpsellOffer) => {
    const { error } = await supabase.from('ticket_upsell_offers').update({ is_active: !offer.is_active }).eq('id', offer.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    fetchOffers();
  };

  const deleteOffer = async (id: string) => {
    const { error } = await supabase.from('ticket_upsell_offers').delete().eq('id', id);
    if (error) {
      console.error('Delete error:', error);
      toast.error(error.message);
      return;
    }
    toast.success(t('upsell.ticketOfferDeleted'));
    fetchOffers();
  };

  const getOfferIcon = (type: string) => {
    const color = OFFER_ICON_TONE[type] || T2;
    const Icon = type === 'drink_pack' ? Package : type === 'single_drink_discount' ? Tag : type === 'cloakroom' ? Shirt : type === 'drink_combo' ? Percent : Package;
    return <Icon className="h-3.5 w-3.5" style={{ color }} />;
  };

  const getOfferSummary = (offer: TicketUpsellOffer) => {
    switch (offer.offer_type) {
      case 'drink_pack':
        return t('upsell.ticketSummaryDrinkPack').replace('{count}', String(offer.drink_count)).replace('{price}', String(Number(offer.pack_price))).replace('{original}', String(Number(offer.original_price)));
      case 'single_drink_discount':
        return t('upsell.ticketSummaryDrink').replace('{price}', String(Number(offer.discounted_price))).replace('{original}', String(Number(offer.regular_price)));
      case 'cloakroom':
        return offer.cloakroom_regular_price
          ? t('upsell.ticketSummaryCloakroomFull').replace('{price}', String(Number(offer.cloakroom_price))).replace('{original}', String(Number(offer.cloakroom_regular_price)))
          : t('upsell.ticketSummaryCloakroom').replace('{price}', String(Number(offer.cloakroom_price)));
      case 'drink_combo':
        return t('upsell.ticketSummaryCombo').replace('{count}', String(offer.combo_qty)).replace('{percent}', String(Number(offer.combo_discount_percent)));
      default: return offer.name;
    }
  };

  const getPreviewText = (): string => {
    switch (selectedTemplate) {
      case 'drink_pack':
        return t('upsell.ticketSummaryDrinkPack').replace('{count}', String(drinkCount)).replace('{price}', String(packPrice)).replace('{original}', String(originalPrice));
      case 'single_drink_discount':
        return t('upsell.ticketSummaryDrink').replace('{price}', String(discountedPrice)).replace('{original}', String(regularPrice));
      case 'cloakroom':
        return cloakroomRegularPrice
          ? t('upsell.ticketSummaryCloakroomFull').replace('{price}', String(cloakroomPrice)).replace('{original}', String(cloakroomRegularPrice))
          : t('upsell.ticketSummaryCloakroom').replace('{price}', String(cloakroomPrice));
      case 'drink_combo':
        return t('upsell.ticketSummaryCombo').replace('{count}', String(comboQty)).replace('{percent}', String(comboDiscountPercent));
      default: return '';
    }
  };

  if (loading) return <ULoading />;

  return (
    <div className="space-y-4">
      <UInfoBanner icon={Info}>{t('upsell.ticketContextInfo')}</UInfoBanner>

      <UButton variant="primary" full onClick={() => { resetForm(); setDialogOpen(true); }}>
        <Plus className="h-4 w-4" />
        {t('upsell.ticketCreateOffer')}
      </UButton>

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto" style={DIALOG_STYLE}>
          <DialogHeader>
            <DialogTitle style={{ color: T1 }}>{editingOffer ? t('upsell.ticketEditOffer') : t('upsell.ticketNewOffer')}</DialogTitle>
          </DialogHeader>

          {step === 'template' && (
            <div className="space-y-2.5">
              <p className="text-[13px]" style={{ color: T2 }}>{t('upsell.ticketChooseType')}</p>
              {TEMPLATES.map((tpl) => {
                const Icon = tpl.icon;
                return (
                  <button
                    key={tpl.type}
                    onClick={() => selectTemplate(tpl.type)}
                    className="w-full text-left transition-all duration-150"
                    style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 14 }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(232,25,44,0.4)'; e.currentTarget.style.background = 'rgba(232,25,44,0.05)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.background = INNER_BG; }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
                        <Icon className="h-5 w-5" style={{ color: RED }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-[13.5px]" style={{ color: T1 }}>{t(tpl.titleKey)}</h4>
                        <p className="text-[12px] mt-0.5" style={{ color: T3 }}>{t(tpl.descKey)}</p>
                        <p className="text-[11.5px] mt-1 italic" style={{ color: 'rgba(232,25,44,0.7)' }}>{t(tpl.exampleKey)}</p>
                      </div>
                      <ArrowRight className="h-4 w-4 mt-3 shrink-0" style={{ color: T3 }} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {step === 'config' && (
            <div className="space-y-4">
              {!editingOffer && (
                <button onClick={() => setStep('template')} className="text-[12px] cursor-pointer" style={{ color: T3 }}>
                  ← {t('upsell.ticketChangeType')}
                </button>
              )}

              {/* Name */}
              <div>
                <UFieldLabel>{t('upsell.ticketOfferName')}</UFieldLabel>
                <UInput value={name} onChange={setName} placeholder={t('upsell.ticketAutoName')} />
              </div>

              {/* Drink Pack config */}
              {selectedTemplate === 'drink_pack' && (
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <UFieldLabel>{t('upsell.ticketDrinkCount')}</UFieldLabel>
                    <UInput type="number" min={1} value={drinkCount} onChange={(v) => setDrinkCount(parseInt(v) || 1)} />
                  </div>
                  <div>
                    <UFieldLabel>{t('upsell.ticketPackPrice')}</UFieldLabel>
                    <UInput type="number" min={0} step={0.5} value={packPrice} onChange={(v) => setPackPrice(parseFloat(v) || 0)} />
                  </div>
                  <div>
                    <UFieldLabel>{t('upsell.ticketNormalPrice')}</UFieldLabel>
                    <UInput type="number" min={0} step={0.5} value={originalPrice} onChange={(v) => setOriginalPrice(parseFloat(v) || 0)} />
                  </div>
                </div>
              )}

              {/* Single drink discount config */}
              {selectedTemplate === 'single_drink_discount' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <UFieldLabel>{t('upsell.ticketDiscountedPrice')}</UFieldLabel>
                    <UInput type="number" min={0} step={0.5} value={discountedPrice} onChange={(v) => setDiscountedPrice(parseFloat(v) || 0)} />
                  </div>
                  <div>
                    <UFieldLabel>{t('upsell.ticketRegularPrice')}</UFieldLabel>
                    <UInput type="number" min={0} step={0.5} value={regularPrice} onChange={(v) => setRegularPrice(parseFloat(v) || 0)} />
                  </div>
                </div>
              )}

              {/* Cloakroom config */}
              {selectedTemplate === 'cloakroom' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <UFieldLabel>{t('upsell.ticketCloakroomPrice')}</UFieldLabel>
                    <UInput type="number" min={0} step={0.5} value={cloakroomPrice} onChange={(v) => setCloakroomPrice(parseFloat(v) || 0)} />
                  </div>
                  <div>
                    <UFieldLabel>{t('upsell.ticketCloakroomRegularPrice')} ({t('upsell.optionalLabel').toLowerCase()})</UFieldLabel>
                    <UInput type="number" min={0} step={0.5} value={cloakroomRegularPrice} onChange={(v) => setCloakroomRegularPrice(parseFloat(v) || 0)} />
                  </div>
                </div>
              )}

              {/* Drink combo config */}
              {selectedTemplate === 'drink_combo' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <UFieldLabel>{t('upsell.ticketDrinkCount')}</UFieldLabel>
                    <UInput type="number" min={1} value={comboQty} onChange={(v) => setComboQty(parseInt(v) || 1)} />
                  </div>
                  <div>
                    <UFieldLabel>{t('upsell.ticketDiscount')}</UFieldLabel>
                    <UInput type="number" min={1} max={100} value={comboDiscountPercent} onChange={(v) => setComboDiscountPercent(parseInt(v) || 1)} />
                  </div>
                </div>
              )}

              {/* Description */}
              <div>
                <UFieldLabel>{t('upsell.ticketDescription')} ({t('upsell.optionalLabel').toLowerCase()})</UFieldLabel>
                <UInput value={description} onChange={setDescription} placeholder={t('upsell.ticketDetailPlaceholder')} />
              </div>

              {/* Preview */}
              <div className="flex items-center gap-2" style={{ background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.22)', borderRadius: 12, padding: '11px 13px' }}>
                <Check className="h-4 w-4 shrink-0" style={{ color: RED }} />
                <p className="text-[13px] font-medium" style={{ color: T1 }}>{getPreviewText()}</p>
              </div>

              <UButton variant="primary" full onClick={handleSave}>
                {editingOffer ? t('upsell.ticketUpdate') : t('upsell.ticketCreateBtn')}
              </UButton>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {offers.length === 0 ? (
        <UEmpty icon={Package} title={t('upsell.ticketNoOffers')} />
      ) : (
        <div className="space-y-2.5">
          {offers.map((offer, i) => (
            <motion.div
              key={offer.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <div
                className="overflow-hidden"
                style={{
                  background: CARD_BG,
                  border: `1px solid ${offer.is_active ? BORDER : 'rgba(255,255,255,0.05)'}`,
                  borderRadius: 14,
                  padding: 16,
                  opacity: offer.is_active ? 1 : 0.55,
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {getOfferIcon(offer.offer_type)}
                      <h3 className="font-semibold text-[13.5px] truncate" style={{ color: T1 }}>{offer.name || getOfferSummary(offer)}</h3>
                    </div>
                    <p className="text-[12px]" style={{ color: T3 }}>{getOfferSummary(offer)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={offer.is_active} onCheckedChange={() => toggleActive(offer)} />
                    <UIconButton onClick={() => openEdit(offer)} title={t('upsell.ticketEditOffer')}>
                      <Pencil className="h-3.5 w-3.5" />
                    </UIconButton>
                    <UIconButton tone="danger" onClick={() => deleteOffer(offer.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </UIconButton>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
