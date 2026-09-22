import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Building2, Calendar, Check, Loader2, X, Sparkles, MapPin, Euro, UserPlus, PenLine, CreditCard } from 'lucide-react';
import { translate } from '@/i18n/orgTranslate';
import { normalizeSplitRules, readRemuneration } from '@/lib/splitRules';
import { TiersRecap } from '@/components/collab/TieredRemunerationEditor';
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
    default_split_rules?: unknown;
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
  const tr = (frTxt: string, en: string, esTxt?: string) => translate(language, frTxt, en, esTxt);
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
      // Un club invité n'a (presque) jamais de compte : ouvrir directement le
      // formulaire d'inscription, email de l'invitation pré-rempli. « ¿Ya tienes
      // cuenta? » reste à un clic pour les autres.
      const params = new URLSearchParams({ redirect: `/club-invitation?token=${token}`, signup: 'true' });
      if (invitation?.club_email) params.set('email', invitation.club_email);
      navigate(`/auth?${params.toString()}`);
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
      // Navigation COMPLÈTE, pas un navigate() : la session en mémoire a été
      // ouverte avant l'acceptation, elle ne porte ni le rôle owner ni le club
      // que l'edge vient de créer — OwnerRoute renvoyait le nouveau club sur la
      // page d'accueil publique, sans un mot. Recharger relit rôles et profil
      // … et atterrir sur Collaborations, pas sur le tableau de bord générique :
      // c'est là que vivent la proposition à signer, le partenaire, et le guide
      // de configuration. Un club invité pour UNE soirée ne doit pas chercher.
      window.location.assign('/owner/collaborations');
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
                      {event.poster_url && (
                        <img
                          src={event.poster_url}
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

                {/* Conditions proposées — le club doit savoir ce qu'il signe
                    AVANT de créer un compte. */}
                {(() => {
                  const rules = normalizeSplitRules(invitation.default_split_rules);
                  const rem = readRemuneration(invitation.default_split_rules);
                  if (!rules) return null;
                  return (
                    <div className="rounded-lg border border-border/50 p-4 bg-card/40 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <Euro className="h-3.5 w-3.5 text-primary" />
                        {tr('Conditions proposées', 'Proposed terms', 'Condiciones propuestas')}
                      </div>
                      {rem ? (
                        <TiersRecap rem={rem} />
                      ) : (
                        <ul className="text-sm space-y-1">
                          <li className="flex justify-between"><span className="text-muted-foreground">{tr('Billets', 'Tickets', 'Entradas')}</span><span>{tr('Club', 'Club', 'Club')} {rules.tickets.venue_pct} % · {tr('Organisateur', 'Organizer', 'Organizador')} {rules.tickets.organizer_pct} %</span></li>
                          <li className="flex justify-between"><span className="text-muted-foreground">{tr('Tables VIP', 'VIP tables', 'Mesas VIP')}</span><span>{tr('Club', 'Club', 'Club')} {rules.tables.venue_pct} % · {tr('Organisateur', 'Organizer', 'Organizador')} {rules.tables.organizer_pct} %</span></li>
                          <li className="flex justify-between"><span className="text-muted-foreground">{tr('Boissons', 'Drinks', 'Bebidas')}</span><span>{tr('Club', 'Club', 'Club')} {rules.drinks.venue_pct} %</span></li>
                        </ul>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {tr('Rien ne se vend avant votre signature. Vous pourrez proposer une modification avant de signer.', 'Nothing sells before you sign. You can propose changes before signing.', 'Nada se vende antes de vuestra firma. Podéis proponer cambios antes de firmar.')}
                      </p>
                    </div>
                  );
                })()}

                {/* Personal message */}
                {invitation.invitation_message && (
                  <div className="rounded-lg border-l-4 border-primary pl-4 py-2">
                    <p className="text-sm italic text-muted-foreground">
                      « {invitation.invitation_message} »
                    </p>
                  </div>
                )}

                {/* Ce qui vous attend — trois étapes, pour qu'un club qui découvre
                    Yuno sache que c'est court et où ça mène. */}
                <div className="space-y-3">
                  <h3 className="font-semibold text-sm">{tr('Ce qui vous attend', "What's next", 'Qué viene ahora')}</h3>
                  <ol className="space-y-2">
                    {[
                      { icon: UserPlus, text: tr('Créez le compte de votre club (2 minutes, gratuit).', 'Create your club account (2 minutes, free).', 'Cread la cuenta de vuestro club (2 minutos, gratis).') },
                      { icon: PenLine, text: tr('Lisez et signez le contrat de la soirée : répartition, remboursements, tout est écrit.', 'Read and sign the night\'s contract: split, refunds, everything in writing.', 'Leed y firmad el contrato de la noche: reparto, reembolsos, todo por escrito.') },
                      { icon: CreditCard, text: tr('Connectez Stripe pour recevoir votre part directement sur votre compte.', 'Connect Stripe to receive your share straight to your account.', 'Conectad Stripe para recibir vuestra parte directamente en vuestra cuenta.') },
                    ].map((st, i) => (
                      <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">{i + 1}</span>
                        <span className="flex items-start gap-2"><st.icon className="h-4 w-4 text-primary shrink-0 mt-0.5" />{st.text}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                {!user && (
                  <div className="rounded-md bg-muted/40 border border-border/40 p-3 text-xs text-muted-foreground">
                    {tr('Le compte se crée avec l\'adresse qui a reçu cette invitation :', 'The account is created with the address that received this invitation:', 'La cuenta se crea con la dirección que recibió esta invitación:')}{' '}
                    <span className="font-mono font-semibold">{invitation.club_email}</span>.
                    {' '}{tr('Déjà un compte Yuno ? Connectez-vous avec la même adresse.', 'Already on Yuno? Sign in with the same address.', '¿Ya tenéis cuenta en Yuno? Iniciad sesión con la misma dirección.')}
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
                    {user ? t('clubInv.acceptCreate') : tr('Créer mon compte et accepter', 'Create my account and accept', 'Crear mi cuenta y aceptar')}
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
