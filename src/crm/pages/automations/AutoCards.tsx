/**
 * « Vos automatisations » : une carte par recette réglée, filtrable (actives,
 * en pause, prêtes), avec son interrupteur, son schéma et ses résultats ; un
 * clic déplie ce qui se passe dans l'ordre, qui la reçoit, ce qu'elle coûte
 * et les boutons pour la régler ou modifier son e-mail.
 */
import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE } from '@/crm/ui/motion';
import type { useCrmT } from '@/crm/i18n';
import type { AutoRecipe, Automations } from '@/crm/data/automations';
import { autoState, quietSendAt, type CrmAutoKind, type CrmAutoState } from '@/crm/lib/automations';
import { AU_IC, KIND_IC, linkLabel, whenLabel } from './autoFmt';
import { Flow, GreenSwitch, Pills, SectionHead, StateBadge, SubjectText } from './autoUi';

type T = ReturnType<typeof useCrmT>;
type Filter = 'all' | Exclude<CrmAutoState, 'none'>;
const cl01 = (x: number) => Math.max(0, Math.min(1, x));

export function AutoCards({
  d, T, money, c, g, canWrite, open, onOpen, hl, busy, rates, onToggle, onEdit, onEditMail,
}: {
  d: Automations; T: T; money: boolean; c: number; g: number; canWrite: boolean;
  open: CrmAutoKind | null; onOpen: (k: CrmAutoKind | null) => void; hl: CrmAutoKind | null; busy: CrmAutoKind | null;
  rates: { email: number; sms: number };
  onToggle: (r: AutoRecipe) => void; onEdit: (r: AutoRecipe) => void; onEditMail: (r: AutoRecipe) => void;
}) {
  const { t } = T;
  const [filter, setFilter] = useState<Filter>('all');
  const set = d.recipes.filter((r) => autoState(r) !== 'none');
  const cnt: Record<Filter, number> = {
    all: set.length,
    on: set.filter((r) => autoState(r) === 'on').length,
    off: set.filter((r) => autoState(r) === 'off').length,
    ready: set.filter((r) => autoState(r) === 'ready').length,
  };
  const filters = (['all', 'on', 'off', 'ready'] as Filter[]).filter((k) => k === 'all' || cnt[k] > 0);
  const list = set.filter((r) => filter === 'all' || autoState(r) === filter);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: `yc-in-blur 800ms ${EASE} 540ms both` }}>
      <SectionHead
        title={t('yc.au.list.title')}
        sub={t(canWrite ? 'yc.au.list.sub' : 'yc.au.list.subRead')}
        right={(
          <Pills<Filter>
            value={filter}
            onChange={setFilter}
            label={t('yc.au.f.label')}
            options={filters.map((k) => ({ k, l: <>{t(`yc.au.f.${k}`)}<span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--sand-500)' }}>{cnt[k]}</span></> }))}
          />
        )}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {list.map((r, idx) => (
          <Card
            key={r.kind}
            r={r} idx={idx} d={d} T={T} money={money} c={c} g={g} canWrite={canWrite}
            open={open === r.kind} hl={hl === r.kind} busy={busy === r.kind} rates={rates}
            onOpen={() => onOpen(open === r.kind ? null : r.kind)}
            onToggle={() => onToggle(r)} onEdit={() => onEdit(r)} onEditMail={() => onEditMail(r)}
          />
        ))}
        {list.length === 0 && (
          <div style={{ padding: 28, borderRadius: 20, border: '1.5px dashed var(--sand-300)', textAlign: 'center', fontSize: 15, color: 'var(--sand-600)' }}>{t('yc.au.f.none')}</div>
        )}
      </div>
    </section>
  );
}

function Card({
  r, idx, d, T, money, c, g, canWrite, open, hl, busy, rates, onOpen, onToggle, onEdit, onEditMail,
}: {
  r: AutoRecipe; idx: number; d: Automations; T: T; money: boolean; c: number; g: number; canWrite: boolean;
  open: boolean; hl: boolean; busy: boolean; rates: { email: number; sms: number };
  onOpen: () => void; onToggle: () => void; onEdit: () => void; onEditMail: () => void;
}) {
  const { t, tp, n, eur, dShort, time } = T;
  const st = autoState(r) as Exclude<CrmAutoState, 'none'>;
  const on = st === 'on';
  const name = t(`yc.au.r.${r.kind}.name`);
  const hasStats = r.contacted > 0;
  const weekly = r.weekly ?? [];
  const smx = Math.max(1, ...weekly);
  const subject = r.subject || r.template_subject || r.template_name || '';
  const cr = r.sent ? r.clicked / r.sent : 0;
  const p = r.preview;

  const know = st === 'ready' ? t('yc.au.x.knowReady')
    : st === 'off' ? tp('yc.au.x.knowOff', p?.eligible ?? 0, { n: n(p?.eligible ?? 0) })
      : hasStats
        ? t('yc.au.x.knowOn', {
          w: d.weeks_n,
          c: tp('yc.au.contacted', r.contacted, { n: n(r.contacted) }),
          p: tp('yc.au.purchases', r.purchases, { n: n(r.purchases) }),
          v: money && r.revenue !== null ? t('yc.au.x.knowSales', { v: eur(Number(r.revenue)) }) : '',
        })
        : t('yc.au.x.knowNew');

  const next = p?.next_event_title
    ? p.next_due_at
      ? t('yc.au.x.next', { event: p.next_event_title, date: `${dShort(quietSendAt(p.next_due_at))} · ${time(quietSendAt(p.next_due_at))}` })
      : t('yc.au.x.nextEvent', { event: p.next_event_title })
    : '';

  const key = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } };

  return (
    <article id={`auto-${r.kind}`} style={{ borderRadius: 24, background: '#fff', border: `1.5px solid ${hl ? 'var(--red-300)' : open ? 'var(--sand-300)' : 'var(--sand-200)'}`, boxShadow: open || hl ? 'var(--shadow-md)' : 'none', overflow: 'hidden', animation: `yc-in-blur 700ms ${EASE} ${560 + idx * 80}ms both`, transition: 'border-color 300ms,box-shadow 300ms', scrollMarginTop: 96 }}>
      <Hv
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onOpen}
        onKeyDown={key}
        style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 22px', cursor: 'pointer', outlineOffset: -3, transition: 'background 160ms' }}
        hover={{ background: 'var(--sand-50)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <span style={{ flex: 'none', width: 46, height: 46, borderRadius: 15, background: on ? 'var(--red-50)' : 'var(--sand-100)', color: on ? 'var(--red-600)' : 'var(--sand-500)', display: 'grid', placeItems: 'center', transition: 'background 240ms,color 240ms' }}>
            <Icon d={KIND_IC[r.kind]} size={21} stroke={2} />
          </span>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.025em', lineHeight: '24px' }}>{name}</span>
            <span style={{ fontSize: 14, lineHeight: '19px', color: 'var(--sand-600)', textWrap: 'pretty' }}>{t(`yc.au.r.${r.kind}.q`)}</span>
          </span>
          <span className="yc-hide-sm"><StateBadge T={T} state={st} /></span>
          {canWrite && <GreenSwitch on={on} disabled={busy} label={t(on ? 'yc.au.sw.on' : 'yc.au.sw.off', { name })} onToggle={onToggle} />}
          <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', display: 'grid', placeItems: 'center' }}>
            <Icon d={AU_IC.chevron} size={16} stroke={2.2} style={{ transform: `rotate(${open ? 180 : 0}deg)`, transition: `transform 260ms ${EASE}` }} />
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '16px 28px' }}>
          <div style={{ flex: '1 1 380px', minWidth: 0 }}>
            <Flow T={T} kind={r.kind} delay={r.delay_hours} on={on} base={600 + idx * 80} />
          </div>
          {hasStats ? (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 22 }}>
              {[
                { v: n(r.contacted * c), l: tp('yc.au.st.people', r.contacted) },
                { v: n(r.purchases * c), l: tp('yc.au.st.buys', r.purchases) },
                ...(money && r.revenue !== null ? [{ v: eur(Number(r.revenue) * c), l: t('yc.au.st.sales') }] : []),
              ].map((s) => (
                <div key={s.l} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', lineHeight: '26px' }}>{s.v}</b>
                  <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{s.l}</span>
                </div>
              ))}
              <div aria-hidden style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 34, width: 78 }}>
                {weekly.map((v, i) => (
                  <div key={i} style={{ flex: 1, height: `${((v / smx) * 100 * cl01(c * 1.5 - i * 0.05)).toFixed(0)}%`, minHeight: 2, borderRadius: '3px 3px 0 0', background: i === weekly.length - 1 ? 'linear-gradient(180deg,var(--tangerine-500),var(--red-500))' : on ? 'var(--red-100)' : 'var(--sand-200)' }} />
                ))}
              </div>
            </div>
          ) : (
            <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t(st === 'ready' ? 'yc.au.noStatsReady' : st === 'off' ? 'yc.au.noStatsOff' : 'yc.au.noStats')}</span>
          )}
        </div>
      </Hv>

      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: `grid-template-rows 360ms ${EASE}` }}>
        <div style={{ overflow: 'hidden', minHeight: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px 40px', padding: '6px 22px 24px', borderTop: '1px solid var(--sand-100)', background: 'var(--sand-50)' }}>
            <div style={{ flex: '1.6 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 16 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.au.x.order')}</span>
              <div style={{ marginLeft: 21, borderLeft: '2px dashed var(--sand-300)', display: 'flex', flexDirection: 'column', gap: 14, padding: '2px 0' }}>
                <div style={{ position: 'relative', paddingLeft: 26 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 28, padding: '4px 12px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', fontSize: 12.5, fontWeight: 600, color: 'var(--sand-600)' }}>
                    <Icon d={AU_IC.clock} size={13} stroke={2.2} />{whenLabel(T, r.kind, r.delay_hours)}
                  </span>
                </div>
                <div style={{ position: 'relative', paddingLeft: 26 }}>
                  <span style={{ position: 'absolute', left: -23, top: 2, width: 44, height: 44, borderRadius: 14, background: on ? 'var(--red-50)' : 'var(--sand-100)', color: on ? 'var(--red-700)' : 'var(--sand-600)', display: 'grid', placeItems: 'center', border: '3px solid var(--sand-50)', boxSizing: 'border-box' }}>
                    <Icon d={AU_IC.mail} size={17} stroke={2} />
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', borderRadius: 16, background: '#fff', border: '1px solid var(--sand-200)' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '4px 12px' }}>
                      <span style={{ fontSize: 15, fontWeight: 600, overflowWrap: 'anywhere' }}>{subject ? <SubjectText T={T} subject={subject} /> : '—'}</span>
                      <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.au.m.email')} · {linkLabel(T, r.kind, r.delay_hours)}</span>
                    </div>
                    {r.sent > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{ flex: 1, height: 8, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(100, cr * 100 * cl01(g * 1.5)).toFixed(1)}%`, borderRadius: 99, background: 'var(--gradient-brand)' }} />
                        </div>
                        <span style={{ fontSize: 13, color: 'var(--sand-600)', whiteSpace: 'nowrap' }}>
                          <b style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{n(r.sent)}</b> {t('yc.au.x.sent')} · <b style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{T.pct(cr * 100)}</b> {t('yc.au.x.clicked')}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {(r.pending > 0 || r.skipped > 0) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--sand-500)', paddingLeft: 4 }}>
                  {r.pending > 0 && <span>{t('yc.au.x.pending', { n: n(r.pending) })}</span>}
                  {r.skipped > 0 && <span>{tp('yc.au.x.skipped', r.skipped, { n: n(r.skipped) })}</span>}
                </div>
              )}
            </div>
            <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.au.x.know')}</span>
                <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-700)', textWrap: 'pretty' }}>{know}</span>
                {next && <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>{next}</span>}
                {st !== 'off' && p && <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>{tp('yc.au.x.eligible', p.eligible, { n: n(p.eligible) })}</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.au.x.who')}</span>
                <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--sand-700)', textWrap: 'pretty' }}>{t(`yc.au.r.${r.kind}.target`)}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', borderRadius: 14, background: '#fff', border: '1px solid var(--sand-200)', fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>
                <span><b style={{ color: 'var(--ink)' }}>{t('yc.au.x.costL')}</b> {t('yc.au.x.costV', { e: rates.email })}</span>
                <span>{t('yc.au.x.smsSoon')}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {canWrite && (
                  <Hv as="button" type="button" onClick={onEdit} style={{ height: 42, padding: '0 20px', border: 0, borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'var(--sand-700)' }} active={{ transform: 'scale(.97)' }}>
                    {t('yc.au.x.edit')}
                  </Hv>
                )}
                {r.template_id && (
                  <Hv as="button" type="button" onClick={onEditMail} style={{ height: 42, padding: '0 18px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', color: 'var(--ink)', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }} hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }} active={{ transform: 'scale(.97)' }}>
                    {t(canWrite ? 'yc.au.x.editMail' : 'yc.au.x.readMail')}
                  </Hv>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
