import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

/**
 * /auth/handoff — atterrissage d'un handoff de session vers le web.
 *
 * Deux émetteurs, tout dans le FRAGMENT (jamais envoyé au serveur, jamais
 * loggé, purgé de l'historique à la première ligne) :
 *  - l'app native (SafariVC) : `#token_hash=…&redirect=…` → verifyOtp ;
 *  - l'inscription pro de la landing (landing.yunoapp.eu/start, autre
 *    origine donc autre localStorage) : `#yuno_at=…&yuno_rt=…&redirect=…&lang=…`
 *    → setSession. Noms volontairement ≠ `access_token` : le client Supabase
 *    (detectSessionInUrl) avalerait sinon le fragment avant nous.
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
    const accessToken = params.get('yuno_at');
    const refreshToken = params.get('yuno_rt');
    const rawRedirect = params.get('redirect') || '/owner';
    const redirect = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/owner';
    const lang = params.get('lang');
    // Purge le token de l'URL/historique immédiatement.
    window.history.replaceState(null, '', window.location.pathname);

    const toLogin = () => navigate(`/auth?redirect=${encodeURIComponent(redirect)}`, { replace: true });

    if (accessToken && refreshToken) {
      // Nouveau compte pro : la langue choisie sur la landing devient celle de
      // l'appareil (LanguageContext l'écrit ensuite dans le profil), et les
      // étapes d'accueil CLIENT (quiz de goûts, langue, push web) ne doivent
      // pas recouvrir sa Console — OnboardingGate teste la chaîne 'true'.
      try {
        if (lang === 'fr' || lang === 'en' || lang === 'es') localStorage.setItem('language', lang);
        localStorage.setItem('languageSelected', 'true');
        localStorage.setItem('onboarding_language_answered', 'true');
        localStorage.setItem('onboarding_taste_answered', 'true');
        localStorage.setItem('onboarding_push_answered', 'true');
      } catch { /* stockage indisponible : sans conséquence */ }

      supabase.auth
        .setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ error }) => {
          if (error) toLogin();
          else window.location.replace(redirect);
        });
      return;
    }

    if (!tokenHash) {
      toLogin();
      return;
    }

    supabase.auth
      .verifyOtp({ type: 'magiclink', token_hash: tokenHash })
      .then(({ error }) => {
        if (error) {
          toLogin();
        } else {
          // Navigation pleine page : recharge proprement les guards de rôle.
          window.location.replace(redirect);
        }
      });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0A0A0A' }}>
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}
