/**
 * Étape 2 — « À qui l'envoyer ? » : le nombre exact de destinataires
 * (crm_sms_audience_preview : joignables par SMS, moins les exclusions et le
 * plafond de la semaine), les groupes à cocher, les raccourcis, puis « Qui ne
 * pas déranger ? ».
 */
import type { ReactNode } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Rich } from '@/crm/ui/Rich';
import { Skel } from '@/crm/ui/kit';
import { EASE, SPRING } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { LIFECYCLE_COLOR } from '@/crm/lib/lifecycle';
import type { CrmAudience } from '@/crm/data/emails';
import type { SmsAudiencePreview, SmsSendOptions } from '@/crm/data/sms';
import { Card, CardHead, Pills, Row, Toggle48 } from '@/crm/pages/emails/send/sendUi';
import { SmsStepTitle } from '../flow/SmsFlowHeader';

type Key = 'hab' | 'occ' | 'nou' | 'end' | 'none';

const isAuto = (a: CrmAudience, k: string) => !a.segmentId && a.def?.seg === k && !a.def?.f && !a.def?.q;
const autoKeyOf = (a: CrmAudience): Key | null => (!a.segmentId && a.def?.seg && a.def.seg !== 'all' && !a.def.f && !a.def.q ? (a.def.seg as Key) : null);

export function SmsAudienceStep({
  options, audiences, onAudiences, preview, cost, eventTitle, excludeBuyers, onExcludeBuyers, recentDays, onRecentDays, cap, readOnly,
}: {
  options: SmsSendOptions | undefined;
  audiences: CrmAudience[];
  onAudiences: (a: CrmAudience[]) => void;
  preview: SmsAudiencePreview | undefined;
  cost: number;
  eventTitle: string | null;
  excludeBuyers: boolean;
  onExcludeBuyers: (v: boolean) => void;
  recentDays: number;
  onRecentDays: (v: number) => void;
  cap: number;
  readOnly: boolean;
}) {
  const { t, tp, n, pct } = useCrmT();
  const net = preview?.net ?? 0;
  const reach = Math.max(1, preview?.reach ?? 0);
  const xb = excludeBuyers ? preview?.x_buyers ?? 0 : 0;
  const xr = preview?.x_recent ?? 0;
  const xc = preview?.x_cap ?? 0;
  const rules = options?.rules;
  const autoLabel = (k: Key) => t(`yc.cli.seg.${k}`);
  const autoAudience = (k: Key): CrmAudience => ({ kind: 'crm', def: { seg: k }, label: autoLabel(k) });
  const set = (a: CrmAudience[]) => { if (!readOnly) onAudiences(a); };
  const toggleAuto = (k: Key) => {
    const on = audiences.some((a) => isAuto(a, k));
    set(on ? audiences.filter((a) => !isAuto(a, k)) : [...audiences, autoAudience(k)]);
  };
  const toggleSaved = (id: string, name: string) => {
    const on = audiences.some((a) => a.segmentId === id);
    set(on ? audiences.filter((a) => a.segmentId !== id) : [...audiences, { kind: 'crm', segmentId: id, label: name }]);
  };
  const custom = audiences.filter((a) => !autoKeyOf(a) && !a.segmentId);
  const ruleOf = (k: Key) => t(`yc.cli.seg.${k}.def`, { n: Number(rules?.regular_min_nights ?? 3), m: k === 'end' ? Number(rules?.lapse_months ?? 4) : Number(rules?.regular_window_months ?? 6) });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, animation: `yc-rise 520ms ${EASE} both` }}>
      <SmsStepTitle kick={t('yc.sm.sd.aud.kick')} a={t('yc.sm.sd.aud.h.a')} b={t('yc.sm.sd.aud.h.b')} c={t('yc.sm.sd.aud.h.c')} sub={t('yc.sm.sd.aud.sub')} />

      <section style={{ position: 'sticky', top: 76, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 14, padding: '20px 24px', borderRadius: 24, background: 'rgba(255,255,255,.94)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '8px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(44px,5vw,64px)', lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{preview ? n(net) : '…'}</span>
            <span style={{ fontSize: 16, color: 'var(--sand-500)' }}>{tp('yc.sm.sd.will', net)}</span>
          </div>
          <span style={{ fontSize: 14, color: 'var(--sand-600)' }}><Rich text={t('yc.sm.sd.cost', { n: n(cost) })} /></span>
        </div>
        <div style={{ display: 'flex', height: 14, gap: 2, borderRadius: 99, overflow: 'hidden', background: 'var(--sand-100)' }}>
          <div style={{ width: `${(net / reach) * 100}%`, background: 'var(--gradient-brand)', transition: `width 420ms ${EASE}` }} />
          <div style={{ width: `${(xb / reach) * 100}%`, background: 'var(--sand-400)', transition: `width 420ms ${EASE}` }} />
          <div style={{ width: `${(xr / reach) * 100}%`, background: 'var(--sand-300)', transition: `width 420ms ${EASE}` }} />
          <div style={{ width: `${(xc / reach) * 100}%`, background: 'var(--sand-200)', transition: `width 420ms ${EASE}` }} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px', fontSize: 13, color: 'var(--sand-600)' }}>
          <Legend c="var(--gradient-brand)" l={t('yc.sm.sd.leg.net', { n: n(net) })} />
          <Legend c="var(--sand-400)" l={t('yc.sm.sd.leg.buyers', { n: n(xb) })} />
          <Legend c="var(--sand-300)" l={t('yc.sm.sd.leg.recent', { n: n(xr) })} />
          {xc > 0 && <Legend c="var(--sand-200)" l={tp('yc.sm.sd.leg.cap', cap, { n: n(xc), c: cap })} />}
        </div>
      </section>

      {!readOnly && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {([['come', ['hab', 'occ', 'nou']], ['regulars', ['hab']], ['wake', ['end']], ['clear', []]] as [string, Key[]][]).map(([k, keys]) => (
            <Hv key={k} as="button" type="button" onClick={() => set(keys.map(autoAudience))} style={{ height: 38, padding: '0 16px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', transition: `transform 200ms ${SPRING},border-color 160ms`, font: 'inherit' }} hover={{ transform: 'translateY(-1px)', borderColor: 'var(--sand-400)' }}>
              {t(`yc.sm.sd.p.${k}`)}
            </Hv>
          ))}
        </div>
      )}

      {custom.length > 0 && (
        <Group label={t('yc.em.sd.g.pending')}>
          {custom.map((a, i) => <SegCard key={`c${i}`} on label={a.label || t('yc.em.aud.none')} rule={t('yc.em.sd.pendingRule')} color="var(--ink)" onPick={() => set(audiences.filter((x) => x !== a))} />)}
        </Group>
      )}

      <Group label={t('yc.em.sd.g.auto')}>
        {!options ? [0, 1, 2, 3].map((i) => <Skel key={i} h={118} r={20} />) : options.auto.filter((s) => s.key !== 'none' || s.reach > 0).map((s) => (
          <SegCard key={s.key} on={audiences.some((a) => isAuto(a, s.key))} label={autoLabel(s.key)} rule={ruleOf(s.key)} color={LIFECYCLE_COLOR[s.key]} reach={n(s.reach)} phone={s.phone_pct === null ? null : pct(s.phone_pct)} onPick={() => toggleAuto(s.key)} />
        ))}
      </Group>

      {options && options.saved.length > 0 && (
        <Group label={t('yc.em.sd.g.saved')}>
          {options.saved.map((s) => (
            <SegCard key={s.id} on={audiences.some((a) => a.segmentId === s.id)} label={s.name} rule={s.description || t('yc.em.sd.savedNoDesc')} color="var(--ink)" reach={n(s.reach)} phone={s.phone_pct === null ? null : pct(s.phone_pct)} onPick={() => toggleSaved(s.id, s.name)} />
          ))}
        </Group>
      )}

      <Card>
        <CardHead title={t('yc.em.sd.dnd.t')} sub={t('yc.em.sd.dnd.s')} />
        <Row
          title={t('yc.em.sd.dnd.buyers')}
          sub={eventTitle ? <>{t('yc.em.sd.dnd.buyersSub', { title: eventTitle })} <b style={{ color: 'var(--ink)' }}>−{n(preview?.x_buyers ?? 0)}</b></> : t('yc.em.sd.dnd.buyersNone')}
          right={<Toggle48 on={excludeBuyers && !!eventTitle} onChange={(v) => { if (!readOnly) onExcludeBuyers(v); }} label={t('yc.em.sd.dnd.buyers')} />}
        />
        <Row
          title={t('yc.em.sd.dnd.recent')}
          sub={<>{t('yc.sm.sd.dnd.recentSub')} {recentDays > 0 && <b style={{ color: 'var(--ink)' }}>−{n(xr)}</b>}</>}
          right={<Pills value={recentDays} onChange={(v) => { if (!readOnly) onRecentDays(v); }} label={t('yc.em.sd.dnd.period')} options={[{ v: 0, l: t('yc.em.sd.dnd.no') }, ...[3, 7, 14].map((d) => ({ v: d, l: t('yc.em.sd.dnd.days', { n: d }) }))]} />}
        />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 0 0', borderTop: '1px solid var(--sand-100)', fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>
          <Icon name="check" size={18} stroke={2.4} color="var(--green-700)" style={{ marginTop: 1 }} />
          <span><Rich text={tp('yc.sm.sd.dnd.always', cap, { c: cap })} /></span>
        </div>
      </Card>
    </div>
  );
}

function Legend({ c, l }: { c: string; l: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: c, display: 'inline-block' }} />{l}</span>;
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>{label}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,270px),1fr))', gap: 10 }}>{children}</div>
    </div>
  );
}

function SegCard({ on, label, rule, color, reach, phone, onPick }: { on: boolean; label: string; rule: string; color: string; reach?: string; phone?: string | null; onPick: () => void }) {
  const { t } = useCrmT();
  return (
    <Hv
      as="button" type="button" onClick={onPick} role="checkbox" aria-checked={on}
      style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 18px', borderRadius: 20, border: `1.5px solid ${on ? 'var(--red-400)' : 'var(--sand-200)'}`, background: on ? 'var(--red-50)' : '#fff', cursor: 'pointer', textAlign: 'left', color: 'var(--ink)', boxShadow: on ? '0 0 0 3px rgba(227,20,27,.08)' : 'none', transition: `translate 200ms ${EASE},border-color 160ms,background 160ms,box-shadow 200ms`, font: 'inherit' }}
      hover={{ translate: '0 -2px', borderColor: on ? 'var(--red-500)' : 'var(--sand-300)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
        <span style={{ flex: 'none', width: 22, height: 22, borderRadius: 7, border: `1.5px solid ${on ? 'var(--red-500)' : 'var(--sand-300)'}`, background: on ? 'var(--red-500)' : '#fff', color: '#fff', display: 'grid', placeItems: 'center', transition: 'background 160ms,border-color 160ms' }}>{on && <Icon name="check" size={13} stroke={3.4} />}</span>
        <i style={{ flex: 'none', width: 11, height: 11, borderRadius: 4, background: color }} />
        <b style={{ flex: 1, minWidth: 0, fontSize: 15.5, letterSpacing: '-.01em' }}>{label}</b>
        {reach !== undefined && (
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{reach}</b>
            <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{t('yc.sm.sd.reach')}</span>
          </span>
        )}
      </div>
      <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-600)', textWrap: 'pretty' }}>{rule}</span>
      {phone !== undefined && phone !== null && (
        <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}><b style={{ color: 'var(--ink)' }}>{phone}</b> {t('yc.sm.sd.phonePct')}</span>
      )}
    </Hv>
  );
}
