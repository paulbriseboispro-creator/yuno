import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { onCrmHost } from '@/lib/productHost';
import { CARRIED_PICKS } from '@/lib/productHandoff';

/**
 * /auth/handoff — atterrissage d'un handoff de session vers le web.
 *
 * Deux émetteurs, tout dans le FRAGMENT (jamais envoyé au serveur, jamais
 * loggé, purgé de l'historique à la première ligne) :
 *  - l'app native (SafariVC) : `#token_hash=…&redirect=…` → verifyOtp ;
 *  - l'inscription pro de la landing (landing.yunoapp.eu/start, autre
 *    origine donc autre localStorage) : `#yuno_at=…&yuno_rt=…&redirect=…&lang=…`
 *    → setSession. Noms volontairement ≠ `access_token` : le client Supabase
 *    (detectSessionInUrl) avalerait sinon le fragment avant nous ;
 *  - le passage Billetterie ⇄ CRM (yunoapp.eu ⇄ crm.yunoapp.eu, voir
 *    src/lib/productHandoff.ts) : `#token_hash=…&redirect=…&uid=…&lang=…` →
 *    verifyOtp, sauf si cet onglet est déjà connecté sous ce compte (`uid`).
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
    // Sur crm.yunoapp.eu, la maison est la Console CRM.
    const home = onCrmHost() ? '/crm' : '/owner';
    const rawRedirect = params.get('redirect') || home;
    const redirect = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : home;
    const lang = params.get('lang');
    const uid = params.get('uid');
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

    // Passage d'un produit à l'autre : la langue suit, et un pro n'a rien à
    // faire des étapes d'accueil client (langue, quiz, push web).
    if (lang === 'fr' || lang === 'en' || lang === 'es') {
      try {
        localStorage.setItem('language', lang);
        localStorage.setItem('languageSelected', 'true');
        localStorage.setItem('onboarding_language_answered', 'true');
        localStorage.setItem('onboarding_taste_answered', 'true');
        localStorage.setItem('onboarding_push_answered', 'true');
      } catch { /* stockage indisponible : sans conséquence */ }
    }
    // Le compte choisi de l'autre côté (espace CRM, organisation servie) suit.
    for (const [param, key] of Object.entries(CARRIED_PICKS)) {
      const v = params.get(param);
      if (!v || v.length > 200) continue;
      try { localStorage.setItem(key, v); } catch { /* espace par défaut */ }
    }

    const exchange = () => supabase.auth
      .verifyOtp({ type: 'magiclink', token_hash: tokenHash })
      .then(({ error }) => {
        if (error) {
          toLogin();
        } else {
          // Navigation pleine page : recharge proprement les guards de rôle.
          window.location.replace(redirect);
        }
      });

    // Déjà connecté ici sous le même compte : on garde CETTE session (le jeton
    // à usage unique expire seul), plutôt que d'en ouvrir une de plus.
    if (uid) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user.id === uid) window.location.replace(redirect);
        else void exchange();
      });
      return;
    }
    void exchange();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: onCrmHost() ? '#FCFAF9' : '#0A0A0A' }}>
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}
