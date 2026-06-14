import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Crown, Trophy, Settings, Plus, Edit2, Trash2, RefreshCw, Check,
  Sparkles, Wine, Ticket, Armchair, Calendar, CalendarDays, Zap,
  TrendingUp, BarChart3, Users, Award, Clock, Play, Square, Eye,
  ChevronLeft, Gift,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { useLeaderboard, useContestWinners, useContestScores, getStatusBadge, anonymizeName } from '@/hooks/useLeaderboard';
import type { LeaderboardContest } from '@/hooks/useLeaderboard';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface OwnerLeaderboardSectionProps {
  venueId: string;
}

const REWARD_TYPES = [
  { value: 'free_ticket', icon: Ticket },
  { value: 'free_drink', icon: Wine },
  { value: 'free_table', icon: Armchair },
];

function getRewardLabel(value: string, lang: string) {
  const labels: Record<string, Record<string, string>> = {
    free_ticket: { en: 'Free Ticket', fr: 'Ticket Gratuit', es: 'Entrada Gratis' },
    free_drink: { en: 'Free Drink', fr: 'Boisson Gratuite', es: 'Bebida Gratis' },
    free_table: { en: 'Free Table', fr: 'Table Gratuite', es: 'Mesa Gratis' },
  };
  return labels[value]?.[lang] || labels[value]?.en || value;
}

const DRINK_CATEGORIES = [
  { value: 'drink', label: { en: 'Drink', fr: 'Boisson', es: 'Bebida' } },
  { value: 'shot', label: { en: 'Shot', fr: 'Shot', es: 'Shot' } },
  { value: 'soft', label: { en: 'Soft', fr: 'Soft', es: 'Soft' } },
];

const CONTEST_TYPES = [
  { value: 'monthly', icon: Calendar, label: { en: 'Monthly', fr: 'Mensuel', es: 'Mensual' } },
  { value: 'yearly', icon: CalendarDays, label: { en: 'Yearly', fr: 'Annuel', es: 'Anual' } },
  { value: 'event', icon: Zap, label: { en: 'Event', fr: 'Événement', es: 'Evento' } },
];

function getContestStatusBadge(status: string, t: (k: string) => string) {
  switch (status) {
    case 'draft': return { label: t('owner.lb.draft'), color: 'bg-muted text-muted-foreground' };
    case 'live': return { label: t('owner.lb.live'), color: 'bg-green-500/20 text-green-400' };
    case 'ended': return { label: t('owner.lb.ended'), color: 'bg-yellow-500/20 text-yellow-400' };
    default: return { label: status, color: 'bg-muted text-muted-foreground' };
  }
}

export function OwnerLeaderboardSection({ venueId }: OwnerLeaderboardSectionProps) {
  const { language, t } = useLanguage();
  const {
    settings, scores, rewards, contests, loading,
    updateSettings, recalculateScores, saveReward, deleteReward,
    saveContest, deleteContest, finalizeContest,
  } = useLeaderboard(venueId);

  const zonesQuery = useQuery({
    queryKey: ['venue-zones', venueId],
    queryFn: async () => {
      const { data } = await supabase.from('table_zones').select('id, name, color').eq('venue_id', venueId).order('position');
      return data || [];
    },
    enabled: !!venueId,
  });

  const packsQuery = useQuery({
    queryKey: ['venue-packs', venueId],
    queryFn: async () => {
      const { data } = await supabase.from('table_packs').select('id, name, zone_id, base_price').eq('venue_id', venueId).eq('is_active', true).order('position');
      return data || [];
    },
    enabled: !!venueId,
  });

  const eventsQuery = useQuery({
    queryKey: ['venue-events-leaderboard', venueId],
    queryFn: async () => {
      const { data } = await supabase.from('events').select('id, title, start_at, end_at').eq('venue_id', venueId).eq('is_active', true).gte('end_at', new Date().toISOString()).order('start_at', { ascending: true }).limit(20);
      return data || [];
    },
    enabled: !!venueId,
  });

  const zones = zonesQuery.data || [];
  const packs = packsQuery.data || [];
  const events = eventsQuery.data || [];

  const [localSettings, setLocalSettings] = useState({
    is_enabled: settings?.is_enabled ?? false,
    leaderboard_type: settings?.leaderboard_type ?? 'monthly',
    spend_weight: settings?.spend_weight ?? 1.0,
    visit_weight: settings?.visit_weight ?? 0.5,
    vip_weight: settings?.vip_weight ?? 2.0,
    event_weight: settings?.event_weight ?? 0.3,
    recency_enabled: settings?.recency_enabled ?? true,
    recency_days: settings?.recency_days ?? 30,
    show_top_count: settings?.show_top_count ?? 10,
    auto_reward: (settings as any)?.auto_reward ?? true,
    contest_event_id: (settings as any)?.contest_event_id ?? '',
  });

  useEffect(() => {
    if (settings) {
      setLocalSettings({
        is_enabled: settings.is_enabled,
        leaderboard_type: settings.leaderboard_type,
        spend_weight: settings.spend_weight,
        visit_weight: settings.visit_weight,
        vip_weight: settings.vip_weight,
        event_weight: settings.event_weight,
        recency_enabled: settings.recency_enabled,
        recency_days: settings.recency_days,
        show_top_count: settings.show_top_count,
        auto_reward: (settings as any)?.auto_reward ?? true,
        contest_event_id: (settings as any)?.contest_event_id ?? '',
      });
    }
  }, [settings]);

  // Reward presets
  const [showRewardDialog, setShowRewardDialog] = useState(false);
  const [editingReward, setEditingReward] = useState<typeof rewards[0] | null>(null);
  const [deleteRewardId, setDeleteRewardId] = useState<string | null>(null);
  const [rewardForm, setRewardForm] = useState({
    rank_min: 1, rank_max: 1, reward_type: 'free_drink', reward_description: '',
    quantity: 1, drink_category: '', zone_id: '', pack_id: '',
  });

  // Contest management
  const [showContestDialog, setShowContestDialog] = useState(false);
  const [editingContest, setEditingContest] = useState<LeaderboardContest | null>(null);
  const [viewingContest, setViewingContest] = useState<LeaderboardContest | null>(null);
  const [deleteContestId, setDeleteContestId] = useState<string | null>(null);
  const [contestForm, setContestForm] = useState({
    name: '',
    contest_type: 'monthly',
    event_id: '',
    start_date: new Date(),
    end_date: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
    auto_reward: true,
    selectedRewardIds: [] as string[],
  });

  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('contests');

  const handleToggle = async (enabled: boolean) => {
    setLocalSettings(prev => ({ ...prev, is_enabled: enabled }));
    await updateSettings.mutateAsync({ is_enabled: enabled });
    toast.success(enabled
      ? (t('owner.lb.leaderboardEnabled'))
      : (t('owner.lb.leaderboardDisabled')));
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const payload: any = { ...localSettings };
      if (payload.contest_event_id === '') payload.contest_event_id = null;
      await updateSettings.mutateAsync(payload);
      toast.success(t('owner.lb.settingsSaved'));
    } catch { toast.error(t('owner.lb.error')); }
    setSaving(false);
  };

  const handleRecalculate = async () => {
    try {
      await recalculateScores.mutateAsync();
      toast.success(t('owner.lb.scoresRecalculated'));
    } catch { toast.error(t('owner.lb.error')); }
  };

  // --- Reward Preset Handlers ---
  const handleOpenRewardDialog = (reward?: typeof rewards[0]) => {
    if (reward) {
      setEditingReward(reward);
      const config = reward.reward_config as any || {};
      setRewardForm({
        rank_min: reward.rank_min, rank_max: reward.rank_max,
        reward_type: reward.reward_type, reward_description: reward.reward_description || '',
        quantity: config.quantity || 1, drink_category: config.drink_category || '',
        zone_id: config.zone_id || '', pack_id: config.pack_id || '',
      });
    } else {
      setEditingReward(null);
      setRewardForm({ rank_min: 1, rank_max: 1, reward_type: 'free_drink', reward_description: '', quantity: 1, drink_category: '', zone_id: '', pack_id: '' });
    }
    setShowRewardDialog(true);
  };

  const handleSaveReward = async () => {
    try {
      const reward_config: Record<string, any> = { quantity: rewardForm.quantity };
      if (rewardForm.reward_type === 'free_drink' && rewardForm.drink_category) reward_config.drink_category = rewardForm.drink_category;
      if (rewardForm.reward_type === 'free_table') {
        if (rewardForm.zone_id) reward_config.zone_id = rewardForm.zone_id;
        if (rewardForm.pack_id) reward_config.pack_id = rewardForm.pack_id;
      }
      await saveReward.mutateAsync({
        ...(editingReward ? { id: editingReward.id } : {}),
        venue_id: venueId, rank_min: rewardForm.rank_min, rank_max: rewardForm.rank_max,
        reward_type: rewardForm.reward_type, reward_description: rewardForm.reward_description || null,
        reward_config,
      } as any);
      toast.success(t('owner.lb.presetSaved'));
      setShowRewardDialog(false);
    } catch { toast.error(t('owner.lb.error')); }
  };

  const handleDeleteReward = async () => {
    if (!deleteRewardId) return;
    try { await deleteReward.mutateAsync(deleteRewardId); toast.success(t('owner.lb.presetDeleted')); }
    catch { toast.error(t('owner.lb.error')); }
    setDeleteRewardId(null);
  };

  // --- Contest Handlers ---
  const handleOpenContestDialog = (contest?: LeaderboardContest) => {
    if (contest) {
      setEditingContest(contest);
      setContestForm({
        name: contest.name,
        contest_type: contest.contest_type,
        event_id: contest.event_id || '',
        start_date: new Date(contest.start_date),
        end_date: new Date(contest.end_date),
        auto_reward: contest.auto_reward,
        selectedRewardIds: contest.reward_preset_ids || [],
      });
    } else {
      setEditingContest(null);
      setContestForm({
        name: '', contest_type: 'monthly', event_id: '',
        start_date: new Date(),
        end_date: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        auto_reward: true, selectedRewardIds: [],
      });
    }
    setShowContestDialog(true);
  };

  const handleSaveContest = async () => {
    if (!contestForm.name.trim()) {
      toast.error(t('owner.lb.nameRequired'));
      return;
    }
    if (contestForm.selectedRewardIds.length === 0) {
      toast.error(t('owner.lb.selectReward'));
      return;
    }
    setSaving(true);
    try {
      await saveContest.mutateAsync({
        ...(editingContest ? { id: editingContest.id } : {}),
        venue_id: venueId,
        name: contestForm.name,
        contest_type: contestForm.contest_type,
        event_id: contestForm.event_id || null,
        start_date: contestForm.start_date.toISOString(),
        end_date: contestForm.end_date.toISOString(),
        auto_reward: contestForm.auto_reward,
        reward_preset_ids: contestForm.selectedRewardIds,
        status: editingContest?.status || 'draft',
      } as any);
      toast.success(t('owner.lb.contestSaved'));
      setShowContestDialog(false);
    } catch { toast.error(t('owner.lb.saveError')); }
    setSaving(false);
  };

  const handleLaunchContest = async (contest: LeaderboardContest) => {
    try {
      await saveContest.mutateAsync({ id: contest.id, venue_id: venueId, status: 'live' } as any);
      toast.success(t('owner.lb.contestLaunched'));
    } catch { toast.error(t('owner.lb.error')); }
  };

  const handleFinalizeContest = async (contestId: string) => {
    try {
      await finalizeContest.mutateAsync(contestId);
      toast.success(t('owner.lb.rewardsDistributed'));
    } catch { toast.error(t('owner.lb.error')); }
  };

  const handleDeleteContest = async () => {
    if (!deleteContestId) return;
    try { await deleteContest.mutateAsync(deleteContestId); toast.success(t('owner.lb.contestDeleted')); }
    catch { toast.error(t('owner.lb.error')); }
    setDeleteContestId(null);
  };

  const filteredPacks = rewardForm.zone_id ? packs.filter(p => p.zone_id === rewardForm.zone_id) : packs;
  const top10 = scores.slice(0, localSettings.show_top_count || 10);

  const liveContests = contests.filter(c => c.status === 'live');
  const endedContests = contests.filter(c => c.status === 'ended');
  const draftContests = contests.filter(c => c.status === 'draft');

  const totalParticipants = scores.length;
  const avgScore = totalParticipants > 0 ? Math.round(scores.reduce((acc, s) => acc + s.total_score, 0) / totalParticipants) : 0;
  const topScore = top10[0]?.total_score ? Math.round(top10[0].total_score) : 0;

  const toggleRewardSelection = (rewardId: string) => {
    setContestForm(prev => ({
      ...prev,
      selectedRewardIds: prev.selectedRewardIds.includes(rewardId)
        ? prev.selectedRewardIds.filter(id => id !== rewardId)
        : [...prev.selectedRewardIds, rewardId],
    }));
  };

  return (
    <div className="space-y-6">
      {/* Enable Toggle */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between p-4 bg-gradient-to-r from-yellow-500/10 to-yellow-500/5">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-yellow-500/20 flex items-center justify-center">
              <Crown className="h-6 w-6 text-yellow-500" />
            </div>
            <div>
              <h3 className="font-semibold">
                {t('owner.lb.clientLeaderboard')}
              </h3>
              <p className="text-sm text-muted-foreground">
                {localSettings.is_enabled
                  ? `${scores.length} ${t('owner.lb.clientsRanked')}`
                  : (t('owner.lb.driveEngagement'))}
              </p>
            </div>
          </div>
          <Switch checked={localSettings.is_enabled} onCheckedChange={handleToggle} />
        </div>
      </Card>

      {localSettings.is_enabled && (
        <>
          {/* Viewing a specific contest dashboard */}
          {viewingContest ? (
            <ContestDashboard
              contest={viewingContest}
              language={language}
              t={t}
              rewards={rewards}
              onBack={() => setViewingContest(null)}
              onFinalize={() => handleFinalizeContest(viewingContest.id)}
              finalizing={finalizeContest.isPending}
            />
          ) : (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full grid grid-cols-3">
                <TabsTrigger value="contests">{t('owner.lb.contests')}</TabsTrigger>
                <TabsTrigger value="presets">{t('owner.lb.rewards')}</TabsTrigger>
                <TabsTrigger value="settings">{t('owner.lb.settings')}</TabsTrigger>
              </TabsList>

              {/* === CONTESTS TAB === */}
              <TabsContent value="contests" className="space-y-4 mt-4">
                {/* Analytics Summary */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-xl bg-muted/50 text-center">
                    <Users className="h-4 w-4 mx-auto mb-1 text-yellow-500" />
                    <p className="text-xl font-bold text-foreground">{totalParticipants}</p>
                    <p className="text-[10px] text-muted-foreground">Participants</p>
                  </div>
                  <div className="p-3 rounded-xl bg-muted/50 text-center">
                    <TrendingUp className="h-4 w-4 mx-auto mb-1 text-primary" />
                    <p className="text-xl font-bold text-foreground">{avgScore.toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">{t('owner.lb.avgScore')}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-muted/50 text-center">
                    <Trophy className="h-4 w-4 mx-auto mb-1 text-yellow-500" />
                    <p className="text-xl font-bold text-foreground">{topScore.toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">{t('owner.lb.topScore')}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-muted/50 text-center">
                    <BarChart3 className="h-4 w-4 mx-auto mb-1 text-primary" />
                    <p className="text-xl font-bold text-foreground">{liveContests.length}</p>
                    <p className="text-[10px] text-muted-foreground">{t('owner.lb.activeContests')}</p>
                  </div>
                </div>

                {/* Create new contest */}
                <Button className="w-full" onClick={() => handleOpenContestDialog()}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t('owner.lb.createContest')}
                </Button>

                {/* Live Contests */}
                {liveContests.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                      {t('owner.lb.live')}
                    </h4>
                    {liveContests.map(c => (
                      <ContestCard key={c.id} contest={c} language={language} t={t} rewards={rewards}
                        onView={() => setViewingContest(c)}
                        onEdit={() => handleOpenContestDialog(c)}
                        onDelete={() => setDeleteContestId(c.id)}
                        onFinalize={() => handleFinalizeContest(c.id)}
                      />
                    ))}
                  </div>
                )}

                {/* Draft Contests */}
                {draftContests.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-muted-foreground">
                      {t('owner.lb.drafts')}
                    </h4>
                    {draftContests.map(c => (
                      <ContestCard key={c.id} contest={c} language={language} t={t} rewards={rewards}
                        onView={() => setViewingContest(c)}
                        onEdit={() => handleOpenContestDialog(c)}
                        onDelete={() => setDeleteContestId(c.id)}
                        onLaunch={() => handleLaunchContest(c)}
                      />
                    ))}
                  </div>
                )}

                {/* Ended Contests */}
                {endedContests.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-muted-foreground">
                      {t('owner.lb.endedPlural')}
                    </h4>
                    {endedContests.map(c => (
                      <ContestCard key={c.id} contest={c} language={language} t={t} rewards={rewards}
                        onView={() => setViewingContest(c)}
                        onDelete={() => setDeleteContestId(c.id)}
                      />
                    ))}
                  </div>
                )}

                {contests.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Trophy className="h-10 w-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">{t('owner.lb.noContests')}</p>
                  </div>
                )}
              </TabsContent>

              {/* === REWARD PRESETS TAB === */}
              <TabsContent value="presets" className="space-y-4 mt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold">{t('owner.lb.rewardPresets')}</h4>
                    <p className="text-xs text-muted-foreground">
                      {t('owner.lb.createReusablePresets')}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => handleOpenRewardDialog()}>
                    <Plus className="h-4 w-4 mr-1" />
                    {t('owner.lb.create')}
                  </Button>
                </div>

                {rewards.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Gift className="h-10 w-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">{t('owner.lb.noPresets')}</p>
                  </div>
                ) : (
                  rewards.map((reward) => {
                    const typeInfo = REWARD_TYPES.find(t => t.value === reward.reward_type);
                    const Icon = typeInfo?.icon || Crown;
                    const config = reward.reward_config as any || {};
                    const zone = zones.find(z => z.id === config.zone_id);
                    const pack = packs.find(p => p.id === config.pack_id);

                    return (
                      <div key={reward.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Icon className="h-4.5 w-4.5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">#{reward.rank_min}{reward.rank_min !== reward.rank_max ? `-${reward.rank_max}` : ''}</Badge>
                            <span className="text-sm font-medium">{getRewardLabel(reward.reward_type, language)}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            {config.quantity > 1 && <Badge variant="secondary" className="text-[10px] h-4">×{config.quantity}</Badge>}
                            {config.drink_category && <Badge variant="secondary" className="text-[10px] h-4">{config.drink_category}</Badge>}
                            {zone && <Badge variant="secondary" className="text-[10px] h-4" style={{ borderColor: zone.color }}>{zone.name}</Badge>}
                            {pack && <Badge variant="secondary" className="text-[10px] h-4">{pack.name}</Badge>}
                            {reward.reward_description && <span className="text-xs text-muted-foreground truncate">{reward.reward_description}</span>}
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenRewardDialog(reward)}>
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteRewardId(reward.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </TabsContent>

              {/* === SETTINGS TAB === */}
              <TabsContent value="settings" className="space-y-4 mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Settings className="h-5 w-5 text-primary" />
                      {t('owner.lb.scoringConfig')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {[
                      { key: 'spend_weight' as const, label: t('owner.lb.spendWeight'), max: 5 },
                      { key: 'visit_weight' as const, label: t('owner.lb.visitWeight'), max: 3 },
                      { key: 'vip_weight' as const, label: t('owner.lb.vipWeight'), max: 5 },
                      { key: 'event_weight' as const, label: t('owner.lb.eventWeight'), max: 3 },
                    ].map(({ key, label, max }) => (
                      <div key={key} className="space-y-2">
                        <div className="flex justify-between">
                          <Label>{label}</Label>
                          <span className="text-sm font-semibold">{localSettings[key]}</span>
                        </div>
                        <Slider value={[localSettings[key]]} onValueChange={([v]) => setLocalSettings(prev => ({ ...prev, [key]: v }))} min={0} max={max} step={0.1} />
                      </div>
                    ))}

                    <Separator />

                    <div className="flex items-center justify-between">
                      <div>
                        <Label>{t('owner.lb.recencyBoost')}</Label>
                        <p className="text-xs text-muted-foreground">{t('owner.lb.bonusRecent')}</p>
                      </div>
                      <Switch checked={localSettings.recency_enabled} onCheckedChange={(v) => setLocalSettings(prev => ({ ...prev, recency_enabled: v }))} />
                    </div>

                    {localSettings.recency_enabled && (
                      <div className="space-y-2">
                        <Label>{t('owner.lb.windowDays')}</Label>
                        <Input type="number" value={localSettings.recency_days} onChange={(e) => setLocalSettings(prev => ({ ...prev, recency_days: parseInt(e.target.value) || 30 }))} min={7} max={90} />
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>{t('owner.lb.showTop')}</Label>
                      <Select value={String(localSettings.show_top_count)} onValueChange={(v) => setLocalSettings(prev => ({ ...prev, show_top_count: parseInt(v) }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="10">Top 10</SelectItem>
                          <SelectItem value="25">Top 25</SelectItem>
                          <SelectItem value="50">Top 50</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex gap-2">
                      <Button onClick={handleSaveSettings} disabled={saving} className="flex-1">
                        {saving ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" /> : <Check className="h-4 w-4 mr-2" />}
                        {t('owner.lb.save')}
                      </Button>
                      <Button variant="outline" onClick={handleRecalculate} disabled={recalculateScores.isPending}>
                        <RefreshCw className={cn("h-4 w-4 mr-2", recalculateScores.isPending && "animate-spin")} />
                        {t('owner.lb.recalculate')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Leaderboard Preview */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-primary" />
                      {t('owner.lb.leaderboardPreview')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {top10.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Trophy className="h-10 w-10 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">{t('owner.lb.noScores')}</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {top10.map((score, i) => {
                          const badge = getStatusBadge(score.rank);
                          const name = score.leaderboard_visibility === 'hidden' ? (t('owner.lb.hidden'))
                            : score.leaderboard_visibility === 'anonymous' ? anonymizeName(score.first_name || null, score.last_name || null)
                              : [score.first_name, score.last_name].filter(Boolean).join(' ') || 'Anonymous';
                          return (
                            <motion.div key={score.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/30">
                              <span className={cn("w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold", i === 0 && "bg-yellow-500/20 text-yellow-400", i === 1 && "bg-slate-400/20 text-slate-300", i === 2 && "bg-amber-700/20 text-amber-600", i > 2 && "bg-muted text-muted-foreground")}>{score.rank}</span>
                              <Avatar className="h-7 w-7">
                                <AvatarImage src={score.avatar_url || undefined} />
                                <AvatarFallback className="text-[10px]">{(score.first_name || '?').charAt(0)}</AvatarFallback>
                              </Avatar>
                              <span className="text-sm flex-1 truncate">{name}</span>
                              {badge && <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border", badge.colorClass)}>{badge.icon}</span>}
                              <span className="text-xs font-semibold text-muted-foreground">{Math.round(score.total_score).toLocaleString()}</span>
                            </motion.div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}
        </>
      )}

      {/* ======= DIALOGS ======= */}

      {/* Contest Create/Edit Dialog */}
      <Dialog open={showContestDialog} onOpenChange={setShowContestDialog}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingContest ? (t('owner.lb.editContest')) : (t('owner.lb.createContest'))}
            </DialogTitle>
            <DialogDescription>
              {t('owner.lb.configureContest')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t('owner.lb.contestName')}</Label>
              <Input value={contestForm.name} onChange={e => setContestForm(p => ({ ...p, name: e.target.value }))} placeholder={t('owner.lb.contestNamePlaceholder')} />
            </div>

            {/* Type */}
            <div className="space-y-2">
              <Label>{t('owner.lb.type')}</Label>
              <div className="grid grid-cols-3 gap-2">
                {CONTEST_TYPES.map(ct => {
                  const Icon = ct.icon;
                  const isSelected = contestForm.contest_type === ct.value;
                  return (
                    <button key={ct.value} onClick={() => setContestForm(p => ({ ...p, contest_type: ct.value }))}
                      className={cn("p-3 rounded-xl border-2 text-center transition-all", isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/30 bg-muted/30")}>
                      <Icon className={cn("h-4 w-4 mx-auto mb-1", isSelected ? "text-primary" : "text-muted-foreground")} />
                      <span className={cn("text-xs font-semibold", isSelected && "text-primary")}>
                        {ct.label[language as keyof typeof ct.label] || ct.label.en}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Event selector for event type */}
            {contestForm.contest_type === 'event' && (
              <div className="space-y-2">
                <Label>{t('owner.lb.event')}</Label>
                {events.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">{t('owner.lb.noUpcomingEvents')}</p>
                ) : (
                  <Select value={contestForm.event_id || ''} onValueChange={(v) => {
                    const ev = events.find(e => e.id === v);
                    setContestForm(p => ({
                      ...p, event_id: v,
                      start_date: ev ? new Date(ev.start_at) : p.start_date,
                      end_date: ev ? new Date(ev.end_at) : p.end_date,
                    }));
                  }}>
                    <SelectTrigger><SelectValue placeholder={t('owner.lb.selectEvent')} /></SelectTrigger>
                    <SelectContent>
                      {events.map(ev => (
                        <SelectItem key={ev.id} value={ev.id}>
                          {ev.title} — {new Date(ev.start_at).toLocaleDateString()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t('owner.lb.start')}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <Calendar className="h-4 w-4 mr-2" />
                      {format(contestForm.start_date, 'dd/MM/yyyy')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent mode="single" selected={contestForm.start_date} onSelect={(d) => d && setContestForm(p => ({ ...p, start_date: d }))} className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>{t('owner.lb.end')}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <Calendar className="h-4 w-4 mr-2" />
                      {format(contestForm.end_date, 'dd/MM/yyyy')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent mode="single" selected={contestForm.end_date} onSelect={(d) => d && setContestForm(p => ({ ...p, end_date: d }))} className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Auto reward */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div>
                <Label>{t('owner.lb.autoRewards')}</Label>
                <p className="text-xs text-muted-foreground">{t('owner.lb.autoDistribute')}</p>
              </div>
              <Switch checked={contestForm.auto_reward} onCheckedChange={(v) => setContestForm(p => ({ ...p, auto_reward: v }))} />
            </div>

            {/* Select reward presets */}
            <div className="space-y-2">
              <Label>{t('owner.lb.rewardsToAttach')}</Label>
              {rewards.length === 0 ? (
                <div className="p-3 rounded-lg border border-dashed border-muted-foreground/30 text-center">
                  <p className="text-xs text-muted-foreground">{t('owner.lb.createPresetsFirst')}</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {rewards.map(r => {
                    const selected = contestForm.selectedRewardIds.includes(r.id);
                    return (
                      <label key={r.id} className={cn("flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all", selected ? "border-primary bg-primary/5" : "border-border bg-muted/30 hover:border-primary/30")}>
                        <Checkbox checked={selected} onCheckedChange={() => toggleRewardSelection(r.id)} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">#{r.rank_min}{r.rank_min !== r.rank_max ? `-${r.rank_max}` : ''}</Badge>
                            <span className="text-sm">{getRewardLabel(r.reward_type, language)}</span>
                            {(r.reward_config as any)?.quantity > 1 && <Badge variant="secondary" className="text-[10px] h-4">×{(r.reward_config as any).quantity}</Badge>}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowContestDialog(false)}>{t('owner.lb.cancel')}</Button>
            <Button onClick={handleSaveContest} disabled={saving}>
              {saving ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" /> : <Check className="h-4 w-4 mr-2" />}
              {t('owner.lb.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reward Preset Dialog */}
      <Dialog open={showRewardDialog} onOpenChange={setShowRewardDialog}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingReward ? (t('owner.lb.editPreset')) : (t('owner.lb.createRewardPreset'))}
            </DialogTitle>
            <DialogDescription>{t('owner.lb.defineRankType')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t('owner.lb.rankMin')}</Label>
                <Input type="number" value={rewardForm.rank_min} onChange={(e) => setRewardForm(p => ({ ...p, rank_min: parseInt(e.target.value) || 1 }))} min={1} />
              </div>
              <div className="space-y-2">
                <Label>{t('owner.lb.rankMax')}</Label>
                <Input type="number" value={rewardForm.rank_max} onChange={(e) => setRewardForm(p => ({ ...p, rank_max: parseInt(e.target.value) || 1 }))} min={1} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('owner.lb.rewardType')}</Label>
              <Select value={rewardForm.reward_type} onValueChange={(v) => setRewardForm(p => ({ ...p, reward_type: v, zone_id: '', pack_id: '', drink_category: '' }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REWARD_TYPES.map(rt => <SelectItem key={rt.value} value={rt.value}>{getRewardLabel(rt.value, language)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('owner.lb.quantity')}</Label>
              <Input type="number" value={rewardForm.quantity} onChange={(e) => setRewardForm(p => ({ ...p, quantity: parseInt(e.target.value) || 1 }))} min={1} max={10} />
            </div>

            {rewardForm.reward_type === 'free_drink' && (
              <div className="space-y-2">
                <Label>{t('owner.lb.category')}</Label>
                <Select value={rewardForm.drink_category || 'all'} onValueChange={(v) => setRewardForm(p => ({ ...p, drink_category: v === 'all' ? '' : v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('owner.lb.allFem')}</SelectItem>
                    {DRINK_CATEGORIES.map(cat => <SelectItem key={cat.value} value={cat.value}>{cat.label[language as keyof typeof cat.label] || cat.label.en}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {rewardForm.reward_type === 'free_table' && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Zone</Label>
                  {zones.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t('owner.lb.noZones')}</p>
                  ) : (
                    <Select value={rewardForm.zone_id || 'any'} onValueChange={(v) => setRewardForm(p => ({ ...p, zone_id: v === 'any' ? '' : v, pack_id: '' }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">{t('owner.lb.anyZone')}</SelectItem>
                        {zones.map(z => <SelectItem key={z.id} value={z.id}><div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: z.color }} />{z.name}</div></SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Pack</Label>
                  {filteredPacks.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{rewardForm.zone_id ? (t('owner.lb.noPacksZone')) : (t('owner.lb.selectZone'))}</p>
                  ) : (
                    <Select value={rewardForm.pack_id || 'any'} onValueChange={(v) => setRewardForm(p => ({ ...p, pack_id: v === 'any' ? '' : v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">{t('owner.lb.anyPack')}</SelectItem>
                        {filteredPacks.map(p => <SelectItem key={p.id} value={p.id}>{p.name} — {p.base_price}€</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>{t('owner.lb.descriptionOptional')}</Label>
              <Input value={rewardForm.reward_description} onChange={(e) => setRewardForm(p => ({ ...p, reward_description: e.target.value }))} placeholder={t('owner.lb.descPlaceholder')} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRewardDialog(false)}>{t('owner.lb.cancel')}</Button>
            <Button onClick={handleSaveReward}>{t('owner.lb.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Reward */}
      <AlertDialog open={!!deleteRewardId} onOpenChange={() => setDeleteRewardId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('owner.lb.delete')}</AlertDialogTitle>
            <AlertDialogDescription>{t('owner.lb.areYouSure')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('owner.lb.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteReward} className="bg-destructive text-destructive-foreground">{t('owner.lb.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Contest */}
      <AlertDialog open={!!deleteContestId} onOpenChange={() => setDeleteContestId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('owner.lb.deleteContest')}</AlertDialogTitle>
            <AlertDialogDescription>{t('owner.lb.irreversible')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('owner.lb.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteContest} className="bg-destructive text-destructive-foreground">{t('owner.lb.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ===== CONTEST CARD COMPONENT =====
function ContestCard({ contest, language, t, rewards, onView, onEdit, onDelete, onLaunch, onFinalize }: {
  contest: LeaderboardContest;
  language: string;
  t: (k: string) => string;
  rewards: any[];
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onLaunch?: () => void;
  onFinalize?: () => void;
}) {
  const statusBadge = getContestStatusBadge(contest.status, t);
  const linkedRewards = rewards.filter(r => (contest.reward_preset_ids || []).includes(r.id));
  const typeInfo = CONTEST_TYPES.find(ct => ct.value === contest.contest_type);
  const TypeIcon = typeInfo?.icon || Calendar;

  return (
    <Card className="overflow-hidden">
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <TypeIcon className="h-4 w-4 text-primary" />
            <h4 className="font-semibold text-sm">{contest.name || (t('owner.lb.unnamed'))}</h4>
          </div>
          <Badge className={cn("text-[10px]", statusBadge.color)}>{statusBadge.label}</Badge>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {format(new Date(contest.start_date), 'dd/MM/yy')} → {format(new Date(contest.end_date), 'dd/MM/yy')}
          </span>
          {contest.auto_reward && (
            <Badge variant="secondary" className="text-[10px] h-4">
              <Zap className="h-2.5 w-2.5 mr-0.5" />Auto
            </Badge>
          )}
          {contest.rewards_distributed && (
            <Badge variant="default" className="text-[10px] h-4 bg-green-500/20 text-green-400">
              <Check className="h-2.5 w-2.5 mr-0.5" />{t('owner.lb.distributed')}
            </Badge>
          )}
        </div>

        {linkedRewards.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {linkedRewards.map(r => (
              <Badge key={r.id} variant="outline" className="text-[10px]">
                #{r.rank_min}{r.rank_min !== r.rank_max ? `-${r.rank_max}` : ''} {getRewardLabel(r.reward_type, language)}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex gap-1.5 pt-1">
          {onView && (
            <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={onView}>
              <Eye className="h-3 w-3 mr-1" />{t('owner.lb.view')}
            </Button>
          )}
          {onEdit && contest.status !== 'ended' && (
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onEdit}>
              <Edit2 className="h-3 w-3" />
            </Button>
          )}
          {onLaunch && contest.status === 'draft' && (
            <Button size="sm" className="flex-1 h-8 text-xs bg-green-600 hover:bg-green-700" onClick={onLaunch}>
              <Play className="h-3 w-3 mr-1" />{t('owner.lb.launch')}
            </Button>
          )}
          {onFinalize && contest.status === 'live' && !contest.rewards_distributed && (
            <Button size="sm" variant="secondary" className="h-8 text-xs" onClick={onFinalize}>
              <Square className="h-3 w-3 mr-1" />{t('owner.lb.endVerb')}
            </Button>
          )}
          {onDelete && (
            <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive" onClick={onDelete}>
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ===== CONTEST DASHBOARD COMPONENT =====
function ContestDashboard({ contest, language, t, rewards, onBack, onFinalize, finalizing }: {
  contest: LeaderboardContest;
  language: string;
  t: (k: string) => string;
  rewards: any[];
  onBack: () => void;
  onFinalize: () => void;
  finalizing: boolean;
}) {
  const { data: winners = [] } = useContestWinners(contest.id);
  // Window-correct ranking for this exact contest (real spend within start→end).
  const { data: contestScores = [] } = useContestScores(contest.id);
  const statusBadge = getContestStatusBadge(contest.status, t);
  const linkedRewards = rewards.filter(r => (contest.reward_preset_ids || []).includes(r.id));
  const isEnded = contest.status === 'ended';
  const daysLeft = Math.max(0, Math.ceil((new Date(contest.end_date).getTime() - Date.now()) / 86400000));

  const rankedScores = [...contestScores]
    .filter(s => s.score > 0)
    .sort((a, b) => (a.rank || 999) - (b.rank || 999))
    .slice(0, 20);

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-2">
        <ChevronLeft className="h-4 w-4 mr-1" />
        {t('owner.lb.backToContests')}
      </Button>

      {/* Header */}
      <Card>
        <div className="p-4 bg-gradient-to-r from-yellow-500/10 to-primary/5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-lg">{contest.name}</h3>
            <Badge className={cn("text-xs", statusBadge.color)}>{statusBadge.label}</Badge>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>{format(new Date(contest.start_date), 'dd/MM/yyyy')} → {format(new Date(contest.end_date), 'dd/MM/yyyy')}</span>
            {!isEnded && <Badge variant="outline" className="text-xs">{daysLeft} {t('owner.lb.daysLeft')}</Badge>}
          </div>
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 rounded-xl bg-muted/50 text-center">
          <Users className="h-4 w-4 mx-auto mb-1 text-primary" />
          <p className="text-xl font-bold">{rankedScores.length}</p>
          <p className="text-[10px] text-muted-foreground">Participants</p>
        </div>
        <div className="p-3 rounded-xl bg-muted/50 text-center">
          <Award className="h-4 w-4 mx-auto mb-1 text-yellow-500" />
          <p className="text-xl font-bold">{linkedRewards.length}</p>
          <p className="text-[10px] text-muted-foreground">{t('owner.lb.rewards')}</p>
        </div>
        <div className="p-3 rounded-xl bg-muted/50 text-center">
          <Trophy className="h-4 w-4 mx-auto mb-1 text-yellow-500" />
          <p className="text-xl font-bold">{winners.length}</p>
          <p className="text-[10px] text-muted-foreground">{t('owner.lb.winners')}</p>
        </div>
      </div>

      {/* Actions */}
      {contest.status === 'live' && !contest.rewards_distributed && (
        <Button className="w-full" variant="destructive" onClick={onFinalize} disabled={finalizing}>
          {finalizing ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent mr-2" /> : <Square className="h-4 w-4 mr-2" />}
          {t('owner.lb.endDistribute')}
        </Button>
      )}

      {/* Winners list */}
      {winners.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Award className="h-4 w-4 text-yellow-500" />
              {t('owner.lb.winners')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {winners.map((w, i) => (
              <div key={w.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/30">
                <span className={cn("w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold", i === 0 && "bg-yellow-500/20 text-yellow-400", i === 1 && "bg-slate-400/20 text-slate-300", i === 2 && "bg-amber-700/20 text-amber-600", i > 2 && "bg-muted text-muted-foreground")}>
                  #{w.rank}
                </span>
                <Avatar className="h-7 w-7">
                  <AvatarImage src={w.avatar_url || undefined} />
                  <AvatarFallback className="text-[10px]">{(w.first_name || '?').charAt(0)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <span className="text-sm truncate">{[w.first_name, w.last_name].filter(Boolean).join(' ') || 'Anonymous'}</span>
                  <span className="text-xs text-muted-foreground ml-2">{Math.round(w.score).toLocaleString()} pts</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px]">{getRewardLabel(w.reward_type, language)}</Badge>
                  {w.redeemed ? (
                    <Badge className="text-[10px] bg-green-500/20 text-green-400"><Check className="h-2.5 w-2.5 mr-0.5" />{t('owner.lb.used')}</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">{t('owner.lb.pending')}</Badge>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Current ranking */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {t('owner.lb.currentRanking')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rankedScores.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">{t('owner.lb.noParticipants')}</p>
          ) : (
            <div className="space-y-2">
              {rankedScores.map((score, i) => {
                const name = score.leaderboard_visibility === 'hidden' ? (t('owner.lb.hidden'))
                  : score.leaderboard_visibility === 'anonymous' ? anonymizeName(score.first_name || null, score.last_name || null)
                    : [score.first_name, score.last_name].filter(Boolean).join(' ') || 'Anonymous';
                return (
                  <div key={score.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30">
                    <span className={cn("w-6 h-6 rounded flex items-center justify-center text-xs font-bold", i === 0 && "bg-yellow-500/20 text-yellow-400", i === 1 && "bg-slate-400/20 text-slate-300", i === 2 && "bg-amber-700/20 text-amber-600", i > 2 && "bg-muted text-muted-foreground")}>
                      {score.rank || i + 1}
                    </span>
                    <span className="text-sm flex-1 truncate">{name}</span>
                    <span className="text-xs font-semibold text-muted-foreground">{Math.round(score.score).toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
