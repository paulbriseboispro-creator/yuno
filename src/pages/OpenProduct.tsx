import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import '@/styles/connect-ai.css';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { Seo } from '@/components/Seo';
import { Wordmark } from '@/components/brand/Wordmark';

/**
 * Ouvrir l'AUTRE produit sur un compte existant (migration 20261006100000) :
 * /open/crm et /open/suite.
 *
 *   • ?token=… : invitation du super admin (email). Seul le titulaire du compte
 *     invité l'accepte (accept_product_invite).
 *   • sans jeton : le titulaire ouvre lui-même le produit sur un de ses comptes
 *     (open_product_on_my_account) — c'est là qu'arrive un client Billetterie
 *     qui se connecte depuis le funnel Yuno CRM.
 *
 * Même connexion, même base de contacts ; le CRM ajouté démarre son essai de
 * 14 jours (payant à part ensuite), la Billetterie ajoutée est sans abonnement.
 * DA de Yuno CRM (src/styles/connect-ai.css, scopée sous `.yc`).
 */

type Product = 'crm' | 'suite';

interface Account {
  kind: 'venue' | 'org';
  venue_id: string | null;
  organizer_user_id: string | null;
  name: string;
  city: string | null;
  product: Product;
  products: Product[];
}

interface InviteView {
  status: 'open' | 'accepted' | 'expired' | 'canceled' | 'not_found';
  product?: Product;
  kind?: 'venue' | 'org';
  name?: string;
  email?: string;
  is_owner?: boolean;
}

const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap';
const T1 = 'var(--text-primary)';
const T2 = 'var(--text-secondary)';
const BORDER = 'var(--border-default)';

const BTN_PRIMARY: React.CSSProperties = {
  background: 'var(--gradient-brand)', color: 'var(--text-on-accent)', borderRadius: 14, height: 50,
  fontSize: 15, fontWeight: 600, boxShadow: 'var(--shadow-cta)', fontFamily: 'var(--font-body)',
};
const BTN_GHOST: React.CSSProperties = {
  background: 'var(--surface-card)', color: T1, border: `1px solid ${BORDER}`, borderRadius: 14, height: 50,
  fontSize: 15, fontWeight: 560, fontFamily: 'var(--font-body)',
};

function useCrmFonts() {
  useEffect(() => {
    if (document.getElementById('yc-fonts')) return;
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

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface-card)', border: `1px solid ${BORDER}`, borderRadius: 24, boxShadow: 'var(--shadow-sm)', padding: 24 }}>
      {children}
    </div>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return <h1 style={{ color: T1, fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}>{children}</h1>;
}

function Outcome({ tone, title, body, children }: { tone: 'ok' | 'ko'; title: string; body: string; children?: React.ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : XCircle;
  return (
    <Panel>
      <Icon className="h-9 w-9 mb-5" style={{ color: tone === 'ok' ? 'var(--green-500)' : 'var(--red-500)' }} aria-hidden="true" />
      <Title>{title}</Title>
      <p style={{ color: T2, fontSize: 15, lineHeight: 1.6, marginTop: 10 }}>{body}</p>
      {children}
    </Panel>
  );
}

/** Où atterrir une fois le produit ouvert : la Console du produit, sur CE compte. */
function destination(product: Product, a: { kind: 'venue' | 'org'; venue_id: string | null; organizer_user_id: string | null }): string {
  if (product === 'crm') {
    const key = a.kind === 'venue' ? `venue:${a.venue_id}` : `org:${a.organizer_user_id}`;
    // La Console CRM ouvre l'espace gardé sous cette clé (src/crm/scope.tsx).
    try { localStorage.setItem('yuno.crm.space', key); } catch { /* mode privé : premier espace */ }
    return '/crm';
  }
  return a.kind === 'venue' ? '/owner/dashboard' : '/organizer-app';
}

export default function OpenProduct() {
  const { product: raw } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  const token = params.get('token');
  const product: Product | null = raw === 'crm' || raw === 'suite' ? raw : null;

  const [invite, setInvite] = useState<InviteView | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const productName = product === 'crm' ? 'Yuno CRM' : t('openProduct.suiteName');
  const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

  useEffect(() => {
    if (!product || loading || !user) return;
    let cancelled = false;
    (async () => {
      if (token) {
        const { data, error: e } = await supabase.rpc('get_product_invite' as never, { p_token: token } as never);
        if (!cancelled) setInvite(e ? { status: 'not_found' } : (data as unknown as InviteView));
      } else {
        const { data, error: e } = await supabase.rpc('get_my_product_accounts' as never);
        if (!cancelled) setAccounts(e ? [] : ((data as unknown as Account[]) ?? []));
      }
    })();
    return () => { cancelled = true; };
  }, [product, token, user, loading]);

  const candidates = useMemo(() => (accounts ?? []).filter((a) => !a.products.includes(product as Product)), [accounts, product]);
  const already = useMemo(() => (accounts ?? []).filter((a) => a.products.includes(product as Product)), [accounts, product]);
  const keyOf = (a: Account) => (a.kind === 'venue' ? `venue:${a.venue_id}` : `org:${a.organizer_user_id}`);
  const selected = candidates.find((a) => keyOf(a) === picked) ?? candidates[0];

  if (!product) return <Navigate to="/" replace />;
  if (!loading && !user) {
    return <Navigate to={`/auth?redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }

  const errorText = (code: string) => {
    const known = ['support_session_forbidden', 'demo_account', 'not_account_owner', 'invite_expired', 'invite_canceled', 'invite_not_found'];
    const k = known.find((x) => code.includes(x));
    return k ? t(`openProduct.err.${k}`) : t('openProduct.err.generic');
  };

  const signOutAndBack = async () => {
    await supabase.auth.signOut({ scope: 'local' });
    window.location.assign(`/auth?redirect=${encodeURIComponent(location.pathname + location.search)}`);
  };

  const accept = async () => {
    if (!token || busy) return;
    setBusy(true); setError(null);
    const { data, error: e } = await supabase.rpc('accept_product_invite' as never, { p_token: token } as never);
    if (e) { setError(errorText(e.message)); setBusy(false); return; }
    const r = data as unknown as { kind: 'venue' | 'org'; venue_id: string | null; organizer_user_id: string | null };
    window.location.assign(destination(product, r));
  };

  const openOnMine = async () => {
    if (!selected || busy) return;
    setBusy(true); setError(null);
    const { error: e } = await supabase.rpc('open_product_on_my_account' as never, {
      p_product: product,
      p_venue_id: selected.venue_id,
      p_organizer_user_id: selected.kind === 'org' ? selected.organizer_user_id : null,
    } as never);
    if (e) { setError(errorText(e.message)); setBusy(false); return; }
    window.location.assign(destination(product, selected));
  };

  const facts = [t(`openProduct.${product}.fact1`), t(`openProduct.${product}.fact2`), t(`openProduct.${product}.fact3`)];
  const Facts = (
    <ul className="mt-5 flex flex-col gap-2.5">
      {facts.map((f) => (
        <li key={f} className="flex items-center gap-2.5" style={{ color: T1, fontSize: 15 }}>
          <CheckCircle2 className="h-4 w-4 flex-none" style={{ color: 'var(--red-500)' }} aria-hidden="true" /> {f}
        </li>
      ))}
    </ul>
  );
  const ErrorLine = error ? <p role="alert" className="mt-4" style={{ color: 'var(--red-600)', fontSize: 14 }}>{error}</p> : null;
  const loadingView = (
    <Shell><div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" style={{ color: T2 }} /></div></Shell>
  );

  // ── Invitation du super admin ──────────────────────────────────────────────
  if (token) {
    if (!invite) return loadingView;
    if (invite.status === 'not_found' || invite.status === 'canceled' || invite.status === 'expired') {
      return (
        <Shell>
          <Outcome tone="ko" title={t('openProduct.invite.deadTitle')} body={t(`openProduct.invite.${invite.status === 'expired' ? 'expired' : 'invalid'}`)} />
        </Shell>
      );
    }
    const name = invite.name ?? '';
    const target = { kind: invite.kind ?? 'org', venue_id: null, organizer_user_id: null } as const;
    if (invite.status === 'accepted') {
      return (
        <Shell>
          <Outcome tone="ok" title={fill(t('openProduct.alreadyTitle'), { product: productName, name })} body={t('openProduct.alreadyBody')}>
            <button className="mt-6 w-full cursor-pointer" style={BTN_PRIMARY} onClick={() => window.location.assign(product === 'crm' ? '/crm' : (target.kind === 'venue' ? '/owner/dashboard' : '/organizer-app'))}>
              {fill(t('openProduct.goConsole'), { product: productName })}
            </button>
          </Outcome>
        </Shell>
      );
    }
    if (!invite.is_owner) {
      return (
        <Shell>
          <Outcome tone="ko" title={t('openProduct.wrongAccountTitle')} body={fill(t('openProduct.wrongAccountBody'), { name, email: invite.email ?? '' })}>
            <button className="mt-6 w-full cursor-pointer" style={BTN_GHOST} onClick={() => void signOutAndBack()}>{t('openProduct.switchAccount')}</button>
          </Outcome>
        </Shell>
      );
    }
    return (
      <Shell>
        <Panel>
          <p style={{ color: 'var(--red-500)', fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase' }}>{productName}</p>
          <div className="mt-2.5"><Title>{fill(t('openProduct.title'), { product: productName, name })}</Title></div>
          <p style={{ color: T2, fontSize: 15, lineHeight: 1.6, marginTop: 10 }}>{t(`openProduct.${product}.body`)}</p>
          {Facts}
          {ErrorLine}
          <button className="mt-6 w-full inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50" style={BTN_PRIMARY} disabled={busy} onClick={() => void accept()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {fill(t('openProduct.cta'), { product: productName })}
          </button>
        </Panel>
      </Shell>
    );
  }

  // ── Le titulaire ouvre lui-même le produit ─────────────────────────────────
  if (!accounts) return loadingView;
  if (!accounts.length) {
    return (
      <Shell>
        <Outcome tone="ko" title={t('openProduct.noAccountTitle')} body={fill(t('openProduct.noAccountBody'), { product: productName })}>
          <a className="mt-6 w-full inline-flex items-center justify-center" style={BTN_PRIMARY}
             href={product === 'crm' ? 'https://landing.yunoapp.eu/start?product=crm' : 'https://landing.yunoapp.eu/start'}>
            {fill(t('openProduct.createAccount'), { product: productName })}
          </a>
        </Outcome>
      </Shell>
    );
  }
  if (!candidates.length) {
    const a = already[0];
    return (
      <Shell>
        <Outcome tone="ok" title={fill(t('openProduct.alreadyTitle'), { product: productName, name: a.name })} body={t('openProduct.alreadyBody')}>
          <button className="mt-6 w-full cursor-pointer" style={BTN_PRIMARY} onClick={() => window.location.assign(destination(product, a))}>
            {fill(t('openProduct.goConsole'), { product: productName })}
          </button>
        </Outcome>
      </Shell>
    );
  }
  return (
    <Shell>
      <Panel>
        <p style={{ color: 'var(--red-500)', fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase' }}>{productName}</p>
        <div className="mt-2.5"><Title>{fill(t('openProduct.title'), { product: productName, name: selected?.name ?? '' })}</Title></div>
        <p style={{ color: T2, fontSize: 15, lineHeight: 1.6, marginTop: 10 }}>{t(`openProduct.${product}.body`)}</p>
        {candidates.length > 1 && (
          <div className="mt-5 flex flex-col gap-2" role="radiogroup" aria-label={t('openProduct.pickAccount')}>
            <p style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t('openProduct.pickAccount')}</p>
            {candidates.map((a) => {
              const on = keyOf(a) === keyOf(selected);
              return (
                <button key={keyOf(a)} type="button" role="radio" aria-checked={on} onClick={() => setPicked(keyOf(a))}
                  className="w-full text-left cursor-pointer"
                  style={{ border: `1.5px solid ${on ? 'var(--red-500)' : BORDER}`, borderRadius: 14, padding: '12px 14px', background: on ? 'var(--red-50)' : 'var(--surface-card)', color: T1, fontSize: 15, fontWeight: 560 }}>
                  {a.name}{a.city ? <span style={{ color: T2, fontWeight: 400 }}> · {a.city}</span> : null}
                </button>
              );
            })}
          </div>
        )}
        {Facts}
        {ErrorLine}
        <button className="mt-6 w-full inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50" style={BTN_PRIMARY} disabled={busy} onClick={() => void openOnMine()}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {fill(t('openProduct.cta'), { product: productName })}
        </button>
      </Panel>
    </Shell>
  );
}
