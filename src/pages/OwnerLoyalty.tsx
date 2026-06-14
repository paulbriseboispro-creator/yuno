import { useState, useMemo, useEffect } from 'react';
import type { Json } from '@/integrations/supabase/types';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, Gift, Users, TrendingUp, Settings, Plus, Edit2, Trash2,
  Crown, Star, Wine, Ticket, X, Check, Target,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { TierBadge } from '@/components/loyalty/TierBadge';
import { OwnerLeaderboardSection } from '@/components/owner/OwnerLeaderboardSection';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useLoyaltyManagement } from '@/hooks/useLoyalty';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';

// ─── Yuno Design Tokens ──────────────────────────────────────────────────────
const RED         = '#E8192C';
const POS         = '#34D399';
const T1          = 'rgba(255,255,255,0.96)';
const T2          = 'rgba(255,255,255,0.58)';
const T3          = 'rgba(255,255,255,0.36)';
const BORDER      = 'rgba(255,255,255,0.085)';
const F_BORDER    = 'rgba(255,255,255,0.055)';
const INNER_BG    = 'rgba(255,255,255,0.032)';
const TILE_BG     = 'rgba(255,255,255,0.025)';
const CARD_BG     = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const TIER_COLORS = { bronze: '#CD7F32', silver: '#C0C0C0', gold: '#FFD700', platinum: '#E5E4E2' };

const REWARD_TYPES = [
  { value: 'free_drink',  label: { en: 'Free Drink',  fr: 'Boisson Gratuite', es: 'Bebida Gratis'  }, Icon: Wine   },
  { value: 'free_ticket', label: { en: 'Free Ticket', fr: 'Ticket Gratuit',   es: 'Entrada Gratis' }, Icon: Ticket },
  { value: 'discount',    label: { en: 'Discount',    fr: 'Réduction',        es: 'Descuento'      }, Icon: Star   },
];

// ─── Micro-components ─────────────────────────────────────────────────────────
function YunoSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 44, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer',
        background: checked ? RED : 'rgba(255,255,255,0.14)',
        position: 'relative', transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: checked ? 21 : 3,
        width: 20, height: 20, borderRadius: '50%', background: '#fff',
        transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
      }} />
    </button>
  );
}

function YunoSlider({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <input
      type="range"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={e => onChange(Number(e.target.value))}
      className="w-full"
      style={{ accentColor: RED, height: 4, cursor: 'pointer' }}
    />
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        padding: '6px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
        border: `1px solid ${active ? RED : BORDER}`,
        background: active ? 'rgba(232,25,44,0.14)' : TILE_BG,
        color: active ? '#ff4d5a' : T2,
        transition: 'all 0.15s',
      }}>
      {label}
    </button>
  );
}

export default function OwnerLoyalty() {
  const { t, language } = useLanguage();
  const { venueId, loading: venueLoading } = useVenueContext();
  const { loading, settings, rewards, stats, updateSettings, createReward, updateReward, deleteReward } = useLoyaltyManagement(venueId || undefined);

  const [activeTab, setActiveTab] = useState<'loyalty' | 'leaderboard'>('loyalty');
  const [showRewardDialog, setShowRewardDialog] = useState(false);
  const [editingReward, setEditingReward] = useState<typeof rewards[0] | null>(null);
  const [deleteRewardId, setDeleteRewardId] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const [rewardForm, setRewardForm] = useState({
    name: '', description: '', points_required: 100, reward_type: 'free_drink',
    allowed_categories: [] as string[],
    max_ticket_value: '' as string | number,
    discount_type: 'percentage' as 'percentage' | 'fixed',
    discount_value: 10,
    max_cart_value: '' as string | number,
    applies_to: 'all' as 'drinks' | 'tickets' | 'all',
  });

  const [localSettings, setLocalSettings] = useState({
    is_enabled: settings?.is_enabled ?? false,
    points_per_euro: settings?.points_per_euro ?? 1,
    welcome_bonus: settings?.welcome_bonus ?? 0,
    post_visit_notification: settings?.post_visit_notification ?? true,
  });

  useEffect(() => {
    if (settings) {
      setLocalSettings({
        is_enabled: settings.is_enabled,
        points_per_euro: settings.points_per_euro,
        welcome_bonus: settings.welcome_bonus,
        post_visit_notification: settings.post_visit_notification,
      });
    }
  }, [settings]);

  const tierChartData = useMemo(() => [
    { name: 'Bronze',   value: stats.tierDistribution.bronze,   color: TIER_COLORS.bronze   },
    { name: 'Silver',   value: stats.tierDistribution.silver,   color: TIER_COLORS.silver   },
    { name: 'Gold',     value: stats.tierDistribution.gold,     color: TIER_COLORS.gold     },
    { name: 'Platinum', value: stats.tierDistribution.platinum, color: TIER_COLORS.platinum },
  ].filter(d => d.value > 0), [stats.tierDistribution]);

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    const result = await updateSettings(localSettings);
    if (result.success) toast.success(t('loyalty.savedSuccess'));
    setSavingSettings(false);
  };

  const handleToggleLoyalty = async (enabled: boolean) => {
    setLocalSettings(prev => ({ ...prev, is_enabled: enabled }));
    await updateSettings({ is_enabled: enabled });
    toast.success(t('loyalty.savedSuccess'));
  };

  const handleOpenRewardDialog = (reward?: typeof rewards[0]) => {
    if (reward) {
      setEditingReward(reward);
      const rv = reward.reward_value as { allowed_categories?: string[]; max_ticket_value?: number; discount_type?: 'percentage' | 'fixed'; discount_value?: number; max_cart_value?: number; applies_to?: 'drinks' | 'tickets' | 'all' } | null;
      setRewardForm({
        name: reward.name, description: reward.description || '',
        points_required: reward.points_required, reward_type: reward.reward_type,
        allowed_categories: rv?.allowed_categories || [],
        max_ticket_value: rv?.max_ticket_value || '',
        discount_type: rv?.discount_type || 'percentage',
        discount_value: rv?.discount_value || 10,
        max_cart_value: rv?.max_cart_value || '',
        applies_to: rv?.applies_to || 'all',
      });
    } else {
      setEditingReward(null);
      setRewardForm({ name: '', description: '', points_required: 100, reward_type: 'free_drink', allowed_categories: [], max_ticket_value: '', discount_type: 'percentage', discount_value: 10, max_cart_value: '', applies_to: 'all' });
    }
    setShowRewardDialog(true);
  };

  const handleSaveReward = async () => {
    if (!rewardForm.name.trim()) return;
    let rewardValue: Record<string, unknown> = {};
    if (rewardForm.reward_type === 'free_drink' && rewardForm.allowed_categories.length > 0) {
      rewardValue = { allowed_categories: rewardForm.allowed_categories };
    } else if (rewardForm.reward_type === 'free_ticket' && rewardForm.max_ticket_value) {
      rewardValue = { max_ticket_value: Number(rewardForm.max_ticket_value) };
    } else if (rewardForm.reward_type === 'discount') {
      rewardValue = { discount_type: rewardForm.discount_type, discount_value: rewardForm.discount_value, applies_to: rewardForm.applies_to };
      if (rewardForm.max_cart_value) rewardValue.max_cart_value = Number(rewardForm.max_cart_value);
    }
    const payload = { name: rewardForm.name, description: rewardForm.description || null, points_required: rewardForm.points_required, reward_type: rewardForm.reward_type, reward_value: rewardValue as Json };
    if (editingReward) {
      const result = await updateReward(editingReward.id, payload);
      if (result.success) toast.success(t('loyalty.rewardUpdated'));
    } else {
      const result = await createReward(payload);
      if (result.success) toast.success(t('loyalty.rewardCreated'));
    }
    setShowRewardDialog(false);
  };

  const handleDeleteReward = async () => {
    if (!deleteRewardId) return;
    const result = await deleteReward(deleteRewardId);
    if (result.success) toast.success(t('loyalty.rewardDeleted'));
    setDeleteRewardId(null);
  };

  const redemptionRate = stats.totalPointsIssued > 0
    ? ((stats.totalPointsRedeemed / stats.totalPointsIssued) * 100).toFixed(1)
    : '0';

  if (loading || venueLoading) return <OwnerPageSkeleton />;

  if (!venueId) return (
    <div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
      <p style={{ color: T3 }}>No venue assigned</p>
    </div>
  );

  const tabs: { key: 'loyalty' | 'leaderboard'; label: string; Icon: typeof Gift }[] = [
    { key: 'loyalty',     label: t('owner.loy.loyalty'),     Icon: Gift  },
    { key: 'leaderboard', label: t('owner.loy.leaderboard'), Icon: Crown },
  ];

  return (
    <div className="min-h-screen pb-24" style={{ background: '#000' }}>
      <OwnerHeader title={t('loyalty.title')} showBackButton backTo="/owner" />

      <div className="mx-auto max-w-4xl p-4">

        {/* Custom Tabs */}
        <div className="flex mb-6" style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, borderRadius: 12, padding: 4 }}>
          {tabs.map(tab => (
            <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)}
              className="relative flex-1 flex items-center justify-center gap-2 cursor-pointer"
              style={{ padding: '8px 12px', borderRadius: 9, background: 'none', border: 'none', fontSize: 13.5, fontWeight: 600, color: activeTab === tab.key ? T1 : T3, transition: 'color 0.2s', zIndex: 1 }}
            >
              {activeTab === tab.key && (
                <motion.span className="absolute inset-0 rounded-[9px]"
                  layoutId="loyaltyTab"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}`, zIndex: -1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                />
              )}
              <tab.Icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'loyalty' && (
            <motion.div key="loyalty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">

              {/* Enable Toggle */}
              <div style={{ background: 'linear-gradient(135deg,rgba(232,25,44,0.10),rgba(232,25,44,0.03)),#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'rgba(232,25,44,0.14)' }}>
                      <Sparkles className="h-6 w-6" style={{ color: RED }} />
                    </div>
                    <div>
                      <p style={{ color: T1, fontSize: 14, fontWeight: 600, margin: 0 }}>{t('loyalty.enableLoyalty')}</p>
                      <p style={{ color: T3, fontSize: 12, margin: 0 }}>
                        {localSettings.is_enabled ? `${stats.activeCustomers} ${t('loyalty.activeMembers').toLowerCase()}` : t('loyalty.enableToStart')}
                      </p>
                    </div>
                  </div>
                  <YunoSwitch checked={localSettings.is_enabled} onChange={handleToggleLoyalty} />
                </div>
              </div>

              {localSettings.is_enabled && (
                <>
                  {/* Stats */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { value: stats.activeCustomers,                    label: t('loyalty.activeMembers')        },
                      { value: stats.totalPointsIssued.toLocaleString(), label: t('loyalty.totalPointsIssued')    },
                      { value: stats.totalRedemptions,                   label: t('loyalty.totalRedemptions')     },
                      { value: `${redemptionRate}%`,                     label: t('owner.loy.redemptionRate') },
                    ].map((s, i) => (
                      <div key={i} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, boxShadow: CARD_SHADOW, padding: '14px', textAlign: 'center' }}>
                        <p style={{ color: RED, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>{s.value}</p>
                        <p style={{ color: T3, fontSize: 10.5, margin: 0 }}>{s.label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Tier Distribution */}
                  {tierChartData.length > 0 && (
                    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px' }}>
                      <h3 className="flex items-center gap-2 mb-4" style={{ color: T1, fontSize: 14, fontWeight: 600, margin: 0, marginBottom: 16 }}>
                        <Crown className="h-4 w-4" style={{ color: RED }} />
                        {t('loyalty.tierDistribution')}
                      </h3>
                      <div className="flex flex-col sm:flex-row items-center gap-6">
                        <div style={{ width: 160, height: 160, flexShrink: 0 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie data={tierChartData} cx="50%" cy="50%" innerRadius={36} outerRadius={64} paddingAngle={2} dataKey="value">
                                {tierChartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                              </Pie>
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="flex-1 grid grid-cols-2 gap-2 w-full">
                          {(['bronze', 'silver', 'gold', 'platinum'] as const).map(tier => (
                            <div key={tier} className="flex items-center justify-between" style={{ padding: '10px 12px', borderRadius: 10, background: TILE_BG, border: `1px solid ${F_BORDER}` }}>
                              <TierBadge tier={tier} size="sm" />
                              <span style={{ color: T1, fontSize: 14, fontWeight: 700 }}>{stats.tierDistribution[tier]}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Rewards */}
                  <div className="flex items-center justify-between">
                    <h3 style={{ color: T1, fontSize: 15, fontWeight: 600, margin: 0 }}>{t('loyalty.rewards')}</h3>
                    <button onClick={() => handleOpenRewardDialog()}
                      className="flex items-center gap-1.5 cursor-pointer"
                      style={{ background: RED, border: 'none', borderRadius: 10, padding: '7px 14px', color: '#fff', fontSize: 13, fontWeight: 600 }}>
                      <Plus className="h-4 w-4" />
                      {t('loyalty.addReward')}
                    </button>
                  </div>

                  {rewards.length === 0 ? (
                    <div className="text-center py-12" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW }}>
                      <Gift className="h-10 w-10 mx-auto mb-3" style={{ color: T3 }} />
                      <p style={{ color: T3, fontSize: 14, margin: 0 }}>{t('loyaltyOwner.noRewards')}</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {rewards.map((reward, i) => {
                        const typeConfig = REWARD_TYPES.find(rt => rt.value === reward.reward_type);
                        const Icon = typeConfig?.Icon || Gift;
                        return (
                          <motion.div key={reward.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                            <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px' }}>
                              <div className="flex items-center gap-3">
                                <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,25,44,0.12)' }}>
                                  <Icon className="h-5 w-5" style={{ color: RED }} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <h4 style={{ color: T1, fontSize: 14, fontWeight: 600, margin: 0 }}>{reward.name}</h4>
                                    {!reward.is_active && (
                                      <span style={{ padding: '2px 7px', borderRadius: 6, fontSize: 10.5, fontWeight: 600, color: T3, background: TILE_BG, border: `1px solid ${F_BORDER}` }}>Inactive</span>
                                    )}
                                  </div>
                                  {reward.description && <p style={{ color: T3, fontSize: 12.5, margin: 0 }} className="truncate">{reward.description}</p>}
                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <span style={{ padding: '2px 7px', borderRadius: 6, fontSize: 10.5, fontWeight: 600, color: T2, background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                                      {reward.points_required} pts
                                    </span>
                                    <span style={{ padding: '2px 7px', borderRadius: 6, fontSize: 10.5, fontWeight: 600, color: T2, background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                                      {typeConfig?.label[language as keyof typeof typeConfig.label] || typeConfig?.label.en}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button onClick={() => handleOpenRewardDialog(reward)} style={{ background: 'none', border: `1px solid ${F_BORDER}`, borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: T3 }}>
                                    <Edit2 className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => setDeleteRewardId(reward.id)} style={{ background: 'none', border: `1px solid rgba(255,92,99,0.2)`, borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#FF5C63' }}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}

                  {/* Tier Classification */}
                  <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px' }}>
                    <h3 className="flex items-center gap-2 mb-3" style={{ color: T1, fontSize: 14, fontWeight: 600, margin: 0, marginBottom: 12 }}>
                      <Target className="h-4 w-4" style={{ color: RED }} />
                      {t('loyalty.tierClassification')}
                    </h3>
                    <p style={{ color: T3, fontSize: 12.5, marginBottom: 12 }}>{t('loyalty.tierClassificationDesc')}</p>
                    <div className="space-y-2">
                      {([
                        { tier: 'bronze'   as const, label: t('loyalty.newCustomersTier'), desc: t('loyalty.newCustomersTierDesc'), range: '0€ – 199€'   },
                        { tier: 'silver'   as const, label: t('loyalty.regularCustomers'), desc: t('loyalty.regularCustomersDesc'), range: '200€ – 499€' },
                        { tier: 'gold'     as const, label: t('loyalty.vipCustomers'),     desc: t('loyalty.vipCustomersDesc'),     range: '500€ – 999€' },
                        { tier: 'platinum' as const, label: t('loyalty.eliteCustomers'),   desc: t('loyalty.eliteCustomersDesc'),   range: '1000€+'      },
                      ]).map(({ tier, label, desc, range }) => (
                        <div key={tier} className="flex items-center justify-between" style={{ padding: '10px 12px', borderRadius: 10, background: TILE_BG, border: `1px solid ${F_BORDER}` }}>
                          <div className="flex items-center gap-2">
                            <TierBadge tier={tier} size="md" />
                            <div>
                              <p style={{ color: T1, fontSize: 13, fontWeight: 500, margin: 0 }}>{label}</p>
                              <p style={{ color: T3, fontSize: 11, margin: 0 }}>{desc}</p>
                            </div>
                          </div>
                          <span style={{ color: T3, fontSize: 12, fontWeight: 600 }}>{range}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Points Stats */}
                  <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px' }}>
                    <h3 className="flex items-center gap-2 mb-3" style={{ color: T1, fontSize: 14, fontWeight: 600, margin: 0, marginBottom: 12 }}>
                      <TrendingUp className="h-4 w-4" style={{ color: RED }} />
                      {t('loyalty.pointsStats')}
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { value: stats.totalPointsRedeemed.toLocaleString(),                                               label: t('loyalty.pointsSpent')             },
                        { value: (stats.totalPointsIssued - stats.totalPointsRedeemed).toLocaleString(),                   label: t('loyalty.pointsInCirculation')     },
                        { value: stats.activeCustomers > 0 ? Math.round(stats.totalPointsIssued / stats.activeCustomers) : 0, label: t('loyalty.avgPointsPerMember')   },
                        { value: stats.activeCustomers > 0 ? (stats.totalRedemptions / stats.activeCustomers).toFixed(1) : 0, label: t('loyalty.avgRedemptionsPerMember') },
                      ].map((s, i) => (
                        <div key={i} style={{ background: TILE_BG, borderRadius: 10, padding: '12px', textAlign: 'center', border: `1px solid ${F_BORDER}` }}>
                          <p style={{ color: RED, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>{s.value}</p>
                          <p style={{ color: T3, fontSize: 10.5, margin: 0 }}>{s.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Settings */}
                  <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px' }}>
                    <h3 className="flex items-center gap-2 mb-4" style={{ color: T1, fontSize: 14, fontWeight: 600, margin: 0, marginBottom: 16 }}>
                      <Settings className="h-4 w-4" style={{ color: RED }} />
                      {t('loyalty.settings')}
                    </h3>
                    <div className="space-y-5">
                      {/* Points per Euro slider */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p style={{ color: T2, fontSize: 13, fontWeight: 500, margin: 0 }}>{t('loyalty.pointsPerEuro')}</p>
                          <span style={{ color: T1, fontSize: 15, fontWeight: 700 }}>{localSettings.points_per_euro}</span>
                        </div>
                        <YunoSlider
                          value={localSettings.points_per_euro}
                          min={0.5} max={5} step={0.5}
                          onChange={v => setLocalSettings(prev => ({ ...prev, points_per_euro: v }))}
                        />
                        <p style={{ color: T3, fontSize: 11.5, marginTop: 4 }}>
                          {t('loyalty.pointsPerEuroDesc').replace('{value}', String(localSettings.points_per_euro))}
                        </p>
                      </div>
                      {/* Welcome Bonus */}
                      <div>
                        <p style={{ color: T2, fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{t('loyalty.welcomeBonus')}</p>
                        <input
                          type="number"
                          value={localSettings.welcome_bonus}
                          onChange={e => setLocalSettings(prev => ({ ...prev, welcome_bonus: parseInt(e.target.value) || 0 }))}
                          min={0} max={500}
                          className="outline-none"
                          style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 14px', color: T1, fontSize: 14, fontFamily: 'inherit', width: '100%' }}
                        />
                        <p style={{ color: T3, fontSize: 11.5, marginTop: 4 }}>{t('loyalty.pointsOnFirstPurchase')}</p>
                      </div>
                      {/* Post Visit Notification */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p style={{ color: T2, fontSize: 13, fontWeight: 500, margin: 0 }}>{t('loyalty.postVisitNotif')}</p>
                          <p style={{ color: T3, fontSize: 11.5, margin: 0 }}>{t('loyalty.postVisitDesc')}</p>
                        </div>
                        <YunoSwitch
                          checked={localSettings.post_visit_notification}
                          onChange={v => setLocalSettings(prev => ({ ...prev, post_visit_notification: v }))}
                        />
                      </div>
                      {/* Save */}
                      <button onClick={handleSaveSettings} disabled={savingSettings}
                        className="w-full flex items-center justify-center gap-2 cursor-pointer"
                        style={{ background: savingSettings ? INNER_BG : RED, border: 'none', borderRadius: 12, padding: '12px', color: '#fff', fontSize: 14, fontWeight: 600, opacity: savingSettings ? 0.7 : 1 }}>
                        {savingSettings
                          ? <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                          : <><Check className="h-4 w-4" />{t('loyalty.save')}</>
                        }
                      </button>
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          )}

          {activeTab === 'leaderboard' && (
            <motion.div key="leaderboard" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <OwnerLeaderboardSection venueId={venueId} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Reward Dialog */}
      <AnimatePresence>
        {showRewardDialog && (
          <>
            <motion.div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(4px)' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowRewardDialog(false)}
            />
            <motion.div
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md px-4"
              style={{ maxHeight: '90vh', overflowY: 'auto' }}
              initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            >
              <div style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 20, padding: '24px' }}>
                <div className="flex items-center justify-between mb-4">
                  <h2 style={{ color: T1, fontSize: 17, fontWeight: 700, margin: 0 }}>
                    {editingReward ? t('loyalty.editReward') : t('loyalty.addReward')}
                  </h2>
                  <button onClick={() => setShowRewardDialog(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T3 }}>
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="space-y-4">
                  {/* Name */}
                  <div>
                    <p style={{ color: T2, fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{t('rewardName')}</p>
                    <input value={rewardForm.name} onChange={e => setRewardForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="Free cocktail" className="w-full outline-none"
                      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 14px', color: T1, fontSize: 14, fontFamily: 'inherit' }} />
                  </div>
                  {/* Description */}
                  <div>
                    <p style={{ color: T2, fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{t('description')}</p>
                    <textarea value={rewardForm.description} onChange={e => setRewardForm(p => ({ ...p, description: e.target.value }))}
                      placeholder="Any cocktail from our menu" rows={2} className="w-full outline-none resize-none"
                      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 14px', color: T1, fontSize: 14, fontFamily: 'inherit' }} />
                  </div>
                  {/* Points Required */}
                  <div>
                    <p style={{ color: T2, fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{t('pointsRequired')}</p>
                    <input type="number" value={rewardForm.points_required} min={1}
                      onChange={e => setRewardForm(p => ({ ...p, points_required: parseInt(e.target.value) || 0 }))}
                      className="w-full outline-none"
                      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 14px', color: T1, fontSize: 14, fontFamily: 'inherit' }} />
                  </div>
                  {/* Reward Type */}
                  <div>
                    <p style={{ color: T2, fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>{t('rewardType')}</p>
                    <div className="flex gap-2 flex-wrap">
                      {REWARD_TYPES.map(type => (
                        <Chip key={type.value}
                          label={type.label[language as keyof typeof type.label] || type.label.en}
                          active={rewardForm.reward_type === type.value}
                          onClick={() => setRewardForm(p => ({ ...p, reward_type: type.value }))}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Free Drink — category restriction */}
                  {rewardForm.reward_type === 'free_drink' && (
                    <div>
                      <p style={{ color: T2, fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>
                        {t('owner.loy.allowedCategories')}
                      </p>
                      <p style={{ color: T3, fontSize: 11.5, marginBottom: 8 }}>
                        {t('owner.loy.emptyAllDrinks')}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { value: 'drink', label: { en: 'Drink', fr: 'Boisson', es: 'Bebida' } },
                          { value: 'shot',  label: { en: 'Shot',  fr: 'Shot',    es: 'Shot'   } },
                          { value: 'soft',  label: { en: 'Soft',  fr: 'Soft',    es: 'Soft'   } },
                        ].map(cat => {
                          const isSelected = rewardForm.allowed_categories.includes(cat.value);
                          return (
                            <Chip key={cat.value}
                              label={cat.label[language as keyof typeof cat.label] || cat.label.en}
                              active={isSelected}
                              onClick={() => setRewardForm(p => ({
                                ...p,
                                allowed_categories: isSelected
                                  ? p.allowed_categories.filter(c => c !== cat.value)
                                  : [...p.allowed_categories, cat.value],
                              }))}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Free Ticket */}
                  {rewardForm.reward_type === 'free_ticket' && (
                    <div>
                      <p style={{ color: T2, fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
                        {t('owner.loy.maxTicketValue')}
                      </p>
                      <input type="number" value={rewardForm.max_ticket_value} min={0}
                        placeholder={t('owner.loy.emptyForAll')}
                        onChange={e => setRewardForm(p => ({ ...p, max_ticket_value: e.target.value }))}
                        className="w-full outline-none"
                        style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 14px', color: T1, fontSize: 14, fontFamily: 'inherit' }} />
                    </div>
                  )}

                  {/* Discount */}
                  {rewardForm.reward_type === 'discount' && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p style={{ color: T2, fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Type</p>
                          <div className="flex gap-2">
                            {[{ v: 'percentage', l: '%' }, { v: 'fixed', l: '€' }].map(opt => (
                              <Chip key={opt.v} label={opt.l}
                                active={rewardForm.discount_type === opt.v}
                                onClick={() => setRewardForm(p => ({ ...p, discount_type: opt.v as 'percentage' | 'fixed' }))}
                              />
                            ))}
                          </div>
                        </div>
                        <div>
                          <p style={{ color: T2, fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{t('owner.loy.value')}</p>
                          <input type="number" value={rewardForm.discount_value}
                            onChange={e => setRewardForm(p => ({ ...p, discount_value: Number(e.target.value) || 0 }))}
                            min={1} max={rewardForm.discount_type === 'percentage' ? 100 : 1000}
                            className="w-full outline-none"
                            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 14px', color: T1, fontSize: 14, fontFamily: 'inherit' }} />
                        </div>
                      </div>
                      <div>
                        <p style={{ color: T2, fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>
                          {t('owner.loy.appliesTo')}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { v: 'all',     l: t('owner.loy.all')     },
                            { v: 'drinks',  l: t('owner.loy.drinks')  },
                            { v: 'tickets', l: 'Tickets' },
                          ].map(opt => (
                            <Chip key={opt.v} label={opt.l}
                              active={rewardForm.applies_to === opt.v}
                              onClick={() => setRewardForm(p => ({ ...p, applies_to: opt.v as 'drinks' | 'tickets' | 'all' }))}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 mt-6">
                  <button onClick={() => setShowRewardDialog(false)}
                    style={{ flex: 1, background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px', color: T2, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                    {t('cancel')}
                  </button>
                  <button onClick={handleSaveReward} disabled={!rewardForm.name.trim()}
                    style={{ flex: 1, background: RED, border: 'none', borderRadius: 10, padding: '10px', color: '#fff', fontSize: 14, fontWeight: 600, cursor: !rewardForm.name.trim() ? 'not-allowed' : 'pointer', opacity: !rewardForm.name.trim() ? 0.5 : 1 }}>
                    {t('save')}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Delete Confirm */}
      <AnimatePresence>
        {deleteRewardId && (
          <>
            <motion.div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(4px)' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setDeleteRewardId(null)}
            />
            <motion.div
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm px-4"
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            >
              <div style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 20, padding: '24px' }}>
                <h2 style={{ color: T1, fontSize: 17, fontWeight: 700, margin: 0, marginBottom: 8 }}>{t('delete')}</h2>
                <p style={{ color: T3, fontSize: 13, marginBottom: 20 }}>{t('deleteConfirm')}</p>
                <div className="flex gap-2">
                  <button onClick={() => setDeleteRewardId(null)}
                    style={{ flex: 1, background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px', color: T2, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                    {t('cancel')}
                  </button>
                  <button onClick={handleDeleteReward}
                    style={{ flex: 1, background: '#FF5C63', border: 'none', borderRadius: 10, padding: '10px', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                    {t('delete')}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
