import { useMemo } from 'react';
import { format, isSameMonth } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { Wallet } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { performerName, type DjSetPerformer } from '@/lib/djPayout';

const WARN = 'var(--acc-fcd34d)';
const POS = 'var(--acc-34d399)';
const T1 = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2 = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const T3 = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const BORDER = 'rgb(var(--ink)/0.085)';
const TILE_BG = 'rgb(var(--ink)/0.025)';
const CARD_BG = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';

interface FeeSet extends DjSetPerformer {
  id: string;
  start_time: string;
  fee: number;
  fee_paid: boolean;
  fee_paid_at?: string | null;
  payee_iban?: string | null;
  event?: { title: string } | null;
}

const VISIBLE = 5;

/**
 * Suivi interne des cachets : ce qui reste à virer, ce qui est parti ce mois-ci,
 * et un bouton « Payer » par cachet qui ouvre le virement prêt à copier.
 */
export function DJFeesOverview({ sets, onPay }: { sets: FeeSet[]; onPay: (setId: string) => void }) {
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const money = (n: number) => new Intl.NumberFormat(language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB', {
    style: 'currency', currency: 'EUR', maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
  }).format(n);

  const { due, dueTotal, paidMonth } = useMemo(() => {
    const withFee = sets.filter(s => (s.fee || 0) > 0);
    const dueSets = withFee
      .filter(s => !s.fee_paid)
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    const now = new Date();
    return {
      due: dueSets,
      dueTotal: dueSets.reduce((a, s) => a + s.fee, 0),
      paidMonth: withFee
        .filter(s => s.fee_paid && s.fee_paid_at && isSameMonth(new Date(s.fee_paid_at), now))
        .reduce((a, s) => a + s.fee, 0),
    };
  }, [sets]);

  if (!sets.some(s => (s.fee || 0) > 0)) return null;

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 18 }}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="m-0 flex items-center gap-2 text-[15px] font-semibold" style={{ color: T1, letterSpacing: '-0.01em' }}>
            <Wallet className="h-4 w-4" style={{ color: T3 }} />
            {t('djPay.overviewTitle')}
          </h3>
          <p className="m-0 mt-0.5 text-xs" style={{ color: T3 }}>{t('djPay.overviewSub')}</p>
        </div>
        <div className="flex gap-5 flex-none text-right">
          <div>
            <div className="text-[20px] font-[680] tabular-nums leading-none" style={{ color: dueTotal > 0 ? WARN : T1, letterSpacing: '-0.02em' }}>{money(dueTotal)}</div>
            <div className="text-[11px] mt-1" style={{ color: T3 }}>{t('djPay.toPay')}</div>
          </div>
          <div>
            <div className="text-[20px] font-[680] tabular-nums leading-none" style={{ color: paidMonth > 0 ? POS : T1, letterSpacing: '-0.02em' }}>{money(paidMonth)}</div>
            <div className="text-[11px] mt-1" style={{ color: T3 }}>{t('djPay.paidThisMonth')}</div>
          </div>
        </div>
      </div>

      {due.length === 0 ? (
        <p className="m-0 text-sm" style={{ color: T3 }}>{t('djPay.nothingDue')}</p>
      ) : (
        <div className="space-y-1.5">
          {due.slice(0, VISIBLE).map(s => (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ background: TILE_BG, border: `1px solid ${BORDER}` }}>
              <div className="min-w-0">
                <p className="m-0 text-sm font-[560] truncate" style={{ color: T1 }}>
                  {performerName(s) || '—'}
                  {!s.dj_id && <span className="ml-2 text-[10.5px] font-semibold" style={{ color: T3 }}>{t('djPay.externalBadge')}</span>}
                </p>
                <p className="m-0 text-xs truncate tabular-nums" style={{ color: T3 }}>
                  {format(new Date(s.start_time), 'd MMM', { locale: dateLocale })}
                  {s.event?.title ? ` · ${s.event.title}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2.5 flex-none">
                {!s.payee_iban && (
                  <span className="text-[10.5px] font-semibold rounded-full px-2 py-0.5" style={{ color: T2, border: `1px solid ${BORDER}` }}>
                    {t('djPay.missingIbanPill')}
                  </span>
                )}
                <span className="text-sm font-[640] tabular-nums" style={{ color: T1 }}>{money(s.fee)}</span>
                <button
                  type="button"
                  onClick={() => onPay(s.id)}
                  className="rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors hover:bg-white/[0.08]"
                  style={{ border: `1px solid ${BORDER}`, color: T1 }}
                >
                  {t('djPay.pay')}
                </button>
              </div>
            </div>
          ))}
          {due.length > VISIBLE && (
            <p className="m-0 pt-1 text-xs" style={{ color: T3 }}>{t('djPay.moreDue').replace('{n}', String(due.length - VISIBLE))}</p>
          )}
        </div>
      )}
    </div>
  );
}
