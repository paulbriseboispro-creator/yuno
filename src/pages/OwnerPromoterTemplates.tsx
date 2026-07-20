import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { usePromoterScope } from '@/hooks/usePromoterScope';
import { getScopeFilter, scopeId } from '@/lib/promoterScopeHelpers';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Star, Gift, Euro, Ticket, Crown, Wine, Layers, UserPlus, Tag, Percent } from 'lucide-react';
import type { CommissionRules, CommissionRuleTier, CommissionTimeWindow, RewardType } from '@/types/promoter';
import {
  PromoHeader, PromoPage, PromoCard, PromoPill, PromoButton, PromoEmpty,
  RED, T1, T2, T3, F_BORDER, TILE_BG,
} from '@/components/promoter/promoter-ui';

interface Template { id: string; name: string; rules: CommissionRules; isDefault: boolean; }

function emptyTier(): CommissionRuleTier { return { min: 0, max: null, reward_type: 'money', ticketValue: 0 }; }

// Which sections a saved template actually contains (inferred from its rules).
function sectionsOf(rules: CommissionRules) {
  return {
    sales: !!(rules.reward_type || rules.ticket || (rules.tiers && rules.tiers.length > 0)),
    clientDiscount: !!rules.customer_discount,
  };
}

export default function OwnerPromoterTemplates() {
  const scope = usePromoterScope();
  const sid = scopeId(scope);
  const scopeFilter = getScopeFilter(scope);
  const { basePath } = useDashboardMode();
  const { t } = useLanguage();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Common
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  // Section toggles. Guest-list config moved out of commission templates: a promoter's
  // guest list is now their allocation (a 'promoter' part) on the Guest List page.
  const [enableSales, setEnableSales] = useState(true);
  const [enableClientDiscount, setEnableClientDiscount] = useState(false);

  // Sales-commission state
  const [rewardType, setRewardType] = useState<RewardType>('money');
  const [ticketType, setTicketType] = useState<'fixed' | 'percentage'>('percentage');
  const [ticketValue, setTicketValue] = useState(10);
  const [tableType, setTableType] = useState<'fixed' | 'percentage'>('percentage');
  const [tableValue, setTableValue] = useState(10);
  const [rewardConfig, setRewardConfig] = useState<CommissionRules['reward_config']>({});
  const [useTiers, setUseTiers] = useState(false);
  const [tiers, setTiers] = useState<CommissionRuleTier[]>([]);
  const [bonusThreshold, setBonusThreshold] = useState(0);
  const [bonusAmount, setBonusAmount] = useState(0);
  const [timeWindows, setTimeWindows] = useState<CommissionTimeWindow[]>([]);
  // Guest list : euros par tete (voir migration 20260720160000).
  const [glPerHead, setGlPerHead] = useState(0);


  // Client-discount state
  const [cdType, setCdType] = useState<'percentage' | 'fixed'>('percentage');
  const [cdValue, setCdValue] = useState(10);
  const [cdAppliesTo, setCdAppliesTo] = useState<'tickets' | 'drinks' | 'both'>('both');
  const [cdLabel, setCdLabel] = useState('');

  useEffect(() => { if (sid) fetchTemplates(); }, [sid]);

  async function fetchTemplates() {
    if (!sid) return;
    const { data } = await supabase.from('commission_templates')
      .select('*').eq(scopeFilter.column, sid).order('created_at', { ascending: false });
    setTemplates((data || []).map(d => ({
      id: d.id, name: d.name, rules: d.rules as unknown as CommissionRules, isDefault: d.is_default,
    })));
    setLoading(false);
  }

  // N'AJOUTER ICI que des setters qui existent encore : cette fonction est le
  // premier appel de openCreate() ET openEdit(), donc un setter fantôme lève une
  // ReferenceError et le dialogue ne s'ouvre jamais — c'est ce qui est arrivé
  // quand la config guest list est sortie des modèles de commission.
  function resetForm() {
    setName(''); setIsDefault(false);
    setEnableSales(true); setEnableClientDiscount(false);
    setRewardType('money'); setTicketType('percentage'); setTicketValue(10);
    setTableType('percentage'); setTableValue(10); setRewardConfig({});
    setUseTiers(false); setTiers([]); setBonusThreshold(0); setBonusAmount(0); setTimeWindows([]);
    setGlPerHead(0);
    setCdType('percentage'); setCdValue(10); setCdAppliesTo('both'); setCdLabel('');
  }

  function openCreate() { setEditing(null); resetForm(); setDialogOpen(true); }

  function openEdit(tpl: Template) {
    setEditing(tpl);
    resetForm();
    setName(tpl.name);
    setIsDefault(tpl.isDefault);
    const r = tpl.rules;
    const s = sectionsOf(r);
    setEnableSales(s.sales); setEnableClientDiscount(s.clientDiscount);

    if (s.sales) {
      setRewardType(r.reward_type || 'money');
      setTicketType(r.ticket?.type || 'percentage');
      setTicketValue(r.ticket?.value ?? 10);
      setTableType(r.table?.type || 'percentage');
      setTableValue(r.table?.value ?? 10);
      setRewardConfig(r.reward_config || {});
      setUseTiers(!!(r.tiers && r.tiers.length > 0));
      setTiers(r.tiers || []);
      setBonusThreshold(r.bonus?.threshold || 0);
      setBonusAmount(r.bonus?.bonusAmount || 0);
      setTimeWindows(r.time_windows || []);
      setGlPerHead(r.guestlist?.value ?? 0);
    }
    if (s.clientDiscount && r.customer_discount) {
      const cd = r.customer_discount;
      setCdType(cd.type || 'percentage');
      setCdValue(cd.value || 10);
      setCdAppliesTo(cd.appliesTo || 'both');
      setCdLabel(cd.label || '');
    }
    setDialogOpen(true);
  }

  function buildRules(): CommissionRules {
    const rules: CommissionRules = {};
    if (enableSales) {
      rules.reward_type = rewardType;
      if (rewardType !== 'money') rules.reward_config = rewardConfig;
      rules.ticket = { type: ticketType, value: ticketValue };
      rules.table = { type: tableType, value: tableValue };
      if (useTiers && tiers.length > 0) rules.tiers = tiers;
      if (bonusThreshold > 0) rules.bonus = { threshold: bonusThreshold, bonusAmount };
      if (timeWindows.length > 0) rules.time_windows = timeWindows;
      if (glPerHead > 0) rules.guestlist = { value: glPerHead };
    }
    if (enableClientDiscount) {
      rules.customer_discount = { type: cdType, value: cdValue, appliesTo: cdAppliesTo, label: cdLabel || undefined };
    }
    return rules;
  }

  async function handleSave() {
    if (!sid || !name.trim()) return;
    if (!enableSales && !enableClientDiscount) {
      toast.error(t('owner.promo.enableOneSection'));
      return;
    }
    setSaving(true);
    const rules = buildRules();
    try {
      if (isDefault) await supabase.from('commission_templates').update({ is_default: false }).eq(scopeFilter.column, sid);
      if (editing) {
        await supabase.from('commission_templates').update({ name, rules: rules as any, is_default: isDefault }).eq('id', editing.id);
      } else {
        await supabase.from('commission_templates').insert({ ...scopeFilter.payload, name, rules: rules as any, is_default: isDefault });
      }
      toast.success(t('promoterTemplates.saved'));
      setDialogOpen(false);
      fetchTemplates();
    } catch { toast.error(t('promoterTemplates.saveError')); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteId) return;
    await supabase.from('commission_templates').delete().eq('id', deleteId);
    toast.success(t('promoterTemplates.deleted'));
    setDeleteId(null);
    fetchTemplates();
  }

  function updateTier(idx: number, field: keyof CommissionRuleTier, val: any) {
    setTiers(prev => prev.map((tier, i) => i === idx ? { ...tier, [field]: val } : tier));
  }
  function addTier() {
    const lastMax = tiers.length > 0 ? (tiers[tiers.length - 1].max || 0) + 1 : 0;
    setTiers(prev => [...prev, { ...emptyTier(), min: lastMax }]);
  }
  function removeTier(idx: number) { setTiers(prev => prev.filter((_, i) => i !== idx)); }
  function addWindow() { setTimeWindows(prev => [...prev, { before: '00:30', type: 'fixed', value: 5 }]); }
  function updateWindow(idx: number, field: keyof CommissionTimeWindow, val: any) {
    setTimeWindows(prev => prev.map((w, i) => i === idx ? { ...w, [field]: val } : w));
  }
  function removeWindow(idx: number) { setTimeWindows(prev => prev.filter((_, i) => i !== idx)); }

  // Compact one-line summary of everything a template grants.
  function rulesLabel(rules: CommissionRules): string {
    const parts: string[] = [];
    const s = sectionsOf(rules);
    if (s.sales) {
      if (rules.reward_type && rules.reward_type !== 'money') {
        parts.push(rules.reward_type === 'free_entry' ? t('owner.promo.freeEntry')
          : rules.reward_type === 'vip' ? t('owner.promo.vip') : t('owner.drinks'));
      } else if (rules.tiers && rules.tiers.length > 0) {
        parts.push(t('owner.promo.tierCount').replace('{count}', String(rules.tiers.length)));
      } else if (rules.ticket) {
        parts.push(`${t('owner.promo.sales')} ${rules.ticket.value}${rules.ticket.type === 'percentage' ? '%' : '€'}`);
      } else {
        parts.push(t('owner.promo.sales'));
      }
      if (rules.time_windows && rules.time_windows.length > 0) parts.push(t('owner.promo.timeBased'));
    }
    if (s.clientDiscount && rules.customer_discount) {
      const cd = rules.customer_discount;
      parts.push(`${t('owner.promo.customer')} ${cd.type === 'percentage' ? `-${cd.value}%` : `-${cd.value}€`}`);
    }
    return parts.join(' · ') || t('owner.promo.noRules');
  }

  if (loading) return <OwnerPageSkeleton />;

  return (
    <>
      <PromoHeader
        title={t('promoterTemplates.title')}
        subtitle={t('owner.promo.templatesSubtitle')}
        backTo={`${basePath}/promoters`}
        right={<PromoButton size="sm" onClick={openCreate}><Plus className="h-4 w-4" />{t('promoterTemplates.create')}</PromoButton>}
      />

      <PromoPage maxWidth={640}>
        {templates.length === 0 ? (
          <PromoEmpty
            icon={Gift}
            title={t('promoterTemplates.empty')}
            description={t('owner.promo.templatesEmptyDescription')}
            action={<PromoButton onClick={openCreate}><Plus className="h-4 w-4" />{t('promoterTemplates.create')}</PromoButton>}
          />
        ) : (
          <div className="space-y-2.5">
            {templates.map(tpl => {
              const s = sectionsOf(tpl.rules);
              return (
                <PromoCard key={tpl.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 style={{ color: T1, fontSize: 14.5, fontWeight: 640, margin: 0 }}>{tpl.name}</h3>
                        {tpl.isDefault && <PromoPill tone="red"><span className="inline-flex items-center gap-1"><Star className="h-3 w-3" />{t('promoterTemplates.default')}</span></PromoPill>}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: 6 }}>
                        {s.sales && <PromoPill tone="muted"><span className="inline-flex items-center gap-1"><Euro className="h-3 w-3" />{t('owner.promo.sales')}</span></PromoPill>}
                        {s.clientDiscount && <PromoPill tone="muted"><span className="inline-flex items-center gap-1"><Tag className="h-3 w-3" />{t('owner.promo.perks')}</span></PromoPill>}
                      </div>
                      <p style={{ color: T2, fontSize: 12.5, margin: 0, marginTop: 7 }}>{rulesLabel(tpl.rules)}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => openEdit(tpl)} aria-label={t('owner.edit')} style={{ width: 32, height: 32, borderRadius: 9, background: TILE_BG, border: `1px solid ${F_BORDER}`, color: T2, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => setDeleteId(tpl.id)} aria-label={t('common.delete')} style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,92,99,0.08)', border: '1px solid rgba(255,92,99,0.2)', color: '#FF5C63', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </PromoCard>
              );
            })}
          </div>
        )}
      </PromoPage>

      {/* ── Unified template editor ─────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t('promoterTemplates.edit') : t('promoterTemplates.create')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('promoterTemplates.name')}</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder={t('owner.promo.namePlaceholder')} />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('owner.promo.sectionsIntro')}
            </p>

            {/* SECTION 1 — Sales commission */}
            <SectionCard
              icon={<Euro className="h-4 w-4 text-primary" />}
              title={t('owner.promo.salesCommission')}
              desc={t('owner.promo.salesCommissionDesc')}
              enabled={enableSales} onToggle={setEnableSales}
            >
              <div>
                <Label className="text-xs">{t('owner.promo.rewardType')}</Label>
                <Select value={rewardType} onValueChange={v => setRewardType(v as RewardType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="money"><span className="flex items-center gap-2"><Euro className="h-4 w-4" />{t('owner.promo.money')}</span></SelectItem>
                    <SelectItem value="free_entry"><span className="flex items-center gap-2"><Ticket className="h-4 w-4" />{t('owner.promo.freeEntries')}</span></SelectItem>
                    <SelectItem value="vip"><span className="flex items-center gap-2"><Crown className="h-4 w-4" />{t('owner.promo.vipTableAccess')}</span></SelectItem>
                    <SelectItem value="drinks"><span className="flex items-center gap-2"><Wine className="h-4 w-4" />{t('owner.promo.freeDrinks')}</span></SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {rewardType === 'money' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">{t('owner.promo.perTicket')}</Label>
                      <div className="flex gap-2">
                        <Select value={ticketType} onValueChange={v => setTicketType(v as any)}>
                          <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="percentage">%</SelectItem><SelectItem value="fixed">€</SelectItem></SelectContent>
                        </Select>
                        <Input type="number" value={ticketValue} onChange={e => setTicketValue(Number(e.target.value))} />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">{t('owner.promo.perTable')}</Label>
                      <div className="flex gap-2">
                        <Select value={tableType} onValueChange={v => setTableType(v as any)}>
                          <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="percentage">%</SelectItem><SelectItem value="fixed">€</SelectItem></SelectContent>
                        </Select>
                        <Input type="number" value={tableValue} onChange={e => setTableValue(Number(e.target.value))} />
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{t('owner.promo.fixedAppliesGuestList')}</p>
                </>
              )}

              {rewardType === 'free_entry' && (
                <div>
                  <Label className="text-xs">{t('owner.promo.freeEntriesCount')}</Label>
                  <Input type="number" min={1} value={rewardConfig?.entryCount || 1} onChange={e => setRewardConfig(prev => ({ ...prev, entryCount: parseInt(e.target.value) || 1 }))} />
                </div>
              )}
              {rewardType === 'drinks' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">{t('owner.promo.drinksCount')}</Label>
                    <Input type="number" min={1} value={rewardConfig?.drinkCount || 1} onChange={e => setRewardConfig(prev => ({ ...prev, drinkCount: parseInt(e.target.value) || 1 }))} />
                  </div>
                  <div>
                    <Label className="text-xs">{t('owner.promo.category')}</Label>
                    <Select value={rewardConfig?.drinkCategory || 'all'} onValueChange={v => setRewardConfig(prev => ({ ...prev, drinkCategory: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('owner.promo.all')}</SelectItem>
                        <SelectItem value="drink">{t('owner.drinks')}</SelectItem>
                        <SelectItem value="shot">Shots</SelectItem>
                        <SelectItem value="soft">Softs</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              {rewardType === 'vip' && (
                <div>
                  <Label className="text-xs">{t('owner.promo.vipAccessType')}</Label>
                  <Select value={rewardConfig?.vipType || 'standard'} onValueChange={v => setRewardConfig(prev => ({ ...prev, vipType: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">{t('owner.promo.vipStandard')}</SelectItem>
                      <SelectItem value="table">{t('owner.promo.vipTable')}</SelectItem>
                      <SelectItem value="premium">{t('owner.promo.vipPremium')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {rewardType === 'money' && (
                <>
                  {/* Tiers */}
                  <div className="rounded-lg border p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="flex items-center gap-2 text-xs"><Layers className="h-4 w-4 text-primary" />{t('owner.promo.tiersBySalesCount')}</Label>
                      <Switch checked={useTiers} onCheckedChange={v => { setUseTiers(v); if (v && tiers.length === 0) addTier(); }} />
                    </div>
                    {useTiers && (
                      <div className="space-y-2">
                        {tiers.map((tier, i) => (
                          <div key={i} className="rounded-lg bg-muted/30 p-2 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-muted-foreground">{t('owner.promo.tier')} {i + 1}</span>
                              <button className="text-destructive" onClick={() => removeTier(i)}><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div><Label className="text-[11px]">{t('owner.promo.minSales')}</Label><Input type="number" min={0} value={tier.min} onChange={e => updateTier(i, 'min', parseInt(e.target.value) || 0)} /></div>
                              <div><Label className="text-[11px]">{t('owner.promo.maxEmptyInfinity')}</Label><Input type="number" min={0} value={tier.max ?? ''} onChange={e => updateTier(i, 'max', e.target.value ? parseInt(e.target.value) : null)} /></div>
                            </div>
                            <div>
                              <Label className="text-[11px]">{t('owner.promo.eurPerTicketTier')}</Label>
                              <Input type="number" min={0} value={tier.ticketValue || 0} onChange={e => setTiers(prev => prev.map((tr, idx) => idx === i ? { ...tr, reward_type: 'money', ticketValue: parseFloat(e.target.value) || 0 } : tr))} />
                            </div>
                          </div>
                        ))}
                        <Button onClick={addTier} variant="outline" size="sm" className="w-full"><Plus className="h-3 w-3 mr-1" />{t('owner.promo.addTier')}</Button>
                      </div>
                    )}
                  </div>

                  {/* Time windows */}
                  <div className="rounded-lg border p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="flex items-center gap-2 text-xs"><Percent className="h-4 w-4 text-primary" />{t('owner.promo.commissionByTimeWindow')}</Label>
                      <Button variant="outline" size="sm" onClick={addWindow}><Plus className="h-3 w-3 mr-1" />{t('owner.promo.add')}</Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{t('owner.promo.timeWindowExample')}</p>
                    {timeWindows.map((w, i) => (
                      <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end rounded-lg bg-muted/30 p-2">
                        <div><Label className="text-[11px]">{t('owner.promo.before')}</Label><Input type="time" value={w.before} onChange={e => updateWindow(i, 'before', e.target.value)} /></div>
                        <div><Label className="text-[11px]">{t('owner.promo.type')}</Label>
                          <Select value={w.type} onValueChange={v => updateWindow(i, 'type', v)}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fixed">€</SelectItem><SelectItem value="percentage">%</SelectItem></SelectContent></Select>
                        </div>
                        <div><Label className="text-[11px]">{t('owner.promo.value')}</Label><Input type="number" min={0} value={w.value} onChange={e => updateWindow(i, 'value', parseFloat(e.target.value) || 0)} /></div>
                        <button className="text-destructive h-9 flex items-center" onClick={() => removeWindow(i)}><Trash2 className="h-4 w-4" /></button>
                      </div>
                    ))}
                  </div>

                  {/* Guest list — forfait par tete */}
                  <div className="rounded-lg border p-3 space-y-2">
                    <Label className="text-xs font-medium">{t('owner.promo.guestlistPerHead')}</Label>
                    <p className="text-[11px] text-muted-foreground">{t('owner.promo.guestlistPerHeadDesc')}</p>
                    <Input type="number" min={0} step="0.5" value={glPerHead}
                      onChange={e => setGlPerHead(parseFloat(e.target.value) || 0)} />
                  </div>

                  {/* Bonus */}
                  <div className="rounded-lg border p-3 space-y-2">
                    <Label className="text-xs font-medium">{t('owner.promo.performanceBonus')}</Label>
                    <p className="text-[11px] text-muted-foreground">{t('owner.promo.bonusDesc')}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div><Label className="text-[11px]">{t('owner.promo.thresholdSales')}</Label><Input type="number" min={0} value={bonusThreshold} onChange={e => setBonusThreshold(parseInt(e.target.value) || 0)} /></div>
                      <div><Label className="text-[11px]">{t('owner.promo.amountEur')}</Label><Input type="number" min={0} value={bonusAmount} onChange={e => setBonusAmount(parseInt(e.target.value) || 0)} /></div>
                    </div>
                  </div>
                </>
              )}
            </SectionCard>

            {/* Guest-list config moved to the Guest List page (promoter parts). */}

            {/* SECTION 2 — Customer perks */}
            <SectionCard
              icon={<Tag className="h-4 w-4 text-primary" />}
              title={t('owner.promo.customerPerks')}
              desc={t('owner.promo.customerPerksDesc')}
              enabled={enableClientDiscount} onToggle={setEnableClientDiscount}
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{t('owner.promo.type')}</Label>
                  <Select value={cdType} onValueChange={v => setCdType(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="percentage">{t('owner.promo.percentage')}</SelectItem><SelectItem value="fixed">{t('owner.promo.fixedAmount')}</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">{t('owner.promo.value')}</Label><Input type="number" min={0} value={cdValue} onChange={e => setCdValue(Number(e.target.value))} /></div>
              </div>
              <div>
                <Label className="text-xs">{t('owner.promo.appliesTo')}</Label>
                <Select value={cdAppliesTo} onValueChange={v => setCdAppliesTo(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">{t('owner.promo.ticketsAndDrinks')}</SelectItem>
                    <SelectItem value="tickets">{t('owner.promo.tickets')}</SelectItem>
                    <SelectItem value="drinks">{t('owner.drinks')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">{t('owner.promo.labelOptional')}</Label><Input value={cdLabel} onChange={e => setCdLabel(e.target.value)} placeholder={t('owner.promo.labelPlaceholder')} /></div>
              <div className="rounded-lg bg-muted/40 p-2 text-center">
                <p className="text-lg font-bold text-primary">{cdType === 'percentage' ? `-${cdValue}%` : `-${cdValue}€`}</p>
              </div>
            </SectionCard>

            <div className="flex items-center justify-between pt-1">
              <Label>{t('promoterTemplates.setDefault')}</Label>
              <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            </div>
          </div>
          <DialogFooter>
            <PromoButton variant="secondary" onClick={() => setDialogOpen(false)}>{t('common.cancel')}</PromoButton>
            <PromoButton onClick={handleSave} disabled={saving || !name.trim()}>{saving ? '...' : t('common.save')}</PromoButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('promoterTemplates.deleteConfirm')}</AlertDialogTitle>
            <AlertDialogDescription>{t('promoterTemplates.deleteDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">{t('common.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Collapsible section with a header toggle — the backbone of the unified form.
function SectionCard({
  icon, title, desc, enabled, onToggle, children,
}: { icon: React.ReactNode; title: string; desc: string; enabled: boolean; onToggle: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border" style={{ borderColor: enabled ? 'rgba(232,25,44,0.3)' : undefined }}>
      <label className="flex items-center gap-3 p-3 cursor-pointer">
        <div className="flex items-center justify-center rounded-lg" style={{ width: 34, height: 34, background: 'rgba(232,25,44,0.08)' }}>{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} />
      </label>
      {enabled && <div className="space-y-3 px-3 pb-3 pt-1 border-t">{children}</div>}
    </div>
  );
}
