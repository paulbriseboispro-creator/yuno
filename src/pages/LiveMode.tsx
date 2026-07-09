// Mode Live — surface takeover plein écran pendant la soirée.
// Le client scanné à l'entrée atterrit ici : menu full-size du club,
// commande 1-2 taps, statut en direct, crédits conso, upsell tables
// restantes, bouteilles sans table. Sans BottomNav : la sortie passe par le
// ✕ du header (bandeau LIVE de ré-entrée sur le reste de l'app).
//
// LAST CALL : à end_at − 45 min la surface passe en accent rouge (purement
// client). Fin de soirée : le RPC retombe sur « rien » → écran goodbye 5 s
// puis retour à l'app normale.
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { PartyPopper } from 'lucide-react';
import { useLiveMode } from '@/contexts/LiveModeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { LiveHeader } from '@/components/livemode/LiveHeader';
import { LiveEventContext } from '@/components/livemode/LiveEventContext';
import { LiveMinSpendBar } from '@/components/livemode/LiveMinSpendBar';
import { LiveOrderStatus } from '@/components/livemode/LiveOrderStatus';
import { LiveReorderCard } from '@/components/livemode/LiveReorderCard';
import { LiveTablesUpsell } from '@/components/livemode/LiveTablesUpsell';
import { LiveMenu } from '@/components/livemode/LiveMenu';
import { LiveFreeDrinks } from '@/components/livemode/LiveFreeDrinks';
import { CartButton } from '@/components/CartButton';
import { transitions } from '@/lib/motion';

const LAST_CALL_MS = 45 * 60 * 1000;

export default function LiveMode() {
  const { session, isLive, loading, enterLive } = useLiveMode();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const wasLiveRef = useRef(false);
  const [goodbye, setGoodbye] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Arriver sur /live (deep-link push, bandeau…) annule une sortie manuelle.
  useEffect(() => {
    if (isLive) {
      enterLive();
      wasLiveRef.current = true;
    }
  }, [isLive, enterLive]);

  // Tick minute : bascule LAST CALL sans re-render permanent.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Fin de soirée pendant qu'on est sur la page → goodbye 5 s → retour app.
  useEffect(() => {
    if (!loading && !isLive && wasLiveRef.current && !goodbye) {
      setGoodbye(true);
      const timer = setTimeout(() => navigate('/', { replace: true }), 5000);
      return () => clearTimeout(timer);
    }
  }, [loading, isLive, goodbye, navigate]);

  if (goodbye) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-4 px-8 text-center"
        style={{ background: '#0A0A0A' }}
      >
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={transitions.celebrate}
        >
          <PartyPopper className="h-10 w-10" style={{ color: '#E8192C' }} />
        </motion.div>
        <h1
          className="font-display font-bold uppercase text-white"
          style={{ fontSize: 24, letterSpacing: '-0.01em' }}
        >
          {t('live.goodbye.title')}
        </h1>
        <p className="font-mono uppercase" style={{ fontSize: 11, letterSpacing: '0.08em', color: '#9A9A9A' }}>
          {t('live.goodbye.subtitle')}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#0A0A0A' }}>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isLive || !session) {
    return <Navigate to="/" replace />;
  }

  const lastCall =
    now >= new Date(session.eventEndAt).getTime() - LAST_CALL_MS &&
    now < new Date(session.eventEndAt).getTime();

  return (
    <div className="min-h-screen pb-32" style={{ background: '#0A0A0A' }}>
      <LiveHeader lastCall={lastCall} />

      {/* Contexte soirée : poster + line-up DJ + ambiance (pleine largeur) */}
      <LiveEventContext />

      <motion.main
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={transitions.reveal}
        className="mx-auto max-w-lg"
      >
        {/* Contexte table : progression du minimum conso */}
        {session.source === 'table' && session.tableReservationId && (
          <LiveMinSpendBar reservationId={session.tableReservationId} />
        )}

        {/* Commandes en cours (statut temps réel + QR/PIN) */}
        <LiveOrderStatus eventId={session.eventId} />

        {/* Boissons offertes de la soirée (crédits conso liés à l'événement) */}
        <LiveFreeDrinks />

        {/* Re-commande 1 tap */}
        <LiveReorderCard />

        {/* Upsell tables restantes — pas pour qui a déjà une table */}
        {session.source !== 'table' && <LiveTablesUpsell />}

        {/* Menu full-size (drink / shot / soft / bouteilles solo) */}
        <LiveMenu />
      </motion.main>

      <CartButton />
    </div>
  );
}
