/**
 * Admin CRM › tiroir d'un compte › SMS (bêta privée, 20261029100000). Le pro
 * demande l'accès depuis sa Console (usages, volume, nom d'expéditeur
 * souhaité) ; le super admin l'ouvre ou la refuse ici, avec un motif écrit au
 * journal. Avant d'ouvrir : l'état d'Octopush (secrets posés ou non), lu par
 * send-sms-campaign `provider_status`. Sans Octopush, un compte ouvert verrait
 * ses envois répondre « service d'envoi en cours d'activation ».
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmT } from '@/crm/i18n';
import { rpc } from '@/crm/lib/rpc';
import { Modal, Skel } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { useCrmToast } from '@/crm/ui/toast';

interface AdminSmsAccess {
  status: 'none' | 'requested' | 'granted' | 'declined';
  use_cases?: string[]; volume?: string | null; sender_wish?: string | null; note?: string | null;
  requested_at?: string | null; requested_by?: string | null; requested_email?: string | null;
  decided_at?: string | null; decision_reason?: string | null;
}

const box = { display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 18, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' } as const;
const TONE: Record<AdminSmsAccess['status'], [string, string]> = {
  none: ['var(--sand-100)', 'var(--sand-600)'],
  requested: ['var(--amber-50)', 'var(--amber-700)'],
  granted: ['var(--green-50)', 'var(--green-700)'],
  declined: ['var(--red-50)', 'var(--red-700)'],
};

function useProviderStatus() {
  return useQuery({
    queryKey: ['crm-admin', 'sms-provider'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('send-sms-campaign', { body: { mode: 'provider_status' } });
      if (error) throw error;
      return data as { configured: boolean; simulation: boolean };
    },
  });
}

export function SmsAccessCard({ scopeKey, name }: { scopeKey: string; name: string }) {
  const { t, dShort } = useCrmT();
  const toast = useCrmToast();
  const qc = useQueryClient();
  const key = ['crm-admin', 'sms-access', scopeKey];
  const q = useQuery({ queryKey: key, staleTime: 15_000, queryFn: () => rpc<AdminSmsAccess>('crm_admin_sms_access', { p_scope_key: scopeKey }) });
  const provider = useProviderStatus();
  const [decide, setDecide] = useState<null | 'granted' | 'declined'>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const set = useMutation({
    mutationFn: (p: { status: 'granted' | 'declined'; reason: string }) => rpc('crm_admin_sms_access_set', { p_scope_key: scopeKey, p_status: p.status, p_reason: p.reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const a = q.data;
  const st = a?.status ?? 'none';
  const ok = reason.trim().length >= 3 && !set.isPending;
  const open = (d: 'granted' | 'declined') => { setReason(''); setErr(null); setDecide(d); };
  const submit = () => {
    if (!decide || !ok) return;
    set.mutate({ status: decide, reason: reason.trim() }, {
      onSuccess: () => { toast(t(decide === 'granted' ? 'adm.crm.sms.doneGrant' : 'adm.crm.sms.doneDecline', { name })); setDecide(null); },
      onError: () => setErr(t('adm.crm.ac.err.x')),
    });
  };
  const btn = { height: 36, padding: '0 14px', borderRadius: 99, border: 0, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' } as const;

  return (
    <div style={box}>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t('adm.crm.sms.title')}</span>
        {a && <span style={{ height: 24, padding: '0 10px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, background: TONE[st][0], color: TONE[st][1] }}>{t(`adm.crm.sms.st.${st}`)}</span>}
      </span>
      {!a && !q.isError && <Skel h={60} r={12} />}
      {q.isError && <span style={{ fontSize: 13, color: 'var(--red-600)' }}>{t('adm.crm.ac.err.x')}</span>}
      {a && (
        <>
          {st === 'none' && <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--sand-500)' }}>{t('adm.crm.sms.none')}</span>}
          {a.requested_at && (
            <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: '6px 14px', fontSize: 13 }}>
              <span style={{ color: 'var(--sand-500)' }}>{t('adm.crm.sms.f.when')}</span>
              <span>{dShort(a.requested_at)}{a.requested_by || a.requested_email ? ` · ${[a.requested_by, a.requested_email].filter(Boolean).join(' · ')}` : ''}</span>
              <span style={{ color: 'var(--sand-500)' }}>{t('adm.crm.sms.f.uses')}</span>
              <span>{(a.use_cases ?? []).map((u) => t(`adm.crm.sms.use.${u}`)).join(' · ') || '—'}</span>
              <span style={{ color: 'var(--sand-500)' }}>{t('adm.crm.sms.f.volume')}</span>
              <span>{a.volume ? t(`adm.crm.sms.vol.${a.volume}`) : '—'}</span>
              <span style={{ color: 'var(--sand-500)' }}>{t('adm.crm.sms.f.sender')}</span>
              <b style={{ fontWeight: 600, letterSpacing: '.02em' }}>{a.sender_wish || '—'}</b>
              {a.note && <><span style={{ color: 'var(--sand-500)' }}>{t('adm.crm.sms.f.note')}</span><span style={{ whiteSpace: 'pre-wrap' }}>{a.note}</span></>}
            </div>
          )}
          {a.decided_at && (
            <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t(st === 'granted' ? 'adm.crm.sms.grantedOn' : 'adm.crm.sms.declinedOn', { date: dShort(a.decided_at) })}{a.decision_reason ? ` · ${a.decision_reason}` : ''}</span>
          )}
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: provider.data?.configured ? 'var(--green-700)' : 'var(--amber-700)' }}>
            <i style={{ width: 7, height: 7, borderRadius: 99, background: 'currentColor', flex: 'none' }} />
            {provider.isLoading ? '…' : provider.isError ? t('adm.crm.sms.provUnknown') : provider.data?.configured ? t(provider.data.simulation ? 'adm.crm.sms.provSim' : 'adm.crm.sms.provOk') : t('adm.crm.sms.provOff')}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {st !== 'granted' && <Hv as="button" type="button" onClick={() => open('granted')} style={{ ...btn, background: 'var(--ink)', color: '#fff' }} hover={{ background: 'var(--sand-700)' }}>{t('adm.crm.sms.grant')}</Hv>}
            {st === 'requested' && <Hv as="button" type="button" onClick={() => open('declined')} style={{ ...btn, background: 'var(--sand-100)', color: 'var(--ink)' }} hover={{ background: 'var(--sand-200)' }}>{t('adm.crm.sms.decline')}</Hv>}
            {st === 'granted' && <Hv as="button" type="button" onClick={() => open('declined')} style={{ ...btn, background: 'var(--sand-100)', color: 'var(--red-700)' }} hover={{ background: 'var(--sand-200)' }}>{t('adm.crm.sms.close')}</Hv>}
          </div>
        </>
      )}
      {decide && (
        <Modal open onClose={() => setDecide(null)} width={480} label={t(decide === 'granted' ? 'adm.crm.sms.grant' : st === 'granted' ? 'adm.crm.sms.close' : 'adm.crm.sms.decline')}>
          <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em' }}>{t(decide === 'granted' ? 'adm.crm.sms.grant' : st === 'granted' ? 'adm.crm.sms.close' : 'adm.crm.sms.decline')} · {name}</h2>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--sand-600)' }}>{t(decide === 'granted' ? 'adm.crm.sms.grantBody' : 'adm.crm.sms.declineBody')}</p>
            {decide === 'granted' && !provider.data?.configured && <p style={{ margin: 0, padding: '10px 12px', borderRadius: 12, background: 'var(--amber-50)', fontSize: 13.5, lineHeight: 1.45, color: 'var(--amber-700)' }}>{t('adm.crm.sms.provWarn')}</p>}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, fontWeight: 600 }}>
              {t('adm.crm.ac.reason')}
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} style={{ borderRadius: 12, border: 0, boxShadow: 'inset 0 0 0 1.5px var(--sand-200)', padding: 12, font: 'inherit', fontSize: 15, outline: 'none', resize: 'vertical' }} />
            </label>
            {err && <span role="alert" style={{ fontSize: 13.5, color: 'var(--red-600)' }}>{err}</span>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <Hv as="button" type="button" onClick={() => setDecide(null)} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: 0, background: 'var(--sand-100)', fontWeight: 600, fontSize: 15, cursor: 'pointer' }} hover={{ background: 'var(--sand-200)' }}>{t('yc.common.cancel')}</Hv>
              <Hv as="button" type="button" onClick={submit} disabled={!ok} style={{ height: 44, padding: '0 22px', borderRadius: 99, border: 0, background: decide === 'granted' ? 'var(--ink)' : 'var(--red-600)', color: '#fff', fontWeight: 600, fontSize: 15, cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.45 }}>{t('adm.crm.ac.confirm')}</Hv>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
