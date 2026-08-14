import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, Globe, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { deviceLanguage } from '@/lib/deviceLanguage';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { isNative } from '@/lib/native';
import { onSplashGone } from '@/lib/appReady';
import { requestLocationIfUndecided } from '@/lib/geolocation';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { OnboardingTasteQuiz } from '@/components/onboarding/OnboardingTasteQuiz';
import { LAUNCH_TASTE_QUIZ_EVENT } from '@/lib/demoQuiz';

const PUSH_ANSWERED_KEY = 'onboarding_push_answered';
const LANG_ANSWERED_KEY = 'onboarding_language_answered';
const TASTE_ANSWERED_KEY = 'onboarding_taste_answered';

type Step = 'push' | 'ios_install' | 'language' | 'taste' | 'done';

const languages = [
  { code: 'en' as const, name: 'English', flag: '🇬🇧' },
  { code: 'es' as const, name: 'Español', flag: '🇪🇸' },
  { code: 'fr' as const, name: 'Français', flag: '🇫🇷' },
];

export function OnboardingGate() {
  const { language, setLanguage, t } = useLanguage();
  const { isSupported, isSubscribed, permission, subscribe, isiOS, isPWA, ready: pushReady } = usePushNotifications();
  const [step, setStep] = useState<Step>('done');
  const [tasteUserId, setTasteUserId] = useState<string | null>(null);

  // Utilisateur connecté (le quiz de goût écrit user_taste_profiles).
  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => { if (active) setTasteUserId(data.user?.id ?? null); });
    return () => { active = false; };
  }, []);

  // ── App native : séquence de permissions, une à la fois ──
  // 1. Le splash finit son animation de sortie (l'accueil est révélé) ;
  // 2. dialogue Apple des NOTIFICATIONS ;
  // 3. une fois la réponse donnée, dialogue Apple de la LOCALISATION
  //    (seulement si jamais posée) ;
  // 4. carte de langue si l'appareil parle une langue que Yuno n'a pas.
  // Jamais deux dialogues empilés, jamais pendant l'animation de lancement —
  // l'empilement au premier lancement était un motif de blocage App Review.
  const nativeSeqStarted = useRef(false);
  useEffect(() => {
    if (!isNative() || !pushReady || nativeSeqStarted.current) return;
    nativeSeqStarted.current = true;

    const off = onSplashGone(() => {
      (async () => {
        // L'accueil vient d'être révélé : petit temps de pose avant le
        // premier dialogue, pour qu'il ne surgisse pas pendant le paint.
        await new Promise((r) => setTimeout(r, 400));

        if (localStorage.getItem(PUSH_ANSWERED_KEY) !== 'true') {
          localStorage.setItem(PUSH_ANSWERED_KEY, 'true');
          try {
            await subscribe(); // résout quand l'utilisateur a répondu au dialogue
          } catch {
            // refus système : la réponse est enregistrée par iOS
          }
        }

        // Localisation APRÈS la réponse aux notifications — no-op si la
        // question a déjà été posée (iOS mémorise).
        await requestLocationIfUndecided();

        const langAnswered =
          localStorage.getItem(LANG_ANSWERED_KEY) === 'true' || deviceLanguage() !== null;
        if (!langAnswered) setStep('language');
      })();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushReady]);

  // Determine initial step on mount
  useEffect(() => {
    // Wait until push hook has finished initializing
    if (!pushReady) return;
    // App native : la séquence dédiée ci-dessus pilote tout (dialogues +
    // carte de langue) — le flux carte-par-carte reste le chemin web/PWA.
    if (isNative()) return;

    const pushAnswered = localStorage.getItem(PUSH_ANSWERED_KEY) === 'true';
    // La langue du téléphone vaut réponse : LanguageContext l'a déjà appliquée,
    // et redemander à quelqu'un ce que son appareil dit déjà est du bruit à
    // l'ouverture. L'écran ne subsiste que pour les langues que Yuno ne parle
    // pas (allemand, italien…) : là, l'anglais serait un défaut subi et non un
    // choix, donc on demande. Changement possible ensuite dans les Réglages.
    //
    // Mesuré sur device (iPhone, iOS 26.5, système en français, installs
    // neuves) : la WebView remonte 'fr' AVEC et SANS CFBundleLocalizations dans
    // le bundle. La clé n'est donc pas nécessaire à la détection, et un 'en'
    // détecté est un vrai anglophone, pas un repli — d'où l'absence de
    // traitement particulier ici.
    const langAnswered =
      localStorage.getItem(LANG_ANSWERED_KEY) === 'true' || deviceLanguage() !== null;

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
  }, [pushReady, isSupported, isSubscribed, permission, isiOS, isPWA, subscribe]);

  // Lock body scroll when a blocking modal is open
  useEffect(() => {
    if (step !== 'done') {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [step]);

  // Une fois push + langue réglés et l'user connecté, on propose le quiz de goût
  // (optionnel, une seule fois). Rendu à part, en plein écran éditorial.
  useEffect(() => {
    if (step !== 'done' || !tasteUserId) return;
    const pushAnswered = localStorage.getItem(PUSH_ANSWERED_KEY) === 'true';
    const langAnswered =
      localStorage.getItem(LANG_ANSWERED_KEY) === 'true' || deviceLanguage() !== null;
    const tasteAnswered = localStorage.getItem(TASTE_ANSWERED_KEY) === 'true';
    if (pushAnswered && langAnswered && !tasteAnswered) setStep('taste');
  }, [step, tasteUserId]);

  // Lancement à la demande depuis le bouton démo (DemoSwitcher). Re-fetch le user
  // courant : après une bascule de compte démo, l'id de mount serait périmé.
  useEffect(() => {
    const onLaunch = async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id ?? null;
      setTasteUserId(uid);
      if (uid) setStep('taste');
    };
    window.addEventListener(LAUNCH_TASTE_QUIZ_EVENT, onLaunch);
    return () => window.removeEventListener(LAUNCH_TASTE_QUIZ_EVENT, onLaunch);
  }, []);

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

  if (step === 'taste' && tasteUserId) {
    return (
      <AnimatePresence>
        <OnboardingTasteQuiz
          userId={tasteUserId}
          onDone={() => {
            localStorage.setItem(TASTE_ANSWERED_KEY, 'true');
            setStep('done');
          }}
        />
      </AnimatePresence>
    );
  }

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
