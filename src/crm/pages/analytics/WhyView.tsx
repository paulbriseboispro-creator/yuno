/**
 * Analyses › Communauté › « Ce qui fait venir » (analyse client, migrations
 * 20261010100000 → 140000). Toute l'histoire du compte, pas une période :
 * statut de chaque famille d'hypothèses (testée contre le hasard), ce que
 * portent les nouveaux venus, les venus une fois (locaux / de passage), quand
 * on revient, la couverture des données, et les artistes.
 *
 * On n'affirme rien : un chiffre est un comptage, un statut dit s'il est
 * confirmé SUR CE COMPTE. Aucun taux sous 10 personnes.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { useAnalysisOverview, useArtistsAnalysis } from '@/crm/data/analysis';
import type { AnalysisOverview, ArtistsAnalysis } from '@/crm/data/analysis';
import { displayStatus, familyKind, rateOrNull } from '@/crm/lib/analysis';
import type { AnFamily, AnKind, FamilyStatus } from '@/crm/lib/analysis';
import { rateText, sourceName, statusDetail } from '@/crm/components/analysis/hypText';
import { ArtistAvatar, StatusBadge } from '@/crm/components/analysis/HypBits';
import { CardHead, Sk, card } from './anaUi';

type T = ReturnType<typeof useCrmT>;

/** Les familles qui ont une clé de filtre par personne (`h:<famille>`). */
const PERSON_FAMILIES = new Set<string>(['artist', 'genre', 'format', 'slot', 'weekday', 'place', 'series', 'early', 'launch',
  'last_minute', 'door', 'group', 'table', 'brought', 'discovery', 'invited', 'passing']);

export function WhyView() {
  const T = useCrmT();
  const q = useAnalysisOverview(true);
  const arts = useArtistsAnalysis(true, 40);
  if (q.isError) return <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />;
  const d = q.data;
  if (!d) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <section style={{ ...card }}><Sk h={26} w={260} /><Sk h={16} w="70%" /><Sk h={16} w="50%" /></section>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 16 }}>
          {[0, 1, 2].map((i) => <section key={i} style={{ ...card }}><Sk h={22} w={180} /><Sk h={60} /><Sk h={60} /></section>)}
        </div>
      </div>
    );
  }
  if (!d.state) {
    return (
      <section style={{ ...card, alignItems: 'flex-start' }}>
        <CardHead title={T.t('yc.why.h.t')} sub={T.t('yc.why.h.empty')} />
        <Link to={CRM_ROUTES.connectors} style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--red-600)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {T.t('yc.why.h.connect')}<Icon name="arrowRight" size={14} stroke={2.4} />
        </Link>
      </section>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Head d={d} T={T} />
      <Families d={d} T={T} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))', gap: 16 }}>
        <Newcomers d={d} T={T} />
        <Once d={d} T={T} />
        <Returns d={d} T={T} />
      </div>
      <Artists q={arts.data} loading={!arts.data && !arts.isError} T={T} />
    </div>
  );
}

function Head({ d, T }: { d: AnalysisOverview; T: T }) {
  const { t, pct } = T;
  const [how, setHow] = useState(false);
  const cov = d.state?.coverage;
  const tot = cov?.totals ?? {};
  const share = (a: number | undefined, b: number | undefined) => (b ? pct(((a ?? 0) / b) * 100) : '—');
  const off = d.families.filter((f) => f.variant === '' && displayStatus(f) === 'off');
  return (
    <section style={{ ...card, gap: 14 }}>
      <CardHead
        title={t('yc.why.h.t')}
        sub={t('yc.why.h.s')}
        right={<span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{d.state?.full_at ? t('yc.why.h.computed', { date: T.dShort(d.state.full_at) }) : ''}</span>}
      />
      {!d.state?.full_at && <span style={{ fontSize: 14, color: 'var(--amber-700)' }}>{t('yc.why.h.pending')}</span>}
      {cov && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--sand-600)', lineHeight: 1.45 }}>
          <span>
            <b style={{ fontWeight: 600, color: 'var(--ink)' }}>{t('yc.why.cov.t')} · </b>
            {t('yc.why.cov.line', {
              a: share(tot.nights_with_artists, tot.nights), z: share(tot.with_zip, tot.sales),
              l: share(tot.nights_with_launch, tot.nights), s: share(tot.scanned, tot.valid),
            })}
          </span>
          {(['uniform', 'unavailable'] as const).map((av) => {
            const fams = off.filter((f) => (av === 'uniform' ? f.availability === 'uniform' : f.availability !== 'uniform'));
            return fams.length > 0 && (
              <span key={av}>{t(`yc.why.cov.off.${av}`, { list: fams.map((f) => t(`yc.why.fam.${f.family}`).toLowerCase()).join(', ') })}</span>
            );
          })}
          {cov.families?.group === 'reduced' && <span>{t('yc.why.det.reduced.group')}</span>}
          {cov.families?.passing === 'reduced' && <span>{t('yc.why.det.reduced.passing')}</span>}
        </div>
      )}
      <Hv as="button" type="button" onClick={() => setHow(!how)} aria-expanded={how} style={{ alignSelf: 'flex-start', border: 0, background: 'none', padding: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }} hover={{ color: 'var(--red-600)' }}>
        {t('yc.why.how.t')}<Icon name="chevronDown" size={14} stroke={2.4} style={{ transform: `rotate(${how ? 180 : 0}deg)` }} />
      </Hv>
      {how && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--sand-700)', textWrap: 'pretty', maxWidth: 760 }}>{t('yc.why.how.s')}</p>}
    </section>
  );
}

const GROUPS: AnKind[] = ['affinity', 'behaviour', 'return'];

function Families({ d, T }: { d: AnalysisOverview; T: T }) {
  const groups = GROUPS;
  const rows = useMemo(() => {
    const by: Record<AnKind, FamilyStatus[]> = { affinity: [], behaviour: [], return: [] };
    for (const f of d.families) {
      if (f.variant !== '' || displayStatus(f) === 'off') continue;
      by[familyKind(f.family as AnFamily)].push(f);
    }
    // Confirmées d'abord, puis à tester, puis pas confirmées.
    const rank = (f: FamilyStatus) => ({ supported: 0, prior_only: 1, untested: 2, not_supported: 3, off: 4 })[displayStatus(f)];
    for (const k of GROUPS) by[k].sort((a, b) => rank(a) - rank(b) || b.n - a.n);
    return by;
  }, [d.families]);
  const channels = d.families.filter((f) => f.family === 'channel' && f.n > 0).sort((a, b) => b.n - a.n);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))', gap: 16, alignItems: 'start' }}>
      {groups.map((k) => (
        <section key={k} style={{ ...card, gap: 4 }}>
          <CardHead title={T.t(`yc.why.k.${k}`)} sub={T.t(`yc.why.k.${k}.s`)} />
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
            {rows[k].map((f, i) => <FamilyRow key={f.family} f={f} first={i === 0} T={T} />)}
            {k === 'return' && channels.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 14, marginTop: 6, borderTop: '1px solid var(--sand-100)' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{T.t('yc.why.channel.t')}</span>
                {channels.map((c) => {
                  const r1 = c.detail?.r1 ?? null;
                  return (
                    <div key={c.variant} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 13.5 }}>
                      <span style={{ minWidth: 0, textWrap: 'pretty' }}>{sourceName(c.variant, T)}</span>
                      <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: 'var(--sand-600)', fontVariantNumeric: 'tabular-nums' }}>
                          {c.n >= d.min_sample && r1 !== null ? T.pct(r1 * 100) : rateText(Number(c.detail?.returned ?? 0), c.n, T, d.min_sample)}
                        </span>
                        <StatusBadge f={c} T={T} />
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function FamilyRow({ f, first, T }: { f: FamilyStatus; first: boolean; T: T }) {
  const { t } = T;
  const ds = displayStatus(f);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '12px 0', borderTop: first ? 0 : '1px solid var(--sand-100)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{t(`yc.why.fam.${f.family}`)}</span>
        <StatusBadge f={f} T={T} />
      </div>
      <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t(`yc.why.famq.${f.family}`)}</span>
      <span style={{ fontSize: 13, lineHeight: 1.45, color: ds === 'supported' ? 'var(--ink)' : 'var(--sand-500)', textWrap: 'pretty' }}>
        {statusDetail(f, T)}
        {ds === 'supported' && f.since ? ` · ${t('yc.why.det.since', { date: T.dShort(f.since) })}` : ''}
      </span>
      {PERSON_FAMILIES.has(f.family) && (
        <Link to={`${CRM_ROUTES.clients}?hyp=${f.family}`} style={{ alignSelf: 'flex-start', fontSize: 13, fontWeight: 600, color: 'var(--red-600)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {t('yc.why.seeClients')}<Icon name="arrowRight" size={12} stroke={2.4} />
        </Link>
      )}
    </div>
  );
}

function Bar({ label, value, of, T, min, to }: { label: string; value: number; of: number; T: T; min: number; to?: string }) {
  const r = rateOrNull(value, of, min);
  const lbl = to ? <Link to={to} style={{ color: 'inherit', textDecoration: 'none' }}>{label}</Link> : label;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13.5 }}>
        <span style={{ minWidth: 0, fontWeight: 500 }}>{lbl}</span>
        <span style={{ flex: 'none', color: 'var(--sand-600)', fontVariantNumeric: 'tabular-nums' }}>{r === null ? T.n(value) : `${T.n(value)} · ${T.pct(r * 100)}`}</span>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
        <div style={{ width: `${of > 0 ? Math.min(100, (value / of) * 100) : 0}%`, height: '100%', borderRadius: 99, background: 'var(--gradient-brand)' }} />
      </div>
    </div>
  );
}

function Newcomers({ d, T }: { d: AnalysisOverview; T: T }) {
  const { t } = T;
  const nw = d.newcomers;
  const items = Object.entries(nw.by_family ?? {})
    .filter(([f]) => {
      const st = d.families.find((x) => x.family === f && x.variant === '');
      return !st || displayStatus(st) !== 'off';
    })
    .sort((a, b) => b[1] - a[1]).slice(0, 8);
  return (
    <section style={{ ...card, gap: 12 }}>
      <CardHead title={t('yc.why.new.t')} sub={`${t('yc.why.new.s')} · ${t('yc.why.new.of', { n: T.n(nw.n) })}`} />
      {items.length === 0 ? <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>—</span>
        : items.map(([f, c]) => <Bar key={f} label={t(`yc.why.fam.${f}`)} value={c} of={nw.n} T={T} min={d.min_sample} to={`${CRM_ROUTES.clients}?hyp=${f}`} />)}
    </section>
  );
}

function Once({ d, T }: { d: AnalysisOverview; T: T }) {
  const { t } = T;
  const o = d.once;
  return (
    <section style={{ ...card, gap: 12 }}>
      <CardHead title={`${t('yc.why.once.t')} · ${T.n(o.n)}`} sub={t('yc.why.once.s')} />
      <Bar label={t('yc.why.once.local')} value={o.local} of={o.n} T={T} min={d.min_sample} to={`${CRM_ROUTES.clients}?pass=no&nb=1`} />
      <Bar label={t('yc.why.once.passing')} value={o.passing} of={o.n} T={T} min={d.min_sample} to={`${CRM_ROUTES.clients}?pass=yes&nb=1`} />
      <Bar label={t('yc.why.once.unknown')} value={o.unknown} of={o.n} T={T} min={d.min_sample} />
    </section>
  );
}

function Returns({ d, T }: { d: AnalysisOverview; T: T }) {
  const { t, n } = T;
  const s = d.state?.stats;
  const enough = !!s && s.returners >= d.min_sample && s.median_days !== null;
  return (
    <section style={{ ...card, gap: 10 }}>
      <CardHead title={t('yc.why.ret.t')} />
      {enough ? (
        <>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, lineHeight: 1.1, letterSpacing: '-.03em' }}>{t('yc.why.ret.median', { d: n(s!.median_days) })}</span>
          {s!.p25_days !== null && s!.p75_days !== null && <span style={{ fontSize: 14, color: 'var(--sand-600)' }}>{t('yc.why.ret.range', { a: n(s!.p25_days), b: n(s!.p75_days) })}</span>}
        </>
      ) : <span style={{ fontSize: 14, color: 'var(--sand-600)' }}>{t('yc.why.ret.few')}</span>}
      {s && s.eligible > 0 && (
        <span style={{ fontSize: 14, color: 'var(--sand-700)' }}>
          {s.eligible >= d.min_sample ? t('yc.why.ret.rate', { r: T.pct((s.returned / s.eligible) * 100) }) : t('yc.why.ret.counts', { a: n(s.returned), b: n(s.eligible) })}
        </span>
      )}
    </section>
  );
}

function Artists({ q, loading, T }: { q: ArtistsAnalysis | undefined; loading: boolean; T: T }) {
  const { t, n, pct } = T;
  const [all, setAll] = useState(false);
  if (loading) return <section style={{ ...card }}><Sk h={22} w={240} /><Sk h={160} /></section>;
  if (!q) return null;
  const rows = all ? q.artists : q.artists.slice(0, 10);
  const base = q.baseline.rate;
  const COLS = 'minmax(0,1.8fr) repeat(4,minmax(54px,.7fr))';
  return (
    <section style={{ ...card, gap: 12 }}>
      <CardHead
        title={t('yc.why.art.t')}
        sub={base !== null ? t('yc.why.art.s', { r: pct(base * 100) }) : t('yc.why.art.sNoBase')}
        right={q.family ? <StatusBadge f={q.family} T={T} /> : undefined}
      />
      {q.family && <span style={{ fontSize: 13, color: 'var(--sand-600)' }}>{statusDetail(q.family, T)}</span>}
      {q.artists.length === 0 ? <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.why.art.none')}</span> : (
        <div style={{ overflowX: 'auto' }} className="yc-noscroll">
          <div style={{ minWidth: 340, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 8, padding: '0 0 8px', fontSize: 12, color: 'var(--sand-500)', borderBottom: '1px solid var(--sand-100)' }}>
              <span />
              <span style={{ textAlign: 'right' }}>{t('yc.why.art.nights')}</span>
              <span style={{ textAlign: 'right' }}>{t('yc.why.art.new')}</span>
              <span style={{ textAlign: 'right' }}>{t('yc.why.art.ret')}</span>
              <span style={{ textAlign: 'right' }}>{t('yc.why.art.fans')}</span>
            </div>
            {rows.map((a) => {
              return (
                <div key={a.k} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 8, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--sand-100)', fontSize: 13.5 }}>
                  <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <ArtistAvatar src={a.avatar} size={28} />
                    <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name ?? '—'}</span>
                      {a.resident && <span title={t('yc.why.art.residentTip', { p: pct(q.resident_share * 100) })} style={{ fontSize: 11.5, color: 'var(--sand-500)' }}>{t('yc.why.art.resident')}</span>}
                    </span>
                  </span>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n(a.nights)}</span>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n(a.new_brought)}</span>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--sand-700)' }}>
                    {a.new_eligible === 0 ? <span style={{ color: 'var(--sand-400)' }}>{t('yc.why.art.tooRecent')}</span>
                      : a.return_rate !== null ? pct(a.return_rate * 100) : `${n(a.new_returned)} / ${n(a.new_eligible)}`}
                  </span>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n(a.fans)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {q.artists.length > 10 && (
        <Hv as="button" type="button" onClick={() => setAll(!all)} style={{ alignSelf: 'flex-start', border: 0, background: 'none', padding: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }} hover={{ color: 'var(--red-600)' }}>
          {all ? t('yc.why.card.less') : t('yc.why.art.more', { n: q.artists.length - 10 })}
        </Hv>
      )}
    </section>
  );
}
