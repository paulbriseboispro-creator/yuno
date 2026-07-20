/**
 * Le récap de fin de service — fermer sa nuit en voyant ce qu'on a fait.
 *
 * Deux étages, jamais de comparaison entre collègues :
 *   1. « Ton service » — les chiffres de la personne (scans, commandes,
 *      dépôts, consos selon son poste) + la durée si la prise de poste est
 *      connue, + les bravos reçus cette nuit.
 *   2. « L'équipe ce soir » — les totaux du club (entrées, bar, vestiaire) :
 *      on ferme la nuit en voyant ce que L'ÉQUIPE a encaissé ensemble.
 *
 * « Terminer mon service » émet le shift_end (best-effort, dédupliqué) puis
 * offre la déconnexion — le geste naturel en quittant le club.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, ScanLine, Wine, Shirt, Crown, Clock, Users, Heart, LogOut, CheckCircle2, Moon,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { roleTokens, type StaffRole } from '@/lib/staffIdentity';
import { emitShiftEnd } from '@/lib/liveops/shiftEnd';
import { clearStaffSession } from '@/components/RequireStaffSession';
import type { NightPulse } from '@/hooks/useStaffNightPulse';

const T1     = 'rgba(255,255,255,0.96)';
const T2     = 'rgba(255,255,255,0.70)';
const T3     = 'rgba(255,255,255,0.48)';
const BORDER = 'rgba(255,255,255,0.085)';
const C_FAINT = 'rgba(255,255,255,0.04)';

interface SelfStats {
  scans_tonight: number;
  orders_tonight: number;
  cloakroom_tonight: number;
  vip_items_tonight: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  role: StaffRole;
  venueId: string;
  userId: string;
  pulse: NightPulse;
}

export function NightRecap({ open, onClose, role, venueId, userId, pulse }: Props) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const tokens = roleTokens(role);
  const [stats, setStats] = useState<SelfStats | null>(null);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEnded(false);
    supabase.rpc('get_staff_self_stats', { p_days: 30 }).then(({ data }) => {
      if (data) setStats(data as unknown as SelfStats);
    });
  }, [open]);

  const me = pulse.team.find((m) => m.user_id === userId);
  const durationMin = me?.started_at
    ? Math.max(0, Math.round((Date.now() - new Date(me.started_at).getTime()) / 60_000))
    : null;
  const myKudos = pulse.kudos.filter((k) => k.to_user === userId);

  const myTiles: { icon: typeof ScanLine; labelKey: string; value: number }[] = [];
  if (stats) {
    if (role === 'bouncer' || stats.scans_tonight > 0) myTiles.push({ icon: ScanLine, labelKey: 'staffme.stat.scans', value: stats.scans_tonight });
    if (role === 'barman' || stats.orders_tonight > 0) myTiles.push({ icon: Wine, labelKey: 'staffme.stat.orders', value: stats.orders_tonight });
    if (role === 'cloakroom' || stats.cloakroom_tonight > 0) myTiles.push({ icon: Shirt, labelKey: 'staffme.stat.cloakroom', value: stats.cloakroom_tonight });
    if (role === 'vip_host' || stats.vip_items_tonight > 0) myTiles.push({ icon: Crown, labelKey: 'staffme.stat.vip', value: stats.vip_items_tonight });
  }

  const teamTiles: { labelKey: string; value: number }[] = [
    { labelKey: 'staffnight.entries', value: pulse.live.entries },
    { labelKey: 'staffnight.barServed', value: pulse.live.bar_served_tonight },
    { labelKey: 'staffnight.cloakActive', value: pulse.live.cloak_active + pulse.live.cloak_retrieved },
    { labelKey: 'staffnight.vipArrived', value: pulse.live.vip_arrived },
  ].filter((x) => x.value > 0);

  const endShift = async () => {
    await emitShiftEnd(venueId, role);
    setEnded(true);
  };

  const logout = async () => {
    clearStaffSession();
    await supabase.auth.signOut();
    navigate('/auth', { replace: true });
  };

  const fmtDuration = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[210] overflow-y-auto"
          style={{ background: '#000' }}
        >
          <div
            className="pointer-events-none fixed inset-0"
            style={{ background: `radial-gradient(120% 55% at 50% -8%, ${tokens.glow}, transparent 60%)` }}
          />

          <div
            className="relative mx-auto flex min-h-full w-full max-w-md flex-col px-6"
            style={{
              paddingTop: 'calc(env(safe-area-inset-top, 0px) + 28px)',
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Moon className="h-4 w-4" style={{ color: tokens.solid }} />
                <span style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>{t('staffrecap.title')}</span>
              </div>
              <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ color: T3 }} aria-label={t('staffrecap.close')}>
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            {/* ── Ton service ── */}
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="mt-6">
              <p className="mb-2.5" style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {t('staffrecap.yourNight')}
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                {myTiles.map(({ icon: Icon, labelKey, value }, i) => (
                  <motion.div
                    key={labelKey}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.12 + i * 0.07 }}
                    className="rounded-2xl p-4"
                    style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}
                  >
                    <Icon className="mb-2 h-4 w-4" style={{ color: tokens.solid }} />
                    <p className="tabular-nums" style={{ color: T1, fontSize: 24, fontWeight: 680, lineHeight: 1.1 }}>{value}</p>
                    <p style={{ color: T3, fontSize: 11, marginTop: 2 }}>{t(labelKey)}</p>
                  </motion.div>
                ))}
              </div>
              {durationMin !== null && (
                <div className="mt-2.5 flex items-center gap-2 rounded-2xl px-4 py-3" style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
                  <Clock className="h-4 w-4" style={{ color: tokens.solid }} />
                  <span style={{ color: T2, fontSize: 12.5 }}>{t('staffrecap.duration')}</span>
                  <span className="ml-auto tabular-nums" style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{fmtDuration(durationMin)}</span>
                </div>
              )}
            </motion.div>

            {/* ── Bravos reçus ── */}
            {myKudos.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="mt-5">
                <p className="mb-2.5" style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  {t('staffrecap.kudosTitle')}
                </p>
                <div className="space-y-2">
                  {myKudos.map((k) => (
                    <div key={k.id} className="flex items-start gap-2.5 rounded-2xl px-4 py-3" style={{ background: 'rgba(244,114,182,0.07)', border: '1px solid rgba(244,114,182,0.20)' }}>
                      <Heart className="mt-0.5 h-4 w-4 flex-none" style={{ color: '#F472B6' }} />
                      <div className="min-w-0">
                        <p style={{ color: T1, fontSize: 13, fontWeight: 550 }}>{k.from_name}</p>
                        {k.body && <p style={{ color: T2, fontSize: 12.5, marginTop: 1 }}>{k.body}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── L'équipe ce soir ── */}
            {teamTiles.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="mt-5">
                <p className="mb-2.5 flex items-center gap-1.5" style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  <Users className="h-3 w-3" />
                  {t('staffrecap.teamNight')}
                </p>
                <div className="rounded-2xl p-4" style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
                  <div className="space-y-2">
                    {teamTiles.map(({ labelKey, value }) => (
                      <div key={labelKey} className="flex items-center justify-between">
                        <span style={{ color: T2, fontSize: 12.5 }}>{t(labelKey)}</span>
                        <span className="tabular-nums" style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            <div className="flex-1" />

            {ended ? (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-8 space-y-2.5">
                <div className="flex items-center justify-center gap-2 rounded-2xl py-4" style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.25)' }}>
                  <CheckCircle2 className="h-4.5 w-4.5" style={{ color: '#34D399' }} />
                  <span style={{ color: '#34D399', fontSize: 14, fontWeight: 600 }}>{t('staffrecap.done')}</span>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 font-semibold"
                  style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1, fontSize: 14 }}
                >
                  <LogOut className="h-4 w-4" />
                  {t('staffrecap.logout')}
                </button>
              </motion.div>
            ) : (
              <motion.button
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                type="button"
                onClick={endShift}
                className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl py-4 font-semibold transition-transform active:scale-[0.99]"
                style={{ background: tokens.solid, color: '#000', fontSize: 15.5 }}
              >
                <Moon className="h-4.5 w-4.5" />
                {t('staffrecap.confirm')}
              </motion.button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
