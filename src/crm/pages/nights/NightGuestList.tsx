/**
 * Onglet « Guest list » d'une soirée (tiroir des Soirées, et Analyses ›
 * Guest list quand une soirée est choisie). Ce que Shotgun rapporte d'une
 * guest list : les invitations et les billets à 0 €
 * (docs/designs/CRM_GUEST_LIST_ANALYTICS.md). Dans l'ordre des questions
 * d'un pro :
 *
 *   combien d'inscrits, et combien sont venus ?      (phrase + chiffres + courbe)
 *   quelle liste marche ?                              (par liste)
 *   quand arrivent-ils ?                               (heures d'arrivée)
 *   qui sont-ils ?                                     (nouveaux, habitués, clients)
 *   et après, ont-ils payé ?                           (devenus clients)
 *   la liste, nom par nom                              (→ fiche client)
 *
 * Un taux de venue n'existe que si la porte a vraiment scanné ; les
 * guestlists de Shotgun Scan (noms sans billet) ne passent pas par l'API :
 * elles sont marquées « Bientôt », jamais estimées.
 */
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { CtaButton, Skel } from '@/crm/ui/kit';
import { EASE, useProgress } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps } from '@/crm/scope';
import { useNightGuestList } from '@/crm/data/guestlist';
import type { GlArrivals, GlProfileSide, NightGuestList as GL } from '@/crm/data/guestlist';
import type { ClientFilterDef } from '@/crm/data/clients';
import { GL_MIN_SAMPLE, clockFromNoon, hourLabel, nightVerdict, rate } from '@/crm/lib/guestlist';
import { initials } from '@/crm/lib/lifecycle';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { ShotgunSoonCard } from '@/crm/components/ShotgunSoon';
import { WriteModal } from '@/crm/components/WriteModal';
import { SalesCurve } from './SalesCurve';
import { ShotgunLink } from './nightsUi';
import { tzShort, tzTime } from './nightsFormat';

type T = ReturnType<typeof useCrmT>;

export const GL_COLORS = { inv: 'var(--ink)', free: 'var(--red-500)', paid: 'var(--sand-300)', first: 'var(--red-500)', gl: 'var(--tangerine-500)', buyers: 'var(--ink)' } as const;

const card = (delay: number, extra?: CSSProperties): CSSProperties => ({
  display: 'flex', flexDirection: 'column', gap: 14, padding: 22, borderRadius: 24, background: '#fff',
  boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-xs)', animation: `yc-row 650ms ${EASE} ${delay}ms both`, ...extra,
});
const h3: CSSProperties = { margin: 0, fontSize: 16, fontWeight: 600 };
const sub: CSSProperties = { fontSize: 14, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' };

export function NightGuestList({ eventId, inDrawer = true }: { eventId: string; inDrawer?: boolean }) {
  const T = useCrmT();
  const { t } = T;
  const q = useNightGuestList(eventId);
  const d = q.data && q.data.event?.id === eventId ? q.data : undefined;
  const [write, setWrite] = useState<{ def: ClientFilterDef; who: string } | null>(null);

  if (q.isError) return <div style={{ padding: inDrawer ? 24 : 0, ...sub }}>{t('yc.gl.err')}</div>;
  if (!d) return <GlSkeleton pad={inDrawer} />;
  if (d.error === 'not_found') return <div style={{ padding: inDrawer ? 24 : 0, ...sub }}>{t('yc.ni.dr.notFound')}</div>;

  return (
    <>
      <GlBody key={d.event.id} d={d} inDrawer={inDrawer} onWrite={(def, who) => setWrite({ def, who })} T={T} />
      <WriteModal
        open={!!write}
        onClose={() => setWrite(null)}
        scope="filtered"
        who={write?.who ?? ''}
        def={write?.def ?? null}
        eventId={d.event.phase === 'past' ? null : d.event.id}
        eyebrow={t('yc.gl.write.eyebrow', { title: d.event.title })}
      />
    </>
  );
}

function GlSkeleton({ pad }: { pad: boolean }) {
  return (
    <div style={{ flex: 1, padding: pad ? '24px 24px 32px' : 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Skel h={230} r={24} />
      <Skel h={180} r={24} />
      <Skel h={160} r={24} />
    </div>
  );
}

function GlBody({ d, inDrawer, onWrite, T }: { d: GL; inDrawer: boolean; onWrite: (def: ClientFilterDef, who: string) => void; T: T }) {
  const { t, tp, n, eur, pct, locale } = T;
  const caps = useCrmCaps();
  const p = useProgress(1100, 300, d.event.id);
  const tz = d.event.tz;
  const ph = d.event.phase;
  const X = d.totals;
  const empty = X.entries === 0 && X.pending === 0;
  const v = nightVerdict({
    phase: ph, scanKnown: d.scan_known, entries: X.entries, came: X.came, showup: X.showup, freeShare: X.free_share,
    prev: d.prev ? { title: d.prev.title, sameDay: d.prev.same_day, entries: d.prev.entries, showup: d.prev.showup } : null,
  });
  const fmtV = (vars: Record<string, number | string>) => Object.fromEntries(Object.entries(vars).map(([k, x]) => [k, typeof x === 'number' ? (k === 'pct' ? pct(x) : n(x)) : x]));
  const verdict = `${t(v.key, fmtV(v.vars))}${v.cmp ? ` ${t(v.cmp.key, fmtV(v.cmp.vars))}` : ''}`;
  const glevDef: ClientFilterDef = { seg: 'all', f: { glev: [d.event.id] } };
  const writeAll = () => onWrite(glevDef, tp('yc.gl.write.who', X.people, { n: n(X.people), title: d.event.title }));

  const scroll: CSSProperties = inDrawer
    ? { flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 24px 32px', display: 'flex', flexDirection: 'column', gap: 24 }
    : { display: 'flex', flexDirection: 'column', gap: 20 };

  if (empty) {
    return (
      <div style={scroll}>
        <section style={card(80, { background: 'repeating-linear-gradient(135deg,var(--sand-50) 0 10px,#fff 10px 20px)' })}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.gl.k')}</span>
          <b style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, letterSpacing: '-.03em', lineHeight: 1.15, textWrap: 'balance' }}>{t(ph === 'past' ? 'yc.gl.empty.tPast' : 'yc.gl.empty.t')}</b>
          <span style={sub}>{t('yc.gl.empty.s')}</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))', gap: 10 }}>
            {(['inv', 'free'] as const).map((k) => (
              <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 16px', borderRadius: 16, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
                <b style={{ fontSize: 14.5 }}>{t(`yc.gl.kind.${k}`)}</b>
                <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--sand-600)' }}>{t(`yc.gl.kind.${k}.s`)}</span>
              </div>
            ))}
          </div>
          <div><ShotgunLink href={d.event.url}>{t('yc.gl.empty.cta')}</ShotgunLink></div>
        </section>
        <ShotgunSoonCard items={['scanlist']} delay={160} />
      </div>
    );
  }

  // ── Les chiffres du haut, selon le moment de la soirée.
  const tiles: { l: string; v: string; s: string; c?: string }[] = [];
  if (ph === 'upcoming') {
    const diff = d.prev ? X.entries - d.prev.same_day : null;
    tiles.push({ l: t('yc.gl.t.entries'), v: n(X.entries * p), s: X.today ? t('yc.gl.t.today', { n: n(X.today) }) : t('yc.gl.t.todayNone'), c: X.today ? 'var(--green-700)' : undefined });
    tiles.push({
      l: t('yc.gl.t.vsPrev'), v: diff === null ? '—' : `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${n(Math.abs(diff))}`,
      s: d.prev ? t('yc.gl.t.vsPrevS', { title: d.prev.title, n: n(d.prev.same_day) }) : t('yc.gl.t.vsPrevNone'),
      c: diff === null ? undefined : diff >= 0 ? 'var(--green-700)' : 'var(--amber-700)',
    });
    tiles.push({ l: t('yc.gl.t.mix'), v: `${n(X.inv)} · ${n(X.free)}`, s: t('yc.gl.t.mixS') });
    if (X.pending > 0) tiles.push({ l: t('yc.gl.t.pending'), v: n(X.pending), s: t('yc.gl.t.pendingS'), c: 'var(--red-600)' });
  } else if (ph === 'live') {
    tiles.push({ l: t('yc.gl.t.entries'), v: n(X.entries * p), s: t('yc.gl.t.mixLine', { inv: n(X.inv), free: n(X.free) }) });
    tiles.push({ l: t('yc.gl.t.inside'), v: n(X.came * p), s: t('yc.gl.t.insideS'), c: 'var(--green-700)' });
    tiles.push({ l: t('yc.gl.t.share'), v: X.free_share !== null ? pct(X.free_share) : n(X.came), s: t('yc.gl.t.shareLive', { n: n(X.came + X.paid_came) }) });
  } else {
    tiles.push({ l: t('yc.gl.t.entries'), v: n(X.entries * p), s: t('yc.gl.t.mixLine', { inv: n(X.inv), free: n(X.free) }) });
    tiles.push({
      l: t('yc.gl.t.came'), v: d.scan_known ? n(X.came * p) : '—',
      s: !d.scan_known ? t('yc.gl.t.noScan')
        : X.showup === null ? t('yc.gl.t.cameSmall', { n: n(X.entries) })
        : X.paid_showup !== null ? t('yc.gl.t.cameS', { pct: pct(X.showup), paid: pct(X.paid_showup) })
        : t('yc.gl.t.cameSOnly', { pct: pct(X.showup) }),
    });
    tiles.push({
      l: t('yc.gl.t.share'), v: X.free_share !== null ? pct(X.free_share * p) : '—',
      s: X.free_share !== null ? t('yc.gl.t.shareS', { a: n(X.came), b: n(X.came + X.paid_came) }) : d.scan_known ? t('yc.gl.t.small') : t('yc.gl.t.noScan'),
    });
    if (d.after) {
      tiles.push({
        l: t('yc.gl.t.conv'), v: n(d.after.converted * p),
        s: d.after.converted > 0 && caps.money && d.after.revenue !== null ? t('yc.gl.t.convS', { v: eur(d.after.revenue) }) : t('yc.gl.t.convS0', { n: n(d.after.eligible) }),
        c: d.after.converted > 0 ? 'var(--green-700)' : undefined,
      });
    }
  }

  const mixTot = Math.max(1, X.inv + X.free);
  const curveSrc = { curve: d.curve, prev: d.prev, cap: null, tz, start_at: d.event.start_at };
  const showCurve = d.curve.length > 1 && X.entries > 0;
  // Hors tiroir (Analyses › Guest list, une soirée), les cartes vont par deux.
  const half: CSSProperties | undefined = inDrawer ? undefined : { flex: '1 1 420px', minWidth: 0 };

  return (
    <>
    <div style={scroll}>
      {/* Combien, et combien sont venus */}
      <section style={{ ...card(120), gap: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px 14px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: '1 1 300px' }}>
            <h3 style={h3}>{t(ph === 'upcoming' ? 'yc.gl.h.up' : ph === 'live' ? 'yc.gl.h.live' : 'yc.gl.h.past')}</h3>
            <span style={sub}>{verdict}</span>
          </div>
          {X.rejected > 0 && <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{tp('yc.gl.rejected', X.rejected, { n: n(X.rejected) })}</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit,minmax(min(100%,${inDrawer ? 140 : 180}px),1fr))`, gap: 8 }}>
          {tiles.map((x) => (
            <div key={x.l} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '12px 14px', borderRadius: 16, background: 'var(--sand-50)', minWidth: 0 }}>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--sand-600)' }}>{x.l}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 28, lineHeight: 1.05, letterSpacing: '-.035em', fontVariantNumeric: 'tabular-nums', color: x.c && x.v !== '—' && x.c !== 'var(--green-700)' ? x.c : 'var(--ink)' }}>{x.v}</span>
              <span style={{ fontSize: 12.5, lineHeight: 1.35, color: x.c ?? 'var(--sand-500)', fontWeight: x.c ? 600 : 400 }}>{x.s}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ display: 'flex', height: 10, gap: 2, borderRadius: 99, overflow: 'hidden', background: 'var(--sand-100)' }}>
            {X.inv > 0 && <div style={{ flex: `${X.inv} 1 0`, background: GL_COLORS.inv, transformOrigin: 'left', transform: `scaleX(${p})` }} />}
            {X.free > 0 && <div style={{ flex: `${X.free} 1 0`, background: GL_COLORS.free, transformOrigin: 'left', transform: `scaleX(${p})` }} />}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 14px', fontSize: 12.5, color: 'var(--sand-600)' }}>
            {/* Une répartition ne se lit en pourcentage qu'à partir de 10. */}
            <Legend c={GL_COLORS.inv}>{mixTot >= GL_MIN_SAMPLE ? t('yc.gl.leg.inv', { n: n(X.inv), pct: pct((X.inv / mixTot) * 100) }) : t('yc.gl.leg.invN', { n: n(X.inv) })}</Legend>
            <Legend c={GL_COLORS.free}>{mixTot >= GL_MIN_SAMPLE ? t('yc.gl.leg.free', { n: n(X.free), pct: pct((X.free / mixTot) * 100) }) : t('yc.gl.leg.freeN', { n: n(X.free) })}</Legend>
          </div>
        </div>
        {showCurve && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t('yc.gl.curve.t')}</span>
            <div style={{ paddingTop: 10 }}><SalesCurve detail={curveSrc} progress={p} height={inDrawer ? 110 : 160} tipKey="yc.gl.curve.tip" ariaKey="yc.gl.curve.aria" /></div>
            {d.prev && <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--sand-600)' }}>{t('yc.gl.curve.dashed', { title: d.prev.title, date: tzShort(locale, d.prev.start_at, tz) })}</span>}
          </div>
        )}
      </section>

      {/* Quelle liste marche · quand arrivent-ils (côte à côte sur une page large) */}
      <Pair on={!inDrawer}>
        {d.lists.length > 0 && <ListsCard d={d} T={T} p={p} style={half} />}
        {ph !== 'upcoming' && d.arrivals.slots.length > 0 && <ArrivalsCard a={d.arrivals} T={T} p={p} delay={280} live={ph === 'live'} style={half} />}
      </Pair>

      {/* Qui sont-ils · et après */}
      <Pair on={!inDrawer}>
        {X.people > 0 && <WhoCard who={d.who} profile={d.profile} T={T} p={p} delay={340} style={half} />}
        {d.after && d.after.eligible > 0 && <AfterCard d={d} T={T} onWrite={onWrite} style={half} />}
      </Pair>

      {/* La liste */}
      {d.people.length > 0 && <PeopleCard d={d} T={T} />}

      <ShotgunSoonCard items={['scanlist']} delay={520} />

      {!inDrawer && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {caps.write && X.people > 0 && <CtaButton onClick={writeAll}>{tp('yc.gl.write.cta', X.people, { n: n(X.people) })}</CtaButton>}
          <ShotgunLink href={d.event.url}>{t('yc.ni.editShotgun')}</ShotgunLink>
        </div>
      )}
    </div>
      {inDrawer && (
        <div style={{ flex: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '16px 24px', borderTop: '1px solid var(--sand-100)', background: '#fff' }}>
          {caps.write && X.people > 0 && <CtaButton onClick={writeAll}>{tp('yc.gl.write.cta', X.people, { n: n(X.people) })}</CtaButton>}
          {X.people > 0 && (
            <Hv as={Link} to={`${CRM_ROUTES.clients}?glev=${d.event.id}`} style={{ height: 46, padding: '0 18px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', color: 'var(--ink)', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none' }} hover={{ background: 'var(--sand-50)', color: 'var(--ink)', textDecoration: 'none' }}>
              {t('yc.gl.seeClients')}
            </Hv>
          )}
          <ShotgunLink href={d.event.url}>{t('yc.ni.editShotgun')}</ShotgunLink>
        </div>
      )}
    </>
  );
}

/** Deux cartes côte à côte quand `on`, sinon rien de plus qu'un fragment. */
function Pair({ on, children }: { on: boolean; children: ReactNode }) {
  return on ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>{children}</div> : <>{children}</>;
}

function Legend({ c, children }: { c: string; children: ReactNode }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><i style={{ width: 9, height: 9, borderRadius: 3, background: c }} />{children}</span>;
}

// ── Par liste ──────────────────────────────────────────────────────────────

function ListsCard({ d, T, p, style }: { d: GL; T: T; p: number; style?: CSSProperties }) {
  const { t, n, pct } = T;
  const known = d.scan_known;
  const max = Math.max(1, ...d.lists.map((l) => l.entries));
  const best = known && d.lists.length > 1
    ? d.lists.filter((l) => l.entries >= 10 && l.showup !== null).sort((a, b) => (b.showup ?? 0) - (a.showup ?? 0))[0]
    : null;
  const worst = best ? d.lists.filter((l) => l.entries >= 10 && l.showup !== null && l !== best).sort((a, b) => (a.showup ?? 0) - (b.showup ?? 0))[0] : null;
  return (
    <section style={card(220, style)}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h3 style={h3}>{t('yc.gl.lists.t')}</h3>
        <span style={sub}>{t(known ? 'yc.gl.lists.s' : d.event.phase === 'past' ? 'yc.gl.lists.sNoScan' : 'yc.gl.lists.sUp')}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {d.lists.map((l) => {
          const w = known && l.entries ? l.came / l.entries : l.entries / max;
          return (
            <div key={`${l.name}-${l.kind}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr) auto', gap: 14, alignItems: 'center' }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <b style={{ fontSize: 14.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name ?? t('yc.gl.lists.unnamed')}</b>
                <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--sand-500)' }}>
                  <KindPill kind={l.kind} T={T} />
                  {l.first > 0 && <span>{t('yc.gl.lists.first', { n: n(l.first) })}</span>}
                  {l.conv !== null && l.conv > 0 && <span style={{ color: 'var(--green-700)', fontWeight: 600 }}>{t('yc.gl.lists.conv', { n: n(l.conv) })}</span>}
                </span>
              </span>
              <div title={known ? t('yc.gl.lists.barKnown') : t('yc.gl.lists.barEntries')} style={{ height: 10, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(w * 100 * p).toFixed(1)}%`, borderRadius: 99, background: l.kind === 'free' ? GL_COLORS.free : 'var(--ink)' }} />
              </div>
              <span style={{ fontSize: 13.5, color: 'var(--sand-600)', fontVariantNumeric: 'tabular-nums', textAlign: 'right', minWidth: 104 }}>
                {known
                  ? <><b style={{ color: 'var(--ink)', fontWeight: 600 }}>{n(l.came)}</b> / {n(l.entries)}{l.showup !== null ? ` · ${pct(l.showup)}` : ''}</>
                  : t('yc.gl.lists.entries', { n: n(l.entries) })}
              </span>
            </div>
          );
        })}
      </div>
      {best && worst && (best.showup ?? 0) - (worst.showup ?? 0) >= 10 && (
        <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--sand-50)', fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-700)' }}>
          {t('yc.gl.lists.tip', { best: best.name ?? '—', a: pct(best.showup ?? 0), worst: worst.name ?? '—', b: pct(worst.showup ?? 0) })}
        </div>
      )}
    </section>
  );
}

export function KindPill({ kind, T }: { kind: 'inv' | 'free' | 'mix'; T: T }) {
  const c = kind === 'free' ? ['var(--red-50)', 'var(--red-700)'] : kind === 'inv' ? ['var(--sand-100)', 'var(--sand-700)'] : ['var(--amber-50)', 'var(--amber-700)'];
  return <span style={{ height: 20, padding: '0 8px', borderRadius: 99, background: c[0], color: c[1], fontSize: 11.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>{T.t(`yc.gl.kindShort.${kind}`)}</span>;
}

// ── Heures d'arrivée ───────────────────────────────────────────────────────

export function ArrivalsCard({ a, T, p, delay, live, style }: { a: GlArrivals; T: T; p: number; delay: number; live?: boolean; style?: CSSProperties }) {
  const { t, n, pct, lang } = T;
  const totGl = a.slots.reduce((s, x) => s + x.gl, 0);
  const totPaid = a.slots.reduce((s, x) => s + x.paid, 0);
  const share = (x: number, tot: number) => (tot ? x / tot : 0);
  const max = Math.max(0.01, ...a.slots.map((x) => Math.max(share(x.gl, totGl), share(x.paid, totPaid))));
  const gl = clockFromNoon(a.gl_med);
  const pd = clockFromNoon(a.paid_med);
  const gap = a.gl_med !== null && a.paid_med !== null ? a.paid_med - a.gl_med : null;
  const H = 120;
  return (
    <section style={{ ...card(delay), ...style }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h3 style={h3}>{t('yc.gl.arr.t')}</h3>
        <span style={sub}>
          {gl && pd
            ? `${t('yc.gl.arr.med', { gl, paid: pd })}${gap !== null && Math.abs(gap) >= 15 ? ` ${t(gap > 0 ? 'yc.gl.arr.earlier' : 'yc.gl.arr.later', { n: n(Math.abs(gap)) })}` : ''}`
            : t(live ? 'yc.gl.arr.live' : 'yc.gl.arr.s')}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: H, borderBottom: '1px solid var(--sand-200)' }}>
        {a.slots.map((x) => (
          <div key={x.h} title={`${hourLabel(x.h, lang)} · ${t('yc.gl.arr.tipGl', { n: n(x.gl), pct: pct(share(x.gl, totGl) * 100) })} · ${t('yc.gl.arr.tipPaid', { n: n(x.paid), pct: pct(share(x.paid, totPaid) * 100) })}`} style={{ flex: '1 1 0', minWidth: 0, height: '100%', display: 'flex', alignItems: 'flex-end', gap: 2 }}>
            <span style={{ flex: 1, height: `${((share(x.gl, totGl) / max) * 100 * p).toFixed(1)}%`, minHeight: x.gl ? 3 : 0, borderRadius: '5px 5px 2px 2px', background: GL_COLORS.free }} />
            <span style={{ flex: 1, height: `${((share(x.paid, totPaid) / max) * 100 * p).toFixed(1)}%`, minHeight: x.paid ? 3 : 0, borderRadius: '5px 5px 2px 2px', background: GL_COLORS.paid }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: -6 }}>
        {a.slots.map((x) => <span key={x.h} style={{ flex: '1 1 0', minWidth: 0, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--sand-400)', whiteSpace: 'nowrap', overflow: 'hidden' }}>{hourLabel(x.h, lang)}</span>)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 12.5, color: 'var(--sand-600)' }}>
        <Legend c={GL_COLORS.free}>{t('yc.gl.arr.legGl', { n: n(totGl) })}</Legend>
        <Legend c={GL_COLORS.paid}>{t('yc.gl.arr.legPaid', { n: n(totPaid) })}</Legend>
      </div>
    </section>
  );
}

// ── Qui sont-ils ───────────────────────────────────────────────────────────

export function WhoCard({ who, profile, T, p, delay, style, title }: {
  who: { first: number; gl: number; buyers: number } | null;
  profile: Partial<Record<'gl' | 'paid', GlProfileSide>>;
  T: T; p: number; delay: number; style?: CSSProperties; title?: string;
}) {
  const { t, n, pct } = T;
  const tot = who ? who.first + who.gl + who.buyers : 0;
  const segs = who ? [
    { k: 'first', v: who.first, c: GL_COLORS.first },
    { k: 'gl', v: who.gl, c: GL_COLORS.gl },
    { k: 'buyers', v: who.buyers, c: GL_COLORS.buyers },
  ] : [];
  const g = profile.gl;
  const pa = profile.paid;
  const prof: string[] = [];
  if (g?.age_med != null) prof.push(pa?.age_med != null ? t('yc.gl.who.age', { a: n(g.age_med), b: n(pa.age_med) }) : t('yc.gl.who.ageOne', { a: n(g.age_med) }));
  if (g?.female_pct != null) prof.push(pa?.female_pct != null ? t('yc.gl.who.women', { a: pct(g.female_pct), b: pct(pa.female_pct) }) : t('yc.gl.who.womenOne', { a: pct(g.female_pct) }));
  if (!tot && !prof.length) return null;
  return (
    <section style={{ ...card(delay), ...style }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h3 style={h3}>{title ?? t('yc.gl.who.t')}</h3>
        <span style={sub}>{tot ? t('yc.gl.who.s', { n: n(tot) }) : t('yc.gl.who.sProfile')}</span>
      </div>
      {tot > 0 && (
        <>
          <div style={{ display: 'flex', height: 16, gap: 3, borderRadius: 99, overflow: 'hidden' }}>
            {segs.filter((s) => s.v > 0).map((s) => (
              <div key={s.k} title={`${t(`yc.gl.who.${s.k}`)} : ${n(s.v)}`} style={{ flex: `${s.v} 1 0`, minWidth: 4, background: s.c, transformOrigin: 'left', transform: `scaleX(${p})` }} />
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,160px),1fr))', gap: 8 }}>
            {segs.map((s) => (
              <div key={s.k} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 14, background: 'var(--sand-50)' }}>
                <i style={{ flex: 'none', width: 10, height: 10, marginTop: 5, borderRadius: 99, background: s.c }} />
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                  <b style={{ fontSize: 14.5, fontWeight: 600 }}>{t(`yc.gl.who.${s.k}`)}</b>
                  <span style={{ fontSize: 13, color: 'var(--sand-500)', fontVariantNumeric: 'tabular-nums' }}>{tot >= GL_MIN_SAMPLE ? `${n(s.v)} · ${pct((s.v / tot) * 100)}` : n(s.v)}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--sand-500)', marginTop: 2 }}>{t(`yc.gl.who.${s.k}D`)}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {prof.length > 0 && <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-700)' }}>{prof.join(' · ')}</span>}
    </section>
  );
}

// ── Et après ───────────────────────────────────────────────────────────────

function AfterCard({ d, T, onWrite, style }: { d: GL; T: T; onWrite: (def: ClientFilterDef, who: string) => void; style?: CSSProperties }) {
  const { t, tp, n, eur, pct } = T;
  const caps = useCrmCaps();
  const a = d.after!;
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(d.event.start_at)) / 86_400_000));
  const r = rate(a.converted, a.eligible);
  const tooSoon = a.converted === 0 && days < 14;
  const stay = a.eligible - a.converted;
  return (
    <section style={card(400, { background: 'radial-gradient(70% 90% at 100% 0%,rgba(31,166,90,.07),transparent 70%),#fff', ...style })}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h3 style={h3}>{t('yc.gl.after.t')}</h3>
        <span style={sub}>{t('yc.gl.after.s')}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '6px 22px' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 48, lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>
          {n(a.converted)}<span style={{ fontSize: 18, color: 'var(--sand-500)', letterSpacing: '-.01em' }}> / {n(a.eligible)}</span>
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 4 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>{tp('yc.gl.after.big', a.converted, { n: n(a.converted) })}{r !== null && !tooSoon ? ` · ${pct(r)}` : ''}</span>
          {caps.money && a.revenue !== null && a.converted > 0 && <span style={{ fontSize: 13.5, color: 'var(--green-700)', fontWeight: 600 }}>{t('yc.gl.after.rev', { v: eur(a.revenue) })}</span>}
        </span>
      </div>
      <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-700)' }}>
        {tooSoon ? (days === 0 ? t('yc.gl.after.soonToday') : tp('yc.gl.after.soon', days, { n: n(days) })) : a.back > 0 ? tp('yc.gl.after.back', a.back, { n: n(a.back) }) : t('yc.gl.after.noBack')}
      </span>
      {caps.write && stay > 0 && (
        <div>
          <Hv
            as="button"
            type="button"
            onClick={() => onWrite({ seg: 'all', f: { glev: [d.event.id], gl: 'only' } }, tp('yc.gl.after.whoOnly', stay, { n: n(stay), title: d.event.title }))}
            style={{ height: 40, padding: '0 16px', borderRadius: 99, border: '1px solid var(--sand-300)', background: '#fff', color: 'var(--ink)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
            hover={{ borderColor: 'var(--sand-400)', background: 'var(--sand-50)' }}
          >
            <Icon name="mail" size={15} stroke={2.2} />{tp('yc.gl.after.cta', stay, { n: n(stay) })}
          </Hv>
        </div>
      )}
    </section>
  );
}

// ── La liste, nom par nom ──────────────────────────────────────────────────

function PeopleCard({ d, T }: { d: GL; T: T }) {
  const { t, tp, n, locale, dShort } = T;
  const [lim, setLim] = useState(10);
  const ph = d.event.phase;
  const shown = d.people.slice(0, lim);
  const more = d.people.length - shown.length;
  const tagC: Record<string, [string, string]> = { first: ['var(--red-50)', 'var(--red-700)'], gl: ['var(--amber-50)', 'var(--amber-700)'], buyer: ['var(--sand-100)', 'var(--sand-700)'] };
  return (
    <section style={card(460)}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '6px 12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h3 style={h3}>{t('yc.gl.people.t')}</h3>
          <span style={sub}>{tp(ph === 'upcoming' ? 'yc.gl.people.sUp' : 'yc.gl.people.s', d.totals.people, { n: n(d.totals.people) })}</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {shown.map((x) => {
          const status = ph === 'upcoming'
            ? t('yc.gl.people.reg', { date: dShort(x.at) })
            : x.came && x.scanned_at ? t('yc.gl.people.came', { time: tzTime(locale, x.scanned_at, d.event.tz) })
              : d.scan_known ? t('yc.gl.people.noShow') : t('yc.gl.people.unknown');
          const tc = tagC[x.tag] ?? tagC.buyer;
          const nm = x.name ?? x.email;
          const parts = nm.split(' ');
          return (
            <Hv
              key={x.email}
              as={Link}
              to={`${CRM_ROUTES.clients}?c=${encodeURIComponent(x.email)}`}
              style={{ display: 'grid', gridTemplateColumns: '34px minmax(0,1fr) auto', gap: 12, alignItems: 'center', padding: '10px 6px', margin: '0 -6px', borderTop: '1px solid var(--sand-100)', borderRadius: 12, textDecoration: 'none', color: 'inherit', transition: 'background 160ms' }}
              hover={{ background: 'var(--sand-50)', textDecoration: 'none', color: 'inherit' }}
            >
              <span style={{ width: 34, height: 34, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-700)', display: 'grid', placeItems: 'center', fontSize: 12.5, fontWeight: 600 }}>{initials(parts[0] ?? null, parts[1] ?? null, x.email)}</span>
              <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <b style={{ fontSize: 14.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nm}</b>
                  <span style={{ flex: 'none', height: 20, padding: '0 8px', borderRadius: 99, background: tc[0], color: tc[1], fontSize: 11.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{t(`yc.gl.tag.${x.tag}`)}</span>
                  {x.conv && <span style={{ flex: 'none', height: 20, padding: '0 8px', borderRadius: 99, background: 'var(--green-50)', color: 'var(--green-700)', fontSize: 11.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{t('yc.gl.tag.conv')}</span>}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--sand-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.list ?? t(`yc.gl.kind.${x.kind}`)}</span>
              </span>
              <span style={{ fontSize: 13, fontWeight: x.came ? 600 : 400, color: x.came ? 'var(--green-700)' : 'var(--sand-500)', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                {x.came && <Icon name="check" size={13} stroke={2.6} />}{status}
              </span>
            </Hv>
          );
        })}
      </div>
      {more > 0 && (
        <Hv as="button" type="button" onClick={() => setLim(lim + 20)} style={{ alignSelf: 'center', height: 40, padding: '0 18px', borderRadius: 99, border: '1px solid var(--sand-300)', background: '#fff', color: 'var(--ink)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'var(--sand-50)' }}>
          {t('yc.gl.people.more', { n: n(Math.min(20, more)) })}
        </Hv>
      )}
      {d.totals.people > d.people.length && lim >= d.people.length && (
        <span style={{ fontSize: 13, color: 'var(--sand-500)', textAlign: 'center' }}>{t('yc.gl.people.cap', { n: n(d.people.length), total: n(d.totals.people) })}</span>
      )}
    </section>
  );
}
