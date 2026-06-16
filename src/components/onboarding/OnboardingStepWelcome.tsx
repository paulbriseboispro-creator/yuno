import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Ticket, Sofa, Wine, Check, Clock, ArrowRight } from 'lucide-react';
import type { Pillar } from '@/hooks/useOwnerOnboarding';
import { StepHeader, PrimaryButton, RED, T1, T2, T3, POS, BORDER, TILE_BG } from './onboardingUI';

interface Props {
  venueId: string;
  initialPillars: Pillar[];
  onComplete: (pillars: Pillar[]) => void;
}

const PILLAR_DEFS: { key: Pillar; icon: typeof Ticket; titleKey: string; descKey: string }[] = [
  { key: 'tickets', icon: Ticket, titleKey: 'onboarding.pillarTickets', descKey: 'onboarding.pillarTicketsDesc' },
  { key: 'tables', icon: Sofa, titleKey: 'onboarding.pillarTables', descKey: 'onboarding.pillarTablesDesc' },
  { key: 'drinks', icon: Wine, titleKey: 'onboarding.pillarDrinks', descKey: 'onboarding.pillarDrinksDesc' },
];

export function OnboardingStepWelcome({ venueId, initialPillars, onComplete }: Props) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState<Pillar[]>(initialPillars);
  const [saving, setSaving] = useState(false);

  const toggle = (p: Pillar) =>
    setSelected(prev => (prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]));

  const handleContinue = async () => {
    if (selected.length === 0) return;
    setSaving(true);
    try {
      await supabase
        .from('venues')
        .update({
          menu_enabled: selected.includes('drinks'),
          vip_placement_enabled: selected.includes('tables'),
        } as any)
        .eq('id', venueId);
      onComplete(selected);
    } catch {
      toast.error(t('onboarding.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <StepHeader icon={Wine} accent title={t('onboarding.welcomeTitle')} subtitle={t('onboarding.welcomeSubtitle')} />

      {/* Time-to-value strip */}
      <div
        className="flex items-center gap-2 rounded-xl"
        style={{ padding: '10px 14px', background: 'rgba(232,25,44,0.07)', border: '1px solid rgba(232,25,44,0.18)' }}
      >
        <Clock className="w-4 h-4 flex-none" style={{ color: RED }} />
        <span style={{ color: T1, fontSize: 13, fontWeight: 500 }}>{t('onboarding.welcomeTime')}</span>
      </div>

      <div>
        <p style={{ color: T2, fontSize: 13.5, fontWeight: 600, marginBottom: 12 }}>{t('onboarding.pillarsQuestion')}</p>
        <div className="space-y-2.5">
          {PILLAR_DEFS.map(({ key, icon: Icon, titleKey, descKey }) => {
            const isOn = selected.includes(key);
            return (
              <button
                key={key}
                onClick={() => toggle(key)}
                className="w-full flex items-center gap-3.5 text-left rounded-2xl transition-all cursor-pointer"
                style={{
                  padding: '14px 16px',
                  background: isOn ? 'rgba(232,25,44,0.08)' : TILE_BG,
                  border: isOn ? '1px solid rgba(232,25,44,0.35)' : `1px solid ${BORDER}`,
                }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-none"
                  style={
                    isOn
                      ? { background: 'rgba(232,25,44,0.14)', color: RED }
                      : { background: 'rgba(255,255,255,0.05)', color: T2 }
                  }
                >
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div style={{ color: T1, fontSize: 14.5, fontWeight: 600 }}>{t(titleKey)}</div>
                  <div style={{ color: T3, fontSize: 12, marginTop: 2, lineHeight: 1.35 }}>{t(descKey)}</div>
                </div>
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center flex-none transition-all"
                  style={
                    isOn
                      ? { background: POS, color: '#04130d' }
                      : { border: `1.5px solid ${BORDER}` }
                  }
                >
                  {isOn && <Check className="w-3.5 h-3.5" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <PrimaryButton fullWidth icon={ArrowRight} onClick={handleContinue} disabled={selected.length === 0} loading={saving}>
        {t('onboarding.continue')}
      </PrimaryButton>
    </div>
  );
}
