import { useState } from 'react';
import { Handshake, ShieldCheck } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { OrgButton, OrgCard, OrgSectionLabel, T1, T2, T3 } from '@/components/org-ui';
import { SplitContractBanner } from '@/components/SplitContractBanner';
import { externalCollectors } from '@/lib/splitRules';

/**
 * Co-soirée club × organisateur « Réglée entre vous » : pas de contrat Yuno,
 * chaque pilier encaissé en direct par une seule partie. La carte dit qui
 * encaisse quoi, et — tant que rien n'est vendu — propose de passer par un
 * contrat Yuno (qui referme la vente jusqu'aux deux signatures : on le dit).
 */
export function ExternalAgreementCard({ eventId, rules, isVenue, canAct, hasSales, side, clubName, orgName }: {
  eventId: string;
  rules: unknown;
  isVenue: boolean;
  /** Le lead peut proposer un contrat ; le partenaire lit. */
  canAct: boolean;
  hasSales: boolean;
  side?: 'venue' | 'organizer';
  clubName: string;
  orgName: string;
}) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  const [proposing, setProposing] = useState(false);
  const c = externalCollectors(rules);
  if (!c) return null;
  const nameOf = (who: 'venue' | 'organizer') => {
    const mine = (who === 'venue') === isVenue;
    return mine ? t('toi', 'you', 'tú') : (who === 'venue' ? clubName : orgName);
  };

  if (proposing) {
    return (
      <div className="space-y-2">
        <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.45 }}>
          {t(
            'En proposant un contrat Yuno, la vente se met en pause jusqu’aux deux signatures.',
            'Proposing a Yuno contract pauses sales until both parties sign.',
            'Al proponer un contrato Yuno, la venta se pausa hasta las dos firmas.',
          )}
        </p>
        <SplitContractBanner eventId={eventId} side={side} />
      </div>
    );
  }

  return (
    <OrgCard className="p-5">
      <OrgSectionLabel>
        <span className="inline-flex items-center gap-1.5"><Handshake className="h-3.5 w-3.5" /> {t('Accord réglé entre vous', 'Settled between you', 'Acuerdo entre vosotros')}</span>
      </OrgSectionLabel>
      <p className="mt-1.5" style={{ color: T2, fontSize: 12.5, lineHeight: 1.5 }}>
        {t(
          'Pas de contrat Yuno : chaque vente est encaissée directement par qui la tient, et vous réglez le reste entre vous.',
          'No Yuno contract: each sale is collected directly by whoever runs it, and you settle the rest between you.',
          'Sin contrato Yuno: cada venta la cobra directamente quien la lleva, y el resto lo arregláis entre vosotros.',
        )}
      </p>
      <ul className="mt-2 space-y-0.5" style={{ color: T1, fontSize: 12.5 }}>
        <li>{t('Billets', 'Tickets', 'Entradas')} → {nameOf(c.tickets)}</li>
        <li>{t('Tables VIP', 'VIP tables', 'Mesas VIP')} → {nameOf(c.tables)}</li>
        <li>{t('Bar', 'Bar', 'Barra')} → {nameOf('venue')}</li>
      </ul>
      {canAct && !hasSales && (
        <OrgButton size="sm" variant="secondary" className="mt-3" onClick={() => setProposing(true)}>
          <ShieldCheck className="h-4 w-4" /> {t('Passer par un contrat Yuno', 'Switch to a Yuno contract', 'Pasar a un contrato Yuno')}
        </OrgButton>
      )}
      {hasSales && (
        <p className="mt-2" style={{ color: T3, fontSize: 11, lineHeight: 1.45 }}>
          {t(
            'La soirée a vendu : l’accord reste réglé entre vous jusqu’au bout.',
            'The night has sold: the agreement stays settled between you to the end.',
            'La noche ya ha vendido: el acuerdo sigue entre vosotros hasta el final.',
          )}
        </p>
      )}
    </OrgCard>
  );
}
