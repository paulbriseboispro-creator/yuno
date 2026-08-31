import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import AIContentGenerator from '@/components/campaigns/AIContentGenerator';
import { EMAIL_VARIABLES, SUBJECT_MAX } from '@/lib/email';
import { useStudio } from './store';
import type { StudioScope } from './hooks';
import {
  Field, FONT_UI, Help, MicroLabel, RED, SliderRow, SUBTLE, BORDER, T1, T2, TextInput, Toggle,
} from './ui';

/** Onglet Données : objet, A/B, preheader, variables de personnalisation. */
export default function DataPanel({ scope }: { scope: StudioScope }) {
  const { t } = useLanguage();
  const campaign = useStudio((s) => s.campaign);
  const selectedId = useStudio((s) => s.selectedId);
  const patchContent = useStudio((s) => s.patchContent);
  const patchCampaign = useStudio((s) => s.patchCampaign);
  const updateBlock = useStudio((s) => s.updateBlock);
  const addBlock = useStudio((s) => s.addBlock);
  const blocks = campaign.blocks;

  const insertVariable = (key: string) => {
    const token = `{{${key}}}`;
    const selected = blocks.find((b) => b.id === selectedId);
    if (selected && selected.type === 'text') {
      updateBlock(selected.id, { body: `${selected.body}${selected.body.endsWith('>') ? '' : ' '}<p>${token}</p>` });
      toast.success(t('studio.data.varInserted').replace('{var}', token));
    } else {
      navigator.clipboard?.writeText(token).catch(() => undefined);
      toast.info(t('studio.data.varCopied').replace('{var}', token));
    }
  };

  const subjectLen = campaign.subject.length;

  return (
    <div className="yn-in" style={{ padding: '14px 16px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Field label={(
        <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
          <span>{t('studio.data.subject')}</span>
          <span style={{ color: subjectLen > SUBJECT_MAX ? RED : undefined, fontVariantNumeric: 'tabular-nums' }}>
            {subjectLen}/{SUBJECT_MAX}
          </span>
        </span>
      )}>
        <TextInput
          value={campaign.subject}
          onChange={(e) => patchContent({ subject: e.target.value })}
          placeholder={t('studio.data.subjectPh')}
        />
      </Field>

      <Toggle
        checked={campaign.abOn}
        onChange={(v) => patchCampaign({ abOn: v })}
        label={t('studio.data.abToggle')}
        help={t('studio.data.abHelp')}
      />
      {campaign.abOn && (
        <Field label={t('studio.data.subjectB')}>
          <TextInput
            value={campaign.subjectB}
            onChange={(e) => patchContent({ subjectB: e.target.value })}
            placeholder={t('studio.data.subjectBPh')}
          />
        </Field>
      )}

      <Field label={t('studio.data.preheader')}>
        <TextInput
          value={campaign.preheader}
          onChange={(e) => patchContent({ preheader: e.target.value })}
          placeholder={t('studio.data.preheaderPh')}
        />
      </Field>
      <Help>{t('studio.data.preheaderHelp')}</Help>

      <MicroLabel style={{ marginTop: 4 }}>{t('studio.data.variables')}</MicroLabel>
      <Help>{t('studio.data.variablesHelp')}</Help>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {EMAIL_VARIABLES.map((v) => (
          <button
            key={v.key} type="button"
            onClick={() => insertVariable(v.key)}
            style={{
              background: SUBTLE, border: `1px solid ${BORDER}`, borderRadius: 7,
              padding: '4px 9px', cursor: 'pointer',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 11, color: T2, transition: 'all .12s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = T1; e.currentTarget.style.borderColor = 'rgba(232,25,44,0.4)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = T2; e.currentTarget.style.borderColor = BORDER; }}
          >{`{{${v.key}}}`}</button>
        ))}
      </div>

      {scope.kind === 'venue' && (
        <div style={{ marginTop: 6, fontFamily: FONT_UI }}>
          <AIContentGenerator
            channel="email"
            eventId={campaign.eventId}
            segment={campaign.audiences[0]?.kind || 'all_subscribers'}
            onApply={(c) => {
              patchContent({ subject: c.title, preheader: c.preheader });
              const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              const html = c.body.split(/\n{2,}/).map((p) => `<p>${esc(p.trim())}</p>`).join('');
              const id = addBlock('text');
              updateBlock(id, { body: html });
            }}
          />
        </div>
      )}
    </div>
  );
}
