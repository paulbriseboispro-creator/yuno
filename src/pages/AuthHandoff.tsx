import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

/**
 * /auth/handoff — atterrissage du handoff de session app native → web.
 * L'app ouvre cette page (SafariVC) avec un token magiclink à usage unique
 * dans le FRAGMENT (#token_hash=…&redirect=…) : jamais envoyé au serveur,
 * jamais loggé. verifyOtp crée la session web puis on file vers la cible.
 * Token absent/expiré → page de login classique avec le redirect conservé.
 */
export default function AuthHandoff() {
  const navigate = useNavigate();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const params = new URLSearchParams(window.location.hash.slice(1));
    const tokenHash = params.get('token_hash');
    const redirect = params.get('redirect') || '/owner';
    // Purge le token de l'URL/historique immédiatement.
    window.history.replaceState(null, '', window.location.pathname);

    if (!tokenHash) {
      navigate(`/auth?redirect=${encodeURIComponent(redirect)}`, { replace: true });
      return;
    }

    supabase.auth
      .verifyOtp({ type: 'magiclink', token_hash: tokenHash })
      .then(({ error }) => {
        if (error) {
          navigate(`/auth?redirect=${encodeURIComponent(redirect)}`, { replace: true });
        } else {
          // Navigation pleine page : recharge proprement les guards de rôle.
          window.location.replace(redirect.startsWith('/') ? redirect : '/owner');
        }
      });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0A0A0A' }}>
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}
