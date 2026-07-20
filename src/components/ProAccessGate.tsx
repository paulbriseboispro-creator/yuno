import { ReactNode, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShieldAlert } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { clearStaffSession } from '@/components/RequireStaffSession';
import { transitions } from '@/lib/motion';

/**
 * Routes qui restent joignables SANS rôle pro. `/accept-staff-invitation` est
 * critique : c'est précisément le chemin par lequel un compte client DEVIENT
 * staff — le fermer enfermerait dehors toute nouvelle recrue. `/auth` doit
 * évidemment rester ouvert, sinon plus personne ne peut se connecter.
 */
const OPEN_PREFIXES = ['/auth', '/accept-staff-invitation', '/legal', '/account-suspended'];

/**
 * Au-delà de ce délai, la vérification du rôle rend la main sans verdict. Le
 * client Supabase borne déjà ses requêtes, ce plafond couvre le reste (attente
 * du verrou de session, onglet réveillé de veille). Mieux vaut ouvrir — les
 * gardes de route en aval refusent de toute façon l'accès aux dashboards — que
 * laisser le staff devant un spinner sans fin en pleine soirée.
 */
const ROLE_CHECK_TIMEOUT_MS = 10_000;

function matches(pathname: string, prefixes: string[]): boolean {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return prefixes.some((p) => clean === p || clean.startsWith(p + '/'));
}

/**
 * L'app Yuno Pro est réservée aux comptes qui ont un rôle pro. Tout le monde a
 * le rôle `client` (c'est le rôle par défaut d'un compte Yuno) : « avoir un rôle
 * pro » veut donc dire avoir AU MOINS un rôle autre que `client`.
 *
 * Un compte purement client qui se connecte ici est refusé ET déconnecté, avec
 * un message explicite — plutôt que de le laisser entrer sur une coquille vide
 * dont aucun bouton ne mène nulle part.
 *
 * Ne s'applique que dans l'app Pro : ProAppGate ne monte ce garde qu'après son
 * propre test `isProApp()`.
 */
export function ProAccessGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const [status, setStatus] = useState<'checking' | 'ok' | 'refused'>('checking');
  // Le compte pour lequel la décision est déjà PRISE, et laquelle. On mémorise
  // le verdict, pas l'intention : un rafraîchissement de token en cours de
  // vérification recrée l'objet `user` (même id), relance cet effet et annule la
  // lecture au vol. Marquer le compte AVANT d'avoir décidé ferait alors
  // court-circuiter la relance, et l'app resterait sur 'checking' à jamais.
  const decidedFor = useRef<string | null>(null);
  const decision = useRef<'ok' | 'refused'>('ok');
  // Le refus survit à la déconnexion qu'il provoque : sans ça, `user` repasse à
  // null juste après le signOut et l'écran de refus disparaîtrait aussitôt.
  const refusedRef = useRef(false);

  const onOpenRoute = matches(location.pathname, OPEN_PREFIXES);

  useEffect(() => {
    if (onOpenRoute) return;
    if (loading) return;

    if (!user) {
      if (!refusedRef.current) setStatus('ok'); // pas de session → /auth fera le travail
      return;
    }
    // Verdict déjà rendu pour ce compte : on le réapplique sans réinterroger.
    if (decidedFor.current === user.id) {
      setStatus(decision.current);
      return;
    }
    setStatus('checking');

    let active = true;

    const decide = (verdict: 'ok' | 'refused') => {
      decidedFor.current = user.id;
      decision.current = verdict;
      setStatus(verdict);
    };

    // Aucune lecture ne doit pouvoir laisser l'app sur son spinner : passé ce
    // délai on ouvre la porte, comme pour une lecture ratée ci-dessous. Le
    // verdict n'est pas mémorisé — la prochaine occasion retentera la lecture.
    const failOpen = setTimeout(() => {
      if (active) setStatus('ok');
    }, ROLE_CHECK_TIMEOUT_MS);

    (async () => {
      // Toute la lecture est gardée : une exception (réseau coupé net, requête
      // annulée) laisserait sinon `status` sur 'checking' — soit un spinner
      // définitif, exactement le symptôme qu'on cherche à éliminer.
      try {
        const { data, error } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .neq('role', 'client')
          .limit(1);

        if (!active) return;

        // Lecture ratée (réseau du club, RLS) : on laisse passer. Les gardes de
        // route en aval refuseront de toute façon l'accès aux dashboards — on ne
        // déconnecte personne sur un simple échec de lecture.
        if (error) {
          setStatus('ok'); // échec transitoire : on ne fige pas le verdict
          return;
        }

        if (data && data.length > 0) {
          decide('ok');
          return;
        }

        refusedRef.current = true;
        decide('refused');
        clearStaffSession();
        void supabase.auth.signOut();
      } catch {
        if (active) setStatus('ok');
      } finally {
        clearTimeout(failOpen);
      }
    })();

    return () => { active = false; clearTimeout(failOpen); };
  }, [user, loading, onOpenRoute]);

  const handleBackToLogin = () => {
    refusedRef.current = false;
    decidedFor.current = null;
    setStatus('ok');
    navigate('/auth', { replace: true });
  };

  if (onOpenRoute) return <>{children}</>;

  if (status === 'refused') {
    // Écran plein écran de l'app Pro : aucun chrome global dans l.app Pro, l'encoche et
    // la barre d'accueil sont à notre charge.
    return (
      <div
        className="min-h-[100dvh] flex items-center justify-center px-6"
        style={{
          background: '#050505',
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={transitions.modal}
          className="w-full max-w-sm text-center"
        >
          <div className="mx-auto mb-6 flex h-14 w-14 flex-none items-center justify-center rounded-2xl bg-white/5 border border-white/10">
            <ShieldAlert className="h-6 w-6 text-white/70" />
          </div>
          <h1 className="text-xl font-bold text-white mb-3 break-words">{t('proapp.noAccessTitle')}</h1>
          <p className="text-sm text-white/60 leading-relaxed mb-8 break-words">{t('proapp.noAccessBody')}</p>
          <button
            onClick={handleBackToLogin}
            className="w-full min-h-[44px] rounded-xl bg-white text-black font-semibold text-sm py-3.5 active:opacity-80 transition-opacity"
          >
            {t('proapp.noAccessCta')}
          </button>
        </motion.div>
      </div>
    );
  }

  if (loading || status === 'checking') {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center" style={{ background: '#050505' }}>
        <div
          className="h-8 w-8 animate-spin rounded-full border-2"
          style={{ borderColor: 'rgba(255,255,255,0.085) rgba(255,255,255,0.085) rgba(255,255,255,0.085) #E8192C' }}
        />
      </div>
    );
  }

  return <>{children}</>;
}
