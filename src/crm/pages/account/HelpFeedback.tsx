/**
 * Compte › Aide : la question NPS (« recommanderiez-vous Yuno CRM ? »), posée
 * au plus une fois tous les 90 jours après 30 jours d'ancienneté du compte —
 * la base décide (crm_nps_should_ask) —, et « Une fonction vous manque ? ».
 * Les deux sont lus par le super admin (Admin CRM › Produit). « Plus tard »
 * compte comme une réponse : la question ne revient pas avant 90 jours.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hv } from '@/crm/ui/Hv';
import { EASE } from '@/crm/ui/motion';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { rpc } from '@/crm/lib/rpc';
import { Card, CardHead } from './accountUi';

export function NpsCard() {
  const { t } = useCrmT();
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  const toast = useCrmToast();
  const ask = useQuery({ queryKey: ['crm', qk, 'nps-ask'], staleTime: 5 * 60_000, queryFn: () => rpc<boolean>('crm_nps_should_ask', args) });
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState(false);
  const send = useMutation({
    mutationFn: (s: number | null) => rpc('crm_nps_submit', { ...args, p_score: s, p_comment: s === null ? null : comment }),
    onSuccess: (_d, s) => { if (s === null) void qc.invalidateQueries({ queryKey: ['crm', qk, 'nps-ask'] }); else setDone(true); },
    onError: () => toast(t('yc.nps.err')),
  });
  if (!ask.data && !done) return null;
  if (done) {
    return (
      <Card gap={6} style={{ animation: `yc-pop 520ms ${EASE} both` }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em' }}>{t('yc.nps.thanks')}</span>
        <span style={{ fontSize: 14.5, color: 'var(--sand-600)' }}>{t('yc.nps.thanksS')}</span>
      </Card>
    );
  }
  return (
    <Card gap={16} style={{ animation: `yc-rise 700ms ${EASE} 80ms both` }}>
      <CardHead title={t('yc.nps.q')} sub={t('yc.nps.s')} right={
        <Hv as="button" type="button" onClick={() => send.mutate(null)} disabled={send.isPending} style={{ height: 36, padding: '0 14px', borderRadius: 99, border: 0, background: 'var(--sand-100)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'var(--sand-200)' }}>{t('yc.nps.later')}</Hv>
      } />
      <div role="radiogroup" aria-label={t('yc.nps.q')} style={{ display: 'grid', gridTemplateColumns: 'repeat(11, minmax(0,1fr))', gap: 6 }}>
        {Array.from({ length: 11 }, (_, i) => {
          const on = score === i;
          return (
            <Hv key={i} as="button" type="button" role="radio" aria-checked={on} onClick={() => setScore(i)}
              style={{ height: 44, borderRadius: 12, border: on ? 0 : '1.5px solid var(--sand-200)', background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)', fontWeight: 600, fontSize: 15, cursor: 'pointer', fontVariantNumeric: 'tabular-nums' }}
              hover={on ? undefined : { background: 'var(--sand-50)' }}>{i}</Hv>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--sand-500)' }}><span>{t('yc.nps.low')}</span><span>{t('yc.nps.high')}</span></div>
      {score !== null && (
        <>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={1000} placeholder={t(score >= 9 ? 'yc.nps.phHigh' : 'yc.nps.phLow')} aria-label={t('yc.nps.comment')} className="yc-field"
            style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 14, border: '1px solid var(--sand-200)', font: 'inherit', fontSize: 15, resize: 'vertical' }} />
          <div>
            <Hv as="button" type="button" onClick={() => send.mutate(score)} disabled={send.isPending}
              style={{ height: 46, padding: '0 22px', border: 0, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>{t('yc.nps.send')}</Hv>
          </div>
        </>
      )}
    </Card>
  );
}

export function FeatureRequestCard() {
  const { t } = useCrmT();
  const { rpc: args } = useCrmScope();
  const toast = useCrmToast();
  const [body, setBody] = useState('');
  const [sent, setSent] = useState(false);
  const send = useMutation({
    mutationFn: () => rpc('crm_feature_request_submit', { ...args, p_body: body }),
    onSuccess: () => { setSent(true); setBody(''); },
    onError: (e) => toast(t((e as { message?: string }).message === 'rate_limited' ? 'yc.fr.rate' : 'yc.nps.err')),
  });
  const ok = body.trim().length >= 3;
  return (
    <Card gap={14}>
      <CardHead title={t('yc.fr.t')} sub={t('yc.fr.s')} />
      {sent ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 15, color: 'var(--green-700)', fontWeight: 600 }}>{t('yc.fr.sent')}</span>
          <Hv as="button" type="button" onClick={() => setSent(false)} style={{ height: 38, padding: '0 16px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>{t('yc.fr.again')}</Hv>
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <input value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} placeholder={t('yc.fr.ph')} aria-label={t('yc.fr.t')} className="yc-field"
            onKeyDown={(e) => { if (e.key === 'Enter' && ok && !send.isPending) send.mutate(); }}
            style={{ flex: '1 1 280px', minWidth: 0, height: 48, boxSizing: 'border-box', padding: '0 14px', borderRadius: 12, border: '1px solid var(--sand-200)', font: 'inherit', fontSize: 15 }} />
          <Hv as="button" type="button" disabled={!ok || send.isPending} onClick={() => send.mutate()}
            style={{ height: 48, padding: '0 20px', border: 0, borderRadius: 99, background: ok ? 'var(--ink)' : 'var(--sand-100)', color: ok ? '#fff' : 'var(--sand-500)', fontWeight: 600, fontSize: 15, cursor: ok ? 'pointer' : 'not-allowed' }}>{t('yc.fr.send')}</Hv>
        </div>
      )}
    </Card>
  );
}
