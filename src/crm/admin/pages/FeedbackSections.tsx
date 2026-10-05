/**
 * Admin CRM › Produit : le NPS (score seulement à partir de 10 réponses, sinon
 * les réponses nom par nom) et les demandes de fonctionnalités, regroupées au
 * texte identique, avec leur statut (nouvelle / vue / planifiée / faite)
 * changé avec un motif (journal d'audit). Lu par crm_admin_feedback.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAdminScope } from '@/components/admin/AdminScope';
import { useCrmT } from '@/crm/i18n';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { rpc } from '@/crm/lib/rpc';
import { Modal, Skel } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { useCrmToast } from '@/crm/ui/toast';
import { ADMIN_ROUTES } from '../adminNav';
import { useAdminGesture } from '../data';
import { EmptyNote, Kpi, RowLine, Section, twoCols, useAgo } from '../ui';

type Status = 'new' | 'seen' | 'planned' | 'done';
interface Feedback {
  at: string;
  nps: { n: number; promoters: number; passives: number; detractors: number; score: number | null; dismissed: number;
    responses: { at: string; score: number; comment: string | null; name: string; person: string | null; id: string }[] };
  requests: { key: string; body: string; accounts: number; n: number; names: string[]; status: Status; reason: string | null; last_at: string }[];
}
const ST: Record<Status, [string, string]> = { new: ['var(--red-50)', 'var(--red-700)'], seen: ['var(--sand-100)', 'var(--sand-700)'], planned: ['var(--amber-50)', 'var(--amber-700)'], done: ['var(--green-50)', 'var(--green-700)'] };

export default function FeedbackSections() {
  const { t, n } = useCrmT();
  const ago = useAgo();
  const toast = useCrmToast();
  const { includeDemo } = useAdminScope();
  const q = useQuery({ queryKey: ['crm-admin', 'feedback', includeDemo], staleTime: 30_000, queryFn: () => rpc<Feedback>('crm_admin_feedback', { p_include_demo: includeDemo }) });
  const save = useAdminGesture<{ p_key: string; p_status: Status; p_reason: string }>('crm_admin_feature_status');
  const [edit, setEdit] = useState<{ key: string; body: string; status: Status } | null>(null);
  const [reason, setReason] = useState('');
  if (q.isError && !q.data) return <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />;
  if (!q.data) return <Skel h={260} r={28} />;
  const { nps, requests } = q.data;
  const tone = (s: number) => (s >= 9 ? 'var(--green-700)' : s >= 7 ? 'var(--amber-700)' : 'var(--red-600)');
  return (
    <>
      <div style={twoCols}>
        <Section title={t('adm.crm.fb.nps')} sub={nps.n >= 10 ? t('adm.crm.fb.npsSub', { n: nps.n }) : t('adm.crm.fb.npsFew', { n: nps.n })} pad={24} gap={12}>
          {nps.n >= 10 && nps.score !== null && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 12 }}>
              <Kpi label="NPS" value={nps.score > 0 ? `+${nps.score}` : String(nps.score)} dot={nps.score >= 30 ? 'var(--green-500)' : 'var(--amber-500)'} />
              <Kpi delay={60} label={t('adm.crm.fb.prom')} value={n(nps.promoters)} />
              <Kpi delay={120} label={t('adm.crm.fb.det')} value={n(nps.detractors)} />
            </div>
          )}
          {nps.responses.length === 0 && <EmptyNote>{t('adm.crm.fb.npsNone')}</EmptyNote>}
          {nps.responses.map((r, i) => (
            <RowLine key={`${r.at}${i}`} first={i === 0}>
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
                <Link to={ADMIN_ROUTES.account(r.id)} style={{ fontWeight: 700, color: 'var(--ink)', textDecoration: 'none' }}>{r.name}{r.person ? <span style={{ fontWeight: 500, color: 'var(--sand-500)' }}> · {r.person}</span> : null}</Link>
                {r.comment && <span style={{ fontSize: 13.5, color: 'var(--sand-600)', lineHeight: 1.45 }}>« {r.comment} »</span>}
                <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{ago(r.at)}</span>
              </span>
              <b style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: tone(r.score), fontVariantNumeric: 'tabular-nums' }}>{r.score}</b>
            </RowLine>
          ))}
          {nps.dismissed > 0 && <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('adm.crm.fb.dismissed', { n: nps.dismissed })}</span>}
        </Section>
        <Section title={t('adm.crm.fb.req')} sub={t('adm.crm.fb.reqSub')} pad={24} gap={4}>
          {requests.length === 0 && <EmptyNote>{t('adm.crm.fb.reqNone')}</EmptyNote>}
          {requests.map((r, i) => (
            <RowLine key={r.key} first={i === 0} onClick={() => { setReason(''); setEdit({ key: r.key, body: r.body, status: r.status }); }}>
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
                <b style={{ lineHeight: 1.35 }}>{r.body}</b>
                <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('adm.crm.fb.accounts', { n: r.accounts })} · {r.names.slice(0, 3).join(', ')}{r.names.length > 3 ? '…' : ''} · {ago(r.last_at)}</span>
              </span>
              <span style={{ height: 26, padding: '0 10px', borderRadius: 99, background: ST[r.status][0], color: ST[r.status][1], fontSize: 12.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>{t(`adm.crm.fb.st.${r.status}`)}</span>
            </RowLine>
          ))}
        </Section>
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} width={500} label={t('adm.crm.fb.change')}>
        {edit && (
          <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em' }}>{edit.body}</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {(['new', 'seen', 'planned', 'done'] as Status[]).map((s) => (
                <Hv key={s} as="button" type="button" onClick={() => setEdit({ ...edit, status: s })} style={{ height: 36, padding: '0 14px', borderRadius: 99, border: edit.status === s ? 0 : '1.5px solid var(--sand-200)', background: edit.status === s ? 'var(--ink)' : '#fff', color: edit.status === s ? '#fff' : 'var(--ink)', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}>{t(`adm.crm.fb.st.${s}`)}</Hv>
              ))}
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, fontWeight: 600 }}>{t('adm.crm.ac.reason')}
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} style={{ borderRadius: 12, border: 0, boxShadow: 'inset 0 0 0 1.5px var(--sand-200)', padding: 12, font: 'inherit', fontSize: 15, outline: 'none', resize: 'vertical' }} />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <Hv as="button" type="button" onClick={() => setEdit(null)} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: 0, background: 'var(--sand-100)', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>{t('yc.common.cancel')}</Hv>
              <Hv as="button" type="button" disabled={reason.trim().length < 3 || save.isPending}
                onClick={() => save.mutate({ p_key: edit.key, p_status: edit.status, p_reason: reason }, { onSuccess: () => { toast(t('adm.crm.fb.saved')); setEdit(null); void q.refetch(); }, onError: () => toast(t('adm.crm.ac.err.x')) })}
                style={{ height: 44, padding: '0 22px', borderRadius: 99, border: 0, background: 'var(--ink)', color: '#fff', fontWeight: 600, fontSize: 15, cursor: reason.trim().length >= 3 ? 'pointer' : 'not-allowed', opacity: reason.trim().length >= 3 ? 1 : 0.5 }}>{t('adm.crm.fb.change')}</Hv>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
