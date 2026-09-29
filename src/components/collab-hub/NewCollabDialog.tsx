import { ChevronRight, Handshake, Lock, Mail, Network, UserPlus, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { RED, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';

export type NewCollabChoice = 'propose' | 'partner' | 'invite' | 'coorg';

/**
 * « Nouvelle collaboration » — la seule porte d'entrée du hub. Quatre chemins
 * existaient déjà (Proposer une soirée, Demander un partenariat, onglet
 * Inviter, Co-organiser) ; le pro devait deviner lequel prendre. Ici chaque
 * chemin dit EN UNE PHRASE quand il sert, et un chemin fermé dit pourquoi.
 */
export function NewCollabDialog({
  open, onOpenChange, side, canPropose, hasActivePartners, onChoose,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  side: 'venue' | 'organizer';
  /** Faux pour un club au plan Collaboration : il reçoit des soirées, il n'en propose pas. */
  canPropose: boolean;
  hasActivePartners: boolean;
  onChoose: (c: NewCollabChoice) => void;
}) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  const isVenue = side === 'venue';
  const other = isVenue
    ? { one: t('un organisateur', 'an organizer', 'un organizador') }
    : { one: t('un club', 'a club', 'un club') };

  const proposeBlocked = !canPropose
    ? t('Non inclus dans ton offre actuelle.', 'Not included in your current plan.', 'No incluido en tu plan actual.')
    : !hasActivePartners
      ? t('Ajoute d’abord un partenaire (juste en dessous).', 'Add a partner first (just below).', 'Añade primero un socio (justo debajo).')
      : null;

  const choices: { key: NewCollabChoice; icon: LucideIcon; title: string; body: string; blocked?: string | null }[] = [
    {
      key: 'propose', icon: Handshake,
      title: isVenue
        ? t('Proposer une soirée à un organisateur partenaire', 'Propose an event to a partner organizer', 'Proponer un evento a un organizador socio')
        : t('Proposer une soirée à un club partenaire', 'Propose an event to a partner club', 'Proponer un evento a un club socio'),
      body: t(
        'Un contrat signé par vous deux, qui fixe qui touche quoi sur chaque vente.',
        'An agreement you both sign, setting who gets what on every sale.',
        'Un contrato firmado por los dos, que fija quién cobra qué en cada venta.',
      ),
      blocked: proposeBlocked,
    },
    {
      key: 'partner', icon: UserPlus,
      title: t(`Ajouter ${other.one} déjà sur Yuno`, `Add ${other.one} already on Yuno`, `Añadir ${other.one} que ya está en Yuno`),
      body: t(
        'Il accepte, puis vous vous proposez des soirées en un clic, avec vos conditions habituelles.',
        'They accept, then you propose events to each other in one click, with your usual terms.',
        'Acepta, y luego os proponéis eventos en un clic, con vuestras condiciones habituales.',
      ),
    },
    {
      key: 'invite', icon: Mail,
      title: t('Inviter quelqu’un qui n’est pas sur Yuno', 'Invite someone who isn’t on Yuno', 'Invitar a alguien que no está en Yuno'),
      body: t(
        'Un email avec la soirée et tes conditions ; il crée son compte en acceptant.',
        'An email with the event and your terms; they create their account when accepting.',
        'Un email con el evento y tus condiciones; crea su cuenta al aceptar.',
      ),
    },
    {
      key: 'coorg', icon: Network,
      title: t('Co-organiser une de mes soirées à plusieurs', 'Co-organize one of my events with several partners', 'Coorganizar uno de mis eventos con varios socios'),
      body: t(
        'Plusieurs organisateurs ou clubs sur la même soirée : chacun la gère depuis sa Console, les parts se règlent après un décompte validé par tous.',
        'Several organizers or clubs on the same event: each runs it from its Console, shares are settled after a statement everyone approves.',
        'Varios organizadores o clubes en el mismo evento: cada uno lo gestiona desde su Consola, las partes se liquidan tras un cierre validado por todos.',
      ),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-0 p-0" style={{ background: 'var(--sf-0a0a0c)', border: `1px solid ${BORDER}`, borderRadius: 18, maxWidth: 560 }}>
        <div className="p-6">
          <DialogHeader>
            <DialogTitle style={{ color: T1, fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>
              {t('Nouvelle collaboration', 'New collaboration', 'Nueva colaboración')}
            </DialogTitle>
            <DialogDescription style={{ color: T3, fontSize: 12.5 }}>
              {t('Avec qui fais-tu cette soirée ?', 'Who are you doing this event with?', '¿Con quién haces este evento?')}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-2">
            {choices.map((c) => {
              const disabled = !!c.blocked;
              return (
                <button
                  key={c.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChoose(c.key)}
                  className="flex w-full items-start gap-3 rounded-2xl p-4 text-left transition-all duration-150 enabled:cursor-pointer enabled:hover:bg-[rgb(var(--ink)/0.05)]"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}`, opacity: disabled ? 0.55 : 1 }}
                >
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl" style={{ background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.22)' }}>
                    {disabled ? <Lock className="h-4 w-4" style={{ color: T3 }} /> : <c.icon className="h-4 w-4" style={{ color: RED }} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block" style={{ color: T1, fontSize: 13.5, fontWeight: 620 }}>{c.title}</span>
                    <span className="mt-0.5 block" style={{ color: T2, fontSize: 12, lineHeight: 1.5 }}>{c.blocked ?? c.body}</span>
                  </span>
                  {!disabled && <ChevronRight className="mt-2 h-4 w-4 flex-none" style={{ color: T3 }} />}
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
