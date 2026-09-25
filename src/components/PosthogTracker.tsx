import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { identifyPosthogUser, initPosthog } from '@/lib/posthog';

/**
 * PostHog (web + apps natives) : chargement après consentement analytics et
 * identité = compte connecté. Les pages vues sont captées par PostHog lui-même
 * (`capture_pageview: 'history_change'`). Voir src/lib/posthog.ts. Ne rend rien.
 */
export default function PosthogTracker() {
  const { user, loading } = useAuth();

  useEffect(() => {
    initPosthog();
  }, []);

  useEffect(() => {
    if (loading) return;
    identifyPosthogUser(user?.id ?? null);
  }, [user?.id, loading]);

  return null;
}
