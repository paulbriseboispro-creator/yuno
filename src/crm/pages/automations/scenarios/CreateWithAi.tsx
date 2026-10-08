/**
 * « Créer avec l'IA » (agents, lot A2 ; décision 8 de Paul) : le pro dit en une
 * phrase ce que le scénario doit faire, et son IA (branchée sur Yuno par le
 * MCP) dépose le BROUILLON, expliqué étape par étape. Dans l'éditeur, le même
 * geste demande un changement du brouillon ouvert. Yuno n'appelle aucune IA :
 * la demande part dans l'IA du pro (AskMyAiButton).
 */
import { useState } from 'react';
import { Modal, PillButton } from '@/crm/ui/kit';
import { useCrmT } from '@/crm/i18n';
import { AskMyAiButton } from '@/crm/components/AskMyAi';

const EXAMPLES = ['yc.ag.build.ex.1', 'yc.ag.build.ex.2', 'yc.ag.build.ex.3', 'yc.ag.build.ex.4'];
const MIN = 12;
const MAX = 400;

function DescribeModal({ open, onClose, title, sub, placeholder, prompt, examples }: {
  open: boolean; onClose: () => void; title: string; sub: string; placeholder: string;
  prompt: (idea: string) => string; examples: boolean;
}) {
  const { t } = useCrmT();
  const [idea, setIdea] = useState('');
  const ready = idea.trim().length >= MIN;
  return (
    <Modal open={open} onClose={onClose} width={560} label={title}>
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em', lineHeight: 1.15 }}>{title}</h2>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: 'var(--sand-700)', textWrap: 'pretty' }}>{sub}</p>
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value.slice(0, MAX))}
          rows={3}
          placeholder={placeholder}
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: 12, borderRadius: 14, border: '1px solid var(--sand-200)', fontSize: 15, lineHeight: 1.5, fontFamily: 'inherit', color: 'var(--ink)', background: '#fff' }}
        />
        {examples && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {EXAMPLES.map((k) => (
              <button key={k} type="button" onClick={() => setIdea(t(k))}
                style={{ border: '1px solid var(--sand-200)', background: 'var(--sand-50)', borderRadius: 99, padding: '6px 12px', fontSize: 13, color: 'var(--sand-700)', cursor: 'pointer', textAlign: 'left' }}>
                {t(k)}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
          {!ready && idea.trim().length > 0 && <span style={{ fontSize: 13, color: 'var(--sand-500)', marginRight: 'auto' }}>{t('yc.ag.build.short')}</span>}
          <PillButton tone="ghost" onClick={onClose}>{t('yc.ag.ai.close')}</PillButton>
          {ready
            ? <AskMyAiButton text={prompt(idea.trim())} need="scenarios" tone="dark" />
            : <PillButton tone="dark" icon="sparkles" disabled>{t('yc.ag.ai.button')}</PillButton>}
        </div>
      </div>
    </Modal>
  );
}

/** Onglet Scénarios : une phrase devient un brouillon. */
export function CreateWithAiButton() {
  const { t } = useCrmT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PillButton tone="light" icon="sparkles" onClick={() => setOpen(true)}>{t('yc.ag.build.open')}</PillButton>
      {open && (
        <DescribeModal open onClose={() => setOpen(false)} title={t('yc.ag.build.open')} sub={t('yc.ag.build.sub')} placeholder={t('yc.ag.build.ph')}
          examples prompt={(idea) => t('yc.ag.ai.q.build', { idea })} />
      )}
    </>
  );
}

/** Éditeur : demander un changement du brouillon ouvert. */
export function EditWithAiButton({ name }: { name: string }) {
  const { t } = useCrmT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PillButton tone="light" size="sm" icon="sparkles" onClick={() => setOpen(true)}>{t('yc.ag.ai.button')}</PillButton>
      {open && (
        <DescribeModal open onClose={() => setOpen(false)} title={t('yc.ag.edit.title')} sub={t('yc.ag.edit.sub')} placeholder={t('yc.ag.edit.ph')}
          examples={false} prompt={(idea) => t('yc.ag.ai.q.edit', { name, idea })} />
      )}
    </>
  );
}
