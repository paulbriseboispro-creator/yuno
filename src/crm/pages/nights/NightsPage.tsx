/**
 * Soirées (maquette « Soirees.dc.html ») : `/crm/nights` (à venir) et
 * `/crm/nights/past` (passées), le tiroir d'une soirée par `?e=<id>`.
 *
 *   Comment se vendent vos prochaines soirées ?          [● Shotgun · 18:38] [Synchroniser]
 *   [À venir 6 | Passées 47]   Lecture seule · Ouvrir Shotgun
 *   …chiffres, soirée mise en avant / colonnes, listes
 *
 * Toutes les soirées viennent de crm_nights (un appel pour les deux onglets) ;
 * le détail de crm_night_detail. Rien ne s'écrit chez Shotgun.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Skel } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { EASE, useIntro, useProgress } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { useCrmShell } from '@/crm/data/shell';
import { useNightDetail, useNights } from '@/crm/data/nights';
import type { NightRow, NightsData } from '@/crm/data/nights';
import { syncShotgunNow } from '@/crm/data/imports';
import { lacksMessage, seriesChips, splitPeriods, upKind, type PeriodMonths, type UpKind } from '@/crm/lib/nights';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { WriteModal } from '@/crm/components/WriteModal';
import { ShotgunLink } from './nightsUi';
import { ICO } from './nightsFormat';
import { UpcomingView, type UpFilter } from './UpcomingView';
import { PastView, type PastSort } from './PastView';
import { NightDrawer, type DrawerView } from './NightDrawer';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function NightsPage() {
  const T = useCrmT();
  const { t, tp, n, time, dShort } = T;
  const toast = useCrmToast();
  const qc = useQueryClient();
  const { space, qk } = useCrmScope();
  const nav = useNavigate();
  const loc = useLocation();
  const [sp, setSp] = useSearchParams();
  const isPast = loc.pathname.replace(/\/+$/, '').endsWith('/past');
  const drId = sp.get('e');
  const drView: DrawerView = sp.get('v') === 'links' ? 'links' : 'sales';

  const q = useNights();
  const shell = useCrmShell();
  const data = q.data;
  const intro = useIntro(!!data);
  const tabKey = isPast ? 'past' : 'up';
  const cc = useProgress(1500, 480, data ? tabKey : 'wait', !!data);

  // ── État des filtres (remis à zéro au changement d'onglet, comme la maquette)
  const [qText, setQText] = useState('');
  const [fs, setFs] = useState<UpFilter>('all');
  const [fm, setFm] = useState(false);
  const [months, setMonthsState] = useState<PeriodMonths>(6);
  const [ser, setSerState] = useState('all');
  const [sort, setSortState] = useState<PastSort>('date');
  const [dir, setDir] = useState<1 | -1>(1);
  const [lim, setLim] = useState(8);
  const [upd, setUpd] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [justSynced, setJustSynced] = useState(false);
  const [write, setWrite] = useState<{ id: string | null; title: string; buyers: number } | null>(null);
  const prevTab = useRef(tabKey);
  useEffect(() => {
    if (prevTab.current === tabKey) return;
    prevTab.current = tabKey;
    setQText(''); setFs('all'); setFm(false); setSerState('all'); setLim(8);
  }, [tabKey]);

  const now = data ? Date.parse(data.now) : Date.now();
  const up = useMemo(() => (data?.nights ?? []).filter((e) => e.upcoming), [data]);
  const past = useMemo(() => (data?.nights ?? []).filter((e) => !e.upcoming).sort((a, b) => Date.parse(b.start_at) - Date.parse(a.start_at)), [data]);
  const kinds = useMemo(() => new Map<string, UpKind>(up.map((e) => [e.id, upKind(e, now)])), [up, now]);
  const nq = norm(qText.trim());

  const upRows = useMemo(() => up.filter((e) => {
    const k = kinds.get(e.id) ?? 'sale';
    return (fs === 'all' || k === fs) && (!fm || lacksMessage(e, k)) && (!nq || norm(e.title).includes(nq));
  }), [up, kinds, fs, fm, nq]);
  const hero = useMemo(() => up.find((e) => (kinds.get(e.id) ?? 'sale') !== 'soon') ?? null, [up, kinds]);
  const heroDetail = useNightDetail(!isPast && hero ? hero.id : null);
  const heroP = useProgress(1300, 700, heroDetail.data?.id ?? 'wait', !!heroDetail.data);

  const { inW, prevW } = useMemo(() => splitPeriods(past, months, new Date(now)), [past, months, now]);
  const series = useMemo(() => seriesChips(inW), [inW]);
  const paRows = useMemo(() => {
    const key: Record<PastSort, (e: NightRow) => number> = { date: (e) => Date.parse(e.start_at), sold: (e) => e.sold, ca: (e) => e.revenue, nw: (e) => e.new_buyers };
    return inW
      .filter((e) => (ser === 'all' || e.series.toLowerCase() === ser) && (!nq || norm(e.title).includes(nq)))
      .sort((a, b) => (key[sort](b) - key[sort](a)) * dir);
  }, [inW, ser, nq, sort, dir]);

  // ── Tiroir : adresse, ordre de navigation
  const setParam = useCallback((k: string, v: string | null) => {
    setSp((prev) => { const x = new URLSearchParams(prev); if (v === null) x.delete(k); else x.set(k, v); return x; }, { replace: true });
  }, [setSp]);
  const open = useCallback((id: string, view: DrawerView = 'sales') => {
    setSp((prev) => {
      const x = new URLSearchParams(prev);
      x.set('e', id);
      if (view === 'links') x.set('v', 'links'); else x.delete('v');
      return x;
    }, { replace: true });
  }, [setSp]);
  const close = useCallback(() => {
    setSp((prev) => { const x = new URLSearchParams(prev); x.delete('e'); x.delete('v'); return x; }, { replace: true });
  }, [setSp]);
  const setView = useCallback((v: DrawerView) => setParam('v', v === 'links' ? 'links' : null), [setParam]);
  const drRow = useMemo(() => (drId ? (data?.nights ?? []).find((e) => e.id === drId) ?? null : null), [data, drId]);
  const ids = useMemo(() => {
    if (!drId) return [];
    const list = (drRow ? drRow.upcoming : !isPast) ? upRows.map((e) => e.id) : paRows.map((e) => e.id);
    return list.includes(drId) ? list : [...list, drId];
  }, [drId, drRow, isPast, upRows, paRows]);
  const step = useCallback((d: -1 | 1) => {
    const i = ids.indexOf(drId ?? '');
    const next = ids[i + d];
    if (next) setParam('e', next);
  }, [ids, drId, setParam]);
  // Une soirée ouverte sur le mauvais onglet bascule sur le bon.
  useEffect(() => {
    if (!drRow) return;
    const v = drView === 'links' ? '&v=links' : '';
    if (drRow.upcoming && isPast) nav(`${CRM_ROUTES.nights}?e=${drRow.id}${v}`, { replace: true });
    if (!drRow.upcoming && !isPast) nav(`${CRM_ROUTES.nightsPast}?e=${drRow.id}${v}`, { replace: true });
  }, [drRow, isPast, nav, drView]);

  // ── Synchroniser : relancer Shotgun puis dire ce qui a changé.
  const doSync = async () => {
    if (syncing) return;
    setSyncing(true);
    const before = new Map((data?.nights ?? []).map((e) => [e.id, e.sold]));
    const startedOk = shell.data?.connection?.last_ok_at ?? null;
    const r = await syncShotgunNow({ venueId: space.venueId, organizerUserId: space.organizerUserId });
    if (r !== 'ok') {
      setSyncing(false);
      toast(t(r === 'too_soon' ? 'yc.ni.sync.tooSoon' : 'yc.ni.sync.error'));
      return;
    }
    let finished = false;
    for (const wait of [5000, 5000, 6000, 8000]) {
      await sleep(wait);
      const s = await shell.refetch();
      const ok = s.data?.connection?.last_ok_at ?? null;
      if (ok && ok !== startedOk && !s.data?.connection?.running) { finished = true; break; }
    }
    const fresh: NightsData | undefined = (await q.refetch()).data;
    void qc.invalidateQueries({ queryKey: ['crm', qk, 'night'] });
    setSyncing(false);
    let best: { id: string; title: string; d: number } | null = null;
    for (const e of fresh?.nights ?? []) {
      const d = e.sold - (before.get(e.id) ?? 0);
      if (d > 0 && (!best || d > best.d)) best = { id: e.id, title: e.title, d };
    }
    if (best) {
      setUpd(best.id);
      setJustSynced(true);
      toast(tp('yc.ni.sync.updated', best.d, { n: n(best.d), title: best.title }));
      setTimeout(() => setUpd(null), 9000);
    } else if (finished) {
      setJustSynced(true);
      toast(t('yc.ni.sync.same'));
    } else {
      toast(t('yc.ni.sync.later'));
    }
  };

  const conn = shell.data?.connection ?? null;
  const lastOk = conn?.last_ok_at ?? null;
  const syncLabel = syncing ? t('yc.ni.sync.reading')
    : justSynced ? t('yc.ni.sync.justNow')
      : !conn ? t('yc.top.sync.none') : conn.state === 'broken' ? t('yc.top.sync.broken')
        : t('yc.top.sync.ok', { time: lastOk ? (new Date(lastOk).toDateString() === new Date().toDateString() ? time(lastOk) : dShort(lastOk)) : '—' });
  const syncDot = syncing || conn?.state === 'running' ? 'var(--amber-500)' : !conn ? 'var(--sand-400)' : conn.state === 'broken' ? 'var(--red-500)' : 'var(--green-500)';

  const noData = !!data && data.nights.length === 0 && data.past_total === 0;
  const head = (d: number) => ({ opacity: intro ? 1 : 0, transform: intro ? 'none' : 'translateY(22px)', transition: `opacity 700ms ${EASE} ${d}ms,transform 800ms ${EASE} ${d}ms` });

  const writeWho = write ? (write.buyers > 0 ? tp('yc.ni.write.buyers', write.buyers, { n: n(write.buyers), title: write.title }) : t('yc.ni.write.base')) : '';

  return (
    <main style={{ flex: 1, width: '100%', maxWidth: 1280, margin: '0 auto', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px) 96px', display: 'flex', flexDirection: 'column', gap: 24, boxSizing: 'border-box' }}>
      {/* En-tête */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)', ...head(120) }}>{t(isPast ? 'yc.ni.kick.past' : 'yc.ni.kick.up')}</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em', ...head(190) }}>
            {t(isPast ? 'yc.ni.h.past.a' : 'yc.ni.h.up.a')}<span className="yc-accent-word">{t(isPast ? 'yc.ni.h.past.b' : 'yc.ni.h.up.b')}</span>{t(isPast ? 'yc.ni.h.past.c' : 'yc.ni.h.up.c')}
          </h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--sand-600)', textWrap: 'pretty', maxWidth: 660, ...head(260) }}>{t(isPast ? 'yc.ni.sub.past' : 'yc.ni.sub.up')}</p>
        </div>
        {!noData && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px', ...head(320) }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--sand-600)', fontWeight: 500 }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: syncDot }} />{syncLabel}
            </span>
            {conn && (
              <Hv
                as="button"
                type="button"
                onClick={doSync}
                disabled={syncing}
                style={{ height: 46, padding: '0 20px 0 16px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', boxShadow: 'var(--shadow-xs)', color: 'var(--ink)', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, cursor: syncing ? 'default' : 'pointer', transition: `translate 240ms ${EASE},box-shadow 240ms,border-color 200ms` }}
                hover={{ translate: '0 -2px', boxShadow: 'var(--shadow-md)', borderColor: 'var(--sand-300)' }}
                active={{ translate: '0 0' }}
              >
                <Icon d={ICO.sync} size={18} stroke={2.2} style={{ animation: syncing ? 'yc-spin 900ms linear infinite' : 'none' }} />
                {syncing ? t('yc.ni.sync.running') : t('yc.ni.sync.btn')}
              </Hv>
            )}
          </div>
        )}
      </div>

      {!data ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Skel w={400} h={52} r={99} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 16 }}>{[0, 1, 2, 3].map((i) => <Skel key={i} h={150} r={24} />)}</div>
          <Skel h={420} r={28} />
        </div>
      ) : noData ? (
        <section style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 18, padding: 'clamp(24px,3vw,40px)', borderRadius: 28, background: 'repeating-linear-gradient(135deg,var(--sand-50) 0 10px,var(--sand-100) 10px 20px)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', animation: `yc-row 700ms ${EASE} 380ms both` }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.ni.empty.k')}</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(24px,3vw,32px)', letterSpacing: '-.03em', lineHeight: 1.1, textWrap: 'balance', maxWidth: 680 }}>{t('yc.ni.empty.t')}</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,230px),1fr))', gap: 12, maxWidth: 820 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '16px 18px', borderRadius: 18, background: '#fff' }}>
                <b style={{ fontSize: 15 }}>{t(`yc.ni.empty.c${i}t`)}</b>
                <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--sand-600)' }}>{t(`yc.ni.empty.c${i}s`)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <Hv as={Link} to={CRM_ROUTES.connectors} style={{ height: 46, padding: '0 22px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none' }} hover={{ background: 'var(--sand-700)', color: '#fff', textDecoration: 'none' }}>
              {t('yc.ni.empty.cta')}
            </Hv>
          </div>
        </section>
      ) : (
        <>
          {/* Onglets + lecture seule */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: `yc-row 700ms ${EASE} 330ms both` }}>
            <div role="tablist" aria-label={t('yc.ni.tabs')} style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', width: 'min(100%,400px)', padding: 4, borderRadius: 99, background: 'var(--sand-100)', boxSizing: 'border-box' }}>
              <i style={{ position: 'absolute', top: 4, bottom: 4, left: 4, width: 'calc(50% - 4px)', borderRadius: 99, background: '#fff', boxShadow: 'var(--shadow-sm)', transform: isPast ? 'translateX(100%)' : 'none', transition: `transform 340ms ${EASE}` }} />
              {([['up', CRM_ROUTES.nights, 'yc.nav.upcoming', up.length], ['past', CRM_ROUTES.nightsPast, 'yc.nav.past', data.past_total]] as const).map(([k, to, l, c]) => {
                const on = tabKey === k;
                return (
                  <Link key={k} to={to} role="tab" aria-selected={on} replace style={{ position: 'relative', height: 44, borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 15, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--sand-600)', textDecoration: 'none', transition: 'color 200ms' }}>
                    {t(l)}
                    <span style={{ minWidth: 22, height: 22, padding: '0 7px', boxSizing: 'border-box', borderRadius: 99, background: on ? (k === 'up' ? 'var(--red-500)' : 'var(--ink)') : 'var(--sand-200)', color: on ? '#fff' : 'var(--sand-700)', fontSize: 12.5, display: 'grid', placeItems: 'center', transition: 'background 200ms,color 200ms' }}>{n(c)}</span>
                  </Link>
                );
              })}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', padding: '12px 16px 12px 14px', borderRadius: 20, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-100)' }}>
              <span style={{ flex: 'none', width: 32, height: 32, borderRadius: 99, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', display: 'grid', placeItems: 'center', color: 'var(--sand-600)' }}>
                <Icon d={ICO.lock} size={15} stroke={2.2} />
              </span>
              <span style={{ flex: '1 1 320px', minWidth: 0, fontSize: 14, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>
                <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{t('yc.ni.lock.b')}</b> {t('yc.ni.lock.t')}
              </span>
              <ShotgunLink size="sm">{t('yc.ni.openShotgun')}</ShotgunLink>
            </div>
          </div>

          {!isPast ? (
            up.length === 0 ? (
              <section style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 16, padding: 'clamp(24px,3vw,40px)', borderRadius: 28, background: 'repeating-linear-gradient(135deg,var(--sand-50) 0 10px,var(--sand-100) 10px 20px)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', animation: `yc-row 700ms ${EASE} 420ms both` }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.ni.avEmpty.k')}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(24px,3vw,32px)', letterSpacing: '-.03em', lineHeight: 1.1, textWrap: 'balance', maxWidth: 640 }}>{t('yc.ni.avEmpty.t')}</span>
                <span style={{ fontSize: 15.5, lineHeight: 1.5, color: 'var(--sand-600)', maxWidth: 560, textWrap: 'pretty' }}>{t('yc.ni.avEmpty.s')}</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
                  <ShotgunLink>{t('yc.ni.openShotgun')}</ShotgunLink>
                  <Hv as={Link} to={CRM_ROUTES.nightsPast} replace style={{ height: 46, padding: '0 22px', borderRadius: 99, border: '1px solid var(--sand-300)', background: '#fff', color: 'var(--ink)', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none' }} hover={{ background: 'var(--sand-50)', color: 'var(--ink)', textDecoration: 'none' }}>
                    {t('yc.ni.avEmpty.past')}
                  </Hv>
                </div>
              </section>
            ) : (
              <UpcomingView
                nights={up} rows={upRows} kinds={kinds} fs={fs} fm={fm} q={qText} setFs={setFs} setFm={setFm} setQ={setQText}
                drId={drId} upd={upd} open={open} write={(e) => setWrite({ id: e.id, title: e.title, buyers: e.buyers })}
                intro={intro} cc={cc} hero={hero} heroDetail={heroDetail.data} heroProgress={heroP}
              />
            )
          ) : (
            <PastView
              inW={inW} prevW={prevW} rows={paRows} months={months} setMonths={(m) => { setMonthsState(m); setLim(8); }}
              series={series} ser={ser} setSer={(s) => { setSerState(s); setLim(8); }} q={qText} setQ={(v) => { setQText(v); setLim(8); }}
              sort={sort} dir={dir} setSort={(k) => { setDir(sort === k ? (dir === 1 ? -1 : 1) : 1); setSortState(k); setLim(8); }}
              lim={lim} setLim={setLim} drId={drId} open={open} intro={intro} cc={cc}
            />
          )}
        </>
      )}

      <NightDrawer id={drId} ids={ids} view={drView} onView={setView} onClose={close} onStep={step} onWrite={(d) => setWrite(d)} />
      <WriteModal
        open={!!write}
        onClose={() => setWrite(null)}
        scope={write && write.buyers > 0 ? 'filtered' : 'all'}
        who={writeWho}
        def={write && write.buyers > 0 && write.id ? { seg: 'all', f: { ev: [write.id] } } : null}
        eventId={write?.id ?? null}
        eyebrow={write ? t('yc.ni.write.eyebrow', { title: write.title }) : undefined}
      />
    </main>
  );
}

/** `/crm/nights/:id` : ouvre la soirée sur le bon onglet. */
export function NightRedirect() {
  const { id } = useParams();
  const q = useNights();
  if (!id) return <Navigate to={CRM_ROUTES.nights} replace />;
  if (!q.data) return null;
  const row = q.data.nights.find((e) => e.id === id);
  return <Navigate to={`${row && !row.upcoming ? CRM_ROUTES.nightsPast : CRM_ROUTES.nights}?e=${id}`} replace />;
}
