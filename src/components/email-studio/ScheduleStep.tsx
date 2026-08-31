import { CalendarClock, Moon, Zap } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useStudio } from './store';
import { BORDER, FONT_UI, Help, MicroLabel, SegBtns, SUBTLE, T1, TextInput, Toggle } from './ui';

const THROTTLE_CHOICES = [500, 1000, 2000, 5000];

/** Écran Planification : envoi immédiat ou planifié, throttling, quiet hours. */
export default function ScheduleStep() {
  const { t } = useLanguage();
  const campaign = useStudio((s) => s.campaign);
  const patchCampaign = useStudio((s) => s.patchCampaign);

  const mode: 'now' | 'later' = campaign.scheduledAt ? 'later' : 'now';

  return (
    <div className="yn-in" style={{ maxWidth: 620, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <section style={{ background: SUBTLE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <MicroLabel>{t('studio.sched.when')}</MicroLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <ModeCard
            selected={mode === 'now'}
            onClick={() => patchCampaign({ scheduledAt: null })}
            icon={<Zap size={15} strokeWidth={1.75} />}
            title={t('studio.sched.now')}
            help={t('studio.sched.nowHelp')}
          />
          <ModeCard
            selected={mode === 'later'}
            onClick={() => {
              if (!campaign.scheduledAt) {
                const in2h = new Date(Date.now() + 2 * 3_600_000);
                in2h.setMinutes(0, 0, 0);
                const pad = (n: number) => String(n).padStart(2, '0');
                patchCampaign({
                  scheduledAt: `${in2h.getFullYear()}-${pad(in2h.getMonth() + 1)}-${pad(in2h.getDate())}T${pad(in2h.getHours())}:00`,
                });
              }
            }}
            icon={<CalendarClock size={15} strokeWidth={1.75} />}
            title={t('studio.sched.later')}
            help={t('studio.sched.laterHelp')}
          />
        </div>
        {mode === 'later' && (
          <TextInput
            type="datetime-local"
            value={campaign.scheduledAt || ''}
            onChange={(e) => patchCampaign({ scheduledAt: e.target.value || null })}
            aria-label={t('studio.sched.later')}
            style={{ colorScheme: 'dark' }}
          />
        )}
      </section>

      <section style={{ background: SUBTLE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <MicroLabel>{t('studio.sched.options')}</MicroLabel>
        <Toggle
          checked={campaign.throttlePerHour != null}
          onChange={(v) => patchCampaign({ throttlePerHour: v ? 1000 : null })}
          label={t('studio.sched.throttle')}
          help={t('studio.sched.throttleHelp')}
        />
        {campaign.throttlePerHour != null && (
          <SegBtns
            value={String(campaign.throttlePerHour)}
            onChange={(v) => patchCampaign({ throttlePerHour: Number(v) })}
            options={THROTTLE_CHOICES.map((n) => ({ value: String(n), label: `${n}/h` }))}
          />
        )}
        <Toggle
          checked={campaign.quietHours}
          onChange={(v) => patchCampaign({ quietHours: v })}
          label={t('studio.sched.quiet')}
          help={t('studio.sched.quietHelp')}
        />
        {campaign.quietHours && (
          <Help style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Moon size={12} strokeWidth={1.75} /> {t('studio.sched.quietWindow')}
          </Help>
        )}
      </section>
    </div>
  );
}

function ModeCard({ selected, onClick, icon, title, help }: {
  selected: boolean; onClick: () => void; icon: React.ReactNode; title: string; help: string;
}) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={selected}
      style={{
        display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left',
        background: selected ? 'rgba(232,25,44,0.08)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${selected ? 'rgba(232,25,44,0.45)' : BORDER}`,
        borderRadius: 10, padding: '12px 13px', cursor: 'pointer', transition: 'all .12s',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: T1 }}>
        {icon}
        <span style={{ fontSize: 12.5, fontWeight: 700, fontFamily: FONT_UI }}>{title}</span>
      </span>
      <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.5)', fontFamily: FONT_UI, lineHeight: 1.45 }}>{help}</span>
    </button>
  );
}
