import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { translations } from '../i18n/data';

export type Language = 'en' | 'es' | 'fr';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('language');
      return (saved as Language) || 'en';
    }
    return 'en';
  });

  const [strings, setStrings] = useState<Record<string, string>>(translations['en'] || {});

  // Load translations for the current language
  useEffect(() => {
    setStrings(translations[language] || {});
  }, [language]);

  // Keep the document language in sync so screen readers and SEO crawlers
  // see the actual content language (the static index.html ships lang="en").
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language;
    }
  }, [language]);

  // Sync language preference from database on mount
  useEffect(() => {
    const syncLanguageFromProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('preferred_language')
          .eq('id', user.id)
          .single();
        
        if (profile?.preferred_language) {
          const dbLang = profile.preferred_language as Language;
          if (['en', 'es', 'fr'].includes(dbLang)) {
            setLanguageState(dbLang);
            localStorage.setItem('language', dbLang);
            // Mark language as already chosen so OnboardingGate won't re-ask
            localStorage.setItem('onboarding_language_answered', 'true');
            localStorage.setItem('languageSelected', 'true');
          }
        }
      }
    };

    syncLanguageFromProfile();
  }, []);

  const setLanguage = useCallback(async (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('language', lang);
    
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from('profiles')
        .update({ preferred_language: lang } as any)
        .eq('id', user.id);
    }
  }, []);

  const t = useCallback((key: string): string => {
    // Resolve in the active language first, then fall back to English so a
    // missing translation never leaks a raw key (e.g. "owner.crm.addBlocks")
    // into the UI. The raw key is only ever shown as a last resort.
    const value = strings[key] ?? translations['en']?.[key];
    if (value === undefined) {
      if (import.meta.env.DEV) {
        console.warn(`[i18n] clé manquante "${key}" (langue: ${language})`);
      }
      return key;
    }
    return value;
  }, [strings, language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    // Fallback for HMR / out-of-provider usage. Still resolve real strings from
    // the static translations so a transient context mismatch (e.g. a lazy route
    // chunk reloading without the provider during HMR) never leaks raw i18n keys
    // to the UI. Falls back to English, then to the key itself as a last resort.
    const fallbackLang = (localStorage.getItem('language') as Language) || 'en';
    return {
      language: fallbackLang,
      setLanguage: () => {},
      t: (key: string) =>
        translations[fallbackLang]?.[key] ?? translations['en']?.[key] ?? key,
    } as LanguageContextType;
  }
  return context;
}
