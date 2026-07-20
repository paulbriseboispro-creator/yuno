import { useCallback, useSyncExternalStore } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { User, Session } from '@supabase/supabase-js';
import { Role } from '@/types';
import { clearStaffSession } from '@/components/RequireStaffSession';
import { clearMFASession } from '@/components/RequireMFA';

/**
 * État d'authentification PARTAGÉ par toute l'app. `useAuth()` est appelé depuis
 * ~130 composants : un état par composant voudrait dire autant d'abonnements
 * `onAuthStateChange` (chacun prend le verrou de session de auth-js) et autant de
 * requêtes `user_roles` identiques à chaque événement. Un seul magasin en
 * module : un abonnement, une lecture des rôles, une seule vérité.
 *
 * Effet de bord bienvenu : un composant monté tardivement voit tout de suite
 * `loading: false` au lieu de repartir d'un `true` et d'afficher un spinner
 * fantôme le temps de reconverger.
 */

type AuthSnapshot = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  roles: Role[];
};

const EMPTY_ROLES: Role[] = [];

let snapshot: AuthSnapshot = { user: null, session: null, loading: true, roles: EMPTY_ROLES };

const listeners = new Set<() => void>();

function emit(patch: Partial<AuthSnapshot>) {
  const next: AuthSnapshot = { ...snapshot, ...patch };
  if (
    next.user === snapshot.user &&
    next.session === snapshot.session &&
    next.loading === snapshot.loading &&
    next.roles === snapshot.roles
  ) {
    return; // rien n'a bougé : pas de re-render inutile sur 130 composants
  }
  snapshot = next;
  listeners.forEach((l) => l());
}

/**
 * Filet de sécurité de démarrage. auth-js peut, sur un réseau capricieux, ne
 * jamais émettre `INITIAL_SESSION` ; sans ce délai, `loading` resterait à `true`
 * et l'app tournerait indéfiniment sur son spinner. On préfère rendre la main
 * (quitte à passer brièvement pour déconnecté, ce que l'écouteur corrigera dès
 * que la session arrive) plutôt que de bloquer l'utilisateur devant un écran mort.
 */
const BOOT_WATCHDOG_MS = 8_000;
/** Au déclenchement du filet, on laisse encore ce délai à `getSession()`. */
const BOOT_LAST_CHANCE_MS = 4_000;

/** Rôles déjà chargés pour ce compte — évite de réinterroger à chaque événement. */
let rolesLoadedFor: string | null = null;

async function loadRoles(userId: string) {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);

    if (error) throw error;
    // Une réponse tardive ne doit pas écraser les rôles d'un AUTRE compte.
    if (snapshot.user?.id !== userId) return;
    emit({ roles: data?.map((r) => r.role as Role) ?? EMPTY_ROLES });
  } catch (error) {
    console.error('Error fetching roles:', error);
    if (snapshot.user?.id !== userId) return;
    emit({ roles: EMPTY_ROLES });
  }
}

let started = false;

function start() {
  if (started) return;
  started = true;

  // 1. L'écouteur D'ABORD : il capte la session initiale, les rafraîchissements
  //    de token et les connexions/déconnexions. Tous les événements portent
  //    l'état courant, il n'y a donc rien à filtrer.
  supabase.auth.onAuthStateChange((_event, newSession) => {
    const nextUser = newSession?.user ?? null;

    if (nextUser) {
      if (rolesLoadedFor !== nextUser.id) {
        rolesLoadedFor = nextUser.id;
        // Différé : appeler Supabase depuis le callback tient le verrou de session.
        setTimeout(() => { void loadRoles(nextUser.id); }, 0);
      }
      emit({ session: newSession, user: nextUser, loading: false });
    } else {
      rolesLoadedFor = null;
      emit({ session: null, user: null, roles: EMPTY_ROLES, loading: false });
    }
  });

  // 2. Filet de sécurité — voir BOOT_WATCHDOG_MS.
  setTimeout(() => {
    if (!snapshot.loading) return;

    let settled = false;
    const release = () => {
      if (settled) return;
      settled = true;
      emit({ loading: false });
    };

    // Dernière tentative de lecture, bornée : `getSession()` commence par
    // `await initializePromise`, qui est précisément ce qui peut traîner.
    const lastChance = setTimeout(release, BOOT_LAST_CHANCE_MS);

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (settled) return; // l'écouteur ou le délai a déjà tranché
        settled = true;
        const existing = data.session ?? null;
        const existingUser = existing?.user ?? null;
        if (existingUser && rolesLoadedFor !== existingUser.id) {
          rolesLoadedFor = existingUser.id;
          void loadRoles(existingUser.id);
        }
        emit({ session: existing, user: existingUser, loading: false });
      })
      .catch(release)
      .finally(() => clearTimeout(lastChance));
  }, BOOT_WATCHDOG_MS);
}

function subscribe(onChange: () => void) {
  start();
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

function getSnapshot() {
  return snapshot;
}

export function useAuth() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const signUp = useCallback(async (email: string, password: string) => {
    const redirectUrl = `${window.location.origin}/`;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectUrl },
    });
    return { error };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }, []);

  const signOut = useCallback(async () => {
    // Clear all persistent session markers
    clearStaffSession();
    clearMFASession();
    const { error } = await supabase.auth.signOut();
    rolesLoadedFor = null;
    emit({ roles: EMPTY_ROLES });
    return { error };
  }, []);

  const { roles } = state;
  const hasRole = useCallback((role: Role) => roles.includes(role), [roles]);

  return {
    user: state.user,
    session: state.session,
    loading: state.loading,
    roles,
    hasRole,
    signUp,
    signIn,
    signOut,
  };
}
