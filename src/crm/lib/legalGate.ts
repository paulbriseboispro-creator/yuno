/**
 * Les documents que le titulaire d'un espace Yuno CRM accepte d'un seul geste
 * (écran `CrmLegalGate`, juste après la création du compte). Une liste, pas
 * trois cases : en ajouter un quatrième = une ligne ici, ses textes `yc.legal.*`
 * et, si c'est un nouveau type, `LegalDocType` + la contrainte de
 * `legal_acceptances`.
 *
 * Le quatrième, « Accord marketing », n'est pas un texte à part : c'est l'article 7
 * des Conditions (envois d'e-mails et de SMS) mis en avant, pour que le pro voie
 * ce à quoi il s'engage. Deux seulement sont CONTRACTUELS (Conditions et accord de sous-traitance) et
 * décident si l'écran s'ouvre ; la politique de confidentialité est
 * l'information du pro : elle est enregistrée avec les autres mais ne
 * redemande rien à un titulaire qui a déjà accepté les deux premiers.
 */
import type { LegalDocType } from '@/lib/legal';
import type { LegalSection } from '@/data/legalContent';
import type { IconName } from '@/crm/ui/Icon';

export interface CrmLegalDoc {
  id: 'terms' | 'dpa' | 'privacy' | 'marketing';
  docType: LegalDocType;
  section: LegalSection;
  /** Adresse du texte (servi à la DA du CRM, `CrmLegalPage`). */
  path: string;
  icon: IconName;
  /** Clés `yc.legal.*` : nom du document et sa phrase d'explication. */
  titleKey: string;
  summaryKey: string;
  /** Décide si l'écran s'ouvre quand elle manque. */
  contractual: boolean;
  /**
   * Carte qui MET EN AVANT un passage d'un autre document (id du document) :
   * elle s'affiche et s'accepte avec lui, sans ligne de preuve à elle (le
   * passage est déjà dans le texte haché du document).
   */
  extractOf?: CrmLegalDoc['id'];
}

export const CRM_LEGAL_DOCS: readonly CrmLegalDoc[] = [
  { id: 'terms', docType: 'terms_crm', section: 'cgv-crm', path: '/legal/cgv-crm', icon: 'file', titleKey: 'yc.legal.doc.terms', summaryKey: 'yc.legal.gate.d.terms', contractual: true },
  { id: 'dpa', docType: 'dpa', section: 'dpa', path: '/legal/dpa', icon: 'shield', titleKey: 'yc.legal.doc.dpa', summaryKey: 'yc.legal.gate.d.dpa', contractual: true },
  { id: 'privacy', docType: 'privacy', section: 'privacy', path: '/legal/privacy', icon: 'lock', titleKey: 'yc.legal.doc.privacy', summaryKey: 'yc.legal.gate.d.privacy', contractual: false },
  // « Accord marketing » : l'article 7 des Conditions (envois d'e-mails et de SMS), montré à part.
  { id: 'marketing', docType: 'terms_crm', section: 'cgv-crm', path: '/legal/cgv-crm', icon: 'send', titleKey: 'yc.legal.doc.marketing', summaryKey: 'yc.legal.gate.d.marketing', contractual: false, extractOf: 'terms' },
];

/** Les documents qui laissent une preuve d'acceptation (les extraits n'en ont pas). */
export const CRM_LEGAL_RECORDED: readonly CrmLegalDoc[] = CRM_LEGAL_DOCS.filter((d) => !d.extractOf);

/** L'écran s'ouvre si un document contractuel n'a pas été accepté dans sa version courante. */
export function legalGateNeeded(accepted: Partial<Record<LegalDocType, boolean>>): boolean {
  return CRM_LEGAL_DOCS.some((d) => d.contractual && !accepted[d.docType]);
}

/** « Au nom de … » : le nom de l'espace, sinon la formule neutre de la langue. */
export function actingName(spaceName: string | null | undefined, fallback: string): string {
  const n = (spaceName ?? '').trim();
  return n || fallback;
}

/** Remplace {w} dans un modèle de texte. */
export function fillWord(tpl: string, word: string): string {
  return tpl.split('{w}').join(word);
}
