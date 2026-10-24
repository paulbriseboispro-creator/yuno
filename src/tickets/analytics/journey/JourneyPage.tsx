/**
 * Yuno Tickets › Analyses › Parcours client (`…/analyses/journey`, copie du
 * Parcours client de Yuno CRM) — « Où mes clients s'arrêtent-ils avant
 * d'acheter ? ». Le parcours se lit message par message dans les e-mails et
 * les push de Yuno Tickets envoyés à la main (lot 7 ; reçu, ouvert,
 * clic, achat sous 7 jours, retour sous 90 jours). Quatre chiffres, puis
 * l'entonnoir (une étape cliquée dit qui s'arrête, après quel message, et
 * ouvre une relance), les chemins et délais des acheteurs, le classement des
 * campagnes (tiroir de détail) et le fil d'un client réel. Les filtres vivent
 * dans l'adresse (?p=&e=&m=&ch=&s=&cmp=) : un lien partagé rouvre la même
 * lecture.
 */
import { LoadError } from '@/tickets/analytics/LoadError';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast as sonner } from 'sonner';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE, SPRING, reveal, useIntro } from '@/crm/ui/motion';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useTixT } from '@/tickets/analytics/i18n';
import { useTixCaps, useTixNights } from '@/tickets/analytics/scope';
import { useTixRoutes } from '@/tickets/analytics/routes';
import { downloadCsv } from '@/crm/lib/csv';
import { duplicateTicketsCampaign } from '@/tickets/analytics/actions';
import {
  JR_CHANNELS, JR_PERIODS, JR_SEGS, useJourney,
  type JrCampaign, type JrChannel, type JrFilters, type JrPeriod, type JrPerson, type JrSeg,
} from '@/tickets/analytics/data';
import { FilterDrop, type DropOption } from './jrUi';
import { avgConvOf, campConv, scrollIn, useInViewOnce, useStaged } from './jrLib';
import { JourneyKpis } from './JourneyKpis';
import { FunnelCard, type RelaunchAsk } from './FunnelCard';
import { BeforeBuy } from './BeforeBuy';
import { CampaignRank } from './CampaignRank';
import { CampaignDrawer } from './CampaignDrawer';
import { CustomerExample } from './CustomerExample';

type Pop = 'ev' | 'camp' | 'ch' | 'seg' | null;

const DEFAULT: JrFilters = { period: '30d', event: null, campaign: null, channel: 'all', seg: 'all', cmp: true };

function readFilters(sp: URLSearchParams): JrFilters {
  const p = sp.get('p') as JrPeriod | null;
  const ch = sp.get('ch') as JrChannel | null;
  const s = sp.get('s') as JrSeg | null;
  return {
    period: p && JR_PERIODS.includes(p) ? p : '30d',
    event: sp.get('e') || null,
    campaign: sp.get('m') || null,
    channel: ch && JR_CHANNELS.includes(ch) ? ch : 'all',
    seg: s && JR_SEGS.includes(s) ? s : 'all',
    cmp: sp.get('cmp') !== '0',
  };
}

export function JourneyPage() {
  const T = useTixT();
  const { t, tp, n, dShort } = T;
  const caps = useTixCaps();
  const toast = (msg: string) => { sonner(msg); };
  const R = useTixRoutes();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const f = readFilters(sp);
  const q = useJourney(f);
  const nights = useTixNights();
  const intro = useIntro();
  // Sur un téléphone, la barre de filtres replie sur 3-4 lignes : collante, elle
  // cacherait un tiers de l'écran.
  const narrow = useNarrow(720);

  const [pop, setPop] = useState<Pop>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [swap, setSwap] = useState(0);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [dupBusy, setDupBusy] = useState(false);
  const [pickKey, setPickKey] = useState(0);

  const d = q.data;
  const loading = !d || (q.isFetching && q.isPlaceholderData);
  const dataKey = `${f.period}|${f.event}|${f.campaign}|${f.channel}|${f.seg}|${q.dataUpdatedAt}`;
  const filled = !!d && d.has_campaigns && d.funnel[0] >= 1;
  const cc = useStaged(dataKey, !loading, 1500, 650, 800, 0);
  const g = useStaged(dataKey, !loading, 1400, 550, 1000, 0);

  const s2Ref = useRef<HTMLDivElement>(null);
  const s3Ref = useRef<HTMLElement>(null);
  const s4Ref = useRef<HTMLElement>(null);
  const s2on = useInViewOnce(s2Ref, filled && intro);
  const s3on = useInViewOnce(s3Ref, filled && intro);
  const s4on = useInViewOnce(s4Ref, !!d && d.examples.length > 0 && intro);
  const a2 = useStaged(dataKey, s2on && !loading, 1000, 250, 800, 100);
  const a3 = useStaged(dataKey, s3on && !loading, 1000, 250, 800, 100);
  const tl = useStaged(`${dataKey}|${pickKey}`, s4on && !loading, 1000, 250, 900, 0);

  const setF = useCallback((patch: Partial<JrFilters>) => {
    const nf = { ...f, ...patch };
    setSp((prev) => {
      const p = new URLSearchParams(prev);
      const put = (k: string, v: string | null, def: string | null) => { if (v && v !== def) p.set(k, v); else p.delete(k); };
      put('p', nf.period, '30d');
      put('e', nf.event, null);
      put('m', nf.campaign, null);
      put('ch', nf.channel, 'all');
      put('s', nf.seg, 'all');
      if (!nf.cmp) p.set('cmp', '0'); else p.delete('cmp');
      return p;
    }, { replace: true });
    setPop(null);
    setSel(null);
    setSwap((x) => x + 1);
  }, [f, setSp]);

  const evList = useMemo(() => {
    const all = (nights.data?.nights ?? []).slice(0, 40).map((x) => ({ id: x.id, title: x.title, start_at: x.start_at, upcoming: x.upcoming }));
    const up = all.filter((x) => x.upcoming).sort((a, b) => a.start_at.localeCompare(b.start_at));
    const past = all.filter((x) => !x.upcoming).sort((a, b) => b.start_at.localeCompare(a.start_at));
    const today = new Date().toDateString();
    return [...up, ...past].map((x) => ({ ...x, tonight: new Date(x.start_at).toDateString() === today }));
  }, [nights.data]);
  const ev = f.event ? evList.find((x) => x.id === f.event) ?? null : null;
  const campOpts = d?.options.campaigns ?? [];
  const camp = f.campaign ? campOpts.find((c) => c.id === f.campaign) ?? null : null;
  const campName = camp?.name ?? (f.campaign ? d?.campaigns.find((c) => c.id === f.campaign)?.name ?? null : null);
  const chLabel = (c: JrChannel) => t(`ya.jr.ch.${c === 'all' ? 'email' : c}`);
  const segLabel = (s: JrSeg) => t(`ya.cli.seg.${s}`);

  const scopeParts = [f.campaign ? t('ya.jr.quote', { s: campName ?? '…' }) : t(`ya.ana.per.full.${f.period}`)];
  if (!f.campaign) {
    if (ev) scopeParts.push(ev.title ?? dShort(ev.start_at));
    if (f.channel !== 'all') scopeParts.push(chLabel(f.channel));
  }
  if (f.seg !== 'all') scopeParts.push(segLabel(f.seg).toLowerCase());
  const scope = scopeParts.join(' · ');
  const active = f.period !== '30d' || !!f.event || !!f.campaign || f.channel !== 'all' || f.seg !== 'all' || !f.cmp;
  const thin = !!d && d.funnel[0] > 0 && d.funnel[0] < 100;

  // ── Filtres ────────────────────────────────────────────────────────────
  const rules = nights.data?.rules;
  const opt = (key: string, label: string, on: boolean, pick: () => void, extra?: Partial<DropOption>): DropOption => ({ key, label, on, pick, ...extra });
  const evOpts: DropOption[] = [
    opt('all', t('ya.ana.f.allNights'), !f.event, () => setF({ event: null })),
    ...evList.map((x) => opt(x.id, x.title ?? dShort(x.start_at), f.event === x.id, () => setF({ event: x.id }), {
      sub: x.upcoming ? dShort(x.start_at) : `${dShort(x.start_at)} · ${t('ya.ana.state.past')}`,
      tag: x.tonight ? { label: t('ya.ana.state.tonight'), bg: 'var(--ya-red-50)', fg: 'var(--ya-red-700)' } : x.upcoming ? { label: t('ya.ana.state.presale'), bg: 'var(--ya-amber-50)', fg: 'var(--ya-amber-700)' } : undefined,
    })),
  ];
  const campDrop: DropOption[] = [
    opt('all', t('ya.jr.f.allCampaigns'), !f.campaign, () => setF({ campaign: null })),
    ...campOpts.map((c) => opt(c.id, c.name, f.campaign === c.id, () => setF({ campaign: c.id, event: null, channel: 'all' }), {
      sub: t('ya.jr.f.campSub', { ch: t(`ya.jr.ch.${c.channel ?? 'email'}`), date: dShort(c.sent_at) }),
    })),
  ];
  const chDrop: DropOption[] = [
    opt('all', t('ya.jr.f.allChannels'), f.channel === 'all', () => setF({ channel: 'all' })),
    opt('email', t('ya.jr.ch.email'), f.channel === 'email', () => setF({ channel: 'email' })),
    opt('push', t('ya.jr.ch.push'), f.channel === 'push', () => setF({ channel: 'push' })),
    ...(['sms'] as const).map((c) => opt(c, t(`ya.jr.ch.${c}`), f.channel === c, () => setF({ channel: c }), {
      disabled: f.channel !== c, tag: { label: t('ya.jr.soon'), bg: 'var(--ya-sand-100)', fg: 'var(--ya-sand-600)' },
    })),
  ];
  const segSub = (s: JrSeg) => {
    if (s === 'all') return undefined;
    return t(`ya.cli.seg.${s}.def`, { n: rules?.regular_min_nights ?? 3, m: s === 'end' ? rules?.lapse_months ?? 6 : rules?.regular_window_months ?? 12 });
  };
  const segDrop: DropOption[] = JR_SEGS.map((s) => opt(s, s === 'all' ? t('ya.jr.f.allClients') : segLabel(s), f.seg === s, () => setF({ seg: s }), { sub: segSub(s) }));
  const cmpDisabled = !!f.campaign || f.period === '12m';
  const cmpOn = f.cmp && !f.campaign;

  // ── Actions ────────────────────────────────────────────────────────────
  // « Relancer » ouvre une campagne de la Console (sur la soirée filtrée s'il y en a une).
  const relaunchStep = (_a: RelaunchAsk) => { navigate(f.event ? R.campaignNewForEvent(f.event) : R.campaignNew); };
  const relaunchPerson = (_p: JrPerson) => { navigate(f.event ? R.campaignNewForEvent(f.event) : R.campaignNew); };
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const dup = async (c: JrCampaign) => {
    if (dupBusy) return;
    setDupBusy(true);
    try {
      const id = await duplicateTicketsCampaign(c.id, t('ya.em.tp.copy'));
      setDrawer(null);
      toast(t('ya.jr.dr.dupDone', { name: c.name }));
      if (id) navigate(R.campaignEdit(id));
    } catch {
      toast(t('ya.jr.dr.dupFail'));
    } finally {
      setDupBusy(false);
    }
  };

  const exportCsv = () => {
    if (!d) return;
    const file = `yuno-${t('ya.jr.file')}-${f.campaign ? 'campagne' : f.period}.csv`;
    const cols = [t('ya.jr.csv.kind'), t('ya.jr.csv.name'), t('ya.jr.csv.date'), t('ya.jr.csv.rc'), t('ya.jr.csv.op'), t('ya.jr.csv.ck'), t('ya.jr.csv.b'), t('ya.jr.csv.bk'), t('ya.jr.csv.conv')];
    if (caps.money) cols.push(t('ya.jr.csv.sales'));
    const F = d.funnel;
    const rows: unknown[][] = [[t('ya.jr.csv.funnel'), scope, '', F[0], F[1], F[2], F[3], F[4], F[0] ? Math.round((F[3] / F[0]) * 1000) / 10 : '', ...(caps.money ? [''] : [])]];
    d.campaigns.forEach((c) => rows.push([
      t('ya.jr.csv.campaign'), c.name, c.sent_at.slice(0, 10), c.received, c.opened, c.clicked, c.buyers, c.back,
      Math.round(campConv(c) * 1000) / 10, ...(caps.money ? [c.revenue ?? ''] : []),
    ]));
    downloadCsv(file, cols, rows);
    toast(t('ya.ana.exported', { file }));
  };

  const drawerC = drawer && d ? d.campaigns.find((c) => c.id === drawer) ?? null : null;

  return (
    <div style={{ flex: 1, width: '100%', maxWidth: 1280, boxSizing: 'border-box', margin: '0 auto', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px) 96px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      {pop && <div onClick={() => setPop(null)} style={{ position: 'fixed', inset: 0, zIndex: 19 }} />}

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)', ...reveal(intro, 120) }}>{t('ya.jr.kick')}</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em', ...reveal(intro, 190) }}>
            {t('ya.jr.title.a')}<span className="ya-accent-word">{t('ya.jr.title.accent')}</span>{t('ya.jr.title.b')}
          </h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--ya-sand-600)', textWrap: 'pretty', maxWidth: 700, ...reveal(intro, 260) }}>{t('ya.jr.sub')}</p>
        </div>
        {d?.has_campaigns && (
          <Hv
            as="button"
            type="button"
            onClick={exportCsv}
            style={{ flex: 'none', height: 46, padding: '0 20px 0 16px', borderRadius: 99, background: 'var(--ya-card)', border: '1px solid var(--ya-sand-200)', boxShadow: 'var(--ya-shadow-xs)', color: 'var(--ya-ink)', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', ...reveal(intro, 320, 'background 140ms') }}
            hover={{ borderColor: 'var(--ya-sand-300)', background: 'var(--ya-paper)' }}
            active={{ transform: 'scale(.97)' }}
          >
            <Icon name="download" size={18} stroke={2.2} />{t('ya.ana.export')}
          </Hv>
        )}
      </div>

      {q.isError && !d && (
        <LoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />
      )}

      {!d && !q.isError && <JourneySkeleton />}

      {d && !d.has_campaigns && (
        <section style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 16, padding: 'clamp(24px,3vw,40px)', borderRadius: 28, background: 'repeating-linear-gradient(135deg,var(--ya-sand-50) 0 10px,var(--ya-sand-100) 10px 20px)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200)', ...reveal(intro, 400) }}>
          <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>{t('ya.jr.none.kick')}</span>
          <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(24px,3vw,32px)', letterSpacing: '-.03em', lineHeight: 1.1, textWrap: 'balance', maxWidth: 660 }}>{t('ya.jr.none.title')}</span>
          <span style={{ fontSize: 15.5, lineHeight: 1.5, color: 'var(--ya-sand-600)', maxWidth: 600, textWrap: 'pretty' }}>{t(d.has_connection ? 'ya.jr.none.send' : 'ya.jr.none.connect')}</span>
          {(!d.has_connection || caps.write) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
              <Hv
                as="button"
                type="button"
                onClick={() => navigate(R.campaignNew)}
                style={{ height: 46, padding: '0 22px', borderRadius: 99, border: 0, background: 'var(--ya-ink)', color: 'var(--ya-on-ink)', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
                hover={{ background: 'var(--ya-sand-700)' }}
              >
                {t(d.has_connection ? 'ya.jr.none.ctaWrite' : 'ya.jr.none.ctaConnect')}
              </Hv>
            </div>
          )}
        </section>
      )}

      {d && d.has_campaigns && (
        <>
          <div className={narrow ? undefined : 'ya-filters'} style={{ position: narrow ? 'relative' : 'sticky', zIndex: 21, margin: '0 calc(-1 * clamp(16px,3vw,40px))', padding: '10px clamp(16px,3vw,40px)', background: 'var(--ya-glass)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid var(--ya-sand-100)', ...reveal(intro, 340) }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 12px' }}>
              <div role="group" aria-label={t('ya.ana.f.period')} style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--ya-sand-100)', borderRadius: 99, opacity: f.campaign ? 0.4 : 1, pointerEvents: f.campaign ? 'none' : 'auto', transition: 'opacity 200ms' }}>
                {JR_PERIODS.map((p) => {
                  const on = f.period === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setF({ period: p })}
                      style={{ height: 34, padding: '0 14px', border: 0, borderRadius: 99, background: on ? 'var(--ya-seg-on)' : 'transparent', boxShadow: on ? 'var(--ya-shadow-xs)' : 'none', fontSize: 14, fontWeight: 600, color: on ? 'var(--ya-ink)' : 'var(--ya-sand-600)', cursor: 'pointer', transition: 'background 160ms,color 160ms', whiteSpace: 'nowrap' }}
                    >
                      {t(`ya.ana.per.${p}`)}
                    </button>
                  );
                })}
              </div>
              <FilterDrop label={t('ya.ana.f.night')} value={ev ? ev.title ?? dShort(ev.start_at) : t('ya.jr.f.allF')} options={evOpts} open={pop === 'ev'} onToggle={() => setPop((x) => (x === 'ev' ? null : 'ev'))} width="min(340px, calc(100vw - 32px))" disabled={!!f.campaign} />
              <FilterDrop label={t('ya.jr.f.campaign')} value={campName ?? t('ya.jr.f.allF')} options={campDrop} open={pop === 'camp'} onToggle={() => setPop((x) => (x === 'camp' ? null : 'camp'))} width="min(420px, calc(100vw - 32px))" />
              <FilterDrop label={t('ya.jr.f.channel')} value={f.channel === 'all' ? t('ya.jr.f.allM') : chLabel(f.channel)} options={chDrop} open={pop === 'ch'} onToggle={() => setPop((x) => (x === 'ch' ? null : 'ch'))} width="min(280px, calc(100vw - 32px))" disabled={!!f.campaign} />
              <FilterDrop label={t('ya.jr.f.clients')} value={f.seg === 'all' ? t('ya.jr.f.allM') : segLabel(f.seg)} options={segDrop} open={pop === 'seg'} onToggle={() => setPop((x) => (x === 'seg' ? null : 'seg'))} width="min(320px, calc(100vw - 32px))" />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 500, color: 'var(--ya-sand-700)', cursor: 'pointer', userSelect: 'none', opacity: cmpDisabled ? 0.4 : 1, pointerEvents: cmpDisabled ? 'none' : 'auto' }}>
                <button type="button" role="switch" aria-checked={cmpOn} onClick={() => setF({ cmp: !f.cmp })} style={{ position: 'relative', width: 38, height: 22, padding: 0, border: 0, borderRadius: 99, background: cmpOn ? 'var(--ya-ink)' : 'var(--ya-sand-300)', cursor: 'pointer', transition: 'background 180ms' }}>
                  <span style={{ position: 'absolute', top: 2, left: cmpOn ? 18 : 2, width: 18, height: 18, borderRadius: 99, background: 'var(--ya-card)', boxShadow: 'var(--ya-shadow-xs)', transition: `left 200ms ${SPRING}` }} />
                </button>
                {t('ya.ana.f.cmp')}
              </label>
              {active && (
                <Hv
                  as="button"
                  type="button"
                  onClick={() => setF(DEFAULT)}
                  style={{ height: 34, padding: '0 12px', border: 0, borderRadius: 99, background: 'none', color: 'var(--ya-red-600)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', animation: `ya-pop 260ms ${EASE} both` }}
                  hover={{ background: 'var(--ya-red-50)' }}
                >
                  <Icon name="refresh" size={15} stroke={2.2} />{t('ya.ana.f.reset')}
                </Hv>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--ya-sand-500)' }}>{scope}</span>
            </div>
            {f.campaign && <div style={{ marginTop: 6, fontSize: 13, color: 'var(--ya-sand-500)' }}>{t('ya.jr.f.campNote')}</div>}
          </div>

          {!filled && (
            <section style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 14, padding: 'clamp(24px,3vw,40px)', borderRadius: 28, background: 'repeating-linear-gradient(135deg,var(--ya-sand-50) 0 10px,var(--ya-sand-100) 10px 20px)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200)', animation: `ya-swap-a 400ms ${EASE}` }}>
              <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(22px,2.6vw,28px)', letterSpacing: '-.03em', lineHeight: 1.1, textWrap: 'balance', maxWidth: 560 }}>{t('ya.jr.empty.title')}</span>
              <span style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--ya-sand-600)', maxWidth: 560, textWrap: 'pretty' }}>
                {f.channel === 'sms' ? t('ya.jr.empty.soon') : f.campaign ? t('ya.jr.empty.camp') : t('ya.jr.empty.any')}
              </span>
              <Hv as="button" type="button" onClick={() => setF(DEFAULT)} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: 0, background: 'var(--ya-ink)', color: 'var(--ya-on-ink)', fontSize: 15, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'var(--ya-sand-700)' }}>
                {t('ya.jr.empty.reset')}
              </Hv>
            </section>
          )}

          {filled && (
            <>
              <JourneyKpis d={d} f={f} T={T} cc={cc} intro={intro} />
              <FunnelCard
                d={d} f={f} T={T} g={g} cc={cc} intro={intro} thin={thin}
                sel={sel} onSel={(k) => { setSel(k); setSwap((x) => x + 1); }} swap={swap}
                setF={setF} scope={scope} canWrite={caps.write} onRelaunch={relaunchStep}
              />
              <BeforeBuy ref={s2Ref} d={d} f={f} T={T} a2={a2} style={scrollIn(s2on)} thin={thin} setF={setF} />
              <CampaignRank ref={s3Ref} d={d} f={f} T={T} a3={a3} style={scrollIn(s3on)} thin={thin} money={caps.money} campName={campName} setF={setF} onOpen={setDrawer} />
            </>
          )}

          {d.examples.length > 0 && (
            <CustomerExample ref={s4Ref} d={d} T={T} tl={tl} style={scrollIn(s4on)} canWrite={caps.write} money={caps.money} onPick={() => setPickKey((x) => x + 1)} onRelaunch={relaunchPerson} />
          )}
        </>
      )}

      <CampaignDrawer
        c={drawerC}
        avg={d ? avgConvOf(d.campaigns) : 0}
        T={T}
        canWrite={caps.write}
        busy={dupBusy}
        onClose={closeDrawer}
        onOnly={(id) => { setDrawer(null); setF({ campaign: id, event: null, channel: 'all' }); }}
        onDup={dup}
      />

    </div>
  );
}

function JourneySkeleton() {
  const sk = (h: number | string, w: number | string = '100%', r = 8) => <div className="ya-skel" style={{ height: h, width: w, borderRadius: r }} />;
  return (
    <>
      <div style={{ height: 62 }}>{sk(42, 'min(720px, 100%)', 99)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '20px 22px', borderRadius: 20, background: 'var(--ya-card)', border: '1px solid var(--ya-sand-200)' }}>
            {sk(14, '45%')}{sk(44, '70%', 12)}{sk(13, '55%')}{sk(44)}{sk(12, '80%')}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: 'clamp(20px,2.4vw,32px)', borderRadius: 28, background: 'var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200)' }}>
        {sk(26, 260)}{sk(18, 'min(420px,80%)')}{sk(300, '100%', 20)}{sk(180, '100%', 22)}
      </div>
    </>
  );
}

