import { ShieldCheck } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { DELIVERABILITY_SKIPS, hasSendRulesToShow, useCampaignSendRules } from '@/lib/email/sendRules';

const T1 = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2 = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const POS = 'var(--acc-34d399)';
const WARN = 'var(--acc-fcd34d)';

/**
 * Rapport de campagne (Billetterie) : ce que les règles d'envoi Yuno ont fait
 * de la partie froide de l'audience. Se tait quand il n'y a rien à dire.
 */
export default function SendRulesNotice({ campaignId }: { campaignId: string }) {
  const { t, language } = useLanguage();
  const r = useCampaignSendRules(campaignId);
  if (!r || !hasSendRulesToShow(r)) return null;

  const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString(language);
  const time = r.next_check_at
    ? new Date(r.next_check_at).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })
    : null;
  const halted = r.wave_state === 'halted';

  return (
    <div className="rounded-2xl px-4 py-3.5 space-y-1.5" style={{ border: `1px solid ${halted ? WARN : 'rgb(var(--ink)/0.1)'}`, background: 'rgb(var(--ink)/0.03)' }}>
      <p className="flex items-center gap-2" style={{ color: T1, fontSize: 13.5, fontWeight: 600, margin: 0 }}>
        <ShieldCheck className="w-4 h-4" style={{ color: halted ? WARN : POS }} />
        {t('em.rules.title')}
      </p>
      {r.wave_state === 'testing' && (
        <p style={{ color: T2, fontSize: 12.5, margin: 0 }}>
          {t('em.rules.testing').replace('{cold}', fmt(r.cold)).replace('{r}', String(r.wave_released ?? 1)).replace('{t}', String(r.wave_total ?? 1))}
          {time && <> {t('em.rules.nextCheck').replace('{time}', time)}</>}
        </p>
      )}
      {r.wave_state === 'done' && (
        <p style={{ color: T2, fontSize: 12.5, margin: 0 }}>{t('em.rules.done').replace('{cold}', fmt(r.cold))}</p>
      )}
      {halted && (
        <p style={{ color: T2, fontSize: 12.5, margin: 0 }}>
          {t('em.rules.halted').replace('{why}', t(`em.rules.why.${r.halt_reason ?? 'bounces'}`))}
        </p>
      )}
      {DELIVERABILITY_SKIPS.filter((k) => (r.skipped?.[k] ?? 0) > 0).map((k) => (
        <p key={k} style={{ color: T2, fontSize: 12.5, margin: 0 }}>
          {t(`em.rules.skip.${k}`).replace('{n}', fmt(r.skipped[k]))}
        </p>
      ))}
    </div>
  );
}
