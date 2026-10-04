/**
 * Étape 3 — « Quand le faire partir ? » : maintenant ou programmé (calendrier
 * avec les meilleurs jours, heure, créneaux rapides), la journée (créneau,
 * heures calmes, moments les plus actifs), vagues et heures calmes.
 */
import { useState } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Rich } from '@/crm/ui/Rich';
import { EASE, SPRING } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { QUIET_FROM, QUIET_TO, WAVE_OPTIONS, effectiveSendAt, type WaveMinutes } from '@/crm/lib/emailSend';
import { Card, CardHead, Pills, Row, StepTitle, Toggle48 } from './sendUi';

const two = (v: number) => String(v).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

export interface PlanState {
  mode: 'now' | 'later';
  date: string;
  time: string;
  wave: boolean;
  waveMin: WaveMinutes;
  quiet: boolean;
}

export function PlanStep({
  plan, onPlan, best, abOn, abPct, abHours, whenText, relText,
}: {
  plan: PlanState;
  onPlan: (p: Partial<PlanState>) => void;
  best: { days: number[]; hours: number[] };
  abOn: boolean;
  abPct: number;
  abHours: number;
  whenText: (d: Date) => string;
  relText: (d: Date) => string;
}) {
  const { t, time, locale } = useCrmT();
  const chosen = new Date(`${plan.date}T${plan.time}:00`);
  const [month, setMonth] = useState(() => new Date(chosen.getFullYear(), chosen.getMonth(), 1));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), 1);
  const lead = (month.getDay() + 6) % 7;
  const dim = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((lead + dim) / 7) * 7 }, (_, i) => new Date(month.getFullYear(), month.getMonth(), 1 - lead + i));
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const wdays = Array.from({ length: 7 }, (_, i) => new Date(2026, 0, 5 + i).toLocaleDateString(locale, { weekday: 'short' }));
  const at = plan.mode === 'now' ? now : chosen;
  const eff = effectiveSendAt(at, plan.quiet);
  const past = plan.mode === 'later' && chosen.getTime() <= now.getTime();
  const [hh, mm] = plan.time.split(':');
  const bestHour = best.hours[0] ?? 10;
  const quick = ['08:00', `${two(bestHour)}:00`, '12:30', '18:00', '20:00'].filter((v, i, a) => a.indexOf(v) === i);
  const pl = (h: number) => `${(h / 24) * 100}%`;
  const markerH = eff.at.getHours() + eff.at.getMinutes() / 60;
  const endAt = new Date(eff.at.getTime() + plan.waveMin * 60_000);

  const modes = [
    { k: 'now' as const, l: t('yc.em.sd.m.now'), s: t('yc.em.sd.m.nowSub'), d: 'm22 2-7 20-4-9-9-4ZM22 2 11 13' },
    { k: 'later' as const, l: t('yc.em.sd.m.later'), s: t('yc.em.sd.m.laterSub'), d: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, animation: `yc-rise 520ms ${EASE} both` }}>
      <StepTitle kick={t('yc.em.sd.plan.kick')} a={t('yc.em.sd.plan.h.a')} b={t('yc.em.sd.plan.h.b')} c={t('yc.em.sd.plan.h.c')} sub={t('yc.em.sd.plan.sub')} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))', gap: 12 }}>
        {modes.map((m) => {
          const on = plan.mode === m.k;
          return (
            <Hv key={m.k} as="button" type="button" role="radio" aria-checked={on} onClick={() => onPlan({ mode: m.k })} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 20, borderRadius: 22, border: `1.5px solid ${on ? 'var(--red-400)' : 'var(--sand-200)'}`, background: on ? 'var(--red-50)' : '#fff', cursor: 'pointer', textAlign: 'left', color: 'var(--ink)', boxShadow: on ? '0 0 0 3px rgba(227,20,27,.08)' : 'none', transition: `translate 200ms ${EASE},border-color 160ms,background 160ms,box-shadow 200ms` }} hover={{ translate: '0 -2px' }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <span style={{ width: 44, height: 44, borderRadius: 14, background: on ? '#fff' : 'var(--sand-100)', color: on ? 'var(--red-600)' : 'var(--sand-700)', display: 'grid', placeItems: 'center' }}><Icon d={m.d} size={22} stroke={2} /></span>
                <span style={{ width: 22, height: 22, borderRadius: 99, border: `2px solid ${on ? 'var(--red-500)' : 'var(--sand-300)'}`, display: 'grid', placeItems: 'center' }}><span style={{ width: 10, height: 10, borderRadius: 99, background: on ? 'var(--red-500)' : 'transparent' }} /></span>
              </span>
              <b style={{ fontSize: 17, letterSpacing: '-.01em' }}>{m.l}</b>
              <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{m.s}</span>
            </Hv>
          );
        })}
      </div>

      {plan.mode === 'later' && (
        <section style={{ display: 'flex', flexWrap: 'wrap', gap: '24px 32px', padding: 'clamp(18px,2.2vw,26px)', borderRadius: 24, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', animation: `yc-pop 260ms ${EASE} both` }}>
          <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em', textTransform: 'capitalize' }}>{month.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</b>
              <div style={{ display: 'flex', gap: 6 }}>
                <MonthBtn label={t('yc.em.sd.prevMonth')} d="m15 18-6-6 6-6" disabled={month <= today} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} />
                <MonthBtn label={t('yc.em.sd.nextMonth')} d="m9 18 6-6-6-6" disabled={month.getTime() >= new Date(today.getFullYear(), today.getMonth() + 5, 1).getTime()} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, textAlign: 'center' }}>
              {wdays.map((w) => <span key={w} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--sand-400)', padding: '4px 0' }}>{w}</span>)}
              {cells.map((d) => {
                const inM = d.getMonth() === month.getMonth();
                const off = !inM || d < startOfToday;
                const on = isoDay(d) === plan.date && plan.mode === 'later';
                const isBest = !off && best.days.includes((d.getDay() + 6) % 7);
                return (
                  <Hv
                    key={d.toISOString()}
                    as="button"
                    type="button"
                    disabled={off}
                    onClick={() => onPlan({ date: isoDay(d), mode: 'later' })}
                    aria-pressed={on}
                    aria-label={d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}
                    style={{ position: 'relative', height: 42, border: 0, borderRadius: 12, background: on ? 'var(--ink)' : 'transparent', color: on ? '#fff' : off ? 'var(--sand-300)' : 'var(--ink)', fontSize: 14.5, fontWeight: on ? 600 : 500, cursor: off ? 'default' : 'pointer', opacity: inM ? 1 : 0, transition: `background 140ms,transform 180ms ${SPRING}` }}
                    hover={off || on ? undefined : { transform: 'scale(1.08)', background: 'var(--sand-50)' }}
                  >
                    {d.getDate()}
                    {isBest && <span style={{ position: 'absolute', bottom: 5, left: '50%', marginLeft: -2, width: 4, height: 4, borderRadius: 99, background: on ? '#fff' : 'var(--green-500)' }} />}
                  </Hv>
                );
              })}
            </div>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--sand-500)' }}>
              <i style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--green-500)', display: 'inline-block' }} />{best.days.length ? t('yc.em.sd.bestDays') : t('yc.em.sd.bestDaysNone')}
            </span>
          </div>
          <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em' }}>{t('yc.em.sd.time')}</b>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <select aria-label={t('yc.em.sd.hour')} value={hh} onChange={(e) => onPlan({ time: `${e.target.value}:${mm}`, mode: 'later' })} style={selectCss}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={two(h)}>{two(h)}</option>)}
              </select>
              <span style={{ fontSize: 26, fontWeight: 600 }}>:</span>
              <select aria-label={t('yc.em.sd.minutes')} value={mm} onChange={(e) => onPlan({ time: `${hh}:${e.target.value}`, mode: 'later' })} style={selectCss}>
                {['00', '15', '30', '45'].map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {quick.map((q) => {
                const on = plan.time === q;
                const reco = q === `${two(bestHour)}:00`;
                return (
                  <Hv key={q} as="button" type="button" onClick={() => onPlan({ time: q, mode: 'later' })} style={{ height: 34, padding: '0 13px', borderRadius: 99, border: `1px solid ${on ? 'var(--ink)' : 'var(--sand-200)'}`, background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'border-color 160ms,background 160ms' }} hover={{ borderColor: 'var(--sand-400)' }}>
                    {time(new Date(`2026-01-01T${q}:00`))}
                    {reco && <span style={{ height: 18, padding: '0 6px', borderRadius: 99, background: 'var(--green-500)', color: '#fff', fontSize: 10.5, fontWeight: 600, display: 'flex', alignItems: 'center' }}>{t('yc.em.sd.reco')}</span>}
                  </Hv>
                );
              })}
            </div>
            <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 2, padding: '16px 18px', borderRadius: 18, background: past ? 'var(--red-50)' : 'var(--paper)' }}>
              <span style={{ fontSize: 13, color: past ? 'var(--red-700)' : 'var(--sand-500)' }}>{t('yc.em.sd.leaves')}</span>
              <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em', lineHeight: 1.15, color: past ? 'var(--red-700)' : 'var(--ink)' }}>{whenText(eff.at)}</b>
              <span style={{ fontSize: 13.5, color: past ? 'var(--red-700)' : 'var(--sand-500)' }}>{relText(chosen)}</span>
            </div>
          </div>
        </section>
      )}

      <Card gap={14}>
        <CardHead title={t('yc.em.sd.day.t')} sub={t('yc.em.sd.day.s')} />
        <div style={{ position: 'relative', height: 62 }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 22, height: 22, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
            {best.hours.map((h) => <div key={h} style={{ position: 'absolute', top: 0, bottom: 0, left: pl(h), width: pl(2), background: 'rgba(23,163,74,.45)' }} />)}
            {plan.quiet && (
              <>
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: pl(QUIET_FROM), width: pl(24 - QUIET_FROM), background: 'var(--sand-300)' }} />
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: pl(QUIET_TO), background: 'var(--sand-300)' }} />
              </>
            )}
          </div>
          <div style={{ position: 'absolute', top: 8, left: pl(markerH), transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', transition: `left 360ms ${EASE}` }}>
            <span style={{ height: 20, padding: '0 9px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>{plan.mode === 'now' ? t('yc.em.sd.m.now') : time(eff.at)}</span>
            <span style={{ width: 3, height: 26, background: 'var(--ink)', borderRadius: 2 }} />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--sand-500)' }}>
          {[0, 6, 12, 18, 24].map((h) => <span key={h}>{h} h</span>)}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: 12.5, color: 'var(--sand-600)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><i style={{ width: 12, height: 12, borderRadius: 4, background: 'rgba(23,163,74,.45)', display: 'inline-block' }} />{t('yc.em.sd.day.active')}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><i style={{ width: 12, height: 12, borderRadius: 4, background: 'var(--sand-300)', display: 'inline-block' }} />{t('yc.em.sd.day.quiet')}</span>
        </div>
      </Card>

      <Card gap={2}>
        <CardHead title={t('yc.em.sd.how.t')} sub={t('yc.em.sd.how.s')} />
        <Row
          title={t('yc.em.sd.wave')}
          sub={plan.wave ? t('yc.em.sd.waveOn', { from: time(eff.at), to: time(endAt) }) : t('yc.em.sd.waveOff')}
          right={<Toggle48 on={plan.wave} onChange={(v) => onPlan({ wave: v })} label={t('yc.em.sd.wave')} />}
        />
        {plan.wave && (
          <div style={{ alignSelf: 'flex-start', margin: '0 0 10px', animation: `yc-pop 220ms ${EASE} both` }}>
            <Pills value={plan.waveMin} onChange={(v) => onPlan({ waveMin: v })} label={t('yc.em.sd.waveLen')} options={WAVE_OPTIONS.map((m) => ({ v: m, l: t(`yc.em.sd.w.${m}`) }))} />
          </div>
        )}
        <Row
          title={t('yc.em.sd.quiet')}
          sub={t('yc.em.sd.quietSub', { from: QUIET_FROM, to: QUIET_TO })}
          right={<Toggle48 on={plan.quiet} onChange={(v) => onPlan({ quiet: v })} label={t('yc.em.sd.quiet')} />}
        />
        {eff.shifted && plan.mode === 'later' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 14, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 14, lineHeight: 1.4, fontWeight: 500, animation: `yc-pop 220ms ${EASE} both` }}>
            <Icon name="alert" size={18} stroke={2.2} />{t('yc.em.sd.shift', { when: whenText(eff.at) })}
          </div>
        )}
        {abOn && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', marginTop: 10, borderRadius: 16, background: 'var(--red-50)' }}>
            <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 11, background: '#fff', color: 'var(--red-600)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14 }}>A/B</span>
            <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--red-800)' }}><Rich text={t('yc.em.sd.ab', { pct: abPct, h: abHours })} /></span>
          </div>
        )}
      </Card>
    </div>
  );
}

const selectCss = { height: 54, width: 96, padding: '0 14px', borderRadius: 14, border: '1px solid var(--sand-200)', background: '#fff', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.02em', cursor: 'pointer', color: 'var(--ink)' } as const;

function MonthBtn({ label, d, onClick, disabled }: { label: string; d: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Hv as="button" type="button" onClick={onClick} disabled={disabled} aria-label={label} style={{ width: 36, height: 36, border: '1px solid var(--sand-200)', borderRadius: 99, background: '#fff', cursor: disabled ? 'default' : 'pointer', display: 'grid', placeItems: 'center', color: disabled ? 'var(--sand-300)' : 'var(--ink)' }} hover={{ background: 'var(--sand-50)' }}>
      <Icon d={d} size={15} stroke={2.4} />
    </Hv>
  );
}
