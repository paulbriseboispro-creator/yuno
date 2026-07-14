import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, XCircle, Loader2, LogIn, Mail, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';

const ROLE_LABELS: Record<string, string> = {
  barman: 'Barman',
  bouncer: 'Videur',
  cloakroom: 'Vestiaire',
  vip_host: 'VIP Host',
  manager: 'Manager',
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
    requires_account_creation: boolean;
  } | null>(null);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
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
      try {
        const { data: invitation, error } = await supabase
          .from('staff_invitations')
          .select('email, status, expires_at, role, venue_id, organizer_user_id, venues(name)')
          .eq('token', token)
          .single();

        if (error || !invitation) {
          setCheckingInvitation(false);
          return;
        }

        let inviterName = (invitation.venues as any)?.name || 'Yuno';
        if (invitation.organizer_user_id) {
          const { data: orgProfile } = await supabase
            .from('organizer_profiles')
            .select('display_name')
            .eq('user_id', invitation.organizer_user_id)
            .maybeSingle();
          inviterName = orgProfile?.display_name || 'Une organisation';
        }

        const { data: profiles } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', invitation.email.toLowerCase())
          .limit(1);
        const hasAccount = profiles && profiles.length > 0;

        setInvitationData({
          email: invitation.email,
          inviter_name: inviterName,
          role: invitation.role,
          requires_account_creation: !hasAccount,
        });
      } catch (err) {
        console.error('Error checking staff invitation:', err);
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

      const response = await supabase.functions.invoke('accept-staff-invitation', {
        body: { token, first_name: firstName || undefined, last_name: lastName || undefined },
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });

      if (response.error) throw new Error(response.error.message);

      if (response.data.error) {
        setResult({ success: false, message: response.data.error });
      } else {
        setResult({
          success: true,
          message: response.data.message,
          account_created: response.data.account_created,
          password_reset_sent: response.data.password_reset_sent,
        });
        toast.success(response.data.message);
      }
    } catch (error: any) {
      console.error('Error accepting staff invitation:', error);
      setResult({ success: false, message: error.message || t('acceptInv.acceptError') });
    } finally {
      setLoading(false);
    }
  };

  // Auto-accept when already logged in with a matching account.
  useEffect(() => {
    if (!authLoading && user && token && !result && !checkingInvitation && invitationData) {
      acceptInvitation(true);
    }
  }, [user, authLoading, token, result, checkingInvitation, invitationData]);

  const roleLabel = invitationData ? (ROLE_LABELS[invitationData.role] || invitationData.role) : '';

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
              <Button
                className="mt-6 h-11"
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
              <Button className="mt-6 h-11" onClick={() => navigate('/')}>{t('acceptInv.backHome')}</Button>
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

  return null;
}
