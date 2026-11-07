/**
 * Résultats › Résumé : les places prises grâce à l'e-mail (classement, trois
 * chiffres), l'e-mail envoyé, l'entonnoir de l'envoi à la place prise, jour par
 * jour ce qu'on regarde puis réserve, les places une par une, ce qu'on a écarté
 * (clics automatiques, ouvertures par préchargement) et la santé de l'envoi.
 *
 * Une place est CERTAINE (le billet porte la source de l'e-mail chez Shotgun),
 * PROBABLE (clic de personne puis achat sous 7 jours) ; « réservé ensuite » se
 * compte à part. Les clics automatiques n'entrent jamais : ils sont écartés à la
 * source (migrations 20261201100000 et 20261201110000).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE, clamp01, useProgress } from '@/crm/ui/motion';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';
import type { EmailResult } from '@/crm/data/emails';

type Stats = NonNullable<EmailResult['stats']>;

const box = { display: 'flex', flexDirection: 'column', padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' } as const;
const h2 = { margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' } as const;
const subCss = { fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2, textWrap: 'pretty' } as const;

export function ResultSummary({ r, s, html, onZoom }: { r: EmailResult; s: Stats; html: string | null | undefined; onZoom: () => void }) {
  const { t, tp, n, eur, dShort } = useCrmT();
  const g = useProgress(1300, 400, r.id);
  const good = r.rank !== null && r.rank <= Math.ceil(r.rank_of / 2);
  const verdict = r.rank_of <= 1 || r.rank === null ? t('yc.em.rs.rankFirst') : t(good ? 'yc.em.rs.rankGood' : 'yc.em.rs.rankLow', { r: r.rank, of: r.rank_of });
  const until = s.window_until ? new Date(s.window_until) : null;
  const kLaterD = until ? t('yc.em.rs.v2.kLaterD', { d: dShort(until) }) : t('yc.em.rs.v2.kLaterNo');
  const places = s.purchases;
  const chips = [
    { k: 'c', txt: t('yc.em.rs.v2.cert', { n: n(s.certain ?? places) }), on: true },
    { k: 'p', txt: t('yc.em.rs.v2.prob', { n: n(s.probable ?? 0) }), on: (s.probable ?? 0) > 0 },
    { k: 's', txt: t('yc.em.rs.v2.shared', { n: n(s.shared ?? 0) }), on: (s.shared ?? 0) > 0 },
  ].filter((c) => c.on);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, animation: `yc-rise 520ms ${EASE} both` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        <section style={{ ...box, flex: '1.5 1 520px', minWidth: 0, gap: 20, padding: 'clamp(20px,2.4vw,32px)', background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}>
          <div><h2 style={h2}>{t('yc.em.rs.sell.t')}</h2><div style={{ ...subCss, maxWidth: 520 }}>{t('yc.em.rs.sell.s')}</div></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 24px' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(56px,8vw,104px)', lineHeight: 0.92, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums' }}>{n(Math.round(places * g))}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 8 }}>
              <span style={{ fontSize: 20, fontWeight: 600 }}>{s.revenue === null || s.revenue === 0 ? tp('yc.em.rs.buysN', places) : tp('yc.em.rs.buys', places, { rev: eur(s.revenue) })}</span>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {chips.map((c) => <span key={c.k} style={{ height: 26, padding: '0 11px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', fontSize: 13, fontWeight: 500, background: 'var(--sand-100)', color: 'var(--sand-700)', whiteSpace: 'nowrap' }}>{c.txt}</span>)}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderRadius: 16, background: good || r.rank_of <= 1 ? 'var(--green-50)' : 'var(--amber-50)' }}>
            <YunitFace mood={good || r.rank_of <= 1 ? 'ravi' : 'content'} size={40} />
            <span style={{ fontSize: 15, lineHeight: 1.45, fontWeight: 500, textWrap: 'pretty' }}>{verdict}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
            {[
              { l: t('yc.em.rs.v2.kRecv'), v: n(s.received), d: t('yc.em.rs.v2.kRecvD', { n: n(s.bounced) }) },
              { l: t('yc.em.rs.v2.kSeen'), v: n(s.ticketing), d: t('yc.em.rs.v2.kSeenD') },
              { l: t('yc.em.rs.v2.kLater'), v: n(s.later ?? 0), d: kLaterD },
            ].map((k) => (
              <div key={k.l} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '14px 16px', borderRadius: 16, background: 'var(--paper)', boxShadow: 'inset 0 0 0 1px var(--sand-100)' }}>
                <span style={{ fontSize: 13, color: 'var(--sand-600)' }}>{k.l}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums', lineHeight: 1.05 }}>{k.v}</span>
                <span style={{ fontSize: 12.5, color: 'var(--sand-600)' }}>{k.d}</span>
              </div>
            ))}
          </div>
        </section>
        <section style={{ flex: '1 1 300px', minWidth: 0, maxWidth: 420, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: 22, borderRadius: 28, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
          <div style={{ alignSelf: 'stretch', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.em.rs.sent')}</span>
            {html && <Hv as="button" type="button" onClick={onZoom} style={{ border: 0, background: 'none', fontSize: 14, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }} hover={{ color: 'var(--red-600)' }}>{t('yc.em.rs.zoom')}<Icon name="maximize" size={15} stroke={2.2} /></Hv>}
          </div>
          {html ? (
            <Hv as="button" type="button" onClick={onZoom} aria-label={t('yc.em.rs.zoomLabel')} style={{ position: 'relative', width: 300, maxWidth: '100%', height: 420, padding: 0, border: 0, borderRadius: 18, overflow: 'hidden', background: '#fff', boxShadow: '0 0 0 1px var(--sand-200),var(--shadow-md)', cursor: 'zoom-in', transition: `translate 240ms ${EASE}` }} hover={{ translate: '0 -4px' }}>
              <iframe title={t('yc.em.rs.sent')} srcDoc={html} tabIndex={-1} sandbox="" style={{ position: 'absolute', top: 0, left: 0, width: 600, height: 840, border: 0, transform: 'scale(.5)', transformOrigin: 'top left', pointerEvents: 'none', background: '#fff' }} />
            </Hv>
          ) : (
            <div style={{ width: 300, maxWidth: '100%', height: 420, borderRadius: 18, display: 'grid', placeItems: 'center', padding: 24, boxSizing: 'border-box', textAlign: 'center', background: 'repeating-linear-gradient(135deg,var(--sand-50) 0 10px,var(--sand-100) 10px 20px)', boxShadow: '0 0 0 1px var(--sand-200)' }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
                <b style={{ fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '-.02em', color: 'var(--sand-700)' }}>{r.subject}</b>
                <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.em.rs.noContent')}</span>
              </span>
            </div>
          )}
        </section>
      </div>
      <Funnel s={s} g={g} />
      <DaysChart r={r} g={g} />
      <Sales r={r} />
      <FollowUp r={r} s={s} />
      <Discarded s={s} />
      <Health s={s} />
    </div>
  );
}

function Funnel({ s, g }: { s: Stats; g: number }) {
  const { t, n, pct } = useCrmT();
  const narrow = useNarrow(640);
  const [hov, setHov] = useState<number | null>(null);
  const steps = [
    { l: t('yc.em.rs.f.sent'), v: s.n, d: t('yc.em.rs.f.sentD') },
    { l: t('yc.em.rs.f.received'), v: s.received, d: t('yc.em.rs.f.receivedD', { n: n(s.bounced) }) },
    { l: t('yc.em.rs.v2.fSeen'), v: s.ticketing, d: t('yc.em.rs.v2.fSeenD') },
    // L'entonnoir compte des PERSONNES : un acheteur de trois billets compte une fois.
    { l: t('yc.em.rs.f.bought'), v: s.buyers ?? s.purchases, d: t('yc.em.rs.f.boughtD') },
  ];
  return (
    <section style={{ ...box, gap: 18 }}>
      <div><h2 style={h2}>{t('yc.em.rs.f.t')}</h2><div style={subCss}>{t('yc.em.rs.f.s')}</div></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {steps.map((st, i) => {
          const prev = i ? steps[i - 1].v : 0;
          const w = Math.max(3, Math.sqrt(s.n ? st.v / s.n : 0) * 100 * clamp01(g * 1.5 - i * 0.12));
          const conv = i === 0 ? t('yc.em.rs.f.start') : t('yc.em.rs.f.conv', { p: pct(prev ? (st.v / prev) * 100 : 0, prev && st.v / prev < 0.1 ? 1 : 0) });
          const on = hov === i;
          return (
            <div key={st.l} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : 'minmax(120px,190px) 1fr', alignItems: 'center', gap: narrow ? '6px 0' : '8px 20px', padding: '10px 12px', margin: '0 -12px', borderRadius: 16, background: on ? 'var(--sand-50)' : 'transparent', opacity: hov !== null && !on ? 0.5 : 1, transition: 'background 160ms,opacity 160ms' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{st.l}{narrow && <span style={{ fontWeight: 400, fontSize: 12.5, color: 'var(--sand-500)' }}> · {conv}</span>}</span>
                {!narrow && <span style={{ fontSize: 12.5, lineHeight: '16px', color: 'var(--sand-500)' }}>{conv}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                <div style={{ flex: '0 1 auto', height: 30, width: `${w}%`, minWidth: 8, borderRadius: 99, background: i === steps.length - 1 ? 'var(--gradient-brand)' : i === 0 ? 'var(--sand-200)' : `color-mix(in srgb,var(--red-500) ${24 + i * 13}%,#fff)` }} />
                <span style={{ flex: 'none', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{n(st.v)}</span>
              </div>
              <div style={{ gridColumn: narrow ? 1 : 2, fontSize: 13, lineHeight: '17px', color: 'var(--sand-600)', maxHeight: on ? 40 : 0, opacity: on ? 1 : 0, overflow: 'hidden', transition: 'max-height 200ms,opacity 200ms' }}>{st.d}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DaysChart({ r, g }: { r: EmailResult; g: number }) {
  const { t, n, dShort } = useCrmT();
  const days = r.days;
  const seen = days?.seen ?? [];
  const sold = days?.sold ?? [];
  const later = days?.later ?? [];
  const len = Math.max(seen.length, sold.length, later.length);
  const top = Math.max(1, ...seen, ...sold, ...later);
  const start = new Date(r.started_at ?? r.sent_at ?? Date.now());
  const any = [...seen, ...sold, ...later].some((v) => v > 0);
  const legend = [['var(--ink)', 'yc.em.rs.v2.lgSeen'], ['var(--red-500)', 'yc.em.rs.v2.lgSold'], ['var(--tangerine-500)', 'yc.em.rs.v2.lgLater']] as const;
  return (
    <section style={{ ...box, gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div><h2 style={h2}>{t('yc.em.rs.v2.dT')}</h2><div style={{ ...subCss, maxWidth: 560 }}>{t('yc.em.rs.v2.dS')}</div></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px' }}>
          {legend.map(([c, k]) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--sand-700)' }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: c }} />{t(k)}
            </span>
          ))}
        </div>
      </div>
      {!len || !any ? (
        <div style={{ padding: '14px 18px', borderRadius: 16, background: 'var(--sand-50)', fontSize: 15, color: 'var(--sand-600)' }}>{t('yc.em.rs.v2.dNone')}</div>
      ) : (
        <div className="yc-thin-scroll" style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 640, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 170, borderBottom: '1px solid var(--sand-300)' }}>
              {Array.from({ length: len }, (_, i) => {
                const d = new Date(start.getTime() + i * 864e5);
                const h = (v: number) => `${((v || 0) / top) * 100 * clamp01(g * 1.3 - i * 0.01)}%`;
                return (
                  <div key={i} title={t('yc.em.rs.v2.dayTip', { d: dShort(d), a: n(seen[i] ?? 0), b: n(sold[i] ?? 0), c: n(later[i] ?? 0) })} style={{ flex: '1 1 0', minWidth: 0, height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 1 }}>
                    <div style={{ width: '30%', maxWidth: 12, height: h(seen[i]), borderRadius: '3px 3px 0 0', background: 'var(--ink)' }} />
                    <div style={{ width: '30%', maxWidth: 12, height: h(sold[i]), borderRadius: '3px 3px 0 0', background: 'var(--red-500)' }} />
                    <div style={{ width: '30%', maxWidth: 12, height: h(later[i]), borderRadius: '3px 3px 0 0', background: 'var(--tangerine-500)' }} />
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              {Array.from({ length: len }, (_, i) => (
                <div key={i} style={{ flex: '1 1 0', minWidth: 0, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--sand-600)', whiteSpace: 'nowrap', overflow: 'visible' }}>
                  {i === 0 ? dShort(start) : i % 7 === 0 ? t('yc.em.rs.v2.day', { n: i }) : ''}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

const LEVEL_STYLE = {
  certain: { bg: 'var(--green-50)', fg: 'var(--green-700)', k: 'yc.em.rs.v2.lvC' },
  probable: { bg: 'var(--amber-50)', fg: 'var(--amber-700)', k: 'yc.em.rs.v2.lvP' },
  later: { bg: 'var(--sand-100)', fg: 'var(--sand-700)', k: 'yc.em.rs.v2.lvL' },
} as const;

function Sales({ r }: { r: EmailResult }) {
  const { t, n, dShort, time } = useCrmT();
  const rows = r.sales ?? [];
  if (!rows.length) return null;
  const chip = (bg: string, fg: string, txt: string) => <span style={{ height: 24, padding: '0 10px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', fontSize: 12.5, fontWeight: 600, background: bg, color: fg, whiteSpace: 'nowrap' }}>{txt}</span>;
  return (
    <section style={{ ...box, gap: 14 }}>
      <div><h2 style={h2}>{t('yc.em.rs.v2.pT')}</h2><div style={subCss}>{t('yc.em.rs.v2.pS')}</div></div>
      <div className="yc-thin-scroll" style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 560, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '110px minmax(180px,1.4fr) minmax(120px,1fr) minmax(140px,1fr)', gap: 14, padding: '8px 0', borderBottom: '1px solid var(--sand-200)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--sand-600)' }}>
            <span>{t('yc.em.rs.v2.pDate')}</span><span>{t('yc.em.rs.v2.pWho')}</span><span>{t('yc.em.rs.v2.pDeal')}</span><span>{t('yc.em.rs.v2.pLevel')}</span>
          </div>
          {rows.map((x) => {
            const at = new Date(x.at);
            const ls = LEVEL_STYLE[x.level];
            return (
              <div key={`${x.email}-${x.at}`} style={{ display: 'grid', gridTemplateColumns: '110px minmax(180px,1.4fr) minmax(120px,1fr) minmax(140px,1fr)', gap: 14, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--sand-100)', fontSize: 14 }}>
                <span style={{ color: 'var(--sand-700)' }}>{dShort(at)} · {time(at)}</span>
                <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{x.email}</span>
                <span style={{ color: 'var(--sand-700)', overflowWrap: 'anywhere' }}>{x.deal ?? '—'}</span>
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {chip(ls.bg, ls.fg, t(ls.k))}
                  {x.shared && chip('var(--sand-100)', 'var(--sand-700)', t('yc.em.rs.v2.lvShared'))}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {(r.sales_total ?? 0) > rows.length && <div style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{t('yc.em.rs.v2.pMore', { n: n(rows.length), t: n(r.sales_total ?? 0) })}</div>}
    </section>
  );
}

function FollowUp({ r, s }: { r: EmailResult; s: Stats }) {
  const { t, n } = useCrmT();
  const f = r.follow;
  const interest = s.interest ?? 0;
  if (!f && !interest) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
      {interest > 0 && (
        <section style={{ ...box, flex: '1 1 320px', minWidth: 0, gap: 12, background: 'var(--night)', boxShadow: 'none', color: 'var(--text-on-night)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-on-night-2)' }}>{t('yc.em.rs.v2.iT')}</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 56, lineHeight: 1, letterSpacing: '-.04em', fontVariantNumeric: 'tabular-nums' }}>{n(interest)}</span>
            <span style={{ fontSize: 15, lineHeight: 1.4, color: 'var(--text-on-night)' }}>{t('yc.em.rs.v2.iB')}</span>
          </div>
          <Hv as={Link} to="?tab=who" style={{ marginTop: 'auto', height: 46, padding: '0 20px', borderRadius: 99, background: '#fff', color: 'var(--ink)', fontSize: 15, fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} hover={{ color: 'var(--red-600)' }}>
            {t('yc.em.rs.v2.iBtn')}<Icon name="arrowRight" size={15} stroke={2.4} />
          </Hv>
        </section>
      )}
      {f && (
        <section style={{ ...box, flex: '2 1 380px', minWidth: 0, justifyContent: 'center', gap: 6 }}>
          <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.4 }}>{t('yc.em.rs.v2.follow', { n: n(f.n), s: n(f.seen), p: n(f.sold) })}</span>
        </section>
      )}
    </div>
  );
}

function Discarded({ s }: { s: Stats }) {
  const { t, n } = useCrmT();
  const [open, setOpen] = useState(false);
  const autoClicks = s.auto_clicks ?? 0;
  const proxy = s.opened_proxy ?? 0;
  const client = s.opened_client ?? 0;
  if (!autoClicks && !proxy && !client) return null;
  const col = { flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 20 } as const;
  return (
    <section style={{ ...box, padding: '8px clamp(20px,2.4vw,28px)' }}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} style={{ width: '100%', minHeight: 68, display: 'flex', flexWrap: 'wrap', gap: '8px 16px', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 0, padding: '12px 0', textAlign: 'left', cursor: 'pointer', color: 'var(--ink)' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{t('yc.em.rs.v2.xT')}</span>
          <span style={{ fontSize: 14, color: 'var(--sand-600)' }}>{t('yc.em.rs.v2.xS', { a: n(autoClicks), b: n(proxy) })}</span>
        </span>
        <span style={{ height: 26, padding: '0 11px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', fontSize: 13, fontWeight: 500, background: 'var(--sand-100)', color: 'var(--sand-700)' }}>{t(open ? 'yc.em.rs.v2.xClose' : 'yc.em.rs.v2.xOpen')}</span>
      </button>
      {open && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, padding: '0 0 26px', borderTop: '1px solid var(--sand-100)' }}>
          <div style={col}><div style={{ fontSize: 15, fontWeight: 600 }}>{t('yc.em.rs.v2.xAutoT', { n: n(autoClicks) })}</div><div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--sand-600)' }}>{t('yc.em.rs.v2.xAutoB', { p: n(s.auto_people ?? 0) })}</div></div>
          <div style={col}><div style={{ fontSize: 15, fontWeight: 600 }}>{t('yc.em.rs.v2.xProxyT', { n: n(proxy) })}</div><div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--sand-600)' }}>{t('yc.em.rs.v2.xProxyB')}</div></div>
          <div style={col}><div style={{ fontSize: 15, fontWeight: 600 }}>{t('yc.em.rs.v2.xClientT', { n: n(client) })}</div><div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--sand-600)' }}>{t('yc.em.rs.v2.xClientB')}</div></div>
        </div>
      )}
    </section>
  );
}

function Health({ s }: { s: Stats }) {
  const { t, n, pct } = useCrmT();
  const ok = (v: number, lim: number) => v <= lim;
  const items = [
    { l: t('yc.em.rs.h.received'), v: s.received, p: pct(s.n ? (s.received / s.n) * 100 : 0, 1), d: t('yc.em.rs.h.receivedD'), good: true },
    { l: t('yc.em.rs.h.bounced'), v: s.bounced, p: pct(s.n ? (s.bounced / s.n) * 100 : 0, 1), d: t('yc.em.rs.h.bouncedD'), good: ok(s.n ? s.bounced / s.n : 0, 0.03) },
    { l: t('yc.em.rs.h.unsub'), v: s.unsub, p: pct(s.received ? (s.unsub / s.received) * 100 : 0, 2), d: t('yc.em.rs.h.unsubD'), good: ok(s.received ? s.unsub / s.received : 0, 0.005) },
    { l: t('yc.em.rs.h.spam'), v: s.complained, p: pct(s.received ? (s.complained / s.received) * 100 : 0, 2), d: t('yc.em.rs.h.spamD'), good: ok(s.received ? s.complained / s.received : 0, 0.001) },
  ];
  return (
    <section style={{ ...box, gap: 16 }}>
      <div><h2 style={h2}>{t('yc.em.rs.h.t')}</h2><div style={subCss}>{t('yc.em.rs.h.s')}</div></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,230px),1fr))', gap: 12 }}>
        {items.map((h) => (
          <div key={h.l} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '16px 18px', borderRadius: 18, background: 'var(--paper)', boxShadow: 'inset 0 0 0 1px var(--sand-100)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--sand-600)' }}>{h.l}</span>
              <span style={{ height: 22, padding: '0 9px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, background: h.good ? 'var(--green-50)' : 'var(--amber-50)', color: h.good ? 'var(--green-700)' : 'var(--amber-700)' }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor' }} />{t(h.good ? 'yc.em.rs.h.ok' : 'yc.em.rs.h.watch')}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{n(h.v)}</span>
              <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{h.p}</span>
            </div>
            <span style={{ fontSize: 12.5, lineHeight: '17px', color: 'var(--sand-500)' }}>{h.d}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
