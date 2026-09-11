import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { canHandOffToProApp, openProApp } from '@/lib/native';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, XCircle, Loader2, LogIn, Mail, UserPlus, Smartphone, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';

// Libellés de poste : la page était figée en français alors qu'une invitation
// part vers n'importe quel pays. Les clés vivent avec le reste de l'identité staff.
const ROLE_LABEL_KEYS: Record<string, string> = {
  barman: 'staffid.role.barman',
  bouncer: 'staffid.role.bouncer',
  cloakroom: 'staffid.role.cloakroom',
  vip_host: 'staffid.role.vipHost',
  manager: 'staffid.role.manager',
};

/**
 * Page plein écran de l'app Pro : elle ne reçoit aucun chrome global, donc
 * l'encoche et la barre d'accueil sont à sa charge. 100dvh (et non 100vh) pour
 * que la carte se recentre dans la zone visible quand le clavier iOS s'ouvre.
 */
const PAGE_WRAP = 'min-h-[100dvh] flex items-center justify-center bg-background px-4';
const PAGE_SAFE = {
  paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
  paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
};

/**
 * Bouton « Ouvrir dans Yuno Pro ».
 *
 * Une invitation de staff se termine TOUJOURS dans l'app Pro (code PIN, scan à
 * la porte). Mais le lien de l'email est un Universal Link de yunoapp.eu, et le
 * fichier d'association ne déclare que l'app CLIENT : le lien ouvre donc la
 * mauvaise app, ou reste dans Safari. Ce bouton passe par le schéma
 * `yunopro://`, déjà compilé dans le binaire Pro — il marche sur les apps DÉJÀ
 * installées, sans attendre une nouvelle version.
 *
 * Jamais de redirection automatique : sans l'app Pro, iOS laisserait une page
 * morte. C'est un geste, proposé seulement sur un téléphone hors app Pro.
 */
function ProHandoff({ path }: { path: string }) {
  const { t } = useLanguage();
  if (!canHandOffToProApp()) return null;
  return (
    <Button className="mt-6 h-11 w-full" onClick={() => openProApp(path)}>
      <Smartphone className="h-4 w-4 mr-2 flex-none" />
      <span className="truncate">{t('acceptInv.openProApp')}</span>
    </Button>
  );
}

export default function AcceptStaffInvitation() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(false);
  const [checkingInvitation, setCheckingInvitation] = useState(true);
  const [invitationData, setInvitationData] = useState<{
    email: string;
    inviter_name: string;
    role: string;
    status: string;
    requires_account_creation: boolean;
  } | null>(null);
  /** Cause de lecture impossible (token inconnu, réseau) — jamais un écran blanc. */
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    code?: string;
    account_created?: boolean;
    password_reset_sent?: boolean;
  } | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  const token = searchParams.get('token');

  useEffect(() => {
    const checkInvitation = async () => {
      if (!token) {
        setCheckingInvitation(false);
        return;
      }
      // L'invitation est lue PAR LE SERVEUR, à partir du token.
      // `staff_invitations` n'a aucune policy anon, et sa policy authenticated
      // exige que l'email du compte connecté soit celui de l'invitation : lire
      // la table depuis le client rendait zéro ligne dans le cas NORMAL (lien
      // ouvert depuis la boîte mail, déconnecté) comme dans le cas fréquent
      // (connecté sur son compte de tous les jours). La page finissait sur un
      // écran blanc. Le token est la pièce d'identité du lien ; c'est au serveur
      // de le lire.
      try {
        const { data, error } = await invokeEdgeFunction<{
          email?: string;
          inviter_name?: string;
          role?: string;
          status?: string;
          requires_account_creation?: boolean;
          error?: string;
        }>('accept-staff-invitation', { body: { action: 'describe_invitation', token } });

        if (error || !data?.email) {
          setLookupError(data?.error || error?.message || t('acceptInv.invalidLinkDesc'));
          return;
        }

        setInvitationData({
          email: data.email,
          inviter_name: data.inviter_name || 'Yuno',
          role: data.role || '',
          status: data.status || 'pending',
          requires_account_creation: !!data.requires_account_creation,
        });
      } catch (err: unknown) {
        console.error('Error checking staff invitation:', err);
        setLookupError(err instanceof Error ? err.message : t('acceptInv.invalidLinkDesc'));
      } finally {
        setCheckingInvitation(false);
      }
    };

    checkInvitation();
  }, [token]);

  const acceptInvitation = async (withAuth = true) => {
    if (!token) return;
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (withAuth && user) {
        const { data: session } = await supabase.auth.getSession();
        if (session.session?.access_token) {
          headers.Authorization = `Bearer ${session.session.access_token}`;
        }
      }

      // `invokeEdgeFunction` plutôt que l'invoke nu : supabase-js jette le corps
      // JSON de toute réponse non-2xx et ne laisse que « Edge Function returned a
      // non-2xx status code ». C'est CE message que voyait l'employé à la place
      // de « vous êtes connecté avec un autre compte ».
      const { data, error } = await invokeEdgeFunction<{
        success?: boolean;
        message?: string;
        error?: string;
        code?: string;
        invited_email?: string;
        signed_in_email?: string;
        account_created?: boolean;
        password_reset_sent?: boolean;
      }>('accept-staff-invitation', {
        body: { token, first_name: firstName || undefined, last_name: lastName || undefined },
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });

      const serverError = data?.error || error?.message;
      if (serverError) {
        setResult({ success: false, message: serverError, code: data?.code });
        return;
      }

      setResult({
        success: true,
        message: data?.message ?? '',
        account_created: data?.account_created,
        password_reset_sent: data?.password_reset_sent,
      });
      toast.success(data?.message ?? '');
    } catch (error: unknown) {
      console.error('Error accepting staff invitation:', error);
      setResult({
        success: false,
        message: error instanceof Error ? error.message : t('acceptInv.acceptError'),
      });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Connecté sur un AUTRE compte que celui invité. C'est le cas le plus courant
   * (on ouvre ses mails sur le téléphone où l'app est déjà connectée), et c'est
   * celui qui produisait un cul-de-sac : on se déconnecte ICI et on reste sur le
   * lien, au lieu de renvoyer la personne se débrouiller dans les réglages.
   */
  const emailMismatch =
    !!user?.email && !!invitationData?.email &&
    user.email.toLowerCase() !== invitationData.email.toLowerCase();

  const signOutAndStay = async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut();
    } catch {
      // Session déjà morte côté serveur : le rechargement suffit.
    }
    window.location.reload();
  };

  // Auto-accept when already logged in with a matching account. Un compte qui ne
  // correspond pas ne déclenche RIEN : on lui montre la carte de bascule.
  useEffect(() => {
    if (
      !authLoading && user && token && !result && !checkingInvitation &&
      invitationData && invitationData.status === 'pending' && !emailMismatch
    ) {
      acceptInvitation(true);
    }
  }, [user, authLoading, token, result, checkingInvitation, invitationData, emailMismatch]);

  const roleLabel = invitationData
    ? (ROLE_LABEL_KEYS[invitationData.role] ? t(ROLE_LABEL_KEYS[invitationData.role]) : invitationData.role)
    : '';

  if (authLoading || checkingInvitation) {
    return (
      <div className={PAGE_WRAP} style={PAGE_SAFE}>
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!token) {
    return (
      <div className={PAGE_WRAP} style={PAGE_SAFE}>
        <Card className="p-6 sm:p-8 text-center max-w-md">
          <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">{t('acceptInv.invalidLink')}</h1>
          <p className="text-muted-foreground break-words">{t('acceptInv.invalidLinkDesc')}</p>
          <Button className="mt-6 h-11" onClick={() => navigate('/')}>{t('acceptInv.backHome')}</Button>
        </Card>
      </div>
    );
  }

  // Lien illisible (token inconnu, invitation supprimée, réseau coupé).
  if (lookupError && !invitationData) {
    return (
      <div className={PAGE_WRAP} style={PAGE_SAFE}>
        <Card className="p-6 sm:p-8 text-center max-w-md">
          <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">{t('acceptInv.invalidLink')}</h1>
          <p className="text-muted-foreground break-words">{lookupError}</p>
          <Button className="mt-6 h-11" onClick={() => navigate('/')}>{t('acceptInv.backHome')}</Button>
        </Card>
      </div>
    );
  }

  // Invitation déjà acceptée ou expirée : on le dit, et on pousse vers la suite
  // utile (se connecter, poser son code PIN) au lieu d'un refus sec du serveur.
  if (invitationData && invitationData.status !== 'pending' && !result) {
    const isExpired = invitationData.status === 'expired';
    return (
      <div className={PAGE_WRAP} style={PAGE_SAFE}>
        <Card className="p-6 sm:p-8 text-center max-w-md">
          {isExpired ? (
            <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
          ) : (
            <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
          )}
          <h1 className="text-xl font-semibold mb-2 break-words">
            {isExpired ? t('acceptInv.expiredTitle') : t('acceptInv.alreadyAcceptedTitle')}
          </h1>
          <p className="text-muted-foreground break-words">
            {isExpired ? t('acceptInv.expiredDesc') : t('acceptInv.alreadyAcceptedDesc')}
          </p>
          {!isExpired && <ProHandoff path="/setup-pin" />}
          <Button
            variant={isExpired ? 'default' : 'outline'}
            className="mt-3 h-11 w-full"
            onClick={() => navigate(isExpired ? '/' : '/setup-pin')}
          >
            {isExpired ? t('acceptInv.backHome') : t('acceptStaff.setPin')}
          </Button>
        </Card>
      </div>
    );
  }

  // Connecté sur un autre compte que l'invité : on bascule ici, sans détour.
  if (emailMismatch && invitationData && !result) {
    return (
      <div className={PAGE_WRAP} style={PAGE_SAFE}>
        <Card className="p-6 sm:p-8 text-center max-w-md w-full">
          <UserCog className="h-16 w-16 text-primary mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2 break-words">{t('acceptInv.wrongAccountTitle')}</h1>
          <p className="text-muted-foreground break-words">
            {t('acceptInv.wrongAccountDesc')
              .replace('{signedIn}', user?.email ?? '')
              .replace('{invited}', invitationData.email)}
          </p>
          <div className="mt-4 p-3 bg-primary/10 rounded-lg">
            <p className="text-xs text-muted-foreground">{t('acceptStaff.yourRole')}</p>
            <p className="text-lg font-bold text-primary break-words">
              {invitationData.inviter_name} · {roleLabel}
            </p>
          </div>
          <Button className="mt-6 h-11 w-full" onClick={signOutAndStay} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2 flex-none" /> : null}
            <span className="truncate">{t('acceptInv.switchAccount')}</span>
          </Button>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={PAGE_WRAP} style={PAGE_SAFE}>
        <Card className="p-6 sm:p-8 text-center max-w-md">
          <Loader2 className="h-16 w-16 animate-spin text-primary mx-auto mb-4" />
          <h1 className="text-xl font-semibold">{t('acceptInv.processing')}</h1>
          <p className="text-muted-foreground mt-2 break-words">
            {invitationData?.requires_account_creation ? t('acceptInv.creatingAccount') : t('acceptInv.accepting')}
          </p>
        </Card>
      </div>
    );
  }

  if (result) {
    return (
      <div className={PAGE_WRAP} style={PAGE_SAFE}>
        <Card className="p-6 sm:p-8 text-center max-w-md">
          {result.success ? (
            <>
              <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
              <h1 className="text-xl font-semibold mb-2">
                {result.account_created ? t('acceptInv.accountCreated') : t('acceptInv.invitationAccepted')}
              </h1>
              <p className="text-muted-foreground break-words">{result.message}</p>
              {result.password_reset_sent && (
                <div className="mt-4 p-3 bg-primary/10 rounded-lg">
                  <Mail className="h-5 w-5 text-primary mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground break-words">{t('acceptInv.passwordEmailSent')}</p>
                </div>
              )}
              {/* La suite du métier (PIN puis scan) vit dans l'app Pro. */}
              <ProHandoff path={result.account_created ? '/auth' : '/setup-pin'} />
              <Button
                variant={canHandOffToProApp() ? 'outline' : 'default'}
                className="mt-3 h-11 w-full"
                onClick={() => navigate(result.account_created ? '/auth' : '/setup-pin')}
              >
                {result.account_created ? t('acceptInv.login') : t('acceptStaff.setPin')}
              </Button>
            </>
          ) : (
            <>
              <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
              <h1 className="text-xl font-semibold mb-2">{t('acceptInv.error')}</h1>
              <p className="text-muted-foreground break-words">{result.message}</p>
              {result.code === 'email_mismatch' ? (
                <Button className="mt-6 h-11 w-full" onClick={signOutAndStay} disabled={loading}>
                  <span className="truncate">{t('acceptInv.switchAccount')}</span>
                </Button>
              ) : (
                <Button className="mt-6 h-11 w-full" onClick={() => { setResult(null); acceptInvitation(!!user); }}>
                  <span className="truncate">{t('acceptInv.retry')}</span>
                </Button>
              )}
              <Button variant="outline" className="mt-3 h-11 w-full" onClick={() => navigate('/')}>
                {t('acceptInv.backHome')}
              </Button>
            </>
          )}
        </Card>
      </div>
    );
  }

  if (!user && invitationData) {
    if (invitationData.requires_account_creation) {
      return (
        <div className={PAGE_WRAP} style={PAGE_SAFE}>
          <Card className="p-6 sm:p-8 max-w-md w-full">
            <div className="text-center mb-6">
              <UserPlus className="h-12 w-12 sm:h-16 sm:w-16 text-primary mx-auto mb-4" />
              <h1 className="text-xl font-semibold mb-2 break-words">{t('acceptStaff.joinTeam')}</h1>
              <p className="text-muted-foreground text-sm break-words">
                <strong className="text-primary">{invitationData.inviter_name}</strong> {t('acceptInv.invitesYouToTeam')}
              </p>
              <div className="mt-3 p-2 bg-primary/10 rounded-lg">
                <p className="text-xs text-muted-foreground">{t('acceptStaff.yourRole')}</p>
                <p className="text-lg font-bold text-primary break-words">{roleLabel}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <Label>{t('acceptInv.firstName')}</Label>
                <Input placeholder={t('acceptInv.firstNamePh')} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div>
                <Label>{t('acceptInv.lastName')}</Label>
                <Input placeholder={t('acceptInv.lastNamePh')} value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
              <div>
                <Label>Email</Label>
                {/* L'email est un seul mot insécable : `text-ellipsis` évite qu'il
                    déborde de la carte sur un téléphone. */}
                <Input value={invitationData.email} disabled className="bg-muted text-ellipsis" />
                <p className="text-xs text-muted-foreground mt-1 break-words">{t('acceptInv.loginLinkSent')}</p>
              </div>

              <Button className="w-full h-11" onClick={() => acceptInvitation(false)} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2 flex-none" /> : null}
                <span className="truncate">{t('acceptInv.createAndAccept')}</span>
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t" /></div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">{t('acceptInv.or')}</span>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full h-11"
                onClick={() => navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)}
              >
                <LogIn className="h-4 w-4 mr-2 flex-none" />
                <span className="truncate">{t('acceptInv.haveAccount')}</span>
              </Button>
            </div>
          </Card>
        </div>
      );
    }

    return (
      <div className={PAGE_WRAP} style={PAGE_SAFE}>
        <Card className="p-6 sm:p-8 text-center max-w-md">
          <LogIn className="h-16 w-16 text-primary mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2 break-words">{t('acceptInv.loginRequired')}</h1>
          <p className="text-muted-foreground mb-2 break-words">{t('acceptInv.loginRequiredDesc')}</p>
          <p className="text-primary font-medium mb-6 break-words">{invitationData.inviter_name} · {roleLabel}</p>
          <Button className="h-11" onClick={() => navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)}>
            {t('acceptInv.login')}
          </Button>
        </Card>
      </div>
    );
  }

  /**
   * Dernier recours : invitation lisible mais aucun des cas ci-dessus (connecté
   * sans profil, course entre deux états). Avant, ce chemin rendait `null` —
   * une page BLANCHE, sans rien à toucher. On propose toujours une action.
   */
  return (
    <div className={PAGE_WRAP} style={PAGE_SAFE}>
      <Card className="p-6 sm:p-8 text-center max-w-md w-full">
        <UserPlus className="h-16 w-16 text-primary mx-auto mb-4" />
        <h1 className="text-xl font-semibold mb-2 break-words">{t('acceptStaff.joinTeam')}</h1>
        {invitationData && (
          <p className="text-primary font-medium mb-6 break-words">
            {invitationData.inviter_name} · {roleLabel}
          </p>
        )}
        <Button className="h-11 w-full" onClick={() => acceptInvitation(!!user)} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2 flex-none" /> : null}
          <span className="truncate">{t('acceptInv.createAndAccept')}</span>
        </Button>
        <Button
          variant="outline"
          className="mt-3 h-11 w-full"
          onClick={() => navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)}
        >
          <LogIn className="h-4 w-4 mr-2 flex-none" />
          <span className="truncate">{t('acceptInv.haveAccount')}</span>
        </Button>
      </Card>
    </div>
  );
}
