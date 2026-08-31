import { useLanguage } from '@/contexts/LanguageContext';
import ColorField from '@/components/campaigns/ColorField';
import { THEME_LABELS, THEME_PRESETS, type EmailTheme } from '@/lib/email';
import { useStudio } from './store';
import { BORDER, FONT_UI, Help, MicroLabel, SUBTLE, T1, Toggle } from './ui';

const COLOR_FIELDS: { key: keyof EmailTheme; labelKey: string }[] = [
  { key: 'bg', labelKey: 'studio.theme.bg' },
  { key: 'card', labelKey: 'studio.theme.card' },
  { key: 'headerBg', labelKey: 'studio.theme.headerBg' },
  { key: 'headerText', labelKey: 'studio.theme.headerText' },
  { key: 'text', labelKey: 'studio.theme.text' },
  { key: 'muted', labelKey: 'studio.theme.muted' },
  { key: 'accent', labelKey: 'studio.theme.accent' },
  { key: 'btnText', labelKey: 'studio.theme.btnText' },
  { key: 'divider', labelKey: 'studio.theme.divider' },
  { key: 'tile', labelKey: 'studio.theme.tile' },
  { key: 'footerBg', labelKey: 'studio.theme.footerBg' },
  { key: 'footerText', labelKey: 'studio.theme.footerText' },
];

/** Onglet Thème : 4 presets + réglages fins de chaque token du MAIL. */
export default function ThemePanel() {
  const { t } = useLanguage();
  const theme = useStudio((s) => s.campaign.theme);
  const applyThemePreset = useStudio((s) => s.applyThemePreset);
  const patchTheme = useStudio((s) => s.patchTheme);

  return (
    <div className="yn-in" style={{ padding: '14px 16px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <MicroLabel>{t('studio.theme.presets')}</MicroLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
        {THEME_PRESETS.map((p) => {
          const active = theme.name === p.name;
          return (
            <button
              key={p.name} type="button"
              onClick={() => applyThemePreset(p.name)}
              aria-pressed={active}
              style={{
                display: 'flex', flexDirection: 'column', gap: 7, textAlign: 'left',
                background: SUBTLE, borderRadius: 10, padding: 9, cursor: 'pointer',
                border: `1px solid ${active ? 'rgba(232,25,44,0.5)' : BORDER}`,
                transition: 'border-color .12s',
              }}
            >
              <span style={{ display: 'flex', gap: 4 }}>
                {[p.bg, p.headerBg, p.accent, p.card].map((c, i) => (
                  <span key={i} style={{
                    width: 16, height: 16, borderRadius: 5, background: c,
                    border: '1px solid rgba(255,255,255,0.14)',
                  }} />
                ))}
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: T1, fontFamily: FONT_UI }}>
                {THEME_LABELS[p.name] || p.name}
              </span>
            </button>
          );
        })}
      </div>

      <MicroLabel style={{ marginTop: 4 }}>{t('studio.theme.fineTune')}</MicroLabel>
      <Help>{t('studio.theme.fineTuneHelp')}</Help>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {COLOR_FIELDS.map((f) => (
          <ColorField
            key={f.key}
            label={t(f.labelKey)}
            value={String(theme[f.key])}
            onChange={(v) => patchTheme({ [f.key]: v } as Partial<EmailTheme>)}
          />
        ))}
      </div>

      <Toggle
        checked={theme.dark}
        onChange={(v) => patchTheme({ dark: v })}
        label={t('studio.theme.dark')}
        help={t('studio.theme.darkHelp')}
      />
    </div>
  );
}
