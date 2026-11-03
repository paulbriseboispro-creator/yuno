import { useCrmT } from '@/crm/i18n';
import { Icon } from '@/crm/ui/Icon';
import { DELIVERABILITY_SKIPS, hasSendRulesToShow, useCampaignSendRules } from '@/lib/email/sendRules';

/**
 * Résultats d'un e-mail (Console CRM) : ce que les règles d'envoi Yuno ont
 * fait de la partie froide de l'audience (envoi progressif, reprise Gmail).
 * Se tait quand il n'y a rien à dire.
 */
export function SendRulesBanner({ campaignId }: { campaignId: string }) {
  const { t, n: fmt, time: hhmm } = useCrmT();
  const r = useCampaignSendRules(campaignId);
  if (!r || !hasSendRulesToShow(r)) return null;
  const time = r.next_check_at ? hhmm(r.next_check_at) : null;
  const halted = r.wave_state === 'halted';
  const lines: string[] = [];
  if (r.wave_state === 'testing') {
    lines.push(t('yc.em.rules.testing', { cold: fmt(r.cold), r: r.wave_released ?? 1, t: r.wave_total ?? 1 })
      + (time ? ` ${t('yc.em.rules.nextCheck', { time })}` : ''));
  }
  if (r.wave_state === 'done') lines.push(t('yc.em.rules.done', { cold: fmt(r.cold) }));
  if (halted) lines.push(t('yc.em.rules.halted', { why: t(`yc.em.rules.why.${r.halt_reason ?? 'bounces'}`) }));
  for (const k of DELIVERABILITY_SKIPS) {
    if ((r.skipped?.[k] ?? 0) > 0) lines.push(t(`yc.em.rules.skip.${k}`, { n: fmt(r.skipped[k]) }));
  }
  return (
    <div style={{ display: 'flex', gap: 12, padding: '14px 16px', borderRadius: 16, background: halted ? 'var(--amber-50)' : 'var(--sand-50)', border: '1px solid var(--sand-200)' }}>
      <span style={{ flex: 'none', marginTop: 2, color: halted ? 'var(--amber-700)' : 'var(--ink)' }}><Icon name="shield" size={17} stroke={2.2} /></span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>{t('yc.em.rules.title')}</div>
        {lines.map((l) => <div key={l} style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--sand-700)' }}>{l}</div>)}
      </div>
    </div>
  );
}
