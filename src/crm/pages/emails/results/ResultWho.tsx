/**
 * Résultats › Destinataires : chaque groupe (cycle de vie au jour de
 * l'envoi) avec ses ouvertures, clics et achats ; la carte des non-ouvreurs
 * qui prépare la relance ; puis la liste de tous les destinataires, filtrée
 * et cherchable, chacun menant à sa fiche client.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE, clamp01, useProgress } from '@/crm/ui/motion';
import { Insight, Skel } from '@/crm/ui/kit';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { useEmailRecipients, useEmailResultSegments, type EmailRecipients, type EmailResult, type RecipientFilter } from '@/crm/data/emails';
import { LIFECYCLE_AVATAR, LIFECYCLE_COLOR, fullName, initials } from '@/crm/lib/lifecycle';
import type { Lifecycle } from '@/crm/data/clients';

const box = { display: 'flex', flexDirection: 'column', padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' } as const;
const h2 = { margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' } as const;
const subCss = { fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2, textWrap: 'pretty' } as const;

export type ResendState = 'open' | 'planned' | 'done' | 'none';

export function ResultWho({ r, resend, onResend }: { r: EmailResult; resend: ResendState; onResend: () => void }) {
  const { t, tp, n } = useCrmT();
  const nonOpeners = r.stats?.non_openers ?? 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, animation: `yc-rise 520ms ${EASE} both` }}>
      <Groups r={r} />
      {nonOpeners > 0 && resend !== 'none' && (
        <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 24px', padding: '22px 26px', borderRadius: 24, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
          <YunitFace mood={resend === 'open' ? 'content' : 'ravi'} size={52} />
          <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em' }}>{tp('yc.em.rs.w.unopened', nonOpeners, { n: n(nonOpeners) })}</b>
            <span style={{ fontSize: 14.5, color: 'var(--sand-600)', lineHeight: 1.45 }}>
              {resend === 'open' ? t('yc.em.rs.w.unopenedSub', { n: n(nonOpeners) }) : t(resend === 'planned' ? 'yc.em.rs.w.plannedSub' : 'yc.em.rs.w.doneSub')}
            </span>
          </div>
          {resend === 'open' && (
            <Hv as="button" type="button" onClick={onResend} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: 0, background: 'var(--ink)', color: '#fff', fontSize: 14.5, fontWeight: 600, display: 'flex', alignItems: 'center', cursor: 'pointer' }} hover={{ background: 'var(--sand-700)' }}>
              {t('yc.em.rs.w.prepare')}
            </Hv>
          )}
          {resend === 'done' && r.resend.campaign_id && (
            <Hv as={Link} to={CRM_ROUTES.emailResults(r.resend.campaign_id)} style={{ height: 44, padding: '0 20px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', color: 'var(--ink)', fontSize: 14.5, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none' }} hover={{ borderColor: 'var(--sand-300)', color: 'var(--ink)', textDecoration: 'none' }}>
              {t('yc.em.rs.resendDone')}
            </Hv>
          )}
        </section>
      )}
      <RecipientList id={r.id} />
    </div>
  );
}

function Groups({ r }: { r: EmailResult }) {
  const { t, tp, n, n1, pct } = useCrmT();
  const narrow = useNarrow(720);
  const q = useEmailResultSegments(r.id);
  const g = useProgress(1100, 200, `${r.id}-${q.data ? 1 : 0}`);
  const rows = useMemo(() => (q.data ?? []).filter((x) => x.n > 0).sort((a, b) => b.n - a.n), [q.data]);
  const perK = (p: number, k: number) => (k ? (p / k) * 1000 : 0);
  const best = rows.length > 1 ? rows.reduce((a, b) => (perK(b.purchases, b.n) > perK(a.purchases, a.n) ? b : a)) : null;
  const hasBest = !!best && best.purchases > 0;
  const others = hasBest ? rows.filter((x) => x !== best) : [];
  const oN = others.reduce((s, x) => s + x.n, 0);
  const oP = others.reduce((s, x) => s + x.purchases, 0);
  const insight = rows.length <= 1
    ? t('yc.em.rs.w.single')
    : hasBest
      ? t('yc.em.rs.w.ins', { best: t(`yc.cli.seg.${best!.lifecycle}`), a: n1(perK(best!.purchases, best!.n)), b: n1(perK(oP, oN)) })
      : t('yc.em.rs.w.noBuy');

  return (
    <section style={{ ...box, gap: 18 }}>
      <div><h2 style={h2}>{t('yc.em.rs.w.t')}</h2><div style={subCss}>{t('yc.em.rs.w.s')}</div></div>
      {q.isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[0, 1, 2].map((k) => <Skel key={k} h={84} r={20} />)}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((s, i) => {
            const isBest = hasBest && s === best;
            const or = s.n ? s.opened / s.n : 0;
            const cr = s.n ? s.clicked / s.n : 0;
            const life = s.lifecycle as Lifecycle;
            const k = clamp01(g * 1.4 - i * 0.1);
            return (
              <div key={s.lifecycle} style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr) 72px' : 'minmax(140px,1.2fr) minmax(0,2.4fr) 100px', gap: '12px 22px', alignItems: 'center', padding: '16px 18px', borderRadius: 20, background: isBest ? 'var(--green-50)' : 'var(--paper)', boxShadow: `inset 0 0 0 1px ${isBest ? '#BFE6CE' : 'var(--sand-100)'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <i style={{ flex: 'none', width: 12, height: 12, borderRadius: 4, background: LIFECYCLE_COLOR[life] ?? 'var(--sand-200)', boxShadow: life === 'none' ? 'inset 0 0 0 1px var(--sand-300)' : undefined }} />
                  <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <b style={{ fontSize: 15.5 }}>{t(`yc.cli.seg.${life}`)}</b>
                    <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{tp('yc.em.rs.w.contacts', s.n, { n: n(s.n) })}</span>
                  </span>
                  {isBest && <span style={{ height: 22, padding: '0 9px', borderRadius: 99, background: 'var(--green-500)', color: '#fff', fontSize: 11.5, fontWeight: 600, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>{t('yc.em.rs.w.best')}</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 18px', gridColumn: narrow ? '1 / -1' : undefined, gridRow: narrow ? 2 : undefined }}>
                  {[
                    { l: t('yc.em.rs.w.opened'), v: or, fill: 'var(--red-300)' },
                    { l: t('yc.em.rs.w.clicked'), v: cr, fill: 'var(--gradient-brand)' },
                  ].map((m) => (
                    <div key={m.l} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: 'var(--sand-500)' }}>{m.l}</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{pct(m.v * 100)}</b></div>
                      <div style={{ height: 8, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}><div style={{ width: `${m.v * 100 * k}%`, height: '100%', borderRadius: 99, background: m.fill }} /></div>
                    </div>
                  ))}
                </div>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gridColumn: narrow ? 2 : undefined, gridRow: narrow ? 1 : undefined }}>
                  <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{n(s.purchases)}</b>
                  <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{tp('yc.em.rs.w.buys', s.purchases)}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
      {!q.isLoading && rows.length > 0 && <Insight>{insight}</Insight>}
    </section>
  );
}

type Row = EmailRecipients['rows'][number];
const FILTERS: RecipientFilter[] = ['all', 'opened', 'clicked', 'bought', 'unopened', 'bounced'];

function RecipientList({ id }: { id: string }) {
  const { t, tp, n, eur } = useCrmT();
  const [filter, setFilter] = useState<RecipientFilter>('all');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    const v = text.trim();
    if (v === q) return undefined;
    const h = window.setTimeout(() => { setQ(v); setOffset(0); }, 300);
    return () => window.clearTimeout(h);
  }, [text, q]);
  const pick = (f: RecipientFilter) => { setFilter(f); setOffset(0); };
  const res = useEmailRecipients(id, filter, q, offset);
  useEffect(() => {
    if (!res.data || res.isPlaceholderData) return;
    const page = res.data.rows ?? [];
    setRows((prev) => (offset === 0 ? page : [...prev, ...page]));
  }, [res.data, res.isPlaceholderData, offset]);
  const counts = res.data?.counts;
  const total = res.data?.total ?? 0;
  const loadingFirst = res.isLoading || (res.isPlaceholderData && offset === 0);

  const chip = (p: Row) => {
    if (p.bought ?? (p.revenue ?? 0) > 0) return { l: p.revenue !== null && p.revenue > 0 ? t('yc.em.rs.st.bought', { v: eur(p.revenue) }) : t('yc.em.rs.st.boughtN'), bg: 'var(--green-50)', fg: 'var(--green-700)' };
    if (p.status === 'bounced') return { l: t('yc.em.rs.st.bounced'), bg: 'var(--amber-50)', fg: 'var(--amber-700)' };
    if (p.clicked) return { l: t('yc.em.rs.st.clicked'), bg: 'var(--red-50)', fg: 'var(--red-700)' };
    if (p.opened) return { l: t('yc.em.rs.st.opened'), bg: 'var(--sand-100)', fg: 'var(--sand-700)' };
    return { l: t('yc.em.rs.st.received'), bg: 'var(--sand-50)', fg: 'var(--sand-500)' };
  };

  return (
    <section style={{ ...box, gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div><h2 style={h2}>{t('yc.em.rs.list.t')}</h2>{counts && <div style={subCss}>{tp('yc.em.rs.list.total', counts.all, { n: n(counts.all) })}</div>}</div>
        <label style={{ position: 'relative', flex: '0 1 300px', minWidth: 200 }}>
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--sand-400)', display: 'flex' }}><Icon name="search" size={16} stroke={2.2} /></span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('yc.em.rs.list.search')} aria-label={t('yc.em.rs.list.search')} className="yc-field" style={{ width: '100%', height: 42, boxSizing: 'border-box', padding: '0 14px 0 38px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14.5, color: 'var(--ink)', outline: 'none' }} />
        </label>
      </div>
      <div className="yc-thin-scroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        {FILTERS.map((f) => {
          const on = f === filter;
          const c = counts?.[f];
          if (f === 'bounced' && !c) return null;
          return (
            <button key={f} type="button" onClick={() => pick(f)} aria-pressed={on} style={{ flex: 'none', height: 36, padding: '0 14px', borderRadius: 99, border: `1px solid ${on ? 'var(--ink)' : 'var(--sand-200)'}`, background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', transition: 'background 160ms,border-color 160ms' }}>
              {t(`yc.em.rs.list.f.${f}`)}
              {c !== undefined && <span style={{ fontVariantNumeric: 'tabular-nums', color: on ? 'rgba(255,255,255,.7)' : 'var(--sand-500)', fontWeight: 500 }}>{n(c)}</span>}
            </button>
          );
        })}
      </div>
      {loadingFirst ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[0, 1, 2, 3].map((k) => <Skel key={k} h={52} r={14} />)}</div>
      ) : !rows.length ? (
        <div style={{ padding: '18px 0', fontSize: 15, color: 'var(--sand-500)' }}>{t('yc.em.rs.list.empty')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((p, i) => {
            const life = (p.lifecycle ?? 'none') as Lifecycle;
            const [bg, fg] = LIFECYCLE_AVATAR[life] ?? LIFECYCLE_AVATAR.none;
            const c = chip(p);
            return (
              <Hv
                as={Link}
                key={p.email}
                to={`${CRM_ROUTES.clients}?c=${encodeURIComponent(p.email)}`}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 10px', margin: '0 -10px', borderRadius: 14, borderTop: i ? '1px solid var(--sand-100)' : '1px solid transparent', color: 'var(--ink)', textDecoration: 'none', transition: 'background 160ms' }}
                hover={{ background: 'var(--sand-50)', color: 'var(--ink)', textDecoration: 'none' }}
              >
                <span style={{ flex: 'none', width: 36, height: 36, borderRadius: 99, background: bg, color: fg, display: 'grid', placeItems: 'center', fontSize: 12.5, fontWeight: 600 }}>{initials(p.first_name, p.last_name, p.email)}</span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <b style={{ fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fullName(p.first_name, p.last_name, p.email)}</b>
                  <span style={{ fontSize: 12.5, color: 'var(--sand-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email} · {t(`yc.cli.seg.${life}`)}</span>
                </span>
                <span style={{ flex: 'none', height: 26, padding: '0 11px', borderRadius: 99, background: c.bg, color: c.fg, fontSize: 12.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>{c.l}</span>
              </Hv>
            );
          })}
        </div>
      )}
      {!loadingFirst && rows.length < total && (
        <Hv as="button" type="button" onClick={() => setOffset(rows.length)} disabled={res.isFetching} style={{ alignSelf: 'center', height: 40, padding: '0 18px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', color: 'var(--ink)', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: res.isFetching ? 0.6 : 1 }} hover={{ borderColor: 'var(--sand-300)' }}>
          {t('yc.em.rs.list.more')}
        </Hv>
      )}
    </section>
  );
}
