/**
 * « Un modèle pour une soirée » : crée un modèle UNIQUE et TEMPORAIRE, propre à une
 * soirée, en partant du modèle de base de la recette, d'un e-mail du compte (un
 * brouillon déjà dessiné) ou du modèle Yuno. Il remplace le modèle de base pour
 * cette soirée seulement, puis s'efface seul (fin de la soirée + 14 jours). Le
 * modèle de base ne change jamais. Ouvert depuis une recette (Automatisations) ou
 * depuis la relance après clic d'une campagne (soirée fixée).
 */
import { useEffect, useMemo, useState } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { CtaButton, Modal } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { useNights } from '@/crm/data/nights';
import { useEmailCampaigns } from '@/crm/data/emails';
import { createEventTemplate, eventTemplateNights, type EventTemplateSource } from '@/crm/data/eventTemplates';
import { buildCrmTemplate } from '@/crm/lib/emailTemplates';
import { CRM_AUTO_META, type CrmAutoKind } from '@/crm/lib/automations';
import { Pills } from '@/crm/pages/emails/send/sendUi';
import { toTemplateNight } from '@/crm/pages/emails/templateDraft';

type From = 'base' | 'email' | 'yuno';

const FIELD = {
  height: 44, width: '100%', boxSizing: 'border-box', padding: '0 12px', borderRadius: 12,
  border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14.5, color: 'var(--ink)',
} as const;

type Props = {
  open: boolean;
  onClose: () => void;
  /** Recette (pour le modèle Yuno et le nom proposé). La relance de campagne passe `click_no_buy`. */
  kind: CrmAutoKind;
  /** Nom de ce que le modèle remplace (« A cliqué sans acheter », « Relance de la campagne »). */
  label: string;
  /** Soirée imposée (relance d'une campagne). */
  fixedEventId?: string | null;
  baseTemplateId?: string | null;
  /** Soirées qui ont déjà un modèle propre pour cette recette. */
  excludeEventIds?: string[];
  onCreated: (templateId: string, eventId: string) => Promise<void> | void;
};

/** Montée à l'ouverture seulement : chaque ouverture repart d'un formulaire neuf. */
export function EventTemplateDialog(p: Props) {
  return p.open ? <Body {...p} /> : null;
}

function Body({ onClose, kind, label, fixedEventId = null, baseTemplateId = null, excludeEventIds = [], onCreated }: Props) {
  const T = useCrmT();
  const { t, dShort } = T;
  const toast = useCrmToast();
  const { space } = useCrmScope();
  const nights = useNights();
  const camps = useEmailCampaigns();
  const [eventId, setEventId] = useState<string>(fixedEventId ?? '');
  const [from, setFrom] = useState<From>(baseTemplateId ? 'base' : 'email');
  const [campId, setCampId] = useState<string>('');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  const choices = useMemo(
    () => eventTemplateNights(nights.data?.nights ?? []).filter((n) => n.id === fixedEventId || !excludeEventIds.includes(n.id)),
    [nights.data, fixedEventId, excludeEventIds],
  );
  const emails = useMemo(
    () => (camps.data?.campaigns ?? []).filter((c) => c.has_content).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 60),
    [camps.data],
  );
  const night = (nights.data?.nights ?? []).find((n) => n.id === (fixedEventId ?? eventId)) ?? null;

  // La prochaine soirée, dès que la liste est là.
  useEffect(() => {
    if (!eventId && choices.length) setEventId(choices.find((n) => n.upcoming)?.id ?? choices[0].id);
  }, [eventId, choices]);

  useEffect(() => {
    const ev = fixedEventId ?? eventId;
    const pick = emails.find((c) => c.event_id === ev) ?? emails[0];
    setCampId(pick?.id ?? '');
  }, [eventId, fixedEventId, emails]);

  useEffect(() => {
    if (!touched) setName(night ? t('yc.au.et.defName', { what: label, night: night.title }).slice(0, 80) : '');
  }, [night, label, touched, t]);

  const ev = fixedEventId ?? eventId;
  const ready = !!ev && !!name.trim() && (from !== 'email' || !!campId) && (from !== 'base' || !!baseTemplateId);

  const go = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const source: EventTemplateSource = from === 'base' && baseTemplateId ? { kind: 'template', id: baseTemplateId }
        : from === 'email' ? { kind: 'campaign', id: campId }
          : { kind: 'content', content: buildCrmTemplate(CRM_AUTO_META[kind].tpl, { venueName: space.name, lang: T.lang, t, night: toTemplateNight(night) }) };
      const id = await createEventTemplate({
        venueId: space.venueId, organizerUserId: space.venueId ? null : space.organizerUserId, eventId: ev, name, source,
      });
      await onCreated(id, ev);
    } catch {
      toast(t('yc.au.et.err'));
      setBusy(false);
    }
  };

  const fromOpts: { v: From; l: string }[] = [
    ...(baseTemplateId ? [{ v: 'base' as const, l: t('yc.au.et.fromBase') }] : []),
    { v: 'email', l: t('yc.au.et.fromEmail') },
    { v: 'yuno', l: t('yc.au.et.fromYuno') },
  ];

  return (
    <Modal open onClose={onClose} width={560} label={t('yc.au.et.title')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '26px 28px 8px' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{label}</span>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, lineHeight: 1.1, letterSpacing: '-.03em' }}>{t('yc.au.et.title')}</h2>
        <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.au.et.sub')}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '14px 28px 24px' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t('yc.au.et.night')}</span>
          {fixedEventId ? (
            <span style={{ fontSize: 15, color: 'var(--ink)' }}>{night ? `${night.title} · ${dShort(night.start_at)}` : '…'}</span>
          ) : (
            <select value={eventId} onChange={(e) => setEventId(e.target.value)} className="yc-field" style={FIELD} disabled={busy}>
              {choices.length === 0 && <option value="">{t('yc.au.et.noNight')}</option>}
              {choices.map((n) => <option key={n.id} value={n.id}>{n.title} · {dShort(n.start_at)}</option>)}
            </select>
          )}
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t('yc.au.et.from')}</span>
          <div style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
            <Pills<From> value={from} onChange={setFrom} label={t('yc.au.et.from')} options={fromOpts} />
          </div>
          {from === 'email' && (
            emails.length > 0 ? (
              <select value={campId} onChange={(e) => setCampId(e.target.value)} aria-label={t('yc.au.et.fromEmail')} className="yc-field" style={FIELD} disabled={busy}>
                {emails.map((c) => <option key={c.id} value={c.id}>{c.name || c.subject || '—'}{c.status === 'draft' ? ` · ${t('yc.au.et.draft')}` : ''}</option>)}
              </select>
            ) : <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{t('yc.au.et.noEmail')}</span>
          )}
          <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--sand-600)' }}>{t(`yc.au.et.fromHint.${from}`)}</span>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t('yc.au.et.name')}</span>
          <input value={name} maxLength={80} onChange={(e) => { setTouched(true); setName(e.target.value); }} className="yc-field" style={FIELD} disabled={busy} />
        </label>

        <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-100)', fontSize: 13.5, lineHeight: 1.5, color: 'var(--sand-700)', textWrap: 'pretty' }}>
          {t('yc.au.et.rules')}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 10, padding: '16px 28px', background: 'var(--sand-50)', borderTop: '1px solid var(--sand-100)', borderRadius: '0 0 28px 28px' }}>
        <Hv as="button" type="button" onClick={onClose} style={{ height: 44, padding: '0 18px', border: 0, borderRadius: 99, background: 'transparent', color: 'var(--ink)', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'var(--sand-100)' }}>
          {t('yc.au.et.cancel')}
        </Hv>
        <CtaButton onClick={() => { void go(); }} disabled={!ready || busy}>{busy ? '…' : t('yc.au.et.go')}</CtaButton>
      </div>
    </Modal>
  );
}
