/**
 * Admin CRM › Réglages › Analyse client : l'apprentissage commun (drapeau
 * global, ÉTEINT tant que la clause n'est pas validée par un juriste), les
 * leçons publiées et les versions de règles. Une proposition de seuils ne
 * s'applique JAMAIS seule : Paul la valide, motif obligatoire, geste audité.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCrmT } from '@/crm/i18n';
import { rpc } from '@/crm/lib/rpc';
import { Skel } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { useCrmToast } from '@/crm/ui/toast';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { useAdminGesture } from '../data';
import { EmptyNote, RowLine, Section } from '../ui';

interface LearningOverview {
  settings: { enabled: boolean; updated_at: string; reason: string | null } | null;
  contributors: number;
  priors: { rules_version: number; family: string; variant: string; accounts: number; n: number; gain: number | null; z: number | null; status: string; published_at: string }[];
  rules: { version: number; active: boolean; origin: 'seed' | 'proposal'; config: Record<string, unknown>;
           evidence: Record<string, { current: number; proposed: number; votes: number; accounts: number; held_out_z: number | null }> | null;
           approved_at: string | null; approved_reason: string | null; created_at: string }[];
}

const inputCss = { flex: '1 1 220px', height: 40, borderRadius: 10, border: 0, boxShadow: 'inset 0 0 0 1.5px var(--sand-200)', padding: '0 12px', font: 'inherit', fontSize: 14, outline: 'none' } as const;

export function LearningTab() {
  const { t, n, dShort } = useCrmT();
  const toast = useCrmToast();
  const q = useQuery({ queryKey: ['crm-admin', 'learning'], staleTime: 30_000, queryFn: () => rpc<LearningOverview>('crm_admin_learning_overview') });
  const setGlobal = useAdminGesture<{ p_enabled: boolean; p_reason: string }>('crm_admin_learning_set');
  const approve = useAdminGesture<{ p_version: number; p_reason: string }>('crm_admin_rules_approve');
  const [ask, setAsk] = useState<{ kind: 'global'; on: boolean } | { kind: 'rules'; v: number } | null>(null);
  const [reason, setReason] = useState('');
  if (q.isError && !q.data) return <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />;
  if (!q.data) return <Skel h={360} r={28} />;
  const d = q.data;
  const on = !!d.settings?.enabled;
  const done = { onSuccess: () => { toast(t('adm.crm.an.saved')); setAsk(null); setReason(''); }, onError: (e: unknown) => toast(t('adm.crm.an.err', { e: (e as Error).message })) };
  const confirm = () => {
    if (!ask) return;
    if (ask.kind === 'global') setGlobal.mutate({ p_enabled: ask.on, p_reason: reason }, done);
    else approve.mutate({ p_version: ask.v, p_reason: reason }, done);
  };
  const reasonBox = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('adm.crm.an.reason')} aria-label={t('adm.crm.an.reason')} style={inputCss} />
      <Hv as="button" type="button" disabled={reason.trim().length < 5} onClick={confirm} style={{ height: 40, padding: '0 18px', borderRadius: 99, border: 0, background: reason.trim().length >= 5 ? 'var(--ink)' : 'var(--sand-100)', color: reason.trim().length >= 5 ? '#fff' : 'var(--sand-400)', fontWeight: 600, cursor: 'pointer' }}>{t('adm.crm.an.confirm')}</Hv>
      <Hv as="button" type="button" onClick={() => { setAsk(null); setReason(''); }} style={{ height: 40, padding: '0 14px', borderRadius: 99, border: 0, background: 'var(--sand-100)', fontWeight: 600, cursor: 'pointer' }}>{t('adm.crm.an.cancel')}</Hv>
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Section title={t('adm.crm.an.learnT')} sub={t('adm.crm.an.learnS')} pad={24} gap={12}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 12, fontSize: 14.5, fontWeight: 500 }}>
          <button type="button" role="switch" aria-checked={on} onClick={() => setAsk({ kind: 'global', on: !on })} style={{ position: 'relative', width: 48, height: 28, padding: 0, border: 0, borderRadius: 99, background: on ? 'var(--green-500)' : 'var(--sand-300)', cursor: 'pointer' }}>
            <span style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 22, height: 22, borderRadius: 99, background: '#fff', transition: 'left 200ms' }} />
          </button>
          {t('adm.crm.an.global')}
        </label>
        {ask?.kind === 'global' && reasonBox}
        <span style={{ fontSize: 13, color: 'var(--sand-600)' }}>{t('adm.crm.an.contributors', { n: n(d.contributors) })}</span>
      </Section>

      <Section title={t('adm.crm.an.priors')} pad={24} gap={4}>
        {d.priors.length === 0 ? <EmptyNote>{t('adm.crm.an.noPriors')}</EmptyNote> : d.priors.map((p, i) => (
          <RowLine key={`${p.family}-${p.variant}-${p.rules_version}`} first={i === 0}>
            <span>{t('adm.crm.an.prior', { family: t(`yc.why.fam.${p.family}`), variant: p.variant, k: p.accounts, g: p.gain ?? '—' })}</span>
            <span style={{ fontSize: 13, color: 'var(--sand-600)' }}>{t(`yc.why.st.${p.status === 'inconclusive' ? 'untested' : p.status}`)}</span>
          </RowLine>
        ))}
      </Section>

      <Section title={t('adm.crm.an.rules')} sub={t('adm.crm.an.rulesS')} pad={24} gap={4}>
        {d.rules.map((r, i) => (
          <div key={r.version} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0', borderTop: i ? '1px solid var(--sand-100)' : 0 }}>
            <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 14.5, fontWeight: 600 }}>
              {t('adm.crm.an.ver', { v: r.version })}
              <span style={{ fontSize: 12.5, fontWeight: 500, color: r.active ? 'var(--green-700)' : 'var(--sand-500)' }}>
                {r.active ? t('adm.crm.an.active') : r.origin === 'proposal' ? t('adm.crm.an.proposal') : ''}
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 400, color: 'var(--sand-500)' }}>{dShort(r.approved_at ?? r.created_at)}{r.approved_reason ? ` · ${r.approved_reason}` : ''}</span>
            </span>
            {r.evidence && Object.entries(r.evidence).filter(([k]) => k !== 'from_version').map(([k, e]) => (
              <span key={k} style={{ fontSize: 13, color: 'var(--sand-700)' }}>
                {t('adm.crm.an.change', { param: k, a: e.current, b: e.proposed, votes: e.votes, k: e.accounts, z: e.held_out_z ?? '—' })}
              </span>
            ))}
            {!r.active && r.origin === 'proposal' && !r.approved_at && (ask?.kind === 'rules' && ask.v === r.version ? reasonBox : (
              <Hv as="button" type="button" onClick={() => setAsk({ kind: 'rules', v: r.version })} style={{ alignSelf: 'flex-start', height: 36, padding: '0 14px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }} hover={{ borderColor: 'var(--sand-300)' }}>
                {t('adm.crm.an.approve')}
              </Hv>
            ))}
          </div>
        ))}
      </Section>
    </div>
  );
}
