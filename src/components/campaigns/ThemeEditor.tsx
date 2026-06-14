import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import ColorField from './ColorField';
import { DEFAULT_THEME, THEME_PRESETS, type EmailTheme } from '@/lib/emailCampaign';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';

interface Props {
  theme: Required<EmailTheme>;
  onChange: (t: Required<EmailTheme>) => void;
}

type SectionKey = 'presets' | 'page' | 'header' | 'body' | 'cta' | 'footer';

const SECTION_KEYS: SectionKey[] = ['presets', 'page', 'header', 'body', 'cta', 'footer'];
const SECTION_LABEL: Record<SectionKey, string> = {
  presets: 'em.theme.presets', page: 'em.theme.pageCard', header: 'em.theme.header',
  body: 'em.theme.bodyLinks', cta: 'em.theme.buttons', footer: 'em.theme.footerSocial',
};

export default function ThemeEditor({ theme, onChange }: Props) {
  const { t } = useLanguage();
  const [open, setOpen] = useState<SectionKey>('presets');

  const set = (patch: Partial<Required<EmailTheme>>) => onChange({ ...theme, ...patch });

  const applyPreset = (id: string) => {
    const p = THEME_PRESETS.find(x => x.id === id);
    if (p) { onChange({ ...p.theme }); toast.success(`${t('em.theme.appliedPre')}« ${t('em.theme.preset.' + id)} »${t('em.theme.appliedPost')}`); }
  };

  const Section = ({ k, children }: { k: SectionKey; children: any }) => (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setOpen(open === k ? ('' as any) : k)}
        className="w-full flex items-center justify-between py-2.5 text-sm font-medium hover:text-primary transition-colors"
      >
        <span>{t(SECTION_LABEL[k])}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open === k ? 'rotate-180' : ''}`} />
      </button>
      {open === k && <div className="pb-3 pt-1">{children}</div>}
    </div>
  );

  return (
    <div className="rounded-lg border border-border px-3">
      <Section k="presets">
        <div className="flex flex-wrap gap-2">
          {THEME_PRESETS.map(p => (
            <button key={p.id} type="button" onClick={() => applyPreset(p.id)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border hover:border-primary/50 text-xs transition-colors">
              <span className="flex">
                <span className="w-3 h-3 rounded-l-sm border border-border" style={{ background: p.theme.header_bg }} />
                <span className="w-3 h-3" style={{ background: p.theme.card_bg }} />
                <span className="w-3 h-3 rounded-r-sm border border-border" style={{ background: p.theme.accent }} />
              </span>
              {t('em.theme.preset.' + p.id)}
            </button>
          ))}
        </div>
      </Section>

      <Section k="page">
        <div className="grid grid-cols-2 gap-3">
          <ColorField label={t('em.theme.bgPage')} value={theme.bg} onChange={(v) => set({ bg: v })} defaultValue={DEFAULT_THEME.bg} />
          <ColorField label={t('em.theme.bgCard')} value={theme.card_bg} onChange={(v) => set({ card_bg: v })} defaultValue={DEFAULT_THEME.card_bg} />
        </div>
      </Section>

      <Section k="header">
        <div className="grid grid-cols-2 gap-3">
          <ColorField label={t('em.theme.headerBg')} value={theme.header_bg} onChange={(v) => set({ header_bg: v })} defaultValue={DEFAULT_THEME.header_bg} />
          <ColorField label={t('em.theme.headerText')} value={theme.header_text} onChange={(v) => set({ header_text: v })} defaultValue={DEFAULT_THEME.header_text} />
        </div>
      </Section>

      <Section k="body">
        <div className="grid grid-cols-2 gap-3">
          <ColorField label={t('em.theme.bodyText')} value={theme.body_text} onChange={(v) => set({ body_text: v })} defaultValue={DEFAULT_THEME.body_text} />
          <ColorField label={t('em.theme.linkColor')} value={theme.link_color} onChange={(v) => set({ link_color: v })} defaultValue={DEFAULT_THEME.link_color} />
          <ColorField label={t('em.theme.dividers')} value={theme.divider_color} onChange={(v) => set({ divider_color: v })} defaultValue={DEFAULT_THEME.divider_color} />
        </div>
      </Section>

      <Section k="cta">
        <div className="grid grid-cols-2 gap-3">
          <ColorField label={t('em.theme.accent')} value={theme.accent} onChange={(v) => set({ accent: v })} defaultValue={DEFAULT_THEME.accent} />
          <ColorField label={t('em.theme.buttonText')} value={theme.button_text} onChange={(v) => set({ button_text: v })} defaultValue={DEFAULT_THEME.button_text} />
        </div>
      </Section>

      <Section k="footer">
        <div className="grid grid-cols-2 gap-3">
          <ColorField label={t('em.theme.footerBg')} value={theme.footer_bg} onChange={(v) => set({ footer_bg: v })} defaultValue={DEFAULT_THEME.footer_bg} />
          <ColorField label={t('em.theme.footerText')} value={theme.footer_text} onChange={(v) => set({ footer_text: v })} defaultValue={DEFAULT_THEME.footer_text} />
          <ColorField label={t('em.theme.footerLink')} value={theme.footer_link} onChange={(v) => set({ footer_link: v })} defaultValue={DEFAULT_THEME.footer_link} />
          <ColorField label={t('em.theme.socialBg')} value={theme.social_bg} onChange={(v) => set({ social_bg: v })} defaultValue={DEFAULT_THEME.social_bg} />
        </div>
        <div className="mt-3">
          <ColorField
            label={t('em.theme.socialIcon')}
            value={`#${theme.social_icon.replace('#', '')}`}
            onChange={(v) => set({ social_icon: v.replace('#', '') })}
            defaultValue={`#${DEFAULT_THEME.social_icon}`}
          />
        </div>
        <Button variant="ghost" size="sm" className="mt-2 w-full text-xs" onClick={() => onChange({ ...DEFAULT_THEME })}>
          {t('em.theme.reset')}
        </Button>
      </Section>
    </div>
  );
}
