import { Globe, Music2 } from 'lucide-react';
import { Instagram } from '@/components/icons/Instagram';
import { Twitter } from '@/components/icons/Twitter';
import { Facebook } from '@/components/icons/Facebook';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import type { SocialLinks } from '@/lib/emailCampaign';

interface Props {
  value: SocialLinks;
  onChange: (v: SocialLinks) => void;
}

const FIELDS: { key: keyof SocialLinks; label: string; placeholder: string; Icon: any }[] = [
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/votreclub', Icon: Instagram },
  { key: 'tiktok', label: 'TikTok', placeholder: 'https://tiktok.com/@votreclub', Icon: Music2 },
  { key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/votreclub', Icon: Facebook },
  { key: 'x', label: 'X / Twitter', placeholder: 'https://x.com/votreclub', Icon: Twitter },
  { key: 'website', label: 'em.sl.website', placeholder: 'https://votreclub.com', Icon: Globe },
];

export default function SocialLinksField({ value, onChange }: Props) {
  const { t } = useLanguage();
  return (
    <div className="space-y-2">
      {FIELDS.map(({ key, label, placeholder, Icon }) => (
        <div key={key} className="flex items-center gap-2">
          <div className="w-9 h-9 flex items-center justify-center rounded-md bg-muted text-muted-foreground shrink-0">
            <Icon className="w-4 h-4" />
          </div>
          <Input
            value={value[key] || ''}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            placeholder={placeholder}
            className="text-sm h-9"
            aria-label={key === 'website' ? t(label) : label}
          />
        </div>
      ))}
      <p className="text-xs text-muted-foreground">{t('em.sl.helper')}</p>
    </div>
  );
}
