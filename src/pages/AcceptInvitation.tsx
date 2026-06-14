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

type InvitationType = 'dj' | 'promoter';

export default function AcceptInvitation() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user, loading: authLoading } = useAuth();
  
  const [loading, setLoading] = useState(false);
  const [checkingInvitation, setCheckingInvitation] = useState(true);
  const [invitationData, setInvitationData] = useState<{
    email: string;
    venue_name: string;
    promo_code?: string;
    requires_account_creation: boolean;
  } | null>(null);
  const [result, setResult] = useState<{ 
    success: boolean; 
    message: string; 
    venue_name?: string;
    account_created?: boolean;
    password_reset_sent?: boolean;
  } | null>(null);
  
  // Form for new account
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  
  const token = searchParams.get('token');
  const type: InvitationType = window.location.pathname.includes('promoter') ? 'promoter' : 'dj';

  // Check invitation status on load
  useEffect(() => {
    const checkInvitation = async () => {
      if (!token) {
        setCheckingInvitation(false);
        return;
      }

      try {
        let email = '';
        let venueName = 'Club';
        let promoCode: string | undefined;

        if (type === 'dj') {
          const { data: invitation, error } = await supabase
            .from('dj_invitations')
            .select('email, status, expires_at, venues(name)')
            .eq('token', token)
            .single();

          if (error || !invitation) {
            setCheckingInvitation(false);
            return;
          }
          email = invitation.email;
          venueName = (invitation.venues as any)?.name || 'Club';
        } else {
          const { data: invitation, error } = await supabase
            .from('promoter_invitations')
            .select('email, status, expires_at, venues(name), promo_code, commission_config')
            .eq('token', token)
            .single();

          if (error || !invitation) {
            setCheckingInvitation(false);
            return;
          }
          email = invitation.email;
          venueName = (invitation.venues as any)?.name || 'Club';
          promoCode = invitation.promo_code;
          
          // Use the has_yuno_account flag stored in commission_config
          const commissionConfig = invitation.commission_config as { has_yuno_account?: boolean } | null;
          const hasAccountFromInvite = commissionConfig?.has_yuno_account;
          
          setInvitationData({
            email,
            venue_name: venueName,
            promo_code: promoCode,
            requires_account_creation: !hasAccountFromInvite,
          });
          return;
        }

        // For DJ invitations, check if account exists
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', email.toLowerCase())
          .limit(1);

        const hasAccount = profiles && profiles.length > 0;
        
        setInvitationData({
          email,
          venue_name: venueName,
          promo_code: promoCode,
          requires_account_creation: !hasAccount,
        });
      } catch (error) {
        console.error('Error checking invitation:', error);
      } finally {
        setCheckingInvitation(false);
      }
    };

    checkInvitation();
  }, [token, type]);

  const acceptInvitation = async (withAuth: boolean = true) => {
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
      
      const functionName = type === 'dj' ? 'accept-dj-invitation' : 'accept-promoter-invitation';
      
      const response = await supabase.functions.invoke(functionName, {
        body: { 
          token,
          first_name: firstName || undefined,
          last_name: lastName || undefined,
        },
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      if (response.data.error) {
        setResult({ success: false, message: response.data.error });
      } else {
        setResult({ 
          success: true, 
          message: response.data.message,
          venue_name: response.data.venue_name,
          account_created: response.data.account_created,
          password_reset_sent: response.data.password_reset_sent,
        });
        toast.success(response.data.message);
      }
    } catch (error: any) {
      console.error('Error accepting invitation:', error);
      setResult({ success: false, message: error.message || t('acceptInv.acceptError') });
    } finally {
      setLoading(false);
    }
  };

  // Auto-accept if user is already logged in
  useEffect(() => {
    if (!authLoading && user && token && !result && !checkingInvitation && invitationData) {
      // If logged in user's email matches invitation, auto-accept
      acceptInvitation(true);
    }
  }, [user, authLoading, token, result, checkingInvitation, invitationData]);

  if (authLoading || checkingInvitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="p-8 text-center max-w-md">
          <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">{t('acceptInv.invalidLink')}</h1>
          <p className="text-muted-foreground">
            {t('acceptInv.invalidLinkDesc')}
          </p>
          <Button className="mt-6" onClick={() => navigate('/')}>
            {t('acceptInv.backHome')}
          </Button>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="p-8 text-center max-w-md">
          <Loader2 className="h-16 w-16 animate-spin text-primary mx-auto mb-4" />
          <h1 className="text-xl font-semibold">{t('acceptInv.processing')}</h1>
          <p className="text-muted-foreground mt-2">
            {invitationData?.requires_account_creation
              ? t('acceptInv.creatingAccount')
              : t('acceptInv.accepting')}
          </p>
        </Card>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="p-8 text-center max-w-md">
          {result.success ? (
            <>
              <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
              <h1 className="text-xl font-semibold mb-2">
                {result.account_created ? t('acceptInv.accountCreated') : t('acceptInv.invitationAccepted')}
              </h1>
              <p className="text-muted-foreground">
                {result.message}
              </p>
              {result.venue_name && (
                <p className="text-primary font-medium mt-2">
                  {result.venue_name}
                </p>
              )}
              {result.password_reset_sent && (
                <div className="mt-4 p-3 bg-primary/10 rounded-lg">
                  <Mail className="h-5 w-5 text-primary mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {t('acceptInv.passwordEmailSent')}
                  </p>
                </div>
              )}
              <Button 
                className="mt-6" 
                onClick={() => {
                  if (result.account_created) {
                    navigate('/auth');
                  } else {
                    navigate(type === 'dj' ? '/dj' : '/promoter');
                  }
                }}
              >
                {result.account_created
                  ? t('acceptInv.login')
                  : (type === 'dj' ? t('acceptInv.accessSpaceDj') : t('acceptInv.accessSpacePromoter'))}
              </Button>
            </>
          ) : (
            <>
              <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
              <h1 className="text-xl font-semibold mb-2">{t('acceptInv.error')}</h1>
              <p className="text-muted-foreground">
                {result.message}
              </p>
              <Button className="mt-6" onClick={() => navigate('/')}>
                {t('acceptInv.backHome')}
              </Button>
            </>
          )}
        </Card>
      </div>
    );
  }

  // Not logged in - show options
  if (!user && invitationData) {
    // If requires account creation, show form
    if (invitationData.requires_account_creation) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <Card className="p-8 max-w-md w-full">
            <div className="text-center mb-6">
              <UserPlus className="h-16 w-16 text-primary mx-auto mb-4" />
              <h1 className="text-xl font-semibold mb-2">{type === 'dj' ? t('acceptInv.createAccountTitleDj') : t('acceptInv.createAccountTitlePromoter')}</h1>
              <p className="text-muted-foreground text-sm">
                <strong className="text-primary">{invitationData.venue_name}</strong> {t('acceptInv.invitesYouToTeam')}
              </p>
              {invitationData.promo_code && (
                <div className="mt-3 p-2 bg-primary/10 rounded-lg">
                  <p className="text-xs text-muted-foreground">{t('acceptInv.yourPromoCode')}</p>
                  <p className="text-lg font-bold text-primary">{invitationData.promo_code}</p>
                </div>
              )}
            </div>
            
            <div className="space-y-4">
              <div>
                <Label>{t('acceptInv.firstName')}</Label>
                <Input
                  placeholder={t('acceptInv.firstNamePh')}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div>
                <Label>{t('acceptInv.lastName')}</Label>
                <Input
                  placeholder={t('acceptInv.lastNamePh')}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  value={invitationData.email}
                  disabled
                  className="bg-muted"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('acceptInv.loginLinkSent')}
                </p>
              </div>

              <Button
                className="w-full"
                onClick={() => acceptInvitation(false)}
                disabled={loading}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {t('acceptInv.createAndAccept')}
              </Button>
              
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">{t('acceptInv.or')}</span>
                </div>
              </div>
              
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)}
              >
                <LogIn className="h-4 w-4 mr-2" />
                {t('acceptInv.haveAccount')}
              </Button>
            </div>
          </Card>
        </div>
      );
    }

    // Has account but not logged in
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="p-8 text-center max-w-md">
          <LogIn className="h-16 w-16 text-primary mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">{t('acceptInv.loginRequired')}</h1>
          <p className="text-muted-foreground mb-2">
            {t('acceptInv.loginRequiredDesc')}
          </p>
          <p className="text-primary font-medium mb-6">{invitationData.venue_name}</p>
          {invitationData.promo_code && (
            <div className="mb-6 p-2 bg-primary/10 rounded-lg">
              <p className="text-xs text-muted-foreground">{t('acceptInv.yourPromoCode')}</p>
              <p className="text-lg font-bold text-primary">{invitationData.promo_code}</p>
            </div>
          )}
          <Button onClick={() => navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)}>
            {t('acceptInv.login')}
          </Button>
        </Card>
      </div>
    );
  }

  return null;
}
