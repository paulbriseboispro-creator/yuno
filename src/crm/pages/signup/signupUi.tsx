/**
 * Briques des écrans Pages d'inscription, recopiées du design (« Pages
 * inscription.dc.html ») : sélecteur en pastilles sur fond sable, interrupteur,
 * lien retour, icône au tracé du design, statuts, et le passage d'une page
 * (ligne de la base) à la configuration de la page du fan.
 */
import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { signupUrl } from '@/crm/data/signupPages';
import type { PageState, SignupEvent, SignupPageRow } from '@/crm/data/signupPages';
import type { FanCfg } from '@/crm/signup/FanPage';
import {
  DEFAULT_DESIGN, SIGNUP_FONTS_HREF, SP_ICON, defaultReward, dt, normalizeDesign, normalizeFields, venueOf,
} from '@/crm/signup/model';
import type { SignupKind, SignupReward } from '@/crm/signup/model';

export const SP_CSS = `@keyframes sp-in{from{opacity:0;transform:translateY(18px);filter:blur(6px)}to{opacity:1;transform:none;filter:blur(0)}}@keyframes sp-pop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}@keyframes sp-pulse{0%,100%{opacity:1}50%{opacity:.3}}.sp-row{display:grid;grid-template-columns:minmax(0,1fr) 190px 84px 96px 84px 78px;gap:12px 16px;align-items:center}.sp-lab{display:none}@media (max-width:1260px){.sp-row{grid-template-columns:repeat(3,minmax(0,1fr))}.sp-row>:nth-child(1){grid-column:1/-1}.sp-row>:nth-child(2){grid-column:1/3}.sp-row>:nth-child(6){grid-column:3;grid-row:2;justify-content:flex-end}.sp-head{display:none!important}.sp-lab{display:block}}@media (prefers-reduced-motion:reduce){.sp-root *{animation-duration:1ms!important;animation-delay:0ms!important;transition-duration:1ms!important}}.sp-root input::placeholder,.sp-root textarea::placeholder{color:var(--sand-400)}.sp-root a{color:var(--red-600);text-decoration:none}.sp-root a:hover{color:var(--red-700);text-decoration:underline}`;

export const EASE_OUT = 'cubic-bezier(.22,1,.36,1)';
export const anim = (name: 'sp-in' | 'sp-pop', ms: number, delay = 0) => `${name} ${ms}ms ${EASE_OUT} ${delay}ms both`;

/** Les polices des gabarits (Anton, Archivo Black, DM Serif Display, Space Grotesk, Space Mono). */
export function useSignupFonts() {
  useEffect(() => {
    if (document.getElementById('yc-signup-fonts')) return;
    const l = document.createElement('link');
    l.id = 'yc-signup-fonts'; l.rel = 'stylesheet'; l.href = SIGNUP_FONTS_HREF;
    document.head.appendChild(l);
  }, []);
}

export function SpSvg({ d, size = 16, sw = 2.2, color = 'currentColor', style }: { d: string; size?: number; sw?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden>
      <path d={d} />
    </svg>
  );
}

export const D_ARROW = 'M5 12h14M13 6l6 6-6 6';
export const D_BACK = 'm15 18-6-6 6-6';
export const D_TICK = 'M20 6 9 17l-5-5';
export const D_PLUS = 'M12 5v14M5 12h14';
export const D_X = 'M18 6 6 18M6 6l12 12';
export const D_CHEV = 'm9 6 6 6-6 6';
export const D_DOWN = 'm6 9 6 6 6-6';

/** Le sélecteur en pastilles du design (fond sable, pastille blanche ombrée). */
export function Seg<T extends string>({ items, value, onChange, aria, h = 34, fs = 14, padX = 14, radius = 99, wrap = false, style }: {
  items: { v: NoInfer<T>; l: ReactNode; c?: ReactNode }[]; value: T; onChange: (v: NoInfer<T>) => void; aria: string;
  h?: number; fs?: number; padX?: number; radius?: number; wrap?: boolean; style?: CSSProperties;
}) {
  return (
    <div role="group" aria-label={aria} style={{ display: 'inline-flex', flexWrap: wrap ? 'wrap' : undefined, padding: 3, gap: 2, background: 'var(--sand-100)', borderRadius: radius, ...style }}>
      {items.map((it) => {
        const on = it.v === value;
        return (
          <button key={it.v} type="button" onClick={() => onChange(it.v)} aria-pressed={on}
            style={{ whiteSpace: 'nowrap', height: h, padding: `0 ${padX}px`, border: 0, borderRadius: 99, background: on ? '#fff' : 'transparent', boxShadow: on ? 'var(--shadow-xs)' : 'none', fontSize: fs, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--sand-600)', cursor: 'pointer', transition: 'background 160ms,color 160ms' }}>
            {it.l}{it.c !== undefined && <span style={{ marginLeft: 6, fontWeight: 500, color: 'var(--sand-500)' }}>{it.c}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** L'interrupteur 44 × 26 du design (noir allumé, sable éteint). */
export function Knob({ on, green = false }: { on: boolean; green?: boolean }) {
  return (
    <span style={{ flex: 'none', position: 'relative', width: 44, height: 26, borderRadius: 99, background: on ? (green ? 'var(--green-500)' : 'var(--ink)') : 'var(--sand-300)', transition: 'background 180ms' }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 99, background: '#fff', boxShadow: '0 1px 3px rgba(28,21,23,.25)', transition: 'left 200ms cubic-bezier(.34,1.56,.64,1)' }} />
    </span>
  );
}

/** Une ligne réglage → interrupteur (« Afficher le nombre d'inscrits », « Offrir une récompense »…). */
export function SwitchRow({ on, onClick, title, sub }: { on: boolean; onClick: () => void; title: ReactNode; sub: ReactNode }) {
  return (
    <Hv as="button" type="button" role="switch" aria-checked={on} onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', border: 0, borderRadius: 14, background: 'var(--sand-50)', textAlign: 'left', cursor: 'pointer', width: '100%', transition: 'background 160ms' }}
      hover={{ background: 'var(--sand-100)' }}>
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>{title}</span>
        <span style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--sand-600)' }}>{sub}</span>
      </span>
      <Knob on={on} />
    </Hv>
  );
}

export function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div>
      <Hv as="button" type="button" onClick={onClick}
        style={{ height: 36, padding: '0 14px 0 8px', border: 0, borderRadius: 99, background: 'none', color: 'var(--sand-600)', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
        hover={{ background: 'var(--sand-100)', color: 'var(--ink)' }}>
        <SpSvg d={D_BACK} size={16} sw={2.4} />{label}
      </Hv>
    </div>
  );
}

export const monoLabel: CSSProperties = { fontFamily: "'Geist Mono'", fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' };
export const inputBase: CSSProperties = { height: 50, boxSizing: 'border-box', padding: '0 16px', borderRadius: 12, borderWidth: 1.5, borderStyle: 'solid', borderColor: 'var(--sand-200)', background: '#fff', fontSize: 16, color: 'var(--ink)', outline: 0, width: '100%', transition: 'border-color 160ms,box-shadow 160ms' };
export const focusOn = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = 'var(--red-400)'; e.currentTarget.style.boxShadow = 'var(--focus-ring)'; };
export const focusOff = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = 'var(--sand-200)'; e.currentTarget.style.boxShadow = 'none'; };

/** Statut d'une page : libellé, fond, encre, pulsation. */
export const STATE_META: Record<PageState, { k: string; bg: string; fg: string; pulse: string }> = {
  open: { k: 'yc.sp.st.open', bg: 'var(--green-50)', fg: 'var(--green-700)', pulse: 'sp-pulse 1.6s ease-in-out infinite' },
  scheduled: { k: 'yc.sp.st.scheduled', bg: 'var(--sand-100)', fg: 'var(--sand-600)', pulse: 'none' },
  closed: { k: 'yc.sp.st.closed', bg: 'var(--sand-100)', fg: 'var(--sand-600)', pulse: 'none' },
  draft: { k: 'yc.sp.st.draft', bg: 'var(--amber-50)', fg: 'var(--amber-700)', pulse: 'none' },
};

export const cap1 = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** « Sam. 17 oct. · 23:00 » : la date d'une soirée dans son fuseau. */
export function eventDate(ev: Pick<SignupEvent, 'start_at' | 'tz'> | null, locale: string): string {
  return ev ? cap1(dt(ev.start_at, locale, ev.tz)) : '';
}

/** « Le Bunker · Paris 11e » : le lieu d'une soirée. */
export function eventPlace(ev: SignupEvent | null, host: string): string {
  if (!ev) return host;
  return [ev.venue || host, ev.city].filter(Boolean).join(' · ');
}

type T = (key: string, vars?: Record<string, string | number | null | undefined>) => string;

/** La récompense d'une page, toujours complète (une page d'avant n'en a pas). */
export function rewardOfPage(p: Pick<SignupPageRow, 'reward' | 'kind'>): SignupReward {
  return p.reward ? { ...defaultReward(p.kind), ...p.reward } : defaultReward(p.kind);
}

/** La configuration de la page du fan pour une page enregistrée. */
export function pageCfg(p: SignupPageRow, host: string, t: T, locale: string): FanCfg {
  const ev = p.event;
  return {
    kind: p.kind,
    title: p.title || t('yc.sp.w.nightNone'),
    sub: p.tagline,
    btn: p.button_label || t(`yc.sp.ty.${p.kind}.btn1`),
    noted: p.thanks_message || t(`yc.sp.ty.${p.kind}.noted`),
    design: normalizeDesign(p.design ?? DEFAULT_DESIGN),
    poster: p.poster_url || ev?.cover_url || null,
    club: host,
    date: p.kind === 'communaute' ? null : ev ? eventDate(ev, locale) : t('yc.sp.w.nightNoneD'),
    place: eventPlace(ev, host),
    fields: normalizeFields(p.fields),
    reward: rewardOfPage(p),
    saleAt: p.kind === 'prevente' ? p.sale_opens_at : null,
    countdown: p.countdown,
    showCount: p.show_count,
    count: p.n,
    full: p.kind === 'attente' && !!ev?.sold_out,
    ticketUrl: ev?.ticket_url ?? null,
    opensAt: p.opens_at,
    pageUrl: signupUrl(p.slug),
    eventStart: ev?.start_at ?? null,
    eventEnd: ev?.end_at ?? null,
    country: ev?.country ?? null,
  };
}

/** Variables des textes par type (« {title} », « au Bunker », « du Bunker », la récompense). */
export function textVars(kind: SignupKind, title: string, host: string, reward: string, lang: 'en' | 'fr' | 'es', at: string) {
  void kind;
  return { title, club: host, of: venueOf(host, lang), at, reward };
}

export { SP_ICON };
