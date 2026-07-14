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
  // Le compte pour lequel la décision est déjà prise (évite de re-interroger la
  // base à chaque navigation).
  const checkedFor = useRef<string | null>(null);
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
    if (checkedFor.current === user.id) return;
    checkedFor.current = user.id;
    setStatus('checking');

    let active = true;
    (async () => {
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
        setStatus('ok');
        return;
      }

      if (data && data.length > 0) {
        setStatus('ok');
        return;
      }

      refusedRef.current = true;
      setStatus('refused');
      clearStaffSession();
      void supabase.auth.signOut();
    })();

    return () => { active = false; };
  }, [user, loading, onOpenRoute]);

  const handleBackToLogin = () => {
    refusedRef.current = false;
    checkedFor.current = null;
    setStatus('ok');
    navigate('/auth', { replace: true });
  };

  if (onOpenRoute) return <>{children}</>;

  if (status === 'refused') {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#050505' }}>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={transitions.modal}
          className="w-full max-w-sm text-center"
        >
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 border border-white/10">
            <ShieldAlert className="h-6 w-6 text-white/70" />
          </div>
          <h1 className="text-xl font-bold text-white mb-3">{t('proapp.noAccessTitle')}</h1>
          <p className="text-sm text-white/60 leading-relaxed mb-8">{t('proapp.noAccessBody')}</p>
          <button
            onClick={handleBackToLogin}
            className="w-full rounded-xl bg-white text-black font-semibold text-sm py-3.5 active:opacity-80 transition-opacity"
          >
            {t('proapp.noAccessCta')}
          </button>
        </motion.div>
      </div>
    );
  }

  if (loading || status === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#050505' }}>
        <div
          className="h-8 w-8 animate-spin rounded-full border-2"
          style={{ borderColor: 'rgba(255,255,255,0.085) rgba(255,255,255,0.085) rgba(255,255,255,0.085) #E8192C' }}
        />
      </div>
    );
  }

  return <>{children}</>;
}
