// « Yuno configure mon compte pour moi » — proposé à la fin de l'onboarding.
//
// C'est le moment où l'offre a le plus de valeur : le compte existe, le pro voit
// l'étendue de ce qu'il y a à régler (billetterie, guest lists, tables, profil)
// et beaucoup préfèrent qu'on le fasse avec eux pour leur première soirée.
// Attendre qu'ils bloquent une semaine plus tard, c'est perdre la soirée.
//
// L'opt-in crée un accès DÉJÀ accordé (RPC `request_support_help`) : le clic est
// le consentement, on ne le redemande pas dans un second écran. Il reste
// révocable en un bouton depuis les réglages, expire seul au bout de 7 jours,
// et n'ouvre jamais les paiements ni l'identité de connexion.

import { useState } from 'react';
import { LifeBuoy, Check, Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';

const RED = '#E8192C';
const POS = '#34D399';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';

interface Props {
  /** Route des réglages où le pro pourra couper l'accès (affichée en clair). */
  settingsPath: string;
}

export function SupportHelpOptIn({ settingsPath }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');

  const accept = async () => {
    setState('busy');
    const { error } = await supabase.rpc('request_support_help', {
      _reason: tt(
        "Demandé à la création du compte : configuration complète par l'équipe Yuno.",
        'Requested at signup: full account setup by the Yuno team.',
        'Solicitado al crear la cuenta: configuración completa por el equipo de Yuno.',
      ),
    });
    if (error) {
      setState('idle');
      toast.error(tt("Ça n'a pas marché. Réessayez.", "That didn't work. Try again.", 'No ha funcionado. Inténtalo de nuevo.'));
      return;
    }
    setState('done');
  };

  if (state === 'done') {
    return (
      <div className="rounded-2xl p-4" style={{ background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.25)' }}>
        <div className="flex items-start gap-3">
          <Check className="w-5 h-5 flex-none mt-0.5" style={{ color: POS }} />
          <div>
            <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>
              {tt("C'est noté — on s'en occupe", "Done — we'll take it from here", 'Anotado, nos encargamos')}
            </p>
            <p style={{ color: T3, fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
              {tt(
                `L'équipe Yuno va configurer votre compte. Vous verrez chaque action dans le journal, et vous pouvez couper l'accès à tout moment depuis ${settingsPath}.`,
                `The Yuno team will set your account up. Every action shows in the log, and you can cut access anytime from ${settingsPath}.`,
                `El equipo de Yuno configurará tu cuenta. Verás cada acción en el registro y puedes cortar el acceso cuando quieras desde ${settingsPath}.`,
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-4" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-none"
          style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
          <LifeBuoy className="w-4.5 h-4.5" style={{ color: RED }} />
        </div>
        <div className="min-w-0">
          <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>
            {tt('Vous préférez que Yuno configure tout ?', 'Prefer Yuno to set it all up?', '¿Prefieres que Yuno lo configure todo?')}
          </p>
          <p style={{ color: T2, fontSize: 12.5, marginTop: 4, lineHeight: 1.55 }}>
            {tt(
              "Autorisez l'équipe Yuno à monter votre première soirée avec vous : billetterie, guest lists, tables, profil public.",
              'Let the Yuno team build your first event with you: ticketing, guest lists, tables, public profile.',
              'Autoriza al equipo de Yuno a montar tu primera noche contigo: entradas, guest lists, mesas, perfil público.',
            )}
          </p>
          <p className="flex items-start gap-1.5" style={{ color: T3, fontSize: 11.5, marginTop: 8, lineHeight: 1.5 }}>
            <Lock className="w-3 h-3 flex-none mt-0.5" />
            {tt(
              "Vos paiements, vos coordonnées bancaires, votre email de connexion et votre double authentification restent inaccessibles. Chaque action est journalisée et vous coupez l'accès quand vous voulez.",
              'Your payments, bank details, login email and two-factor stay out of reach. Every action is logged and you can cut access whenever you want.',
              'Tus pagos, datos bancarios, email de acceso y doble factor quedan fuera de alcance. Todo queda registrado y puedes cortar el acceso cuando quieras.',
            )}
          </p>
          <button
            type="button"
            onClick={accept}
            disabled={state === 'busy'}
            className="mt-3 inline-flex items-center gap-2 rounded-xl px-3.5 py-2 cursor-pointer"
            style={{ background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.3)', color: RED, fontSize: 12.5, fontWeight: 600 }}
          >
            {state === 'busy' ? <Loader2 className="w-4 h-4 animate-spin" /> : <LifeBuoy className="w-4 h-4" />}
            {tt("Oui, aidez-moi à tout configurer", 'Yes, set it up with me', 'Sí, configúralo conmigo')}
          </button>
        </div>
      </div>
    </div>
  );
}
