/**
 * Route publique d'une Page d'inscription : `/j/<slug>` (`?src=` = provenance du
 * lien ou du QR) et sa confirmation `/j/<slug>/ok?t=<jeton>`. Hors de toute
 * coquille ; aucune session n'est demandée au fan. Les appels passent par les
 * RPC anonymes (get_crm_signup_page, track_crm_signup_visit, submit_crm_signup,
 * crm_signup_confirm). Pas `/p/<slug>` : c'est le linktree des agences.
 */
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { rpc } from '@/crm/lib/rpc';
import { useLocaleSection } from '@/contexts/LanguageContext';
import { useCrmT } from '@/crm/i18n';
import FanView from './FanView';
import type { FanPageData, SubmitResult } from './FanView';

const FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=DM+Serif+Display&family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&family=Space+Mono:wght@400;700&display=swap';

function useFonts() {
  useEffect(() => {
    if (document.getElementById('yc-fan-fonts')) return;
    const l = document.createElement('link');
    l.id = 'yc-fan-fonts'; l.rel = 'stylesheet'; l.href = FONTS;
    document.head.appendChild(l);
  }, []);
}

function Shell({ children, bg = '#0A0A0A' }: { children: React.ReactNode; bg?: string }) {
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = bg;
    return () => { document.body.style.background = prev; };
  }, [bg]);
  return <div style={{ minHeight: '100dvh', background: bg, display: 'flex', flexDirection: 'column' }}>{children}</div>;
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
  const { t, lang } = useCrmT();
  const { slug = '' } = useParams();
  const [sp] = useSearchParams();
  const src = sp.get('src');
  const [page, setPage] = useState<FanPageData | null | 'missing'>(null);
  useEffect(() => {
    let off = false;
    void (async () => {
      const data = await rpc<FanPageData | null>('get_crm_signup_page', { p_slug: slug }).catch(() => null);
      if (off) return;
      setPage(data ?? 'missing');
      if (data) void rpc('track_crm_signup_visit', { p_slug: slug, p_src: src }).catch(() => undefined);
    })();
    return () => { off = true; };
  }, [slug, src]);
  useEffect(() => { if (page && page !== 'missing') document.title = `${page.title} · ${page.host}`; }, [page]);

  if (page === null) return <Shell><span /></Shell>;
  if (page === 'missing') return <Message title={t('yc.fan.missingT')} body={t('yc.fan.missingS')} />;
  const submit = async (v: { first_name: string; email: string; phone: string; answers: Record<string, string | string[]>; consent_text: string }): Promise<SubmitResult> => {
    return rpc<SubmitResult>('submit_crm_signup', {
      p_slug: slug, p_first_name: v.first_name, p_email: v.email, p_phone: v.phone || null, p_answers: v.answers,
      p_consent: true, p_consent_text: v.consent_text, p_lang: lang, p_src: src,
    }).catch(() => 'error' as SubmitResult);
  };
  return <Shell bg={page.theme.bg}><FanView page={page} onSubmit={submit} /></Shell>;
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
  return <Message title={t(`yc.fan.cf.${k}T`)} body={t(`yc.fan.cf.${k}S`)} />;
}
