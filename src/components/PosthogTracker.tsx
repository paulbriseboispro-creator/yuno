import { useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { capturePosthog, identifyPosthogUser, initPosthog, trackAppLifecycle } from '@/lib/posthog';

/**
 * PostHog (web + apps natives) : chargement après consentement analytics et
 * identité = compte connecté. Les pages vues sont captées par PostHog lui-même
 * (`capture_pageview: 'history_change'`). Voir src/lib/posthog.ts. Ne rend rien.
 */
export default function PosthogTracker() {
  const { user, roles, loading } = useAuth();
  // `undefined` = état initial pas encore résolu : une session restaurée au
  // chargement n'est pas une connexion.
  const previousUserId = useRef<string | null | undefined>(undefined);
  const rolesKey = [...roles].sort().join(',');

  useEffect(() => {
    initPosthog();
    trackAppLifecycle();
  }, []);

  useEffect(() => {
    if (loading) return;
    const id = user?.id ?? null;
    identifyPosthogUser(
      user ? { id: user.id, createdAt: user.created_at, roles, email: user.email } : null,
    );
    if (previousUserId.current === null && id) {
      capturePosthog('user_signed_in', { provider: user?.app_metadata?.provider ?? null });
    }
    previousUserId.current = id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, rolesKey, loading]);

  return null;
}
