import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { loadLocale, getLoadedLocale, type Language } from '../i18n/data';
import { isPreviewActive } from '@/contexts/PreviewModeContext';

export type { Language };

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const VALID_LANGS: Language[] = ['en', 'es', 'fr'];

function persistedLanguage(): Language {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('language') as Language | null;
    if (saved && VALID_LANGS.includes(saved)) return saved;
  }
  return 'en';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(persistedLanguage);

  // Dictionnaire actif + fallback EN. `strings === null` = premier chargement
  // en cours : on gate le render (le splash natif / fond #050505 couvre ~50 ms,
  // le chunk de langue est précaché par le SW sur web et bundlé via Capgo en natif).
  const [strings, setStrings] = useState<Record<string, string> | null>(() => getLoadedLocale(persistedLanguage()) ?? null);
  const [enStrings, setEnStrings] = useState<Record<string, string> | null>(() => getLoadedLocale('en') ?? null);

  // Charger le dictionnaire de la langue active (et suivre ses changements).
  useEffect(() => {
    let cancelled = false;
    loadLocale(language).then((dict) => {
      if (!cancelled) setStrings(dict);
    }).catch((e) => {
      console.error('[i18n] locale load failed:', e);
      // Réseau KO sur le premier chunk : tenter EN pour ne pas bloquer l'app.
      if (!cancelled && language !== 'en') {
        loadLocale('en').then((dict) => { if (!cancelled) setStrings(dict); }).catch(() => {});
      }
    });
    return () => { cancelled = true; };
  }, [language]);

  // Fallback EN chargé en tâche de fond quand la langue active n'est pas EN —
  // t() ne montre alors jamais une clé brute pour une trad manquante.
  useEffect(() => {
    if (language === 'en' || enStrings) return;
    const load = () => { loadLocale('en').then(setEnStrings).catch(() => {}); };
    if ('requestIdleCallback' in window) {
      const id = (window as Window & typeof globalThis).requestIdleCallback(load);
      return () => (window as Window & typeof globalThis).cancelIdleCallback(id);
    }
    const timer = setTimeout(load, 1500);
    return () => clearTimeout(timer);
  }, [language, enStrings]);

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
      // En aperçu preview : la langue vient du lien (localStorage), on n'écrase pas
      // avec la préférence du compte démo.
      if (isPreviewActive()) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('preferred_language')
          .eq('id', user.id)
          .single();

        if (profile?.preferred_language) {
          const dbLang = profile.preferred_language as Language;
          if (VALID_LANGS.includes(dbLang)) {
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

    // En aperçu preview : pas d'écriture du profil (compte démo partagé + lecture seule).
    if (isPreviewActive()) return;

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
    const value = strings?.[key] ?? enStrings?.[key] ?? getLoadedLocale('en')?.[key];
    if (value === undefined) {
      if (import.meta.env.DEV && strings) {
        console.warn(`[i18n] clé manquante "${key}" (langue: ${language})`);
      }
      return key;
    }
    return value;
  }, [strings, enStrings, language]);

  // Premier chargement : ne rien rendre tant que le dictionnaire actif n'est
  // pas là (évite un flash de clés brutes sur toute l'app).
  if (!strings) return null;

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    // Fallback for HMR / out-of-provider usage. Resolve real strings from the
    // already-loaded locale cache so a transient context mismatch (e.g. a lazy
    // route chunk reloading without the provider during HMR) never leaks raw
    // i18n keys to the UI. Falls back to English, then to the key itself.
    const fallbackLang = persistedLanguage();
    return {
      language: fallbackLang,
      setLanguage: () => {},
      t: (key: string) =>
        getLoadedLocale(fallbackLang)?.[key] ?? getLoadedLocale('en')?.[key] ?? key,
    } as LanguageContextType;
  }
  return context;
}
