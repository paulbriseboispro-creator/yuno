import { useState, useEffect, useCallback } from 'react';
import { Bell, Globe, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

const PUSH_ANSWERED_KEY = 'onboarding_push_answered';
const LANG_ANSWERED_KEY = 'onboarding_language_answered';

type Step = 'push' | 'ios_install' | 'language' | 'done';

const languages = [
  { code: 'en' as const, name: 'English', flag: '🇬🇧' },
  { code: 'es' as const, name: 'Español', flag: '🇪🇸' },
  { code: 'fr' as const, name: 'Français', flag: '🇫🇷' },
];

export function OnboardingGate() {
  const { language, setLanguage, t } = useLanguage();
  const { isSupported, isSubscribed, permission, subscribe, isiOS, isPWA, ready: pushReady } = usePushNotifications();
  const [step, setStep] = useState<Step>('done');

  // Determine initial step on mount
  useEffect(() => {
    // Wait until push hook has finished initializing
    if (!pushReady) return;

    const pushAnswered = localStorage.getItem(PUSH_ANSWERED_KEY) === 'true';
    const langAnswered = localStorage.getItem(LANG_ANSWERED_KEY) === 'true';

    // If already subscribed or permission already decided, mark push as done
    if (!pushAnswered && (isSubscribed || permission === 'granted' || permission === 'denied')) {
      localStorage.setItem(PUSH_ANSWERED_KEY, 'true');
      if (!langAnswered) {
        setStep('language');
      }
      return;
    }

    if (!pushAnswered) {
      // Only show push prompt inside PWA mode
      if (!isPWA || !isSupported) {
        localStorage.setItem(PUSH_ANSWERED_KEY, 'true');
        if (!langAnswered) {
          setStep('language');
        }
        return;
      }
      setStep('push');
      return;
    }

    if (!langAnswered) {
      setStep('language');
      return;
    }

    // Both answered → done
  }, [pushReady, isSupported, isSubscribed, permission, isiOS, isPWA]);

  // Lock body scroll when a blocking modal is open
  useEffect(() => {
    if (step !== 'done') {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [step]);

  const handleEnablePush = useCallback(async () => {
    localStorage.setItem(PUSH_ANSWERED_KEY, 'true');
    try {
      await subscribe();
      toast.success(t('notifications.enabled'));
    } catch {
      // Permission denied or error — still move on
    }
    const langAnswered = localStorage.getItem(LANG_ANSWERED_KEY) === 'true';
    setStep(langAnswered ? 'done' : 'language');
  }, [subscribe, t]);

  const handleDismissPush = useCallback(() => {
    localStorage.setItem(PUSH_ANSWERED_KEY, 'true');
    const langAnswered = localStorage.getItem(LANG_ANSWERED_KEY) === 'true';
    setStep(langAnswered ? 'done' : 'language');
  }, []);

  const handleDismissInstall = useCallback(() => {
    localStorage.setItem(PUSH_ANSWERED_KEY, 'true');
    const langAnswered = localStorage.getItem(LANG_ANSWERED_KEY) === 'true';
    setStep(langAnswered ? 'done' : 'language');
  }, []);

  const handleSelectLanguage = useCallback((code: 'en' | 'es' | 'fr') => {
    setLanguage(code);
    localStorage.setItem(LANG_ANSWERED_KEY, 'true');
    // Also set legacy key so old LanguageDialog doesn't re-show
    localStorage.setItem('languageSelected', 'true');
    setStep('done');
  }, [setLanguage]);

  if (step === 'done') return null;

  return (
    <AnimatePresence>
      <motion.div
        key={step}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex items-center justify-center p-4"
        // Block pointer events on backdrop — no dismiss by click
      >
        {/* Backdrop — not clickable */}
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

        {/* Card */}
        <motion.div
          initial={{ y: 40, opacity: 0, scale: 0.96 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 40, opacity: 0, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="relative w-full max-w-sm rounded-3xl border border-border/30 p-6 text-center space-y-4"
          style={{ background: 'hsl(var(--card))' }}
        >
          {step === 'push' && (
            <>
              <div className="mx-auto w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center">
                <Bell className="h-8 w-8 text-primary" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-foreground">{t('notifications.promptTitle')}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t('notifications.promptDescription')}
                </p>
              </div>
              <div className="space-y-2.5 pt-1">
                <Button onClick={handleEnablePush} className="w-full rounded-xl h-12 text-base font-semibold">
                  {t('notifications.enable')}
                </Button>
                <Button variant="ghost" onClick={handleDismissPush} className="w-full text-muted-foreground">
                  {t('notifications.notNow')}
                </Button>
              </div>
            </>
          )}

          {step === 'ios_install' && (
            <>
              <div className="mx-auto w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center">
                <Smartphone className="h-8 w-8 text-primary" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-foreground">{t('notifications.iosInstallTitle') || 'Install Yuno'}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t('notifications.iosInstallDesc') || 'To receive notifications, add Yuno to your Home Screen: tap the Share button, then "Add to Home Screen".'}
                </p>
              </div>
              <div className="space-y-2.5 pt-1">
                <Button onClick={handleDismissInstall} className="w-full rounded-xl h-12 text-base font-semibold">
                  {t('notifications.understood') || 'Got it'}
                </Button>
              </div>
            </>
          )}

          {step === 'language' && (
            <>
              <div className="mx-auto w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center">
                <Globe className="h-6 w-6 text-primary" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-foreground">{t('language.select')}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t('language.selectDesc')}
                </p>
              </div>
              <div className="space-y-3 pt-1">
                {languages.map((lang) => (
                  <motion.div key={lang.code} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
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
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
