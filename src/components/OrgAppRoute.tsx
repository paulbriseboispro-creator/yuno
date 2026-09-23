import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useActingOrganizer, type OrgCapabilities } from '@/hooks/useActingOrganizer';

interface OrgAppRouteProps {
  children: React.ReactNode;
  /**
   * Ce que la page exige. Une page sans exigence est ouverte à toute personne
   * qui a accès à l'organisation — y compris un scanner, qui n'y voit alors
   * que ce que la base lui laisse voir.
   */
  requires?: keyof OrgCapabilities;
}

/**
 * Garde de la Console organisateur.
 *
 * Y entrent : le fondateur de l'organisation (`profile_type = 'organizer'`) ET
 * les membres de son équipe qui ont accepté leur invitation (admin, editor,
 * scanner). Avant, la garde ne regardait que `profile_type` : un membre
 * accepté — dont le profil reste celui d'une personne ordinaire — était
 * renvoyé sur l'accueil, et l'invitation ne servait à rien.
 *
 * La privacy d'une soirée (publique vs privée) se décide à sa création via
 * `events.event_kind`, pas au niveau du profil.
 */
export function OrgAppRoute({ children, requires }: OrgAppRouteProps) {
  const { user, loading: authLoading } = useAuth();
  const acting = useActingOrganizer();
  const location = useLocation();

  if (authLoading || acting.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace state={{ from: location }} />;
  }

  // Ni fondateur, ni membre d'équipe : clubs et clients n'ont rien à faire ici.
  if (!acting.organizerId) {
    return <Navigate to="/" replace />;
  }

  // Une page qui dépasse le rôle renvoie sur le tableau de bord, jamais sur un
  // écran vide ni sur un refus serveur.
  if (requires && !acting.can[requires]) {
    return <Navigate to="/organizer-app" replace />;
  }

  return <>{children}</>;
}
