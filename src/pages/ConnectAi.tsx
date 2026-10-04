import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Lock, ShieldCheck, TriangleAlert, XCircle, CheckCircle2 } from 'lucide-react';
import '@/crm/styles/crm.css';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { Seo } from '@/components/Seo';
import { Wordmark } from '@/components/brand/Wordmark';
import { buildMcpRedirect, isLoopbackRedirectHost } from '@/lib/mcp';

/**
 * Consentement d'une IA (Claude, ChatGPT, Gemini, Le Chat…) qui veut lire les
 * chiffres Yuno d'un pro — l'écran où le serveur OAuth du MCP (worker/mcp)
 * envoie la personne : /connect-ai?request=<id>.
 *
 * DA de Yuno CRM (src/crm/styles/crm.css, scopée sous `.yc`) : papier clair,
 * Bricolage Grotesque / Geist, dégradé rouge → mandarine, cartes 24 px.
 * UNE seule décision : Autoriser ou Refuser. Il n'y a ni choix d'espaces ni
 * choix de niveau — l'IA reçoit l'accès à tout le compte (tous les espaces de la
 * personne, fiches clients comprises quand son rôle les ouvre). Le contrat
 * (lecture seule, révocable, journalisé) est dit avant le bouton.
 *
 * Toute la décision est serveur (mcp_get_authorization_request /
 * mcp_approve_authorization) : cette page ne fait qu'afficher et transmettre.
 */

const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap';

const T1 = 'var(--text-primary)';
const T2 = 'var(--text-secondary)';
const T3 = 'var(--text-tertiary)';
const BORDER = 'var(--border-default)';

interface SpaceOption {
  key: string;
  kind: 'venue' | 'organizer';
  name: string;
  product: 'suite' | 'crm';
  role: string;
  money: boolean;
  customers: boolean;
}

interface RequestView {
  ok: boolean;
  error?: string;
  client?: { name: string; uri: string | null; logo: string | null; kind: string; redirect_host: string };
  scope?: string | null;
  support_session?: boolean;
  spaces?: SpaceOption[];
  existing?: boolean;
}

interface DecisionResult {
  ok: boolean;
  error?: string;
  redirect_uri?: string;
  params?: Record<string, string>;
}

function useCrmFonts() {
  useEffect(() => {
    if (document.getElementById('yc-fonts')) return;
    const pre = document.createElement('link');
    pre.rel = 'preconnect'; pre.href = 'https://fonts.gstatic.com'; pre.crossOrigin = 'anonymous';
    document.head.appendChild(pre);
    const l = document.createElement('link');
    l.id = 'yc-fonts'; l.rel = 'stylesheet'; l.href = FONTS_HREF;
    document.head.appendChild(l);
  }, []);
}

function Shell({ children }: { children: React.ReactNode }) {
  useCrmFonts();
  return (
    <div
      className="yc yc-page-bg relative min-h-[100dvh] flex items-center justify-center px-4 sm:px-5"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}
    >
      <Seo title="Yuno" description="" noindex />
      <div className="relative z-10 w-full" style={{ maxWidth: 480 }}>
        <Wordmark height={22} tone="dark" className="mb-7" alt="Yuno" />
        {children}
      </div>
    </div>
  );
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={className} style={{ background: 'var(--surface-card)', border: `1px solid ${BORDER}`, borderRadius: 24, boxShadow: 'var(--shadow-sm)', padding: 22 }}>
      {children}
    </div>
  );
}

const BTN_PRIMARY: React.CSSProperties = {
  background: 'var(--gradient-brand)', color: 'var(--text-on-accent)', borderRadius: 14, height: 50,
  fontSize: 15, fontWeight: 600, boxShadow: 'var(--shadow-cta)', fontFamily: 'var(--font-body)',
};
const BTN_GHOST: React.CSSProperties = {
  background: 'var(--surface-card)', color: T1, border: `1px solid ${BORDER}`, borderRadius: 14, height: 50,
  fontSize: 15, fontWeight: 560, fontFamily: 'var(--font-body)',
};

function Outcome({ tone, title, body, children }: { tone: 'ok' | 'ko'; title: string; body: string; children?: React.ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : XCircle;
  return (
    <Panel>
      <Icon className="h-9 w-9 mb-5" style={{ color: tone === 'ok' ? 'var(--green-500)' : 'var(--red-500)' }} aria-hidden="true" />
      <h1 style={{ color: T1, fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}>{title}</h1>
      <p style={{ color: T2, fontSize: 15, lineHeight: 1.6, marginTop: 10 }}>{body}</p>
      {children}
    </Panel>
  );
}

export default function ConnectAi() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user, loading: authLoading } = useAuth();
  const requestId = params.get('request') ?? '';

  const [view, setView] = useState<RequestView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [done, setDone] = useState<'allowed' | 'denied' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selfPath = `/connect-ai?request=${encodeURIComponent(requestId)}`;

  // Pas de session Yuno : se connecter d'abord, puis revenir ici.
  useEffect(() => {
    if (!authLoading && !user && requestId) {
      navigate(`/auth?redirect=${encodeURIComponent(selfPath)}`, { replace: true });
    }
  }, [authLoading, user, requestId, navigate, selfPath]);

  useEffect(() => {
    if (authLoading || !user || !requestId) { if (!requestId) setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { data, error: rpcError } = await supabase.rpc('mcp_get_authorization_request' as never, { p_request_id: requestId } as never);
      if (cancelled) return;
      setView((rpcError ? { ok: false, error: 'expired' } : data) as RequestView);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authLoading, user, requestId]);

  const spaces = useMemo(() => view?.spaces ?? [], [view]);
  // Tout le compte : tous les espaces, fiches clients comprises quand le rôle
  // les ouvre sur CHAQUE espace (le serveur applique ce niveau à toute la connexion).
  const selected = useMemo(() => spaces.map((s) => s.key), [spaces]);
  const level: 'analytics' | 'customers' = spaces.length > 0 && spaces.every((s) => s.customers) ? 'customers' : 'analytics';

  const clientName = view?.client?.name ?? 'AI';
  const redirectHost = view?.client?.redirect_host ?? '';

  const decide = async (choice: 'allow' | 'deny') => {
    setBusy(choice);
    setError(null);
    const { data, error: rpcError } = choice === 'allow'
      ? await supabase.rpc('mcp_approve_authorization' as never, { p_request_id: requestId, p_spaces: selected, p_level: level } as never)
      : await supabase.rpc('mcp_deny_authorization' as never, { p_request_id: requestId } as never);
    const r = data as DecisionResult | null;
    if (rpcError || !r?.ok || !r.redirect_uri || !r.params) {
      setBusy(null);
      setError(r?.error === 'expired' ? t('aiConsent.expiredBody')
        : r?.error === 'support_session' ? t('aiConsent.supportBody')
        : t('aiConsent.error'));
      return;
    }
    setDone(choice === 'allow' ? 'allowed' : 'denied');
    // Petite pause pour que la confirmation se lise, puis retour vers l'IA.
    window.setTimeout(() => window.location.assign(buildMcpRedirect(r.redirect_uri!, r.params!)), 700);
  };

  const switchAccount = async () => {
    try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* session déjà morte */ }
    window.location.assign(`/auth?redirect=${encodeURIComponent(selfPath)}`);
  };

  if (authLoading || loading || (!user && requestId)) {
    return (
      <Shell>
        <div className="flex flex-col items-center" role="status" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin motion-reduce:animate-none" style={{ color: 'var(--red-500)' }} aria-hidden="true" />
          <p className="mt-4" style={{ fontSize: 13, color: T3, fontWeight: 560 }}>{t('aiConsent.kicker')}</p>
        </div>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <Outcome
          tone={done === 'allowed' ? 'ok' : 'ko'}
          title={done === 'allowed' ? t('aiConsent.doneTitle') : t('aiConsent.deniedTitle')}
          body={t('aiConsent.goingBack').replace('{client}', clientName)}
        />
      </Shell>
    );
  }

  if (!requestId || !view?.ok) {
    return (
      <Shell>
        <Outcome tone="ko" title={t('aiConsent.expiredTitle')} body={t('aiConsent.expiredBody')}>
          <button className="w-full mt-6 cursor-pointer" style={BTN_GHOST} onClick={() => navigate('/')}>{t('aiConsent.home')}</button>
        </Outcome>
      </Shell>
    );
  }

  if (view.support_session) {
    return (
      <Shell>
        <Outcome tone="ko" title={t('aiConsent.supportTitle')} body={t('aiConsent.supportBody')} />
      </Shell>
    );
  }

  if (!spaces.length) {
    return (
      <Shell>
        <Outcome tone="ko" title={t('aiConsent.noSpaceTitle')} body={t('aiConsent.noSpaceBody')}>
          <p className="mt-4" style={{ fontSize: 13, color: T2, wordBreak: 'break-all' }}>{user?.email}</p>
          <button className="w-full mt-5 cursor-pointer" style={BTN_GHOST} onClick={switchAccount}>{t('aiConsent.switchAccount')}</button>
        </Outcome>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="mb-6">
        <p className="yc-mono-label mb-3 inline-flex items-center gap-2" style={{ color: 'var(--text-accent)', fontWeight: 600 }}>
          <span style={{ width: 18, height: 2, borderRadius: 2, background: 'var(--gradient-brand)' }} aria-hidden="true" />
          {t('aiConsent.kicker')}
        </p>
        <h1 style={{ color: T1, fontFamily: 'var(--font-display)', fontSize: 'clamp(30px, 8vw, 40px)', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.02, wordBreak: 'break-word' }}>
          {clientName}
        </h1>
        <p style={{ color: T2, fontSize: 16, lineHeight: 1.5, marginTop: 10 }}>{t('aiConsent.wants')}</p>
        <p className="mt-3" style={{ fontSize: 12.5, color: T3, lineHeight: 1.6 }}>
          {t('aiConsent.returnTo')} <span style={{ color: T2 }}>{redirectHost}</span>
          {' · '}{t('aiConsent.signedInAs')} <span style={{ color: T2, wordBreak: 'break-all' }}>{user?.email}</span>
        </p>
        {isLoopbackRedirectHost(redirectHost) && (
          <p className="flex items-start gap-2 mt-3" style={{ fontSize: 13, color: 'var(--amber-700)', lineHeight: 1.5 }}>
            <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            {t('aiConsent.localhostWarn')}
          </p>
        )}
      </header>

      <Panel className="mb-5">
        <h2 style={{ color: T1, fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 650, letterSpacing: '-0.015em' }}>
          {t('aiConsent.accessTitle')}
        </h2>
        <p style={{ color: T2, fontSize: 14.5, lineHeight: 1.55, marginTop: 6 }}>
          {level === 'customers' ? t('aiConsent.accessDesc') : t('aiConsent.accessDescNoCustomers')}
        </p>
        <div className="flex flex-wrap gap-2 mt-4">
          {spaces.map((s) => (
            <span key={s.key} className="inline-flex items-center" style={{ background: 'var(--bg-subtle)', border: `1px solid ${BORDER}`, borderRadius: 999, padding: '5px 12px', fontSize: 13, color: T1, fontWeight: 560 }}>
              {s.name}
              <span style={{ color: T3, fontWeight: 500, marginLeft: 6 }}>
                {s.kind === 'venue' ? t('aiConsent.club') : t('aiConsent.organizer')}
              </span>
            </span>
          ))}
        </div>
        <div className="space-y-2.5 mt-5 pt-5" style={{ borderTop: `1px solid ${BORDER}` }}>
          {['aiMcp.can2'].map((k) => (
            <p key={k} className="flex items-start gap-2.5" style={{ fontSize: 13.5, color: T1, lineHeight: 1.5 }}>
              <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--green-500)' }} aria-hidden="true" />{t(k)}
            </p>
          ))}
          {['aiMcp.cant1', 'aiMcp.cant2'].map((k) => (
            <p key={k} className="flex items-start gap-2.5" style={{ fontSize: 13.5, color: T1, lineHeight: 1.5 }}>
              <Lock className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--red-500)' }} aria-hidden="true" />{t(k)}
            </p>
          ))}
        </div>
        <p style={{ fontSize: 12.5, color: T3, lineHeight: 1.55, marginTop: 16 }}>
          {t('aiConsent.privacyNote').replace('{client}', clientName)} {t('aiConsent.manageLater')}
        </p>
      </Panel>

      {error && <p role="alert" className="mb-3" style={{ color: 'var(--red-600)', fontSize: 13.5 }}>{error}</p>}

      <div className="flex flex-col gap-2.5">
        <button className="w-full inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50" style={BTN_PRIMARY} disabled={!!busy} onClick={() => decide('allow')}>
          {busy === 'allow' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
          {busy === 'allow' ? t('aiConsent.allowing') : t('aiConsent.allow').replace('{client}', clientName)}
        </button>
        <button className="w-full cursor-pointer disabled:opacity-50" style={BTN_GHOST} disabled={!!busy} onClick={() => decide('deny')}>
          {t('aiConsent.deny')}
        </button>
      </div>
      <button onClick={switchAccount} className="w-full mt-4 cursor-pointer" style={{ fontSize: 13, color: T3, fontWeight: 560 }}>
        {t('aiConsent.switchAccount')}
      </button>
    </Shell>
  );
}
