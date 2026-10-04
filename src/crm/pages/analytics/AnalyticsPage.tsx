/**
 * Analyses (`/crm/analytics/:tab`) — trois familles : Ventes (« Combien
 * ai-je vendu ? »), Trafic (« D'où vient mon public ? »), Communauté (« Qui
 * sont mes clients ? »). Une barre de filtres collante, commune aux trois :
 * période OU une soirée (de J-21 au jour J), segment de clients, comparaison
 * à avant. Les filtres vivent dans l'adresse (?p=&e=&s=&cmp=) : un lien
 * partagé rouvre la même analyse.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Segmented } from '@/crm/ui/kit';
import { EASE, SPRING } from '@/crm/ui/motion';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { downloadCsv } from '@/crm/lib/csv';
import { useNights } from '@/crm/data/nights';
import { useAnaCommunity, useAnaSales, useAnaTraffic, type AnaFilters, type AnaPeriod, type AnaSeg, type AnaTab } from '@/crm/data/analytics';
import { StatePill, type NightState } from './anaUi';
import { SalesTab, salesCsv } from './SalesTab';
import { TrafficTab, trafficCsv } from './TrafficTab';
import { CommunityTab, communityCsv } from './CommunityTab';

const TABS: { k: AnaTab; route: string; d: string }[] = [
  { k: 'sales', route: CRM_ROUTES.sales, d: 'M4 10h12M4 14h9M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2' },
  { k: 'traffic', route: CRM_ROUTES.traffic, d: 'm3 17 6-6 4 4 8-8M14 7h7v7' },
  { k: 'community', route: CRM_ROUTES.community, d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
];
const PERIODS: AnaPeriod[] = ['24h', '48h', '7d', '30d', '90d', '12m'];
const SEGS: AnaSeg[] = ['all', 'hab', 'occ', 'nou', 'end'];

export default function AnalyticsPage() {
  const { tab } = useParams<{ tab?: string }>();
  if (!tab || !TABS.some((x) => x.k === tab)) return <Navigate to={CRM_ROUTES.sales} replace />;
  return <AnalyticsView tab={tab as AnaTab} />;
}

function readFilters(sp: URLSearchParams, tab: AnaTab): AnaFilters {
  const p = sp.get('p') as AnaPeriod | null;
  const s = sp.get('s') as AnaSeg | null;
  let seg: AnaSeg = s && SEGS.includes(s) ? s : 'all';
  if (seg === 'end' && tab !== 'community') seg = 'all';
  if (tab === 'traffic') seg = 'all';
  return { period: p && PERIODS.includes(p) ? p : '30d', event: sp.get('e') || null, seg, cmp: sp.get('cmp') !== '0' };
}

function AnalyticsView({ tab }: { tab: AnaTab }) {
  const T = useCrmT();
  const { t, dShort } = T;
  const toast = useCrmToast();
  const caps = useCrmCaps();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const f = readFilters(sp, tab);
  const nights = useNights();
  const [evOpen, setEvOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  const sales = useAnaSales(f, tab === 'sales');
  const traffic = useAnaTraffic(f, tab === 'traffic');
  const community = useAnaCommunity(f, tab === 'community');

  const setF = (patch: Partial<AnaFilters>) => {
    const nf = { ...f, ...patch };
    setSp((prev) => {
      const p = new URLSearchParams(prev);
      if (nf.period !== '30d') p.set('p', nf.period); else p.delete('p');
      if (nf.event) p.set('e', nf.event); else p.delete('e');
      if (nf.seg !== 'all') p.set('s', nf.seg); else p.delete('s');
      if (!nf.cmp) p.set('cmp', '0'); else p.delete('cmp');
      return p;
    }, { replace: true });
    setEvOpen(false);
  };
  const goTab = (k: AnaTab) => {
    if (k === tab) return;
    const p = new URLSearchParams(sp);
    if (k !== 'community' && p.get('s') === 'end') p.delete('s');
    const qs = p.toString();
    navigate(`${TABS.find((x) => x.k === k)!.route}${qs ? `?${qs}` : ''}`);
  };

  useEffect(() => {
    if (!evOpen) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setEvOpen(false); };
    const c = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) setEvOpen(false); };
    document.addEventListener('keydown', k);
    document.addEventListener('mousedown', c);
    return () => { document.removeEventListener('keydown', k); document.removeEventListener('mousedown', c); };
  }, [evOpen]);

  const evList = useMemo(() => {
    const all = nights.data?.nights ?? [];
    const up = all.filter((x) => x.upcoming).sort((a, b) => a.start_at.localeCompare(b.start_at));
    const past = all.filter((x) => !x.upcoming).sort((a, b) => b.start_at.localeCompare(a.start_at));
    const today = nights.data?.now ? new Date(nights.data.now).toDateString() : new Date().toDateString();
    return [...up, ...past].slice(0, 40).map((x) => {
      const state: NightState = new Date(x.start_at).toDateString() === today ? 'tonight' : x.upcoming ? 'presale' : 'past';
      return { ...x, state, fill: x.cap ? Math.round((x.sold / x.cap) * 100) : null };
    });
  }, [nights.data]);
  const ev = f.event ? evList.find((x) => x.id === f.event) ?? null : null;
  const evLabel = ev ? `${ev.title} · ${dShort(ev.start_at)}` : t('yc.ana.f.allNights');
  const active = f.period !== '30d' || !!f.event || f.seg !== 'all' || !f.cmp;
  const segLabel = (s: AnaSeg) => t(`yc.ana.seg.${s}`);
  const scope = `${ev ? t('yc.ana.f.scopeEv', { title: ev.title, date: dShort(ev.start_at) }) : t(`yc.ana.per.full.${f.period}`)} · ${f.seg === 'all' ? t('yc.ana.f.allClients') : segLabel(f.seg).toLowerCase()}`;

  const exportCsv = () => {
    const stamp = `${tab}-${f.event ? 'soiree' : f.period}`;
    const out = tab === 'sales' ? (sales.data ? salesCsv(sales.data, T, caps.money) : null)
      : tab === 'traffic' ? (traffic.data ? trafficCsv(traffic.data, T, caps.money) : null)
        : (community.data ? communityCsv(community.data, T) : null);
    if (!out) return;
    downloadCsv(`yuno-analyses-${stamp}.csv`, out.columns, out.rows);
    toast(t('yc.ana.exported', { file: `yuno-analyses-${stamp}.csv` }));
  };

  return (
    <main style={{ flex: 1, width: '100%', maxWidth: 1280, boxSizing: 'border-box', margin: '0 auto', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px) 72px', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px' }}>
        <div key={`h-${tab}`} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, animation: `yc-in-blur 700ms ${EASE} both` }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.ana.kick', { crumb: t(`yc.ana.tab.${tab}`) })}</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em' }}>{t(`yc.ana.title.${tab}`)}</h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--sand-600)', textWrap: 'pretty', maxWidth: 680 }}>{t(`yc.ana.sub.${tab}`)}</p>
        </div>
        <Hv
          as="button"
          type="button"
          onClick={exportCsv}
          style={{ flex: 'none', height: 46, padding: '0 20px 0 16px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', boxShadow: 'var(--shadow-xs)', color: 'var(--ink)', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', transition: `border-color 140ms,transform 200ms ${SPRING}` }}
          hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }}
          active={{ transform: 'scale(.97)' }}
        >
          <Icon name="download" size={17} stroke={2.2} />{t('yc.ana.export')}
        </Hv>
      </div>

      <div role="tablist" aria-label={t('yc.ana.tabs')} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {TABS.map((x) => {
          const on = x.k === tab;
          return (
            <Hv
              key={x.k}
              as="button"
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => goTab(x.k)}
              style={{ height: 44, padding: '0 20px 0 16px', borderRadius: 99, border: `1px solid ${on ? 'var(--ink)' : 'var(--sand-200)'}`, background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer', transition: `background 160ms,color 160ms,border-color 160ms,transform 200ms ${SPRING}` }}
              hover={{ transform: 'translateY(-1px)' }}
              active={{ transform: 'scale(.97)' }}
            >
              <Icon d={x.d} size={18} stroke={2} />{t(`yc.ana.tab.${x.k}`)}
            </Hv>
          );
        })}
        <Hv
          as={Link}
          to={CRM_ROUTES.journey}
          style={{ height: 44, padding: '0 18px 0 16px', borderRadius: 99, border: '1px dashed var(--sand-300)', background: 'transparent', color: 'var(--sand-600)', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none', transition: `color 160ms,border-color 160ms` }}
          hover={{ color: 'var(--ink)', borderColor: 'var(--sand-400)', textDecoration: 'none' }}
        >
          {t('yc.ana.tab.journey')}<Icon name="arrowRight" size={15} stroke={2.2} />
        </Hv>
      </div>

      {/* Filtres */}
      <div style={{ position: 'sticky', top: 64, zIndex: 21, margin: '0 calc(-1 * clamp(16px,3vw,40px))', padding: '10px clamp(16px,3vw,40px)', background: 'rgba(252,250,249,.9)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid var(--sand-100)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px' }}>
          <div style={{ opacity: f.event ? 0.4 : 1, pointerEvents: f.event ? 'none' : 'auto', transition: 'opacity 200ms', maxWidth: '100%', overflowX: 'auto' }} className="yc-noscroll">
            <Segmented
              value={f.period}
              onChange={(p) => setF({ period: p })}
              ariaLabel={t('yc.ana.f.period')}
              options={PERIODS.map((p) => ({ value: p, label: t(`yc.ana.per.${p}`) }))}
            />
          </div>
          <div ref={popRef} style={{ position: 'relative' }}>
            <Hv
              as="button"
              type="button"
              onClick={() => setEvOpen((o) => !o)}
              aria-haspopup="listbox"
              aria-expanded={evOpen}
              style={{ height: 42, maxWidth: 'min(420px, calc(100vw - 32px))', padding: '0 12px 0 16px', borderRadius: 99, background: '#fff', border: `1px solid ${evOpen ? 'var(--sand-400)' : 'var(--sand-200)'}`, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', transition: 'border-color 140ms' }}
              hover={{ borderColor: 'var(--sand-300)' }}
            >
              <span style={{ flex: 'none', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)', fontWeight: 500 }}>{t('yc.ana.f.night')}</span>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{evLabel}</span>
              <Icon name="chevronDown" size={14} stroke={2.4} color="var(--sand-400)" style={{ transform: `rotate(${evOpen ? 180 : 0}deg)`, transition: 'transform 200ms' }} />
            </Hv>
            {evOpen && (
              <div role="listbox" style={{ position: 'absolute', top: 48, left: 0, width: 'min(400px, calc(100vw - 32px))', maxHeight: 'min(440px, 70vh)', overflowY: 'auto', boxSizing: 'border-box', padding: 8, borderRadius: 20, background: '#fff', boxShadow: 'var(--shadow-md),0 0 0 1px var(--sand-200)', zIndex: 30, display: 'flex', flexDirection: 'column', gap: 2, animation: `yc-pop 220ms ${EASE} both` }}>
                {[null, ...evList].map((o) => {
                  const on = o ? f.event === o.id : !f.event;
                  return (
                    <Hv
                      key={o?.id ?? 'all'}
                      as="button"
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => setF({ event: o?.id ?? null })}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: 0, borderRadius: 12, background: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 14.5, color: 'var(--ink)' }}
                      hover={{ background: 'var(--sand-50)' }}
                    >
                      <span style={{ flex: 'none', width: 18, height: 18, borderRadius: 99, display: 'grid', placeItems: 'center', background: on ? 'var(--red-500)' : 'var(--sand-100)', color: '#fff' }}>{on && <Icon name="check" size={11} stroke={3.2} />}</span>
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o ? o.title : t('yc.ana.f.allNights')}</span>
                        {o && <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{dShort(o.start_at)}{o.fill !== null ? ` · ${t('yc.ana.f.filled', { pct: o.fill })}` : ''}</span>}
                      </span>
                      {o && <StatePill state={o.state} label={t(`yc.ana.state.${o.state}`)} />}
                    </Hv>
                  );
                })}
              </div>
            )}
          </div>
          {tab !== 'traffic' && (
            <div role="group" aria-label={t('yc.ana.f.seg')} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {SEGS.filter((s) => s !== 'end' || tab === 'community').map((s) => {
                const on = f.seg === s;
                return (
                  <Hv
                    key={s}
                    as="button"
                    type="button"
                    aria-pressed={on}
                    onClick={() => setF({ seg: s })}
                    style={{ height: 36, padding: '0 14px', borderRadius: 99, border: `1px solid ${on ? 'var(--ink)' : 'var(--sand-200)'}`, background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--sand-700)', fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: 'background 160ms,color 160ms,border-color 160ms' }}
                    hover={on ? {} : { borderColor: 'var(--sand-400)' }}
                  >
                    {segLabel(s)}
                  </Hv>
                );
              })}
            </div>
          )}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 500, color: 'var(--sand-700)', cursor: 'pointer', userSelect: 'none' }}>
            <button type="button" role="switch" aria-checked={f.cmp} onClick={() => setF({ cmp: !f.cmp })} style={{ position: 'relative', width: 38, height: 22, padding: 0, border: 0, borderRadius: 99, background: f.cmp ? 'var(--ink)' : 'var(--sand-300)', cursor: 'pointer', transition: 'background 180ms' }}>
              <span style={{ position: 'absolute', top: 2, left: f.cmp ? 18 : 2, width: 18, height: 18, borderRadius: 99, background: '#fff', boxShadow: 'var(--shadow-xs)', transition: `left 200ms ${SPRING}` }} />
            </button>
            {t('yc.ana.f.cmp')}
          </label>
          {active && (
            <Hv
              as="button"
              type="button"
              onClick={() => setF({ period: '30d', event: null, seg: 'all', cmp: true })}
              style={{ height: 34, padding: '0 12px', border: 0, borderRadius: 99, background: 'none', color: 'var(--red-600)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', animation: `yc-pop 260ms ${EASE} both` }}
              hover={{ background: 'var(--red-50)' }}
            >
              <Icon name="refresh" size={15} stroke={2.2} />{t('yc.ana.f.reset')}
            </Hv>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--sand-500)' }}>{scope}</span>
        </div>
        {ev && <div style={{ marginTop: 6, fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.ana.f.perNote')}</div>}
      </div>

      {tab === 'sales' && <SalesTab q={sales} f={f} setF={setF} goTab={goTab} />}
      {tab === 'traffic' && <TrafficTab q={traffic} f={f} setF={setF} />}
      {tab === 'community' && <CommunityTab q={community} f={f} setF={setF} />}
    </main>
  );
}
