import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { invalidateOrgMemberships } from '@/hooks/useActingOrganizer';
import { CheckCircle2, XCircle, Loader2, LogIn, Mail, UserCog, ArrowRight } from 'lucide-react';

/**
 * Acceptation d'une invitation d'équipe organisateur.
 *
 * Le lien envoyé par email pointait sur `/accept-org-member`, une route qui
 * n'existait pas : l'invité tombait sur la page 404 et l'invitation mourait là.
 * Cette page est l'écran manquant.
 *
 * DA publique (`docs/DESIGN_SYSTEM_PUBLIC.md`) et pas la DA pro : la personne
 * qui ouvre ce lien n'est pas encore dans un dashboard, elle sort de sa boîte
 * mail. Affiche, pas tableau de bord — titre Space Grotesk capitales, metadata
 * JetBrains Mono trackée, rouge `#E8192C` comme seul accent, radius tranchant.
 */

const BLACK = '#0A0A0A';
const CARD = '#141414';
const RED = '#E8192C';
const WHITE = '#FFFFFF';
const GRAY_1 = '#E5E5E5';
const GRAY_2 = '#9A9A9A';
const GRAY_3 = '#5A5A5E';
const BORDER = 'rgba(255,255,255,0.08)';

interface InvitationView {
  email: string;
  role: 'admin' | 'editor' | 'scanner' | string;
  organizationName: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired' | string;
  requiresAccountCreation: boolean;
}

interface AcceptResult {
  success: boolean;
  message?: string;
  code?: string;
  accountCreated?: boolean;
  passwordResetSent?: boolean;
}

/** Page plein écran sans chrome global : l'encoche et la barre d'accueil sont à
 *  sa charge. `100dvh` et non `100vh` pour que la carte se recentre quand le
 *  clavier iOS s'ouvre sur les champs prénom / nom. */
const PAGE = 'min-h-[100dvh] flex items-center justify-center px-5';
const PAGE_SAFE = {
  background: BLACK,
  paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)',
  paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className={PAGE} style={PAGE_SAFE}>
      <div className="w-full" style={{ maxWidth: 440 }}>{children}</div>
    </div>
  );
}

/** Le bloc éditorial : filet rouge, kicker mono, nom de l'organisation en
 *  capitales. C'est lui qui dit « tu entres chez quelqu'un », pas un titre
 *  générique « Invitation ». */
function OrgHeader({ kicker, name }: { kicker: string; name: string }) {
  return (
    <header className="mb-7">
      <p className="section-label-ruled mb-4">{kicker}</p>
      <h1
        className="font-display uppercase"
        style={{
          color: WHITE,
          fontSize: 'clamp(30px, 8vw, 44px)',
          fontWeight: 700,
          letterSpacing: '-0.025em',
          lineHeight: 0.95,
          wordBreak: 'break-word',
        }}
      >
        {name}
      </h1>
    </header>
  );
}

/** Rôle + email : deux faits, en mono, dans un encadré tranchant à l'accent
 *  rouge. Le rôle est ce que la personne vient chercher. */
function RoleCallout({ roleLabel, roleHint, email }: { roleLabel: string; roleHint: string; email: string }) {
  return (
    <div
      className="mb-6"
      style={{ border: `1px solid rgba(232,25,44,0.28)`, borderRadius: 4, padding: '16px 18px', background: 'rgba(232,25,44,0.04)' }}
    >
      <p className="font-mono uppercase" style={{ fontSize: 9, color: RED, letterSpacing: '0.14em', fontWeight: 600 }}>
        {roleHint}
      </p>
      <p
        className="font-display uppercase"
        style={{ color: WHITE, fontSize: 'clamp(19px, 5vw, 24px)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.05, marginTop: 6 }}
      >
        {roleLabel}
      </p>
      <p className="font-mono" style={{ fontSize: 11, color: GRAY_2, letterSpacing: '0.04em', marginTop: 10, wordBreak: 'break-all' }}>
        {email}
      </p>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 4, padding: '22px 20px' }}>
      {children}
    </div>
  );
}

/** Écran d'issue (succès, lien mort, expiré) : une icône, une phrase, une
 *  action. Jamais une impasse — chaque état propose où aller ensuite. */
function Outcome({
  tone, title, body, children,
}: { tone: 'ok' | 'ko'; title?: string; body: string; children?: React.ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : XCircle;
  return (
    <Panel>
      <Icon className="h-11 w-11 mb-5" style={{ color: tone === 'ok' ? '#22C55E' : RED }} aria-hidden="true" />
      {title && (
        <h2
          className="font-display uppercase"
          style={{ color: WHITE, fontSize: 'clamp(20px, 5vw, 26px)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.05 }}
        >
          {title}
        </h2>
      )}
      <p style={{ color: GRAY_1, fontSize: 15, lineHeight: 1.6, marginTop: title ? 12 : 0 }}>{body}</p>
      {children}
    </Panel>
  );
}

export default function AcceptOrgMember() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user, loading: authLoading } = useAuth();

  const token = searchParams.get('token');

  const [checking, setChecking] = useState(true);
  const [invitation, setInvitation] = useState<InvitationView | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupCode, setLookupCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AcceptResult | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  // ── Lecture de l'invitation ────────────────────────────────────────────────
  // Par le SERVEUR, à partir du token : `org_members` n'a aucune policy anon, et
  // sa policy authenticated exige d'être déjà le membre. Lire la table depuis le
  // client rendait zéro ligne dans le cas NORMAL — lien ouvert depuis la boîte
  // mail, déconnecté — et la page n'aurait rien eu à afficher.
  useEffect(() => {
    if (!token) { setChecking(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await invokeEdgeFunction<{
          invitation?: {
            email: string; role: string; organization_name: string;
            status: string; requires_account_creation: boolean;
          };
          error?: string;
          code?: string;
        }>('accept-org-member', { body: { action: 'describe', token } });

        if (cancelled) return;
        if (error || !data?.invitation) {
          setLookupCode(data?.code ?? null);
          setLookupError(data?.error || error?.message || t('acceptInv.invalidLinkDesc'));
          return;
        }
        setInvitation({
          email: data.invitation.email,
          role: data.invitation.role,
          organizationName: data.invitation.organization_name || 'Yuno',
          status: data.invitation.status,
          requiresAccountCreation: !!data.invitation.requires_account_creation,
        });
      } catch (err: unknown) {
        if (!cancelled) setLookupError(err instanceof Error ? err.message : t('acceptInv.invalidLinkDesc'));
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const accept = async (withAuth: boolean) => {
    if (!token) return;
    setBusy(true);
    try {
      const headers: Record<string, string> = {};
      if (withAuth && user) {
        const { data: session } = await supabase.auth.getSession();
        if (session.session?.access_token) headers.Authorization = `Bearer ${session.session.access_token}`;
      }
      // `invokeEdgeFunction` plutôt que l'invoke nu : supabase-js jette le corps
      // JSON de toute réponse non-2xx et ne laisse que « Edge Function returned
      // a non-2xx status code ». C'est CE message que l'invité verrait à la
      // place de « vous êtes connecté avec un autre compte ».
      const { data, error } = await invokeEdgeFunction<{
        success?: boolean; error?: string; code?: string;
        account_created?: boolean; password_reset_sent?: boolean;
      }>('accept-org-member', {
        body: { action: 'accept', token, first_name: firstName || undefined, last_name: lastName || undefined },
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });

      const serverError = data?.error || error?.message;
      if (serverError) {
        setResult({ success: false, message: serverError, code: data?.code });
        return;
      }
      // Le cache d'appartenance est tenu en mémoire pour toute la session : sans
      // cette invalidation, la personne arrive dans l'app et se fait renvoyer
      // sur l'accueil par une garde qui la croit encore sans organisation.
      invalidateOrgMemberships();
      setResult({
        success: true,
        accountCreated: !!data?.account_created,
        passwordResetSent: !!data?.password_reset_sent,
      });
    } catch (err: unknown) {
      setResult({ success: false, message: err instanceof Error ? err.message : t('acceptInv.acceptError') });
    } finally {
      setBusy(false);
    }
  };

  const signOutAndStay = async () => {
    setBusy(true);
    try { await supabase.auth.signOut(); } catch { /* session déjà morte : le rechargement suffit */ }
    window.location.reload();
  };

  const emailMismatch =
    !!user?.email && !!invitation?.email &&
    user.email.toLowerCase() !== invitation.email.toLowerCase();

  // Acceptation automatique quand la personne est déjà connectée sur le BON
  // compte : elle a cliqué sur « accepter » dans l'email, on ne le lui redemande
  // pas. Un compte qui ne correspond pas ne déclenche RIEN.
  useEffect(() => {
    if (
      !authLoading && user && token && !result && !checking &&
      invitation && invitation.status === 'pending' && !emailMismatch && !busy
    ) {
      accept(true);
    }
  }, [user, authLoading, token, result, checking, invitation, emailMismatch]);

  const roleLabel = (r: string) =>
    r === 'admin' ? t('acceptOrg.role.admin')
    : r === 'editor' ? t('acceptOrg.role.editor')
    : r === 'scanner' ? t('acceptOrg.role.scanner')
    : r;
  const roleDesc = (r: string) =>
    r === 'admin' ? t('acceptOrg.roleDesc.admin')
    : r === 'editor' ? t('acceptOrg.roleDesc.editor')
    : r === 'scanner' ? t('acceptOrg.roleDesc.scanner')
    : '';

  const authRedirect = `/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;

  // ── Chargement ─────────────────────────────────────────────────────────────
  if (authLoading || checking) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center" role="status" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin motion-reduce:animate-none" style={{ color: RED }} aria-hidden="true" />
          <p className="font-mono uppercase mt-5" style={{ fontSize: 10.5, color: GRAY_3, letterSpacing: '0.16em' }}>
            {t('acceptOrg.kicker')}
          </p>
        </div>
      </Shell>
    );
  }

  // ── Lien sans token, ou illisible ──────────────────────────────────────────
  if (!token || (lookupError && !invitation)) {
    return (
      <Shell>
        <OrgHeader kicker={t('acceptOrg.kicker')} name={t('acceptInv.invalidLink')} />
        <Outcome
          tone="ko"
          body={
            !token || !lookupCode || lookupCode === 'not_found'
              ? t('acceptOrg.invalidLinkDesc')
              : (lookupError ?? t('acceptInv.invalidLinkDesc'))
          }
        >
          <button className="btn btn--primary w-full mt-6" onClick={() => navigate('/')}>
            {t('acceptInv.backHome')}
          </button>
        </Outcome>
      </Shell>
    );
  }

  // ── Invitation close ou périmée ────────────────────────────────────────────
  if (invitation && invitation.status !== 'pending' && !result) {
    const expired = invitation.status === 'expired';
    const revoked = invitation.status === 'revoked';
    return (
      <Shell>
        <OrgHeader kicker={t('acceptOrg.kicker')} name={invitation.organizationName} />
        <Outcome
          tone={expired || revoked ? 'ko' : 'ok'}
          title={expired ? t('acceptInv.expiredTitle') : revoked ? t('acceptOrg.revokedTitle') : t('acceptOrg.alreadyTitle')}
          body={expired ? t('acceptOrg.expiredDesc') : revoked ? t('acceptOrg.revokedDesc') : t('acceptOrg.alreadyDesc')}
        >
          {!expired && !revoked ? (
            <button className="btn btn--primary w-full mt-6" onClick={() => navigate('/organizer-app')}>
              {t('acceptOrg.goToApp')} <ArrowRight className="h-4 w-4 ml-1.5" aria-hidden="true" />
            </button>
          ) : (
            <button className="btn btn--ghost w-full mt-6" onClick={() => navigate('/')}>
              {t('acceptInv.backHome')}
            </button>
          )}
        </Outcome>
      </Shell>
    );
  }

  // ── Connecté sur un AUTRE compte ───────────────────────────────────────────
  // Le cas le plus fréquent : on ouvre ses mails sur le téléphone où l'app est
  // déjà connectée au compte de tous les jours. On bascule ICI, sans renvoyer
  // la personne se débrouiller dans les réglages.
  if (emailMismatch && invitation && !result) {
    return (
      <Shell>
        <OrgHeader kicker={t('acceptOrg.kicker')} name={invitation.organizationName} />
        <Panel>
          <UserCog className="h-10 w-10 mb-5" style={{ color: RED }} aria-hidden="true" />
          <h2
            className="font-display uppercase"
            style={{ color: WHITE, fontSize: 'clamp(20px, 5vw, 26px)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.05 }}
          >
            {t('acceptInv.wrongAccountTitle')}
          </h2>
          <p style={{ color: GRAY_1, fontSize: 15, lineHeight: 1.6, marginTop: 12 }}>
            {t('acceptInv.wrongAccountDesc')
              .replace('{signedIn}', user?.email ?? '')
              .replace('{invited}', invitation.email)}
          </p>
          <button className="btn btn--primary w-full mt-6" onClick={signOutAndStay} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none mr-2" aria-hidden="true" />}
            {t('acceptInv.switchAccount')}
          </button>
        </Panel>
      </Shell>
    );
  }

  // ── En cours ───────────────────────────────────────────────────────────────
  if (busy && !result) {
    return (
      <Shell>
        <OrgHeader kicker={t('acceptOrg.kicker')} name={invitation?.organizationName ?? 'Yuno'} />
        <Panel>
          <div className="flex items-center gap-3" role="status" aria-live="polite">
            <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none flex-none" style={{ color: RED }} aria-hidden="true" />
            <p style={{ color: GRAY_1, fontSize: 15 }}>
              {invitation?.requiresAccountCreation ? t('acceptInv.creatingAccount') : t('acceptInv.accepting')}
            </p>
          </div>
        </Panel>
      </Shell>
    );
  }

  // ── Issue ──────────────────────────────────────────────────────────────────
  if (result) {
    if (result.success) {
      return (
        <Shell>
          <OrgHeader kicker={t('acceptOrg.kickerJoined')} name={invitation?.organizationName ?? 'Yuno'} />
          <Outcome
            tone="ok"
            title={result.accountCreated ? t('acceptInv.accountCreated') : t('acceptOrg.welcomeTitle')}
            body={
              result.accountCreated
                ? t('acceptOrg.welcomeNewAccount')
                : t('acceptOrg.welcomeDesc').replace('{role}', roleLabel(invitation?.role ?? ''))
            }
          >
            {result.passwordResetSent && (
              <div className="flex items-start gap-3 mt-5" style={{ background: 'rgba(232,25,44,0.06)', border: `1px solid rgba(232,25,44,0.22)`, borderRadius: 4, padding: '14px 16px' }}>
                <Mail className="h-4 w-4 mt-0.5 flex-none" style={{ color: RED }} aria-hidden="true" />
                <p style={{ color: GRAY_1, fontSize: 13.5, lineHeight: 1.55 }}>{t('acceptInv.passwordEmailSent')}</p>
              </div>
            )}
            <button
              className="btn btn--primary w-full mt-6"
              onClick={() => navigate(result.accountCreated ? '/auth' : '/organizer-app')}
            >
              {result.accountCreated ? t('acceptInv.login') : t('acceptOrg.goToApp')}
              <ArrowRight className="h-4 w-4 ml-1.5" aria-hidden="true" />
            </button>
          </Outcome>
        </Shell>
      );
    }

    return (
      <Shell>
        <OrgHeader kicker={t('acceptOrg.kicker')} name={invitation?.organizationName ?? 'Yuno'} />
        <Panel>
          <XCircle className="h-10 w-10 mb-5" style={{ color: RED }} aria-hidden="true" />
          <h2
            className="font-display uppercase"
            style={{ color: WHITE, fontSize: 'clamp(20px, 5vw, 26px)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.05 }}
          >
            {t('acceptInv.error')}
          </h2>
          <p role="alert" style={{ color: GRAY_1, fontSize: 15, lineHeight: 1.6, marginTop: 12 }}>{result.message}</p>
          {result.code === 'email_mismatch' ? (
            <button className="btn btn--primary w-full mt-6" onClick={signOutAndStay} disabled={busy}>
              {t('acceptInv.switchAccount')}
            </button>
          ) : result.code === 'sign_in_required' ? (
            <button className="btn btn--primary w-full mt-6" onClick={() => navigate(authRedirect)}>
              <LogIn className="h-4 w-4 mr-2" aria-hidden="true" />{t('acceptInv.login')}
            </button>
          ) : (
            <button className="btn btn--primary w-full mt-6" onClick={() => { setResult(null); accept(!!user); }}>
              {t('acceptInv.retry')}
            </button>
          )}
          <button className="btn btn--ghost w-full mt-3" onClick={() => navigate('/')}>
            {t('acceptInv.backHome')}
          </button>
        </Panel>
      </Shell>
    );
  }

  // ── Pas connecté : créer son compte, ou se connecter ───────────────────────
  if (!user && invitation) {
    return (
      <Shell>
        <OrgHeader kicker={t('acceptOrg.kickerInvited')} name={invitation.organizationName} />
        <RoleCallout
          roleHint={t('acceptOrg.yourRole')}
          roleLabel={roleLabel(invitation.role)}
          email={invitation.email}
        />
        <Panel>
          <p style={{ color: GRAY_1, fontSize: 14.5, lineHeight: 1.6 }}>{roleDesc(invitation.role)}</p>

          {invitation.requiresAccountCreation ? (
            <form
              className="mt-6 space-y-4"
              onSubmit={(e) => { e.preventDefault(); accept(false); }}
            >
              <div>
                <label
                  htmlFor="org-first-name"
                  className="font-mono uppercase block mb-2"
                  style={{ fontSize: 9.5, color: GRAY_3, letterSpacing: '0.14em', fontWeight: 600 }}
                >
                  {t('acceptInv.firstName')}
                </label>
                <input
                  id="org-first-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="given-name"
                  placeholder={t('acceptInv.firstNamePh')}
                  className="w-full focus:outline-none focus:ring-2"
                  style={{ background: '#1F1F22', border: `1px solid ${BORDER}`, borderRadius: 4, color: WHITE, fontSize: 16, height: 46, padding: '0 14px' }}
                />
              </div>
              <div>
                <label
                  htmlFor="org-last-name"
                  className="font-mono uppercase block mb-2"
                  style={{ fontSize: 9.5, color: GRAY_3, letterSpacing: '0.14em', fontWeight: 600 }}
                >
                  {t('acceptInv.lastName')}
                </label>
                <input
                  id="org-last-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="family-name"
                  placeholder={t('acceptInv.lastNamePh')}
                  className="w-full focus:outline-none focus:ring-2"
                  style={{ background: '#1F1F22', border: `1px solid ${BORDER}`, borderRadius: 4, color: WHITE, fontSize: 16, height: 46, padding: '0 14px' }}
                />
              </div>
              <p style={{ color: GRAY_3, fontSize: 12.5, lineHeight: 1.5 }}>{t('acceptInv.loginLinkSent')}</p>

              <button type="submit" className="btn btn--primary w-full" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none mr-2" aria-hidden="true" />}
                {t('acceptInv.createAndAccept')}
              </button>
            </form>
          ) : (
            <button className="btn btn--primary w-full mt-6" onClick={() => navigate(authRedirect)}>
              <LogIn className="h-4 w-4 mr-2" aria-hidden="true" />{t('acceptInv.login')}
            </button>
          )}

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center"><div className="w-full" style={{ borderTop: `1px solid ${BORDER}` }} /></div>
            <div className="relative flex justify-center">
              <span className="font-mono uppercase px-3" style={{ background: CARD, fontSize: 9.5, color: GRAY_3, letterSpacing: '0.16em' }}>
                {t('acceptInv.or')}
              </span>
            </div>
          </div>

          <button className="btn btn--ghost w-full" onClick={() => navigate(authRedirect)}>
            {t('acceptInv.haveAccount')}
          </button>
        </Panel>
      </Shell>
    );
  }

  // ── Dernier recours ────────────────────────────────────────────────────────
  // Invitation lisible mais aucun cas ci-dessus (course entre deux états).
  // Ce chemin rendait `null` dans les pages sœurs — une page BLANCHE, sans rien
  // à toucher. On propose toujours une action.
  return (
    <Shell>
      <OrgHeader kicker={t('acceptOrg.kickerInvited')} name={invitation?.organizationName ?? 'Yuno'} />
      {invitation && (
        <RoleCallout
          roleHint={t('acceptOrg.yourRole')}
          roleLabel={roleLabel(invitation.role)}
          email={invitation.email}
        />
      )}
      <Panel>
        <button className="btn btn--primary w-full" onClick={() => accept(!!user)} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none mr-2" aria-hidden="true" />}
          {t('acceptOrg.acceptCta')}
        </button>
        <button className="btn btn--ghost w-full mt-3" onClick={() => navigate(authRedirect)}>
          {t('acceptInv.haveAccount')}
        </button>
      </Panel>
    </Shell>
  );
}
