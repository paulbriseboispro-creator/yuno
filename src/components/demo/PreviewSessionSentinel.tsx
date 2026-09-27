// Ré-arme la bannière « lecture seule » dans un onglet qui ne la porte pas.
//
// Le drapeau d'aperçu vit dans le sessionStorage de l'onglet où le prospect a
// ouvert son lien, alors que la session Supabase vit dans le localStorage,
// partagé par tous les onglets : un lien ouvert dans un nouvel onglet arrivait
// connecté au compte démo, sans bannière ni intercepteur. Le serveur refuse
// déjà toute écriture de cette session (migration 20260927160000) ; ce
// composant ne fait que rendre ce refus lisible — bannière, toasts, boutons
// d'écriture court-circuités — en demandant au serveur si la session courante
// est une session d'aperçu.
//
// Ne s'exécute que pour un compte démo (email @womber.fr ou vitrine) : les
// vrais comptes ne font aucun appel.

import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { enablePreviewMode, isPreviewActive } from '@/contexts/PreviewModeContext';
import { DEMO_ACCOUNTS, type TargetAccount } from '@/lib/demoSession';

const isDemoLikeEmail = (email: string) =>
  email.endsWith('@womber.fr') || (email.startsWith('vitrine+') && email.endsWith('@yunoapp.eu'));

export function PreviewSessionSentinel() {
  useEffect(() => {
    let cancelled = false;

    const check = async (email: string | undefined | null) => {
      const e = String(email ?? '').toLowerCase();
      if (!e || !isDemoLikeEmail(e) || isPreviewActive()) return;
      const { data, error } = await supabase.rpc('is_demo_preview_session' as never);
      if (cancelled || error || data !== true || isPreviewActive()) return;

      const account = (Object.keys(DEMO_ACCOUNTS) as TargetAccount[])
        .find((k) => DEMO_ACCOUNTS[k].email === e);
      enablePreviewMode({
        label: '',
        roles: account ? [account] : [],
        current: account ?? '',
        kind: account ? 'demo' : 'showcase',
        language: (() => {
          try { return localStorage.getItem('language') ?? 'en'; } catch { return 'en'; }
        })(),
      });
    };

    supabase.auth.getSession().then(({ data }) => check(data.session?.user?.email));
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      check(session?.user?.email);
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  return null;
}
