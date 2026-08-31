import { useEffect, useState } from 'react';
import { ArrowLeft, Eye, Monitor, Redo2, Send, Smartphone, Undo2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useStudio } from './store';
import type { StudioScope } from './hooks';
import {
  BORDER, FONT_UI, GhostBtn, IconBtn, PrimaryBtn, SegBtns, StatusBadge, T1, T3, TOPBAR_BG,
} from './ui';

function SavedIndicator() {
  const { t } = useLanguage();
  const savedAt = useStudio((s) => s.savedAt);
  const saving = useStudio((s) => s.saving);
  const dirty = useStudio((s) => s.dirty);
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  let text: string;
  if (saving) text = t('studio.top.saving');
  else if (dirty) text = t('studio.top.unsaved');
  else if (savedAt) {
    const seconds = Math.max(0, Math.round((Date.now() - savedAt) / 1000));
    text = seconds < 8
      ? t('studio.top.savedNow')
      : seconds < 60
        ? t('studio.top.savedAgoS').replace('{s}', String(seconds))
        : t('studio.top.savedAgoM').replace('{m}', String(Math.round(seconds / 60)));
  } else text = '';
  return <span style={{ fontSize: 11.5, color: T3, fontFamily: FONT_UI, whiteSpace: 'nowrap' }}>{text}</span>;
}

export default function TopBar({ scope, onBack, onTestEmail, onContinue }: {
  scope: StudioScope;
  onBack: () => void;
  onTestEmail: () => void;
  onContinue: () => void;
}) {
  const { t } = useLanguage();
  const name = useStudio((s) => s.campaign.name);
  const status = useStudio((s) => s.campaign.status);
  const patchCampaign = useStudio((s) => s.patchCampaign);
  const undo = useStudio((s) => s.undo);
  const redo = useStudio((s) => s.redo);
  const canUndo = useStudio((s) => s.past.length > 0);
  const canRedo = useStudio((s) => s.future.length > 0);
  const preview = useStudio((s) => s.preview);
  const setPreview = useStudio((s) => s.setPreview);
  const device = useStudio((s) => s.device);
  const setDevice = useStudio((s) => s.setDevice);

  const statusTone = status === 'sent' ? 'green' : status === 'scheduled' ? 'amber' : 'neutral';
  const statusLabel = t(`studio.status.${status}` as const);

  return (
    <header style={{
      height: 58, flex: 'none', display: 'flex', alignItems: 'center', gap: 10,
      padding: '0 14px', background: TOPBAR_BG, borderBottom: `1px solid ${BORDER}`,
    }}>
      <IconBtn ariaLabel={t('studio.top.back')} onClick={onBack} size={30}>
        <ArrowLeft size={16} strokeWidth={1.75} />
      </IconBtn>

      <input
        value={name}
        onChange={(e) => patchCampaign({ name: e.target.value })}
        aria-label={t('studio.top.nameLabel')}
        placeholder={t('studio.top.namePh')}
        style={{
          background: 'transparent', border: '1px solid transparent', borderRadius: 7,
          color: T1, fontSize: 13.5, fontWeight: 700, fontFamily: FONT_UI,
          padding: '5px 8px', width: 220, outline: 'none',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'transparent'; }}
      />
      <StatusBadge label={statusLabel} tone={statusTone} />

      <span style={{ fontSize: 11.5, color: T3, fontFamily: FONT_UI, whiteSpace: 'nowrap' }}>
        {scope.name} ·
      </span>
      <SavedIndicator />

      <div style={{ flex: 1 }} />

      <IconBtn ariaLabel={t('studio.top.undo')} onClick={undo} disabled={!canUndo} size={30}>
        <Undo2 size={15} strokeWidth={1.75} />
      </IconBtn>
      <IconBtn ariaLabel={t('studio.top.redo')} onClick={redo} disabled={!canRedo} size={30}>
        <Redo2 size={15} strokeWidth={1.75} />
      </IconBtn>

      <GhostBtn onClick={() => setPreview(!preview)} active={preview} ariaLabel={t('studio.top.preview')}>
        <Eye size={14} strokeWidth={1.75} /> {t('studio.top.preview')}
      </GhostBtn>

      <SegBtns
        ariaLabel={t('studio.top.device')}
        value={device}
        onChange={setDevice}
        options={[
          { value: 'desktop', label: <Monitor size={14} strokeWidth={1.75} />, title: 'Desktop' },
          { value: 'mobile', label: <Smartphone size={14} strokeWidth={1.75} />, title: 'Mobile' },
        ]}
      />

      <GhostBtn onClick={onTestEmail}>
        <Send size={13} strokeWidth={1.75} /> {t('studio.top.testEmail')}
      </GhostBtn>

      <PrimaryBtn onClick={onContinue}>{t('studio.top.continue')}</PrimaryBtn>
    </header>
  );
}
