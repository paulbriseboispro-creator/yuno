import type { EmailBlock, StudioCampaign } from './types';
import { usesVariables } from './variables';

// Checklist pré-envoi (tiroir « Contrôles avant envoi » + écran Récap).
// Items du prototype claude.design + l'authentification du domaine. Les ⚠️
// n'empêchent pas l'envoi, sauf les items critiques (désinscription, domaine).

export type ChecklistStatus = 'ok' | 'warn' | 'info';

export interface ChecklistItem {
  id: string;
  status: ChecklistStatus;
  critical: boolean;
  /** Clé i18n du libellé (studio.check.*) — le détail est déjà localisé. */
  labelKey: string;
  detail?: string;
}

export const SUBJECT_MAX = 62;
/** Au-delà, Gmail tronque l'email (« clipped ») : ~102 Ko. */
export const GMAIL_CLIP_BYTES = 102_400;

export interface ChecklistInput {
  subject: string;
  preheader: string;
  type: StudioCampaign['type'];
  blocks: EmailBlock[];
  /** Taille du HTML rendu (octets) — item « poids de l'email ». */
  renderedBytes?: number;
  /** Posé par l'appelant s'il sait vérifier le DNS ; défaut true (yunoapp.eu). */
  domainAuthenticated?: boolean;
}

const CTA_TYPES = new Set(['cta', 'event', 'tickets', 'table']);

export function runChecklist(input: ChecklistInput): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  // 1. Objet ≤ 62 caractères (troncature mobile)
  const subjectLen = (input.subject || '').trim().length;
  items.push({
    id: 'subject_length', critical: false, labelKey: 'studio.check.subject',
    status: subjectLen > 0 && subjectLen <= SUBJECT_MAX ? 'ok' : 'warn',
    detail: `${subjectLen}/${SUBJECT_MAX}`,
  });

  // 2. Preheader renseigné
  items.push({
    id: 'preheader', critical: false, labelKey: 'studio.check.preheader',
    status: (input.preheader || '').trim().length > 0 ? 'ok' : 'warn',
  });

  // 3. Au moins un lien d'action (bouton, événement, billetterie ou table)
  items.push({
    id: 'cta', critical: false, labelKey: 'studio.check.cta',
    status: input.blocks.some((b) => CTA_TYPES.has(b.type)) ? 'ok' : 'warn',
  });

  // 4. Toutes les images ont un alt
  const missingAlt = input.blocks.filter(
    (b) => b.type === 'image' && !!b.url && !(b.label || '').trim(),
  ).length;
  items.push({
    id: 'img_alt', critical: false, labelKey: 'studio.check.alt',
    status: missingAlt === 0 ? 'ok' : 'warn',
    detail: missingAlt > 0 ? String(missingAlt) : undefined,
  });

  // 5. Lien de désinscription — injecté par le footer sur tout envoi
  //    promotionnel (List-Unsubscribe + lien un clic). Critique.
  items.push({
    id: 'unsubscribe', critical: true, labelKey: 'studio.check.unsub',
    status: input.type === 'promotional' ? 'ok' : 'info',
  });

  // 6. Poids de l'email — au-delà de ~102 Ko Gmail tronque le message.
  if (typeof input.renderedBytes === 'number') {
    items.push({
      id: 'weight', critical: false, labelKey: 'studio.check.weight',
      status: input.renderedBytes <= GMAIL_CLIP_BYTES ? 'ok' : 'warn',
      detail: `${(input.renderedBytes / 1024).toFixed(1).replace('.', ',')} Ko`,
    });
  }

  // 7. Variables de personnalisation utilisées
  const texts: string[] = [input.subject, input.preheader];
  for (const b of input.blocks) {
    if (b.type === 'text') texts.push(b.body);
    if (b.type === 'cta') texts.push(b.label);
    if (b.type === 'table') { texts.push(b.title, b.sub); }
    if (b.type === 'html') texts.push(b.code);
  }
  items.push({
    id: 'variables', critical: false, labelKey: 'studio.check.vars',
    status: usesVariables(texts) ? 'ok' : 'warn',
  });

  // 8. Domaine d'envoi authentifié (SPF/DKIM/DMARC). Critique.
  items.push({
    id: 'domain_auth', critical: true, labelKey: 'studio.check.domain',
    status: input.domainAuthenticated === false ? 'warn' : 'ok',
  });

  return items;
}

/** true si un item critique n'est pas au vert → l'envoi est bloqué. */
export function checklistBlocksSend(items: ChecklistItem[]): boolean {
  return items.some((i) => i.critical && i.status === 'warn');
}
