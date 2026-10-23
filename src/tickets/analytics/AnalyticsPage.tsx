/**
 * Yuno Tickets › Analyses (`/owner/analyses/:tab`, `/organizer-app/analyses/:tab`,
 * `/manager/analyses/:tab`) — la copie des Analyses de Yuno CRM
 * (src/crm/pages/analytics/AnalyticsPage.tsx), sur les ventes Yuno. Ventes (« Combien
 * ai-je vendu ? »), Trafic (« D'où vient mon public ? »), Partenaires (« Qui vend
 * pour moi ? »), Communauté (« Qui
 * sont mes clients ? »), Guest list (« Qui entre gratuitement, et qui finit
 * par payer ? », migration 20261008100000). Une barre de filtres collante, commune aux trois :
 * période OU une soirée (de J-21 au jour J), segment de clients, comparaison
 * à avant. Les filtres vivent dans l'adresse (?p=&e=&s=&cmp=) : un lien
 * partagé rouvre la même analyse.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast as sonner } from 'sonner';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Segmented } from '@/tickets/analytics/kit';
import { EASE, SPRING } from '@/crm/ui/motion';
import { useTixT } from '@/tickets/analytics/i18n';
import { useTixCaps, useTixNights } from '@/tickets/analytics/scope';
import { useTixRoutes, type TixRoutes } from '@/tickets/analytics/routes';
import { downloadCsv } from '@/crm/lib/csv';
import { useAnaCommunity, useAnaGuestList, useAnaPartners, useAnaSales, useAnaTraffic, type AnaFilters, type AnaPeriod, type AnaPillar, type AnaSeg, type AnaTab, PILLARS } from '@/tickets/analytics/data';
import { StatePill, type NightState } from './anaUi';
import { LoadError } from '@/tickets/analytics/LoadError';
import { SalesTab, salesCsv } from './SalesTab';
import { TrafficTab, trafficCsv } from './TrafficTab';
import { PartnersTab, partnersCsv } from './PartnersTab';
import { CommunityTab, communityCsv } from './CommunityTab';
import { GuestListTab, guestlistCsv } from './GuestListTab';
import { LiveView } from '@/components/live-view/LiveView';
import { useTixScope } from '@/tickets/analytics/scope';

const TABS: { k: AnaTab; route: keyof TixRoutes; d: string }[] = [
  { k: 'sales', route: 'sales', d: 'M4 10h12M4 14h9M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2' },
  { k: 'traffic', route: 'traffic', d: 'm3 17 6-6 4 4 8-8M14 7h7v7' },
  // Partenaires (lot 3) : promoteurs, liens partenaires, « Qui fait vendre ? » d'une soirée partagée.
  { k: 'partners', route: 'partners', d: 'M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1M15 15h3a4 4 0 0 1 4 4v1' },
  { k: 'community', route: 'community', d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
  { k: 'guestlist', route: 'guestlist', d: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11' },
  // En direct : la Live View de Yuno Tickets (globe, ventes de l'instant), gardée telle quelle.
  { k: 'live', route: 'live', d: 'M4.9 19.1a10 10 0 0 1 0-14.2M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M19.1 4.9a10 10 0 0 1 0 14.2M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z' },
];
const PERIODS: AnaPeriod[] = ['24h', '48h', '7d', '30d', '90d', '12m'];
const SEGS: AnaSeg[] = ['all', 'hab', 'occ', 'nou', 'end'];

export function AnalyticsPage() {
  const { tab } = useParams<{ tab?: string }>();
  const R = useTixRoutes();
  if (!tab || !TABS.some((x) => x.k === tab)) return <Navigate to={R.sales} replace />;
  return <AnalyticsView tab={tab as AnaTab} />;
}

function readFilters(sp: URLSearchParams, tab: AnaTab): AnaFilters {
  const p = sp.get('p') as AnaPeriod | null;
  const s = sp.get('s') as AnaSeg | null;
  let seg: AnaSeg = s && SEGS.includes(s) ? s : 'all';
  if (seg === 'end' && tab !== 'community') seg = 'all';
  if (tab === 'traffic' || tab === 'partners' || tab === 'guestlist' || tab === 'live') seg = 'all';
  const pl = sp.get('pl') as AnaPillar | null;
  const pillar: AnaPillar = tab === 'sales' && pl && PILLARS.includes(pl) ? pl : 'all';
  const event = sp.get('e') || null;
  // La soirée comparée n'a de sens que pour une soirée choisie, dans Ventes.
  const compare = tab === 'sales' && event ? sp.get('ce') || null : null;
  return { period: p && PERIODS.includes(p) ? p : '30d', event, seg, cmp: sp.get('cmp') !== '0', pillar, compare };
}

/** Lecture en échec et rien en mémoire : LoadError avec « Réessayer » ; sinon rien (l'onglet s'affiche). */
function failed(q: { isError: boolean; data: unknown; error: unknown; isFetching: boolean; refetch: () => Promise<unknown> }) {
  if (!q.isError || q.data) return null;
  return <LoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />;
}

function AnalyticsView({ tab }: { tab: AnaTab }) {
  const T = useTixT();
  const { t, dShort } = T;
  const toast = (msg: string) => { sonner(msg); };
  const caps = useTixCaps();
  const R = useTixRoutes();
  const scopeArgs = useTixScope().rpc;
  const live = tab === 'live';
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const f = readFilters(sp, tab);
  const nights = useTixNights();
  const [evOpen, setEvOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  const sales = useAnaSales(f, tab === 'sales');
  const traffic = useAnaTraffic(f, tab === 'traffic');
  const partners = useAnaPartners(f, tab === 'partners');
  const community = useAnaCommunity(f, tab === 'community');
  const guestlist = useAnaGuestList(f.period, tab === 'guestlist' && !f.event);

  const setF = (patch: Partial<AnaFilters>) => {
    const nf = { ...f, ...patch };
    setSp((prev) => {
      const p = new URLSearchParams(prev);
      if (nf.period !== '30d') p.set('p', nf.period); else p.delete('p');
      if (nf.event) p.set('e', nf.event); else p.delete('e');
      if (nf.seg !== 'all') p.set('s', nf.seg); else p.delete('s');
      if (!nf.cmp) p.set('cmp', '0'); else p.delete('cmp');
      if (nf.pillar !== 'all') p.set('pl', nf.pillar); else p.delete('pl');
      // Changer de soirée oublie la soirée comparée.
      if (nf.event && nf.compare && nf.event === f.event && nf.compare !== nf.event) p.set('ce', nf.compare); else p.delete('ce');
      return p;
    }, { replace: true });
    setEvOpen(false);
  };
  const goTab = (k: AnaTab) => {
    if (k === tab) return;
    const p = new URLSearchParams(sp);
    if (k !== 'community' && p.get('s') === 'end') p.delete('s');
    p.delete('pl');
    p.delete('ce');
    const qs = p.toString();
    navigate(`${R[TABS.find((x) => x.k === k)!.route] as string}${qs ? `?${qs}` : ''}`);
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
  const evLabel = ev ? `${ev.title} · ${dShort(ev.start_at)}` : t('ya.ana.f.allNights');
  const active = f.period !== '30d' || !!f.event || f.seg !== 'all' || !f.cmp;
  const segLabel = (s: AnaSeg) => t(`ya.ana.seg.${s}`);
  const scope = `${ev ? t('ya.ana.f.scopeEv', { title: ev.title, date: dShort(ev.start_at) }) : t(`ya.ana.per.full.${f.period}`)} · ${f.seg === 'all' ? t('ya.ana.f.allClients') : segLabel(f.seg).toLowerCase()}`;

  const exportCsv = () => {
    const stamp = `${tab}-${f.event ? 'soiree' : f.period}`;
    const out = tab === 'sales' ? (sales.data ? salesCsv(sales.data, T, caps.money) : null)
      : tab === 'traffic' ? (traffic.data ? trafficCsv(traffic.data, T, caps.money) : null)
      : tab === 'partners' ? (partners.data ? partnersCsv(partners.data, T, caps.money) : null)
        : tab === 'guestlist' ? (guestlist.data && !f.event ? guestlistCsv(guestlist.data, T) : null)
          : (community.data ? communityCsv(community.data, T) : null);
    if (!out) return;
    downloadCsv(`yuno-analyses-${stamp}.csv`, out.columns, out.rows);
    toast(t('ya.ana.exported', { file: `yuno-analyses-${stamp}.csv` }));
  };

  return (
    <div style={{ flex: 1, width: '100%', maxWidth: 1280, boxSizing: 'border-box', margin: '0 auto', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px) 72px', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px' }}>
        <div key={`h-${tab}`} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, animation: `ya-in-blur 700ms ${EASE} both` }}>
          <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>{t('ya.ana.kick', { crumb: t(`ya.ana.tab.${tab}`) })}</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em' }}>{t(`ya.ana.title.${tab}`)}</h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--ya-sand-600)', textWrap: 'pretty', maxWidth: 680 }}>{t(`ya.ana.sub.${tab}`)}</p>
        </div>
        {!live && <Hv
          as="button"
          type="button"
          onClick={exportCsv}
          style={{ flex: 'none', height: 46, padding: '0 20px 0 16px', borderRadius: 99, background: 'var(--ya-card)', border: '1px solid var(--ya-sand-200)', boxShadow: 'var(--ya-shadow-xs)', color: 'var(--ya-ink)', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', transition: `border-color 140ms,transform 200ms ${SPRING}` }}
          hover={{ borderColor: 'var(--ya-sand-300)', background: 'var(--ya-paper)' }}
          active={{ transform: 'scale(.97)' }}
        >
          <Icon name="download" size={17} stroke={2.2} />{t('ya.ana.export')}
        </Hv>}
      </div>

      <div role="tablist" aria-label={t('ya.ana.tabs')} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
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
              style={{ height: 44, padding: '0 20px 0 16px', borderRadius: 99, border: `1px solid ${on ? 'var(--ya-ink)' : 'var(--ya-sand-200)'}`, background: on ? 'var(--ya-ink)' : 'var(--ya-card)', color: on ? 'var(--ya-on-ink)' : 'var(--ya-ink)', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer', transition: `background 160ms,color 160ms,border-color 160ms,transform 200ms ${SPRING}` }}
              hover={{ transform: 'translateY(-1px)' }}
              active={{ transform: 'scale(.97)' }}
            >
              <Icon d={x.d} size={18} stroke={2} />{t(`ya.ana.tab.${x.k}`)}
            </Hv>
          );
        })}
        <Hv
          as={Link}
          to={R.journey}
          style={{ height: 44, padding: '0 18px 0 16px', borderRadius: 99, border: '1px dashed var(--ya-sand-300)', background: 'transparent', color: 'var(--ya-sand-600)', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none', transition: `color 160ms,border-color 160ms` }}
          hover={{ color: 'var(--ya-ink)', borderColor: 'var(--ya-sand-400)', textDecoration: 'none' }}
        >
          {t('ya.ana.tab.journey')}<Icon name="arrowRight" size={15} stroke={2.2} />
        </Hv>
      </div>

      {/* Filtres */}
      {!live && <div className="ya-filters" style={{ position: 'sticky', zIndex: 21, margin: '0 calc(-1 * clamp(16px,3vw,40px))', padding: '10px clamp(16px,3vw,40px)', background: 'var(--ya-glass)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid var(--ya-sand-100)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px' }}>
          <div style={{ opacity: f.event ? 0.4 : 1, pointerEvents: f.event ? 'none' : 'auto', transition: 'opacity 200ms', maxWidth: '100%', overflowX: 'auto' }} className="ya-noscroll">
            <Segmented
              value={f.period}
              onChange={(p) => setF({ period: p })}
              ariaLabel={t('ya.ana.f.period')}
              options={PERIODS.map((p) => ({ value: p, label: t(`ya.ana.per.${p}`) }))}
            />
          </div>
          <div ref={popRef} style={{ position: 'relative' }}>
            <Hv
              as="button"
              type="button"
              onClick={() => setEvOpen((o) => !o)}
              aria-haspopup="listbox"
              aria-expanded={evOpen}
              style={{ height: 42, maxWidth: 'min(420px, calc(100vw - 32px))', padding: '0 12px 0 16px', borderRadius: 99, background: 'var(--ya-card)', border: `1px solid ${evOpen ? 'var(--ya-sand-400)' : 'var(--ya-sand-200)'}`, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: 'var(--ya-ink)', cursor: 'pointer', transition: 'border-color 140ms' }}
              hover={{ borderColor: 'var(--ya-sand-300)' }}
            >
              <span style={{ flex: 'none', fontFamily: 'var(--ya-font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)', fontWeight: 500 }}>{t('ya.ana.f.night')}</span>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{evLabel}</span>
              <Icon name="chevronDown" size={14} stroke={2.4} color="var(--ya-sand-400)" style={{ transform: `rotate(${evOpen ? 180 : 0}deg)`, transition: 'transform 200ms' }} />
            </Hv>
            {evOpen && (
              <div role="listbox" style={{ position: 'absolute', top: 48, left: 0, width: 'min(400px, calc(100vw - 32px))', maxHeight: 'min(440px, 70vh)', overflowY: 'auto', boxSizing: 'border-box', padding: 8, borderRadius: 20, background: 'var(--ya-card)', boxShadow: 'var(--ya-shadow-md),0 0 0 1px var(--ya-sand-200)', zIndex: 30, display: 'flex', flexDirection: 'column', gap: 2, animation: `ya-pop 220ms ${EASE} both` }}>
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
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: 0, borderRadius: 12, background: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 14.5, color: 'var(--ya-ink)' }}
                      hover={{ background: 'var(--ya-sand-50)' }}
                    >
                      <span style={{ flex: 'none', width: 18, height: 18, borderRadius: 99, display: 'grid', placeItems: 'center', background: on ? 'var(--ya-red-500)' : 'var(--ya-sand-100)', color: 'var(--ya-card)' }}>{on && <Icon name="check" size={11} stroke={3.2} />}</span>
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o ? o.title : t('ya.ana.f.allNights')}</span>
                        {o && <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{dShort(o.start_at)}{o.fill !== null ? ` · ${t('ya.ana.f.filled', { pct: o.fill })}` : ''}</span>}
                      </span>
                      {o && <StatePill state={o.state} label={t(`ya.ana.state.${o.state}`)} />}
                    </Hv>
                  );
                })}
              </div>
            )}
          </div>
          {tab !== 'traffic' && tab !== 'partners' && tab !== 'guestlist' && (
            <div role="group" aria-label={t('ya.ana.f.seg')} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {SEGS.filter((s) => s !== 'end' || tab === 'community').map((s) => {
                const on = f.seg === s;
                return (
                  <Hv
                    key={s}
                    as="button"
                    type="button"
                    aria-pressed={on}
                    onClick={() => setF({ seg: s })}
                    style={{ height: 36, padding: '0 14px', borderRadius: 99, border: `1px solid ${on ? 'var(--ya-ink)' : 'var(--ya-sand-200)'}`, background: on ? 'var(--ya-ink)' : 'var(--ya-card)', color: on ? 'var(--ya-on-ink)' : 'var(--ya-sand-700)', fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: 'background 160ms,color 160ms,border-color 160ms' }}
                    hover={on ? {} : { borderColor: 'var(--ya-sand-400)' }}
                  >
                    {segLabel(s)}
                  </Hv>
                );
              })}
            </div>
          )}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 500, color: 'var(--ya-sand-700)', cursor: 'pointer', userSelect: 'none' }}>
            <button type="button" role="switch" aria-checked={f.cmp} onClick={() => setF({ cmp: !f.cmp })} style={{ position: 'relative', width: 38, height: 22, padding: 0, border: 0, borderRadius: 99, background: f.cmp ? 'var(--ya-ink)' : 'var(--ya-sand-300)', cursor: 'pointer', transition: 'background 180ms' }}>
              <span style={{ position: 'absolute', top: 2, left: f.cmp ? 18 : 2, width: 18, height: 18, borderRadius: 99, background: 'var(--ya-card)', boxShadow: 'var(--ya-shadow-xs)', transition: `left 200ms ${SPRING}` }} />
            </button>
            {t('ya.ana.f.cmp')}
          </label>
          {active && (
            <Hv
              as="button"
              type="button"
              onClick={() => setF({ period: '30d', event: null, seg: 'all', cmp: true, pillar: 'all', compare: null })}
              style={{ height: 34, padding: '0 12px', border: 0, borderRadius: 99, background: 'none', color: 'var(--ya-red-600)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', animation: `ya-pop 260ms ${EASE} both` }}
              hover={{ background: 'var(--ya-red-50)' }}
            >
              <Icon name="refresh" size={15} stroke={2.2} />{t('ya.ana.f.reset')}
            </Hv>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--ya-sand-500)' }}>{scope}</span>
        </div>
        {ev && <div style={{ marginTop: 6, fontSize: 13, color: 'var(--ya-sand-500)' }}>{t('ya.ana.f.perNote')}</div>}
      </div>}

      {/* Un onglet dont la lecture échoue (délai de 30 s compris) dit l'échec : ses squelettes attendraient sans fin. */}
      {tab === 'sales' && (failed(sales) ?? <SalesTab q={sales} f={f} setF={setF} goTab={goTab} />)}
      {tab === 'traffic' && (failed(traffic) ?? <TrafficTab q={traffic} f={f} setF={setF} />)}
      {tab === 'partners' && (failed(partners) ?? <PartnersTab q={partners} f={f} setF={setF} />)}
      {tab === 'community' && (failed(community) ?? <CommunityTab q={community} f={f} setF={setF} />)}
      {tab === 'guestlist' && ((f.event ? null : failed(guestlist)) ?? <GuestListTab q={guestlist} f={f} />)}
      {live && <LiveView venueId={scopeArgs.p_venue_id} organizerUserId={scopeArgs.p_organizer_user_id} />}
    </div>
  );
}
