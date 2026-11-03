/**
 * L'adresse du Studio pour un modèle propre à une soirée, avec la page où revenir
 * (`back`, une adresse de la Console seulement).
 */
import { CRM_ROUTES } from '@/crm/shell/nav';

export function eventTemplateStudioHref(templateId: string, kind: string, back: string): string {
  return `${CRM_ROUTES.emailStudio(templateId)}?template=${encodeURIComponent(kind)}&back=${encodeURIComponent(back)}`;
}

/** `back` lu dans l'adresse : seulement un chemin de la Console CRM, jamais une autre origine. */
export function safeCrmBack(raw: string | null | undefined): string | null {
  if (!raw || !/^\/crm(\/|\?|$)/.test(raw) || raw.includes('\\')) return null;
  return raw;
}
