import { FileSignature } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { getEffectiveSplit } from '@/utils/coEventSplit';
import { isTieredRules } from '@/lib/splitRules';
import { SettlementRecap } from '@/components/collab/SettlementModeSwitch';
import { INNER_BG, BORDER, T1, T2, T3, RED } from '@/components/org-ui';

/**
 * Ce que le contrat va proposer, montré AVANT d'envoyer la demande.
 *
 * Le formulaire de soirée ouvre le contrat avec les conditions habituelles du
 * partenariat (`default_split_rules`, reprises côté serveur par
 * `create_event_collab_contract`) : sans ce récapitulatif, le pro envoyait un
 * partage d'argent qu'il n'avait jamais vu. Les conditions restent modifiables
 * avant la double signature, depuis la page de la soirée.
 */
export function ProposedTermsRecap({ rules, mode, partnerName }: {
  rules: unknown;
  mode: string;
  partnerName: string;
}) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  const pct = (n: number) => `${Math.round(n)} %`;
  const line = (label: string, type: 'ticket' | 'table' | 'order') => {
    const s = getEffectiveSplit(rules, type, mode);
    return `${label} ${pct(s.venue_pct)} ${t('club', 'club', 'club')} · ${pct(s.organizer_pct)} ${t('orga', 'org', 'org')}`;
  };

  return (
    <div className="rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <p className="flex items-center gap-1.5" style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>
        <FileSignature className="h-3.5 w-3.5" style={{ color: RED }} />
        {t('Conditions proposées', 'Proposed terms', 'Condiciones propuestas')}
      </p>
      <p className="mt-0.5" style={{ color: T3, fontSize: 11.5 }}>
        {rules
          ? t(`Celles de ton partenariat avec ${partnerName}.`, `Your usual terms with ${partnerName}.`, `Las de tu colaboración con ${partnerName}.`)
          : t('Partage par défaut : aucune condition enregistrée avec ce partenaire.', 'Default split: no terms saved with this partner.', 'Reparto por defecto: no hay condiciones guardadas con este socio.')}
      </p>
      {isTieredRules(rules) ? (
        <p className="mt-2" style={{ color: T2, fontSize: 12.5 }}>
          {t('Barème sur le CA total de la soirée, réglé au décompte de fin de soirée.', 'Tiers on the night’s total revenue, settled at the end-of-night statement.', 'Escala sobre el total de la noche, liquidada al cierre.')}
        </p>
      ) : (
        <ul className="mt-2 space-y-0.5" style={{ color: T2, fontSize: 12.5 }}>
          <li>{line(t('Billets', 'Tickets', 'Entradas'), 'ticket')}</li>
          <li>{line(t('Tables', 'Tables', 'Mesas'), 'table')}</li>
          <li>{line(t('Boissons', 'Drinks', 'Bebidas'), 'order')}</li>
        </ul>
      )}
      <SettlementRecap rules={rules} className="mt-2" />
      <p className="mt-1.5" style={{ color: T3, fontSize: 11 }}>
        {t(
          'Modifiables avant la double signature, depuis la page de la soirée.',
          'You can change them before both parties sign, from the night’s page.',
          'Modificables antes de la doble firma, desde la página de la noche.',
        )}
      </p>
    </div>
  );
}
