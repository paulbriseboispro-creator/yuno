/**
 * E-mails · Vue d'ensemble (maquette « Emails.dc.html ») : `/crm/emails`.
 *
 *   Que faut-il faire aujourd'hui ?  brouillons prêts, envois programmés,
 *                                    brouillons à finir, soirées sans message
 *   Combien ont-ils fait vendre ?    CA attribué, une barre par campagne
 *   4 chiffres · Que deviennent vos e-mails ? · Quand partent-ils ? · Yunits
 *   Les dernières campagnes (vrai rendu de l'e-mail en vignette)
 *
 * `?p=90` : la période. Chiffres : crm_email_overview (_crm_email_stats).
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Skel } from '@/crm/ui/kit';
import { EASE, useProgress } from '@/crm/ui/motion';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useCrmT } from '@/crm/i18n';
import { useCrmShell } from '@/crm/data/shell';
import { useNights } from '@/crm/data/nights';
import { useEmailAudienceSizes, useEmailOverview } from '@/crm/data/emails';
import type { EmailCampaignRow, PeriodTotals } from '@/crm/data/emails';
import { delta, draftGaps, perK, rate, shortName } from '@/crm/lib/emails';
import { lacksMessage, upKind } from '@/crm/lib/nights';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { EmailsShell } from './EmailsShell';
import { EmailThumb } from './EmailThumb';

const enter = (d: number) => ({ animation: `yc-rise 800ms ${EASE} ${d}ms both` });
const ARROW = 'M5 12h14M13 6l6 6-6 6';

/** Un haut d'axe « rond » (1 ; 1,2 ; 1,5 ; 2 ; 2,5 ; 3 ; 4 ; 5 ; 6 ; 8 × 10ⁿ). */
function niceTop(max: number): number {
  if (max <= 0) return 100;
  const raw = max * 1.1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((x) => m <= x) ?? 10;
  return step * p;
}

interface TodoCard { key: string; badge: string; tone: 'red' | 'sand' | 'amber'; title: string; why: string; cta: string; to: string; primary: boolean }

export default function EmailsOverviewPage() {
  const T = useCrmT();
  const { t, tp, n, eur, pct, dShort, time, locale } = T;
  const [sp, setSp] = useSearchParams();
  const days = (sp.get('p') === '90' ? 90 : 30) as 30 | 90;
  const q = useEmailOverview(days);
  const shell = useCrmShell();
  const nights = useNights();
  const data = q.data;
  const g = useProgress(1200, 650, data ? `${data.days}` : 'wait', !!data);
  const c = useProgress(1400, 500, data ? 'ok' : 'wait', !!data);
  const [hover, setHover] = useState<number | null>(null);
  const [fh, setFh] = useState<number | null>(null);

  const upcoming = useMemo(() => data?.upcoming ?? [], [data]);
  const drafts = upcoming.filter((x) => x.status === 'draft');
  const scheduled = upcoming.filter((x) => x.status === 'scheduled').sort((a, b) => Date.parse(a.scheduled_at ?? '') - Date.parse(b.scheduled_at ?? ''));
  const sizeIds = useMemo(() => upcoming.map((x) => x.id), [upcoming]);
  const sizes = useEmailAudienceSizes(sizeIds).data ?? {};
  const vide = !!data && !data.ever_sent;
  const balance = shell.data?.wallet.balance ?? null;
  const emailRate = shell.data?.wallet.rates?.email ?? 1;
  const periodLabel = t(days === 90 ? 'yc.em.period.90' : 'yc.em.period.30');

  // ── À faire
  const todo: TodoCard[] = [];
  const ready = drafts.filter((d) => draftGaps(d).length === 0);
  const unfinished = drafts.filter((d) => draftGaps(d).length > 0);
  if (!shell.data?.connection && vide) {
    todo.push({ key: 'connect', badge: t('yc.em.todo.connect.badge'), tone: 'red', title: t('yc.em.todo.connect.t'), why: t('yc.em.todo.connect.w'), cta: t('yc.em.todo.connect.cta'), to: CRM_ROUTES.connectors, primary: true });
  }
  if (ready[0]) {
    const d = ready[0];
    todo.push({ key: `v-${d.id}`, badge: d.scheduled_at ? `${dShort(d.scheduled_at)} · ${time(d.scheduled_at)}` : t('yc.em.todo.validate.badge'), tone: 'red', title: t('yc.em.todo.validate.t', { name: d.name || t('yc.em.untitled') }), why: t('yc.em.todo.validate.w'), cta: t('yc.em.todo.validate.cta'), to: CRM_ROUTES.emailSend(d.id), primary: true });
  }
  if (scheduled[0] && scheduled[0].scheduled_at) {
    const s0 = scheduled[0];
    todo.push({ key: 'sched', badge: dShort(s0.scheduled_at!), tone: 'sand', title: tp('yc.em.todo.sched.t', scheduled.length), why: t('yc.em.todo.sched.w', { date: dShort(s0.scheduled_at!), time: time(s0.scheduled_at!) }), cta: t('yc.em.todo.sched.cta'), to: `${CRM_ROUTES.emailCampaigns}?s=sched`, primary: false });
  }
  if (unfinished[0]) {
    const d = unfinished[0];
    const gaps = draftGaps(d).map((k) => t(`yc.em.gap.${k}`)).join(', ');
    todo.push({ key: `f-${d.id}`, badge: t('yc.em.todo.finish.badge'), tone: 'amber', title: t('yc.em.todo.finish.t', { name: d.name || t('yc.em.untitled') }), why: t('yc.em.todo.finish.w', { gaps }), cta: t('yc.em.todo.resume'), to: CRM_ROUTES.emailStudio(d.id), primary: false });
  }
  for (const nt of (nights.data?.nights ?? []).filter((x) => x.upcoming)) {
    if (todo.length >= 3) break;
    if (!lacksMessage(nt, upKind(nt))) continue;
    todo.push({ key: `n-${nt.id}`, badge: dShort(nt.start_at), tone: 'sand', title: t('yc.em.todo.night.t', { title: nt.title }), why: t('yc.em.todo.night.w', { date: dShort(nt.start_at) }), cta: t('yc.em.todo.night.cta'), to: `${CRM_ROUTES.emailTemplates}?event=${nt.id}`, primary: todo.length === 0 });
  }
  if (!todo.length && data) {
    todo.push({ key: 'ok', badge: t('yc.em.badge.today'), tone: 'sand', title: t('yc.em.todo.ok.t'), why: t('yc.em.todo.ok.w'), cta: t('yc.em.todo.ok.cta'), to: CRM_ROUTES.emailTemplates, primary: false });
  }
  const cards = todo.slice(0, 3);
  const TONE = { red: ['var(--red-50)', 'var(--red-700)', 'var(--red-200)'], sand: ['var(--sand-100)', 'var(--sand-600)', 'var(--sand-200)'], amber: ['var(--amber-50)', 'var(--amber-700)', 'var(--sand-200)'] } as const;

  const title = (
    <>{t('yc.em.ov.h.a')}<span className="yc-accent-word">{t('yc.em.ov.h.b')}</span>{t('yc.em.ov.h.c')}</>
  );

  return (
    <EmailsShell tab="home" title={title} sub={t(vide ? 'yc.em.ov.subEmpty' : 'yc.em.ov.sub')} drafts={drafts.length}>
      {!data ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: 12 }}>{[0, 1, 2].map((i) => <Skel key={i} h={170} r={20} />)}</div>
          <Skel h={460} r={28} />
        </div>
      ) : (
        <>
          {/* À faire */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 14, ...enter(400) }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em' }}>{t(vide ? 'yc.em.todo.start' : 'yc.em.todo.t')}</h2>
              {!vide && cards.length > 0 && cards[0].key !== 'ok' && (
                <span style={{ minWidth: 26, height: 26, padding: '0 8px', boxSizing: 'border-box', borderRadius: 99, background: 'var(--red-500)', color: '#fff', fontSize: 13, fontWeight: 600, display: 'grid', placeItems: 'center' }}>{cards.length}</span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: 12 }}>
              {cards.map((it) => {
                const [bg, fg, bd] = TONE[it.tone];
                return (
                  <Hv key={it.key} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '18px 20px', borderRadius: 20, background: '#fff', border: `1px solid ${bd}`, minWidth: 0, transition: `translate 240ms ${EASE},box-shadow 240ms,border-color 200ms` }} hover={{ translate: '0 -4px', boxShadow: 'var(--shadow-md)', borderColor: 'var(--sand-300)' }}>
                    <span style={{ alignSelf: 'flex-start', height: 24, padding: '0 10px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, background: bg, color: fg }}>
                      <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor' }} />{it.badge}
                    </span>
                    <span style={{ fontSize: 16.5, lineHeight: '21px', fontWeight: 600, letterSpacing: '-.01em', textWrap: 'balance' }}>{it.title}</span>
                    <span style={{ fontSize: 14, lineHeight: '19px', color: 'var(--sand-600)', textWrap: 'pretty' }}>{it.why}</span>
                    <div style={{ marginTop: 'auto', paddingTop: 6 }}>
                      {it.primary ? (
                        <Hv as={Link} to={it.to} style={{ height: 40, padding: '0 5px 0 16px', borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10, boxShadow: 'var(--shadow-cta)', textDecoration: 'none', whiteSpace: 'nowrap' }} hover={{ filter: 'brightness(1.05)', color: '#fff', textDecoration: 'none' }}>
                          {it.cta}<span style={{ width: 30, height: 30, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon d={ARROW} size={15} stroke={2.4} /></span>
                        </Hv>
                      ) : (
                        <Hv as={Link} to={it.to} style={{ height: 40, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: 'var(--ink)', textDecoration: 'none' }} hover={{ color: 'var(--red-600)', textDecoration: 'none' }}>
                          {it.cta}<Icon d={ARROW} size={15} stroke={2.4} />
                        </Hv>
                      )}
                    </div>
                  </Hv>
                );
              })}
            </div>
          </section>

          {vide ? (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 22, padding: 'clamp(24px,3vw,40px)', borderRadius: 28, background: 'repeating-linear-gradient(135deg,var(--sand-50) 0 10px,var(--sand-100) 10px 20px)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', ...enter(500) }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '18px 24px' }}>
                <YunitFace mood="ravi" size={64} />
                <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.em.empty.k')}</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(24px,3vw,32px)', letterSpacing: '-.03em', lineHeight: 1.1, textWrap: 'balance' }}>{t('yc.em.empty.t')}</span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,230px),1fr))', gap: 12 }}>
                {[1, 2, 3].map((i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '18px 20px', borderRadius: 20, background: '#fff', border: '1px solid var(--sand-200)' }}>
                    <span style={{ width: 30, height: 30, borderRadius: 99, background: 'var(--ink)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 600 }}>{i}</span>
                    <b style={{ fontSize: 16 }}>{t(`yc.em.empty.s${i}t`)}</b>
                    <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--sand-600)' }}>{t(`yc.em.empty.s${i}d`)}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Hv as={Link} to={CRM_ROUTES.emailTemplates} style={{ height: 46, padding: '0 22px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none' }} hover={{ background: 'var(--sand-700)', color: '#fff', textDecoration: 'none' }}>{t('yc.em.empty.tpl')}</Hv>
                <Hv as={Link} to={`${CRM_ROUTES.emailStudio('new')}?new=vide`} style={{ height: 46, padding: '0 20px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', color: 'var(--ink)', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none' }} hover={{ borderColor: 'var(--sand-300)', color: 'var(--ink)', textDecoration: 'none' }}>{t('yc.em.empty.blank')}</Hv>
              </div>
            </section>
          ) : (
            <>
              <SalesHero data={data} days={days} setDays={(d) => setSp(d === 30 ? {} : { p: '90' }, { replace: true })} g={g} hover={hover} setHover={setHover} periodLabel={periodLabel} />
              <Kpis cur={data.current} prev={data.previous} campaigns={data.campaigns} c={c} />
              <Funnel cur={data.current} g={g} fh={fh} setFh={setFh} periodLabel={periodLabel} />
            </>
          )}

          {/* Prochains envois + Yunits */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
            <section style={{ flex: '1.5 1 480px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16, padding: 24, borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', ...enter(620) }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.em.up.t')}</h2>
                  <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.em.up.s')}</div>
                </div>
                <Hv as={Link} to={CRM_ROUTES.emailCampaigns} style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)', textDecoration: 'none', whiteSpace: 'nowrap' }} hover={{ color: 'var(--red-600)', textDecoration: 'none' }}>{t('yc.em.up.all')}</Hv>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {scheduled.length === 0 && ready.length === 0 && <span style={{ fontSize: 14, color: 'var(--sand-500)', padding: '6px 0' }}>{t('yc.em.up.none')}</span>}
                {[...ready.filter((d) => d.scheduled_at), ...scheduled].slice(0, 5).map((u) => <UpcomingRow key={u.id} u={u} size={sizes[u.id]} />)}
              </div>
              {drafts.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, borderTop: '1px solid var(--sand-100)', paddingTop: 10 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)', padding: '4px 0' }}>{t('yc.em.up.drafts')}</span>
                  {drafts.slice(0, 4).map((d) => {
                    const gaps = draftGaps(d);
                    const days0 = Math.floor((Date.now() - Date.parse(d.updated_at)) / 86_400_000);
                    const when = days0 <= 0 ? t('yc.em.ago.today') : days0 === 1 ? t('yc.em.ago.yesterday') : t('yc.em.ago.days', { n: days0 });
                    const g0 = gaps.map((k) => t(`yc.em.gap.${k}`)).join(', ');
                    return (
                      <Hv key={d.id} as={Link} to={gaps.length ? CRM_ROUTES.emailStudio(d.id) : CRM_ROUTES.emailSend(d.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, margin: '0 -10px', borderRadius: 14, color: 'var(--ink)', textDecoration: 'none' }} hover={{ background: 'var(--sand-50)', color: 'var(--ink)', textDecoration: 'none' }}>
                        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name || t('yc.em.untitled')}</span>
                          <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.em.up.edited', { when })} · {gaps.length ? t('yc.em.up.missing', { gaps: g0.charAt(0).toUpperCase() + g0.slice(1) }) : t('yc.em.up.ready')}</span>
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--red-600)' }}>{t('yc.em.todo.resume')}</span>
                      </Hv>
                    );
                  })}
                </div>
              )}
            </section>
            <YunitsCard balance={balance} rateEmail={emailRate} next={scheduled[0] ?? null} size={scheduled[0] ? sizes[scheduled[0].id] : undefined} c={c} />
          </div>

          {/* Dernières campagnes */}
          {data.last.length > 0 && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 14, ...enter(740) }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em' }}>{t('yc.em.last.t')}</h2>
                <Hv as={Link} to={`${CRM_ROUTES.emailCampaigns}?s=sent`} style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)', textDecoration: 'none' }} hover={{ color: 'var(--red-600)', textDecoration: 'none' }}>{t('yc.em.last.all')}</Hv>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,280px),1fr))', gap: 16 }}>
                {data.last.map((x) => (
                  <Hv key={x.id} as={Link} to={CRM_ROUTES.emailResults(x.id)} style={{ display: 'flex', flexDirection: 'column', borderRadius: 24, overflow: 'hidden', background: '#fff', border: '1px solid var(--sand-200)', color: 'var(--ink)', textDecoration: 'none', transition: `translate 240ms ${EASE},box-shadow 240ms,border-color 200ms` }} hover={{ translate: '0 -4px', boxShadow: 'var(--shadow-md)', borderColor: 'var(--sand-300)', color: 'var(--ink)', textDecoration: 'none' }}>
                    <EmailThumb id={x.id} subject={x.subject} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 18px 18px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', lineHeight: '20px' }}>{x.name || t('yc.em.untitled')}</span>
                        <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.em.last.meta', { date: dShort(x.sent_at), n: n(x.n) })}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                        {[[pct((rate(x.opened, x.received) ?? 0) * 100), 'yc.em.st.opened'], [pct((rate(x.clicked, x.received) ?? 0) * 100), 'yc.em.st.clicked'], [n(x.purchases), 'yc.em.st.bought']].map(([v, l]) => (
                          <div key={l} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{v}</b>
                            <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{t(l)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </Hv>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </EmailsShell>
  );

}

// ── Pièces ──────────────────────────────────────────────────────────────
function UpcomingRow({ u, size }: { u: EmailCampaignRow; size: number | undefined }) {
  const { t, n, time, locale } = useCrmT();
  const at = u.scheduled_at ? new Date(u.scheduled_at) : null;
  const isDraft = u.status === 'draft';
  return (
    <Hv as={Link} to={isDraft ? CRM_ROUTES.emailSend(u.id) : `${CRM_ROUTES.emailCampaigns}?s=sched`} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 10px', margin: '0 -10px', borderRadius: 16, color: 'var(--ink)', textDecoration: 'none', transition: 'background 160ms' }} hover={{ background: 'var(--sand-50)', color: 'var(--ink)', textDecoration: 'none' }}>
      <span style={{ flex: 'none', width: 52, height: 56, borderRadius: 14, background: isDraft ? 'var(--red-500)' : 'var(--sand-100)', color: isDraft ? '#fff' : 'var(--ink)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em' }}>{at ? at.getDate() : '—'}</span>
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 3 }}>{at ? at.toLocaleDateString(locale, { month: 'short' }).replace('.', '') : ''}</span>
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 15.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name || t('yc.em.untitled')}</span>
        <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{at ? (size !== undefined ? t('yc.em.up.meta', { time: time(at), n: n(size) }) : t('yc.em.up.metaNoN', { time: time(at) })) : ''}</span>
      </span>
      <span style={{ flex: 'none', height: 26, padding: '0 11px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, background: isDraft ? 'var(--red-50)' : 'var(--green-50)', color: isDraft ? 'var(--red-700)' : 'var(--green-700)' }}>
        <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor' }} />{t(isDraft ? 'yc.em.up.toValidate' : 'yc.em.up.scheduled')}
      </span>
    </Hv>
  );
}

function YunitsCard({ balance: bal, rateEmail, next, size, c: cc }: { balance: number | null; rateEmail: number; next: EmailCampaignRow | null; size: number | undefined; c: number }) {
  const { t, n, dShort, time } = useCrmT();
  const cost = next && size !== undefined ? size * rateEmail : null;
  const w = bal && cost !== null ? Math.min(100, (cost / Math.max(1, bal)) * 100) : 0;
  return (
    <section style={{ flex: '1 1 320px', minWidth: 0, position: 'relative', overflow: 'hidden', isolation: 'isolate', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 16, padding: 26, borderRadius: 28, color: 'var(--text-on-night)', background: 'radial-gradient(90% 70% at 100% 110%,rgba(227,20,27,.4),transparent 65%),radial-gradient(60% 45% at 0% 0%,rgba(255,107,53,.14),transparent 70%),var(--noise-night),var(--night)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)', ...enter(680) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <YunitFace mood="content" size={40} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-on-night-2)' }}>{t('yc.em.yu.k')}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 64, lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{bal === null ? '—' : n(bal * cc)}</span>
        <span style={{ fontSize: 16, color: 'var(--text-on-night-2)' }}>{t('yc.em.yu.avail')}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', height: 8, gap: 2, borderRadius: 99, overflow: 'hidden', background: 'rgba(255,255,255,.12)' }}>
          <div style={{ width: `${(w * cc).toFixed(1)}%`, background: 'var(--gradient-brand)' }} />
        </div>
        <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--text-on-night-2)', textWrap: 'pretty' }}>
          {next && cost !== null && next.scheduled_at && bal !== null
            ? t('yc.em.yu.next', { name: next.name || t('yc.em.untitled'), date: `${dShort(next.scheduled_at)} · ${time(next.scheduled_at)}`, n: n(cost), after: t('yc.em.yu.unit', { n: n(Math.max(0, bal - cost)) }) })
            : t('yc.em.yu.nextShort')}
        </span>
      </div>
      <div style={{ marginTop: 'auto', display: 'flex', flexWrap: 'wrap', gap: '8px 14px', alignItems: 'center', paddingTop: 6 }}>
        <Hv as={Link} to={CRM_ROUTES.yunits} style={{ height: 42, padding: '0 20px', borderRadius: 99, background: '#fff', color: 'var(--ink)', fontSize: 14.5, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none' }} hover={{ background: 'var(--sand-100)', color: 'var(--ink)', textDecoration: 'none' }}>{t('yc.em.yu.reload')}</Hv>
        <span style={{ fontSize: 13, color: 'var(--text-on-night-2)' }}>{t('yc.em.yu.rate', { n: rateEmail })}</span>
      </div>
    </section>
  );
}

// ── Héros : CA attribué, une barre par campagne ─────────────────────────────
function SalesHero({ data, days, setDays, g, hover, setHover, periodLabel }: {
  data: NonNullable<ReturnType<typeof useEmailOverview>['data']>; days: 30 | 90; setDays: (d: 30 | 90) => void; g: number;
  hover: number | null; setHover: (i: number | null) => void; periodLabel: string;
}) {
  const { t, tp, n, eur, pct, dShort, n1 } = useCrmT();
  const cur = data.current, prev = data.previous;
  const dS = delta(cur.revenue, prev.campaigns ? prev.revenue : null, 'pct');
  const list = data.campaigns;
  const top = niceTop(Math.max(0, ...list.map((x) => x.revenue)));
  const best = list.filter((x) => x.n > 0 && x.purchases > 0).sort((a, b) => b.purchases / b.n - a.purchases / a.n)[0];
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: 'clamp(20px,2.4vw,32px)', borderRadius: 28, background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)', ...enter(480) }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px 20px' }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.em.sales.t')}</h2>
          <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2, maxWidth: 560, textWrap: 'pretty' }}>{t('yc.em.sales.s', { period: periodLabel })}</div>
        </div>
        <div role="group" aria-label={t('yc.em.period.aria')} style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--sand-100)', borderRadius: 99 }}>
          {([30, 90] as const).map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)} aria-pressed={days === d} style={{ height: 34, padding: '0 16px', border: 0, borderRadius: 99, background: days === d ? '#fff' : 'transparent', boxShadow: days === d ? 'var(--shadow-xs)' : 'none', fontSize: 14, fontWeight: 600, color: days === d ? 'var(--ink)' : 'var(--sand-600)', cursor: 'pointer', transition: 'background 160ms,color 160ms' }}>{t('yc.em.d', { n: d })}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 24px' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(56px,8vw,112px)', lineHeight: 0.92, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums' }}>{eur(cur.revenue * g)}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 10 }}>
          <span style={{ fontSize: 17, fontWeight: 600, color: !dS ? 'var(--sand-500)' : dS.up ? 'var(--green-700)' : 'var(--red-600)' }}>
            {!dS ? t('yc.em.vsPrev.first') : t(dS.up ? 'yc.em.vsPrev.up' : 'yc.em.vsPrev.down', { v: pct(Math.abs(dS.v)) })}
          </span>
          <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{tp('yc.em.sales.sub', cur.campaigns, { n: n(cur.campaigns), p: n(cur.purchases) })}</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', fontSize: 13, color: 'var(--sand-600)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><i style={{ width: 10, height: 14, borderRadius: '3px 3px 0 0', background: 'linear-gradient(180deg,var(--tangerine-500),var(--red-500))', display: 'inline-block' }} />{t('yc.em.bars.legend')}</span>
        <span>{t('yc.em.bars.hint')}</span>
      </div>
      {list.length === 0 ? (
        <div style={{ height: 120, display: 'grid', placeItems: 'center', fontSize: 14, color: 'var(--sand-500)', borderRadius: 18, background: 'var(--sand-50)' }}>{t('yc.em.bars.none')}</div>
      ) : (
        <>
          <div onMouseLeave={() => setHover(null)} style={{ position: 'relative', height: 250, marginLeft: 64 }}>
            {[0, 0.5, 1].map((r) => (
              <div key={r} style={{ position: 'absolute', left: -64, right: 0, bottom: `${r * 100}%`, height: 0, borderTop: '1px solid var(--sand-100)', pointerEvents: 'none' }}>
                <span style={{ position: 'absolute', left: 0, top: -9, width: 56, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--sand-400)', background: '#fff', paddingRight: 4, boxSizing: 'border-box', whiteSpace: 'nowrap' }}>{r === 0 ? '0' : eur(top * r)}</span>
              </div>
            ))}
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', gap: 10 }}>
              {list.map((x, i) => {
                const lp = Math.max(0, Math.min(1, g * 1.6 - (i / Math.max(1, list.length)) * 0.6));
                const e3 = 1 - Math.pow(1 - lp, 3);
                const h = `${((x.revenue / top) * 100 * e3).toFixed(1)}%`;
                return (
                  <Link key={x.id} to={CRM_ROUTES.emailResults(x.id)} onMouseEnter={() => setHover(i)} aria-label={x.name ?? ''} style={{ position: 'relative', flex: '1 1 0', maxWidth: 110, height: '100%', display: 'flex', alignItems: 'flex-end', cursor: 'pointer', textDecoration: 'none' }}>
                    <div style={{ width: '100%', height: h, minHeight: 3, borderRadius: '6px 6px 0 0', background: hover === i ? 'var(--red-700)' : 'linear-gradient(180deg,var(--tangerine-500),var(--red-500))', opacity: hover !== null && hover !== i ? 0.45 : 1, transition: 'background 140ms,opacity 140ms' }} />
                    {hover === i && (
                      <div style={{ position: 'absolute', bottom: `calc(${h} + 10px)`, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none', background: 'var(--ink)', color: '#fff', borderRadius: 14, padding: '10px 14px', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', gap: 2, whiteSpace: 'nowrap', zIndex: 3, animation: 'yc-fade 140ms both' }}>
                        <span style={{ fontSize: 12, color: 'var(--text-on-night-2)' }}>{dShort(x.sent_at)}</span>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{x.name}</span>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{eur(x.revenue)}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-on-night-2)' }}>{t('yc.em.bars.tip', { p: n(x.purchases), n: n(x.n) })}</span>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
          <div style={{ marginLeft: 64, display: 'flex', justifyContent: 'space-around', gap: 10 }}>
            {list.map((x) => (
              <span key={x.id} style={{ flex: '1 1 0', maxWidth: 110, textAlign: 'center', fontSize: 12, lineHeight: '15px', color: 'var(--sand-500)', textWrap: 'balance' }}>
                <b style={{ display: 'block', fontWeight: 600, color: 'var(--sand-700)' }}>{shortName(x.name)}</b>{dShort(x.sent_at)}
              </span>
            ))}
          </div>
        </>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 16, background: 'var(--red-50)' }}>
        <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)' }} />
        <span style={{ fontSize: 15, lineHeight: 1.45, fontWeight: 500, textWrap: 'pretty' }}>
          {best ? t('yc.em.best', { name: best.name ?? '', v: n1(perK(best) ?? 0) }) : t('yc.em.bestNone')}
        </span>
      </div>
    </section>
  );
}

function Kpis({ cur, prev, campaigns, c }: { cur: PeriodTotals; prev: PeriodTotals; campaigns: { n: number; purchases: number }[]; c: number }) {
  const { t, tp, n, pct } = useCrmT();
  const has = prev.campaigns > 0;
  const orC = rate(cur.opened, cur.received) ?? 0, crC = rate(cur.clicked, cur.received) ?? 0;
  const orP = has ? rate(prev.opened, prev.received) : null, crP = has ? rate(prev.clicked, prev.received) : null;
  const line = (d: ReturnType<typeof delta>, unit: 'pct' | 'pt') => {
    if (!d) return { text: t('yc.em.vsPrev.first'), fg: 'var(--sand-500)' };
    const v = unit === 'pt' ? t('yc.em.pt', { v: Math.abs(d.v).toFixed(1).replace('.', ',') }) : pct(Math.abs(d.v));
    return { text: t(d.up ? 'yc.em.vsPrev.up' : 'yc.em.vsPrev.down', { v }), fg: d.up ? 'var(--green-700)' : 'var(--red-600)' };
  };
  const spark = (vals: number[]) => {
    const m = Math.max(1, ...vals);
    return vals.map((v, i) => ({ h: `${(30 + (v / m) * 70) * Math.max(0, Math.min(1, c * 1.5 - i * 0.14))}%`, last: i === vals.length - 1 }));
  };
  const items = [
    { l: t('yc.em.k.sent'), v: n(cur.sent * c), d: line(delta(cur.sent, has ? prev.sent : null, 'pct'), 'pct'), def: tp('yc.em.k.sentDef', cur.campaigns, { n: n(cur.campaigns) }), sp: spark(campaigns.map((x) => x.n)) },
    { l: t('yc.em.k.opened'), v: pct(orC * 100 * c), d: line(delta(orC, orP, 'pt'), 'pt'), def: t('yc.em.k.openedDef'), ring: orC * 360 * c },
    { l: t('yc.em.k.clicked'), v: pct(crC * 100 * c, 1), d: line(delta(crC, crP, 'pt'), 'pt'), def: t('yc.em.k.clickedDef'), ring: Math.min(360, crC * 360 * c * 2) },
    { l: t('yc.em.k.bought'), v: n(cur.purchases * c), d: line(delta(cur.purchases, has ? prev.purchases : null, 'pct'), 'pct'), def: t('yc.em.k.boughtDef'), sp: spark(campaigns.map((x) => x.purchases)) },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>
      {items.map((k, i) => (
        <Hv key={k.l} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '20px 22px', borderRadius: 20, background: '#fff', border: '1px solid var(--sand-200)', minWidth: 0, animation: `yc-rise 800ms ${EASE} ${600 + i * 80}ms both`, transition: `translate 240ms ${EASE},box-shadow 240ms,border-color 200ms` }} hover={{ translate: '0 -4px', boxShadow: 'var(--shadow-md)', borderColor: 'var(--sand-300)' }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--sand-600)' }}>{k.l}</span>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 44, lineHeight: 1.05, letterSpacing: '-.035em', fontVariantNumeric: 'tabular-nums' }}>{k.v}</span>
            {k.ring !== undefined && (
              <div style={{ position: 'relative', flex: 'none', width: 56, height: 56, borderRadius: '50%', background: `conic-gradient(var(--red-500) 0 ${k.ring.toFixed(1)}deg,var(--red-100) 0)` }}>
                <span style={{ position: 'absolute', inset: 9, borderRadius: '50%', background: '#fff' }} />
              </div>
            )}
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: k.d.fg }}>{k.d.text}</span>
          {k.sp && (
            <div style={{ marginTop: 6, height: 40, display: 'flex', alignItems: 'flex-end', gap: 5 }}>
              {k.sp.map((s, j) => <div key={j} style={{ flex: 1, height: s.h, borderRadius: '4px 4px 0 0', background: s.last ? 'linear-gradient(180deg,var(--tangerine-500),var(--red-500))' : 'var(--red-100)' }} />)}
            </div>
          )}
          <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--sand-500)', marginTop: 4 }}>{k.def}</span>
        </Hv>
      ))}
    </div>
  );
}

function Funnel({ cur, g, fh, setFh, periodLabel }: { cur: PeriodTotals; g: number; fh: number | null; setFh: (i: number | null) => void; periodLabel: string }) {
  const { t, n, pct } = useCrmT();
  const steps: [string, number][] = [['sent', cur.sent], ['received', cur.received], ['opened', cur.opened], ['clicked', cur.clicked], ['ticketing', cur.ticketing], ['bought', cur.purchases]];
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', ...enter(560) }}>
      <div>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.em.f.t')}</h2>
        <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.em.f.s', { period: periodLabel })}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {steps.map(([k, v], i) => {
          const pv = i ? steps[i - 1][1] : 0;
          const conv = i ? (pv > 0 ? v / pv : 0) : 0;
          const w = cur.sent > 0 ? Math.max(3, Math.sqrt(v / cur.sent) * 100 * Math.max(0, Math.min(1, g * 1.5 - i * 0.12))) : 3;
          const fill = i === 5 ? 'var(--gradient-brand)' : i === 0 ? 'var(--sand-200)' : `color-mix(in srgb,var(--red-500) ${24 + i * 13}%,#fff)`;
          return (
            <div key={k} onMouseEnter={() => setFh(i)} onMouseLeave={() => setFh(null)} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,190px) 1fr', alignItems: 'center', gap: '8px 20px', padding: '10px 12px', margin: '0 -12px', borderRadius: 16, background: fh === i ? 'var(--sand-50)' : 'transparent', opacity: fh !== null && fh !== i ? 0.5 : 1, transition: 'background 160ms,opacity 160ms' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{t(`yc.em.f.${k}`)}</span>
                <span style={{ fontSize: 12.5, lineHeight: '16px', color: 'var(--sand-500)' }}>{i ? t('yc.em.f.conv', { p: pct(conv * 100, conv < 0.1 && conv > 0 ? 1 : 0) }) : t('yc.em.f.start')}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                <div style={{ height: 30, width: `${w.toFixed(1)}%`, minWidth: 8, borderRadius: 99, background: fill, transition: 'width 120ms' }} />
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{n(v)}</span>
              </div>
              <div style={{ gridColumn: 2, fontSize: 13, lineHeight: '17px', color: 'var(--sand-600)', maxHeight: fh === i ? 40 : 0, opacity: fh === i ? 1 : 0, overflow: 'hidden', transition: 'max-height 200ms,opacity 200ms' }}>{t(`yc.em.f.${k}D`)}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
