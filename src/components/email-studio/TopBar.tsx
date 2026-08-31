import { useEffect, useState } from 'react';
import { ArrowRight, ChevronLeft, Eye, Monitor, Pencil, Redo2, SendHorizontal, Smartphone, Undo2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useStudio } from './store';
import type { StudioScope } from './hooks';
import {
  BORDER, FONT_UI, GhostBtn, PrimaryBtn, SegBtns, StatusBadge, SUBTLE, T1, T2, T3, TOPBAR_BG, VSep,
} from './ui';

function useSavedLabel(): string {
  const { t } = useLanguage();
  const savedAt = useStudio((s) => s.savedAt);
  const saving = useStudio((s) => s.saving);
  const dirty = useStudio((s) => s.dirty);
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);
  if (saving) return t('studio.top.saving');
  if (dirty) return t('studio.top.unsaved');
  if (savedAt) {
    const seconds = Math.max(0, Math.round((Date.now() - savedAt) / 1000));
    if (seconds < 8) return t('studio.top.savedNow');
    if (seconds < 60) return t('studio.top.savedAgoS').replace('{s}', String(seconds));
    return t('studio.top.savedAgoM').replace('{m}', String(Math.round(seconds / 60)));
  }
  return '';
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
  const savedLabel = useSavedLabel();

  const statusTone = status === 'sent' ? 'green' : status === 'scheduled' ? 'amber' : 'neutral';

  return (
    <header style={{
      height: 58, flex: 'none', display: 'flex', alignItems: 'center', gap: 14,
      padding: '0 16px', background: TOPBAR_BG, borderBottom: `1px solid ${BORDER}`,
      position: 'relative', zIndex: 2,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <button
          type="button" onClick={onBack} aria-label={t('studio.top.back')}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.10)'; e.currentTarget.style.color = T1; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = T2; }}
          style={{
            width: 30, height: 30, borderRadius: 10, display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: 'rgba(255,255,255,0.06)',
            border: `1px solid ${BORDER}`, color: T2, cursor: 'pointer', flex: 'none',
          }}
        ><ChevronLeft size={16} strokeWidth={1.75} /></button>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              value={name}
              onChange={(e) => patchCampaign({ name: e.target.value })}
              aria-label={t('studio.top.nameLabel')}
              placeholder={t('studio.top.namePh')}
              style={{
                background: 'transparent', border: '1px solid transparent', borderRadius: 7,
                padding: '2px 6px', marginLeft: -6, color: T1, fontSize: 14, fontWeight: 600,
                letterSpacing: '-0.01em', width: 230, fontFamily: FONT_UI, outline: 'none',
              }}
              onFocus={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              onBlur={(e) => { e.currentTarget.style.background = 'transparent'; }}
            />
            <StatusBadge label={t(`studio.status.${status}` as const)} tone={statusTone} />
          </div>
          <div style={{ color: T3, fontSize: 11, marginTop: 1, fontFamily: FONT_UI, whiteSpace: 'nowrap' }}>
            {scope.name} · {savedLabel}
          </div>
        </div>
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <button
          type="button" onClick={undo} aria-label={t('studio.top.undo')} title={t('studio.top.undo')}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          style={{
            width: 30, height: 30, borderRadius: 9, display: 'flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'pointer', background: 'transparent', border: 'none',
            color: canUndo ? T2 : 'rgba(255,255,255,0.18)',
          }}
        ><Undo2 size={16} strokeWidth={1.75} /></button>
        <button
          type="button" onClick={redo} aria-label={t('studio.top.redo')} title={t('studio.top.redo')}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          style={{
            width: 30, height: 30, borderRadius: 9, display: 'flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'pointer', background: 'transparent', border: 'none',
            color: canRedo ? T2 : 'rgba(255,255,255,0.18)',
          }}
        ><Redo2 size={16} strokeWidth={1.75} /></button>
      </div>

      <VSep />

      <GhostBtn onClick={() => setPreview(!preview)} active={preview} ariaLabel={t('studio.top.preview')}>
        {preview ? <Pencil size={14} strokeWidth={1.75} /> : <Eye size={14} strokeWidth={1.75} />}
        {preview ? t('studio.top.editMode') : t('studio.top.preview')}
      </GhostBtn>

      <SegBtns
        ariaLabel={t('studio.top.device')}
        value={device}
        onChange={setDevice}
        options={[
          { value: 'desktop', label: <><Monitor size={14} strokeWidth={1.75} />Desktop</>, title: 'Desktop' },
          { value: 'mobile', label: <><Smartphone size={14} strokeWidth={1.75} />Mobile</>, title: 'Mobile' },
        ]}
      />

      <VSep />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <GhostBtn onClick={onTestEmail} style={{ background: SUBTLE }}>
          <SendHorizontal size={14} strokeWidth={1.75} /> {t('studio.top.testEmail')}
        </GhostBtn>
        <PrimaryBtn onClick={onContinue}>
          {t('studio.top.continue')} <ArrowRight size={14} strokeWidth={1.75} />
        </PrimaryBtn>
      </div>
    </header>
  );
}
