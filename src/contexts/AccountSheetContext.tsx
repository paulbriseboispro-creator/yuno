/**
 * Porte unique des clics réservés aux comptes, côté client.
 *
 *   const { requireAccount } = useAccountSheet();
 *   if (!user) { requireAccount({ kind: 'follow_organizer', organizerUserId }); return; }
 *
 * La fenêtre (`AccountSheet`) monte du bas par-dessus la page, la personne crée
 * son compte ou se connecte, puis l'action se fait toute seule. Au retour d'un
 * aller-retour Apple / Google (web), l'action est relue depuis localStorage et
 * rejouée dès que la session arrive.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useFavoritesContext } from '@/contexts/FavoritesContext';
import { AccountSheet } from '@/components/account/AccountSheet';
import {
  announceIntentDone, clearIntent, intentLabel, intentVerb, peekIntent, resolveIntentDisplay,
  runIntent, storeIntent, type AccountIntent,
} from '@/lib/accountIntent';
import { capturePosthog } from '@/lib/posthog';
import { haptics } from '@/lib/haptics';

interface AccountSheetContextValue {
  /** Ouvre la fenêtre de compte pour cette action. */
  requireAccount: (intent: AccountIntent) => void;
}

const AccountSheetContext = createContext<AccountSheetContextValue | null>(null);

export function AccountSheetProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const { refetch: refetchFavorites } = useFavoritesContext();
  const [intent, setIntent] = useState<AccountIntent | null>(null);
  const [open, setOpen] = useState(false);
  /** Une seule exécution à la fois, même si plusieurs événements d'auth arrivent. */
  const running = useRef(false);
  /** La fenêtre gère elle-même la fin quand elle est ouverte (écran « c'est fait »). */
  const sheetOpen = useRef(false);
  sheetOpen.current = open;

  const requireAccount = useCallback((next: AccountIntent) => {
    storeIntent(next);
    setIntent(next);
    setOpen(true);
    haptics.light();
    capturePosthog('account_sheet_opened', { intent: intentLabel(next) });
  }, []);

  /** Rejoue l'action pour la personne connectée. Rend true quand elle est faite. */
  const complete = useCallback(async (userId: string, target: AccountIntent): Promise<boolean> => {
    if (running.current) return false;
    running.current = true;
    try {
      clearIntent();
      const ok = await runIntent(target, userId);
      if (ok) {
        if (target.kind === 'favorite') void refetchFavorites();
        announceIntentDone(target);
      }
      return ok;
    } finally {
      running.current = false;
    }
  }, [refetchFavorites]);

  // Retour d'Apple / Google sur le web : la page s'est rechargée, la fenêtre
  // n'est plus là. L'action en attente se fait dès que la session est connue.
  useEffect(() => {
    const replay = async (userId: string) => {
      if (sheetOpen.current) return;
      const pending = peekIntent();
      if (!pending) return;
      const ok = await complete(userId, pending);
      const verb = intentVerb(pending);
      if (ok) {
        const { name } = await resolveIntentDisplay(pending);
        toast.success(
          t(`acct.done.${verb}`).replace('{name}', name ?? t(`acct.fallback.${verb}`)),
          { description: t(`acct.doneDesc.${verb}`) },
        );
        capturePosthog('account_sheet_completed', { intent: intentLabel(pending), method: 'oauth_return' });
      } else {
        toast.error(t('acct.err.replay'));
      }
    };
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) void replay(data.session.user.id);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) void replay(session.user.id);
    });
    return () => subscription.unsubscribe();
  }, [complete, t]);

  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    // Fermée sans compte : l'action est abandonnée, elle ne doit pas se faire
    // en douce le jour où la personne se connecte pour autre chose.
    if (!next) clearIntent();
  }, []);

  return (
    <AccountSheetContext.Provider value={{ requireAccount }}>
      {children}
      <AccountSheet
        open={open}
        intent={intent}
        onOpenChange={onOpenChange}
        onAuthenticated={complete}
      />
    </AccountSheetContext.Provider>
  );
}

export function useAccountSheet(): AccountSheetContextValue {
  const ctx = useContext(AccountSheetContext);
  if (!ctx) throw new Error('useAccountSheet must be used within AccountSheetProvider');
  return ctx;
}
