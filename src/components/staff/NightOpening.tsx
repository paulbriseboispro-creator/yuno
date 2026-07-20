/**
 * L'ouverture de soirée — le rituel de prise de poste.
 *
 * Avant : emitShiftStart partait en silence au montage du dashboard, personne
 * ne le voyait. Maintenant, à l'heure du service (18h-6h Paris), l'écran
 * s'ouvre sur ce qui attend la personne CE SOIR — l'événement, les préventes,
 * la guest list, les tables — adapté à son poste, avec la consigne du patron
 * si elle existe. « Prendre mon poste » rend la présence intentionnelle.
 *
 * Fermer sans prendre poste émet quand même le shift_start silencieux : le
 * centre de commandement owner ne doit jamais perdre la présence terrain.
 */

import { useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CalendarDays, Ticket, ListChecks, Crown, Users, Megaphone, ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { roleTokens, greetingKey, STAFF_ROLE_DEFS, type StaffRole } from '@/lib/staffIdentity';
import { emitShiftStart } from '@/lib/liveops/shiftStart';
import type { NightPulse } from '@/hooks/useStaffNightPulse';

const T1     = 'rgba(255,255,255,0.96)';
const T2     = 'rgba(255,255,255,0.70)';
const T3     = 'rgba(255,255,255,0.48)';
const BORDER = 'rgba(255,255,255,0.085)';
const C_FAINT = 'rgba(255,255,255,0.04)';

interface Props {
  open: boolean;
  onClose: () => void;
  role: StaffRole;
  venueId: string;
  venueName: string | null;
  firstName: string | null;
  pulse: NightPulse;
}

interface ExpectedTile {
  icon: typeof Ticket;
  labelKey: string;
  value: string;
}

export function NightOpening({ open, onClose, role, venueId, venueName, firstName, pulse }: Props) {
  const { t } = useLanguage();
  const tokens = roleTokens(role);
  const emitted = useRef(false);

  const takePost = () => {
    if (!emitted.current) {
      emitted.current = true;
      emitShiftStart(venueId, role);
    }
    onClose();
  };

  // Fermer = présence quand même (le patron doit savoir qui est là).
  const dismiss = () => takePost();

  // Échapper au scroll de fond tant que l'overlay est ouvert.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const tiles = useMemo<ExpectedTile[]>(() => {
    const ex = pulse.expected;
    const out: ExpectedTile[] = [];
    const cap = ex.capacity ? ` / ${ex.capacity}` : '';

    if (role === 'bouncer') {
      out.push({ icon: Ticket, labelKey: 'staffnight.presold', value: `${ex.tickets_sold}${cap}` });
      if (ex.guest_list > 0) out.push({ icon: ListChecks, labelKey: 'staffnight.guestlist', value: String(ex.guest_list) });
      if (ex.vip_tables > 0) out.push({ icon: Crown, labelKey: 'staffnight.vipTables', value: String(ex.vip_tables) });
    } else if (role === 'barman') {
      out.push({ icon: Users, labelKey: 'staffnight.expectedGuests', value: `${ex.tickets_sold + ex.guest_list}` });
      if (ex.vip_tables > 0) out.push({ icon: Crown, labelKey: 'staffnight.vipTables', value: String(ex.vip_tables) });
    } else if (role === 'vip_host') {
      out.push({ icon: Crown, labelKey: 'staffnight.vipTables', value: String(ex.vip_tables) });
      out.push({ icon: Ticket, labelKey: 'staffnight.presold', value: String(ex.tickets_sold) });
    } else {
      // cloakroom / manager : le volume attendu suffit
      out.push({ icon: Users, labelKey: 'staffnight.expectedGuests', value: `${ex.tickets_sold + ex.guest_list}` });
      if (ex.vip_tables > 0) out.push({ icon: Crown, labelKey: 'staffnight.vipTables', value: String(ex.vip_tables) });
    }
    return out;
  }, [pulse.expected, role]);

  const eventTime = pulse.event
    ? new Date(pulse.event.start_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null;

  const roleDef = STAFF_ROLE_DEFS[role];

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
          {/* Halo du poste */}
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
            <div className="flex justify-end">
              <button onClick={dismiss} className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ color: T3 }} aria-label={t('staffopen.later')}>
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              style={{ color: T3, fontSize: 13 }}
            >
              {t(greetingKey())}{firstName ? `, ${firstName}` : ''}
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 }}
              style={{ color: T1, fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.15, marginTop: 6 }}
            >
              {pulse.event ? pulse.event.title : t('staffopen.noEvent')}
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18 }}
              className="mt-2 flex items-center gap-1.5"
              style={{ color: T2, fontSize: 13 }}
            >
              <CalendarDays className="h-3.5 w-3.5" style={{ color: tokens.solid }} />
              {[eventTime, venueName, t(roleDef.labelKey)].filter(Boolean).join(' · ')}
            </motion.p>

            {/* Les attendus du poste */}
            {tiles.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.28 }}
                className="mt-7"
              >
                <p className="mb-2.5" style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  {t('staffopen.expected')}
                </p>
                <div className="grid grid-cols-2 gap-2.5">
                  {tiles.map(({ icon: Icon, labelKey, value }, i) => (
                    <motion.div
                      key={labelKey}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.32 + i * 0.07 }}
                      className="rounded-2xl p-4"
                      style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}
                    >
                      <Icon className="mb-2 h-4 w-4" style={{ color: tokens.solid }} />
                      <p className="tabular-nums" style={{ color: T1, fontSize: 24, fontWeight: 680, lineHeight: 1.1 }}>{value}</p>
                      <p style={{ color: T3, fontSize: 11, marginTop: 2 }}>{t(labelKey)}</p>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* La consigne du patron, si elle existe */}
            {pulse.brief && (
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="mt-4 rounded-2xl p-4"
                style={{ background: tokens.soft, border: `1px solid ${tokens.ring}` }}
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Megaphone className="h-3.5 w-3.5" style={{ color: tokens.solid }} />
                  <span style={{ color: tokens.solid, fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    {t('staffnight.brief')}
                  </span>
                </div>
                <p style={{ color: T1, fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{pulse.brief.body}</p>
              </motion.div>
            )}

            <div className="flex-1" />

            <motion.button
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              type="button"
              onClick={takePost}
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl py-4 font-semibold transition-transform active:scale-[0.99]"
              style={{ background: tokens.solid, color: '#000', fontSize: 15.5 }}
            >
              {t('staffopen.takePost')}
              <ArrowRight className="h-4.5 w-4.5" />
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
