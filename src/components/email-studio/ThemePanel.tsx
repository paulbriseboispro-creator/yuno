import { BookmarkPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import ColorField from '@/components/campaigns/ColorField';
import { THEME_LABELS, THEME_PRESETS, THEME_SWATCHES, type EmailTheme } from '@/lib/email';
import { useStudio } from './store';
import {
  BORDER, FONT_UI, Help, MicroLabel, PanelCard, RED_SOFT_GRAD, SUBTLE, T1, T2, TextInput,
  ToggleRow, inputStyle,
} from './ui';

const SOCIAL_KEYS = ['instagram', 'tiktok', 'facebook', 'x', 'website'] as const;

const COLOR_FIELDS: { key: keyof EmailTheme; labelKey: string }[] = [
  { key: 'bg', labelKey: 'studio.theme.bg' },
  { key: 'card', labelKey: 'studio.theme.card' },
  { key: 'accent', labelKey: 'studio.theme.accent' },
  { key: 'text', labelKey: 'studio.theme.text' },
  { key: 'muted', labelKey: 'studio.theme.muted' },
  { key: 'headerBg', labelKey: 'studio.theme.headerBg' },
  { key: 'headerText', labelKey: 'studio.theme.headerText' },
  { key: 'btnText', labelKey: 'studio.theme.btnText' },
  { key: 'divider', labelKey: 'studio.theme.divider' },
  { key: 'tile', labelKey: 'studio.theme.tile' },
  { key: 'footerBg', labelKey: 'studio.theme.footerBg' },
  { key: 'footerText', labelKey: 'studio.theme.footerText' },
];

/** Onglet Thème : 4 presets + couleurs + typographie (prototype). */
export default function ThemePanel() {
  const { t } = useLanguage();
  const theme = useStudio((s) => s.campaign.theme);
  const applyThemePreset = useStudio((s) => s.applyThemePreset);
  const patchTheme = useStudio((s) => s.patchTheme);
  const socialLinks = useStudio((s) => s.campaign.socialLinks);
  const setSocialLinks = useStudio((s) => s.setSocialLinks);
  const footerSocial = theme.footerSocial !== false;

  const saveClubTheme = () => {
    try {
      localStorage.setItem('yn-studio-club-theme', JSON.stringify(theme));
      toast.success(t('studio.theme.savedClub'));
    } catch {
      // stockage indisponible (navigation privée) : rien à faire
    }
  };

  return (
    <div className="yn-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <MicroLabel style={{ marginBottom: 10 }}>{t('studio.theme.presets')}</MicroLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {THEME_PRESETS.map((p) => {
            const active = theme.name === p.name;
            const sw = THEME_SWATCHES[p.name] || [p.bg, p.headerBg, p.accent];
            return (
              <button
                key={p.name} type="button"
                onClick={() => applyThemePreset(p.name)}
                aria-pressed={active}
                style={{
                  padding: 10, borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                  border: `1px solid ${active ? 'rgba(232,25,44,0.35)' : BORDER}`,
                  background: active ? RED_SOFT_GRAD : SUBTLE,
                }}
              >
                <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                  {sw.map((c, i) => (
                    <span key={i} style={{ width: 16, height: 16, borderRadius: 5, background: c, border: '1px solid rgba(255,255,255,.15)' }} />
                  ))}
                </div>
                <span style={{ color: active ? T1 : T2, fontSize: 11.5, fontWeight: 560, fontFamily: FONT_UI }}>
                  {THEME_LABELS[p.name] || p.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <PanelCard style={{ gap: 11 }}>
        <MicroLabel>{t('studio.theme.colors')}</MicroLabel>
        {COLOR_FIELDS.map((f) => (
          <ColorField
            key={f.key}
            label={t(f.labelKey)}
            value={String(theme[f.key])}
            onChange={(v) => patchTheme({ [f.key]: v } as Partial<EmailTheme>)}
          />
        ))}
        <ToggleRow
          checked={theme.dark}
          onChange={(v) => patchTheme({ dark: v })}
          label={t('studio.theme.dark')}
          help={t('studio.theme.darkHelp')}
        />
      </PanelCard>

      {/* Pied de page — les réseaux y sont OPTIONNELS : une campagne qui pose
          un bloc « Réseaux » dans le corps les coupe ici pour ne pas doubler. */}
      <PanelCard style={{ gap: 11 }}>
        <MicroLabel>{t('studio.theme.footer')}</MicroLabel>
        <ToggleRow
          checked={footerSocial}
          onChange={(v) => patchTheme({ footerSocial: v })}
          label={t('studio.theme.footerSocial')}
          help={t('studio.theme.footerSocialHelp')}
        />
        {footerSocial && SOCIAL_KEYS.map((key) => (
          <TextInput
            key={key}
            value={socialLinks[key] || ''}
            onChange={(e) => setSocialLinks({ ...socialLinks, [key]: e.target.value || undefined })}
            placeholder={key === 'website' ? 'lesilo.fr' : `${key}.com/lesilo`}
            aria-label={key}
            style={inputStyle}
          />
        ))}
        {footerSocial && <Help>{t('studio.theme.footerLinksHelp')}</Help>}
      </PanelCard>

      <PanelCard style={{ gap: 10 }}>
        <MicroLabel>{t('studio.theme.typo')}</MicroLabel>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: T2, fontSize: 12.5, fontFamily: FONT_UI }}>{t('studio.theme.typoBody')}</span>
          <span style={{ color: T1, fontSize: 12.5, fontFamily: FONT_UI }}>Arial · 16 px</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: T2, fontSize: 12.5, fontFamily: FONT_UI }}>{t('studio.theme.typoTitles')}</span>
          <span style={{ color: T1, fontSize: 12.5, fontFamily: FONT_UI }}>Arial · 700</span>
        </div>
        <Help>{t('studio.theme.typoHelp')}</Help>
      </PanelCard>

      <button
        type="button"
        onClick={saveClubTheme}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: 10,
          borderRadius: 11, border: '1px dashed rgba(255,255,255,0.16)', background: 'transparent',
          color: T2, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: FONT_UI,
        }}
      >
        <BookmarkPlus size={15} strokeWidth={1.75} /> {t('studio.theme.saveClub')}
      </button>
    </div>
  );
}
