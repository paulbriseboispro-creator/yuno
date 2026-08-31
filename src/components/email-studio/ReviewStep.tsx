import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { checklistBlocksSend, runChecklist, slugifyName } from '@/lib/email';
import { useStudio } from './store';
import { useAudienceCount, type StudioEvent, type StudioScope } from './hooks';
import {
  BORDER, FONT_UI, GhostBtn, Help, MicroLabel, PANEL_BG, PrimaryBtn, RED, SUBTLE, T1, T2, T3,
} from './ui';

/** Écran Récap : résumé + checklist pré-envoi + envoi/planification. */
export default function ReviewStep({ scope, events, onSave, onSent }: {
  scope: StudioScope;
  events: StudioEvent[];
  /** Sauvegarde le brouillon (statut optionnel) — renvoie l'id ou null. */
  onSave: (status?: string) => Promise<string | null>;
  onSent: () => void;
}) {
  const { t } = useLanguage();
  const campaign = useStudio((s) => s.campaign);
  const saveSeq = useStudio((s) => s.saveSeq);
  const { count } = useAudienceCount(campaign.id, saveSeq, campaign.audiences.length > 0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const checklist = useMemo(() => runChecklist({
    subject: campaign.subject,
    preheader: campaign.preheader,
    type: campaign.type,
    blocks: campaign.blocks,
  }), [campaign.subject, campaign.preheader, campaign.type, campaign.blocks]);

  const blocked = checklistBlocksSend(checklist);
  const net = count?.net ?? 0;
  const canSend = !blocked && net > 0 && campaign.subject.trim().length > 0 && campaign.blocks.length > 0;
  const eventTitle = events.find((e) => e.id === campaign.eventId)?.title;
  const fromAddr = `${slugifyName(scope.name)}@yunoapp.eu`;

  const sendNow = async () => {
    setSending(true);
    try {
      const id = await onSave('sending');
      if (!id) throw new Error(t('em.toast.saveError'));
      const { error } = await supabase.functions.invoke('send-campaign', { body: { campaign_id: id } });
      if (error) throw error;
      onSent();
    } catch (e) {
      // Le serveur reste seul maître du statut : on n'écrase rien ici, on
      // envoie le pro sur l'écran de progression qui dit la vérité.
      toast.error(e instanceof Error ? e.message : t('em.toast.sendError'));
      onSent();
    } finally {
      setSending(false);
      setConfirmOpen(false);
    }
  };

  const schedule = async () => {
    if (!campaign.scheduledAt) return;
    const id = await onSave('scheduled');
    if (id) {
      toast.success(t('em.toast.scheduled'));
      onSent();
    }
  };

  return (
    <div className="yn-in" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, alignItems: 'start', maxWidth: 980 }}>
      {/* Résumé */}
      <section style={{ background: SUBTLE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 }}>
        <MicroLabel style={{ marginBottom: 10 }}>{t('studio.review.summary')}</MicroLabel>
        <Row k={t('em.builder.kType')} v={campaign.type === 'informational' ? t('em.builder.info') : t('em.builder.marketing')} />
        <Row k={t('studio.review.recipients')} v={String(net)} highlight />
        {eventTitle && <Row k={t('em.builder.kEvent')} v={eventTitle} />}
        <Row k={t('em.builder.kSubject')} v={campaign.subject || '—'} />
        {campaign.abOn && campaign.subjectB && <Row k={t('studio.review.subjectB')} v={campaign.subjectB} />}
        <Row k={t('em.builder.kSender')} v={`${scope.name} <${fromAddr}>`} />
        <Row
          k={t('studio.review.when')}
          v={campaign.scheduledAt ? new Date(campaign.scheduledAt).toLocaleString() : t('studio.sched.now')}
        />
        {campaign.throttlePerHour != null && <Row k={t('studio.sched.throttle')} v={`${campaign.throttlePerHour}/h`} />}
        {campaign.quietHours && <Row k={t('studio.sched.quiet')} v={t('studio.sched.quietWindow')} />}
        {campaign.type === 'promotional' && (
          <Help style={{
            marginTop: 12, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.22)',
            borderRadius: 8, padding: '8px 10px', color: T2,
          }}>{t('em.builder.gdprSend')}</Help>
        )}
      </section>

      {/* Checklist + envoi */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ background: SUBTLE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 }}>
          <MicroLabel style={{ marginBottom: 10 }}>{t('studio.review.checklist')}</MicroLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {checklist.map((item) => {
              const icon = item.status === 'ok'
                ? <CheckCircle2 size={14} strokeWidth={1.75} style={{ color: '#34D399', flex: 'none' }} />
                : item.status === 'warn'
                  ? <AlertTriangle size={14} strokeWidth={1.75} style={{ color: item.critical ? RED : '#FCD34D', flex: 'none' }} />
                  : <Info size={14} strokeWidth={1.75} style={{ color: T3, flex: 'none' }} />;
              let label = t(item.labelKey);
              if (item.id === 'subject_length' && item.detail) label += ` (${item.detail})`;
              if (item.id === 'img_alt' && item.detail) label += ` (${item.detail} ${t('studio.review.missing')})`;
              if (item.id === 'variables') label += ` — ${item.detail === 'yes' ? t('studio.review.varsYes') : t('studio.review.varsNo')}`;
              return (
                <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  {icon}
                  <span style={{ fontSize: 12, color: item.status === 'warn' ? T1 : T2, fontFamily: FONT_UI, lineHeight: 1.45 }}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ background: SUBTLE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {campaign.scheduledAt ? (
            <PrimaryBtn onClick={schedule} disabled={!canSend} style={{ justifyContent: 'center', padding: '10px 14px' }}>
              {t('em.builder.scheduleSend')}
            </PrimaryBtn>
          ) : (
            <PrimaryBtn onClick={() => setConfirmOpen(true)} disabled={!canSend} style={{ justifyContent: 'center', padding: '10px 14px' }}>
              <Send size={14} strokeWidth={1.75} /> {t('studio.review.sendTo').replace('{n}', String(net))}
            </PrimaryBtn>
          )}
          {!canSend && (
            <Help style={{ color: RED }}>
              {blocked ? t('studio.review.blockedCritical')
                : net === 0 ? t('em.builder.warnNoRecipients')
                  : !campaign.subject.trim() ? t('em.builder.warnNoSubject') : t('em.builder.warnNoContent')}
            </Help>
          )}
        </div>
      </section>

      {/* Confirmation */}
      {confirmOpen && (
        <div
          role="dialog" aria-modal="true" aria-label={t('em.builder.confirmTitle')}
          style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)' }}
          onClick={() => setConfirmOpen(false)}
        >
          <div
            className="yn-in" onClick={(e) => e.stopPropagation()}
            style={{ width: 400, background: PANEL_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, fontFamily: FONT_UI }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <MicroLabel>{t('em.builder.confirmTitle')}</MicroLabel>
              <button type="button" onClick={() => setConfirmOpen(false)} aria-label={t('em.common.cancel')}
                style={{ background: 'transparent', border: 'none', color: T1, cursor: 'pointer', display: 'flex' }}>
                <X size={15} strokeWidth={1.75} />
              </button>
            </div>
            <div style={{ fontSize: 12.5, color: T2, lineHeight: 1.7 }}>
              <p style={{ margin: 0 }}><strong style={{ color: T1 }}>{t('em.builder.confirmRecipients')}</strong> {net}</p>
              <p style={{ margin: 0 }}><strong style={{ color: T1 }}>{t('em.builder.confirmSubject')}</strong> {campaign.subject}</p>
              {campaign.abOn && campaign.subjectB && (
                <p style={{ margin: 0 }}><strong style={{ color: T1 }}>{t('studio.review.subjectB')}</strong> {campaign.subjectB}</p>
              )}
              <p style={{ margin: '8px 0 0', color: T3 }}>{t('em.builder.confirmIrreversible')}</p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <GhostBtn onClick={() => setConfirmOpen(false)}>{t('em.common.cancel')}</GhostBtn>
              <PrimaryBtn onClick={sendNow} disabled={sending}>
                {sending && <Loader2 size={13} className="animate-spin" />} {t('em.common.send')}
              </PrimaryBtn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0',
      borderBottom: `1px solid ${BORDER}`, fontFamily: FONT_UI,
    }}>
      <span style={{ fontSize: 12, color: T3, flex: 'none' }}>{k}</span>
      <span style={{
        fontSize: 12, color: highlight ? RED : T1, fontWeight: highlight ? 700 : 600,
        textAlign: 'right', overflowWrap: 'anywhere',
      }}>{v}</span>
    </div>
  );
}
