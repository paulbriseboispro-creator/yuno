import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { ShieldAlert } from 'lucide-react';

export default function AccountSuspended() {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  return (
    // Page plein écran de l'app Pro : aucun chrome global dans l.app Pro, encoche et
    // barre d'accueil à notre charge.
    <div
      className="min-h-[100dvh] flex items-center justify-center px-6"
      style={{
        background: '#000',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
      }}
    >
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 flex-none items-center justify-center rounded-2xl"
          style={{ background: 'rgba(255,92,99,0.1)', border: '1px solid rgba(255,92,99,0.3)' }}>
          <ShieldAlert className="h-8 w-8" style={{ color: '#FF5C63' }} />
        </div>
        <h1 className="text-2xl font-bold tracking-tight break-words" style={{ color: 'rgba(255,255,255,0.96)' }}>
          Compte suspendu
        </h1>
        {/* `support@yunoapp.eu` est un mot insécable : sans break-words il pousse
            la colonne hors de l'écran sur un petit téléphone. */}
        <p className="mt-3 text-sm leading-relaxed break-words" style={{ color: 'rgba(255,255,255,0.58)' }}>
          L'accès à votre compte a été suspendu par l'administration de Yuno. Si vous
          pensez qu'il s'agit d'une erreur, contactez le support à{' '}
          <a href="mailto:support@yunoapp.eu" style={{ color: '#E8192C', fontWeight: 600 }}>support@yunoapp.eu</a>.
        </p>
        <button
          onClick={handleSignOut}
          className="mt-8 inline-flex min-h-[44px] items-center justify-center rounded-xl px-5 py-3 cursor-pointer transition-all"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.085)', color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: 560 }}
        >
          Se déconnecter
        </button>
      </div>
    </div>
  );
}
