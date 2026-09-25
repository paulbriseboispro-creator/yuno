// Allumer une recette d'un geste — partagé par la page Automatisations et les
// suggestions « Yuno te propose d'allumer… » (page Automatisations, page
// Campagnes). Sans modèle, rien ne part : on crée le modèle Yuno de la recette
// s'il manque, puis on allume. Le moteur (cron 5 min) fait le reste.

import { supabase } from '@/integrations/supabase/client';
import { capturePosthog } from '@/lib/posthog';
import {
  AUTOMATION_META, DEFAULT_STUDIO_THEME, DEFAULT_TIER_THRESHOLD, buildStarter, delayToHours,
  type AutomationKind, type TemplateContent,
} from '@/lib/email';
import type { StudioScope } from '@/components/email-studio/hooks';

export interface TurnOnOptions {
  scope: StudioScope;
  kind: AutomationKind;
  t: (key: string) => string;
  /** `useEmailTemplates(scope).create` : rend l'id du modèle créé, ou null. */
  createTemplate: (name: string, description: string, content: TemplateContent) => Promise<string | null>;
}

export type TurnOnResult = { ok: true; created: boolean } | { ok: false; error: string };

export async function turnOnAutomation({ scope, kind, t, createTemplate }: TurnOnOptions): Promise<TurnOnResult> {
  const meta = AUTOMATION_META[kind];
  const isPlatform = scope.kind === 'platform';
  const scopeCol = scope.kind === 'venue' ? 'venue_id' : 'organizer_user_id';
  const scopeId = scope.kind === 'venue' ? scope.venueId : scope.kind === 'organizer' ? scope.organizerId : null;

  let q = supabase.from('email_automations' as never).select('id,template_id,enabled').eq('kind', kind);
  q = isPlatform ? q.is('venue_id', null).is('organizer_user_id', null) : q.eq(scopeCol, scopeId as string);
  const { data: existing, error: readError } = await q.maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  const row = existing as unknown as { id: string; template_id: string | null; enabled: boolean } | null;

  let templateId = row?.template_id || null;
  let created = false;
  if (!templateId) {
    const content = buildStarter(meta.starter, { venueName: scope.name, theme: DEFAULT_STUDIO_THEME, t });
    templateId = await createTemplate(t(`studio.starter.${meta.starter}.name`), t(`studio.starter.${meta.starter}.desc`), content);
    if (!templateId) return { ok: false, error: 'template' };
    created = true;
  }

  if (row) {
    const { error } = await supabase.from('email_automations' as never)
      .update({ enabled: true, template_id: templateId } as never).eq('id', row.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from('email_automations' as never).insert({
      ...(isPlatform ? {} : { [scopeCol]: scopeId }),
      kind, enabled: true, template_id: templateId, subject: null,
      delay_hours: delayToHours(meta, meta.defaultDelay), threshold_pct: DEFAULT_TIER_THRESHOLD,
      created_by: auth.user?.id || null,
    } as never);
    if (error) return { ok: false, error: error.message };
  }
  if (!isPlatform) capturePosthog('email_automation_toggled', { scope: scope.kind, kind, enabled: true, source: 'suggestion' });
  return { ok: true, created };
}
