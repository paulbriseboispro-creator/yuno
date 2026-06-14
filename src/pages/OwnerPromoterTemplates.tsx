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
    guestList: !!rules.guest_list,
    clientDiscount: !!rules.customer_discount,
  };
}

export default function OwnerPromoterTemplates() {
  const scope = usePromoterScope();
  const sid = scopeId(scope);
  const scopeFilter = getScopeFilter(scope);
  const { basePath } = useDashboardMode();
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string) => (language === 'fr' ? fr : en);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Common
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  // Section toggles
  const [enableSales, setEnableSales] = useState(true);
  const [enableGuestList, setEnableGuestList] = useState(false);
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

  // Guest-list state
  const [glNormalQuota, setGlNormalQuota] = useState(20);
  const [glTableQuota, setGlTableQuota] = useState(0);
  const [glDrinkQuota, setGlDrinkQuota] = useState(0);
  const [glVipAccess, setGlVipAccess] = useState(false);
  const [glDrinkCount, setGlDrinkCount] = useState(1);
  const [glEntryDeadline, setGlEntryDeadline] = useState('');

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

  function resetForm() {
    setName(''); setIsDefault(false);
    setEnableSales(true); setEnableGuestList(false); setEnableClientDiscount(false);
    setRewardType('money'); setTicketType('percentage'); setTicketValue(10);
    setTableType('percentage'); setTableValue(10); setRewardConfig({});
    setUseTiers(false); setTiers([]); setBonusThreshold(0); setBonusAmount(0); setTimeWindows([]);
    setGlNormalQuota(20); setGlTableQuota(0); setGlDrinkQuota(0);
    setGlVipAccess(false); setGlDrinkCount(1); setGlEntryDeadline('');
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
    setEnableSales(s.sales); setEnableGuestList(s.guestList); setEnableClientDiscount(s.clientDiscount);

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
    }
    if (s.guestList && r.guest_list) {
      const gl = r.guest_list;
      setGlNormalQuota(gl.normalQuota ?? gl.quota ?? 20);
      setGlTableQuota(gl.tableQuota ?? 0);
      setGlDrinkQuota(gl.drinkQuota ?? 0);
      setGlVipAccess(gl.vipAccess ?? false);
      setGlDrinkCount(gl.drinkCount ?? 1);
      setGlEntryDeadline(gl.entryDeadline ?? '');
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
    }
    if (enableGuestList) {
      rules.guest_list = {
        quota: glNormalQuota + glTableQuota + glDrinkQuota,
        normalQuota: glNormalQuota, tableQuota: glTableQuota, drinkQuota: glDrinkQuota,
        vipAccess: glVipAccess, includesDrink: glDrinkQuota > 0, drinkCount: glDrinkCount,
        entryDeadline: glEntryDeadline || undefined,
      };
    }
    if (enableClientDiscount) {
      rules.customer_discount = { type: cdType, value: cdValue, appliesTo: cdAppliesTo, label: cdLabel || undefined };
    }
    return rules;
  }

  async function handleSave() {
    if (!sid || !name.trim()) return;
    if (!enableSales && !enableGuestList && !enableClientDiscount) {
      toast.error(tt('Activez au moins une section.', 'Enable at least one section.'));
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
        parts.push(rules.reward_type === 'free_entry' ? tt('Entrée gratuite', 'Free entry')
          : rules.reward_type === 'vip' ? tt('VIP', 'VIP') : tt('Boissons', 'Drinks'));
      } else if (rules.tiers && rules.tiers.length > 0) {
        parts.push(tt(`${rules.tiers.length} palier(s)`, `${rules.tiers.length} tier(s)`));
      } else if (rules.ticket) {
        parts.push(`${tt('Ventes', 'Sales')} ${rules.ticket.value}${rules.ticket.type === 'percentage' ? '%' : '€'}`);
      } else {
        parts.push(tt('Ventes', 'Sales'));
      }
      if (rules.time_windows && rules.time_windows.length > 0) parts.push(tt('horaires', 'time-based'));
    }
    if (s.guestList && rules.guest_list) {
      const gl = rules.guest_list;
      parts.push(`${tt('Guest list', 'Guest list')} ${(gl.normalQuota ?? gl.quota ?? 0) + (gl.tableQuota ?? 0) + (gl.drinkQuota ?? 0)}`);
    }
    if (s.clientDiscount && rules.customer_discount) {
      const cd = rules.customer_discount;
      parts.push(`${tt('Client', 'Customer')} ${cd.type === 'percentage' ? `-${cd.value}%` : `-${cd.value}€`}`);
    }
    return parts.join(' · ') || tt('Aucune règle', 'No rules');
  }

  if (loading) return <OwnerPageSkeleton />;

  return (
    <>
      <PromoHeader
        title={t('promoterTemplates.title')}
        subtitle={tt('Un modèle = ventes + guest list + avantages, en un seul endroit', 'One template = sales + guest list + perks, all in one place')}
        backTo={`${basePath}/promoters`}
        right={<PromoButton size="sm" onClick={openCreate}><Plus className="h-4 w-4" />{t('promoterTemplates.create')}</PromoButton>}
      />

      <PromoPage maxWidth={640}>
        {templates.length === 0 ? (
          <PromoEmpty
            icon={Gift}
            title={t('promoterTemplates.empty')}
            description={tt('Créez un modèle de rémunération à appliquer à vos promoteurs : commission sur ventes, quotas de guest list et avantages clients.', "Create a compensation template for your promoters: sales commission, guest-list quotas and customer perks.")}
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
                        {s.sales && <PromoPill tone="muted"><span className="inline-flex items-center gap-1"><Euro className="h-3 w-3" />{tt('Ventes', 'Sales')}</span></PromoPill>}
                        {s.guestList && <PromoPill tone="muted"><span className="inline-flex items-center gap-1"><UserPlus className="h-3 w-3" />{tt('Guest list', 'Guest list')}</span></PromoPill>}
                        {s.clientDiscount && <PromoPill tone="muted"><span className="inline-flex items-center gap-1"><Tag className="h-3 w-3" />{tt('Avantages', 'Perks')}</span></PromoPill>}
                      </div>
                      <p style={{ color: T2, fontSize: 12.5, margin: 0, marginTop: 7 }}>{rulesLabel(tpl.rules)}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => openEdit(tpl)} aria-label={tt('Modifier', 'Edit')} style={{ width: 32, height: 32, borderRadius: 9, background: TILE_BG, border: `1px solid ${F_BORDER}`, color: T2, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => setDeleteId(tpl.id)} aria-label={tt('Supprimer', 'Delete')} style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,92,99,0.08)', border: '1px solid rgba(255,92,99,0.2)', color: '#FF5C63', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
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
              <Input value={name} onChange={e => setName(e.target.value)} placeholder={tt('ex : Standard, VIP, Agence A…', 'e.g. Standard, VIP, Agency A…')} />
            </div>
            <p className="text-xs text-muted-foreground">
              {tt('Activez les sections dont ce promoteur a besoin. Un seul modèle peut tout couvrir.', 'Turn on the sections this promoter needs. A single template can cover everything.')}
            </p>

            {/* SECTION 1 — Sales commission */}
            <SectionCard
              icon={<Euro className="h-4 w-4 text-primary" />}
              title={tt('Commission sur les ventes', 'Sales commission')}
              desc={tt('Ce que le promoteur gagne par billet / table.', 'What the promoter earns per ticket / table.')}
              enabled={enableSales} onToggle={setEnableSales}
            >
              <div>
                <Label className="text-xs">{tt('Type de récompense', 'Reward type')}</Label>
                <Select value={rewardType} onValueChange={v => setRewardType(v as RewardType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="money"><span className="flex items-center gap-2"><Euro className="h-4 w-4" />{tt('Argent', 'Money')}</span></SelectItem>
                    <SelectItem value="free_entry"><span className="flex items-center gap-2"><Ticket className="h-4 w-4" />{tt('Entrées gratuites', 'Free entries')}</span></SelectItem>
                    <SelectItem value="vip"><span className="flex items-center gap-2"><Crown className="h-4 w-4" />{tt('Accès VIP / Table', 'VIP / Table access')}</span></SelectItem>
                    <SelectItem value="drinks"><span className="flex items-center gap-2"><Wine className="h-4 w-4" />{tt('Boissons offertes', 'Free drinks')}</span></SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {rewardType === 'money' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">{tt('Par billet', 'Per ticket')}</Label>
                      <div className="flex gap-2">
                        <Select value={ticketType} onValueChange={v => setTicketType(v as any)}>
                          <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="percentage">%</SelectItem><SelectItem value="fixed">€</SelectItem></SelectContent>
                        </Select>
                        <Input type="number" value={ticketValue} onChange={e => setTicketValue(Number(e.target.value))} />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">{tt('Par table', 'Per table')}</Label>
                      <div className="flex gap-2">
                        <Select value={tableType} onValueChange={v => setTableType(v as any)}>
                          <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="percentage">%</SelectItem><SelectItem value="fixed">€</SelectItem></SelectContent>
                        </Select>
                        <Input type="number" value={tableValue} onChange={e => setTableValue(Number(e.target.value))} />
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{tt('En fixe (€), la commission s\'applique aussi aux entrées guest list validées au scan.', 'With a fixed (€) amount, the commission also applies to guest-list entries validated at the door.')}</p>
                </>
              )}

              {rewardType === 'free_entry' && (
                <div>
                  <Label className="text-xs">{tt("Nombre d'entrées gratuites", 'Number of free entries')}</Label>
                  <Input type="number" min={1} value={rewardConfig?.entryCount || 1} onChange={e => setRewardConfig(prev => ({ ...prev, entryCount: parseInt(e.target.value) || 1 }))} />
                </div>
              )}
              {rewardType === 'drinks' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">{tt('Nombre de boissons', 'Number of drinks')}</Label>
                    <Input type="number" min={1} value={rewardConfig?.drinkCount || 1} onChange={e => setRewardConfig(prev => ({ ...prev, drinkCount: parseInt(e.target.value) || 1 }))} />
                  </div>
                  <div>
                    <Label className="text-xs">{tt('Catégorie', 'Category')}</Label>
                    <Select value={rewardConfig?.drinkCategory || 'all'} onValueChange={v => setRewardConfig(prev => ({ ...prev, drinkCategory: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{tt('Toutes', 'All')}</SelectItem>
                        <SelectItem value="drink">{tt('Boissons', 'Drinks')}</SelectItem>
                        <SelectItem value="shot">Shots</SelectItem>
                        <SelectItem value="soft">Softs</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              {rewardType === 'vip' && (
                <div>
                  <Label className="text-xs">{tt("Type d'accès VIP", 'VIP access type')}</Label>
                  <Select value={rewardConfig?.vipType || 'standard'} onValueChange={v => setRewardConfig(prev => ({ ...prev, vipType: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">{tt('Accès VIP standard', 'Standard VIP access')}</SelectItem>
                      <SelectItem value="table">{tt('Table VIP', 'VIP table')}</SelectItem>
                      <SelectItem value="premium">{tt('Table Premium', 'Premium table')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {rewardType === 'money' && (
                <>
                  {/* Tiers */}
                  <div className="rounded-lg border p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="flex items-center gap-2 text-xs"><Layers className="h-4 w-4 text-primary" />{tt('Paliers par nombre de ventes', 'Tiers by sales count')}</Label>
                      <Switch checked={useTiers} onCheckedChange={v => { setUseTiers(v); if (v && tiers.length === 0) addTier(); }} />
                    </div>
                    {useTiers && (
                      <div className="space-y-2">
                        {tiers.map((tier, i) => (
                          <div key={i} className="rounded-lg bg-muted/30 p-2 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-muted-foreground">{tt('Palier', 'Tier')} {i + 1}</span>
                              <button className="text-destructive" onClick={() => removeTier(i)}><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div><Label className="text-[11px]">{tt('Min ventes', 'Min sales')}</Label><Input type="number" min={0} value={tier.min} onChange={e => updateTier(i, 'min', parseInt(e.target.value) || 0)} /></div>
                              <div><Label className="text-[11px]">{tt('Max (vide = ∞)', 'Max (empty = ∞)')}</Label><Input type="number" min={0} value={tier.max ?? ''} onChange={e => updateTier(i, 'max', e.target.value ? parseInt(e.target.value) : null)} /></div>
                            </div>
                            <div>
                              <Label className="text-[11px]">{tt('€ par billet à ce palier', '€ per ticket at this tier')}</Label>
                              <Input type="number" min={0} value={tier.ticketValue || 0} onChange={e => setTiers(prev => prev.map((tr, idx) => idx === i ? { ...tr, reward_type: 'money', ticketValue: parseFloat(e.target.value) || 0 } : tr))} />
                            </div>
                          </div>
                        ))}
                        <Button onClick={addTier} variant="outline" size="sm" className="w-full"><Plus className="h-3 w-3 mr-1" />{tt('Ajouter un palier', 'Add a tier')}</Button>
                      </div>
                    )}
                  </div>

                  {/* Time windows */}
                  <div className="rounded-lg border p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="flex items-center gap-2 text-xs"><Percent className="h-4 w-4 text-primary" />{tt('Commission par tranche horaire', 'Commission by time window')}</Label>
                      <Button variant="outline" size="sm" onClick={addWindow}><Plus className="h-3 w-3 mr-1" />{tt('Ajouter', 'Add')}</Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{tt('Ex : 5€ avant 00h30, puis 2€. L\'heure du scan fait foi.', 'e.g. 5€ before 00:30, then 2€. The scan time is authoritative.')}</p>
                    {timeWindows.map((w, i) => (
                      <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end rounded-lg bg-muted/30 p-2">
                        <div><Label className="text-[11px]">{tt('Avant', 'Before')}</Label><Input type="time" value={w.before} onChange={e => updateWindow(i, 'before', e.target.value)} /></div>
                        <div><Label className="text-[11px]">Type</Label>
                          <Select value={w.type} onValueChange={v => updateWindow(i, 'type', v)}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fixed">€</SelectItem><SelectItem value="percentage">%</SelectItem></SelectContent></Select>
                        </div>
                        <div><Label className="text-[11px]">{tt('Valeur', 'Value')}</Label><Input type="number" min={0} value={w.value} onChange={e => updateWindow(i, 'value', parseFloat(e.target.value) || 0)} /></div>
                        <button className="text-destructive h-9 flex items-center" onClick={() => removeWindow(i)}><Trash2 className="h-4 w-4" /></button>
                      </div>
                    ))}
                  </div>

                  {/* Bonus */}
                  <div className="rounded-lg border p-3 space-y-2">
                    <Label className="text-xs font-medium">{tt('Bonus performance', 'Performance bonus')}</Label>
                    <p className="text-[11px] text-muted-foreground">{tt('Bonus unique au-delà d\'un seuil de ventes.', 'One-off bonus past a sales threshold.')}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div><Label className="text-[11px]">{tt('Seuil (ventes)', 'Threshold (sales)')}</Label><Input type="number" min={0} value={bonusThreshold} onChange={e => setBonusThreshold(parseInt(e.target.value) || 0)} /></div>
                      <div><Label className="text-[11px]">{tt('Montant (€)', 'Amount (€)')}</Label><Input type="number" min={0} value={bonusAmount} onChange={e => setBonusAmount(parseInt(e.target.value) || 0)} /></div>
                    </div>
                  </div>
                </>
              )}
            </SectionCard>

            {/* SECTION 2 — Guest list */}
            <SectionCard
              icon={<UserPlus className="h-4 w-4 text-primary" />}
              title={tt('Guest list', 'Guest list')}
              desc={tt('Combien d\'invités ce promoteur peut placer.', 'How many guests this promoter can place.')}
              enabled={enableGuestList} onToggle={setEnableGuestList}
            >
              <div className="grid grid-cols-3 gap-2">
                <div><Label className="text-[11px]">{tt('Entrées', 'Entries')}</Label><Input type="number" min={0} value={glNormalQuota} onChange={e => setGlNormalQuota(parseInt(e.target.value) || 0)} /></div>
                <div><Label className="text-[11px]">{tt('Tables', 'Tables')}</Label><Input type="number" min={0} value={glTableQuota} onChange={e => setGlTableQuota(parseInt(e.target.value) || 0)} /></div>
                <div><Label className="text-[11px]">{tt('Avec boisson', 'With drink')}</Label><Input type="number" min={0} value={glDrinkQuota} onChange={e => setGlDrinkQuota(parseInt(e.target.value) || 0)} /></div>
              </div>
              {glDrinkQuota > 0 && (
                <div><Label className="text-[11px]">{tt('Boissons par personne', 'Drinks per guest')}</Label><Input type="number" min={1} value={glDrinkCount} onChange={e => setGlDrinkCount(parseInt(e.target.value) || 1)} /></div>
              )}
              <div className="flex items-center justify-between">
                <Label className="text-xs">{tt('Accès VIP inclus', 'VIP access included')}</Label>
                <Switch checked={glVipAccess} onCheckedChange={setGlVipAccess} />
              </div>
              <div>
                <Label className="text-[11px]">{tt("Heure limite d'entrée", 'Entry cutoff time')}</Label>
                <Input type="time" value={glEntryDeadline} onChange={e => setGlEntryDeadline(e.target.value)} className="w-40" />
              </div>
              <div className="rounded-lg bg-muted/40 p-2 text-xs text-muted-foreground">
                {tt('Total', 'Total')} : {glNormalQuota + glTableQuota + glDrinkQuota} {tt('invitations', 'invites')}
              </div>
            </SectionCard>

            {/* SECTION 3 — Customer perks */}
            <SectionCard
              icon={<Tag className="h-4 w-4 text-primary" />}
              title={tt('Avantages clients', 'Customer perks')}
              desc={tt('Réduction pour les clients qui passent par son lien.', 'Discount for customers who use their link.')}
              enabled={enableClientDiscount} onToggle={setEnableClientDiscount}
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{tt('Type', 'Type')}</Label>
                  <Select value={cdType} onValueChange={v => setCdType(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="percentage">{tt('Pourcentage (%)', 'Percentage (%)')}</SelectItem><SelectItem value="fixed">{tt('Montant fixe (€)', 'Fixed amount (€)')}</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">{tt('Valeur', 'Value')}</Label><Input type="number" min={0} value={cdValue} onChange={e => setCdValue(Number(e.target.value))} /></div>
              </div>
              <div>
                <Label className="text-xs">{tt("S'applique sur", 'Applies to')}</Label>
                <Select value={cdAppliesTo} onValueChange={v => setCdAppliesTo(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">{tt('Billets et boissons', 'Tickets & drinks')}</SelectItem>
                    <SelectItem value="tickets">{tt('Billets', 'Tickets')}</SelectItem>
                    <SelectItem value="drinks">{tt('Boissons', 'Drinks')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">{tt('Label (optionnel)', 'Label (optional)')}</Label><Input value={cdLabel} onChange={e => setCdLabel(e.target.value)} placeholder={tt('ex : -10% avec PAUL', 'e.g. -10% with PAUL')} /></div>
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
