import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Handshake, Building2, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';

interface Invitation {
  id: string;
  organizer_email: string;
  organizer_name: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  invitation_message: string | null;
  inviting_venue_id: string;
  event_id: string | null;
  status: string;
  expires_at: string;
}

interface VenueInfo { id: string; name: string; city: string | null; logo_url: string | null }

export default function AcceptOrganizerInvitation() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [venue, setVenue] = useState<VenueInfo | null>(null);
  const [event, setEvent] = useState<{ id: string; title: string; start_at: string } | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    (async () => {
      const { data: inv } = await supabase
        .from('organizer_claim_invitations' as any)
        .select('*')
        .eq('token', token)
        .maybeSingle();
      if (!inv) {
        setLoading(false);
        return;
      }
      setInvitation(inv as any);
      const { data: v } = await supabase
        .from('venues')
        .select('id, name, city, logo_url')
        .eq('id', (inv as any).inviting_venue_id)
        .maybeSingle();
      setVenue(v as any);
      if ((inv as any).event_id) {
        const { data: ev } = await supabase
          .from('events')
          .select('id, title, start_at')
          .eq('id', (inv as any).event_id)
          .maybeSingle();
        setEvent(ev as any);
      }
      setLoading(false);
    })();
  }, [token]);

  const handleAccept = async () => {
    if (!user) {
      navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    if (!invitation || !venue) return;
    setSubmitting(true);
    try {
      // 1. Promote profile to organizer
      await supabase
        .from('profiles')
        .update({
          profile_type: 'organizer',
          organization_name: invitation.organizer_name || `${invitation.contact_first_name ?? ''} ${invitation.contact_last_name ?? ''}`.trim() || null,
          first_name: invitation.contact_first_name ?? undefined,
          last_name: invitation.contact_last_name ?? undefined,
        })
        .eq('id', user.id);

      // 2. Add organizer role
      await supabase
        .from('user_roles')
        .insert({ user_id: user.id, role: 'organizer' as any, email: user.email })
        .select()
        .maybeSingle();

      // 3. Create active partnership
      await supabase.from('venue_organizer_partnerships').insert({
        venue_id: venue.id,
        organizer_user_id: user.id,
        status: 'active',
        initiated_by: 'venue',
        accepted_at: new Date().toISOString(),
        invitation_message: invitation.invitation_message,
      });

      // 4. If event was attached, set partner_organizer_id
      if (invitation.event_id) {
        await supabase
          .from('events')
          .update({ partner_organizer_id: user.id, event_mode: 'co_event' })
          .eq('id', invitation.event_id);
      }

      // 5. Mark invitation accepted
      await supabase
        .from('organizer_claim_invitations' as any)
        .update({
          status: 'accepted',
          accepted_at: new Date().toISOString(),
          created_organizer_user_id: user.id,
        })
        .eq('id', invitation.id);

      toast.success(t('Partenariat activé 🎉', 'Partnership activated 🎉', 'Partenariado activado 🎉'));
      navigate('/organizer-app/dashboard');
    } catch (err: any) {
      toast.error(err.message || t('Erreur', 'Error', 'Error'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = async () => {
    if (!invitation) return;
    await supabase
      .from('organizer_claim_invitations' as any)
      .update({ status: 'declined' })
      .eq('id', invitation.id);
    toast.info(t('Invitation refusée', 'Invitation declined', 'Invitación rechazada'));
    navigate('/');
  };

  if (loading || authLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  if (!invitation || !venue) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center text-muted-foreground">
            {t('Invitation introuvable ou expirée.', 'Invitation not found or expired.', 'Invitación no encontrada o caducada.')}
          </CardContent>
        </Card>
      </div>
    );
  }

  const expired = new Date(invitation.expires_at) < new Date();
  if (expired || invitation.status !== 'pending') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center text-muted-foreground">
            {expired
              ? t('Cette invitation est expirée.', 'This invitation has expired.', 'Esta invitación ha caducado.')
              : invitation.status === 'accepted'
                ? t('Cette invitation est déjà acceptée.', 'This invitation has already been accepted.', 'Esta invitación ya ha sido aceptada.')
                : t('Cette invitation est refusée.', 'This invitation was declined.', 'Esta invitación fue rechazada.')}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 dashboard-gradient-bg">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <Handshake className="h-7 w-7 text-primary" />
          </div>
          <CardTitle>{t('Invitation à collaborer', 'Invitation to collaborate', 'Invitación para colaborar')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-card/40">
            {venue.logo_url ? (
              <img src={venue.logo_url} alt="" className="h-12 w-12 rounded-lg object-cover" />
            ) : (
              <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center"><Building2 className="h-6 w-6 text-muted-foreground" /></div>
            )}
            <div>
              <div className="font-semibold">{venue.name}</div>
              {venue.city && <div className="text-xs text-muted-foreground">{venue.city}</div>}
            </div>
          </div>

          {invitation.invitation_message && (
            <div className="bg-muted/30 border-l-2 border-primary/50 p-3 text-sm italic text-muted-foreground rounded">
              « {invitation.invitation_message} »
            </div>
          )}

          {event && (
            <div className="rounded-md bg-primary/5 border border-primary/20 p-3 text-sm">
              🎟️ {t('Soirée associée :', 'Linked event:', 'Evento asociado:')} <strong>{event.title}</strong>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            {t('En acceptant, ton compte deviendra un compte', 'By accepting, your account will become a', 'Al aceptar, tu cuenta se convertirá en una cuenta de')}{' '}
            <strong>{t('organisateur Yuno', 'Yuno organizer', 'organizador Yuno')}</strong>{' '}
            {t('et un partenariat actif sera créé avec ce club.', 'account and an active partnership will be created with this club.', 'y se creará un partenariado activo con este club.')}
          </p>

          <div className="flex gap-2">
            <Button variant="outline" onClick={handleDecline} disabled={submitting} className="flex-1">
              <X className="h-4 w-4 mr-2" /> {t('Refuser', 'Decline', 'Rechazar')}
            </Button>
            <Button onClick={handleAccept} disabled={submitting} className="flex-1">
              <Check className="h-4 w-4 mr-2" /> {submitting ? '…' : (user ? t('Accepter', 'Accept', 'Aceptar') : t('Se connecter & accepter', 'Sign in & accept', 'Iniciar sesión y aceptar'))}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
