import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Loader2, Lock, ShieldCheck, TriangleAlert, XCircle, CheckCircle2 } from 'lucide-react';
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
 * DA de la Console / Yuno CRM (docs/DESIGN_SYSTEM.md : cartes 18 px, encres
 * `--ink`, rouge unique, wordmark officiel) : c'est l'écran où un pro donne accès
 * à SES chiffres, il doit ressembler à l'outil qu'il connecte, pas à la vitrine.
 * Toujours sombre (la route n'est pas une route pro thémée). Trois décisions, dans cet ordre : quels espaces,
 * quel niveau (chiffres seuls par défaut, fiches clients sur choix explicite),
 * puis Autoriser / Refuser. Le contrat (lecture seule, révocable, journalisé)
 * est dit avant le bouton, pas dans une page à part.
 *
 * Toute la décision est serveur (mcp_get_authorization_request /
 * mcp_approve_authorization) : cette page ne fait qu'afficher et transmettre.
 */

// Tokens du design system pro (docs/DESIGN_SYSTEM.md §2). Jamais un blanc ou un
// noir en dur : une encre (`--ink`) ou une surface (`--sf-…`).
const RED = '#E8192C';
const POS = 'var(--acc-34d399)';
const T1 = 'rgb(var(--ink)/0.96)';
const T2 = 'rgb(var(--ink)/0.58)';
const T3 = 'rgb(var(--ink)/0.36)';
const BORDER = 'rgb(var(--ink)/0.085)';
const INNER_BG = 'rgb(var(--ink)/0.032)';
const CARD_BG = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';
const RED_SOFT = 'rgba(232,25,44,0.09)';
const RED_LINE = 'rgba(232,25,44,0.32)';

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

const PAGE_SAFE = {
  background: 'var(--sf-000000)',
  paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)',
  paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-[100dvh] flex items-center justify-center px-4 sm:px-5" style={PAGE_SAFE}>
      <Seo title="Yuno" description="" noindex />
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgb(var(--ink)/.03),transparent 55%), radial-gradient(60% 40% at 90% -10%,rgba(232,25,44,0.07),transparent 65%)' }} />
      <div className="relative z-10 w-full" style={{ maxWidth: 500 }}>
        <Wordmark height={22} className="mb-7" alt="Yuno" />
        {children}
      </div>
    </div>
  );
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={className} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 20 }}>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3" style={{ fontSize: 11.5, color: T3, letterSpacing: '0.08em', fontWeight: 600, textTransform: 'uppercase' }}>
      {children}
    </p>
  );
}

const BTN_PRIMARY: React.CSSProperties = {
  background: RED, color: '#fff', borderRadius: 12, height: 46, fontSize: 14.5, fontWeight: 600,
  boxShadow: `0 0 18px -6px ${RED}99, 0 1px 0 rgba(255,255,255,.18) inset`,
};
const BTN_GHOST: React.CSSProperties = {
  background: INNER_BG, color: T1, border: `1px solid ${BORDER}`, borderRadius: 12, height: 46, fontSize: 14.5, fontWeight: 560,
};

function Outcome({ tone, title, body, children }: { tone: 'ok' | 'ko'; title: string; body: string; children?: React.ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : XCircle;
  return (
    <Panel>
      <Icon className="h-9 w-9 mb-5" style={{ color: tone === 'ok' ? POS : RED }} aria-hidden="true" />
      <h1 style={{ color: T1, fontSize: 22, fontWeight: 650, letterSpacing: '-0.015em', lineHeight: 1.2 }}>{title}</h1>
      <p style={{ color: T2, fontSize: 14.5, lineHeight: 1.6, marginTop: 10 }}>{body}</p>
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
  const [selected, setSelected] = useState<string[]>([]);
  const [level, setLevel] = useState<'analytics' | 'customers'>('analytics');
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
      const v = (rpcError ? { ok: false, error: 'expired' } : data) as RequestView;
      setView(v);
      if (v?.ok && v.spaces?.length) {
        // Un seul espace : coché d'office. Plusieurs : tous cochés, la personne retire.
        setSelected(v.spaces.map((s) => s.key));
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authLoading, user, requestId]);

  const spaces = useMemo(() => view?.spaces ?? [], [view]);
  const customersAllowed = selected.length > 0 && selected.every((k) => spaces.find((s) => s.key === k)?.customers);
  useEffect(() => { if (!customersAllowed && level === 'customers') setLevel('analytics'); }, [customersAllowed, level]);

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
          <Loader2 className="h-8 w-8 animate-spin motion-reduce:animate-none" style={{ color: RED }} aria-hidden="true" />
          <p className="mt-4" style={{ fontSize: 12.5, color: T3, fontWeight: 560 }}>{t('aiConsent.kicker')}</p>
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
          <p className="mt-4" style={{ fontSize: 12.5, color: T2, wordBreak: 'break-all' }}>{user?.email}</p>
          <button className="w-full mt-5 cursor-pointer" style={BTN_GHOST} onClick={switchAccount}>{t('aiConsent.switchAccount')}</button>
        </Outcome>
      </Shell>
    );
  }

  const toggle = (key: string) =>
    setSelected((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  return (
    <Shell>
      <header className="mb-6">
        <p className="mb-3 inline-flex items-center gap-2" style={{ fontSize: 11.5, color: RED, letterSpacing: '0.08em', fontWeight: 650, textTransform: 'uppercase' }}>
          <span style={{ width: 18, height: 2, borderRadius: 2, background: RED }} aria-hidden="true" />
          {t('aiConsent.kicker')}
        </p>
        <h1 style={{ color: T1, fontSize: 'clamp(26px, 7vw, 34px)', fontWeight: 680, letterSpacing: '-0.025em', lineHeight: 1.05, wordBreak: 'break-word' }}>
          {clientName}
        </h1>
        <p style={{ color: T2, fontSize: 15, lineHeight: 1.55, marginTop: 10 }}>{t('aiConsent.wants')}</p>
        <p className="mt-3" style={{ fontSize: 12, color: T3, lineHeight: 1.6 }}>
          {t('aiConsent.returnTo')} <span style={{ color: T2 }}>{redirectHost}</span>
          {' · '}{t('aiConsent.signedInAs')} <span style={{ color: T2, wordBreak: 'break-all' }}>{user?.email}</span>
        </p>
        {isLoopbackRedirectHost(redirectHost) && (
          <p className="flex items-start gap-2 mt-3" style={{ fontSize: 13, color: 'var(--acc-f5b041, #F5B041)', lineHeight: 1.5 }}>
            <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            {t('aiConsent.localhostWarn')}
          </p>
        )}
      </header>

      <Panel className="mb-3">
        <Label>{t('aiConsent.spacesTitle')}</Label>
        <div className="space-y-2" role="group" aria-label={t('aiConsent.spacesTitle')}>
          {spaces.map((s) => {
            const on = selected.includes(s.key);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggle(s.key)}
                aria-pressed={on}
                className="w-full flex items-center gap-3 text-left cursor-pointer"
                style={{ padding: '12px 14px', borderRadius: 12, border: `1px solid ${on ? RED_LINE : BORDER}`, background: on ? RED_SOFT : INNER_BG }}
              >
                <span className="flex items-center justify-center shrink-0" style={{ width: 20, height: 20, borderRadius: 3, border: `1px solid ${on ? RED : T3}`, background: on ? RED : 'transparent' }}>
                  {on && <Check className="w-3.5 h-3.5" style={{ color: '#fff' }} aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate" style={{ color: T1, fontSize: 15, fontWeight: 600 }}>{s.name}</span>
                  <span className="block" style={{ fontSize: 12, color: T3, fontWeight: 560, marginTop: 2 }}>
                    {s.kind === 'venue' ? t('aiConsent.club') : t('aiConsent.organizer')}
                    {s.product === 'crm' ? ' · CRM' : ''}
                    {!s.money ? ` · ${t('aiConsent.moneyHidden')}` : ''}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel className="mb-3">
        <Label>{t('aiConsent.levelTitle')}</Label>
        <div className="space-y-2" role="radiogroup" aria-label={t('aiConsent.levelTitle')}>
          {(['analytics', 'customers'] as const).map((lv) => {
            const on = level === lv;
            const disabled = lv === 'customers' && !customersAllowed;
            return (
              <button
                key={lv}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={disabled}
                onClick={() => setLevel(lv)}
                className="w-full flex items-start gap-3 text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                style={{ padding: '12px 14px', borderRadius: 12, border: `1px solid ${on ? RED_LINE : BORDER}`, background: on ? RED_SOFT : INNER_BG }}
              >
                <span className="shrink-0 mt-0.5 flex items-center justify-center" style={{ width: 18, height: 18, borderRadius: 999, border: `1px solid ${on ? RED : T3}` }}>
                  {on && <span style={{ width: 8, height: 8, borderRadius: 999, background: RED }} />}
                </span>
                <span className="min-w-0">
                  <span className="block" style={{ color: T1, fontSize: 15, fontWeight: 600 }}>
                    {lv === 'analytics' ? t('aiConsent.levelAnalytics') : t('aiConsent.levelCustomers')}
                    {lv === 'analytics' && (
                      <span className="ml-2 align-middle" style={{ fontSize: 10.5, color: RED, background: RED_SOFT, border: `1px solid ${RED_LINE}`, borderRadius: 999, padding: '1px 8px', fontWeight: 650 }}>{t('aiConsent.recommended')}</span>
                    )}
                  </span>
                  <span className="block" style={{ color: T2, fontSize: 13, lineHeight: 1.5, marginTop: 4 }}>
                    {lv === 'analytics' ? t('aiConsent.levelAnalyticsDesc')
                      : disabled ? t('aiConsent.levelCustomersLocked') : t('aiConsent.levelCustomersDesc')}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel className="mb-5">
        <div className="space-y-2.5">
          {['aiMcp.can1', 'aiMcp.can2'].map((k) => (
            <p key={k} className="flex items-start gap-2.5" style={{ fontSize: 13, color: T1, lineHeight: 1.5 }}>
              <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" style={{ color: POS }} aria-hidden="true" />{t(k)}
            </p>
          ))}
          {['aiMcp.cant1', 'aiMcp.cant2'].map((k) => (
            <p key={k} className="flex items-start gap-2.5" style={{ fontSize: 13, color: T1, lineHeight: 1.5 }}>
              <Lock className="w-4 h-4 mt-0.5 shrink-0" style={{ color: RED }} aria-hidden="true" />{t(k)}
            </p>
          ))}
        </div>
        <p style={{ fontSize: 12, color: T3, lineHeight: 1.55, marginTop: 14 }}>
          {t('aiConsent.privacyNote').replace('{client}', clientName)} {t('aiConsent.manageLater')}
        </p>
      </Panel>

      {error && <p role="alert" className="mb-3" style={{ color: RED, fontSize: 13 }}>{error}</p>}

      <div className="flex flex-col gap-2.5">
        <button className="w-full inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40" style={BTN_PRIMARY} disabled={!selected.length || !!busy} onClick={() => decide('allow')}>
          {busy === 'allow' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
          {busy === 'allow' ? t('aiConsent.allowing') : t('aiConsent.allow').replace('{client}', clientName)}
        </button>
        <button className="w-full cursor-pointer disabled:opacity-40" style={BTN_GHOST} disabled={!!busy} onClick={() => decide('deny')}>
          {t('aiConsent.deny')}
        </button>
      </div>
      <button onClick={switchAccount} className="w-full mt-4 cursor-pointer" style={{ fontSize: 12.5, color: T3, fontWeight: 560 }}>
        {t('aiConsent.switchAccount')}
      </button>
    </Shell>
  );
}
