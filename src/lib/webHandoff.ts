import { supabase } from '@/integrations/supabase/client';
import { openExternal } from '@/lib/native';

const WEB_BASE_URL = import.meta.env.VITE_APP_BASE_URL || 'https://yunoapp.eu';

/**
 * Ouvre une surface pro sur le web EN GARDANT la session : l'app demande un
 * token magiclink à usage unique (edge `mfa`, action web-handoff) et ouvre
 * /auth/handoff#token_hash=…&redirect=… — le web crée sa propre session sans
 * toucher celle de l'app (aucune rotation de refresh token). Sans session ou
 * si le mint échoue, on retombe sur l'ouverture simple (login classique).
 */
export async function openOnWebWithSession(path: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const { data } = await supabase.functions.invoke('mfa', {
        body: { action: 'web-handoff' },
      });
      if (data?.token_hash) {
        const url =
          `${WEB_BASE_URL}/auth/handoff` +
          `#token_hash=${encodeURIComponent(data.token_hash)}` +
          `&redirect=${encodeURIComponent(path)}`;
        openExternal(url);
        return;
      }
    }
  } catch {
    // Mint impossible (offline, fonction pas déployée…) → ouverture simple.
  }
  openExternal(WEB_BASE_URL + path);
}
