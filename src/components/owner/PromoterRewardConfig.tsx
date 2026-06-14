import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Gift, Target, Wine, Ticket, Crown, Euro } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

export type RewardType = 'money' | 'free_entry' | 'vip' | 'drinks';
export type ConditionType = 'tickets' | 'drinks' | 'tables' | 'revenue' | 'none';

interface RewardConfig {
  reward_type: RewardType;
  reward_config: {
    drinkCount?: number;
    drinkCategory?: string;
    vipType?: string;
    entryCount?: number;
  };
  min_condition_type: ConditionType | null;
  min_condition_value: number;
}

interface PromoterRewardConfigProps {
  value: RewardConfig;
  onChange: (config: RewardConfig) => void;
}

export function PromoterRewardConfig({ value, onChange }: PromoterRewardConfigProps) {
  const { t } = useLanguage();
  const handleRewardTypeChange = (type: RewardType) => {
    onChange({
      ...value,
      reward_type: type,
      reward_config: {},
    });
  };

  const handleConditionTypeChange = (type: string) => {
    onChange({
      ...value,
      min_condition_type: type === 'none' ? null : type as ConditionType,
      min_condition_value: type === 'none' ? 0 : value.min_condition_value,
    });
  };

  const handleConditionValueChange = (val: number) => {
    onChange({
      ...value,
      min_condition_value: val,
    });
  };

  const handleRewardConfigChange = (key: string, val: any) => {
    onChange({
      ...value,
      reward_config: {
        ...value.reward_config,
        [key]: val,
      },
    });
  };

  return (
    <div className="space-y-4">
      {/* Reward Type Selection */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Gift className="h-4 w-4 text-primary" />
            {t('rewardCfg.rewardType')}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2 space-y-4">
          <Select
            value={value.reward_type}
            onValueChange={(v) => handleRewardTypeChange(v as RewardType)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('rewardCfg.chooseRewardType')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="money">
                <div className="flex items-center gap-2">
                  <Euro className="h-4 w-4" />
                  {t('rewardCfg.money')}
                </div>
              </SelectItem>
              <SelectItem value="free_entry">
                <div className="flex items-center gap-2">
                  <Ticket className="h-4 w-4" />
                  {t('rewardCfg.freeEntry')}
                </div>
              </SelectItem>
              <SelectItem value="vip">
                <div className="flex items-center gap-2">
                  <Crown className="h-4 w-4" />
                  {t('rewardCfg.vipAccess')}
                </div>
              </SelectItem>
              <SelectItem value="drinks">
                <div className="flex items-center gap-2">
                  <Wine className="h-4 w-4" />
                  {t('rewardCfg.freeDrinks')}
                </div>
              </SelectItem>
            </SelectContent>
          </Select>

          {/* Reward specific config */}
          {value.reward_type === 'drinks' && (
            <div className="p-3 bg-muted/50 rounded-lg space-y-3">
              <div>
                <Label className="text-xs">{t('rewardCfg.drinkCount')}</Label>
                <Input
                  type="number"
                  min={1}
                  value={value.reward_config.drinkCount || 1}
                  onChange={(e) => handleRewardConfigChange('drinkCount', parseInt(e.target.value) || 1)}
                />
              </div>
              <div>
                <Label className="text-xs">{t('rewardCfg.categoryOptional')}</Label>
                <Select
                  value={value.reward_config.drinkCategory || 'all'}
                  onValueChange={(v) => handleRewardConfigChange('drinkCategory', v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('rewardCfg.allDrinks')}</SelectItem>
                    <SelectItem value="drink">{t('rewardCfg.drinksOnly')}</SelectItem>
                    <SelectItem value="shot">{t('rewardCfg.shotsOnly')}</SelectItem>
                    <SelectItem value="soft">{t('rewardCfg.softsOnly')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {value.reward_type === 'free_entry' && (
            <div className="p-3 bg-muted/50 rounded-lg">
              <Label className="text-xs">{t('rewardCfg.freeEntryCount')}</Label>
              <Input
                type="number"
                min={1}
                value={value.reward_config.entryCount || 1}
                onChange={(e) => handleRewardConfigChange('entryCount', parseInt(e.target.value) || 1)}
              />
            </div>
          )}

          {value.reward_type === 'vip' && (
            <div className="p-3 bg-muted/50 rounded-lg">
              <Label className="text-xs">{t('rewardCfg.vipAccessType')}</Label>
              <Select
                value={value.reward_config.vipType || 'standard'}
                onValueChange={(v) => handleRewardConfigChange('vipType', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">{t('rewardCfg.vipStandard')}</SelectItem>
                  <SelectItem value="table">{t('rewardCfg.vipTable')}</SelectItem>
                  <SelectItem value="premium">{t('rewardCfg.vipPremium')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Minimum Condition */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            {t('rewardCfg.minCondition')}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2 space-y-4">
          <p className="text-xs text-muted-foreground">
            {t('rewardCfg.minConditionDesc')}
          </p>
          
          <Select
            value={value.min_condition_type || 'none'}
            onValueChange={handleConditionTypeChange}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('rewardCfg.noCondition')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('rewardCfg.noCondition')}</SelectItem>
              <SelectItem value="tickets">{t('rewardCfg.ticketsSold')}</SelectItem>
              <SelectItem value="drinks">{t('rewardCfg.drinksSold')}</SelectItem>
              <SelectItem value="tables">{t('rewardCfg.tablesBooked')}</SelectItem>
              <SelectItem value="revenue">{t('rewardCfg.revenueEur')}</SelectItem>
            </SelectContent>
          </Select>

          {value.min_condition_type && value.min_condition_type !== 'none' && (
            <div className="p-3 bg-muted/50 rounded-lg">
              <Label className="text-xs">
                {value.min_condition_type === 'tickets' && t('rewardCfg.minTickets')}
                {value.min_condition_type === 'drinks' && t('rewardCfg.minDrinks')}
                {value.min_condition_type === 'tables' && t('rewardCfg.minTables')}
                {value.min_condition_type === 'revenue' && t('rewardCfg.minRevenue')}
              </Label>
              <Input
                type="number"
                min={1}
                value={value.min_condition_value}
                onChange={(e) => handleConditionValueChange(parseInt(e.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground mt-2">
                {t('rewardCfg.goalNote')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
