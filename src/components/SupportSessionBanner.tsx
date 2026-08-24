// Bannière persistante affichée pendant une session d'assistance Yuno.
//
// Deux raisons d'exister, et la seconde compte autant que la première :
//  1. L'admin ne doit jamais oublier qu'il agit DANS le compte d'un client —
//     chaque écriture est journalisée à son nom, sous les yeux du client.
//  2. Si le pro regarde l'écran par-dessus l'épaule (ou prend une capture),
//     il voit noir sur blanc que c'est un accès encadré, pas une intrusion.
//
// Pas de barre en haut : le pro travaille sur mobile, la barre du bas est la
// zone la moins précieuse (même emplacement que la bannière d'aperçu).

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LifeBuoy, LogOut, Loader2 } from 'lucide-react';
import { getSupportSession, endSupportSession, type SupportSessionState } from '@/lib/supportSession';

const AMBER = '#F5A524';

function remainingLabel(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expirée';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')}`;
}

export function SupportSessionBanner() {
  const navigate = useNavigate();
  const [session, setSession] = useState<SupportSessionState | null>(() => getSupportSession());
  const [leaving, setLeaving] = useState(false);
  const [, force] = useState(0);

  // Re-lecture périodique : rafraîchit le compte à rebours et fait disparaître
  // la bannière dès que la session expire.
  useEffect(() => {
    const id = setInterval(() => {
      setSession(getSupportSession());
      force((n) => n + 1);
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  if (!session) return null;

  const quit = async () => {
    if (leaving) return;
    setLeaving(true);
    await endSupportSession();
    setSession(null);
    navigate('/auth', { replace: true });
  };

  return (
    <div
      className="fixed left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-2 text-white shadow-lg"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)',
        background: 'rgba(10,10,12,0.94)',
        border: `1px solid ${AMBER}55`,
        backdropFilter: 'blur(12px)',
        boxShadow: `0 10px 40px -12px ${AMBER}55`,
      }}
    >
      <LifeBuoy className="h-4 w-4 shrink-0" style={{ color: AMBER }} />
      <span className="text-[12.5px] font-medium whitespace-nowrap">
        Assistance Yuno
        <span className="text-white/55"> · {session.targetName}</span>
        <span className="text-white/35"> · {remainingLabel(session.expiresAt)}</span>
      </span>
      <button
        type="button"
        onClick={quit}
        disabled={leaving}
        className="ml-0.5 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition hover:brightness-110 disabled:opacity-60"
        style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
      >
        {leaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
        Quitter
      </button>
    </div>
  );
}
