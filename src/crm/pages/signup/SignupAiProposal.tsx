/**
 * Pages d'inscription › ce que l'IA du pro a préparé (MCP, migration
 * 20261009160000) : la pastille « Préparé par Claude » et, sur une page
 * PUBLIÉE, la proposition de l'IA — rien ne change pour les fans tant que le
 * pro ne l'a pas appliquée. L'aperçu montre la page en ligne + la proposition :
 * ce qu'on voit est ce qu'on applique.
 */
import { useState } from 'react';
import { useCrmT } from '@/crm/i18n';
import { Modal, PillButton } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { proposalFields, rpcCode, useSignupMutations, withProposal } from '@/crm/data/signupPages';
import type { SignupPageRow } from '@/crm/data/signupPages';
import { SP_ICON } from '@/crm/signup/model';
import { SignupPreview } from './SignupDonePage';
import { SpSvg } from './signupUi';

/** « Préparé par Claude » : une page dessinée ou modifiée par l'IA du pro. */
export function AiPreparedBadge({ author }: { author: string }) {
  const { t } = useCrmT();
  return (
    <span style={{ height: 28, padding: '0 12px 0 10px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, background: 'var(--sand-100)', color: 'var(--sand-700)' }}>
      <SpSvg d={SP_ICON.bolt} size={13} sw={2.4} />{t('yc.sp.ai.by', { ai: author })}
    </span>
  );
}

export function AiProposalCard({ page, host, logo }: { page: SignupPageRow; host: string; logo?: string | null }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const m = useSignupMutations();
  const [pv, setPv] = useState(false);
  const [ask, setAsk] = useState(false);
  const prop = page.ai_proposal;
  if (!prop) return null;
  const ai = prop.author || page.ai_author || 'IA';
  const list = proposalFields(prop).map((k) => t(`yc.sp.ai.f.${k}`)).join(t('yc.sp.w.listSep'));
  const act = (action: 'apply' | 'discard') => {
    m.proposal.mutate({ id: page.id, action }, {
      onSuccess: () => { setAsk(false); toast(action === 'apply' ? t('yc.sp.ai.applied') : t('yc.sp.ai.discarded')); },
      onError: (e) => { const c = rpcCode(e); toast(['bad_fields', 'bad_event', 'closes_in_past'].includes(c) ? t(`yc.sp.e.${c}`) : t('yc.sp.err')); },
    });
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '14px 20px', padding: '18px 22px', borderRadius: 22, background: '#fff', boxShadow: 'inset 0 0 0 1.5px var(--red-200),var(--shadow-xs)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, minWidth: 0, flex: '1 1 320px' }}>
        <span style={{ flex: 'none', width: 40, height: 40, borderRadius: 12, background: 'var(--red-50)', color: 'var(--red-600)', display: 'grid', placeItems: 'center' }}><SpSvg d={SP_ICON.pen} size={18} sw={2.2} /></span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <b style={{ fontSize: 15.5 }}>{t('yc.sp.ai.propT', { ai })}</b>
          <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>{list ? t('yc.sp.ai.propWhat', { list }) : ''}{list ? ' · ' : ''}{t('yc.sp.ai.propS')}</span>
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <PillButton tone="light" size="sm" icon="eye" onClick={() => setPv(true)}>{t('yc.sp.ai.preview')}</PillButton>
        <PillButton tone="ghost" size="sm" onClick={() => act('discard')} disabled={m.proposal.isPending}>{t('yc.sp.ai.discard')}</PillButton>
        <PillButton tone="dark" size="sm" onClick={() => setAsk(true)} disabled={m.proposal.isPending}>{t('yc.sp.ai.apply')}</PillButton>
      </div>
      {pv && <SignupPreview page={withProposal(page)} host={host} logo={logo} title={t('yc.sp.ai.pvTitle', { ai })} onClose={() => setPv(false)} />}
      <Modal open={ask} onClose={() => setAsk(false)} label={t('yc.sp.ai.applyT')} width={440}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 24 }}>
          <b style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 21, fontWeight: 600, letterSpacing: '-.02em' }}>{t('yc.sp.ai.applyT')}</b>
          <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-600)' }}>{t('yc.sp.ai.applyS')}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
            <PillButton tone="ghost" onClick={() => setAsk(false)}>{t('yc.sp.ai.cancel')}</PillButton>
            <PillButton tone="dark" onClick={() => act('apply')} disabled={m.proposal.isPending}>{t('yc.sp.ai.apply')}</PillButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}
