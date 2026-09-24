// Renvoi aux non-ouvreurs, réglé depuis le RAPPORT d'une campagne partie.
//
// Le geste le moins cher et le plus rentable de l'email : le même email,
// sous un autre objet, N h après la fin de l'envoi, à ceux qui ne l'ont pas
// ouvert. Il se règle aussi à l'écran Planification ; ici c'est pour la
// campagne déjà envoyée (le studio n'est plus accessible), et le bilan du
// renvoi vit au même endroit — la campagne mère.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MailOpen } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { RESEND_DELAYS, type ResendStats } from '@/lib/email';

const RED = '#E8192C';
const T1 = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2 = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const T3 = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const BORDER = 'rgb(var(--ink)/0.085)';
const INNER_BG = 'rgb(var(--ink)/0.032)';
const POS = 'var(--acc-34d399)';

const nf = (n: number) => n.toLocaleString('fr-FR');

export default function ResendSettings({ campaignId, editable, basePath, onSaved }: {
  campaignId: string;
  /** false pour un enfant (relance, renvoi, recette) : on ne renvoie pas un renvoi. */
  editable: boolean;
  basePath?: string;
  onSaved?: () => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [stats, setStats] = useState<ResendStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [subject, setSubject] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc('get_campaign_resend_stats' as never, { p_campaign_id: campaignId } as never)
      .then(({ data }) => {
        if (cancelled) return;
        const s = ((data as unknown) as ResendStats | null) || null;
        setStats(s);
        setSubject(s?.subject || '');
      });
    return () => { cancelled = true; };
  }, [campaignId, reload]);

  const fill = (key: string, vars: Record<string, string | number>) =>
    Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), t(key));

  const save = async (patch: { enabled?: boolean; delayHours?: number; subject?: string }) => {
    if (!stats) return;
    setBusy(true);
    const { error } = await supabase.from('email_campaigns').update({
      resend_enabled: patch.enabled ?? stats.enabled,
      resend_delay_hours: patch.delayHours ?? stats.delay_hours,
      resend_subject: (patch.subject ?? subject).trim() || null,
    } as never).eq('id', stats.parent_id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setReload((n) => n + 1);
    onSaved?.();
  };

  if (!stats) return null;

  // Enfant « Renvoi » : rattachement à la mère, rien d'autre.
  if (stats.is_child) {
    return (
      <div style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '12px 16px' }} className="flex items-center justify-between gap-3 flex-wrap">
        <span style={{ color: T2, fontSize: 13 }}>{t('em.report.rs.childOf').replace('{name}', stats.parent_name)}</span>
        {basePath && (
          <button type="button" onClick={() => navigate(`${basePath}/${stats.parent_id}/report`)} className="cursor-pointer" style={{ color: RED, fontSize: 12.5, fontWeight: 600, background: 'none', border: 'none' }}>
            {t('em.report.fu.openParent')} →
          </button>
        )}
      </div>
    );
  }

  const locked = !editable || !!stats.done_at;
  const child = stats.child;

  return (
    <div style={{ background: 'rgb(var(--ink)/0.025)', border: `1px solid ${BORDER}`, borderRadius: 14, padding: '14px 16px' }}>
      <div className="flex items-center gap-3">
        <MailOpen className="w-4 h-4 shrink-0" style={{ color: RED }} />
        <div className="min-w-0 flex-1">
          <div style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{t('studio.sched.rs.title')}</div>
          <div style={{ color: T3, fontSize: 11.5, marginTop: 2, lineHeight: 1.45 }}>
            {child
              ? t('em.report.rs.done')
              : stats.nobody
                ? t('em.report.rs.nobody')
                : stats.enabled
                  ? fill('em.report.rs.waiting', { h: stats.delay_hours })
                  : fill('studio.sched.rs.sub', { h: stats.delay_hours })}
          </div>
        </div>
        {!locked && (
          <button
            type="button" role="switch" aria-checked={stats.enabled} aria-label={t('studio.sched.rs.title')} disabled={busy}
            onClick={() => void save({ enabled: !stats.enabled })}
            style={{ width: 34, height: 20, borderRadius: 999, border: 'none', padding: 0, position: 'relative', flex: 'none', background: stats.enabled ? RED : 'rgb(var(--ink)/0.12)', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
          >
            <span style={{ position: 'absolute', top: 2, left: stats.enabled ? 16 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
          </button>
        )}
      </div>

      {!locked && stats.enabled && (
        <div className="mt-3 space-y-3">
          <div>
            <div style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{t('studio.sched.rs.delay')}</div>
            <div className="flex gap-1" style={{ padding: 3, borderRadius: 11, background: 'rgb(var(--ink)/0.02)' }}>
              {RESEND_DELAYS.map((h) => (
                <button
                  key={h} type="button" aria-pressed={stats.delay_hours === h} disabled={busy}
                  onClick={() => void save({ delayHours: h })}
                  style={{ flex: 1, padding: '7px 4px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 11.5, fontWeight: 560, color: stats.delay_hours === h ? T1 : T3, background: stats.delay_hours === h ? 'linear-gradient(180deg,rgb(var(--ink)/.13),rgb(var(--ink)/.07))' : 'transparent' }}
                >{fill('studio.sched.fu.hours', { h })}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{t('studio.sched.rs.subject')}</div>
            <input
              value={subject} disabled={busy} maxLength={200}
              onChange={(e) => setSubject(e.target.value)}
              onBlur={() => { if ((stats.subject || '') !== subject.trim()) void save({ subject }); }}
              placeholder={t('studio.sched.rs.subjectPh')}
              aria-label={t('studio.sched.rs.subject')}
              style={{ width: '100%', height: 36, borderRadius: 10, padding: '0 10px', background: 'rgb(var(--ink)/0.04)', border: `1px solid ${BORDER}`, color: T1, fontSize: 12.5 }}
            />
            <div style={{ color: T3, fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>{t('studio.sched.rs.subjectHint')}</div>
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, color: T2, fontSize: 11.5, lineHeight: 1.5 }}>
            {['rule1', 'rule2', 'rule3'].map((k) => <li key={k}>{t(`studio.sched.rs.${k}`)}</li>)}
          </ul>
        </div>
      )}

      {child && (
        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap" style={{ padding: '10px 12px', borderRadius: 11, background: INNER_BG, border: `1px solid ${BORDER}` }}>
          <div className="flex items-center gap-4 flex-wrap">
            {[
              [t('em.report.fu.sent'), child.sent],
              [t('em.report.fu.opens'), child.opens],
              [t('em.report.fu.clicks'), child.clickers],
              [t('em.report.rs.unsubscribes'), child.unsubscribes],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <div style={{ color: T1, fontSize: 15, fontWeight: 640, fontVariantNumeric: 'tabular-nums' }}>{nf(Number(value))}</div>
                <div style={{ color: T3, fontSize: 10.5 }}>{label}</div>
              </div>
            ))}
            <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, color: child.status === 'sent' ? POS : T2, background: INNER_BG, border: `1px solid ${BORDER}` }}>
              {t(`em.status.${child.status}`)}
            </span>
          </div>
          {basePath && (
            <button type="button" onClick={() => navigate(`${basePath}/${child.id}/report`)} className="cursor-pointer" style={{ color: RED, fontSize: 12, fontWeight: 600, background: 'none', border: 'none' }}>
              {t('em.report.rs.openChild')} →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
