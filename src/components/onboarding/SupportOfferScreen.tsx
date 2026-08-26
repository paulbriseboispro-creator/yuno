// Écran de consentement « Yuno configure tout pour vous », affiché juste après
// l'activation d'un compte invité.
//
// Il vit dans un composant partagé parce qu'il y a DEUX chemins d'activation, et
// que l'oublier sur l'un des deux revient à ne pas avoir la fonctionnalité :
//   • /auth?invite_platform=<token>  ← le lien réellement envoyé par email
//   • /accept-platform-invitation?token=<token>  ← la page dédiée
// Le premier est celui que suivent les vrais invités : c'est lui qui compte.

import { useState } from 'react';
import { LifeBuoy, Lock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';

interface Props {
  /** Jeton de l'invitation qui portait l'offre. */
  token: string;
  /** Appelé quand le pro a tranché (accepté ou refusé) — l'appelant redirige. */
  onDone: () => void;
  /** Chemin d'activation : 'platform' (organisateur, défaut) ou 'owner'
   *  (invitation club) — chacun a sa propre RPC d'acceptation. */
  variant?: 'platform' | 'owner';
}

export function SupportOfferScreen({ token, onDone, variant = 'platform' }: Props) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    setBusy(true);
    const rpcName = variant === 'owner'
      ? 'accept_support_offer_from_owner_invitation'
      : 'accept_support_offer_from_invitation';
    const { error } = await supabase.rpc(rpcName as 'accept_support_offer_from_invitation', { _token: token });
    setBusy(false);
    if (error) {
      toast.error(t(
        "Ça n'a pas marché. Vous pourrez le faire depuis vos réglages.",
        "That didn't work. You can do it from your settings.",
        'No ha funcionado. Podrás hacerlo desde tus ajustes.',
      ));
    } else {
      toast.success(t(
        "C'est noté — l'équipe Yuno va configurer votre compte.",
        'Done — the Yuno team will set your account up.',
        'Anotado: el equipo de Yuno configurará tu cuenta.',
      ));
    }
    onDone();
  };

  const guarantees = [
    t("Vos paiements, vos coordonnées bancaires et vos virements restent inaccessibles — c'est la base de données qui le refuse, pas une promesse.",
      'Your payments, bank details and payouts stay out of reach — the database refuses them, it is not a promise.',
      'Tus pagos, datos bancarios y transferencias quedan fuera de alcance: lo rechaza la base de datos, no es una promesa.'),
    t("Votre email de connexion, votre code PIN et votre double authentification ne peuvent pas être modifiés.",
      'Your login email, PIN and two-factor cannot be changed.',
      'Tu email de acceso, tu PIN y tu doble factor no se pueden modificar.'),
    t("Chaque action est écrite dans un journal que vous consultez quand vous voulez.",
      'Every action is written to a log you can read whenever you want.',
      'Cada acción queda en un registro que puedes consultar cuando quieras.'),
    t("Vous coupez l'accès en un bouton, et il expire seul au bout de 7 jours.",
      'You cut access with one button, and it expires on its own after 7 days.',
      'Cortas el acceso con un botón y caduca solo a los 7 días.'),
  ];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 space-y-5">
        <div className="text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 mb-4">
            <LifeBuoy className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-xl font-bold tracking-tight">
            {t('Voulez-vous que Yuno configure tout pour vous ?',
               'Want Yuno to set everything up for you?',
               '¿Quieres que Yuno lo configure todo por ti?')}
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            {t("L'équipe Yuno peut monter votre première soirée avec vous : billetterie, guest lists, tables VIP, profil public.",
               'The Yuno team can build your first event with you: ticketing, guest lists, VIP tables, public profile.',
               'El equipo de Yuno puede montar tu primera noche contigo: entradas, guest lists, mesas VIP, perfil público.')}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('Ce que ça protège', 'What stays protected', 'Qué queda protegido')}
          </p>
          {guarantees.map((line) => (
            <p key={line} className="text-xs text-muted-foreground flex items-start gap-2">
              <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
              <span>{line}</span>
            </p>
          ))}
        </div>

        <div className="space-y-2">
          <Button className="w-full" onClick={accept} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LifeBuoy className="h-4 w-4 mr-2" />}
            {t('Oui, aidez-moi à tout configurer', 'Yes, set it up with me', 'Sí, configúralo conmigo')}
          </Button>
          <Button variant="ghost" className="w-full" onClick={onDone} disabled={busy}>
            {t('Non merci, je gère seul', 'No thanks, I will do it myself', 'No gracias, lo hago yo')}
          </Button>
          <p className="text-[11px] text-center text-muted-foreground pt-1">
            {t("Vous pourrez changer d'avis à tout moment dans vos réglages.",
               'You can change your mind anytime in your settings.',
               'Puedes cambiar de opinión cuando quieras en tus ajustes.')}
          </p>
        </div>
      </Card>
    </div>
  );
}
