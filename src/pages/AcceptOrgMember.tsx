import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { CheckCircle, AlertCircle, Users } from 'lucide-react';

export default function AcceptOrgMember() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { language } = useLanguage();
  const token = searchParams.get('token');
  const [invitation, setInvitation] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    (async () => {
      try {
        const { data } = await supabase.functions.invoke('accept-org-member', {
          body: { action: 'verify', token },
        });
        if (data?.invitation) setInvitation(data.invitation);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const handleAccept = async () => {
    if (!user) {
      navigate(`/auth?invite=org-member&token=${token}&email=${encodeURIComponent(invitation.email)}`);
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('accept-org-member', {
        body: { action: 'accept', token },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setAccepted(true);
      toast.success(t('Vous avez rejoint l\'équipe !', 'You joined the team!'));
      setTimeout(() => navigate('/organizer-app'), 1500);
    } catch (e: any) {
      toast.error(e.message ?? 'Error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  }

  if (!invitation) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
        <AlertCircle className="h-16 w-16 text-muted-foreground mb-4" />
        <h2 className="text-lg font-bold mb-2">{t('Invitation invalide ou expirée', 'Invalid or expired invitation')}</h2>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/')}>{t('Retour', 'Back')}</Button>
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
        <CheckCircle className="h-16 w-16 text-emerald-400 mb-4" />
        <h2 className="text-lg font-bold mb-2">{t('Bienvenue dans l\'équipe !', 'Welcome to the team!')}</h2>
      </div>
    );
  }

  const roleLabel = invitation.role === 'admin' ? 'Admin' : invitation.role === 'editor' ? t('Éditeur', 'Editor') : 'Scanner';
  const emailMismatch = user && user.email?.toLowerCase() !== invitation.email.toLowerCase();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 space-y-6">
        <div className="text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 mb-4">
            <Users className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">{t('Rejoindre l\'équipe', 'Join the team')}</h2>
          <p className="text-sm text-muted-foreground mt-2">
            <strong className="text-foreground">{invitation.organization_name}</strong> {t('vous invite en tant que', 'invites you as')} <strong className="text-foreground">{roleLabel}</strong>
          </p>
        </div>

        {emailMismatch && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
            {t(`Email attendu : ${invitation.email}`, `Expected email: ${invitation.email}`, `Correo esperado: ${invitation.email}`)}
          </div>
        )}

        <Button className="w-full" size="lg" onClick={handleAccept} disabled={submitting || !!emailMismatch}>
          {submitting && <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent mr-2" />}
          {user ? t('Rejoindre', 'Join') : t('Se connecter et rejoindre', 'Sign in and join')}
        </Button>
      </Card>
    </div>
  );
}
