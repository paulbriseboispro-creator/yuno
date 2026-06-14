import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, ShoppingCart, Trash2, Info, Percent, Gift, Tag, ArrowRight, Check, Pencil } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import {
  UInfoBanner, UButton, UInput, USelect, UFieldLabel, UEmpty, ULoading, UIconButton,
  DIALOG_STYLE, CARD_BG, INNER_BG, BORDER, T1, T2, T3, RED, WARN, POS,
} from './upsell-ui';

interface CartRule {
  id: string;
  name: string;
  description: string | null;
  rule_type: string;
  trigger_collection: string | null;
  trigger_min_qty: number;
  discount_percent: number | null;
  addon_drink_id: string | null;
  addon_fixed_price: number | null;
  reward_collection: string | null;
  reward_drink_id: string | null;
  free_qty: number;
  is_active: boolean;
  priority: number;
}

interface DrinkOption {
  id: string;
  name: string;
  price: number;
  collection: string;
}

type TemplateType = 'qty_discount' | 'free_item' | 'discounted_item';

interface TemplateConfig {
  type: TemplateType;
  icon: typeof Percent;
  titleKey: string;
  descKey: string;
  exampleKey: string;
  defaults: {
    rule_type: string;
    trigger_min_qty: number;
    discount_percent: number;
    trigger_collection: string;
    reward_collection: string;
  };
}

const TEMPLATES: TemplateConfig[] = [
  {
    type: 'qty_discount',
    icon: Percent,
    titleKey: 'upsell.tplQtyDiscountTitle',
    descKey: 'upsell.tplQtyDiscountDesc',
    exampleKey: 'upsell.tplQtyDiscountExample',
    defaults: {
      rule_type: 'percentage_discount',
      trigger_min_qty: 2,
      discount_percent: 50,
      trigger_collection: 'drink',
      reward_collection: 'drink',
    },
  },
  {
    type: 'free_item',
    icon: Gift,
    titleKey: 'upsell.tplFreeItemTitle',
    descKey: 'upsell.tplFreeItemDesc',
    exampleKey: 'upsell.tplFreeItemExample',
    defaults: {
      rule_type: 'percentage_discount',
      trigger_min_qty: 2,
      discount_percent: 100,
      trigger_collection: 'drink',
      reward_collection: 'shot',
    },
  },
  {
    type: 'discounted_item',
    icon: Tag,
    titleKey: 'upsell.tplDiscountedItemTitle',
    descKey: 'upsell.tplDiscountedItemDesc',
    exampleKey: 'upsell.tplDiscountedItemExample',
    defaults: {
      rule_type: 'percentage_discount',
      trigger_min_qty: 1,
      discount_percent: 50,
      trigger_collection: 'drink',
      reward_collection: 'shot',
    },
  },
];

export function OwnerUpsellCartRules({ venueId }: { venueId: string }) {
  const { t } = useLanguage();
  const [rules, setRules] = useState<CartRule[]>([]);
  const [drinks, setDrinks] = useState<DrinkOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<CartRule | null>(null);
  const [step, setStep] = useState<'template' | 'config'>('template');

  // Form state
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateType | null>(null);
  const [triggerCollection, setTriggerCollection] = useState('drink');
  const [triggerMinQty, setTriggerMinQty] = useState(2);
  const [discountPercent, setDiscountPercent] = useState(50);
  const [rewardCollection, setRewardCollection] = useState('drink');
  const [rewardDrinkId, setRewardDrinkId] = useState('');
  const [freeQty, setFreeQty] = useState(1);

  useEffect(() => { fetchRules(); fetchDrinks(); }, [venueId]);

  const fetchRules = async () => {
    const { data, error } = await supabase
      .from('upsell_cart_rules')
      .select('*')
      .eq('venue_id', venueId)
      .order('priority', { ascending: true });
    if (!error && data) {
      setRules(data.map((r: any) => ({
        ...r,
        discount_percent: r.discount_percent ? Number(r.discount_percent) : null,
        addon_fixed_price: r.addon_fixed_price ? Number(r.addon_fixed_price) : null,
        free_qty: r.free_qty ?? 1,
      })));
    }
    setLoading(false);
  };

  const fetchDrinks = async () => {
    const { data } = await supabase
      .from('drinks')
      .select('id, name, price, collection')
      .eq('venue_id', venueId)
      .eq('active', true)
      .order('name');
    if (data) setDrinks(data.map(d => ({ ...d, price: Number(d.price) })));
  };

  const resetForm = () => {
    setSelectedTemplate(null);
    setStep('template');
    setTriggerCollection('drink');
    setTriggerMinQty(2);
    setDiscountPercent(50);
    setRewardCollection('drink');
    setRewardDrinkId('');
    setFreeQty(1);
    setEditingRule(null);
  };

  const selectTemplate = (tpl: TemplateConfig) => {
    setSelectedTemplate(tpl.type);
    setTriggerCollection(tpl.defaults.trigger_collection);
    setTriggerMinQty(tpl.defaults.trigger_min_qty);
    setDiscountPercent(tpl.defaults.discount_percent);
    setRewardCollection(tpl.defaults.reward_collection);
    setFreeQty(1);
    setRewardDrinkId('');
    setStep('config');
  };

  const openEdit = (rule: CartRule) => {
    setEditingRule(rule);
    setTriggerCollection(rule.trigger_collection || 'drink');
    setTriggerMinQty(rule.trigger_min_qty);
    setDiscountPercent(rule.discount_percent ?? 50);
    setRewardCollection(rule.reward_collection || rule.trigger_collection || 'drink');
    setRewardDrinkId(rule.reward_drink_id || '');
    setFreeQty(rule.free_qty || 1);
    // Detect template type
    if (rule.discount_percent === 100) setSelectedTemplate('free_item');
    else if (rule.reward_collection && rule.reward_collection !== rule.trigger_collection) setSelectedTemplate('discounted_item');
    else setSelectedTemplate('qty_discount');
    setStep('config');
    setDialogOpen(true);
  };

  const buildSummaryFromData = (tpl: TemplateType | null, tColl: string, rColl: string, minQty: number, disc: number, qty: number): string => {
    const triggerLabel = collectionLabel(tColl);
    const rewardLabel = collectionLabel(rColl);
    if (tpl === 'qty_discount') {
      return `${minQty} ${triggerLabel} → ${t('upsell.summaryNextAt')} -${disc}%`;
    }
    if (tpl === 'free_item') {
      return `${minQty} ${triggerLabel} → ${qty} ${rewardLabel} ${t('upsell.summaryFree')}`;
    }
    return `${minQty} ${triggerLabel} → ${rewardLabel} ${t('upsell.summaryAt')} -${disc}%`;
  };

  const buildSummary = (): string => {
    return buildSummaryFromData(selectedTemplate, triggerCollection, rewardCollection, triggerMinQty, discountPercent, freeQty);
  };

  const buildNameFromData = (tpl: TemplateType | null, tColl: string, rColl: string, minQty: number, disc: number, qty: number): string => {
    const triggerLabel = collectionLabel(tColl);
    const rewardLabel = collectionLabel(rColl);
    if (tpl === 'qty_discount') return `${minQty} ${triggerLabel} = ${minQty + qty}e → -${disc}%`;
    if (tpl === 'free_item') return `${minQty} ${triggerLabel} = ${qty} ${rewardLabel} ${t('upsell.summaryFree')}`;
    return `${minQty} ${triggerLabel} = ${rewardLabel} → -${disc}%`;
  };

  const buildName = (): string => {
    return buildNameFromData(selectedTemplate, triggerCollection, rewardCollection, triggerMinQty, discountPercent, freeQty);
  };

  const getRuleDisplayName = (rule: CartRule): string => {
    const tpl: TemplateType = rule.discount_percent === 100 ? 'free_item'
      : (rule.reward_collection && rule.reward_collection !== rule.trigger_collection) ? 'discounted_item'
      : 'qty_discount';
    const tColl = rule.trigger_collection || 'all';
    const rColl = rule.reward_collection || rule.trigger_collection || 'drink';
    return buildNameFromData(tpl, tColl, rColl, rule.trigger_min_qty, rule.discount_percent ?? 50, rule.free_qty);
  };

  const getRuleDisplayDesc = (rule: CartRule): string => {
    const tpl: TemplateType = rule.discount_percent === 100 ? 'free_item'
      : (rule.reward_collection && rule.reward_collection !== rule.trigger_collection) ? 'discounted_item'
      : 'qty_discount';
    const tColl = rule.trigger_collection || 'all';
    const rColl = rule.reward_collection || rule.trigger_collection || 'drink';
    return buildSummaryFromData(tpl, tColl, rColl, rule.trigger_min_qty, rule.discount_percent ?? 50, rule.free_qty);
  };

  const collectionLabel = (c: string) => {
    switch (c) {
      case 'drink': return t('venue.drinks');
      case 'shot': return t('venue.shots');
      case 'soft': return t('venue.softs');
      default: return t('upsell.allCategories');
    }
  };

  const handleSave = async () => {
    // For qty_discount (same-category), reward_collection must be null
    const effectiveRewardCol = selectedTemplate === 'qty_discount'
      ? null
      : (rewardCollection === triggerCollection ? null : rewardCollection);

    const payload: any = {
      venue_id: venueId,
      name: buildName(),
      description: buildSummary(),
      rule_type: 'percentage_discount',
      trigger_collection: triggerCollection === 'all' ? null : triggerCollection,
      trigger_min_qty: triggerMinQty,
      discount_percent: discountPercent,
      reward_collection: effectiveRewardCol,
      reward_drink_id: rewardDrinkId || null,
      free_qty: freeQty,
      addon_drink_id: null,
      addon_fixed_price: null,
    };

    if (editingRule) {
      const { error } = await supabase.from('upsell_cart_rules').update(payload).eq('id', editingRule.id);
      if (error) { toast.error(error.message); return; }
      toast.success(t('upsell.ruleUpdated'));
    } else {
      payload.priority = rules.length;
      const { error } = await supabase.from('upsell_cart_rules').insert(payload);
      if (error) { toast.error(error.message); return; }
      toast.success(t('upsell.ruleCreated'));
    }
    setDialogOpen(false);
    resetForm();
    fetchRules();
  };

  const toggleActive = async (rule: CartRule) => {
    await supabase.from('upsell_cart_rules').update({ is_active: !rule.is_active }).eq('id', rule.id);
    fetchRules();
  };

  const deleteRule = async (id: string) => {
    const { error } = await supabase.from('upsell_cart_rules').delete().eq('id', id);
    if (error) {
      console.error('Delete error:', error);
      toast.error(error.message);
      return;
    }
    toast.success(t('upsell.ruleDeleted'));
    fetchRules();
  };

  const collectionOptions = [
    { value: 'all', label: t('upsell.allCategories') },
    { value: 'drink', label: t('venue.drinks') },
    { value: 'shot', label: t('venue.shots') },
    { value: 'soft', label: t('venue.softs') },
  ];

  const rewardOptions = [
    { value: 'drink', label: t('venue.drinks') },
    { value: 'shot', label: t('venue.shots') },
    { value: 'soft', label: t('venue.softs') },
  ];

  if (loading) return <ULoading />;

  return (
    <div className="space-y-4">
      <UInfoBanner icon={Info}>{t('upsell.cartRulesContextInfo')}</UInfoBanner>

      <UButton variant="primary" full onClick={() => { resetForm(); setDialogOpen(true); }}>
        <Plus className="h-4 w-4" />
        {t('upsell.createRule')}
      </UButton>

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto" style={DIALOG_STYLE}>
          <DialogHeader>
            <DialogTitle style={{ color: T1 }}>{editingRule ? t('upsell.editRule') : t('upsell.createRule')}</DialogTitle>
          </DialogHeader>

          {step === 'template' && (
            <div className="space-y-2.5">
              <p className="text-[13px]" style={{ color: T2 }}>{t('upsell.chooseTemplate')}</p>
              {TEMPLATES.map((tpl) => {
                const Icon = tpl.icon;
                return (
                  <button
                    key={tpl.type}
                    onClick={() => selectTemplate(tpl)}
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
              <button onClick={() => setStep('template')} className="text-[12px] cursor-pointer" style={{ color: T3 }}>
                ← {t('upsell.changeTemplate')}
              </button>

              {/* Trigger config */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <UFieldLabel>{t('upsell.triggerCategory')}</UFieldLabel>
                  <USelect value={triggerCollection} onChange={setTriggerCollection}>
                    {collectionOptions.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </USelect>
                </div>
                <div>
                  <UFieldLabel>{t('upsell.minQty')}</UFieldLabel>
                  <UInput type="number" min={1} max={20} value={triggerMinQty} onChange={(v) => setTriggerMinQty(parseInt(v) || 1)} />
                </div>
              </div>

              {/* Reward config */}
              {(selectedTemplate === 'free_item' || selectedTemplate === 'discounted_item') && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <UFieldLabel>{t('upsell.rewardCategory')}</UFieldLabel>
                    <USelect value={rewardCollection} onChange={setRewardCollection}>
                      {rewardOptions.map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </USelect>
                  </div>
                  <div>
                    <UFieldLabel>{t('upsell.rewardQty')}</UFieldLabel>
                    <UInput type="number" min={1} max={5} value={freeQty} onChange={(v) => setFreeQty(parseInt(v) || 1)} />
                  </div>
                </div>
              )}

              {/* Specific drink reward (optional) */}
              {(selectedTemplate === 'free_item' || selectedTemplate === 'discounted_item') && (
                <div>
                  <UFieldLabel>{t('upsell.specificDrink')} ({t('upsell.optional')})</UFieldLabel>
                  <USelect value={rewardDrinkId || '__any__'} onChange={(v) => setRewardDrinkId(v === '__any__' ? '' : v)}>
                    <option value="__any__">{t('upsell.anyDrinkInCategory')}</option>
                    {drinks.filter(d => d.collection === rewardCollection).map(d => (
                      <option key={d.id} value={d.id}>{d.name} ({d.price}€)</option>
                    ))}
                  </USelect>
                </div>
              )}

              {/* Discount percent (not for 100% free) */}
              {selectedTemplate !== 'free_item' && (
                <div>
                  <UFieldLabel>{t('upsell.discountPercent')}</UFieldLabel>
                  <UInput type="number" min={1} max={100} value={discountPercent} onChange={(v) => setDiscountPercent(parseInt(v) || 1)} />
                </div>
              )}

              {/* Summary preview */}
              <div className="flex items-center gap-2" style={{ background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.22)', borderRadius: 12, padding: '11px 13px' }}>
                <Check className="h-4 w-4 shrink-0" style={{ color: RED }} />
                <p className="text-[13px] font-medium" style={{ color: T1 }}>{buildSummary()}</p>
              </div>

              <UButton variant="primary" full onClick={handleSave}>{editingRule ? t('upsell.ruleUpdated') : t('upsell.createRule')}</UButton>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {rules.length === 0 ? (
        <UEmpty icon={ShoppingCart} title={t('upsell.noRulesYet')} />
      ) : (
        <div className="space-y-2.5">
          {rules.map((rule, i) => {
            const isFree = rule.discount_percent === 100;
            return (
              <motion.div
                key={rule.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <div
                  className="overflow-hidden"
                  style={{
                    background: CARD_BG,
                    border: `1px solid ${rule.is_active ? BORDER : 'rgba(255,255,255,0.05)'}`,
                    borderRadius: 14,
                    padding: 16,
                    opacity: rule.is_active ? 1 : 0.55,
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {isFree
                          ? <Gift className="h-3.5 w-3.5" style={{ color: WARN }} />
                          : <Percent className="h-3.5 w-3.5" style={{ color: POS }} />}
                        <h3 className="font-semibold text-[13.5px] truncate" style={{ color: T1 }}>{getRuleDisplayName(rule)}</h3>
                      </div>
                      <p className="text-[12px]" style={{ color: T3 }}>{getRuleDisplayDesc(rule)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={rule.is_active} onCheckedChange={() => toggleActive(rule)} />
                      <UIconButton onClick={() => openEdit(rule)} title={t('upsell.editRule')}>
                        <Pencil className="h-3.5 w-3.5" />
                      </UIconButton>
                      <UIconButton tone="danger" onClick={() => deleteRule(rule.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </UIconButton>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
