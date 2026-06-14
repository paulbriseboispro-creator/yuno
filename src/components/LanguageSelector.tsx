import { Globe } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

const languages = [
  { code: 'en' as const, name: 'English', flag: '🇬🇧' },
  { code: 'es' as const, name: 'Español', flag: '🇪🇸' },
  { code: 'fr' as const, name: 'Français', flag: '🇫🇷' },
];

export function LanguageSelector() {
  const { language, setLanguage } = useLanguage();

  const currentLang = languages.find((lang) => lang.code === language);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Globe className="h-4 w-4" />
          <span className="text-lg">{currentLang?.flag}</span>
          <span className="hidden sm:inline">{currentLang?.name}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2">
        <div className="space-y-1">
          {languages.map((lang) => (
            <Button
              key={lang.code}
              variant={language === lang.code ? 'default' : 'ghost'}
              className="w-full justify-start gap-2"
              onClick={() => setLanguage(lang.code)}
            >
              <span className="text-lg">{lang.flag}</span>
              <span>{lang.name}</span>
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}