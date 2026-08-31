import { CalendarClock, ShieldCheck, Sparkles, Split, Zap } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useStudio } from './store';
import {
  BORDER, FlowCard, FONT_UI, MicroLabel, RED, RED_SOFT_GRAD, StatusBadge, SUBTLE,
  Switch, T1, T2, T3, ToggleRow, inputStyle,
} from './ui';

/** Écran Planification : quand partir, délivrabilité, A/B (prototype). */
export default function ScheduleStep() {
  const { t } = useLanguage();
  const campaign = useStudio((s) => s.campaign);
  const patchCampaign = useStudio((s) => s.patchCampaign);

  const mode: 'now' | 'later' = campaign.scheduledAt ? 'later' : 'now';
  const [datePart, timePart] = (campaign.scheduledAt || 'T').split('T');

  const setSchedule = () => {
    if (!campaign.scheduledAt) {
      const in2h = new Date(Date.now() + 2 * 3_600_000);
      in2h.setMinutes(0, 0, 0);
      const pad = (n: number) => String(n).padStart(2, '0');
      patchCampaign({
        scheduledAt: `${in2h.getFullYear()}-${pad(in2h.getMonth() + 1)}-${pad(in2h.getDate())}T${pad(in2h.getHours())}:00`,
      });
    }
  };

  return (
    <div className="yn-in" style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── Quand partir ? ── */}
      <FlowCard>
        <h3 style={{ margin: '0 0 4px', color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', fontFamily: FONT_UI }}>
          {t('studio.sched.when')}
        </h3>
        <p style={{ margin: '0 0 16px', color: T3, fontSize: 11.5, fontFamily: FONT_UI }}>
          {t('studio.sched.whenHint')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <ModeCard
            on={mode === 'now'}
            onClick={() => patchCampaign({ scheduledAt: null })}
            icon={<Zap size={16} strokeWidth={1.75} />}
            title={t('studio.sched.now')}
            desc={t('studio.sched.nowHelp')}
          />
          <ModeCard
            on={mode === 'later'}
            onClick={setSchedule}
            icon={<CalendarClock size={16} strokeWidth={1.75} />}
            title={t('studio.sched.later')}
            desc={t('studio.sched.laterHelp')}
          />
          <ModeCard
            on={false}
            disabled
            icon={<Sparkles size={16} strokeWidth={1.75} />}
            title={t('studio.sched.sto')}
            desc={t('studio.sched.stoHelp')}
            badge={t('studio.sched.soon')}
          />
        </div>

        {mode === 'later' && (
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginTop: 14 }}>
            <div>
              <MicroLabel style={{ marginBottom: 7 }}>{t('studio.sched.date')}</MicroLabel>
              <input
                type="date"
                value={datePart || ''}
                onChange={(e) => patchCampaign({ scheduledAt: `${e.target.value}T${timePart || '18:30'}` })}
                aria-label={t('studio.sched.date')}
                style={{ ...inputStyle, colorScheme: 'dark' }}
              />
            </div>
            <div>
              <MicroLabel style={{ marginBottom: 7 }}>{t('studio.sched.time')}</MicroLabel>
              <input
                type="time"
                value={timePart || ''}
                onChange={(e) => patchCampaign({ scheduledAt: `${datePart || new Date().toISOString().slice(0, 10)}T${e.target.value}` })}
                aria-label={t('studio.sched.time')}
                style={{ ...inputStyle, colorScheme: 'dark' }}
              />
            </div>
          </div>
        )}
      </FlowCard>

      {/* ── Délivrabilité ── */}
      <FlowCard style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ margin: 0, color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', fontFamily: FONT_UI }}>
          {t('studio.sched.deliverability')}
        </h3>
        <ToggleRow
          checked={campaign.throttlePerHour != null}
          onChange={(v) => patchCampaign({ throttlePerHour: v ? 1000 : null })}
          label={t('studio.sched.throttle')}
          help={t('studio.sched.throttleHelp')}
        />
        <ToggleRow
          checked={campaign.quietHours}
          onChange={(v) => patchCampaign({ quietHours: v })}
          label={t('studio.sched.quiet')}
          help={t('studio.sched.quietHelp')}
        />
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 9, padding: '11px 13px', borderRadius: 12,
          background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.2)',
        }}>
          <ShieldCheck size={14} strokeWidth={1.75} style={{ color: '#34D399', marginTop: 1, flex: 'none' }} />
          <span style={{ color: T2, fontSize: 11.5, lineHeight: 1.5, fontFamily: FONT_UI }}>
            {t('studio.sched.domainOkPre')} <span style={{ color: T1 }}>yunoapp.eu</span> {t('studio.sched.domainOkPost')}
          </span>
        </div>
      </FlowCard>

      {/* ── A/B ── */}
      <FlowCard style={{ display: 'flex', alignItems: 'center', gap: 14, flexDirection: 'row' }}>
        <div style={{
          width: 32, height: 32, borderRadius: 11, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'rgba(232,25,44,0.1)',
          border: '1px solid rgba(232,25,44,0.2)', color: RED, flex: 'none',
        }}><Split size={16} strokeWidth={1.75} /></div>
        <div style={{ flex: 1 }}>
          <div style={{ color: T1, fontSize: 13, fontWeight: 560, fontFamily: FONT_UI }}>{t('studio.data.abToggle')}</div>
          <div style={{ color: T3, fontSize: 11.5, marginTop: 2, fontFamily: FONT_UI }}>{t('studio.sched.abSub')}</div>
        </div>
        <Switch
          checked={campaign.abOn}
          onChange={(v) => patchCampaign({ abOn: v })}
          ariaLabel={t('studio.data.abToggle')}
        />
      </FlowCard>
    </div>
  );
}

function ModeCard({ on, onClick, icon, title, desc, badge, disabled }: {
  on: boolean; onClick?: () => void; icon: React.ReactNode; title: string; desc: string;
  badge?: string; disabled?: boolean;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} aria-pressed={on}
      style={{
        display: 'flex', gap: 12, alignItems: 'flex-start', padding: '15px 16px', borderRadius: 14,
        cursor: disabled ? 'default' : 'pointer', textAlign: 'left', width: '100%',
        background: on ? RED_SOFT_GRAD : SUBTLE,
        border: `1px solid ${on ? 'rgba(232,25,44,0.28)' : BORDER}`,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 11, display: 'flex', alignItems: 'center',
        justifyContent: 'center', flex: 'none',
        background: on ? 'rgba(232,25,44,0.12)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${on ? 'rgba(232,25,44,0.25)' : BORDER}`,
        color: on ? RED : T3,
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: on ? T1 : T2, fontSize: 13.5, fontWeight: 560, fontFamily: FONT_UI }}>{title}</span>
          {badge && <StatusBadge label={badge} tone="neutral" />}
        </div>
        <div style={{ color: T3, fontSize: 11.5, marginTop: 2, fontFamily: FONT_UI }}>{desc}</div>
      </div>
      <span style={{
        width: 16, height: 16, borderRadius: '50%', flex: 'none', marginTop: 2,
        border: `1px solid ${on ? RED : 'rgba(255,255,255,0.2)'}`,
        background: on ? RED : 'transparent',
        boxShadow: on ? 'inset 0 0 0 3px #0a0a0c' : 'none',
      }} />
    </button>
  );
}
