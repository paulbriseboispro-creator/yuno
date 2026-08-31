import { CheckCircle2, Loader2, PauseCircle, XCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useStudio } from './store';
import { useSendProgress } from './hooks';
import { BORDER, FONT_UI, GhostBtn, Help, MicroLabel, RED, SUBTLE, T1, T2, T3 } from './ui';

/** Écran Envoi en cours : progression réelle (envoyés / total, %). */
export default function SendingStep({ onExit }: { onExit: () => void }) {
  const { t } = useLanguage();
  const campaign = useStudio((s) => s.campaign);
  const progress = useSendProgress(campaign.id, true);

  const total = progress?.total ?? 0;
  const sent = progress?.sent ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;
  const status = progress?.status || 'sending';

  const finished = status === 'sent';
  const failed = status === 'failed' || status === 'cancelled';
  const paused = status === 'paused';

  return (
    <div className="yn-in" style={{ maxWidth: 560, margin: '40px auto 0', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ background: SUBTLE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {finished ? (
            <CheckCircle2 size={18} strokeWidth={1.75} style={{ color: '#34D399' }} />
          ) : failed ? (
            <XCircle size={18} strokeWidth={1.75} style={{ color: '#FF5C63' }} />
          ) : paused ? (
            <PauseCircle size={18} strokeWidth={1.75} style={{ color: '#FCD34D' }} />
          ) : (
            <span style={{ width: 10, height: 10, borderRadius: 9999, background: RED, color: RED }} className="yn-ping" />
          )}
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T1, fontFamily: FONT_UI }}>
              {finished ? t('studio.sending.done')
                : failed ? t('studio.sending.failed')
                  : paused ? t('studio.sending.paused')
                    : t('studio.sending.inProgress')}
            </div>
            <div style={{ fontSize: 11.5, color: T3, fontFamily: FONT_UI }}>{campaign.subject}</div>
          </div>
        </div>

        {/* Barre de progression réelle */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <MicroLabel>{t('studio.sending.progress')}</MicroLabel>
            <span style={{ fontSize: 11.5, color: T2, fontFamily: FONT_UI, fontVariantNumeric: 'tabular-nums' }}>
              {progress ? `${sent} / ${total} · ${pct}%` : <Loader2 size={12} className="animate-spin" />}
            </span>
          </div>
          <div style={{ height: 7, borderRadius: 9999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${pct}%`, borderRadius: 9999,
              background: finished ? '#34D399' : RED,
              boxShadow: finished ? 'none' : `0 0 14px -3px ${RED}`,
              transition: 'width .6s ease',
            }} />
          </div>
        </div>

        {progress && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            <Stat label={t('studio.sending.sent')} value={sent} />
            <Stat label={t('studio.sending.delivered')} value={progress.delivered} />
            <Stat label={t('studio.sending.failedCount')} value={progress.failed} />
            <Stat label={t('studio.sending.suppressed')} value={progress.suppressed} />
          </div>
        )}

        {paused && (
          <Help style={{ color: '#FCD34D' }}>
            {progress?.paused_reason === 'complaint_rate' || progress?.paused_reason === 'bounce_rate'
              ? t('studio.sending.pausedBreaker')
              : progress?.error_message || t('studio.sending.pausedGeneric')}
          </Help>
        )}
        {!finished && !failed && !paused && (
          <Help>{t('studio.sending.backgroundNote')}</Help>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <GhostBtn onClick={onExit}>{t('studio.sending.backToList')}</GhostBtn>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${BORDER}`, borderRadius: 9, padding: '8px 10px' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: T1, fontFamily: FONT_UI, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 10, color: T3, fontFamily: FONT_UI, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
    </div>
  );
}
