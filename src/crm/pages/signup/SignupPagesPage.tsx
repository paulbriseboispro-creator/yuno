/**
 * Clients › Pages d'inscription (`/crm/signup-pages`) — design « Pages
 * inscription », vue LISTE, à l'identique : « Combien de fans attendent vos
 * soirées ? », les quatre chiffres (visites, inscrits, nouveaux dans votre
 * base, devenus acheteurs), le tableau des pages filtrable, « Bon à savoir ».
 * Sans page : les trois étapes et les quatre usages. Les autres vues vivent à
 * côté : assistant (`/new`, `/:id/edit`), page publiée (`/:id/published`),
 * fiche d'une page (`/:id`). Tout est lu dans `crm_signup_pages_list`.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps } from '@/crm/scope';
import { Skel } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useProgress } from '@/crm/ui/motion';
import { useCrmToast } from '@/crm/ui/toast';
import { signupUrl, useSignupPages } from '@/crm/data/signupPages';
import type { SignupPageRow } from '@/crm/data/signupPages';
import { KIND_META, SIGNUP_KINDS, SP_ICON } from '@/crm/signup/model';
import type { SignupKind } from '@/crm/signup/model';
import { D_ARROW, D_CHEV, D_PLUS, SP_CSS, STATE_META, SpSvg, anim, eventDate, useSignupFonts } from './signupUi';
import { pageLife, rowWindow } from './signupLogic';

export const SP_ROUTES = {
  list: '/crm/signup-pages',
  new: (kind?: SignupKind) => `/crm/signup-pages/new${kind ? `?type=${kind}` : ''}`,
  page: (id: string, tab?: string) => `/crm/signup-pages/${id}${tab ? `?tab=${tab}` : ''}`,
  edit: (id: string) => `/crm/signup-pages/${id}/edit`,
  done: (id: string) => `/crm/signup-pages/${id}/published`,
};

/** Le cadre commun des vues (largeur, marges, styles du design). */
export function SpMain({ children }: { children: React.ReactNode }) {
  useSignupFonts();
  return (
    <main className="sp-root" style={{ flex: 1, width: '100%', maxWidth: 1280, boxSizing: 'border-box', margin: '0 auto', padding: 'clamp(24px,3vw,36px) clamp(20px,3vw,40px) 72px', display: 'flex', flexDirection: 'column', gap: 28, fontFamily: 'Geist,system-ui,sans-serif', color: 'var(--ink)' }}>
      <style>{SP_CSS}</style>
      {children}
    </main>
  );
}

export function copyText(txt: string) {
  try { void navigator.clipboard?.writeText(txt); } catch { /* sans presse-papier, le toast suffit */ }
}

/** Le sous-titre d'une page (« Prévente · Sam. 17 oct. »). */
export function pageSub(p: SignupPageRow, t: (k: string) => string, locale: string): string {
  if (p.kind === 'communaute') return t('yc.sp.l.subCommunity');
  const d = p.event ? eventDate(p.event, locale).split(' · ')[0] : t('yc.sp.l.dateTba');
  return `${t(`yc.sp.ty.${p.kind}.label`)} · ${d}`;
}

export default function SignupPagesPage() {
  const T = useCrmT();
  const { t, n, pct, tp } = T;
  const caps = useCrmCaps();
  const nav = useNavigate();
  const toast = useCrmToast();
  const q = useSignupPages();
  const pages = useMemo(() => q.data?.pages ?? [], [q.data]);
  const [filter, setFilter] = useState<'all' | 'open' | 'scheduled' | 'closed'>('all');
  const g = useProgress(1100, 350, q.dataUpdatedAt ? 1 : 0, !!q.data);

  if (q.isError && !q.data) return <SpMain><CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /></SpMain>;

  const V = pages.reduce((a, p) => a + p.visits, 0), N = pages.reduce((a, p) => a + p.n, 0), F = pages.reduce((a, p) => a + p.fresh, 0);
  const withSale = pages.filter((p) => p.buyers != null);
  const B = withSale.reduce((a, p) => a + (p.buyers ?? 0), 0), BN = withSale.reduce((a, p) => a + p.n, 0);
  const TN = pages.reduce((a, p) => a + p.today_n, 0), TV = pages.reduce((a, p) => a + p.today_v, 0);
  const ratio = (a: number, b: number) => (b ? pct((a / b) * 100) : '—');
  const tiles = [
    { l: t('yc.sp.k.visits'), n: n(V * g), def: t('yc.sp.k.visitsDef'), sub: '', today: TV ? t('yc.sp.k.today', { n: n(TV) }) : '', bg: 'var(--sand-50)' },
    { l: t('yc.sp.k.signups'), n: n(N * g), def: t('yc.sp.k.signupsDef'), sub: t('yc.sp.k.ofVisitors', { pct: ratio(N, V) }), today: TN ? t('yc.sp.k.today', { n: n(TN) }) : '', bg: 'var(--sand-50)' },
    { l: t('yc.sp.k.fresh'), n: n(F * g), def: t('yc.sp.k.freshDef'), sub: t('yc.sp.k.ofSignups', { pct: ratio(F, N) }), today: '', bg: 'var(--sand-50)' },
    { l: t('yc.sp.k.buyers'), n: withSale.length ? n(B * g) : '—', def: t('yc.sp.k.buyersDef'), sub: withSale.length ? t('yc.sp.k.buyersSub', { pct: ratio(B, BN) }) : t('yc.sp.k.buyersNone'), today: '', bg: 'var(--red-50)' },
  ];
  const fl: [typeof filter, string, (p: SignupPageRow) => boolean][] = [
    ['all', t('yc.sp.l.f.all'), () => true], ['open', t('yc.sp.l.f.open'), (p) => p.state === 'open'],
    ['scheduled', t('yc.sp.l.f.scheduled'), (p) => p.state === 'scheduled'], ['closed', t('yc.sp.l.f.closed'), (p) => p.state === 'closed'],
  ];
  const shown = pages.filter((fl.find((x) => x[0] === filter) ?? fl[0])[2]);
  const reassure = [['r1b', 'r1t'], ['r2b', 'r2t'], ['r3b', 'r3t']];
  const intro = [1, 2, 3];
  const openNew = (k?: SignupKind) => nav(SP_ROUTES.new(k));

  return (
    <SpMain>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <span style={{ fontFamily: "'Geist Mono'", fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)', animation: anim('sp-in', 700, 100) }}>{t('yc.sp.l.kicker')}</span>
          <h1 style={{ margin: 0, fontFamily: "'Bricolage Grotesque'", fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em', animation: anim('sp-in', 800, 170) }}>
            {t('yc.sp.l.titleA')}<span style={{ background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{t('yc.sp.l.titleB')}</span>{t('yc.sp.l.titleC')}
          </h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--sand-600)', textWrap: 'pretty', maxWidth: 700, animation: anim('sp-in', 800, 240) } as React.CSSProperties}>{t('yc.sp.l.sub')}</p>
        </div>
        {caps.write && (
          <div style={{ animation: anim('sp-in', 800, 300) }}>
            <Hv as="button" type="button" onClick={() => openNew()}
              style={{ height: 46, padding: '0 6px 0 20px', borderRadius: 99, border: 0, background: 'var(--gradient-brand)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, boxShadow: 'var(--shadow-cta)', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'transform 200ms cubic-bezier(.34,1.56,.64,1),filter 160ms' }}
              hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }} active={{ transform: 'scale(.97)' }}>
              {t('yc.sp.l.new')}<span style={{ width: 34, height: 34, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><SpSvg d={D_PLUS} size={16} sw={2.6} /></span>
            </Hv>
          </div>
        )}
      </div>

      {!q.data ? <Skel h={420} r={28} /> : pages.length > 0 ? (
        <>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: 'clamp(20px,2.4vw,30px)', borderRadius: 28, background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)', animation: anim('sp-in', 800, 380) }}>
            <div>
              <h2 style={{ margin: 0, fontFamily: "'Bricolage Grotesque'", fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.sp.l.sumT')}</h2>
              <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.sp.l.sumS')}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,230px),1fr))', gap: 12 }}>
              {tiles.map((x) => <Tile key={x.l} {...x} />)}
            </div>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: anim('sp-in', 800, 460) }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px 20px' }}>
              <div>
                <h2 style={{ margin: 0, fontFamily: "'Bricolage Grotesque'", fontWeight: 600, fontSize: 24, letterSpacing: '-.03em' }}>{t('yc.sp.l.pagesT')}</h2>
                <div style={{ fontSize: 14, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.sp.l.pagesS')}</div>
              </div>
              <div role="group" aria-label={t('yc.sp.l.filter')} style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--sand-100)', borderRadius: 99 }}>
                {fl.map(([k, l, pred]) => {
                  const on = filter === k;
                  return (
                    <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={on}
                      style={{ height: 34, padding: '0 14px', border: 0, borderRadius: 99, background: on ? '#fff' : 'transparent', boxShadow: on ? 'var(--shadow-xs)' : 'none', fontSize: 14, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--sand-600)', cursor: 'pointer' }}>
                      {l}<span style={{ marginLeft: 6, fontWeight: 500, color: 'var(--sand-500)' }}>{pages.filter(pred).length}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ borderRadius: 24, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', overflow: 'hidden' }}>
              <div className="sp-row sp-head" style={{ padding: '12px 22px', background: 'var(--sand-50)', borderBottom: '1px solid var(--sand-100)', fontFamily: "'Geist Mono'", fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>
                <span>{t('yc.sp.l.h.page')}</span><span>{t('yc.sp.l.h.status')}</span><span>{t('yc.sp.l.h.visits')}</span><span>{t('yc.sp.l.h.signups')}</span><span>{t('yc.sp.l.h.buyers')}</span><span />
              </div>
              {shown.map((p, i) => {
                const m = STATE_META[p.state];
                const none = !p.n;
                const life = pageLife(p, t, tp, T);
                const open = () => nav(SP_ROUTES.page(p.id));
                return (
                  <Hv key={p.id} as="div" role="button" tabIndex={0} onClick={open} onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); open(); } }}
                    className="sp-row" style={{ padding: '16px 22px', borderTop: '1px solid var(--sand-100)', cursor: 'pointer', animation: anim('sp-in', 600, 480 + i * 70) }}
                    hover={{ background: 'var(--sand-50)' }}>
                    <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 14 }}>
                      <span style={{ flex: 'none', width: 48, height: 48, borderRadius: 14, background: 'var(--sand-100)', color: 'var(--sand-700)', display: 'grid', placeItems: 'center' }}><SpSvg d={SP_ICON[KIND_META[p.kind].icon]} size={21} sw={2} /></span>
                      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <b style={{ fontSize: 16, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title || t('yc.sp.w.nightNone')}</b>
                        <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{pageSub(p, t, T.locale)}</span>
                      </span>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                      <span style={{ height: 26, padding: '0 11px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, background: m.bg, color: m.fg }}>
                        <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor', animation: m.pulse }} />{t(m.k)}
                      </span>
                      <span style={{ fontSize: 12.5, lineHeight: 1.35, color: 'var(--sand-500)' }}>{rowWindow(p, life, t)}</span>
                    </span>
                    <Num v={none ? '—' : n(p.visits)} c={none ? 'var(--sand-400)' : 'var(--ink)'} lab={t('yc.sp.l.h.visits')} />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <b style={numStyle(none ? 'var(--sand-400)' : 'var(--ink)')}>{none ? '—' : n(p.n)}</b>
                      <span className="sp-lab" style={{ fontSize: 12, color: 'var(--sand-500)' }}>{t('yc.sp.l.h.signups')}</span>
                      {p.kind === 'venue' && p.persons ? <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{t('yc.sp.l.persons', { n: n(p.persons) })}</span> : null}
                      {p.today_n ? <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--green-700)' }}>▲ {n(p.today_n)}</span> : null}
                    </span>
                    <span title={p.buyers != null ? '' : p.kind === 'venue' ? t('yc.sp.l.noSaleList') : t('yc.sp.l.noSaleYet')} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <b style={numStyle(p.buyers ? 'var(--ink)' : 'var(--sand-400)')}>{p.buyers != null ? n(p.buyers) : '—'}</b>
                      <span className="sp-lab" style={{ fontSize: 12, color: 'var(--sand-500)' }}>{t('yc.sp.l.h.buyers')}</span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                      <Hv as="button" type="button" title={t('yc.sp.l.copy')} aria-label={t('yc.sp.l.copy')}
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); copyText(signupUrl(p.slug)); toast(t('yc.sp.copied')); }}
                        style={{ width: 36, height: 36, border: 0, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
                        hover={{ background: 'var(--sand-200)', color: 'var(--ink)' }}>
                        <SpSvg d={SP_ICON.link} size={16} sw={2.2} />
                      </Hv>
                      <SpSvg d={D_CHEV} size={18} sw={2.4} color="var(--sand-400)" />
                    </span>
                  </Hv>
                );
              })}
              {shown.length === 0 && <div style={{ padding: '40px 24px', textAlign: 'center', fontSize: 15, color: 'var(--sand-600)', borderTop: '1px solid var(--sand-100)' }}>{t('yc.sp.l.noRows')}</div>}
            </div>
          </section>

          <aside style={{ position: 'relative', overflow: 'hidden', isolation: 'isolate', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 20, padding: 28, borderRadius: 28, color: 'var(--text-on-night)', background: 'radial-gradient(90% 70% at 100% 110%,rgba(227,20,27,.38),transparent 65%),radial-gradient(60% 45% at 0% 0%,rgba(255,107,53,.14),transparent 70%),var(--noise-night),var(--night)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)', animation: anim('sp-in', 800, 560) }}>
            <span style={{ fontFamily: "'Geist Mono'", fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-on-night-2)' }}>{t('yc.sp.l.good')}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,280px),1fr))', gap: '20px 32px' }}>
              {reassure.map(([b, x]) => (
                <div key={b} style={{ display: 'flex', gap: 14 }}>
                  <span style={{ flex: 'none', width: 28, height: 28, borderRadius: 99, background: 'rgba(255,255,255,.1)', boxShadow: 'inset 0 0 0 1px var(--border-night)', display: 'grid', placeItems: 'center', color: '#7CE0A2' }}><SpSvg d="M5 12l5 5L20 7" size={14} sw={2.6} /></span>
                  <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--text-on-night-2)', textWrap: 'pretty' } as React.CSSProperties}><b style={{ fontWeight: 600, color: '#fff' }}>{t(`yc.sp.l.${b}`)}</b> {t(`yc.sp.l.${x}`)}</span>
                </div>
              ))}
            </div>
          </aside>
        </>
      ) : (
        <>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 22, padding: 'clamp(22px,3vw,36px)', borderRadius: 28, background: 'repeating-linear-gradient(135deg,var(--sand-50) 0 10px,var(--sand-100) 10px 20px)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', animation: anim('sp-in', 800, 380) }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 22px' }}>
              <YunitFace mood="ravi" size={60} />
              <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontFamily: "'Geist Mono'", fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.sp.l.emptyK')}</span>
                <span style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 600, fontSize: 'clamp(24px,3vw,30px)', letterSpacing: '-.03em', lineHeight: 1.1, textWrap: 'balance' } as React.CSSProperties}>{t('yc.sp.l.emptyT')}</span>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,230px),1fr))', gap: 12 }}>
              {intro.map((i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 20, borderRadius: 20, background: '#fff', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--sand-200)' }}>
                  <span style={{ fontFamily: "'Geist Mono'", fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t(`yc.sp.l.i${i}k`)}</span>
                  <b style={{ fontSize: 16.5, letterSpacing: '-.01em', lineHeight: '21px' }}>{t(`yc.sp.l.i${i}t`)}</b>
                  <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' } as React.CSSProperties}>{t(`yc.sp.l.i${i}s`)}</span>
                </div>
              ))}
            </div>
          </section>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: anim('sp-in', 800, 460) }}>
            <div>
              <h2 style={{ margin: 0, fontFamily: "'Bricolage Grotesque'", fontWeight: 600, fontSize: 24, letterSpacing: '-.03em' }}>{t('yc.sp.l.occT')}</h2>
              <div style={{ fontSize: 14, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.sp.l.occS')}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,270px),1fr))', gap: 14 }}>
              {SIGNUP_KINDS.map((k) => (
                <Hv key={k} as="button" type="button" onClick={() => (caps.write ? openNew(k) : undefined)} disabled={!caps.write}
                  style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 20, borderRadius: 22, background: '#fff', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--sand-200)', textAlign: 'left', cursor: caps.write ? 'pointer' : 'default', color: 'var(--ink)', transition: 'translate 240ms cubic-bezier(.22,1,.36,1),box-shadow 240ms,border-color 200ms' }}
                  hover={{ translate: '0 -4px', boxShadow: 'var(--shadow-md)', borderColor: 'var(--sand-300)' }} active={{ transform: 'scale(.985)' }}>
                  <span style={{ width: 44, height: 44, borderRadius: 13, background: 'var(--ink)', color: '#fff', display: 'grid', placeItems: 'center' }}><SpSvg d={SP_ICON[KIND_META[k].icon]} size={20} sw={2} /></span>
                  <b style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 600, fontSize: 20, letterSpacing: '-.02em' }}>{t(`yc.sp.ty.${k}.label`)}</b>
                  <span style={{ fontSize: 14.5, lineHeight: 1.4, color: 'var(--ink)', fontWeight: 500, textWrap: 'pretty' } as React.CSSProperties}>« {t(`yc.sp.ty.${k}.promise`)} »</span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' } as React.CSSProperties}>{t(`yc.sp.ty.${k}.use`)}</span>
                  <span style={{ marginTop: 'auto', paddingTop: 10, borderTop: '1px solid var(--sand-100)', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: 'var(--red-600)' }}>
                    {t('yc.sp.l.createThis')}<SpSvg d={D_ARROW} size={15} sw={2.4} />
                  </span>
                </Hv>
              ))}
            </div>
          </section>
        </>
      )}
    </SpMain>
  );
}

const numStyle = (c: string): React.CSSProperties => ({ fontFamily: "'Bricolage Grotesque'", fontWeight: 600, fontSize: 22, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', color: c });

function Num({ v, c, lab }: { v: string; c: string; lab: string }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <b style={numStyle(c)}>{v}</b>
      <span className="sp-lab" style={{ fontSize: 12, color: 'var(--sand-500)' }}>{lab}</span>
    </span>
  );
}

/** Une tuile chiffrée (liste et Résultats). */
export function Tile({ l, n, def, sub, today, bg }: { l: string; n: string; def: string; sub: string; today: string; bg: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '18px 18px 16px', borderRadius: 20, background: bg, minWidth: 0 }}>
      <span style={{ fontSize: 15, fontWeight: 600 }}>{l}</span>
      <span style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 600, fontSize: 42, lineHeight: 1.05, letterSpacing: '-.04em', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
      <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--sand-500)' }}>{def}</span>
      {sub && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--sand-700)' }}>{sub}</span>}
      {today && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--green-700)' }}>{today}</span>}
    </div>
  );
}
