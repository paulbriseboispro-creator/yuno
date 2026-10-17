import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEventRoute } from '@/hooks/useEventRoute';
import { EventWaitlistSkeleton } from '@/components/skeletons/EventWaitlistSkeleton';

/**
 * Ancienne page « liste privée » : l'inscription vit désormais dans une fenêtre
 * sur la page soirée (`WaitlistSheet`). Cette route ne sert plus qu'aux liens
 * déjà envoyés (e-mails, partages, favoris) : elle renvoie sur la soirée avec
 * `?waitlist=1`, qui ouvre la fenêtre.
 */
export default function EventWaitlistPage() {
  const { basePath, resolving } = useEventRoute();
  const navigate = useNavigate();

  useEffect(() => {
    if (!resolving && basePath) navigate(`${basePath}?waitlist=1`, { replace: true });
  }, [resolving, basePath, navigate]);

  return <EventWaitlistSkeleton />;
}
