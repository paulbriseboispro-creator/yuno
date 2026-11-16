/**
 * Porte de l'admin : super admin ET 2FA (même règle que l'ex-Admin CRM, plus
 * l'enrôlement exigé : un super admin sans 2FA ni exemption part sur
 * /mfa-setup). Toute porte réelle reste serveur (`is_super_admin()` dans
 * chaque RPC) ; ceci n'évite que d'afficher un écran vide.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ADMIN_LOGIN } from '../nav';
import { checkAdminAccess } from './mfa';
import { PageLoading } from './AdminShell';

export function AdminGuard({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [ok, setOk] = useState(false);
  // La garde ne se joue qu'à l'arrivée dans l'admin, pas à chaque page.
  const entry = useRef(pathname + search);

  useEffect(() => {
    let off = false;
    (async () => {
      const next = encodeURIComponent(entry.current);
      try {
        const access = await checkAdminAccess();
        if (off) return;
        if (access === 'ok') { setOk(true); return; }
        if (access === 'denied') { navigate('/', { replace: true }); return; }
        if (access === 'enroll') { navigate('/mfa-setup', { replace: true }); return; }
        navigate(`${ADMIN_LOGIN}?next=${next}${access === 'code' ? '&step=code' : ''}`, { replace: true });
      } catch {
        if (!off) navigate(`${ADMIN_LOGIN}?next=${next}`, { replace: true });
      }
    })();
    return () => { off = true; };
  }, [navigate]);

  if (!ok) return <PageLoading />;
  return <>{children}</>;
}
