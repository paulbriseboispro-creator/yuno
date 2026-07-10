import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useUserRoles } from '@/hooks/useUserRoles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { motion } from 'framer-motion';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { ArrowLeft, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { recordLegalAcceptance } from '@/lib/legal';
import { legalContent } from '@/data/legalContent';
import { isNative } from '@/lib/native';
import { Check } from 'lucide-react';
import yunoLogo from '@/assets/yuno-logo.png';

const getAuthSchema = (t: (key: string) => string) => z.object({
  email: z.string().email({ message: t('auth.errors.invalidEmail') }),
  password: z.string().min(6, { message: t('auth.errors.passwordLength') }),
});

export default function Auth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect');
  const isReset = searchParams.get('reset') === 'true';
  const inviteToken = searchParams.get('invite');
  const platformInviteToken = searchParams.get('invite_platform');
  const affiliateInviteToken = searchParams.get('invite_affiliate');
  const affiliateMemberInviteToken = searchParams.get('invite_affiliate_member');
  const inviteEmailParam = searchParams.get('email');
  const { user, loading } = useAuth();
  const { primaryRole, loading: rolesLoading } = useUserRoles();
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const [email, setEmail] = useState(inviteEmailParam ?? '');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(!!inviteToken || !!platformInviteToken || !!affiliateInviteToken || !!affiliateMemberInviteToken || searchParams.get('signup') === 'true');
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [acceptingInvite, setAcceptingInvite] = useState(false);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Handle password reset token from URL hash
  useEffect(() => {
    const handleRecoveryToken = async () => {
      // Check if we have a recovery token in the URL hash
      const hash = window.location.hash;
      if (hash && hash.includes('type=recovery')) {
        try {
          // Let Supabase handle the token exchange
          const { data, error } = await supabase.auth.getSession();
          
          if (error) {
            console.error('Recovery session error:', error);
            setSessionError(error.message);
            return;
          }
          
          if (data.session) {
            setIsSessionReady(true);
            // Clear the hash from URL to avoid reprocessing
            window.history.replaceState(null, '', window.location.pathname + '?reset=true');
          } else {
            // Wait a moment and try again - Supabase might still be processing
            setTimeout(async () => {
              const { data: retryData, error: retryError } = await supabase.auth.getSession();
              if (retryError) {
                setSessionError(retryError.message);
              } else if (retryData.session) {
                setIsSessionReady(true);
                window.history.replaceState(null, '', window.location.pathname + '?reset=true');
              } else {
                setSessionError(t('auth.sessionExpired'));
              }
            }, 1000);
          }
        } catch (err: any) {
          console.error('Error processing recovery token:', err);
          setSessionError(err.message);
        }
      } else if (isReset && user) {
        // Already have a session from previous token processing
        setIsSessionReady(true);
      }
    };

    handleRecoveryToken();
  }, [isReset, user]);

  // Handle owner invitation acceptance after login/signup
  useEffect(() => {
    const acceptInvitation = async () => {
      if (!user || !inviteToken || acceptingInvite) return;
      
      setAcceptingInvite(true);
      try {
        const { data, error } = await supabase.functions.invoke('accept-owner-invitation', {
          body: { invitation_token: inviteToken },
        });

        if (error) throw error;

        toast({
          title: t('auth.invitationAccepted'),
          description: t('auth.invitationAcceptedDesc'),
        });

        // Redirect to owner dashboard
        setTimeout(() => navigate('/owner/dashboard'), 1500);
      } catch (error: any) {
        console.error('Error accepting invitation:', error);
        toast({
          title: t('auth.invitationError'),
          description: error.message || t('auth.invitationErrorDesc'),
          variant: 'destructive',
        });
        // Still redirect to default location
        navigate('/');
      }
    };

    acceptInvitation();
  }, [user, inviteToken, acceptingInvite, navigate, toast]);

  // Handle platform (organizer) invitation acceptance after login/signup
  useEffect(() => {
    const acceptPlatform = async () => {
      if (!user || !platformInviteToken || acceptingInvite) return;
      setAcceptingInvite(true);
      try {
        const { data, error } = await supabase.functions.invoke('accept-platform-invitation', {
          body: { action: 'accept', token: platformInviteToken },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        toast({ title: 'Compte organisateur activé', description: 'Bienvenue sur Yuno !' });
        setTimeout(() => navigate('/organizer-app'), 1200);
      } catch (e: any) {
        console.error('Error accepting platform invitation:', e);
        toast({ title: 'Erreur', description: e.message ?? 'Impossible d\'activer le compte', variant: 'destructive' });
        navigate('/');
      }
    };
    acceptPlatform();
  }, [user, platformInviteToken, acceptingInvite, navigate, toast]);

  // Handle affiliate invitation acceptance after login/signup
  useEffect(() => {
    const acceptAffiliate = async () => {
      if (!user || !affiliateInviteToken || acceptingInvite) return;
      setAcceptingInvite(true);
      try {
        const { data, error } = await supabase.functions.invoke('accept-affiliate-invitation', {
          body: { action: 'accept', token: affiliateInviteToken },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        toast({ title: 'Compte affilié activé', description: 'Bienvenue sur Yuno !' });
        setTimeout(() => navigate('/affiliate'), 1200);
      } catch (e: any) {
        console.error('Error accepting affiliate invitation:', e);
        toast({ title: 'Erreur', description: e.message ?? "Impossible d'activer le compte affilié", variant: 'destructive' });
        navigate('/');
      }
    };
    acceptAffiliate();
  }, [user, affiliateInviteToken, acceptingInvite, navigate, toast]);

  // Handle affiliate member invitation acceptance after login/signup
  useEffect(() => {
    const acceptAffiliateMember = async () => {
      if (!user || !affiliateMemberInviteToken || acceptingInvite) return;
      setAcceptingInvite(true);
      try {
        const { data, error } = await supabase.functions.invoke('accept-affiliate-invitation', {
          body: { action: 'accept', token: affiliateMemberInviteToken },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        toast({ title: 'Compte membre activé', description: 'Bienvenue dans l\'équipe !' });
        setTimeout(() => navigate('/affiliate'), 1200);
      } catch (e: any) {
        console.error('Error accepting affiliate member invitation:', e);
        toast({ title: 'Erreur', description: e.message ?? "Impossible d'activer le compte membre", variant: 'destructive' });
        navigate('/');
      }
    };
    acceptAffiliateMember();
  }, [user, affiliateMemberInviteToken, acceptingInvite, navigate, toast]);

  useEffect(() => {
    if (!loading && !rolesLoading && user && !isReset && !inviteToken && !platformInviteToken && !affiliateInviteToken && !affiliateMemberInviteToken) {
      // If there's a specific redirect, use it — but only follow internal,
      // relative paths. Block open-redirect payloads like ?redirect=//evil.com,
      // ?redirect=/\evil.com, or absolute URLs.
      if (redirect) {
        const isSafe = redirect.startsWith('/') && !redirect.startsWith('//') && !redirect.startsWith('/\\');
        navigate(isSafe ? redirect : '/');
        return;
      }

      // Otherwise, redirect based on primary role
      const roleRoutes = {
        owner: '/owner/dashboard',
        barman: '/barman',
        client: '/',
      };

      navigate(roleRoutes[primaryRole] || '/');
    }
  }, [user, loading, rolesLoading, primaryRole, navigate, redirect, isReset, inviteToken, platformInviteToken]);

  useEffect(() => {
    if (isReset) {
      toast({
        title: t('auth.passwordReset'),
        description: t('auth.enterNewPassword'),
      });
    }
  }, [isReset, toast, t]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (isForgotPassword) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth?reset=true`,
        });

        if (error) throw error;

        toast({
          title: t('auth.emailSent'),
          description: t('auth.checkEmail'),
        });

        setIsForgotPassword(false);
        setEmail('');
      } else if (isReset) {
        if (!isSessionReady) {
          toast({
            title: t('auth.sessionNotReady'),
            description: t('auth.sessionNotReadyDesc'),
            variant: 'destructive',
          });
          setIsLoading(false);
          return;
        }

        const { error } = await supabase.auth.updateUser({
          password: password,
        });

        if (error) throw error;

        toast({
          title: t('auth.passwordChanged'),
          description: t('auth.passwordUpdated'),
        });

        // Sign out and redirect to login
        await supabase.auth.signOut();
        navigate('/auth');
      } else {
        getAuthSchema(t).parse({ email, password });

        if (isSignUp) {
          // We collect the buyer's full name at signup (first token = first name,
          // the rest = last name). The handle_new_user trigger reads these from
          // raw_user_meta_data into the profile. City still resolves from GPS in Explore.
          const trimmedName = fullName.trim();
          const [firstNamePart, ...lastNameParts] = trimmedName.split(/\s+/);
          const lastNamePart = lastNameParts.join(' ');

          const { error } = await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/auth`,
              data: {
                first_name: firstNamePart || undefined,
                last_name: lastNamePart || undefined,
              },
            }
          });

          if (error) {
            if (error.message.includes('already registered')) {
              throw new Error(t('auth.errors.emailRegistered'));
            }
            throw error;
          }

          toast({
            title: t('auth.signupSuccess'),
            description: t('auth.autoLogin'),
          });

          // Clickwrap : trace l'acceptation des CGU (case cochée obligatoire ci-dessous).
          // Fire-and-forget — l'échec d'enregistrement ne bloque pas l'inscription.
          void recordLegalAcceptance({
            docType: 'cgu',
            docContent: legalContent['cgu'][language].content,
            email,
            context: { surface: 'signup', privacy_shown: true },
          });

          // Sign in after successful signup - redirection will be handled by useEffect.
          // With email confirmation OFF (the recommended setting) this succeeds
          // immediately and the user lands in the app. If confirmation is still
          // required, fall back to a clear, non-blocking "confirm your email" toast.
          const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
          if (signInError) {
            if (signInError.message.toLowerCase().includes('not confirmed')) {
              toast({
                title: t('auth.confirmEmailTitle'),
                description: t('auth.confirmEmailDesc'),
              });
            } else {
              throw signInError;
            }
          }
        } else {
          const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          if (error) {
            if (error.message.includes('Invalid login credentials')) {
              throw new Error(t('auth.errors.invalidCredentials'));
            }
            throw error;
          }

          toast({
            title: t('auth.loginSuccess'),
            description: t('auth.welcome'),
          });

          // Redirection will be handled by useEffect based on role
        }
      }
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        toast({
          title: t('auth.errors.validationError'),
          description: error.errors[0].message,
          variant: 'destructive',
        });
      } else {
        toast({
          title: t('auth.errors.error'),
          description: error.message,
          variant: 'destructive',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  // OAuth sign-in. Web : redirect classique vers /auth (l'effet de redirection
  // par rôle prend le relais quand la session arrive). App native : feuilles
  // système Apple/Google + signInWithIdToken — même effet de redirection.
  const handleOAuth = async (provider: 'google' | 'apple') => {
    if (isNative()) {
      const { signInWithProviderNative } = await import('@/lib/nativeAuth');
      const outcome = await signInWithProviderNative(provider);
      if (outcome === 'cancelled') return;
      if (outcome !== 'success') {
        toast({ title: t('auth.errors.error'), description: outcome.message, variant: 'destructive' });
      }
      return;
    }
    const redirectTo = `${window.location.origin}/auth${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`;
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
    if (error) {
      toast({ title: t('auth.errors.error'), description: error.message, variant: 'destructive' });
    }
  };

  const isInviteFlow = !!(inviteToken || platformInviteToken || affiliateInviteToken || affiliateMemberInviteToken);
  if ((loading || rolesLoading) && !isReset && !isInviteFlow) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // Show error if session failed for password reset
  if (isReset && sessionError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="border-0 bg-surface p-8 shadow-soft max-w-md">
          <div className="text-center space-y-4">
            <div className="mb-4 h-24 w-24 mx-auto rounded-full overflow-hidden">
              <img src={yunoLogo} alt="Yuno" className="h-full w-full object-cover object-[center_35%]" />
            </div>
            <h1 className="text-2xl font-bold text-destructive">{t('auth.linkExpired')}</h1>
            <p className="text-muted-foreground">{sessionError}</p>
            <Button onClick={() => navigate('/auth')} className="w-full">
              {t('auth.backToLogin')}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // Show loading while processing recovery token
  if (isReset && !isSessionReady && !sessionError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">{t('auth.verifyingLink')}</p>
        </div>
      </div>
    );
  }

  const inputStyle = {
    background: '#1F1F22',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: '#E5E5E5',
    fontSize: '14px',
    padding: '12px 14px',
    width: '100%',
    outline: 'none',
    fontFamily: 'Inter, sans-serif',
    transition: 'border-color 150ms ease',
  };

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: '#0A0A0A',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        paddingTop: 'env(safe-area-inset-top, 16px)',
        paddingBottom: 'env(safe-area-inset-bottom, 16px)',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="w-full"
        style={{ maxWidth: '400px' }}
      >
        {/* Back */}
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 mb-6 transition-colors"
          style={{ color: '#5A5A5E', fontSize: '13px' }}
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="font-mono" style={{ letterSpacing: '0.04em' }}>Back</span>
        </button>

        {/* Card */}
        <div
          style={{
            background: '#141414',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '14px',
            padding: '32px 28px',
          }}
        >
          {/* Logo */}
          <div className="text-center mb-8">
            <span
              className="font-display font-bold block"
              style={{ fontSize: '32px', color: '#E8192C', letterSpacing: '-0.03em', lineHeight: 1 }}
            >
              Yuno
            </span>
            <p
              className="font-mono mt-3"
              style={{ fontSize: '12px', color: '#5A5A5E', letterSpacing: '0.04em' }}
            >
              {isForgotPassword
                ? t('auth.enterEmail')
                : isReset
                ? t('auth.newPassword')
                : isSignUp
                ? t('auth.createAccount')
                : t('auth.connectYourAccount')}
            </p>
          </div>

          <h2
            className="font-display font-bold text-center mb-6"
            style={{ fontSize: '20px', color: '#FFFFFF', letterSpacing: '-0.02em' }}
          >
            {isForgotPassword
              ? t('auth.forgotPassword')
              : isReset
              ? t('auth.newPassword')
              : isSignUp
              ? t('auth.signup')
              : t('auth.login')}
          </h2>

          {/* Form */}
          <form onSubmit={handleAuth} className="space-y-3">
            {isSignUp && !isReset && !isForgotPassword && (
              <input type="text" autoComplete="name" placeholder={t('auth.placeholders.fullName')} value={fullName} onChange={(e) => setFullName(e.target.value)} required disabled={isLoading} style={{ ...inputStyle, borderColor: fullName ? 'rgba(232,25,44,0.4)' : 'rgba(255,255,255,0.08)' }} />
            )}

            {!isReset && (
              <input type="email" placeholder={t('auth.placeholders.email')} value={email} onChange={(e) => setEmail(e.target.value)} required disabled={isLoading} style={{ ...inputStyle, borderColor: email ? 'rgba(232,25,44,0.4)' : 'rgba(255,255,255,0.08)' }} />
            )}

            {!isForgotPassword && (
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} placeholder={isReset ? t('auth.placeholders.newPassword') : t('auth.placeholders.password')} value={password} onChange={(e) => setPassword(e.target.value)} required disabled={isLoading} minLength={6} style={{ ...inputStyle, paddingRight: '44px', borderColor: password ? 'rgba(232,25,44,0.4)' : 'rgba(255,255,255,0.08)' }} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} disabled={isLoading} className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors" style={{ color: '#5A5A5E' }}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            )}

            {/* Clickwrap CGU + Politique de confidentialité (signature électronique simple, eIDAS) */}
            {isSignUp && !isReset && !isForgotPassword && (
              <button
                type="button"
                onClick={() => setAcceptedTerms(!acceptedTerms)}
                disabled={isLoading}
                className="flex items-start gap-2.5 w-full text-left"
                style={{ padding: '2px 2px 0' }}
              >
                <span
                  className="shrink-0 h-[18px] w-[18px] rounded-[4px] border flex items-center justify-center transition-colors mt-[1px]"
                  style={{
                    background: acceptedTerms ? '#E8192C' : 'transparent',
                    borderColor: acceptedTerms ? '#E8192C' : 'rgba(255,255,255,0.25)',
                  }}
                >
                  {acceptedTerms && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                </span>
                <span className="text-xs leading-snug" style={{ color: '#9A9A9A' }}>
                  {t('legal.signupPre')}{' '}
                  <a href="/legal/cgu" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: '#E8192C' }} onClick={(e) => e.stopPropagation()}>
                    {t('legal.signupTerms')}
                  </a>{' '}
                  {t('legal.signupMid')}{' '}
                  <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: '#E8192C' }} onClick={(e) => e.stopPropagation()}>
                    {t('legal.signupPrivacy')}
                  </a>
                </span>
              </button>
            )}

            <button
              type="submit"
              disabled={isLoading || (isSignUp && !isReset && !isForgotPassword && !acceptedTerms)}
              className="btn btn--primary w-full mt-2"
              style={{ height: '46px', fontSize: '14px', letterSpacing: '0.02em', borderRadius: '8px', width: '100%', opacity: isSignUp && !isReset && !isForgotPassword && !acceptedTerms ? 0.5 : 1 }}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isForgotPassword ? t('auth.send') : isReset ? t('auth.change') : isSignUp ? t('auth.signupButton') : t('auth.loginButton')}
            </button>
          </form>

          {!isReset && (
            <div className="mt-5 space-y-2 text-center">
              {!isForgotPassword && (
                <>
                  <button
                    onClick={() => { setIsSignUp(!isSignUp); setIsForgotPassword(false); }}
                    type="button"
                    disabled={isLoading}
                    className="font-mono block w-full transition-colors"
                    style={{ fontSize: '12px', color: '#E8192C', letterSpacing: '0.04em' }}
                  >
                    {isSignUp ? t('auth.alreadyAccount') : t('auth.noAccount')}
                  </button>
                  {!isSignUp && (
                    <button
                      onClick={() => setIsForgotPassword(true)}
                      type="button"
                      disabled={isLoading}
                      className="font-mono block w-full transition-colors"
                      style={{ fontSize: '12px', color: '#5A5A5E', letterSpacing: '0.04em' }}
                    >
                      {t('auth.forgotPasswordLink')}
                    </button>
                  )}
                </>
              )}
              {isForgotPassword && (
                <button
                  onClick={() => setIsForgotPassword(false)}
                  type="button"
                  disabled={isLoading}
                  className="font-mono block w-full transition-colors"
                  style={{ fontSize: '12px', color: '#E8192C', letterSpacing: '0.04em' }}
                >
                  {t('auth.back')}
                </button>
              )}
            </div>
          )}

          {/* Social login. Web : Google actif, Apple en attente du Services ID.
              App native : Sign in with Apple NATIF (obligatoire dès qu'un login
              tiers est proposé — guideline 4.8, affiché en premier) + Google
              natif si le client iOS est configuré (VITE_GOOGLE_IOS_CLIENT_ID). */}
          {!isReset && !isForgotPassword && (
            <>
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 yuno-divider" />
                <span className="font-mono" style={{ fontSize: '10px', color: '#3A3A3E', letterSpacing: '0.12em' }}>
                  {t('auth.or').toUpperCase()}
                </span>
                <div className="flex-1 yuno-divider" />
              </div>
              <div className="space-y-2.5">
                {[
                  { label: t('auth.continueWithApple'), provider: 'apple' as const, soon: !isNative(), icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg> },
                  { label: t('auth.continueWithGoogle'), provider: 'google' as const, soon: isNative() && !import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID, icon: <svg className="h-4 w-4" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> },
                ].map(({ label, icon, provider, soon }) => (
                  <button
                    key={label}
                    type="button"
                    disabled={soon || isLoading}
                    onClick={soon ? undefined : () => handleOAuth(provider)}
                    className={`w-full flex items-center justify-between px-4 transition-colors ${soon ? 'cursor-not-allowed' : 'hover:bg-white/[0.06] active:scale-[0.99]'}`}
                    style={{
                      height: '44px',
                      borderRadius: '8px',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.07)',
                      opacity: soon ? 0.5 : 1,
                    }}
                  >
                    <span className="flex items-center gap-2.5">
                      {icon}
                      <span className="font-mono" style={{ fontSize: '12px', color: '#E5E5E5', letterSpacing: '0.04em' }}>{label}</span>
                    </span>
                    {soon && (
                      <span
                        className="font-mono font-bold"
                        style={{ fontSize: '9px', color: '#E8192C', letterSpacing: '0.10em', background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.25)', padding: '2px 7px', borderRadius: '999px' }}
                      >
                        SOON
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
