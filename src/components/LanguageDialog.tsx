import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { Globe } from 'lucide-react';

const languages = [
  { code: 'en' as const, name: 'English', flag: '🇬🇧' },
  { code: 'es' as const, name: 'Español', flag: '🇪🇸' },
  { code: 'fr' as const, name: 'Français', flag: '🇫🇷' },
];

export function LanguageDialog() {
  const [open, setOpen] = useState(false);
  const { language, setLanguage, t } = useLanguage();

  useEffect(() => {
    const hasSelectedLanguage = localStorage.getItem('languageSelected');
    if (!hasSelectedLanguage) {
      setOpen(true);
    }
  }, []);

  const handleSelectLanguage = (code: 'en' | 'es' | 'fr') => {
    setLanguage(code);
    localStorage.setItem('languageSelected', 'true');
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Globe className="h-6 w-6 text-primary" />
            {t('language.select')}
          </DialogTitle>
          <DialogDescription>
            {t('language.selectDesc')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-4">
          {languages.map((lang) => (
            <motion.div
              key={lang.code}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Button
                variant={language === lang.code ? 'default' : 'outline'}
                className="w-full justify-start gap-3 h-14 text-lg"
                onClick={() => handleSelectLanguage(lang.code)}
              >
                <span className="text-2xl">{lang.flag}</span>
                <span>{lang.name}</span>
              </Button>
            </motion.div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
