import { useEffect, useState } from 'react';
import { PauseCircle, Send, TrendingUp, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useStudio } from './store';
import { useSendProgress } from './hooks';
import {
  BORDER, FONT_UI, GhostBtn, Help, PrimaryBtn, RED,
  RED_SOFT_GRAD, SUBTLE, T1, T2, T3, WARN,
} from './ui';

/** Écran Envoi : carte centrée, progression réelle, CA attribué (prototype). */
export default function SendingStep({ onExit, onStudio }: { onExit: () => void; onStudio: () => void }) {
  const { t } = useLanguage();
  const campaign = useStudio((s) => s.campaign);
  const progress = useSendProgress(campaign.id, true);
  const [revenue, setRevenue] = useState<number | null>(null);

  const total = progress?.total ?? 0;
  const sent = progress?.sent ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;
  const status = progress?.status || 'sending';
  const finished = status === 'sent';
  const failed = status === 'failed' || status === 'cancelled';
  const paused = status === 'paused';

  // CA attribué : chargé quand la campagne est terminée.
  useEffect(() => {
    if (!finished) return;
    let cancelled = false;
    (async () => {
      const { data: row } = await supabase.from('email_campaigns')
        .select('venue_id, organizer_user_id').eq('id', campaign.id).maybeSingle();
      if (!row || cancelled) return;
      const subjectType = row.venue_id ? 'venue' : 'organizer';
      const subjectId = row.venue_id || row.organizer_user_id;
      if (!subjectId) return;
      try {
        const { data: attr } = await supabase.rpc('get_email_campaign_attribution' as never, {
          p_subject_type: subjectType, p_subject_id: subjectId,
        } as never);
        const payload = attr as unknown as { supported?: boolean; campaigns?: Array<{ id: string; revenue: number }> } | null;
        if (!cancelled && payload?.supported) {
          const mine = (payload.campaigns || []).find((c) => c.id === campaign.id);
          setRevenue(mine ? mine.revenue : 0);
        }
      } catch { /* tuiles absentes */ }
    })();
    return () => { cancelled = true; };
  }, [finished, campaign.id]);

  return (
    <div style={{
      height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', padding: 40,
    }}>
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(232,25,44,0.12) 0%, transparent 60%)',
      }} />
      <div className="yn-in" style={{
        position: 'relative', width: 560, maxWidth: '100%',
        background: 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c',
        border: `1px solid ${BORDER}`, borderRadius: 20,
        boxShadow: '0 1px 0 rgba(255,255,255,.05) inset,0 40px 80px -40px #000',
        padding: 28,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 12, display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: 'rgba(232,25,44,0.12)',
            border: '1px solid rgba(232,25,44,0.25)', color: RED,
          }}>
            {failed ? <XCircle size={16} strokeWidth={1.75} />
              : paused ? <PauseCircle size={16} strokeWidth={1.75} />
                : <Send size={16} strokeWidth={1.75} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: T1, fontSize: 17, fontWeight: 640, letterSpacing: '-0.02em', fontFamily: FONT_UI }}>
              {finished ? t('studio.sending.done')
                : failed ? t('studio.sending.failed')
                  : paused ? t('studio.sending.paused')
                    : t('studio.sending.inProgress')}
            </div>
            <div style={{
              color: T3, fontSize: 12, marginTop: 2, fontFamily: FONT_UI,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {campaign.name} · {campaign.subject}
            </div>
          </div>
          <div style={{ color: T1, fontSize: 18, fontWeight: 640, fontVariantNumeric: 'tabular-nums', fontFamily: FONT_UI }}>
            {pct} %
          </div>
        </div>

        <div style={{ height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.06)', margin: '20px 0 22px', overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${pct}%`, borderRadius: 999,
            background: finished ? '#34D399' : 'linear-gradient(90deg,rgba(232,25,44,0.9),rgba(232,25,44,0.45))',
            transition: 'width .25s',
          }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
          <Stat label={t('studio.sending.sent')} value={sent} />
          <Stat label={t('studio.sending.opens')} value={progress?.opens ?? 0} />
          <Stat label={t('studio.sending.clicks')} value={progress?.clicks ?? 0} />
        </div>

        {paused && (
          <Help style={{ color: WARN, marginTop: 14 }}>
            {progress?.paused_reason === 'complaint_rate' || progress?.paused_reason === 'bounce_rate'
              ? t('studio.sending.pausedBreaker')
              : progress?.error_message || t('studio.sending.pausedGeneric')}
          </Help>
        )}
        {!finished && !failed && !paused && (
          <Help style={{ marginTop: 14 }}>{t('studio.sending.backgroundNote')}</Help>
        )}

        {finished && revenue != null && (
          <div style={{
            marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, padding: '13px 15px',
            borderRadius: 14, background: RED_SOFT_GRAD, border: '1px solid rgba(232,25,44,0.22)',
          }}>
            <TrendingUp size={15} strokeWidth={1.75} style={{ color: RED, flex: 'none' }} />
            <span style={{ flex: 1, color: T2, fontSize: 12, fontFamily: FONT_UI }}>{t('studio.sending.revenue')}</span>
            <span style={{ color: T1, fontSize: 16, fontWeight: 640, fontVariantNumeric: 'tabular-nums', fontFamily: FONT_UI }}>
              {revenue.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 9, marginTop: 18 }}>
          <GhostBtn onClick={onExit} style={{ flex: 1, justifyContent: 'center', padding: 11, background: SUBTLE }}>
            {t('studio.sending.backToList')}
          </GhostBtn>
          <PrimaryBtn onClick={onStudio} style={{ flex: 1, justifyContent: 'center', padding: 11 }}>
            {t('studio.sending.openStudio')}
          </PrimaryBtn>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ padding: 14, borderRadius: 14, background: SUBTLE, border: `1px solid ${BORDER}` }}>
      <div style={{ color: T3, fontSize: 10.5, letterSpacing: '0.07em', textTransform: 'uppercase', fontFamily: FONT_UI }}>{label}</div>
      <div style={{ color: T1, fontSize: 22, fontWeight: 640, marginTop: 5, fontVariantNumeric: 'tabular-nums', fontFamily: FONT_UI }}>
        {value.toLocaleString('fr-FR')}
      </div>
    </div>
  );
}
