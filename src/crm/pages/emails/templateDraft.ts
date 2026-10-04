/**
 * Un brouillon depuis un modèle : les soirées dont les modèles se servent
 * (celle annoncée sinon la prochaine, la suivante, la dernière passée), le
 * contenu des huit modèles, et la création. Partagé par l'écran Modèles et
 * par l'adresse `/crm/emails/studio/new?new=<modèle>`.
 */
import { useMemo } from 'react';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { useNights, type NightRow } from '@/crm/data/nights';
import { useEmailSettings } from '@/crm/data/emails';
import type { PendingAudience } from '@/crm/data/clients';
import { createDraftFromTemplate, pendingToAudience } from '@/crm/data/emailActions';
import { CRM_TEMPLATES, buildCrmTemplate, crmTemplate, draftName, type CrmTemplateKind, type TemplateNight } from '@/crm/lib/emailTemplates';
import type { TemplateContent } from '@/lib/email/templates';

export function toTemplateNight(n: NightRow | null | undefined): TemplateNight | null {
  if (!n) return null;
  return { id: n.id, title: n.title, coverUrl: n.cover_url, url: n.url, lineup: n.lineup ?? [] };
}

export function useTemplateDraft(wanted: string | null) {
  const { t, lang } = useCrmT();
  const { space, rpc: scopeArgs } = useCrmScope();
  const nights = useNights();
  const settings = useEmailSettings();

  const { night, second, last } = useMemo(() => {
    const all = nights.data?.nights ?? [];
    const up = all.filter((x) => x.upcoming).sort((a, b) => a.start_at.localeCompare(b.start_at));
    const past = all.filter((x) => !x.upcoming).sort((a, b) => b.start_at.localeCompare(a.start_at));
    const picked = (wanted && all.find((x) => x.id === wanted)) || up[0] || null;
    const after = up.find((x) => x.id !== picked?.id) ?? null;
    return { night: picked, second: after, last: past[0] ?? null };
  }, [nights.data, wanted]);

  const contents = useMemo(() => {
    const ctx = { venueName: space.name, lang, t, night: toTemplateNight(night), second: toTemplateNight(second), last: toTemplateNight(last) };
    const out = {} as Record<CrmTemplateKind, TemplateContent>;
    for (const m of CRM_TEMPLATES) out[m.kind] = buildCrmTemplate(m.kind, ctx);
    return out;
  }, [space.name, lang, t, night, second, last]);

  /** Crée le brouillon et rend son id. */
  const create = async (kind: CrmTemplateKind, pending: PendingAudience | null): Promise<string> => {
    const meta = crmTemplate(kind) ?? CRM_TEMPLATES[CRM_TEMPLATES.length - 1];
    const linked = meta.night || kind === 'mois' ? night : null;
    return createDraftFromTemplate({
      venueId: scopeArgs.p_venue_id,
      organizerUserId: scopeArgs.p_organizer_user_id,
      name: draftName(meta.kind, t, linked),
      kind: meta.kind,
      content: contents[meta.kind],
      eventId: linked?.id ?? null,
      audiences: pending ? [pendingToAudience(pending)] : [],
      // Pas deux e-mails en trois jours ; un dernier rappel épargne ceux qui
      // ont déjà leur place.
      exclusions: { recentDays: 3, ...(meta.kind === 'lastcall' ? { excludeEventBuyers: true } : {}) },
      quietHours: settings.data?.quiet_hours ?? true,
      waves: settings.data?.waves ?? false,
    });
  };

  return { night, second, last, contents, ready: !nights.isLoading, create };
}
