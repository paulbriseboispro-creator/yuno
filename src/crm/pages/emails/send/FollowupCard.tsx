/**
 * Étape « Quand » › « Relancer ceux qui cliquent sans prendre de place » : une
 * relance par personne, {délai} après son clic vers la page de la soirée, avec un
 * modèle du compte. Le moteur (collect_campaign_followups, cron toutes les 5 min)
 * écarte qui a pris une place, qui s'est désabonné, et ne relance jamais dans les
 * 2 h avant la soirée ; les règles d'envoi de Yuno s'appliquent comme à l'envoi.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { useCrmToast } from '@/crm/ui/toast';
import { Hv } from '@/crm/ui/Hv';
import { createAutomationTemplate } from '@/crm/data/automations';
import { useScenarioEmailTemplates } from '@/crm/data/scenarios';
import { Card, CardHead, Pills, Row, Toggle48 } from './sendUi';

export const FOLLOWUP_DELAYS = [6, 12, 24, 48] as const;

export interface FollowupState { on: boolean; delay: number; templateId: string | null }

export function FollowupCard({ value, onChange, hasEvent, disabled }: {
  value: FollowupState;
  onChange: (p: Partial<FollowupState>) => void;
  /** Sans soirée reliée, il n'y a pas de page à relancer. */
  hasEvent: boolean;
  disabled?: boolean;
}) {
  const T = useCrmT();
  const { t } = T;
  const { space, qk } = useCrmScope();
  const toast = useCrmToast();
  const qc = useQueryClient();
  const templates = useScenarioEmailTemplates();
  const [busy, setBusy] = useState(false);
  const list = templates.data ?? [];
  const missing = value.on && !value.templateId;

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
              {list.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <Hv as="button" type="button" onClick={() => { void createModel(); }} disabled={busy || disabled}
              style={{ height: 40, padding: '0 16px', border: 0, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--ink)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              hover={{ background: 'var(--sand-200)' }}>{t('yc.em.sd.fu.create')}</Hv>
          </div>
          {missing && <span role="status" style={{ fontSize: 13.5, color: 'var(--amber-700)' }}>{t('yc.em.sd.fu.missing')}</span>}
          <span style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.em.sd.fu.who', { h: value.delay })}</span>
        </div>
      )}
    </Card>
  );
}
