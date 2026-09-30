import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { formatInTimeZone } from 'date-fns-tz';
import { enUS, es, fr } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { OrgButton, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import { EventPartnersField, YunoSplitFields } from '@/components/collab/EventPartnersField';
import { MoneyAgreementPicker, type MoneyAgreement } from '@/components/collab/MoneyAgreementPicker';
import { sendPartnerInvites } from '@/components/collab/sendPartnerInvites';
import { useCoorgErrorText } from '@/components/coorg/coorgUi';
import { DEFAULT_YUNO_SPLIT, principalTerms, type CollabModeDb, type InviteContext, type PartnerDraft, type YunoSplit } from '@/lib/collabInvite';
import { defaultExternalCollectors, type ExternalCollector } from '@/lib/splitRules';
import type { CoorgScope } from '@/lib/coorg';

interface EventRow {
  id: string; title: string; start_at: string; event_kind: string | null;
  partner_venue_id: string | null; partner_organizer_id: string | null; timezone: string | null;
}

/**
 * Inviter sur une soirée DÉJÀ créée, sans quitter le hub : même champ « Avec
 * qui ? » que le formulaire de soirée, mais rien ne part tant que le pro n'a
 * pas appuyé sur « Envoyer les invitations ». Le rôle proposé est toujours
 * « Partenaire » (lecture) : donner la main se choisit, ne se subit pas.
 */
export function InviteToEventStep({ eventId, scope, settingsHref, onBack, onDone }: {
  eventId: string;
  scope: CoorgScope;
  settingsHref: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const { language } = useLanguage();
  const t = (frS: string, en: string, esS: string) => translate(language, frS, en, esS);
  const coorgErrorText = useCoorgErrorText();
  const lead = scope.venueId ? 'venue' as const : 'organizer' as const;
  const [ev, setEv] = useState<EventRow | null>(null);
  const [drafts, setDrafts] = useState<PartnerDraft[]>([]);
  const [mode, setMode] = useState<CollabModeDb>('co_event');
  const [agreement, setAgreement] = useState<MoneyAgreement>('external');
  const [collectors, setCollectors] = useState<{ tickets: ExternalCollector; tables: ExternalCollector }>(defaultExternalCollectors('co_event'));
  const [split, setSplit] = useState<YunoSplit>(DEFAULT_YUNO_SPLIT);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.from('events')
      .select('id, title, start_at, event_kind, partner_venue_id, partner_organizer_id, timezone')
      .eq('id', eventId).maybeSingle()
      .then(({ data }) => { if (active) setEv(data as EventRow | null); });
    return () => { active = false; };
  }, [eventId]);

  useEffect(() => { setCollectors(defaultExternalCollectors(mode)); }, [mode]);

  if (!ev) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" style={{ color: T3 }} /></div>;

  const linked = lead === 'organizer' ? ev.partner_venue_id : ev.partner_organizer_id;
  const ctx: InviteContext = { lead, principalOpen: ev.event_kind !== 'private_event' && !linked };
  const principal = drafts.find((d) => d.role === 'principal') ?? null;
  const principalName = principal ? (principal.name || (principal.source === 'email' ? principal.email : '')) : '';
  const dfLocale = language === 'en' ? enUS : language === 'es' ? es : fr;

  const send = async () => {
    if (drafts.length === 0 || sending) return;
    setSending(true);
    try {
      const withPrincipal = !!principal;
      if (withPrincipal) {
        await supabase.from('events').update({ money_agreement: agreement } as never).eq('id', ev.id);
      }
      const res = await sendPartnerInvites({
        eventId: ev.id, drafts,
        terms: principalTerms({ mode, agreement, collectors, split, lead }),
        lang: language === 'en' ? 'en' : language === 'es' ? 'es' : 'fr',
        organizerUserId: scope.organizerUserId ?? null,
      });
      if (res.sent > 0) {
        toast.success(t(
          `${res.sent} invitation${res.sent > 1 ? 's' : ''} envoyée${res.sent > 1 ? 's' : ''}`,
          `${res.sent} invitation${res.sent > 1 ? 's' : ''} sent`,
          `${res.sent} invitación${res.sent > 1 ? 'es' : ''} enviada${res.sent > 1 ? 's' : ''}`,
        ));
      }
      for (const e of res.errors) {
        toast.error(t(`Invitation impossible pour ${e.name}`, `Could not invite ${e.name}`, `No se pudo invitar a ${e.name}`), { description: coorgErrorText(e.code) });
      }
      if (res.sent > 0) onDone();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 transition-colors hover:opacity-80" style={{ color: T2, fontSize: 12.5, fontWeight: 560 }}>
        <ArrowLeft className="h-3.5 w-3.5" /> {t('Choisir une autre soirée', 'Pick another event', 'Elegir otro evento')}
      </button>
      <div>
        <p style={{ color: T1, fontSize: 15, fontWeight: 650, letterSpacing: '-0.01em' }}>{ev.title}</p>
        <p style={{ color: T3, fontSize: 12 }}>
          {formatInTimeZone(new Date(ev.start_at), ev.timezone || PARIS_TIMEZONE, 'EEE d MMM · HH:mm', { locale: dfLocale })}
        </p>
      </div>

      <EventPartnersField
        drafts={drafts}
        onChange={setDrafts}
        ctx={ctx}
        mode={mode}
        onModeChange={setMode}
        excludeKeys={[
          scope.venueId ? `venue:${scope.venueId}` : `org:${scope.organizerUserId}`,
          ...(linked ? [lead === 'organizer' ? `venue:${linked}` : `org:${linked}`] : []),
        ]}
      />

      {principal && (
        <div className="rounded-xl p-4" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
          <p className="mb-2" style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>{t('Partage de l’argent', 'Money split', 'Reparto del dinero')}</p>
          <MoneyAgreementPicker
            value={agreement} onChange={setAgreement} side={lead} hasClubPartner partnerName={principalName}
            collectors={collectors} onCollectorsChange={setCollectors}
            yunoDetails={<YunoSplitFields split={split} onChange={setSplit} lead={lead} partnerName={principalName} />}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <a href={settingsHref} className="inline-flex items-center gap-1.5" style={{ color: T3, fontSize: 12 }}>
          <ExternalLink className="h-3.5 w-3.5" /> {t('Ouvrir les réglages de la soirée', 'Open event settings', 'Abrir los ajustes del evento')}
        </a>
        <OrgButton variant="primary" size="sm" disabled={drafts.length === 0 || sending} onClick={() => void send()}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {drafts.length > 1
            ? t(`Envoyer ${drafts.length} invitations`, `Send ${drafts.length} invitations`, `Enviar ${drafts.length} invitaciones`)
            : t('Envoyer l’invitation', 'Send invitation', 'Enviar invitación')}
        </OrgButton>
      </div>
      <p style={{ color: T3, fontSize: 11.5 }}>
        {t('Rien n’est envoyé avant ce bouton. Chacun rejoint la soirée en acceptant.', 'Nothing is sent before this button. Each one joins by accepting.', 'No se envía nada antes de este botón. Cada uno se une al aceptar.')}
      </p>
    </div>
  );
}
