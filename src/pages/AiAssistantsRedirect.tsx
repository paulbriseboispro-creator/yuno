import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useUserRoles } from '@/hooks/useUserRoles';

/**
 * /ai-assistants — envoie la personne sur la page « Assistants IA » de SA
 * Console (lien de la page publique /ai, des emails, de l'aide). Club → Console
 * Club, manager → Console Manager, sinon Console Organisateur (un
 * organisateur n'a pas de rôle `user_roles` : sa garde décide).
 */
export default function AiAssistantsRedirect() {
  const { roles, loading } = useUserRoles();
  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  const target = roles.includes('owner') ? '/owner/ai-assistants'
    : roles.includes('manager') ? '/manager/ai-assistants'
    : '/organizer-app/ai-assistants';
  return <Navigate to={target} replace />;
}
