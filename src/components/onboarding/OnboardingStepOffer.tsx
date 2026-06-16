import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { DrinkCatalogSearch } from '@/components/DrinkCatalogSearch';
import { Wine, Ticket, Sofa, Check, Plus, ArrowRight, CalendarPlus, ExternalLink } from 'lucide-react';
import type { Pillar } from '@/hooks/useOwnerOnboarding';
import { StepHeader, PrimaryButton, GhostButton, InnerCard, FieldLabel, POS, T1, T2, T3 } from './onboardingUI';

interface Props {
  venueId: string;
  pillars: Pillar[];
  onComplete: () => void;
}

export function OnboardingStepOffer({ venueId, pillars, onComplete }: Props) {
  const { t } = useLanguage();
  const [drinkCount, setDrinkCount] = useState(0);
  const [eventCount, setEventCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Inline event form
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('22:00');
  const [creating, setCreating] = useState(false);

  const wantsDrinks = pillars.includes('drinks');
  const wantsEvents = pillars.includes('tickets') || pillars.includes('tables');

  const refetch = useCallback(async () => {
    const [{ count: dc }, { count: ec }] = await Promise.all([
      supabase.from('drinks').select('id', { count: 'exact', head: true }).eq('venue_id', venueId),
      supabase.from('events').select('id', { count: 'exact', head: true }).eq('venue_id', venueId),
    ]);
    setDrinkCount(dc ?? 0);
    setEventCount(ec ?? 0);
    setLoading(false);
  }, [venueId]);

  useEffect(() => { refetch(); }, [refetch]);

  const handleCreateEvent = async () => {
    if (!title.trim() || !date) return;
    setCreating(true);
    try {
      const start = new Date(`${date}T${time || '22:00'}`);
      const end = new Date(start.getTime() + 6 * 60 * 60 * 1000);
      const { error } = await supabase.from('events').insert({
        title: title.trim(),
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        venue_id: venueId,
        is_active: true,
        ticketing_enabled: pillars.includes('tickets'),
        tables_enabled: pillars.includes('tables'),
      } as any);
      if (error) throw error;
      setTitle('');
      setDate('');
      toast.success(t('onboarding.eventCreatedToast'));
      await refetch();
    } catch {
      toast.error(t('onboarding.saveError'));
    } finally {
      setCreating(false);
    }
  };

  const drinksOk = !wantsDrinks || drinkCount > 0;
  const eventOk = !wantsEvents || eventCount > 0;
  const canContinue = drinksOk && eventOk;

  return (
    <div className="space-y-6">
      <StepHeader icon={Wine} title={t('onboarding.step4Title')} subtitle={t('onboarding.step4Desc')} />

      {/* Drinks pillar */}
      {wantsDrinks && (
        <InnerCard>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-none" style={{ background: 'rgba(255,255,255,0.05)', color: T2 }}>
                <Wine className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t('onboarding.offerDrinksTitle')}</div>
                <div style={{ color: T3, fontSize: 12 }}>{t('onboarding.offerDrinksDesc')}</div>
              </div>
            </div>
            {drinkCount > 0 && (
              <span className="inline-flex items-center gap-1.5 flex-none tabular-nums" style={{ color: POS, fontSize: 13, fontWeight: 600 }}>
                <Check className="w-4 h-4" />
                {drinkCount}
              </span>
            )}
          </div>
          <DrinkCatalogSearch venueId={venueId} onDrinkAdded={refetch} />
          {drinkCount > 0 && (
            <Link to="/owner/menu" className="inline-flex items-center gap-1 mt-3 text-[12px] font-medium transition-opacity hover:opacity-80" style={{ color: T2 }}>
              {t('onboarding.manageFullMenu')}
              <ExternalLink className="w-3 h-3" />
            </Link>
          )}
        </InnerCard>
      )}

      {/* Tickets / Tables pillar → first event */}
      {wantsEvents && (
        <InnerCard>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-none" style={{ background: 'rgba(255,255,255,0.05)', color: T2 }}>
                {pillars.includes('tickets') ? <Ticket className="w-4 h-4" /> : <Sofa className="w-4 h-4" />}
              </div>
              <div className="min-w-0">
                <div style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t('onboarding.offerEventTitle')}</div>
                <div style={{ color: T3, fontSize: 12 }}>{t('onboarding.offerEventDesc')}</div>
              </div>
            </div>
            {eventCount > 0 && (
              <span className="inline-flex items-center gap-1.5 flex-none tabular-nums" style={{ color: POS, fontSize: 13, fontWeight: 600 }}>
                <Check className="w-4 h-4" />
                {eventCount}
              </span>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <FieldLabel>{t('onboarding.eventNameLabel')}</FieldLabel>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('onboarding.eventNamePlaceholder')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>{t('onboarding.eventDateLabel')}</FieldLabel>
                <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div>
                <FieldLabel>{t('onboarding.eventTimeLabel')}</FieldLabel>
                <Input type="time" value={time} onChange={e => setTime(e.target.value)} />
              </div>
            </div>
            <GhostButton
              icon={CalendarPlus}
              loading={creating}
              onClick={handleCreateEvent}
              disabled={!title.trim() || !date}
              style={{ color: T1 }}
            >
              {t('onboarding.createEventBtn')}
            </GhostButton>
          </div>

          {eventCount > 0 && (
            <Link to="/owner/events" className="inline-flex items-center gap-1 mt-3 text-[12px] font-medium transition-opacity hover:opacity-80" style={{ color: T2 }}>
              {t('onboarding.manageTicketsTables')}
              <ExternalLink className="w-3 h-3" />
            </Link>
          )}
        </InnerCard>
      )}

      {!loading && !canContinue && (
        <p style={{ color: T3, fontSize: 12.5, lineHeight: 1.45 }}>{t('onboarding.offerHint')}</p>
      )}

      <PrimaryButton fullWidth icon={canContinue ? ArrowRight : Plus} onClick={onComplete} disabled={!canContinue}>
        {t('onboarding.continue')}
      </PrimaryButton>
    </div>
  );
}
