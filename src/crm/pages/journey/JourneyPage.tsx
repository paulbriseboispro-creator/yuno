/**
 * Parcours client (`/crm/journey`) — « Où mes clients s'arrêtent-ils avant
 * d'acheter ? ». Un compte CRM n'a pas de page Yuno : le parcours se lit
 * message par message dans les e-mails envoyés à la main (reçu, ouvert,
 * clic, achat sous 7 jours, retour sous 90 jours). Quatre chiffres, puis
 * l'entonnoir (une étape cliquée dit qui s'arrête, après quel message, et
 * ouvre une relance), les chemins et délais des acheteurs, le classement des
 * campagnes (tiroir de détail) et le fil d'un client réel. Les filtres vivent
 * dans l'adresse (?p=&e=&m=&ch=&s=&cmp=) : un lien partagé rouvre la même
 * lecture.
 */
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE, SPRING, reveal, useIntro } from '@/crm/ui/motion';
import { useCrmToast } from '@/crm/ui/toast';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { ShotgunSoonCard } from '@/crm/components/ShotgunSoon';
import { downloadCsv } from '@/crm/lib/csv';
import { fullName } from '@/crm/lib/lifecycle';
import { useEventsBrief, type ClientFilterDef } from '@/crm/data/clients';
import { useCrmSettings } from '@/crm/data/settings';
import { duplicateCampaigns } from '@/crm/data/emailActions';
import {
  JR_CHANNELS, JR_PERIODS, JR_SEGS, useJourney,
  type JrCampaign, type JrChannel, type JrFilters, type JrPeriod, type JrPerson, type JrSeg,
} from '@/crm/data/journey';
import { WriteModal, type WriteScope } from '@/crm/components/WriteModal';
import { FilterDrop, type DropOption } from './jrUi';
import { avgConvOf, campConv, scrollIn, useInViewOnce, useStaged } from './jrLib';
import { JourneyKpis } from './JourneyKpis';
import { FunnelCard, type RelaunchAsk } from './FunnelCard';
import { BeforeBuy } from './BeforeBuy';
import { CampaignRank } from './CampaignRank';
import { CampaignDrawer } from './CampaignDrawer';
import { CustomerExample } from './CustomerExample';

type Pop = 'ev' | 'camp' | 'ch' | 'seg' | null;
interface WriteAsk { scope: WriteScope; who: string; emails: string[] | null; def: ClientFilterDef | null; eyebrow?: string }

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

export default function JourneyPage() {
  const T = useCrmT();
  const { t, tp, n, dShort } = T;
  const caps = useCrmCaps();
  const toast = useCrmToast();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const f = readFilters(sp);
  const q = useJourney(f);
  const events = useEventsBrief(30);
  const settings = useCrmSettings();
  const intro = useIntro();
  // Sur un téléphone, la barre de filtres replie sur 3-4 lignes : collante, elle
  // cacherait un tiers de l'écran.
  const narrow = useNarrow(720);

  const [pop, setPop] = useState<Pop>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [swap, setSwap] = useState(0);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [write, setWrite] = useState<WriteAsk | null>(null);
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
    const all = events.data ?? [];
    const up = all.filter((x) => x.upcoming).sort((a, b) => a.start_at.localeCompare(b.start_at));
    const past = all.filter((x) => !x.upcoming).sort((a, b) => b.start_at.localeCompare(a.start_at));
    const today = new Date().toDateString();
    return [...up, ...past].map((x) => ({ ...x, tonight: new Date(x.start_at).toDateString() === today }));
  }, [events.data]);
  const ev = f.event ? evList.find((x) => x.id === f.event) ?? null : null;
  const campOpts = d?.options.campaigns ?? [];
  const camp = f.campaign ? campOpts.find((c) => c.id === f.campaign) ?? null : null;
  const campName = camp?.name ?? (f.campaign ? d?.campaigns.find((c) => c.id === f.campaign)?.name ?? null : null);
  const chLabel = (c: JrChannel) => t(`yc.jr.ch.${c === 'all' ? 'email' : c}`);
  const segLabel = (s: JrSeg) => t(`yc.cli.seg.${s}`);

  const scopeParts = [f.campaign ? t('yc.jr.quote', { s: campName ?? '…' }) : t(`yc.ana.per.full.${f.period}`)];
  if (!f.campaign) {
    if (ev) scopeParts.push(ev.title ?? dShort(ev.start_at));
    if (f.channel !== 'all') scopeParts.push(chLabel(f.channel));
  }
  if (f.seg !== 'all') scopeParts.push(segLabel(f.seg).toLowerCase());
  const scope = scopeParts.join(' · ');
  const active = f.period !== '30d' || !!f.event || !!f.campaign || f.channel !== 'all' || f.seg !== 'all' || !f.cmp;
  const thin = !!d && d.funnel[0] > 0 && d.funnel[0] < 100;

  // ── Filtres ────────────────────────────────────────────────────────────
  const rules = settings.data;
  const opt = (key: string, label: string, on: boolean, pick: () => void, extra?: Partial<DropOption>): DropOption => ({ key, label, on, pick, ...extra });
  const evOpts: DropOption[] = [
    opt('all', t('yc.ana.f.allNights'), !f.event, () => setF({ event: null })),
    ...evList.map((x) => opt(x.id, x.title ?? dShort(x.start_at), f.event === x.id, () => setF({ event: x.id }), {
      sub: x.upcoming ? dShort(x.start_at) : `${dShort(x.start_at)} · ${t('yc.ana.state.past')}`,
      tag: x.tonight ? { label: t('yc.ana.state.tonight'), bg: 'var(--red-50)', fg: 'var(--red-700)' } : x.upcoming ? { label: t('yc.ana.state.presale'), bg: 'var(--amber-50)', fg: 'var(--amber-700)' } : undefined,
    })),
  ];
  const campDrop: DropOption[] = [
    opt('all', t('yc.jr.f.allCampaigns'), !f.campaign, () => setF({ campaign: null })),
    ...campOpts.map((c) => opt(c.id, c.name, f.campaign === c.id, () => setF({ campaign: c.id, event: null, channel: 'all' }), {
      sub: t('yc.jr.f.campSub', { ch: t('yc.jr.ch.email'), date: dShort(c.sent_at) }),
    })),
  ];
  const chDrop: DropOption[] = [
    opt('all', t('yc.jr.f.allChannels'), f.channel === 'all', () => setF({ channel: 'all' })),
    opt('email', t('yc.jr.ch.email'), f.channel === 'email', () => setF({ channel: 'email' })),
    ...(['sms', 'ig'] as const).map((c) => opt(c, t(`yc.jr.ch.${c}`), f.channel === c, () => setF({ channel: c }), {
      disabled: f.channel !== c, tag: { label: t('yc.jr.soon'), bg: 'var(--sand-100)', fg: 'var(--sand-600)' },
    })),
  ];
  const segSub = (s: JrSeg) => {
    if (s === 'all') return undefined;
    return t(`yc.cli.seg.${s}.def`, { n: rules?.regular_min_nights ?? 3, m: s === 'end' ? rules?.lapse_months ?? 6 : rules?.regular_window_months ?? 12 });
  };
  const segDrop: DropOption[] = JR_SEGS.map((s) => opt(s, s === 'all' ? t('yc.jr.f.allClients') : segLabel(s), f.seg === s, () => setF({ seg: s }), { sub: segSub(s) }));
  const cmpDisabled = !!f.campaign || f.period === '12m';
  const cmpOn = f.cmp && !f.campaign;

  // ── Actions ────────────────────────────────────────────────────────────
  const relaunchStep = (a: RelaunchAsk) => {
    const def: ClientFilterDef | null = a.emails ? null : a.k === 2 ? { f: { msg: 'clicked_no_buy' } } : { f: { msg: 'never_clicked' } };
    setWrite({ scope: 'filtered', who: tp('yc.jr.pn.who', a.reach, { n: n(a.reach) }), emails: a.emails, def, eyebrow: t('yc.jr.pn.eyebrow', { s: t(`yc.jr.step.${a.k}`) }) });
  };
  const relaunchPerson = (p: JrPerson) => {
    setWrite({ scope: 'one', who: fullName(p.first_name, p.last_name, p.email), emails: [p.email], def: null });
  };
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const dup = async (c: JrCampaign) => {
    if (dupBusy) return;
    setDupBusy(true);
    try {
      const [id] = await duplicateCampaigns([c.id], t('yc.em.tp.copy'));
      setDrawer(null);
      toast(t('yc.jr.dr.dupDone', { name: c.name }));
      if (id) navigate(CRM_ROUTES.emailStudio(id));
    } catch {
      toast(t('yc.jr.dr.dupFail'));
    } finally {
      setDupBusy(false);
    }
  };

  const exportCsv = () => {
    if (!d) return;
    const file = `yuno-${t('yc.jr.file')}-${f.campaign ? 'campagne' : f.period}.csv`;
    const cols = [t('yc.jr.csv.kind'), t('yc.jr.csv.name'), t('yc.jr.csv.date'), t('yc.jr.csv.rc'), t('yc.jr.csv.op'), t('yc.jr.csv.ck'), t('yc.jr.csv.b'), t('yc.jr.csv.bk'), t('yc.jr.csv.conv')];
    if (caps.money) cols.push(t('yc.jr.csv.sales'));
    const F = d.funnel;
    const rows: unknown[][] = [[t('yc.jr.csv.funnel'), scope, '', F[0], F[1], F[2], F[3], F[4], F[0] ? Math.round((F[3] / F[0]) * 1000) / 10 : '', ...(caps.money ? [''] : [])]];
    d.campaigns.forEach((c) => rows.push([
      t('yc.jr.csv.campaign'), c.name, c.sent_at.slice(0, 10), c.received, c.opened, c.clicked, c.buyers, c.back,
      Math.round(campConv(c) * 1000) / 10, ...(caps.money ? [c.revenue ?? ''] : []),
    ]));
    downloadCsv(file, cols, rows);
    toast(t('yc.ana.exported', { file }));
  };

  const drawerC = drawer && d ? d.campaigns.find((c) => c.id === drawer) ?? null : null;

  return (
    <main style={{ flex: 1, width: '100%', maxWidth: 1280, boxSizing: 'border-box', margin: '0 auto', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px) 96px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      {pop && <div onClick={() => setPop(null)} style={{ position: 'fixed', inset: 0, zIndex: 19 }} />}

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)', ...reveal(intro, 120) }}>{t('yc.jr.kick')}</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em', ...reveal(intro, 190) }}>
            {t('yc.jr.title.a')}<span className="yc-accent-word">{t('yc.jr.title.accent')}</span>{t('yc.jr.title.b')}
          </h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--sand-600)', textWrap: 'pretty', maxWidth: 700, ...reveal(intro, 260) }}>{t('yc.jr.sub')}</p>
        </div>
        {d?.has_campaigns && (
          <Hv
            as="button"
            type="button"
            onClick={exportCsv}
            style={{ flex: 'none', height: 46, padding: '0 20px 0 16px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', boxShadow: 'var(--shadow-xs)', color: 'var(--ink)', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', ...reveal(intro, 320, 'background 140ms') }}
            hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }}
            active={{ transform: 'scale(.97)' }}
          >
            <Icon name="download" size={18} stroke={2.2} />{t('yc.ana.export')}
          </Hv>
        )}
      </div>

      {q.isError && !d && (
        <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />
      )}

      {!d && !q.isError && <JourneySkeleton />}

      {d && !d.has_campaigns && (
        <section style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 16, padding: 'clamp(24px,3vw,40px)', borderRadius: 28, background: 'repeating-linear-gradient(135deg,var(--sand-50) 0 10px,var(--sand-100) 10px 20px)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', ...reveal(intro, 400) }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.jr.none.kick')}</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(24px,3vw,32px)', letterSpacing: '-.03em', lineHeight: 1.1, textWrap: 'balance', maxWidth: 660 }}>{t('yc.jr.none.title')}</span>
          <span style={{ fontSize: 15.5, lineHeight: 1.5, color: 'var(--sand-600)', maxWidth: 600, textWrap: 'pretty' }}>{t(d.has_connection ? 'yc.jr.none.send' : 'yc.jr.none.connect')}</span>
          {(!d.has_connection || caps.write) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
              <Hv
                as="button"
                type="button"
                onClick={() => navigate(d.has_connection ? CRM_ROUTES.emailTemplates : CRM_ROUTES.connectors)}
                style={{ height: 46, padding: '0 22px', borderRadius: 99, border: 0, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
                hover={{ background: 'var(--sand-700)' }}
              >
                {t(d.has_connection ? 'yc.jr.none.ctaWrite' : 'yc.jr.none.ctaConnect')}
              </Hv>
            </div>
          )}
        </section>
      )}

      {d && d.has_campaigns && (
        <>
          <div style={{ position: narrow ? 'relative' : 'sticky', top: narrow ? undefined : 64, zIndex: 21, margin: '0 calc(-1 * clamp(16px,3vw,40px))', padding: '10px clamp(16px,3vw,40px)', background: 'rgba(252,250,249,.9)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid var(--sand-100)', ...reveal(intro, 340) }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 12px' }}>
              <div role="group" aria-label={t('yc.ana.f.period')} style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--sand-100)', borderRadius: 99, opacity: f.campaign ? 0.4 : 1, pointerEvents: f.campaign ? 'none' : 'auto', transition: 'opacity 200ms' }}>
                {JR_PERIODS.map((p) => {
                  const on = f.period === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setF({ period: p })}
                      style={{ height: 34, padding: '0 14px', border: 0, borderRadius: 99, background: on ? '#fff' : 'transparent', boxShadow: on ? 'var(--shadow-xs)' : 'none', fontSize: 14, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--sand-600)', cursor: 'pointer', transition: 'background 160ms,color 160ms', whiteSpace: 'nowrap' }}
                    >
                      {t(`yc.ana.per.${p}`)}
                    </button>
                  );
                })}
              </div>
              <FilterDrop label={t('yc.ana.f.night')} value={ev ? ev.title ?? dShort(ev.start_at) : t('yc.jr.f.allF')} options={evOpts} open={pop === 'ev'} onToggle={() => setPop((x) => (x === 'ev' ? null : 'ev'))} width="min(340px, calc(100vw - 32px))" disabled={!!f.campaign} />
              <FilterDrop label={t('yc.jr.f.campaign')} value={campName ?? t('yc.jr.f.allF')} options={campDrop} open={pop === 'camp'} onToggle={() => setPop((x) => (x === 'camp' ? null : 'camp'))} width="min(420px, calc(100vw - 32px))" />
              <FilterDrop label={t('yc.jr.f.channel')} value={f.channel === 'all' ? t('yc.jr.f.allM') : chLabel(f.channel)} options={chDrop} open={pop === 'ch'} onToggle={() => setPop((x) => (x === 'ch' ? null : 'ch'))} width="min(280px, calc(100vw - 32px))" disabled={!!f.campaign} />
              <FilterDrop label={t('yc.jr.f.clients')} value={f.seg === 'all' ? t('yc.jr.f.allM') : segLabel(f.seg)} options={segDrop} open={pop === 'seg'} onToggle={() => setPop((x) => (x === 'seg' ? null : 'seg'))} width="min(320px, calc(100vw - 32px))" />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 500, color: 'var(--sand-700)', cursor: 'pointer', userSelect: 'none', opacity: cmpDisabled ? 0.4 : 1, pointerEvents: cmpDisabled ? 'none' : 'auto' }}>
                <button type="button" role="switch" aria-checked={cmpOn} onClick={() => setF({ cmp: !f.cmp })} style={{ position: 'relative', width: 38, height: 22, padding: 0, border: 0, borderRadius: 99, background: cmpOn ? 'var(--ink)' : 'var(--sand-300)', cursor: 'pointer', transition: 'background 180ms' }}>
                  <span style={{ position: 'absolute', top: 2, left: cmpOn ? 18 : 2, width: 18, height: 18, borderRadius: 99, background: '#fff', boxShadow: 'var(--shadow-xs)', transition: `left 200ms ${SPRING}` }} />
                </button>
                {t('yc.ana.f.cmp')}
              </label>
              {active && (
                <Hv
                  as="button"
                  type="button"
                  onClick={() => setF(DEFAULT)}
                  style={{ height: 34, padding: '0 12px', border: 0, borderRadius: 99, background: 'none', color: 'var(--red-600)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', animation: `yc-pop 260ms ${EASE} both` }}
                  hover={{ background: 'var(--red-50)' }}
                >
                  <Icon name="refresh" size={15} stroke={2.2} />{t('yc.ana.f.reset')}
                </Hv>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--sand-500)' }}>{scope}</span>
            </div>
            {f.campaign && <div style={{ marginTop: 6, fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.jr.f.campNote')}</div>}
          </div>

          {!filled && (
            <section style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 14, padding: 'clamp(24px,3vw,40px)', borderRadius: 28, background: 'repeating-linear-gradient(135deg,var(--sand-50) 0 10px,var(--sand-100) 10px 20px)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', animation: `yc-swap-a 400ms ${EASE}` }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(22px,2.6vw,28px)', letterSpacing: '-.03em', lineHeight: 1.1, textWrap: 'balance', maxWidth: 560 }}>{t('yc.jr.empty.title')}</span>
              <span style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--sand-600)', maxWidth: 560, textWrap: 'pretty' }}>
                {f.channel === 'sms' || f.channel === 'ig' ? t('yc.jr.empty.soon') : f.campaign ? t('yc.jr.empty.camp') : t('yc.jr.empty.any')}
              </span>
              <Hv as="button" type="button" onClick={() => setF(DEFAULT)} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: 0, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'var(--sand-700)' }}>
                {t('yc.jr.empty.reset')}
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
              <ShotgunSoonCard items={['page', 'curious', 'carts']} />
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

      {write && (
        <WriteModal
          open
          onClose={() => setWrite(null)}
          scope={write.scope}
          who={write.who}
          emails={write.emails}
          def={write.def}
          eyebrow={write.eyebrow}
          eventId={f.event}
        />
      )}
    </main>
  );
}

function JourneySkeleton() {
  const sk = (h: number | string, w: number | string = '100%', r = 8) => <div className="yc-skel" style={{ height: h, width: w, borderRadius: r }} />;
  return (
    <>
      <div style={{ height: 62 }}>{sk(42, 'min(720px, 100%)', 99)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '20px 22px', borderRadius: 20, background: '#fff', border: '1px solid var(--sand-200)' }}>
            {sk(14, '45%')}{sk(44, '70%', 12)}{sk(13, '55%')}{sk(44)}{sk(12, '80%')}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: 'clamp(20px,2.4vw,32px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
        {sk(26, 260)}{sk(18, 'min(420px,80%)')}{sk(300, '100%', 20)}{sk(180, '100%', 22)}
      </div>
    </>
  );
}

