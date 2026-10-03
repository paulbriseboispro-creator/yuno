import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Loader2, Lock, ShieldCheck, TriangleAlert, XCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { Seo } from '@/components/Seo';
import { buildMcpRedirect, isLoopbackRedirectHost } from '@/lib/mcp';

/**
 * Consentement d'une IA (Claude, ChatGPT, Gemini, Le Chat…) qui veut lire les
 * chiffres Yuno d'un pro — l'écran où le serveur OAuth du MCP (worker/mcp)
 * envoie la personne : /connect-ai?request=<id>.
 *
 * DA publique (docs/DESIGN_SYSTEM_PUBLIC.md) : la personne sort de son IA, elle
 * n'est pas dans un dashboard. Trois décisions, dans cet ordre : quels espaces,
 * quel niveau (chiffres seuls par défaut, fiches clients sur choix explicite),
 * puis Autoriser / Refuser. Le contrat (lecture seule, révocable, journalisé)
 * est dit avant le bouton, pas dans une page à part.
 *
 * Toute la décision est serveur (mcp_get_authorization_request /
 * mcp_approve_authorization) : cette page ne fait qu'afficher et transmettre.
 */

const BLACK = '#0A0A0A';
const CARD = '#141414';
const RED = '#E8192C';
const WHITE = '#FFFFFF';
const GRAY_1 = '#E5E5E5';
const GRAY_2 = '#9A9A9A';
const GRAY_3 = '#5A5A5E';
const BORDER = 'rgba(255,255,255,0.08)';

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
  background: BLACK,
  paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)',
  paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-5" style={PAGE_SAFE}>
      <Seo title="Yuno" description="" noindex />
      <div className="w-full" style={{ maxWidth: 480 }}>{children}</div>
    </div>
  );
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={className} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 4, padding: '20px 18px' }}>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono uppercase mb-3" style={{ fontSize: 10, color: GRAY_2, letterSpacing: '0.14em', fontWeight: 600 }}>
      {children}
    </p>
  );
}

function Outcome({ tone, title, body, children }: { tone: 'ok' | 'ko'; title: string; body: string; children?: React.ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : XCircle;
  return (
    <Panel>
      <Icon className="h-10 w-10 mb-5" style={{ color: tone === 'ok' ? '#22C55E' : RED }} aria-hidden="true" />
      <h1 className="font-display uppercase" style={{ color: WHITE, fontSize: 'clamp(20px, 5vw, 26px)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.05 }}>
        {title}
      </h1>
      <p style={{ color: GRAY_1, fontSize: 15, lineHeight: 1.6, marginTop: 12 }}>{body}</p>
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
          <p className="font-mono uppercase mt-5" style={{ fontSize: 10.5, color: GRAY_3, letterSpacing: '0.16em' }}>{t('aiConsent.kicker')}</p>
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
          <button className="btn btn--ghost w-full mt-6" onClick={() => navigate('/')}>{t('aiConsent.home')}</button>
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
          <p className="font-mono mt-4" style={{ fontSize: 11, color: GRAY_2, wordBreak: 'break-all' }}>{user?.email}</p>
          <button className="btn btn--ghost w-full mt-5" onClick={switchAccount}>{t('aiConsent.switchAccount')}</button>
        </Outcome>
      </Shell>
    );
  }

  const toggle = (key: string) =>
    setSelected((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  return (
    <Shell>
      <header className="mb-6">
        <p className="section-label-ruled mb-4">{t('aiConsent.kicker')}</p>
        <h1 className="font-display uppercase" style={{ color: WHITE, fontSize: 'clamp(30px, 8vw, 44px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 0.95, wordBreak: 'break-word' }}>
          {clientName}
        </h1>
        <p style={{ color: GRAY_1, fontSize: 16, lineHeight: 1.5, marginTop: 12 }}>{t('aiConsent.wants')}</p>
        <p className="font-mono mt-3" style={{ fontSize: 11, color: GRAY_2, letterSpacing: '0.04em' }}>
          {t('aiConsent.returnTo')} <span style={{ color: GRAY_1 }}>{redirectHost}</span>
          {' · '}{t('aiConsent.signedInAs')} <span style={{ color: GRAY_1, wordBreak: 'break-all' }}>{user?.email}</span>
        </p>
        {isLoopbackRedirectHost(redirectHost) && (
          <p className="flex items-start gap-2 mt-3" style={{ fontSize: 13, color: '#F5B041', lineHeight: 1.5 }}>
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
                className="w-full flex items-center gap-3 text-left"
                style={{ padding: '12px 12px', borderRadius: 4, border: `1px solid ${on ? 'rgba(232,25,44,0.45)' : BORDER}`, background: on ? 'rgba(232,25,44,0.06)' : 'transparent' }}
              >
                <span className="flex items-center justify-center shrink-0" style={{ width: 20, height: 20, borderRadius: 3, border: `1px solid ${on ? RED : GRAY_3}`, background: on ? RED : 'transparent' }}>
                  {on && <Check className="w-3.5 h-3.5" style={{ color: WHITE }} aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate" style={{ color: WHITE, fontSize: 15, fontWeight: 600 }}>{s.name}</span>
                  <span className="block font-mono uppercase" style={{ fontSize: 9.5, color: GRAY_2, letterSpacing: '0.12em', marginTop: 3 }}>
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
                className="w-full flex items-start gap-3 text-left disabled:opacity-40"
                style={{ padding: '12px 12px', borderRadius: 4, border: `1px solid ${on ? 'rgba(232,25,44,0.45)' : BORDER}`, background: on ? 'rgba(232,25,44,0.06)' : 'transparent' }}
              >
                <span className="shrink-0 mt-0.5 flex items-center justify-center" style={{ width: 18, height: 18, borderRadius: 999, border: `1px solid ${on ? RED : GRAY_3}` }}>
                  {on && <span style={{ width: 8, height: 8, borderRadius: 999, background: RED }} />}
                </span>
                <span className="min-w-0">
                  <span className="block" style={{ color: WHITE, fontSize: 15, fontWeight: 600 }}>
                    {lv === 'analytics' ? t('aiConsent.levelAnalytics') : t('aiConsent.levelCustomers')}
                    {lv === 'analytics' && (
                      <span className="font-mono uppercase ml-2" style={{ fontSize: 9, color: RED, letterSpacing: '0.12em' }}>{t('aiConsent.recommended')}</span>
                    )}
                  </span>
                  <span className="block" style={{ color: GRAY_2, fontSize: 13, lineHeight: 1.5, marginTop: 4 }}>
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
            <p key={k} className="flex items-start gap-2.5" style={{ fontSize: 13, color: GRAY_1, lineHeight: 1.5 }}>
              <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#22C55E' }} aria-hidden="true" />{t(k)}
            </p>
          ))}
          {['aiMcp.cant1', 'aiMcp.cant2'].map((k) => (
            <p key={k} className="flex items-start gap-2.5" style={{ fontSize: 13, color: GRAY_1, lineHeight: 1.5 }}>
              <Lock className="w-4 h-4 mt-0.5 shrink-0" style={{ color: RED }} aria-hidden="true" />{t(k)}
            </p>
          ))}
        </div>
        <p style={{ fontSize: 12, color: GRAY_2, lineHeight: 1.55, marginTop: 14 }}>
          {t('aiConsent.privacyNote').replace('{client}', clientName)} {t('aiConsent.manageLater')}
        </p>
      </Panel>

      {error && <p role="alert" className="mb-3" style={{ color: RED, fontSize: 13 }}>{error}</p>}

      <div className="flex flex-col gap-2.5">
        <button className="btn btn--primary w-full" disabled={!selected.length || !!busy} onClick={() => decide('allow')}>
          {busy === 'allow' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
          {busy === 'allow' ? t('aiConsent.allowing') : t('aiConsent.allow').replace('{client}', clientName)}
        </button>
        <button className="btn btn--ghost w-full" disabled={!!busy} onClick={() => decide('deny')}>
          {t('aiConsent.deny')}
        </button>
      </div>
      <button onClick={switchAccount} className="w-full mt-4 font-mono uppercase" style={{ fontSize: 10, color: GRAY_3, letterSpacing: '0.12em' }}>
        {t('aiConsent.switchAccount')}
      </button>
    </Shell>
  );
}
