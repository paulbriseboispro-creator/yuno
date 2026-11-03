/**
 * Étape « Quand » › « Relancer ceux qui cliquent sans prendre de place » : une
 * relance par personne, {délai} après son clic vers la page de la soirée, avec un
 * modèle du compte. Le moteur (collect_campaign_followups, cron toutes les 5 min)
 * écarte qui a pris une place, qui s'est désabonné, et ne relance jamais dans les
 * 2 h avant la soirée ; les règles d'envoi de Yuno s'appliquent comme à l'envoi.
 *
 * Le modèle vient de la bibliothèque du compte, ou est PROPRE À LA SOIRÉE de la
 * campagne (20261123100000) : une copie unique, faite par exemple d'un brouillon
 * déjà dessiné, qui ne rejoint jamais la bibliothèque et s'efface après la soirée.
 */
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { useCrmToast } from '@/crm/ui/toast';
import { Hv } from '@/crm/ui/Hv';
import { createAutomationTemplate } from '@/crm/data/automations';
import { useScenarioEmailTemplates } from '@/crm/data/scenarios';
import { useEventTemplates } from '@/crm/data/eventTemplates';
import { EventTemplateDialog } from '@/crm/components/EventTemplateDialog';
import { eventTemplateStudioHref } from '@/crm/lib/eventTemplateHref';
import { Card, CardHead, Pills, Row, Toggle48 } from './sendUi';

export const FOLLOWUP_DELAYS = [6, 12, 24, 48] as const;

export interface FollowupState { on: boolean; delay: number; templateId: string | null }

export function FollowupCard({ value, onChange, eventId, campaignId, disabled }: {
  value: FollowupState;
  onChange: (p: Partial<FollowupState>) => void;
  /** Soirée reliée : sans elle, il n'y a pas de page à relancer. */
  eventId: string | null;
  /** Le brouillon : sert au test de la relance. */
  campaignId: string;
  disabled?: boolean;
}) {
  const hasEvent = !!eventId;
  const T = useCrmT();
  const { t } = T;
  const { space, qk } = useCrmScope();
  const toast = useCrmToast();
  const qc = useQueryClient();
  const templates = useScenarioEmailTemplates();
  const evTpls = useEventTemplates();
  const nav = useNavigate();
  const loc = useLocation();
  const [busy, setBusy] = useState(false);
  const [own, setOwn] = useState(false);
  const [testing, setTesting] = useState(false);
  const list = templates.data ?? [];
  const forNight = (evTpls.data ?? []).filter((x) => x.event_id === eventId && !x.expired);
  const chosenEv = (evTpls.data ?? []).find((x) => x.id === value.templateId) ?? null;
  // Un modèle propre à une AUTRE soirée ne part jamais (la soirée de l'e-mail a changé).
  const otherNight = !!chosenEv && chosenEv.event_id !== eventId;
  const missing = value.on && (!value.templateId || otherNight);
  const here = `${loc.pathname}${loc.search}`;

  const createModel = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const id = await createAutomationTemplate({
        kind: 'click_no_buy', venueId: space.venueId, organizerUserId: space.venueId ? null : space.organizerUserId,
        venueName: space.name, lang: T.lang, t,
      });
      await qc.invalidateQueries({ queryKey: ['crm', qk, 'scenario-email-templates'] });
      onChange({ templateId: id });
      toast(t('yc.em.sd.fu.created'));
    } catch {
      toast(t('yc.em.sd.fu.err'));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (testing || !value.templateId) return;
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-campaign', {
        body: { campaign_id: campaignId, send_test: true, followup_template_id: value.templateId },
      });
      const to = (data as { to?: string[] } | null)?.to ?? [];
      toast(error || !to.length ? t('yc.em.sd.fu.testErr') : t('yc.em.sd.fu.testOk', { to: to.join(', ') }));
    } catch {
      toast(t('yc.em.sd.fu.testErr'));
    } finally {
      setTesting(false);
    }
  };

  const ghost = { height: 40, padding: '0 16px', border: 0, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--ink)', fontSize: 14, fontWeight: 600, cursor: 'pointer' } as const;

  return (
    <Card gap={2}>
      <CardHead title={t('yc.em.sd.fu.t')} sub={t('yc.em.sd.fu.s')} />
      <Row
        title={t('yc.em.sd.fu.toggle')}
        sub={!hasEvent ? t('yc.em.sd.fu.noEvent') : value.on ? t('yc.em.sd.fu.on', { h: value.delay }) : t('yc.em.sd.fu.off')}
        right={<Toggle48 on={value.on && hasEvent} onChange={(v) => { if (hasEvent && !disabled) onChange({ on: v }); }} label={t('yc.em.sd.fu.toggle')} />}
      />
      {value.on && hasEvent && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 6 }}>
          <div style={{ alignSelf: 'flex-start' }}>
            <Pills value={value.delay} onChange={(v) => onChange({ delay: v })} label={t('yc.em.sd.fu.delay')}
              options={FOLLOWUP_DELAYS.map((h) => ({ v: h, l: t('yc.em.sd.fu.h', { h }) }))} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            <select
              aria-label={t('yc.em.sd.fu.model')} value={value.templateId ?? ''} disabled={disabled}
              onChange={(e) => onChange({ templateId: e.target.value || null })}
              className="yc-field"
              style={{ height: 44, minWidth: 240, maxWidth: '100%', padding: '0 12px', borderRadius: 12, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14.5, color: 'var(--ink)' }}
            >
              <option value="">{t('yc.em.sd.fu.pick')}</option>
              {forNight.length > 0 && (
                <optgroup label={t('yc.em.sd.fu.groupNight')}>
                  {forNight.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </optgroup>
              )}
              {chosenEv && otherNight && <option value={chosenEv.id}>{chosenEv.name}</option>}
              <optgroup label={t('yc.em.sd.fu.groupLib')}>
                {list.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </optgroup>
            </select>
            <Hv as="button" type="button" onClick={() => { void createModel(); }} disabled={busy || disabled}
              style={ghost} hover={{ background: 'var(--sand-200)' }}>{t('yc.em.sd.fu.create')}</Hv>
            <Hv as="button" type="button" onClick={() => setOwn(true)} disabled={busy || disabled}
              style={ghost} hover={{ background: 'var(--sand-200)' }}>{t('yc.em.sd.fu.own')}</Hv>
          </div>
          {chosenEv && !otherNight && (
            <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 14px', fontSize: 13.5, color: 'var(--sand-700)' }}>
              <span>{chosenEv.expires_at ? t('yc.em.sd.fu.ownNote', { date: T.dShort(chosenEv.expires_at) }) : t('yc.em.sd.fu.ownNoteNoDate')}</span>
              <button type="button" onClick={() => nav(eventTemplateStudioHref(chosenEv.id, 'click_no_buy', here))}
                style={{ padding: 0, border: 0, background: 'none', font: 'inherit', fontWeight: 600, color: 'var(--ink)', textDecoration: 'underline', cursor: 'pointer' }}>{t('yc.em.sd.fu.ownEdit')}</button>
            </span>
          )}
          {value.templateId && !otherNight && (
            <Hv as="button" type="button" onClick={() => { void test(); }} disabled={testing}
              style={{ ...ghost, alignSelf: 'flex-start', background: 'transparent', border: '1px solid var(--sand-200)' }}
              hover={{ background: 'var(--sand-50)' }}>{testing ? '…' : t('yc.em.sd.fu.test')}</Hv>
          )}
          {otherNight && <span role="status" style={{ fontSize: 13.5, color: 'var(--amber-700)' }}>{t('yc.em.sd.fu.otherNight')}</span>}
          {missing && !otherNight && <span role="status" style={{ fontSize: 13.5, color: 'var(--amber-700)' }}>{t('yc.em.sd.fu.missing')}</span>}
          <span style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.em.sd.fu.who', { h: value.delay })}</span>
        </div>
      )}
      {own && eventId && (
        <EventTemplateDialog
          open onClose={() => setOwn(false)} kind="click_no_buy" label={t('yc.em.sd.fu.t')}
          fixedEventId={eventId}
          baseTemplateId={chosenEv ? null : value.templateId}
          onCreated={async (id) => {
            await qc.invalidateQueries({ queryKey: ['crm', qk, 'event-templates'] });
            onChange({ templateId: id });
            setOwn(false);
            toast(t('yc.au.et.created'));
            // Le choix du modèle s'enregistre d'abord (la page l'écrit en quittant), puis le Studio s'ouvre.
            window.setTimeout(() => nav(eventTemplateStudioHref(id, 'click_no_buy', here)), 60);
          }}
        />
      )}
    </Card>
  );
}
