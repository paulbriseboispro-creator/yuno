import { useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, LayoutTemplate, Loader2, Pencil, Trash2, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { campaignToTemplateContent, eventBoundBlocks, type EmailTemplate, type StudioCampaign } from '@/lib/email';
import {
  BORDER, FONT_UI, GhostBtn, NEG, PrimaryBtn, RED, SUBTLE, T1, T2, T3, TextArea, TextInput,
} from './ui';

/** Coque de modale du Studio — mêmes tokens que « Envoyer un test ». */
function Shell({ title, help, icon, onClose, children }: {
  title: string; help: string; icon: ReactNode; onClose: () => void; children: ReactNode;
}) {
  return (
    <div
      role="dialog" aria-modal="true" aria-label={title}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)',
      }}
    >
      <div
        className="yn-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460, maxWidth: 'calc(100vw - 32px)', borderRadius: 18, overflow: 'hidden',
          border: `1px solid ${BORDER}`, fontFamily: FONT_UI,
          background: 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c',
          boxShadow: '0 1px 0 rgba(255,255,255,.05) inset,0 40px 80px -40px #000',
        }}
      >
        <div style={{ padding: '20px 22px 0', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 11, display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: 'rgba(232,25,44,0.1)',
            border: '1px solid rgba(232,25,44,0.2)', color: RED, flex: 'none',
          }}>{icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</div>
            <div style={{ color: T3, fontSize: 11.5, marginTop: 2, lineHeight: 1.5 }}>{help}</div>
          </div>
          <button
            type="button" onClick={onClose} aria-label="×"
            style={{
              width: 28, height: 28, borderRadius: 9, display: 'flex', alignItems: 'center',
              justifyContent: 'center', cursor: 'pointer', background: 'transparent',
              border: 'none', color: T3, flex: 'none',
            }}
          ><X size={15} strokeWidth={1.75} /></button>
        </div>
        <div style={{ padding: '18px 22px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span style={{
      color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase',
    }}>{children}</span>
  );
}

/**
 * « Enregistrer comme modèle » — la campagne courante devient un point de
 * départ réutilisable. Deux chemins : nouveau modèle, ou remplacement d'un
 * modèle existant (c'est ainsi qu'on peaufine son invitation dans le temps).
 */
export default function SaveTemplateDialog({ open, campaign, templates, onClose, onCreate, onOverwrite }: {
  open: boolean;
  campaign: StudioCampaign;
  templates: EmailTemplate[];
  onClose: () => void;
  onCreate: (name: string, description: string) => Promise<boolean>;
  onOverwrite: (id: string, name: string, description: string) => Promise<boolean>;
}) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<'new' | 'replace'>('new');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetId, setTargetId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode('new');
    setName(campaign.name || '');
    setDescription('');
    setTargetId(templates[0]?.id || '');
    setBusy(false);
  }, [open, campaign.name, templates]);

  if (!open) return null;

  const yunoCount = eventBoundBlocks(campaignToTemplateContent(campaign).blocks).length;
  const canSubmit = mode === 'new' ? name.trim().length > 0 : !!targetId;

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    const ok = mode === 'new'
      ? await onCreate(name, description)
      : await onOverwrite(targetId, name || templates.find((x) => x.id === targetId)?.name || '', description);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Shell
      title={t('studio.tpl.saveTitle')}
      help={t('studio.tpl.saveDesc')}
      icon={<LayoutTemplate size={16} strokeWidth={1.75} />}
      onClose={onClose}
    >
      {templates.length > 0 && (
        <div style={{ display: 'flex', gap: 6 }}>
          {(['new', 'replace'] as const).map((m) => (
            <button
              key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
              style={{
                flex: 1, padding: '9px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 12.5,
                fontFamily: FONT_UI, fontWeight: 540,
                color: mode === m ? T1 : T2,
                background: mode === m ? 'rgba(232,25,44,0.10)' : SUBTLE,
                border: `1px solid ${mode === m ? 'rgba(232,25,44,0.28)' : BORDER}`,
              }}
            >{t(m === 'new' ? 'studio.tpl.saveNew' : 'studio.tpl.saveOverwrite')}</button>
          ))}
        </div>
      )}

      {mode === 'replace' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <FieldLabel>{t('studio.tpl.saveTarget')}</FieldLabel>
          <select
            value={targetId} onChange={(e) => setTargetId(e.target.value)}
            style={{
              width: '100%', padding: '9px 11px', borderRadius: 10, background: '#0a0a0c',
              border: `1px solid ${BORDER}`, color: T1, fontSize: 12.5, fontFamily: FONT_UI, outline: 'none',
            }}
          >
            {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
          </select>
        </label>
      )}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <FieldLabel>{t('studio.tpl.saveName')}</FieldLabel>
        <TextInput
          value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
          placeholder={t('studio.tpl.saveNamePh')}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <FieldLabel>{t('studio.tpl.saveDescription')}</FieldLabel>
        <TextArea
          value={description} onChange={(e) => setDescription(e.target.value)} maxLength={240} rows={2}
          placeholder={t('studio.tpl.saveDescriptionPh')}
        />
      </label>

      <p style={{ color: T3, fontSize: 11.5, margin: 0, lineHeight: 1.6 }}>
        {yunoCount > 0
          ? t('studio.tpl.saveYuno').replace('{n}', String(yunoCount))
          : t('studio.tpl.saveNotes')}
      </p>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <GhostBtn onClick={onClose}>{t('studio.tpl.cancel')}</GhostBtn>
        <PrimaryBtn onClick={() => { void submit(); }} disabled={!canSubmit || busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} strokeWidth={1.75} />}
          {t('studio.tpl.saveBtn')}
        </PrimaryBtn>
      </div>
    </Shell>
  );
}

/** Renommage / description d'un modèle existant (galerie). */
export function RenameTemplateDialog({ template, onClose, onSubmit }: {
  template: EmailTemplate | null;
  onClose: () => void;
  onSubmit: (name: string, description: string) => Promise<boolean>;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!template) return;
    setName(template.name);
    setDescription(template.description);
    setBusy(false);
  }, [template]);

  if (!template) return null;

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    await onSubmit(name, description);
    setBusy(false);
  };

  return (
    <Shell
      title={t('studio.tpl.renameTitle')}
      help={t('studio.tpl.renameHelp')}
      icon={<Pencil size={16} strokeWidth={1.75} />}
      onClose={onClose}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <FieldLabel>{t('studio.tpl.saveName')}</FieldLabel>
        <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <FieldLabel>{t('studio.tpl.saveDescription')}</FieldLabel>
        <TextArea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={240} rows={2} />
      </label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <GhostBtn onClick={onClose}>{t('studio.tpl.cancel')}</GhostBtn>
        <PrimaryBtn onClick={() => { void submit(); }} disabled={!name.trim() || busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          {t('studio.tpl.saveBtn')}
        </PrimaryBtn>
      </div>
    </Shell>
  );
}

/** Confirmation de suppression d'un modèle — jamais un window.confirm nu. */
export function DeleteTemplateDialog({ template, busy, onClose, onConfirm }: {
  template: EmailTemplate | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLanguage();
  if (!template) return null;
  return (
    <Shell
      title={t('studio.tpl.deleteTitle').replace('{name}', template.name)}
      help={t('studio.tpl.deleteHelp')}
      icon={<Trash2 size={16} strokeWidth={1.75} />}
      onClose={onClose}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <GhostBtn onClick={onClose}>{t('studio.tpl.cancel')}</GhostBtn>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px',
            borderRadius: 10, cursor: busy ? 'default' : 'pointer', fontFamily: FONT_UI,
            fontSize: 12.5, fontWeight: 600, color: '#fff', border: 'none',
            background: NEG, opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} strokeWidth={1.75} />}
          {t('studio.tpl.delete')}
        </button>
      </div>
    </Shell>
  );
}
