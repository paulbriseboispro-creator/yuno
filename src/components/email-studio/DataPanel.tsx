import { Users } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import AIContentGenerator from '@/components/campaigns/AIContentGenerator';
import { BLOCK_COND_LABELS, BLOCK_CONDS, EMAIL_VARIABLES, type BlockCond } from '@/lib/email';
import { useStudio } from './store';
import type { StudioScope } from './hooks';
import { blockMeta } from './meta';
import {
  BORDER, FONT_UI, Help, MicroLabel, MONO, PanelCard, SUBTLE, Switch, T1, T2, T3, TextInput,
} from './ui';

/** Onglet Dynamique : variables, règle de visibilité du bloc, A/B d'objet. */
export default function DataPanel({ scope }: { scope: StudioScope }) {
  const { t } = useLanguage();
  const campaign = useStudio((s) => s.campaign);
  const selectedId = useStudio((s) => s.selectedId);
  const patchContent = useStudio((s) => s.patchContent);
  const patchCampaign = useStudio((s) => s.patchCampaign);
  const updateBlock = useStudio((s) => s.updateBlock);
  const addBlock = useStudio((s) => s.addBlock);
  const blocks = campaign.blocks;
  const selected = blocks.find((b) => b.id === selectedId);

  const insertVariable = (key: string) => {
    const token = `{{${key}}}`;
    const target = (selected && selected.type === 'text' ? selected : undefined)
      || blocks.find((b) => b.type === 'text');
    if (target && target.type === 'text') {
      updateBlock(target.id, { body: `${target.body}${target.body.endsWith(' ') || target.body.length === 0 ? '' : ' '}${token}` });
      toast.success(t('studio.data.varInserted').replace('{var}', token));
    } else {
      navigator.clipboard?.writeText(token).catch(() => undefined);
      toast.info(t('studio.data.varCopied').replace('{var}', token));
    }
  };

  return (
    <div className="yn-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Variables */}
      <PanelCard style={{ gap: 11 }}>
        <MicroLabel>{t('studio.data.variables')}</MicroLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {EMAIL_VARIABLES.map((v) => (
            <button
              key={v.key} type="button"
              onClick={() => insertVariable(v.key)}
              style={{
                padding: '5px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${BORDER}`, color: T2, fontSize: 11.5,
                fontFamily: MONO, cursor: 'pointer', transition: 'all .12s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = T1; e.currentTarget.style.borderColor = 'rgba(232,25,44,0.4)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = T2; e.currentTarget.style.borderColor = BORDER; }}
            >{`{{${v.key}}}`}</button>
          ))}
        </div>
        <Help>{t('studio.data.variablesHelp')}</Help>
      </PanelCard>

      {/* Règle de visibilité du bloc sélectionné */}
      {selected && (
        <PanelCard style={{ gap: 9 }}>
          <MicroLabel>
            {t('studio.data.condTitle').replace('{block}', t(blockMeta(selected.type).labelKey))}
          </MicroLabel>
          {[null, ...BLOCK_CONDS].map((cond) => {
            const active = (selected.cond || null) === cond;
            return (
              <button
                key={cond ?? 'all'} type="button"
                onClick={() => updateBlock(selected.id, { cond })}
                aria-pressed={active}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', borderRadius: 10,
                  cursor: 'pointer', fontSize: 12, textAlign: 'left', fontFamily: FONT_UI,
                  color: active ? T1 : T2,
                  background: active ? 'rgba(232,25,44,0.09)' : SUBTLE,
                  border: `1px solid ${active ? 'rgba(232,25,44,0.25)' : BORDER}`,
                }}
              >
                <Users size={13} strokeWidth={1.75} />
                {cond === null ? t('studio.data.condAlways') : BLOCK_COND_LABELS[cond as BlockCond]}
              </button>
            );
          })}
          <Help>{t('studio.data.condHelp')}</Help>
        </PanelCard>
      )}

      {/* A/B d'objet */}
      <PanelCard style={{ gap: 11 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <MicroLabel>{t('studio.data.abToggle')}</MicroLabel>
          <Switch
            checked={campaign.abOn}
            onChange={(v) => patchCampaign({ abOn: v })}
            ariaLabel={t('studio.data.abToggle')}
          />
        </div>
        {campaign.abOn && (
          <>
            <div style={{ padding: '9px 11px', borderRadius: 10, background: SUBTLE, border: `1px solid ${BORDER}` }}>
              <div style={{ color: T3, fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase', fontFamily: FONT_UI }}>
                {t('studio.data.variantA')}
              </div>
              <div style={{ color: T1, fontSize: 12, marginTop: 3, fontFamily: FONT_UI }}>
                {campaign.subject || t('studio.data.subjectPh')}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ color: T3, fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase', fontFamily: FONT_UI }}>
                {t('studio.data.variantB')}
              </div>
              <TextInput
                value={campaign.subjectB}
                onChange={(e) => patchContent({ subjectB: e.target.value })}
                placeholder={t('studio.data.subjectBPh')}
              />
            </div>
            <Help>{t('studio.data.abHelp')}</Help>
          </>
        )}
      </PanelCard>

      {scope.kind === 'venue' && (
        <div style={{ fontFamily: FONT_UI }}>
          <AIContentGenerator
            channel="email"
            eventId={campaign.eventId}
            segment={campaign.audiences[0]?.kind || 'all_subscribers'}
            onApply={(c) => {
              patchContent({ subject: c.title, preheader: c.preheader });
              const id = addBlock('text');
              updateBlock(id, { body: c.body });
            }}
          />
        </div>
      )}
    </div>
  );
}
