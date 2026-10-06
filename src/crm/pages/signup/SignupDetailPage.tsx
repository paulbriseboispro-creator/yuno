/**
 * Pages d'inscription › la fiche d'une page (`/crm/signup-pages/:id?tab=`) —
 * design « Pages inscription », vue FICHE, à l'identique : en-tête (type et
 * date, titre, statut, Voir la page / Modifier / Fermer-Publier-Rouvrir), la
 * barre de vie (ouverte le…, se ferme…, prochaine étape), et quatre onglets :
 * Résultats, Partager, Inscrits, Relance. Chiffres : `crm_signup_pages_list`
 * (la ligne) et `crm_signup_page_detail` (séries, provenance, inscrits, relance).
 */
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps, useCrmScope } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { Skel } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { clamp01, useProgress } from '@/crm/ui/motion';
import { useCrmToast } from '@/crm/ui/toast';
import { rpcCode, signupUrl, useSignupDetail, useSignupMutations, useSignupPages } from '@/crm/data/signupPages';
import type { SignupDetail, SignupPageRow } from '@/crm/data/signupPages';
import { PLACES, SP_ICON, SRC_ORDER, dt } from '@/crm/signup/model';
import { SP_ROUTES, SpMain, Tile, copyText } from './SignupPagesPage';
import { BackLink, D_ARROW, STATE_META, Seg, SpSvg, anim, eventDate, monoLabel } from './signupUi';
import { pageLife } from './signupLogic';
import { SignupPreview } from './SignupDonePage';
import { QrSvg, downloadQr } from './SignupQr';
import SignupWho from './SignupWho';
import SignupRelanceTab from './SignupRelance';
import { AiPreparedBadge, AiProposalCard } from './SignupAiProposal';

type Tab = 'res' | 'share' | 'who' | 'rel';
const TABS: Tab[] = ['res', 'share', 'who', 'rel'];

export default function SignupDetailPage() {
  const { id = '' } = useParams();
  const { t } = useCrmT();
  const q = useSignupPages();
  if (q.isError && !q.data) return <SpMain><CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /></SpMain>;
  if (!q.data) return <SpMain><Skel h={640} r={28} /></SpMain>;
  const page = q.data.pages.find((p) => p.id === id);
  if (!page) return <SpMain><b>{t('yc.sp.f.notFound')}</b><Link to={SP_ROUTES.list}>{t('yc.sp.back')}</Link></SpMain>;
  return <Detail page={page} canPublish={q.data.can_publish} balance={Number(q.data.balance ?? 0)} />;
}

function Detail({ page: d, canPublish, balance }: { page: SignupPageRow; canPublish: boolean; balance: number }) {
  const T = useCrmT();
  const { t, tp, locale } = T;
  const caps = useCrmCaps();
  const { space } = useCrmScope();
  const nav = useNavigate();
  const toast = useCrmToast();
  const m = useSignupMutations();
  const detail = useSignupDetail(d.id);
  const [sp, setSp] = useSearchParams();
  const tab: Tab = (TABS as string[]).includes(sp.get('tab') ?? '') ? (sp.get('tab') as Tab) : 'res';
  const [pv, setPv] = useState(false);
  const g = useProgress(1000, 200, tab === 'res' ? `${d.id}-${detail.dataUpdatedAt ? 1 : 0}` : 0, !!detail.data);
  const life = pageLife(d, t, tp, T);
  const meta = STATE_META[d.state];
  const isOpen = d.state === 'open';
  const stBtnL = isOpen ? t('yc.sp.f.close') : d.state === 'draft' ? t('yc.sp.f.publish') : d.state === 'scheduled' ? t('yc.sp.f.openNow') : t('yc.sp.f.reopen');
  const kicker = t(`yc.sp.ty.${d.kind}.label`) + (d.kind === 'communaute' ? '' : ' · ' + (d.event ? eventDate(d.event, locale).split(' · ')[0] : t('yc.sp.l.dateTba')));
  const setTab = (x: Tab) => { const s = new URLSearchParams(sp); s.set('tab', x); setSp(s, { replace: true }); };

  const tgStatus = () => {
    if (!canPublish) { toast(t('yc.sp.e.owner_only')); return; }
    // Une page préparée par l'IA et jamais relue dans l'assistant n'a pas encore
    // ses messages de relance : on la publie depuis l'assistant, qui les compose.
    if (d.state === 'draft' && !Object.keys(d.relance ?? {}).length) {
      toast(t('yc.sp.ai.reviewFirst'));
      nav(`${SP_ROUTES.edit(d.id)}?review=1`);
      return;
    }
    const status = isOpen ? 'closed' : d.state === 'scheduled' ? 'open' : 'live';
    m.status.mutate({ id: d.id, status }, {
      onSuccess: () => toast(isOpen ? t('yc.sp.f.closedToast') : t('yc.sp.f.openedToast')),
      onError: (e) => { const c = rpcCode(e); toast(['owner_only', 'incomplete', 'closes_in_past', 'support_session'].includes(c) ? t(`yc.sp.e.${c}`) : t('yc.sp.err')); },
    });
  };

  const btn: CSSProperties = { height: 42, padding: '0 18px 0 14px', borderRadius: 99, background: '#fff', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--sand-200)', color: 'var(--ink)', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 };

  return (
    <SpMain>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, animation: anim('sp-in', 700) }}>
        <BackLink label={t('yc.sp.back')} onClick={() => nav(SP_ROUTES.list)} />
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <span style={{ fontFamily: "'Geist Mono'", fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{kicker}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px' }}>
              <h1 style={{ margin: 0, fontFamily: "'Bricolage Grotesque'", fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em' }}>{d.title || t('yc.sp.w.nightNone')}</h1>
              <span style={{ height: 28, padding: '0 12px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, background: meta.bg, color: meta.fg }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor', animation: meta.pulse }} />{t(meta.k)}
              </span>
              {d.ai_author && <AiPreparedBadge author={d.ai_author} />}
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Hv as="button" type="button" onClick={() => setPv(true)} style={btn} hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }}><SpSvg d={SP_ICON.eye} size={16} sw={2.2} />{t('yc.sp.d.view')}</Hv>
            {caps.write && <Hv as="button" type="button" onClick={() => nav(SP_ROUTES.edit(d.id))} style={btn} hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }}><SpSvg d={SP_ICON.pen} size={16} sw={2.2} />{t('yc.sp.f.edit')}</Hv>}
            {caps.write && (
              <Hv as="button" type="button" onClick={tgStatus} disabled={m.status.isPending}
                style={{ height: 42, padding: '0 18px', borderRadius: 99, background: '#fff', borderWidth: 1, borderStyle: 'solid', borderColor: isOpen ? 'var(--red-300)' : 'var(--sand-200)', color: isOpen ? 'var(--red-600)' : 'var(--ink)', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }}
                hover={{ background: 'var(--red-50)' }}>{stBtnL}</Hv>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 22px', borderRadius: 22, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 16px', fontSize: 13.5, fontWeight: 600 }}>
            <span style={{ color: 'var(--ink)' }}>{life.a}</span>
            <span style={{ color: 'var(--sand-600)' }}>{life.b}{life.c && <span style={{ color: 'var(--sand-500)', fontWeight: 500 }}> · {life.c}</span>}</span>
          </div>
          <div style={{ height: 8, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(life.pct * 100 * clamp01(g * 1.4))}%`, height: '100%', borderRadius: 99, background: d.state === 'open' ? 'var(--gradient-brand)' : 'var(--sand-300)' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 14, background: 'var(--red-50)' }}>
            <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)' }} />
            <span style={{ fontSize: 14.5, lineHeight: 1.45, fontWeight: 500, textWrap: 'pretty' } as CSSProperties}>{life.next}</span>
          </div>
        </div>

        {d.ai_proposal && caps.write && <AiProposalCard page={d} host={space.name} logo={space.logoUrl} />}

        <Seg aria={t('yc.sp.f.tabs')} value={tab} onChange={setTab} h={38} fs={14.5} padX={18} wrap style={{ alignSelf: 'flex-start' }}
          items={TABS.map((x) => ({ v: x, l: t(`yc.sp.f.t.${x}`) }))} />

        {detail.isError && !detail.data ? <CrmLoadError error={detail.error} onRetry={() => { void detail.refetch(); }} retrying={detail.isFetching} />
          : !detail.data ? <Skel h={420} r={28} />
          : tab === 'res' ? <ResultsTab d={d} x={detail.data} g={g} />
          : tab === 'share' ? <ShareTab d={d} x={detail.data} />
          : tab === 'who' ? <SignupWho d={d} x={detail.data} />
          : <SignupRelanceTab d={d} x={detail.data} balance={balance} host={space.name} logo={space.logoUrl} />}
      </div>
      {pv && <SignupPreview page={d} host={space.name} logo={space.logoUrl} onClose={() => setPv(false)} />}
    </SpMain>
  );
}

// ── Résultats ─────────────────────────────────────────────────────────────

const SRC_KEY: Record<string, string> = { story: 'story', dm: 'dm', flyer: 'flyer', bar: 'bar', door: 'door', share: 'share', direct: 'direct' };

function ResultsTab({ d, x, g }: { d: SignupPageRow; x: SignupDetail; g: number }) {
  const T = useCrmT();
  const { t, tp, n, pct, n1 } = T;
  const none = !d.n;
  const venue = d.kind === 'venue';
  const ratio = (a: number, b: number) => (b ? pct((a / b) * 100) : '—');
  const t4 = venue
    ? { l: t('yc.sp.k.persons'), n: none ? '—' : n((d.persons ?? 0) * g), def: t('yc.sp.k.personsDef', { n: n(d.n) }), sub: none ? '' : t('yc.sp.k.personsSub', { x: n1((d.persons ?? 0) / Math.max(1, d.n)) }) }
    : { l: t('yc.sp.k.buyers'), n: d.buyers != null ? n(d.buyers * g) : '—', def: d.buyers != null ? t('yc.sp.k.buyersDef') : t('yc.sp.k.buyersNotOpen'), sub: d.buyers ? t('yc.sp.k.ofSignups', { pct: ratio(d.buyers, d.n) }) : '' };
  const tiles = [
    { l: t('yc.sp.k.visits'), n: none ? '—' : n(d.visits * g), def: t('yc.sp.k.visitsDefOne'), sub: '', today: d.today_v ? t('yc.sp.k.today', { n: n(d.today_v) }) : '', bg: 'var(--sand-50)' },
    { l: venue ? t('yc.sp.k.confirmations') : t('yc.sp.k.signups'), n: none ? '—' : n(d.n * g), def: t('yc.sp.k.signupsDef'), sub: none ? '' : t('yc.sp.k.ofVisitors', { pct: ratio(d.n, d.visits) }), today: d.today_n ? t('yc.sp.k.today', { n: n(d.today_n) }) : '', bg: 'var(--sand-50)' },
    { l: t('yc.sp.k.fresh'), n: none ? '—' : n(d.fresh * g), def: t('yc.sp.k.freshDef'), sub: none ? '' : t('yc.sp.k.ofSignups', { pct: ratio(d.fresh, d.n) }), today: '', bg: 'var(--sand-50)' },
    { today: '', bg: 'var(--red-50)', ...t4 },
  ];
  const life = pageLife(d, t, tp, T);
  const resSub = none ? t('yc.sp.f.resNone') : d.state === 'closed' ? t('yc.sp.f.resClosed', { a: life.a }) : t('yc.sp.f.resLive', { a: life.a });
  const ser = x.series.map((s) => s.n);
  const mx = Math.max(1, ...ser);
  const total = ser.reduce((a, b) => a + b, 0);
  const dayL = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(T.locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const noDataTxt = d.state === 'scheduled' ? t('yc.sp.f.noDataSch', { d: dt(d.opens_at, T.locale) }) : d.state === 'draft' ? t('yc.sp.f.noDataDraft') : t('yc.sp.f.noData');

  // Provenance : familles (Instagram, QR, partage, autres), puis le détail.
  const bySrc = new Map(x.sources.map((s) => [s.src, s]));
  const rows: { l: string; s: string; v: number; n: number; fam: boolean }[] = [];
  (['ig', 'qr', 'share', 'direct'] as const).forEach((fk) => {
    const ch = SRC_ORDER.filter((o) => o.fam === fk).map((o) => ({ src: o.src, ...(bySrc.get(o.src) ?? { v: 0, n: 0 }) })).filter((o) => o.v > 0 || o.n > 0);
    if (!ch.length) return;
    const nest = fk === 'ig' || fk === 'qr';
    rows.push({ l: t(`yc.sp.fam.${fk}`), s: nest ? '' : t(`yc.sp.fam.${fk}S`), v: ch.reduce((a, o) => a + o.v, 0), n: ch.reduce((a, o) => a + o.n, 0), fam: true });
    if (nest) ch.forEach((o) => rows.push({ l: t(`yc.sp.src.${SRC_KEY[o.src]}`), s: o.src === 'dm' && x.ig_auto ? t('yc.sp.f.igAuto', { n: n(x.ig_auto) }) : '', v: o.v, n: o.n, fam: false }));
  });
  const cand = SRC_ORDER.map((o) => ({ ...o, ...(bySrc.get(o.src) ?? { v: 0, n: 0 }) })).filter((o) => o.v >= 80).sort((a, b) => b.n / b.v - a.n / a.v)[0];
  const insight = cand ? (cand.src === 'share' ? t('yc.sp.f.insShare', { p: pct((cand.n / cand.v) * 100) }) : t('yc.sp.f.insBest', { l: t(`yc.sp.src.${SRC_KEY[cand.src]}`).toLowerCase(), p: pct((cand.n / cand.v) * 100) })) : '';
  const h2: CSSProperties = { margin: 0, fontFamily: "'Bricolage Grotesque'", fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' };
  const card: CSSProperties = { display: 'flex', flexDirection: 'column', padding: 'clamp(20px,2.4vw,30px)', borderRadius: 28, boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' };

  return (
    <>
      <section style={{ ...card, gap: 20, background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),#fff' }}>
        <div><h2 style={h2}>{t('yc.sp.f.resT')}</h2><div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{resSub}</div></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))', gap: 12 }}>
          {tiles.map((x2) => <Tile key={x2.l} {...x2} />)}
        </div>
        {ser.length > 0 && !none && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '18px 20px 14px', borderRadius: 20, background: 'var(--sand-50)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 12px' }}>
              <b style={{ fontSize: 15 }}>{t('yc.sp.f.perDay')}</b>
              <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t(venue ? 'yc.sp.f.perDayCapVenue' : 'yc.sp.f.perDayCap', { d: ser.length, n: n(total) })}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 130 }}>
              {x.series.map((s, i) => {
                const last = i === ser.length - 1;
                return (
                  <div key={s.d} title={tp('yc.sp.f.barTip', s.n, { day: dayL(s.d), n: s.n })} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--sand-600)', fontVariantNumeric: 'tabular-nums' }}>{n(s.n * clamp01(g * 1.6 - i * 0.04))}</span>
                    <div style={{ width: '100%', height: `${Math.max(3, (s.n / mx) * 100 * clamp01(g * 1.3 - i * 0.05)).toFixed(1)}%`, minHeight: 4, borderRadius: '7px 7px 3px 3px', background: last ? 'var(--gradient-brand)' : 'color-mix(in srgb,var(--red-500) 28%,#fff)' }} />
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--sand-500)' }}><span>{x.series[0] ? dayL(x.series[0].d) : ''}</span><span>{t('yc.sp.f.today')}</span></div>
          </div>
        )}
        {none && <div style={{ padding: 22, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'var(--sand-300)', textAlign: 'center', fontSize: 14.5, color: 'var(--sand-600)' }}>{noDataTxt}</div>}
      </section>

      {rows.length > 0 && (
        <section style={{ ...card, gap: 16, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
          <div><h2 style={h2}>{t('yc.sp.f.srcT')}</h2><div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.sp.f.srcS')}</div></div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 0 8px', fontFamily: "'Geist Mono'", fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>
              <span style={{ flex: 1 }}>{t('yc.sp.f.h.src')}</span><span style={{ flex: '0 0 70px', textAlign: 'right' }}>{t('yc.sp.f.h.visits')}</span><span style={{ flex: '0 0 70px', textAlign: 'right' }}>{t('yc.sp.f.h.signups')}</span><span style={{ flex: '0 0 64px', textAlign: 'right' }}>{t('yc.sp.f.h.rate')}</span>
            </div>
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: r.fam ? '12px 0' : '8px 0', borderTop: '1px solid var(--sand-100)' }}>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: r.fam ? 0 : 20 }}>
                  <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 8px' }}>
                    <span style={{ fontSize: r.fam ? 15.5 : 14.5, fontWeight: r.fam ? 600 : 500 }}>{r.l}</span>
                    {r.s && <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{r.s}</span>}
                  </span>
                  <span style={{ display: 'block', height: 6, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden', maxWidth: 360 }}>
                    <i style={{ display: 'block', height: '100%', width: `${Math.round((r.n / Math.max(1, d.n)) * 100 * clamp01(g * 1.3))}%`, borderRadius: 99, background: r.fam ? 'var(--ink)' : 'color-mix(in srgb,var(--red-500) 40%,#fff)' }} />
                  </span>
                </span>
                <span style={{ flex: '0 0 70px', textAlign: 'right', fontSize: 14.5, fontVariantNumeric: 'tabular-nums', color: 'var(--sand-600)' }}>{n(r.v)}</span>
                <b style={{ flex: '0 0 70px', textAlign: 'right', fontSize: r.fam ? 15.5 : 14.5, fontVariantNumeric: 'tabular-nums' }}>{n(r.n)}</b>
                <span style={{ flex: '0 0 64px', textAlign: 'right', fontSize: 14.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--sand-700)' }}>{ratio(r.n, r.v)}</span>
              </div>
            ))}
          </div>
          {insight && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 16, background: 'var(--red-50)' }}>
              <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)' }} />
              <span style={{ fontSize: 15, lineHeight: 1.45, fontWeight: 500, textWrap: 'pretty' } as CSSProperties}>{insight}</span>
            </div>
          )}
          <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--sand-500)', textWrap: 'pretty' } as CSSProperties}>{t('yc.sp.f.srcFoot')} <Link to={CRM_ROUTES.instagram} style={{ fontWeight: 600 }}>{t('yc.sp.f.autoReplies')}</Link></span>
        </section>
      )}
    </>
  );
}

// ── Partager ──────────────────────────────────────────────────────────────

function ShareTab({ d, x }: { d: SignupPageRow; x: SignupDetail }) {
  const { t, n } = useCrmT();
  const toast = useCrmToast();
  const [place, setPlace] = useState<(typeof PLACES)[number]['key']>('general');
  const bySrc = new Map(x.sources.map((s) => [s.src, s.n]));
  const pl = PLACES.find((p) => p.key === place) ?? PLACES[0];
  const plUrl = signupUrl(d.slug, pl.src);
  const plLabel = t(`yc.sp.pl.${pl.key}`);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
      <section style={{ flex: '1.2 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: "'Bricolage Grotesque'", fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.sp.f.shareT')}</h2>
          <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.sp.f.shareS')}</div>
        </div>
        {d.state === 'draft' && <div style={{ padding: '12px 16px', borderRadius: 14, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 14 }}>{t('yc.sp.f.draftShare')}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PLACES.map((p) => {
            const on = place === p.key;
            const c = p.src ? (bySrc.get(p.src) ?? 0) : d.n;
            return (
              <Hv key={p.key} as="button" type="button" aria-pressed={on} onClick={() => setPlace(p.key)}
                style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 16, borderWidth: 1.5, borderStyle: 'solid', borderColor: on ? 'var(--red-400)' : 'var(--sand-200)', background: on ? 'var(--red-50)' : '#fff', textAlign: 'left', cursor: 'pointer', color: 'var(--ink)', transition: 'border-color 160ms,background 160ms' }}
                hover={{ borderColor: on ? 'var(--red-400)' : 'var(--sand-400)' }}>
                <span style={{ flex: 'none', width: 40, height: 40, borderRadius: 12, background: on ? '#fff' : 'var(--sand-100)', color: on ? 'var(--red-600)' : 'var(--sand-700)', display: 'grid', placeItems: 'center' }}><SpSvg d={SP_ICON[p.icon]} size={19} sw={2} /></span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <b style={{ fontSize: 15 }}>{t(`yc.sp.pl.${p.key}`)}</b>
                  <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-600)' }}>{t(`yc.sp.pl.${p.key}S`)}</span>
                </span>
                <span style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <b style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 600, fontSize: 20, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{n(c)}</b>
                  <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{t('yc.sp.f.signupsWord')}</span>
                </span>
              </Hv>
            );
          })}
        </div>
        <Link to={CRM_ROUTES.instagram} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: 'var(--red-600)', textDecoration: 'none' }}>
          {t('yc.sp.f.igLink')}<SpSvg d={D_ARROW} size={14} sw={2.4} />
        </Link>
      </section>
      <aside style={{ flex: '1 1 340px', minWidth: 0, position: 'sticky', top: 88, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 24, borderRadius: 28, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', boxSizing: 'border-box' }}>
        <span style={{ ...monoLabel, alignSelf: 'flex-start' }}>{plLabel}</span>
        <span style={{ width: 236, height: 236, padding: 16, boxSizing: 'border-box', borderRadius: 20, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}><QrSvg url={plUrl} size={204} /></span>
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 14px', borderRadius: 14, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', boxSizing: 'border-box' }}>
          <span style={{ flex: 1, minWidth: 0, fontFamily: "'Geist Mono'", fontSize: 13, color: 'var(--ink)', overflowWrap: 'anywhere' }}>{plUrl.replace(/^https?:\/\//, '')}</span>
          <Hv as="button" type="button" onClick={() => { copyText(plUrl); toast(t('yc.sp.copied')); }} style={{ flex: 'none', height: 38, padding: '0 14px', border: 0, borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'var(--sand-700)' }}>{t('yc.sp.d.copy')}</Hv>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
          <Hv as="button" type="button" onClick={() => { void downloadQr(plUrl, `${d.slug}-${pl.key}`).then(() => toast(t('yc.sp.f.dlQrDone', { l: plLabel }))); }}
            style={{ height: 40, padding: '0 16px 0 12px', borderRadius: 99, background: '#fff', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--sand-200)', color: 'var(--ink)', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}
            hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }}><SpSvg d={SP_ICON.dl} size={15} sw={2.2} />{t('yc.sp.f.dlQr')}</Hv>
        </div>
        <span style={{ fontSize: 12.5, lineHeight: 1.4, color: 'var(--sand-500)', textAlign: 'center', textWrap: 'pretty' } as CSSProperties}>{t('yc.sp.f.qrNote', { l: plLabel })}</span>
      </aside>
    </div>
  );
}
