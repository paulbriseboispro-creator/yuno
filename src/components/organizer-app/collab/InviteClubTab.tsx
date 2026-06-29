import { useState } from 'react';
import { Mail, Loader2, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import {
  OrgCard, OrgButton, FieldLabel, DarkInput, DarkTextarea,
  T1, T3,
} from '@/components/org-ui';

/**
 * "Inviter" tab of the organizer Collaborations hub — parity with the club's
 * /owner/collaborations?tab=invite. Email-invite a venue that isn't on Yuno yet;
 * they get a link to create a free Yuno Collaboration account and partner with you.
 * Connecting to a club that already has a Yuno account lives in "Clubs partenaires".
 */
export function InviteClubTab() {
  const { toast } = useToast();
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const [form, setForm] = useState({
    club_name: '', club_email: '', club_city: '', club_address: '',
    contact_first_name: '', contact_last_name: '', invitation_message: '',
  });
  const [inviting, setInviting] = useState(false);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleInvite = async () => {
    if (!form.club_name.trim() || !form.club_email.trim()) {
      toast({ title: t('Champs requis', 'Required fields', 'Campos obligatorios'), description: t('Nom et email du club sont obligatoires.', 'Club name and email are required.', 'El nombre y el correo del club son obligatorios.'), variant: 'destructive' });
      return;
    }
    setInviting(true);
    try {
      const { data, error } = await supabase.functions.invoke('invite-club-collab', {
        body: { ...form, origin: window.location.origin },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({
        title: t('Invitation envoyée 📧', 'Invitation sent 📧', 'Invitación enviada 📧'),
        description: t(
          `Un email a été envoyé à ${form.club_email}.`,
          `An email was sent to ${form.club_email}.`,
          `Se ha enviado un correo a ${form.club_email}.`,
        ),
      });
      setForm({ club_name: '', club_email: '', club_city: '', club_address: '', contact_first_name: '', contact_last_name: '', invitation_message: '' });
    } catch (err: any) {
      toast({ title: t('Erreur', 'Error', 'Error'), description: err.message, variant: 'destructive' });
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="space-y-5">
      <OrgCard>
        <div className="p-6">
          <div className="mb-1 flex items-center gap-2">
            <Mail className="h-5 w-5" style={{ color: '#E8192C' }} />
            <h2 style={{ color: T1, fontSize: 16, fontWeight: 600 }}>{t('Inviter un club externe', 'Invite an external club', 'Invitar a un club externo')}</h2>
          </div>
          <p className="mb-5" style={{ color: T3, fontSize: 12.5, lineHeight: 1.5 }}>
            {t(
              "Invite par email un établissement qui n'est pas encore sur Yuno. Il recevra un lien pour créer son compte et collaborer avec toi.",
              'Invite a venue that is not on Yuno yet by email. They will get a link to create their account and collaborate with you.',
              'Invita por correo a un establecimiento que aún no está en Yuno. Recibirá un enlace para crear su cuenta y colaborar contigo.',
            )}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><FieldLabel>{t('Nom du club *', 'Club name *', 'Nombre del club *')}</FieldLabel><DarkInput value={form.club_name} onChange={set('club_name')} placeholder="Le Bistro" /></div>
            <div className="col-span-2"><FieldLabel>{t('Email du club *', 'Club email *', 'Correo del club *')}</FieldLabel><DarkInput type="email" value={form.club_email} onChange={set('club_email')} placeholder="contact@lebistro.fr" /></div>
            <div><FieldLabel>{t('Prénom contact', 'Contact first name', 'Nombre del contacto')}</FieldLabel><DarkInput value={form.contact_first_name} onChange={set('contact_first_name')} /></div>
            <div><FieldLabel>{t('Nom contact', 'Contact last name', 'Apellido del contacto')}</FieldLabel><DarkInput value={form.contact_last_name} onChange={set('contact_last_name')} /></div>
            <div><FieldLabel>{t('Ville', 'City', 'Ciudad')}</FieldLabel><DarkInput value={form.club_city} onChange={set('club_city')} placeholder="Paris" /></div>
            <div><FieldLabel>{t('Adresse', 'Address', 'Dirección')}</FieldLabel><DarkInput value={form.club_address} onChange={set('club_address')} placeholder={t('12 rue…', '12 Main St…', 'C/ Mayor 12…')} /></div>
            <div className="col-span-2"><FieldLabel>{t('Message personnalisé (optionnel)', 'Custom message (optional)', 'Mensaje personalizado (opcional)')}</FieldLabel><DarkTextarea value={form.invitation_message} onChange={set('invitation_message')} placeholder={t('Présente ton projet, la soirée envisagée, ta communauté…', 'Introduce your project, the event you have in mind, your community…', 'Presenta tu proyecto, el evento previsto, tu comunidad…')} rows={4} /></div>
          </div>

          <div className="mt-5 flex justify-end">
            <OrgButton variant="primary" onClick={handleInvite} disabled={inviting}>
              {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              {inviting ? t('Envoi…', 'Sending…', 'Enviando…') : t("Envoyer l'invitation", 'Send invitation', 'Enviar la invitación')}
            </OrgButton>
          </div>
        </div>
      </OrgCard>

      <OrgCard style={{ background: 'rgba(232,25,44,0.05)', border: '1px solid rgba(232,25,44,0.2)' }}>
        <div className="flex items-start gap-3 p-5">
          <Info className="mt-0.5 h-4 w-4 shrink-0" style={{ color: '#E8192C' }} />
          <p style={{ color: T3, fontSize: 12, lineHeight: 1.55 }}>
            {t('Le club recevra un accès', 'The club will get a', 'El club recibirá un acceso')} <strong style={{ color: T1 }}>Yuno Collaboration</strong> {t(
              'gratuit (page publique, stats, paiements). Il pourra activer un plan complet plus tard. Un club déjà sur Yuno ? Utilise plutôt l’onglet « Clubs partenaires ».',
              'free access (public page, stats, payments). They can activate a full plan later. Already on Yuno? Use the "Partner clubs" tab instead.',
              'gratuito (página pública, estadísticas, pagos). Podrá activar un plan completo más tarde. ¿Ya está en Yuno? Usa la pestaña «Clubes asociados».',
            )}
          </p>
        </div>
      </OrgCard>
    </div>
  );
}
