/**
 * Route publique d'une Page d'inscription : `/j/<slug>` (`?src=` = provenance
 * du lien ou du QR) et sa confirmation `/j/<slug>/ok?t=<jeton>`. Hors de toute
 * coquille ; aucune session n'est demandée au fan. La page est la MÊME
 * `FanPage` que les aperçus de la Console (`mode="live"`), dans le gabarit et
 * les couleurs choisis par le pro. Les appels passent par les RPC anonymes
 * (get_crm_signup_page, track_crm_signup_visit, submit_crm_signup,
 * crm_signup_confirm). Pas `/p/<slug>` : c'est le linktree des agences.
 */
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { rpc } from '@/crm/lib/rpc';
import { useLocaleSection } from '@/contexts/LanguageContext';
import { useCrmT } from '@/crm/i18n';
import FanPage from './FanPage';
import type { FanCfg, FanScene, FanSubmit, SubmitResult } from './FanPage';
import { SIGNUP_FONTS_HREF, defaultReward, dt, normalizeDesign, normalizeFields } from './model';
import type { SignupDesign, SignupFields, SignupKind, SignupReward } from './model';
import { pageTokens } from './custom';
import type { CustomDesign } from './custom';

interface PublicPage {
  id: string; slug: string; kind: SignupKind; title: string; tagline: string; button_label: string; thanks_message: string;
  poster_url: string | null; design: SignupDesign; fields: SignupFields; reward: SignupReward | null;
  opens_at: string | null; sale_opens_at: string | null; countdown: boolean; close_at: string | null;
  state: 'open' | 'soon' | 'closed'; count: number | null; demo: boolean; host: string;
  /** Design sur mesure (MCP) : remplace le gabarit quand il existe. */
  custom_design?: CustomDesign | null;
  brand?: { logo?: string | null; city?: string | null; instagram?: string | null } | null;
  event: { title: string; start_at: string; end_at: string; tz: string; ticket_url: string | null; cover_url: string | null; venue: string | null; city: string | null; country: string | null; sold_out: boolean } | null;
}

function useFonts() {
  useEffect(() => {
    if (document.getElementById('yc-signup-fonts')) return;
    const l = document.createElement('link');
    l.id = 'yc-signup-fonts'; l.rel = 'stylesheet'; l.href = SIGNUP_FONTS_HREF;
    document.head.appendChild(l);
  }, []);
}

function Shell({ children, bg = '#0A0A0A' }: { children: React.ReactNode; bg?: string }) {
  useEffect(() => {
    const prevB = document.body.style.background, prevH = document.documentElement.style.background;
    document.body.style.background = bg; document.documentElement.style.background = bg;
    return () => { document.body.style.background = prevB; document.documentElement.style.background = prevH; };
  }, [bg]);
  return <div style={{ minHeight: '100dvh', background: bg, display: 'flex', justifyContent: 'center' }}>{children}</div>;
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <div style={{ margin: 'auto', maxWidth: 440, padding: 24, color: '#fff', fontFamily: "Geist, 'Helvetica Neue', Arial, sans-serif", display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'center' }}>
        <h1 style={{ margin: 0, fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 30, letterSpacing: '-.03em' }}>{title}</h1>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: 'rgba(255,255,255,.7)' }}>{body}</p>
      </div>
    </Shell>
  );
}

export default function SignupPagePublic() {
  const ready = useLocaleSection('crm');
  useFonts();
  if (!ready) return <Shell><span /></Shell>;
  return <Inner />;
}

function Inner() {
  const { t, lang, locale } = useCrmT();
  const { slug = '' } = useParams();
  const [sp] = useSearchParams();
  const src = sp.get('src');
  const [page, setPage] = useState<PublicPage | null | 'missing'>(null);
  useEffect(() => {
    let off = false;
    void (async () => {
      const data = await rpc<PublicPage | null>('get_crm_signup_page', { p_slug: slug }).catch(() => null);
      if (off) return;
      setPage(data ?? 'missing');
      if (data) void rpc('track_crm_signup_visit', { p_slug: slug, p_src: src }).catch(() => undefined);
    })();
    return () => { off = true; };
  }, [slug, src]);
  useEffect(() => { if (page && page !== 'missing') document.title = `${page.title} · ${page.host}`; }, [page]);

  if (page === null) return <Shell><span /></Shell>;
  if (page === 'missing') return <Message title={t('yc.sp.fan.missingT')} body={t('yc.sp.fan.missingS')} />;

  const ev = page.event;
  const design = normalizeDesign(page.design);
  const K = pageTokens({ design, custom: page.custom_design });
  const cfg: FanCfg = {
    kind: page.kind,
    title: page.title,
    sub: page.tagline,
    btn: page.button_label || t(`yc.sp.ty.${page.kind}.btn1`),
    noted: page.thanks_message || t(`yc.sp.ty.${page.kind}.noted`),
    design,
    poster: page.poster_url || ev?.cover_url || null,
    club: page.host,
    date: page.kind === 'communaute' ? null : ev ? (() => { const s = dt(ev.start_at, locale, ev.tz); return s.charAt(0).toUpperCase() + s.slice(1); })() : t('yc.sp.w.nightNoneD'),
    place: ev ? [ev.venue || page.host, ev.city].filter(Boolean).join(' · ') : page.host,
    fields: normalizeFields(page.fields),
    reward: page.reward ? { ...defaultReward(page.kind), ...page.reward } : defaultReward(page.kind),
    saleAt: page.kind === 'prevente' ? page.sale_opens_at : null,
    countdown: page.countdown !== false,
    showCount: page.count !== null,
    count: page.count ?? 0,
    full: page.kind === 'attente' && !!ev?.sold_out,
    ticketUrl: ev?.ticket_url ?? null,
    opensAt: page.opens_at,
    pageUrl: `${window.location.origin}/j/${page.slug}`,
    eventStart: ev?.start_at ?? null,
    eventEnd: ev?.end_at ?? null,
    country: ev?.country ?? null,
    custom: page.custom_design ?? null,
    brand: page.brand ?? null,
    eventFacts: ev ? { title: ev.title, start_at: ev.start_at, tz: ev.tz, venue: ev.venue, city: ev.city, poster: ev.cover_url, ticket_url: ev.ticket_url, sold_out: ev.sold_out } : null,
  };
  const scene: FanScene = page.state === 'soon' ? 'soon' : page.state === 'closed' ? 'closed' : 'form';
  const submit = (v: FanSubmit): Promise<SubmitResult> => rpc<SubmitResult>('submit_crm_signup', {
    p_slug: slug, p_first_name: v.first_name, p_email: v.email || null, p_phone: v.phone || null, p_answers: v.answers,
    p_consent: true, p_consent_text: v.consent_text, p_lang: lang, p_src: src,
    p_last_name: v.last_name || null, p_birthdate: v.birthdate || null, p_instagram: v.instagram || null, p_city: v.city || null,
  }).catch(() => 'error' as SubmitResult);

  return (
    <Shell bg={K.bg}>
      <div style={{ width: '100%', maxWidth: 480, height: '100dvh', position: 'relative' }}>
        <FanPage cfg={cfg} scene={scene} mode="live" onSubmit={submit} />
      </div>
    </Shell>
  );
}

/** `/j/<slug>/ok?t=<jeton>` : le clic du lien de confirmation. */
export function SignupConfirm() {
  const ready = useLocaleSection('crm');
  useFonts();
  if (!ready) return <Shell><span /></Shell>;
  return <ConfirmInner />;
}

function ConfirmInner() {
  const { t } = useCrmT();
  const { slug = '' } = useParams();
  const [sp] = useSearchParams();
  const [res, setRes] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      setRes(await rpc<string>('crm_signup_confirm', { p_slug: slug, p_token: sp.get('t') ?? '' }).catch(() => 'error'));
    })();
  }, [slug, sp]);
  if (!res) return <Shell><span /></Shell>;
  const k = res === 'ok' || res === 'already' ? res : 'invalid';
  return <Message title={t(`yc.sp.fan.cf.${k}T`)} body={t(`yc.sp.fan.cf.${k}S`)} />;
}
