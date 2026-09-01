import { useState } from 'react';
import { CalendarClock, Plus, ShieldCheck, Sparkles, Split, Zap } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import EmailCreditsDialog from '@/components/campaigns/EmailCreditsDialog';
import { useStudio } from './store';
import { useEmailQuota, type StudioScope } from './hooks';
import {
  BORDER, FlowCard, FONT_UI, MicroLabel, RED, RED_SOFT_GRAD, StatusBadge, SUBTLE,
  Switch, T1, T2, T3, ToggleRow, inputStyle,
} from './ui';

/** Écran Planification : quand partir, quota du mois, délivrabilité, A/B. */
export default function ScheduleStep({ scope }: { scope: StudioScope }) {
  const { t } = useLanguage();
  const campaign = useStudio((s) => s.campaign);
  const patchCampaign = useStudio((s) => s.patchCampaign);
  const { quota, refresh } = useEmailQuota(scope);
  const [creditsOpen, setCreditsOpen] = useState(false);

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
        {/* ── Quota du mois — discret tant que tout va bien ──────────────
            <80 % : une ligne neutre, rien d'autre. ≥80 % : la barre passe en
            ambre + le reste dispo + un lien texte. Épuisé : état factuel (pas
            une erreur) + la date de reprise + le bouton d'achat. */}
        {quota && (() => {
          const pctFree = Math.min(1, quota.used / Math.max(1, quota.free));
          const exhausted = quota.remaining <= 0;
          const warn = !exhausted && pctFree >= 0.8;
          const barColor = exhausted ? RED : warn ? '#FCD34D' : 'rgba(255,255,255,0.35)';
          const resetDate = new Date(quota.resetsOn).toLocaleDateString();
          const nf = (n: number) => n.toLocaleString('fr-FR');
          return (
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7 }}>
                <MicroLabel>{t('studio.sched.quotaTitle')}</MicroLabel>
                <span style={{ flex: 1 }} />
                {quota.credits > 0 && (
                  <span style={{
                    color: T2, fontSize: 10.5, fontWeight: 600, fontFamily: FONT_UI, padding: '2px 7px',
                    borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`,
                    fontVariantNumeric: 'tabular-nums',
                  }}>{t('studio.sched.quotaCredits').replace('{n}', nf(quota.credits))}</span>
                )}
                <span style={{ color: warn || exhausted ? T1 : T2, fontSize: 12, fontWeight: 560, fontFamily: FONT_UI, fontVariantNumeric: 'tabular-nums' }}>
                  {nf(quota.used)} / {nf(quota.free)}
                </span>
              </div>
              <div style={{ height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${Math.round(pctFree * 100)}%`, borderRadius: 999,
                  background: barColor, transition: 'width .3s, background .3s',
                }} />
              </div>
              {warn && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <span style={{ color: T3, fontSize: 11.5, fontFamily: FONT_UI, flex: 1 }}>
                    {t('studio.sched.quotaLeft').replace('{n}', nf(quota.remaining))}
                  </span>
                  <button
                    type="button" onClick={() => setCreditsOpen(true)}
                    style={{
                      background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                      color: T2, fontSize: 11.5, fontWeight: 600, fontFamily: FONT_UI,
                      textDecoration: 'underline', textUnderlineOffset: 3,
                    }}
                  >{t('studio.sched.quotaBuy')}</button>
                </div>
              )}
              {exhausted && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, padding: '10px 12px',
                  borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDER}`,
                }}>
                  <span style={{ color: T2, fontSize: 11.5, lineHeight: 1.45, fontFamily: FONT_UI, flex: 1 }}>
                    {t('studio.sched.quotaFull').replace('{date}', resetDate)}
                  </span>
                  <button
                    type="button" onClick={() => setCreditsOpen(true)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, flex: 'none', cursor: 'pointer',
                      padding: '7px 12px', borderRadius: 10, background: RED, border: `1px solid ${RED}`,
                      color: '#fff', fontSize: 11.5, fontWeight: 600, fontFamily: FONT_UI,
                    }}
                  ><Plus size={13} strokeWidth={2.25} />{t('studio.sched.quotaBuy')}</button>
                </div>
              )}
            </div>
          );
        })()}

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

      <EmailCreditsDialog
        open={creditsOpen}
        onClose={() => setCreditsOpen(false)}
        scope={scope.kind === 'venue' ? { kind: 'venue', venueId: scope.venueId } : { kind: 'organizer', organizerId: scope.organizerId }}
        onCredited={refresh}
      />
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
