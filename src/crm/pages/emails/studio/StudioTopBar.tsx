/**
 * Barre du haut du Studio : retour, nom de la campagne, état d'enregistrement,
 * les quatre étapes (Contenu, Audience, Planification, Vérification),
 * annuler / rétablir, ordinateur / mobile, Aperçu, Test, Continuer. Sous elle,
 * le bandeau d'un envoi programmé.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useCrmToast } from '@/crm/ui/toast';
import { EASE, SPRING } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { unscheduleCampaign } from '@/crm/data/emailActions';
import { useStudio, useStudioApi } from '@/components/email-studio/store';
import { useInvalidateEmails } from '@/crm/data/emails';

const IC = {
  undo: 'M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8',
  redo: 'M21 7v6h-6M21 13a9 9 0 1 1-3-7.7L21 8',
  monitor: 'M2 4h20v12H2zM8 20h8M12 16v4',
  phone: 'M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM12 18h.01',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  spin: 'M21 12a9 9 0 1 1-3-6.7',
};

type Step = 'aud' | 'plan' | 'check';

export function StudioTopBar({ narrow, readOnly, failed, onStep, onTest, template = false }: { narrow: boolean; readOnly: boolean; failed: boolean; onStep: (s: Step | null) => void; onTest: () => void; template?: boolean }) {
  const { t } = useCrmT();
  const api = useStudioApi();
  const name = useStudio((s) => s.campaign.name);
  const status = useStudio((s) => s.campaign.status);
  const saving = useStudio((s) => s.saving);
  const savedAt = useStudio((s) => s.savedAt);
  const canUndo = useStudio((s) => s.past.length > 0);
  const canRedo = useStudio((s) => s.future.length > 0);
  const device = useStudio((s) => s.device);
  const preview = useStudio((s) => s.preview);
  const [, tick] = useState(0);
  useEffect(() => { const i = window.setInterval(() => tick((n) => n + 1), 5000); return () => window.clearInterval(i); }, []);
  // Les étapes se resserrent (numéro seul, sauf l'étape en cours) avant de
  // toucher les boutons de droite.
  const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1440));
  useEffect(() => { const on = () => setW(window.innerWidth); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  const tightSteps = w < 1500;
  const showUndo = w >= 1280;
  // Téléphone : l'appareil est déjà un mobile, et « Continuer » se réduit à sa flèche.
  const phone = w < 640;

  const ago = savedAt ? Math.round((Date.now() - savedAt) / 1000) : 0;
  const saveLabel = failed ? t('yc.em.st.saveFail')
    : saving ? t('yc.em.st.saving')
      : ago < 6 ? t('yc.em.st.savedNow')
        : ago < 60 ? t('yc.em.st.savedS', { n: ago })
          : t('yc.em.st.savedM', { n: Math.round(ago / 60) });
  const steps: { k: Step | null; l: string }[] = [
    { k: null, l: t('yc.em.st.step.content') },
    { k: 'aud', l: t('yc.em.st.step.aud') },
    { k: 'plan', l: t('yc.em.st.step.plan') },
    { k: 'check', l: t('yc.em.st.step.check') },
  ];
  const nameW = Math.max(120, Math.min(420, (name || '').length * 10.5 + 12));
  const sched = status === 'scheduled';

  const roundBtn = (on: boolean) => ({ width: 38, height: 38, border: 0, borderRadius: 99, background: 'none', color: on ? 'var(--ink)' : 'var(--sand-300)', cursor: on ? 'pointer' : 'default', display: 'grid', placeItems: 'center' } as const);

  return (
    <>
      <header style={{ flex: 'none', height: 64, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: phone ? 8 : 16, padding: narrow ? '0 12px' : '0 20px', background: 'rgba(252,250,249,.9)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid var(--sand-100)', position: 'relative', zIndex: 40 }}>
        <div style={{ flex: '1 1 0', minWidth: phone ? 60 : 120, display: 'flex', alignItems: 'center', gap: phone ? 8 : 12 }}>
          <Hv as={Link} to={template ? CRM_ROUTES.automations : CRM_ROUTES.emailCampaigns} aria-label={t(template ? 'yc.au.tpl.back' : 'yc.em.st.back')} title={t(template ? 'yc.au.tpl.back' : 'yc.em.st.back')} style={{ flex: 'none', width: phone ? 36 : 40, height: phone ? 36 : 40, borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', color: 'var(--ink)', display: 'grid', placeItems: 'center', textDecoration: 'none' }} hover={{ background: 'var(--sand-50)', color: 'var(--ink)' }}>
            <Icon name="arrowLeft" size={17} stroke={2.3} />
          </Hv>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <input
                value={name}
                readOnly={readOnly}
                onChange={(e) => api.getState().patchCampaign({ name: e.target.value })}
                aria-label={t('yc.em.st.name')}
                className="yc-studio-name"
                style={{ minWidth: 60, width: nameW, maxWidth: '100%', border: 0, outline: 0, background: 'transparent', padding: '2px 6px', margin: '0 -6px', borderRadius: 8, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-.02em', color: 'var(--ink)' }}
              />
              {!narrow && (
                <span style={{ flex: 'none', height: 22, padding: '0 9px', borderRadius: 99, background: template ? 'var(--red-50)' : sched ? 'var(--green-50)' : 'var(--amber-50)', color: template ? 'var(--red-700)' : sched ? 'var(--green-700)' : 'var(--amber-700)', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                  {t(template ? 'yc.au.tpl.badge' : sched ? 'yc.em.st.status.scheduled' : 'yc.em.st.status.draft')}
                </span>
              )}
            </div>
            {!readOnly && !phone && (
              <span style={{ fontSize: 12.5, color: failed ? 'var(--amber-700)' : 'var(--sand-500)', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                {saving
                  ? <Icon d={IC.spin} size={12} stroke={2.6} style={{ animation: 'yc-spin 800ms linear infinite' }} />
                  : !failed && <Icon name="check" size={12} stroke={3} style={{ color: 'var(--green-700)' }} />}
                {saveLabel}
              </span>
            )}
          </div>
        </div>

        {!narrow && !readOnly && !template && (
          <nav aria-label={t('yc.em.st.steps')} style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
            {steps.map((s, i) => {
              const cur = i === 0;
              return (
                <span key={s.l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Hv
                    as="button"
                    type="button"
                    onClick={() => { if (s.k) onStep(s.k); }}
                    aria-current={cur ? 'step' : undefined}
                    title={s.l}
                    aria-label={s.l}
                    style={{ height: 38, padding: tightSteps && !cur ? '0 7px' : '0 14px 0 8px', border: 0, borderRadius: 99, display: 'flex', alignItems: 'center', gap: 9, background: cur ? 'var(--red-50)' : 'transparent', color: cur ? 'var(--red-700)' : 'var(--sand-500)', fontSize: 14, fontWeight: cur ? 600 : 500, whiteSpace: 'nowrap', cursor: cur ? 'default' : 'pointer', transition: 'background 160ms' }}
                    hover={{ background: cur ? 'var(--red-50)' : 'var(--sand-50)' }}
                  >
                    <span style={{ width: 24, height: 24, borderRadius: 99, background: cur ? 'var(--red-500)' : 'var(--sand-100)', color: cur ? '#fff' : 'var(--sand-600)', display: 'grid', placeItems: 'center', fontSize: 12.5, fontWeight: 600 }}>{i + 1}</span>
                    {(!tightSteps || cur) && <span style={{ fontSize: 14, fontWeight: cur ? 600 : 500 }}>{s.l}</span>}
                  </Hv>
                  {i < steps.length - 1 && <span style={{ width: 14, height: 1.5, background: 'var(--sand-200)', borderRadius: 2 }} />}
                </span>
              );
            })}
          </nav>
        )}

        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: phone ? 6 : 8 }}>
          {!readOnly && !narrow && showUndo && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Hv as="button" type="button" onClick={() => api.getState().undo()} aria-label={t('yc.em.st.undo')} title={t('yc.em.st.undo')} style={roundBtn(canUndo)} hover={canUndo ? { background: 'var(--sand-100)' } : undefined}><Icon d={IC.undo} size={18} stroke={2.1} /></Hv>
              <Hv as="button" type="button" onClick={() => api.getState().redo()} aria-label={t('yc.em.st.redo')} title={t('yc.em.st.redo')} style={roundBtn(canRedo)} hover={canRedo ? { background: 'var(--sand-100)' } : undefined}><Icon d={IC.redo} size={18} stroke={2.1} /></Hv>
            </div>
          )}
          {!phone && <div role="group" aria-label={t('yc.em.st.device')} style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--sand-100)', borderRadius: 99, flex: 'none' }}>
            {(['desktop', 'mobile'] as const).map((d) => {
              const on = device === d;
              return (
                <button key={d} type="button" onClick={() => api.getState().setDevice(d)} aria-pressed={on} aria-label={t(d === 'desktop' ? 'yc.em.st.desk' : 'yc.em.st.mob')} title={t(d === 'desktop' ? 'yc.em.st.desk' : 'yc.em.st.mob')} style={{ width: 38, height: 32, border: 0, borderRadius: 99, background: on ? '#fff' : 'transparent', boxShadow: on ? 'var(--shadow-xs)' : 'none', color: on ? 'var(--ink)' : 'var(--sand-500)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
                  <Icon d={d === 'desktop' ? IC.monitor : IC.phone} size={17} stroke={2.1} />
                </button>
              );
            })}
          </div>}
          {!readOnly && (
            <>
              <Hv
                as="button"
                type="button"
                onClick={() => api.getState().setPreview(!preview)}
                aria-pressed={preview}
                title={t('yc.em.st.previewKey')}
                aria-label={t('yc.em.st.preview')}
                style={{ height: 40, padding: narrow ? 0 : '0 16px', width: narrow ? 40 : undefined, justifyContent: 'center', borderRadius: 99, borderWidth: 1, borderStyle: 'solid', borderColor: preview ? 'var(--ink)' : 'var(--sand-200)', background: preview ? 'var(--ink)' : '#fff', color: preview ? '#fff' : 'var(--ink)', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}
                hover={{ borderColor: 'var(--sand-400)' }}
              >
                <Icon d={IC.eye} size={16} stroke={2.1} />{!narrow && t('yc.em.st.preview')}
              </Hv>
              {!template && <Hv
                as="button"
                type="button"
                onClick={onTest}
                title={t('yc.em.st.testTitle')}
                aria-label={t('yc.em.st.testTitle')}
                style={{ height: 40, padding: narrow ? 0 : '0 16px', width: narrow ? 40 : undefined, justifyContent: 'center', borderRadius: 99, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--sand-200)', background: '#fff', color: 'var(--ink)', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}
                hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }}
              >
                <Icon name="send" size={16} stroke={2.1} />{!narrow && t('yc.em.st.test')}
              </Hv>}
              <Hv
                as="button"
                type="button"
                onClick={() => onStep(null)}
                aria-label={t(template ? 'yc.au.tpl.done' : 'yc.em.st.next')}
                style={{ height: 44, padding: phone ? '0 5px' : '0 5px 0 20px', borderRadius: 99, border: 0, background: 'var(--gradient-brand)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, boxShadow: 'var(--shadow-cta)', cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none', transition: `transform 200ms ${SPRING},filter 160ms` }}
                hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }}
                active={{ transform: 'scale(.97)' }}
              >
                {!phone && t(template ? 'yc.au.tpl.done' : 'yc.em.st.next')}
                <span style={{ width: 34, height: 34, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon name={template ? 'check' : 'arrowRight'} size={16} stroke={2.4} /></span>
              </Hv>
            </>
          )}
        </div>
      </header>
      {readOnly && (
        <div style={{ flex: 'none', padding: '10px 20px', background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 14, fontWeight: 500, borderBottom: '1px solid var(--sand-100)', textAlign: 'center' }}>{t('yc.em.st.readOnly')}</div>
      )}
      {sched && !readOnly && !template && <ScheduledBand />}
      {template && (
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '9px 20px', background: 'var(--sand-50)', color: 'var(--sand-600)', fontSize: 13.5, fontWeight: 500, borderBottom: '1px solid var(--sand-100)', textAlign: 'center' }}>
          <Icon name="zap" size={14} stroke={2.2} />{t('yc.au.tpl.note')}
        </div>
      )}
    </>
  );
}

function ScheduledBand() {
  const { t, dLong, time } = useCrmT();
  const toast = useCrmToast();
  const api = useStudioApi();
  const invalidate = useInvalidateEmails();
  const at = useStudio((s) => s.campaign.scheduledAt);
  const id = useStudio((s) => s.campaign.id);
  const [, tick] = useState(0);
  useEffect(() => { const i = window.setInterval(() => tick((n) => n + 1), 30_000); return () => window.clearInterval(i); }, []);
  if (!at) return null;
  const when = new Date(at);
  const min = Math.max(0, Math.round((when.getTime() - Date.now()) / 60_000));
  const soon = min < 30;
  const cancel = async () => {
    try {
      await unscheduleCampaign(id);
      api.getState().patchCampaign({ status: 'draft' });
      invalidate();
      toast(t('yc.em.st.unscheduled'));
    } catch {
      toast(t('yc.em.tp.err'));
    }
  };
  return (
    <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: '6px 14px', padding: '9px 20px', background: soon ? 'var(--red-50)' : 'var(--green-50)', color: soon ? 'var(--red-700)' : 'var(--green-700)', fontSize: 14, fontWeight: 500, borderBottom: '1px solid var(--sand-100)', animation: `yc-rise 400ms ${EASE} both` }}>
      <Icon name={soon ? 'alert' : 'clock'} size={15} stroke={2.2} />
      <span>{soon ? t('yc.em.st.scheduledSoon', { n: min }) : t('yc.em.st.scheduled', { date: dLong(when), time: time(when) })}</span>
      <button type="button" onClick={() => void cancel()} style={{ height: 30, padding: '0 12px', border: 0, borderRadius: 99, background: '#fff', color: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{t('yc.em.st.unschedule')}</button>
    </div>
  );
}
