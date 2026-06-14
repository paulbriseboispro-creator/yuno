import { useState, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

const PROMPT_KEY = 'yuno_push_prompt_shown';

export function PushNotificationPrompt() {
  const { t } = useLanguage();
  const { isSupported, isSubscribed, permission, subscribe } = usePushNotifications();
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Only show once, only if supported, not already subscribed, and not denied
    const alreadyShown = localStorage.getItem(PROMPT_KEY);
    if (!alreadyShown && isSupported && !isSubscribed && permission !== 'denied') {
      // Small delay so the app loads first
      const timer = setTimeout(() => setShow(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [isSupported, isSubscribed, permission]);

  const handleEnable = async () => {
    localStorage.setItem(PROMPT_KEY, 'true');
    setShow(false);
    try {
      await subscribe();
      toast.success(t('notifications.enabled'));
    } catch {
      toast.error(t('notifications.error'));
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(PROMPT_KEY, 'true');
    setShow(false);
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-end justify-center p-4"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 16px) + 80px)' }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleDismiss} />
          
          {/* Card */}
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="relative w-full max-w-sm rounded-3xl border border-border/30 p-6 text-center space-y-4"
            style={{ background: 'hsl(var(--card))' }}
          >
            {/* Bell icon with glow */}
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
              <Button onClick={handleEnable} className="w-full rounded-xl h-12 text-base font-semibold">
                {t('notifications.enable')}
              </Button>
              <Button variant="ghost" onClick={handleDismiss} className="w-full text-muted-foreground">
                {t('notifications.notNow')}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
