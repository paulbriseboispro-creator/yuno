/**
 * Solde de crédits de campagnes push manuelles (moteur de notifications,
 * 2026-09-30). 1 crédit = 1 campagne marketing ; les messages pratiques aux
 * détenteurs d'une soirée sont gratuits. Plus de crédits = une demande au
 * super admin (pas d'achat : Yuno garde la main sur la pression push).
 */
import { useState } from 'react';
import { Coins, Gift, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { KIT, useNumberFormat } from '@/components/analytics/kitFormat';
import { ReportCard } from '@/components/event-report/ui';
import { INNER_BG } from '@/components/event-report/tokens';
import type { PushCredits } from '@/lib/pushEngine';
import type { PushCreditsScope } from '@/hooks/usePushCenter';

export default function PushCreditsCard({ credits, loading, scope, onChanged, compact }: {
  credits: PushCredits | null;
  loading: boolean;
  scope: PushCreditsScope;
  onChanged: () => void;
  compact?: boolean;
}) {
  const { t } = useLanguage();
  const { n, locale } = useNumberFormat();
  const [requesting, setRequesting] = useState(false);

  const request = async () => {
    setRequesting(true);
    try {
      const { error } = await supabase.rpc('request_push_credits' as never, {
        p_venue_id: scope.venueId ?? undefined,
        p_organizer_user_id: scope.organizerUserId ?? undefined,
        p_agency_id: scope.agencyId ?? undefined,
      } as never);
      if (error) throw error;
      toast.success(t('pe.credits.requested'));
      onChanged();
    } catch {
      toast.error(t('pe.credits.requestError'));
    } finally {
      setRequesting(false);
    }
  };

  if (loading && !credits) {
    return (
      <ReportCard padding={16}>
        <div className="flex items-center gap-2" style={{ color: KIT.T3, fontSize: 12.5 }}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('pe.credits.loading')}
        </div>
      </ReportCard>
    );
  }
  if (!credits) return null;

  const monthlyLeft = Math.max(0, credits.allowance - credits.used);
  const resets = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(new Date(credits.resetsAt));
  const empty = credits.remaining <= 0;

  return (
    <ReportCard padding={compact ? 16 : 20}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl"
            style={{ background: empty ? 'rgba(232,25,44,0.1)' : 'rgba(52,211,153,0.1)', border: `1px solid ${empty ? 'rgba(232,25,44,0.25)' : 'rgba(52,211,153,0.25)'}` }}>
            <Coins className="h-4 w-4" style={{ color: empty ? KIT.RED : KIT.POS }} />
          </div>
          <div className="min-w-0">
            <p style={{ color: KIT.T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
              {t('pe.credits.title')}
            </p>
            <p className="tabular-nums" style={{ color: KIT.T1, fontSize: 26, fontWeight: 650, letterSpacing: '-0.02em', lineHeight: 1.15, marginTop: 2 }}>
              {(credits.remaining === 1 ? t('pe.credits.leftOne') : t('pe.credits.left')).replace('{n}', n(credits.remaining))}
            </p>
            <p style={{ color: KIT.T3, fontSize: 12, marginTop: 3, lineHeight: 1.45 }}>
              {t('pe.credits.monthly')
                .replace('{left}', n(monthlyLeft))
                .replace('{allowance}', n(credits.allowance))
                .replace('{date}', resets)}
              {credits.bonus > 0 && (
                <span className="inline-flex items-center gap-1" style={{ color: KIT.POS, marginLeft: 6 }}>
                  <Gift className="h-3 w-3" />{t('pe.credits.bonus').replace('{n}', n(credits.bonus))}
                </span>
              )}
            </p>
          </div>
        </div>
        {(empty || !compact) && (
          <button
            type="button"
            onClick={request}
            disabled={requesting || credits.requestedToday}
            className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12.5px] font-semibold transition-opacity"
            style={{ background: INNER_BG, border: `1px solid ${KIT.BORDER}`, color: KIT.T1, opacity: requesting || credits.requestedToday ? 0.55 : 1 }}
          >
            {requesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {credits.requestedToday ? t('pe.credits.requestedToday') : t('pe.credits.request')}
          </button>
        )}
      </div>
      {!compact && (
        <ul className="mt-4 grid gap-2 sm:grid-cols-3" style={{ color: KIT.T2, fontSize: 12, lineHeight: 1.45 }}>
          <li className="rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${KIT.BORDER}` }}>
            <b style={{ color: KIT.T1 }}>{t('pe.credits.rule1Title')}</b><br />{t('pe.credits.rule1')}
          </li>
          <li className="rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${KIT.BORDER}` }}>
            <b style={{ color: KIT.T1 }}>{t('pe.credits.rule2Title')}</b><br />
            {t('pe.credits.rule2').replace('{n}', n(credits.eventInfoPerEvent))}
          </li>
          <li className="rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${KIT.BORDER}` }}>
            <b style={{ color: KIT.T1 }}>{t('pe.credits.rule3Title')}</b><br />
            {(credits.marketingPer24h === 1 ? t('pe.credits.rule3One') : t('pe.credits.rule3')).replace('{n}', n(credits.marketingPer24h))}
          </li>
        </ul>
      )}
    </ReportCard>
  );
}
