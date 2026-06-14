import { Palette, Mail, Share2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { type EmailTheme, type SocialLinks } from '@/lib/emailCampaign';
import ThemeEditor from '@/components/campaigns/ThemeEditor';
import ImageUploader from '@/components/campaigns/ImageUploader';
import SocialLinksField from '@/components/campaigns/SocialLinksField';

interface Props {
  subject: string;
  onSubjectChange: (v: string) => void;
  preheader: string;
  onPreheaderChange: (v: string) => void;
  name?: string;
  onNameChange?: (v: string) => void;
  logoUrl: string | null;
  onLogoUrlChange: (v: string | null) => void;
  theme: Required<EmailTheme>;
  onThemeChange: (t: Required<EmailTheme>) => void;
  socialLinks: SocialLinks;
  onSocialLinksChange: (v: SocialLinks) => void;
  bucketFolder: string;
  showLogo?: boolean;
  showSocial?: boolean;
}

export default function GlobalSettings({
  subject, onSubjectChange, preheader, onPreheaderChange,
  name, onNameChange, logoUrl, onLogoUrlChange,
  theme, onThemeChange, socialLinks, onSocialLinksChange, bucketFolder,
  showLogo = true, showSocial = true,
}: Props) {
  const { t } = useLanguage();
  return (
    <div className="space-y-5">
      {/* Email identity */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold"><Mail className="w-4 h-4 text-primary" /> {t('em.gs.email')}</div>
        {onNameChange && (
          <div>
            <Label className="text-xs">{t('em.gs.internalName')} <span className="text-muted-foreground">{t('em.gs.notVisible')}</span></Label>
            <Input value={name || ''} onChange={e => onNameChange(e.target.value)} placeholder={t('em.gs.internalNamePh')} className="mt-1" />
          </div>
        )}
        <div>
          <Label className="text-xs">{t('em.gs.subject')} <span className="text-muted-foreground">({subject.length}/60 {t('em.gs.recommended')})</span></Label>
          <Input value={subject} onChange={e => onSubjectChange(e.target.value)} maxLength={150} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">{t('em.gs.preview')} <span className="text-muted-foreground">(preheader)</span></Label>
          <Input value={preheader} onChange={e => onPreheaderChange(e.target.value)} className="mt-1" placeholder={t('em.gs.preheaderPh')} />
        </div>
      </section>

      {/* Visual identity */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold"><Palette className="w-4 h-4 text-primary" /> {t('em.gs.visualIdentity')}</div>
        {showLogo && (
          <ImageUploader
            value={logoUrl}
            onChange={onLogoUrlChange}
            bucketFolder={`${bucketFolder}/logos`}
            label={t('em.gs.logo')}
            helper={t('em.gs.logoHelp')}
            preview="logo"
            previewBg={theme.header_bg}
          />
        )}
        <ThemeEditor theme={theme} onChange={onThemeChange} />
      </section>

      {/* Social links */}
      {showSocial && (
        <section>
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="w-full justify-start gap-2">
                <Share2 className="w-4 h-4" /> {t('em.gs.social')}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <SocialLinksField value={socialLinks} onChange={onSocialLinksChange} />
            </CollapsibleContent>
          </Collapsible>
        </section>
      )}
    </div>
  );
}
