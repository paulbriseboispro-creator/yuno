/**
 * Appels entre postes — la radio interne du club.
 *
 * Un videur qui a besoin de l'hôte VIP à la porte n'avait aucun moyen de le
 * joindre depuis l'app. Cinq messages types, un destinataire par poste, un
 * appel par minute (throttle serveur). Pas un chat : une sirène courte qui
 * atterrit en realtime + push sur le poste visé.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Radio, Loader2, Users, ShieldAlert, Crown, Package, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { roleTokens, STAFF_ROLE_DEFS, type StaffRole } from '@/lib/staffIdentity';

const T1     = 'rgba(255,255,255,0.96)';
const T2     = 'rgba(255,255,255,0.70)';
const T3     = 'rgba(255,255,255,0.48)';
const BORDER = 'rgba(255,255,255,0.085)';
const C_FAINT = 'rgba(255,255,255,0.04)';

export type StationCallKind = 'backup' | 'security' | 'vip_arrival' | 'stock' | 'info';

export const CALL_KIND_DEFS: { kind: StationCallKind; icon: typeof Users; labelKey: string }[] = [
  { kind: 'backup',      icon: Users,       labelKey: 'staffcalls.kind.backup' },
  { kind: 'security',    icon: ShieldAlert, labelKey: 'staffcalls.kind.security' },
  { kind: 'vip_arrival', icon: Crown,       labelKey: 'staffcalls.kind.vip_arrival' },
  { kind: 'stock',       icon: Package,     labelKey: 'staffcalls.kind.stock' },
  { kind: 'info',        icon: Eye,         labelKey: 'staffcalls.kind.info' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  /** Rôle de l'écran courant — proposé en dernier dans la liste des cibles. */
  myRole: StaffRole;
}

const TARGETS: StaffRole[] = ['bouncer', 'barman', 'cloakroom', 'vip_host', 'manager'];

export function StationCallSheet({ open, onClose, myRole }: Props) {
  const { t } = useLanguage();
  const [target, setTarget] = useState<StaffRole | null>(null);
  const [kind, setKind] = useState<StationCallKind | null>(null);
  const [sending, setSending] = useState(false);

  // Son propre poste en dernier : on appelle d'abord les autres.
  const targets = [...TARGETS.filter(r => r !== myRole), myRole];

  const send = async () => {
    if (!target || !kind || sending) return;
    setSending(true);
    try {
      const { error } = await supabase.rpc('staff_station_call', {
        p_target_role: target,
        p_call_kind: kind,
      });
      if (error) {
        // 54000 = throttle serveur (un appel par minute).
        if (error.message?.includes('throttled')) {
          toast.warning(t('staffcalls.throttled'));
        } else {
          toast.error(t('staffcalls.error'));
        }
        return;
      }
      toast.success(t('staffcalls.sent'));
      setTarget(null);
      setKind(null);
      onClose();
    } catch {
      toast.error(t('staffcalls.error'));
    } finally {
      setSending(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[205] flex items-end justify-center sm:items-center"
        >
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }} onClick={onClose} />

          <motion.div
            initial={{ y: 48, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 48, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="relative w-full max-w-md rounded-t-3xl p-5 sm:rounded-3xl"
            style={{
              background: '#0a0a0c',
              border: `1px solid ${BORDER}`,
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)',
            }}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4" style={{ color: '#E8192C' }} />
                <span style={{ color: T1, fontSize: 15, fontWeight: 600 }}>{t('staffcalls.title')}</span>
              </div>
              <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ color: T3 }} aria-label={t('common.close')}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mb-2" style={{ color: T3, fontSize: 11.5 }}>{t('staffcalls.toRole')}</p>
            <div className="mb-4 flex flex-wrap gap-2">
              {targets.map((r) => {
                const def = STAFF_ROLE_DEFS[r];
                const tk = roleTokens(r);
                const RoleIcon = def.icon;
                const selected = target === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setTarget(r)}
                    className="flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 py-2 transition-transform active:scale-95"
                    style={{
                      background: selected ? tk.soft : C_FAINT,
                      border: `1px solid ${selected ? tk.solid : BORDER}`,
                      color: selected ? tk.solid : T2,
                      fontSize: 12.5,
                      fontWeight: 600,
                    }}
                  >
                    <RoleIcon className="h-3.5 w-3.5" />
                    {t(def.labelKey)}
                  </button>
                );
              })}
            </div>

            <p className="mb-2" style={{ color: T3, fontSize: 11.5 }}>{t('staffcalls.kindLabel')}</p>
            <div className="mb-5 space-y-1.5">
              {CALL_KIND_DEFS.map(({ kind: k, icon: KindIcon, labelKey }) => {
                const selected = kind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-3 text-left transition-colors"
                    style={{
                      background: selected ? 'rgba(232,25,44,0.10)' : C_FAINT,
                      border: `1px solid ${selected ? 'rgba(232,25,44,0.35)' : BORDER}`,
                    }}
                  >
                    <KindIcon className="h-4 w-4 flex-none" style={{ color: selected ? '#E8192C' : T3 }} />
                    <span style={{ color: selected ? T1 : T2, fontSize: 13.5 }}>{t(labelKey)}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={send}
              disabled={!target || !kind || sending}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-semibold transition-transform active:scale-[0.99] disabled:opacity-40"
              style={{ background: '#E8192C', color: '#fff', fontSize: 14 }}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
              {t('staffcalls.send')}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
