import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Building2, Calendar, Check, Loader2, X, Sparkles, MapPin } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';

interface InvitationData {
  invitation: {
    id: string;
    club_name: string;
    club_email: string;
    club_city: string | null;
    club_address: string | null;
    contact_first_name: string | null;
    contact_last_name: string | null;
    invitation_message: string | null;
    status: string;
    expires_at: string;
    event_id: string | null;
    organizer_user_id: string;
  };
  organizer: {
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
    avatar_url: string | null;
  } | null;
  event: {
    id: string;
    title: string;
    start_at: string;
    poster_url: string | null;
    image_url: string | null;
  } | null;
  expired: boolean;
}

export default function ClubInvitationPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const [data, setData] = useState<InvitationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Token manquant dans le lien.');
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const { data: result, error } = await supabase.functions.invoke(
          `accept-club-collab-invitation?token=${encodeURIComponent(token)}`,
          { method: 'GET' as any }
        );
        if (error) throw error;
        if ((result as any)?.error) throw new Error((result as any).error);
        setData(result as InvitationData);
      } catch (err: any) {
        setError(err.message ?? 'Invitation introuvable.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const organizerLabel =
    data?.organizer?.organization_name ||
    [data?.organizer?.first_name, data?.organizer?.last_name].filter(Boolean).join(' ') ||
    'Un organisateur Yuno';

  const handleAccept = async () => {
    if (!token) return;
    if (!user) {
      // Redirect to auth, then back here
      navigate(`/auth?redirect=${encodeURIComponent(`/club-invitation?token=${token}`)}`);
      return;
    }
    setSubmitting(true);
    try {
      const { data: result, error } = await supabase.functions.invoke(
        'accept-club-collab-invitation',
        { body: { token, action: 'accept' } }
      );
      if (error) throw error;
      if ((result as any)?.error) throw new Error((result as any).error);
      toast({
        title: t('clubInv.welcome'),
        description: t('clubInv.welcomeDesc'),
      });
      navigate('/owner');
    } catch (err: any) {
      toast({ title: t('clubInv.error'), description: err.message, variant: 'destructive' });
      setSubmitting(false);
    }
  };

  const handleDecline = async () => {
    if (!token) return;
    if (!confirm(t('clubInv.confirmDecline'))) return;
    setSubmitting(true);
    try {
      await supabase.functions.invoke('accept-club-collab-invitation', {
        body: { token, action: 'decline' },
      });
      toast({ title: t('clubInv.declined') });
      navigate('/');
    } catch (err: any) {
      toast({ title: t('clubInv.error'), description: err.message, variant: 'destructive' });
      setSubmitting(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md p-8 text-center">
          <X className="h-10 w-10 mx-auto text-destructive mb-3" />
          <h1 className="text-xl font-bold mb-2">{t('clubInv.invalidTitle')}</h1>
          <p className="text-sm text-muted-foreground mb-6">{error ?? t('clubInv.linkNotFound')}</p>
          <Button onClick={() => navigate('/')}>{t('clubInv.backHome')}</Button>
        </Card>
      </div>
    );
  }

  const { invitation, event, expired } = data;
  const alreadyHandled = invitation.status !== 'pending';

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <Card className="overflow-hidden">
          {/* Hero */}
          <div className="bg-gradient-to-br from-primary via-primary to-primary/70 p-8 text-center">
            <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-white/15 backdrop-blur mb-4">
              <Sparkles className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">
              {t('clubInv.heroTitle')}
            </h1>
            <p className="text-white/90 mt-2 text-sm md:text-base">
              {organizerLabel} {t('clubInv.invitesToCollab')}
            </p>
          </div>

          <div className="p-6 md:p-8 space-y-6">
            {expired || alreadyHandled ? (
              <div className="text-center py-6">
                <Badge variant={expired ? 'destructive' : 'secondary'} className="mb-3">
                  {expired ? t('clubInv.expired') : invitation.status}
                </Badge>
                <p className="text-sm text-muted-foreground">
                  {t('clubInv.noLongerValid')}
                </p>
                <Button className="mt-4" onClick={() => navigate('/')}>
                  {t('clubInv.backHome')}
                </Button>
              </div>
            ) : (
              <>
                {/* Greeting */}
                {invitation.contact_first_name && (
                  <p className="text-base">
                    {t('clubInv.hello')} <span className="font-semibold">{invitation.contact_first_name}</span>,
                  </p>
                )}

                {/* Club preview */}
                <div className="rounded-lg border border-border/50 p-4 bg-card/40">
                  <div className="flex items-start gap-3">
                    <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Building2 className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold">{invitation.club_name}</h3>
                      {invitation.club_city && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <MapPin className="h-3 w-3" />
                          {invitation.club_city}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Event preview if any */}
                {event && (
                  <div className="rounded-lg border border-primary/30 p-4 bg-primary/5">
                    <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">
                      {t('clubInv.eventConcerned')}
                    </div>
                    <div className="flex items-start gap-3">
                      {(event.poster_url || event.image_url) && (
                        <img
                          src={event.poster_url ?? event.image_url ?? undefined}
                          alt=""
                          className="h-16 w-16 rounded-lg object-cover shrink-0"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <h4 className="font-semibold truncate">{event.title}</h4>
                        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(event.start_at), 'PPp', { locale: dateLocale })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Personal message */}
                {invitation.invitation_message && (
                  <div className="rounded-lg border-l-4 border-primary pl-4 py-2">
                    <p className="text-sm italic text-muted-foreground">
                      « {invitation.invitation_message} »
                    </p>
                  </div>
                )}

                {/* What you get */}
                <div className="space-y-3">
                  <h3 className="font-semibold text-sm">{t('clubInv.benefitsTitle')}</h3>
                  <ul className="space-y-2">
                    {[
                      t('clubInv.benefit1'),
                      t('clubInv.benefit2'),
                      t('clubInv.benefit3'),
                      t('clubInv.benefit4'),
                    ].map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {!user && (
                  <div className="rounded-md bg-muted/40 border border-border/40 p-3 text-xs text-muted-foreground">
                    {t('clubInv.loginToAccept')}{' '}
                    <span className="font-mono font-semibold">{invitation.club_email}</span>.
                  </div>
                )}

                <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={handleDecline}
                    disabled={submitting}
                  >
                    <X className="h-4 w-4 mr-2" /> {t('clubInv.decline')}
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={handleAccept}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4 mr-2" />
                    )}
                    {user ? t('clubInv.acceptCreate') : t('clubInv.loginAccept')}
                  </Button>
                </div>

                <p className="text-[11px] text-center text-muted-foreground">
                  {t('clubInv.expiresOn')}{' '}
                  {format(new Date(invitation.expires_at), 'PPp', { locale: dateLocale })}
                </p>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
