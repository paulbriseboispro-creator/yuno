import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, XCircle, Loader2, LogIn, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';

interface LinkInfo {
  role: string;
  label: string | null;
  venue_id: string | null;
  venue_name: string | null;
  venue_cover: string | null;
  organizer_user_id: string | null;
  organizer_name: string | null;
  is_valid: boolean;
  invalid_reason: string | null;
}

export default function JoinViaLink() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user, loading: authLoading } = useAuth();
  const token = searchParams.get('token');

  const [checking, setChecking] = useState(true);
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; redirect?: string } | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [stageName, setStageName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [existingAccount, setExistingAccount] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);

  const roleLabel = info ? (t(`join.role.${info.role}`) || info.role) : '';
  const inviterName = info?.venue_name || info?.organizer_name || (info?.role === 'organizer' ? 'Yuno' : t('join.aTeam'));

  useEffect(() => {
    const check = async () => {
      if (!token) { setChecking(false); return; }
      try {
        const res = await supabase.rpc('get_onboarding_link_public' as never, { p_token: token } as never);
        const data = res.data as LinkInfo[] | LinkInfo | null;
        const row: LinkInfo | null = Array.isArray(data) ? (data[0] ?? null) : data;
        if (res.error || !row) { setChecking(false); return; }
        setInfo(row);
      } catch (err) {
        console.error('get_onboarding_link_public error:', err);
      } finally {
        setChecking(false);
      }
    };
    check();
  }, [token]);

  const redeem = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setExistingAccount(false);
    try {
      const headers: Record<string, string> = {};
      // Folded into accept-staff-invitation (edge-function cap forbids new fns).
      const body: Record<string, unknown> = { action: 'redeem_onboarding_link', token };

      if (user) {
        const { data: session } = await supabase.auth.getSession();
        if (session.session?.access_token) headers.Authorization = `Bearer ${session.session.access_token}`;
      } else {
        // Always send the person's info; the password is only sent once we know
        // there's no existing account (progressive form).
        body.email = email.trim();
        body.first_name = firstName || undefined;
        body.last_name = lastName || undefined;
        if (info?.role === 'dj' && stageName) body.stage_name = stageName;
        if (needsPassword && password) body.password = password;
      }

      const response = await supabase.functions.invoke('accept-staff-invitation', {
        body,
        headers: Object.keys(headers).length ? headers : undefined,
      });
      if (response.error) throw new Error(response.error.message);

      const data = response.data;

      // No account at this email yet → reveal the password field, stay on the form.
      if (data?.code === 'need_password') { setNeedsPassword(true); return; }

      if (data?.error) {
        if (data.code === 'account_exists') setExistingAccount(true);
        setResult({ success: false, message: data.error });
        return;
      }

      // Fresh account created → sign the person in so their new dashboard opens.
      if (!user && password) {
        await supabase.auth.signInWithPassword({ email: email.trim(), password });
      }

      setResult({ success: true, message: data.message || t('join.success'), redirect: data.redirect || '/' });
      toast.success(data.message || t('join.success'));
    } catch (err) {
      console.error('redeem_onboarding_link error:', err);
      setResult({ success: false, message: err instanceof Error ? err.message : t('join.genericError') });
    } finally {
      setLoading(false);
    }
  }, [token, user, email, password, firstName, lastName, stageName, info, needsPassword, t]);

  const goLoginBack = () =>
    navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);

  // ---- render states ----
  if (authLoading || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!token || !info || !info.is_valid) {
    const reason = info?.invalid_reason;
    const msg =
      reason === 'expired' ? t('join.expired')
      : reason === 'full' ? t('join.full')
      : reason === 'revoked' ? t('join.revoked')
      : t('join.invalidDesc');
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="p-8 text-center max-w-md">
          <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">{t('join.invalid')}</h1>
          <p className="text-muted-foreground">{msg}</p>
          <Button className="mt-6" onClick={() => navigate('/')}>{t('join.backHome')}</Button>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="p-8 text-center max-w-md">
          <Loader2 className="h-16 w-16 animate-spin text-primary mx-auto mb-4" />
          <h1 className="text-xl font-semibold">{t('join.processing')}</h1>
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
              <h1 className="text-xl font-semibold mb-2">{t('join.welcome')}</h1>
              <p className="text-muted-foreground">{result.message}</p>
              <Button className="mt-6" onClick={() => navigate(result.redirect || '/')}>{t('join.continue')}</Button>
            </>
          ) : (
            <>
              <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
              <h1 className="text-xl font-semibold mb-2">{t('join.error')}</h1>
              <p className="text-muted-foreground">{result.message}</p>
              {existingAccount ? (
                <Button className="mt-6" onClick={goLoginBack}><LogIn className="h-4 w-4 mr-2" />{t('join.login')}</Button>
              ) : (
                <Button className="mt-6" variant="outline" onClick={() => setResult(null)}>{t('join.retry')}</Button>
              )}
            </>
          )}
        </Card>
      </div>
    );
  }

  const header = (
    <div className="text-center mb-6">
      <UserPlus className="h-14 w-14 text-primary mx-auto mb-4" />
      <p className="text-muted-foreground text-sm">
        <strong className="text-primary">{inviterName}</strong> {t('join.invitesYou')}
      </p>
      <div className="mt-3 p-2 bg-primary/10 rounded-lg">
        <p className="text-xs text-muted-foreground">{t('join.yourRole')}</p>
        <p className="text-lg font-bold text-primary">{roleLabel}</p>
      </div>
    </div>
  );

  // Logged in → one-tap join.
  if (user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="p-8 max-w-md w-full">
          {header}
          <Button className="w-full" onClick={redeem} disabled={loading}>
            {t('join.joinAs')} {roleLabel}
          </Button>
        </Card>
      </div>
    );
  }

  // Not logged in → progressive: collect info first, reveal password only if the
  // email has no Yuno account yet.
  const emailValid = email.trim().length > 3 && email.includes('@');
  const canSubmit = needsPassword ? password.length >= 6 : emailValid;
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="p-8 max-w-md w-full">
        {header}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('join.firstName')}</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={needsPassword} />
            </div>
            <div>
              <Label>{t('join.lastName')}</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={needsPassword} />
            </div>
          </div>
          {info.role === 'dj' && (
            <div>
              <Label>{t('join.stageName')}</Label>
              <Input value={stageName} onChange={(e) => setStageName(e.target.value)} placeholder={t('join.stageNamePh')} disabled={needsPassword} />
            </div>
          )}
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" disabled={needsPassword} />
          </div>

          {needsPassword && (
            <div>
              <Label>{t('join.password')}</Label>
              <Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('join.passwordPh')} />
              <p className="text-xs text-muted-foreground mt-1">{t('join.newAccountPasswordHint')}</p>
            </div>
          )}

          <Button className="w-full" onClick={redeem} disabled={loading || !canSubmit}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {needsPassword ? t('join.createAndJoin') : t('join.continue')}
          </Button>

          {needsPassword && (
            <Button variant="ghost" className="w-full" onClick={() => { setNeedsPassword(false); setPassword(''); }} disabled={loading}>
              {t('join.changeEmail')}
            </Button>
          )}

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t" /></div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">{t('join.or')}</span>
            </div>
          </div>

          <Button variant="outline" className="w-full" onClick={goLoginBack}>
            <LogIn className="h-4 w-4 mr-2" />
            {t('join.haveAccount')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
