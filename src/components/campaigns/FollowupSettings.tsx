// Réglage de la relance après clic depuis le RAPPORT d'une campagne partie.
//
// Le studio n'est plus accessible une fois la campagne en vol ou envoyée, et
// c'est justement là que la relance prend son sens : les clics sont déjà là.
// Même contrat que la carte de l'écran Planification (délai, modèle, création
// du modèle Yuno), écrit directement sur la ligne de la campagne — le moteur
// du cron lit ces trois colonnes à chaque passage.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2, Repeat, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { buildStarter, CLICK_FOLLOWUP_TEMPLATE_NAME_KEY, DEFAULT_STUDIO_THEME } from '@/lib/email';
import { useEmailTemplates, type StudioScope } from '@/components/email-studio/hooks';

const DELAYS = [6, 12, 24, 48];
const RED = '#E8192C';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const WARN = '#FCD34D';

export interface FollowupInitial {
  enabled: boolean;
  delayHours: number;
  templateId: string | null;
}

export default function FollowupSettings({ campaignId, scope, initial, onSaved, basePath }: {
  campaignId: string;
  scope: StudioScope;
  initial: FollowupInitial;
  /** Racine des campagnes de la portée, pour ouvrir le modèle dans le studio. */
  basePath?: string;
  /** Appelé après chaque écriture réussie (le rapport recharge son bilan). */
  onSaved?: () => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { templates, create } = useEmailTemplates(scope);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [delay, setDelay] = useState(initial.delayHours);
  const [templateId, setTemplateId] = useState<string | null>(initial.templateId);
  const [busy, setBusy] = useState(false);
  const fill = (key: string, vars: Record<string, string | number>) =>
    Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), t(key));

  const save = async (patch: Partial<FollowupInitial>) => {
    const next = { enabled, delayHours: delay, templateId, ...patch };
    setBusy(true);
    const { error } = await supabase.from('email_campaigns').update({
      followup_enabled: next.enabled,
      followup_delay_hours: next.delayHours,
      followup_template_id: next.templateId,
    } as never).eq('id', campaignId);
    setBusy(false);
    if (error) { toast.error(error.message); return false; }
    setEnabled(next.enabled); setDelay(next.delayHours); setTemplateId(next.templateId);
    onSaved?.();
    return true;
  };

  const createStarter = async () => {
    setBusy(true);
    try {
      const content = buildStarter('click_followup', { venueName: scope.name, theme: DEFAULT_STUDIO_THEME, t });
      const id = await create(t(CLICK_FOLLOWUP_TEMPLATE_NAME_KEY), t('studio.starter.click_followup.desc'), content);
      if (!id) { toast.error(t('studio.sched.fu.createError')); return; }
      if (await save({ templateId: id, enabled: true })) toast.success(t('studio.sched.fu.created'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}`, borderRadius: 14, padding: '14px 16px' }}>
      <div className="flex items-center gap-3">
        <Repeat className="w-4 h-4 shrink-0" style={{ color: RED }} />
        <div className="min-w-0 flex-1">
          <div style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{t('studio.sched.fu.title')}</div>
          <div style={{ color: T3, fontSize: 11.5, marginTop: 2, lineHeight: 1.45 }}>{fill('studio.sched.fu.sub', { h: delay })}</div>
        </div>
        <button
          type="button" role="switch" aria-checked={enabled} aria-label={t('studio.sched.fu.title')} disabled={busy}
          onClick={() => void save({ enabled: !enabled })}
          style={{
            width: 34, height: 20, borderRadius: 999, border: 'none', padding: 0, position: 'relative', flex: 'none',
            background: enabled ? RED : 'rgba(255,255,255,0.12)', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
          }}
        >
          <span style={{ position: 'absolute', top: 2, left: enabled ? 16 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
        </button>
      </div>

      {enabled && (
        <div className="mt-3 space-y-3">
          <div>
            <div style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{t('studio.sched.fu.delay')}</div>
            <div className="flex gap-1" style={{ padding: 3, borderRadius: 11, background: 'rgba(255,255,255,0.02)' }}>
              {DELAYS.map((h) => (
                <button
                  key={h} type="button" aria-pressed={delay === h} disabled={busy}
                  onClick={() => void save({ delayHours: h })}
                  style={{
                    flex: 1, padding: '7px 4px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 11.5, fontWeight: 560,
                    color: delay === h ? T1 : T3,
                    background: delay === h ? 'linear-gradient(180deg,rgba(255,255,255,.13),rgba(255,255,255,.07))' : 'transparent',
                  }}
                >{fill('studio.sched.fu.hours', { h })}</button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{t('studio.sched.fu.template')}</div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={templateId || ''} disabled={busy}
                onChange={(e) => void save({ templateId: e.target.value || null })}
                aria-label={t('studio.sched.fu.template')}
                style={{
                  flex: 1, minWidth: 220, height: 36, borderRadius: 10, padding: '0 10px', colorScheme: 'dark',
                  background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: T1, fontSize: 12.5,
                }}
              >
                <option value="">{t('studio.sched.fu.templateNone')}</option>
                {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
              </select>
              <button
                type="button" onClick={() => void createStarter()} disabled={busy}
                className="inline-flex items-center gap-1.5 cursor-pointer"
                style={{
                  padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`,
                  color: T1, fontSize: 11.5, fontWeight: 600, opacity: busy ? 0.6 : 1,
                }}
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {t('studio.sched.fu.createStarter')}
              </button>
            </div>
            <div style={{ color: T3, fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
              {templateId && basePath ? (
                <button
                  type="button" onClick={() => navigate(`${basePath}/templates/${templateId}`)}
                  className="cursor-pointer" style={{ background: 'none', border: 'none', padding: 0, color: RED, fontSize: 11 }}
                >{t('studio.sched.fu.editTemplate')} →</button>
              ) : t('studio.sched.fu.editHint')}
            </div>
            {!templateId && (
              <div className="flex items-start gap-2 mt-2" style={{ padding: '9px 12px', borderRadius: 11, background: 'rgba(252,211,77,0.07)', border: '1px solid rgba(252,211,77,0.22)' }}>
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: WARN }} />
                <span style={{ color: T2, fontSize: 11.5, lineHeight: 1.5 }}>{t('studio.sched.fu.noTemplate')}</span>
              </div>
            )}
          </div>

          <ul style={{ margin: 0, paddingLeft: 16, color: T2, fontSize: 11.5, lineHeight: 1.5 }}>
            {['rule1', 'rule2', 'rule3', 'rule4', 'rule5'].map((k) => <li key={k}>{t(`studio.sched.fu.${k}`)}</li>)}
          </ul>
          <div style={{ color: T3, fontSize: 11, lineHeight: 1.5 }}>{t('studio.sched.fu.night')} {t('studio.sched.fu.smart')}</div>
        </div>
      )}
    </div>
  );
}
