import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Pencil, Send, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  checklistBlocksSend, renderEmailHtml, runChecklist, slugifyName, type LiveData,
} from '@/lib/email';
import { useStudio } from './store';
import { useAudienceCount, type StudioEvent, type StudioScope } from './hooks';
import {
  BORDER, FlowCard, FONT_UI, GhostBtn, Help, MicroLabel, PANEL_BG, POS, PrimaryBtn,
  RED, T1, T2, T3, WARN,
} from './ui';

/** Écran Récap : résumé + contrôles + aperçu final + envoi (prototype). */
export default function ReviewStep({ scope, events, live, onSave, onSent, onEditContent, onTest }: {
  scope: StudioScope;
  events: StudioEvent[];
  live: LiveData;
  onSave: (status?: string) => Promise<string | null>;
  onSent: () => void;
  onEditContent: () => void;
  /** Ouvre le dialogue d'email de test (le dernier contrôle avant le vrai départ). */
  onTest: () => void;
}) {
  const { t } = useLanguage();
  const campaign = useStudio((s) => s.campaign);
  const saveSeq = useStudio((s) => s.saveSeq);
  const { count } = useAudienceCount(campaign.id, saveSeq, campaign.audiences.length > 0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setReplyTo(data.user?.email || null));
  }, []);

  const previewHtml = useMemo(() => renderEmailHtml(campaign.blocks, campaign.theme, {
    venueName: scope.name,
    city: scope.city,
    logoUrl: scope.logoUrl,
    emailType: campaign.type,
    subject: campaign.subject,
    preheader: campaign.preheader,
    recipient: { email: 'aperçu@exemple.com', firstName: 'Camille' },
    unsubscribeUrl: '#',
    socialLinks: campaign.socialLinks,
    baseUrl: 'https://yunoapp.eu',
    live,
    ignoreConds: true,
  }), [campaign, scope, live]);

  const checklist = useMemo(() => runChecklist({
    subject: campaign.subject,
    preheader: campaign.preheader,
    type: campaign.type,
    blocks: campaign.blocks,
    renderedBytes: previewHtml.length,
  }), [campaign.subject, campaign.preheader, campaign.type, campaign.blocks, previewHtml.length]);

  const blocked = checklistBlocksSend(checklist);
  const warnCount = checklist.filter((c) => c.status === 'warn').length;
  const net = count?.net ?? 0;
  const canSend = !blocked && net > 0 && campaign.subject.trim().length > 0 && campaign.blocks.length > 0;
  const fromAddr = `${slugifyName(scope.name)}@yunoapp.eu`;
  const eventTitle = events.find((e) => e.id === campaign.eventId)?.title;

  const schedSummary = campaign.scheduledAt
    ? new Date(campaign.scheduledAt).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })
    : t('studio.sched.nowHelp');

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
    <div className="yn-in" style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 18, alignItems: 'start', maxWidth: 1060, margin: '0 auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* ── Récapitulatif ── */}
        <FlowCard style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h3 style={{ margin: 0, color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', fontFamily: FONT_UI }}>
            {t('studio.review.summary')}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '11px 14px', alignItems: 'start' }}>
            <RowLabel>{t('studio.review.sender')}</RowLabel>
            <RowValue>{scope.name} &lt;{fromAddr}&gt;</RowValue>
            <RowLabel>{t('studio.review.replyTo')}</RowLabel>
            <RowValue>{replyTo || '—'}</RowValue>
            <RowLabel>{t('em.builder.kSubject')}</RowLabel>
            <RowValue>
              {campaign.subject || '—'}
              {campaign.abOn && campaign.subjectB ? ` · B : ${campaign.subjectB}` : ''}
            </RowValue>
            <RowLabel>{t('studio.data.preheader')}</RowLabel>
            <RowValue muted>{campaign.preheader || '—'}</RowValue>
            <RowLabel>{t('studio.review.recipients')}</RowLabel>
            <RowValue>{net.toLocaleString('fr-FR')} {t('studio.review.contacts')}{eventTitle ? ` · ${eventTitle}` : ''}</RowValue>
            <RowLabel>{t('studio.review.departure')}</RowLabel>
            <RowValue>
              {schedSummary}
              {campaign.throttlePerHour != null ? ` · ${t('studio.sched.throttle')}` : ''}
              {campaign.quietHours ? ` · ${t('studio.sched.quiet')}` : ''}
            </RowValue>
          </div>
          <GhostBtn onClick={onEditContent} style={{ alignSelf: 'flex-start' }}>
            <Pencil size={13} strokeWidth={1.75} /> {t('studio.review.editContent')}
          </GhostBtn>
          {campaign.type === 'promotional' && (
            <Help style={{
              background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.22)',
              borderRadius: 8, padding: '8px 10px', color: T2,
            }}>{t('em.builder.gdprSend')}</Help>
          )}
        </FlowCard>

        {/* ── Contrôles ── */}
        <FlowCard>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            {warnCount ? (
              <AlertTriangle size={16} strokeWidth={1.75} style={{ color: blocked ? RED : WARN }} />
            ) : (
              <ShieldCheck size={16} strokeWidth={1.75} style={{ color: POS }} />
            )}
            <h3 style={{ margin: 0, flex: 1, color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', fontFamily: FONT_UI }}>
              {t('studio.review.checklist')}
            </h3>
            <span style={{ color: warnCount ? (blocked ? RED : WARN) : POS, fontSize: 12, fontWeight: 600, fontFamily: FONT_UI }}>
              {warnCount
                ? t('studio.status.checksWarn').replace('{n}', String(warnCount))
                : t('studio.status.checksOk')}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {checklist.map((item) => {
              const color = item.status === 'ok' ? POS : item.status === 'warn' ? (item.critical ? RED : WARN) : T3;
              const Icon = item.status === 'ok' ? Check : AlertTriangle;
              let label = t(item.labelKey);
              if (item.detail) label += ` (${item.detail})`;
              return (
                <div key={item.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <Icon size={14} strokeWidth={1.75} style={{ color, flex: 'none', marginTop: 1 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: T1, fontSize: 12.5, fontWeight: 500, fontFamily: FONT_UI }}>{label}</div>
                    <div style={{ color: T3, fontSize: 11, marginTop: 1, fontFamily: FONT_UI }}>
                      {t(`studio.check.${item.id}.detail`)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </FlowCard>

        {/* ── Envoi ── */}
        <FlowCard style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <GhostBtn onClick={onTest} style={{ justifyContent: 'center', padding: '9px 16px' }}>
            {t('studio.review.sendTest')}
          </GhostBtn>
          {campaign.scheduledAt ? (
            <PrimaryBtn onClick={schedule} disabled={!canSend} style={{ justifyContent: 'center', padding: '11px 18px', fontSize: 13 }}>
              <Send size={14} strokeWidth={1.75} /> {t('em.builder.scheduleSend')}
            </PrimaryBtn>
          ) : (
            <PrimaryBtn onClick={() => setConfirmOpen(true)} disabled={!canSend} style={{ justifyContent: 'center', padding: '11px 18px', fontSize: 13 }}>
              <Send size={14} strokeWidth={1.75} /> {t('studio.review.sendTo').replace('{n}', net.toLocaleString('fr-FR'))}
            </PrimaryBtn>
          )}
          {!canSend && (
            <Help style={{ color: RED, textAlign: 'center' }}>
              {blocked ? t('studio.review.blockedCritical')
                : net === 0 ? t('em.builder.warnNoRecipients')
                  : !campaign.subject.trim() ? t('em.builder.warnNoSubject') : t('em.builder.warnNoContent')}
            </Help>
          )}
        </FlowCard>
      </div>

      {/* ── Aperçu final ── */}
      <FlowCard style={{ padding: 18, position: 'sticky', top: 0 }}>
        <MicroLabel style={{ fontSize: 11, marginBottom: 12 }}>{t('studio.review.finalPreview')}</MicroLabel>
        <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
          <iframe
            title={t('studio.review.finalPreview')}
            srcDoc={previewHtml}
            style={{ width: '100%', height: 520, border: 'none', display: 'block', background: campaign.theme.bg }}
          />
        </div>
      </FlowCard>

      {/* ── Confirmation ── */}
      {confirmOpen && (
        <div
          role="dialog" aria-modal="true" aria-label={t('em.builder.confirmTitle')}
          style={{
            position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)',
          }}
          onClick={() => setConfirmOpen(false)}
        >
          <div
            className="yn-in" onClick={(e) => e.stopPropagation()}
            style={{
              width: 420, background: PANEL_BG, border: `1px solid ${BORDER}`, borderRadius: 18,
              padding: 22, display: 'flex', flexDirection: 'column', gap: 12, fontFamily: FONT_UI,
              boxShadow: '0 40px 80px -40px #000',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('em.builder.confirmTitle')}</div>
              <button type="button" onClick={() => setConfirmOpen(false)} aria-label={t('em.common.cancel')}
                style={{ background: 'transparent', border: 'none', color: T3, cursor: 'pointer', display: 'flex' }}>
                <X size={15} strokeWidth={1.75} />
              </button>
            </div>
            <div style={{ fontSize: 12.5, color: T2, lineHeight: 1.7 }}>
              <p style={{ margin: 0 }}><strong style={{ color: T1 }}>{t('em.builder.confirmRecipients')}</strong> {net.toLocaleString('fr-FR')}</p>
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

function RowLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ color: T3, fontSize: 12, fontFamily: FONT_UI }}>{children}</span>;
}

function RowValue({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return <span style={{ color: muted ? T2 : T1, fontSize: 12.5, fontFamily: FONT_UI, overflowWrap: 'anywhere' }}>{children}</span>;
}
