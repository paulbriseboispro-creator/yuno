/**
 * « Recevoir un test » : les adresses de test du compte (Réglages d'envoi,
 * cinq au plus), en ajouter une, puis l'envoi par la fonction d'envoi réelle
 * (`send-campaign`, mode test : le titulaire du compte le reçoit toujours).
 * Un test ne coûte aucun Yunit. Compte de démonstration : rien ne part.
 */
import { useEffect, useState } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Modal } from '@/crm/ui/kit';
import { EASE } from '@/crm/ui/motion';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useCrmT } from '@/crm/i18n';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useEmailSettings, useSaveEmailSettings } from '@/crm/data/emails';
import { useStudio } from '@/components/email-studio/store';
import { useStudioUi } from './studioUi';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function StudioTestModal() {
  const ui = useStudioUi();
  if (!ui.testOpen) return null;
  return <TestBody onClose={() => ui.setTestOpen(false)} />;
}

function TestBody({ onClose }: { onClose: () => void }) {
  const { t, tp } = useCrmT();
  const { user } = useAuth();
  const settings = useEmailSettings();
  const save = useSaveEmailSettings();
  const campaignId = useStudio((s) => s.campaign.id);
  const subject = useStudio((s) => s.campaign.subject);
  const [list, setList] = useState<string[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string[] | null>(null);
  const me = (user?.email ?? '').toLowerCase();

  useEffect(() => {
    const saved = (settings.data?.test_emails ?? []).filter((e) => e.toLowerCase() !== me);
    setList(saved);
    setSel(saved.slice(0, 1));
  }, [settings.data, me]);

  const add = () => {
    const v = draft.trim();
    if (!EMAIL_RE.test(v)) { setMsg(t('yc.em.st.t.bad')); return; }
    if (v.toLowerCase() === me || list.some((x) => x.toLowerCase() === v.toLowerCase())) { setMsg(t('yc.em.st.t.dupe')); return; }
    if (list.length >= 5) { setMsg(t('yc.em.st.t.max')); return; }
    const next = [...list, v];
    setList(next);
    setSel((s) => [...s, v]);
    setDraft('');
    setMsg(null);
    // Gardée pour les prochains tests (Réglages d'envoi).
    save.mutate({ test_emails: next });
  };

  const send = async () => {
    if (sending) return;
    if (!subject.trim()) { setMsg(t('yc.em.st.t.noSubject')); return; }
    setSending(true);
    setMsg(null);
    const { data, error } = await supabase.functions.invoke('send-campaign', { body: { campaign_id: campaignId, send_test: true, test_emails: sel } });
    setSending(false);
    const code = (data as { code?: string } | null)?.code;
    const ctxBody = (error as { context?: { status?: number } } | null)?.context;
    if (code === 'demo_no_send' || ctxBody?.status === 409) { setMsg(t('yc.em.st.t.demo')); return; }
    if (error) { setMsg(t('yc.em.st.t.fail')); return; }
    setDone([user?.email ?? '', ...sel].filter(Boolean));
  };

  const n = sel.length + (me ? 1 : 0);
  return (
    <Modal open onClose={onClose} width={480} label={t('yc.em.st.testTitle')}>
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {done ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center', padding: '10px 0 6px', animation: `yc-pop 240ms ${EASE}` }}>
            <YunitFace mood="ravi" size={64} />
            <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em' }}>{t('yc.em.st.t.done')}</b>
            <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--sand-600)', maxWidth: 320, textWrap: 'pretty' }}>{t('yc.em.st.t.doneSub', { list: done.join(', ') })}</span>
            <Hv as="button" type="button" onClick={onClose} style={{ marginTop: 6, height: 46, padding: '0 24px', border: 0, borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'var(--sand-700)' }}>{t('yc.em.st.t.back')}</Hv>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em' }}>{t('yc.em.st.t.title')}</h2>
                <div style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--sand-500)', marginTop: 4 }}>{t('yc.em.st.t.sub')}</div>
              </div>
              <Hv as="button" type="button" onClick={onClose} aria-label={t('yc.em.tp.m.close')} style={{ flex: 'none', width: 36, height: 36, border: 0, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-200)' }}>
                <Icon name="x" size={16} stroke={2.4} />
              </Hv>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {me && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, background: 'var(--sand-50)' }}>
                  <span style={{ flex: 'none', width: 20, height: 20, borderRadius: 6, background: 'var(--sand-400)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="lock" size={11} stroke={2.6} /></span>
                  <span style={{ fontSize: 14, color: 'var(--sand-600)' }}>{t('yc.em.st.t.always', { email: user?.email ?? '' })}</span>
                </div>
              )}
              {list.map((a) => {
                const on = sel.includes(a);
                return (
                  <button key={a} type="button" onClick={() => setSel((s) => (on ? s.filter((x) => x !== a) : [...s, a]))} aria-pressed={on} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, border: `1.5px solid ${on ? 'var(--red-400)' : 'var(--sand-200)'}`, background: on ? 'var(--red-50)' : '#fff', cursor: 'pointer', textAlign: 'left' }}>
                    <span style={{ flex: 'none', width: 20, height: 20, borderRadius: 6, border: `1.5px solid ${on ? 'var(--red-500)' : 'var(--sand-300)'}`, background: on ? 'var(--red-500)' : '#fff', color: '#fff', display: 'grid', placeItems: 'center' }}>{on && <Icon name="check" size={12} stroke={3.2} />}</span>
                    <span style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--ink)' }}>{a}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="yc-field" value={draft} onChange={(e) => { setDraft(e.target.value); setMsg(null); }} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} placeholder={t('yc.em.st.t.add')} aria-label={t('yc.em.st.t.add')} type="email" style={{ flex: 1, minWidth: 0, height: 44, boxSizing: 'border-box', padding: '0 16px', borderRadius: 99, border: '1px solid var(--sand-200)', fontSize: 14.5, outline: 'none' }} />
              <Hv as="button" type="button" onClick={add} style={{ height: 44, padding: '0 18px', border: 0, borderRadius: 99, background: 'var(--sand-100)', fontSize: 14, fontWeight: 600, cursor: 'pointer', color: 'var(--ink)' }} hover={{ background: 'var(--sand-200)' }}>{t('yc.em.st.t.addBtn')}</Hv>
            </div>
            {msg && <div style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 13.5, lineHeight: 1.45, fontWeight: 500 }}>{msg}</div>}
            <Hv
              as="button"
              type="button"
              onClick={() => void send()}
              disabled={sending || n === 0}
              style={{ height: 50, border: 0, borderRadius: 99, background: n ? 'var(--gradient-brand)' : 'var(--sand-300)', color: '#fff', fontSize: 15.5, fontWeight: 600, cursor: sending ? 'progress' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: n ? 'var(--shadow-cta)' : 'none' }}
              hover={{ filter: 'brightness(1.05)' }}
            >
              {sending && <Icon name="refresh" size={16} stroke={2.6} style={{ animation: 'yc-spin 800ms linear infinite' }} />}
              {sending ? t('yc.em.st.t.sending') : tp('yc.em.st.t.send', n)}
            </Hv>
          </>
        )}
      </div>
    </Modal>
  );
}
