import { useState, useCallback, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { KeyRound, Delete, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { motion, AnimatePresence } from 'framer-motion';

interface StaffPinDialogProps {
  open: boolean;
  onVerified: (venueId: string, role: string) => void;
  onCancel: () => void;
  venueId?: string | null;
  allowedRoles: ('barman' | 'bouncer' | 'manager' | 'vip_host' | 'cloakroom')[];
}

export function StaffPinDialog({ open, onVerified, onCancel, venueId, allowedRoles }: StaffPinDialogProps) {
  const { t } = useLanguage();
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [shake, setShake] = useState(false);
  const pinLength = 6;

  // Chaque poste a son libellé traduit. 'cloakroom' manquait (il retombait sur
  // « Staff ») et 'vip_host' était codé en dur en anglais.
  const getRoleLabel = () => {
    if (allowedRoles.includes('barman')) return t('staffid.role.barman');
    if (allowedRoles.includes('bouncer')) return t('staffid.role.bouncer');
    if (allowedRoles.includes('cloakroom')) return t('staffid.role.cloakroom');
    if (allowedRoles.includes('vip_host')) return t('staffid.role.vipHost');
    if (allowedRoles.includes('manager')) return t('staffid.role.manager');
    return t('staffid.role.generic');
  };

  useEffect(() => {
    if (error) {
      setShake(true);
      const t1 = setTimeout(() => setShake(false), 500);
      const t2 = setTimeout(() => setPin(''), 600);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [error]);

  const handleVerify = useCallback(async (currentPin: string) => {
    if (currentPin.length !== pinLength) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: verifyError } = await supabase.functions.invoke('verify-pin', {
        body: { pin: currentPin, venueId: venueId || undefined, allowedRoles }
      });
      if (verifyError || !data?.success) {
        setError(data?.message || t('pin.invalid') || 'Code PIN invalide');
        setPin('');
        return;
      }
      setPin('');
      onVerified(data.venueId, data.role);
    } catch (err) {
      setError(t('pin.error') || 'Erreur de vérification');
      setPin('');
    } finally {
      setLoading(false);
    }
  }, [venueId, allowedRoles, t, onVerified]);

  useEffect(() => {
    if (pin.length === pinLength && !loading) {
      handleVerify(pin);
    }
  }, [pin, loading, handleVerify]);

  const handleDigit = (digit: string) => {
    if (loading) return;
    setPin(prev => prev.length < pinLength ? prev + digit : prev);
  };

  const handleDelete = () => {
    if (loading) return;
    setPin(prev => prev.slice(0, -1));
  };

  const handleClose = () => { setPin(''); setError(''); onCancel(); };

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-sm p-0 bg-background border-white/[0.06] overflow-hidden">
        <div className="relative px-6 pt-8 pb-6 flex flex-col items-center">
          {/* Ambient glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[150px] bg-primary/[0.06] rounded-full blur-[80px] pointer-events-none" />

          {/* Icon */}
          <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-[0_0_20px_rgba(220,38,38,0.1)] mb-4 relative z-10">
            <KeyRound className="h-7 w-7 text-primary" />
          </div>

          <h2 className="text-lg font-bold text-foreground mb-0.5 relative z-10">
            {t('pin.verification') || 'Vérification'} {getRoleLabel()}
          </h2>
          <p className="text-xs text-muted-foreground mb-6 relative z-10">
            {t('pin.enterToAccess') || 'Entrez votre code PIN pour accéder à votre espace.'}
          </p>

          {/* PIN dots */}
          <motion.div
            animate={shake ? { x: [0, -12, 12, -8, 8, -4, 4, 0] } : {}}
            transition={{ duration: 0.4 }}
            className="flex items-center gap-2.5 mb-3 relative z-10"
          >
            {Array.from({ length: pinLength }).map((_, i) => {
              const filled = i < pin.length;
              const active = i === pin.length;
              return (
                <motion.div
                  key={i}
                  className={`h-11 w-11 rounded-xl border-2 flex items-center justify-center transition-all duration-200 ${
                    active ? 'border-primary bg-primary/[0.08] shadow-[0_0_12px_rgba(220,38,38,0.15)]'
                    : filled ? 'border-primary/40 bg-primary/[0.06]'
                    : 'border-white/[0.1] bg-white/[0.03]'
                  }`}
                  animate={filled ? { scale: [1, 1.1, 1] } : {}}
                  transition={{ duration: 0.15 }}
                >
                  <AnimatePresence mode="wait">
                    {filled && (
                      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ duration: 0.1 }}>
                        {showPin ? (
                          <span className="text-base font-bold text-primary">{pin[i]}</span>
                        ) : (
                          <div className="h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_8px_rgba(220,38,38,0.4)]" />
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </motion.div>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.p initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-xs text-destructive mb-3 text-center relative z-10">
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          {loading && (
            <div className="mb-3 relative z-10">
              <div className="h-1 w-24 rounded-full bg-white/[0.06] overflow-hidden">
                <motion.div className="h-full bg-primary rounded-full" animate={{ x: ['-100%', '100%'] }} transition={{ repeat: Infinity, duration: 1, ease: 'easeInOut' }} style={{ width: '50%' }} />
              </div>
            </div>
          )}

          {/* Numpad */}
          <div className="grid grid-cols-3 gap-2.5 w-full max-w-[240px] mt-2 relative z-10">
            {digits.map((digit) => (
              <motion.button key={digit} whileTap={{ scale: 0.9 }} onClick={() => handleDigit(digit)} disabled={loading}
                className="h-14 w-full rounded-xl bg-white/[0.04] border border-white/[0.06] text-lg font-semibold text-foreground hover:bg-white/[0.08] active:bg-primary/[0.12] active:border-primary/30 transition-all duration-150 disabled:opacity-40">
                {digit}
              </motion.button>
            ))}
            <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowPin(!showPin)}
              className="h-14 w-full rounded-xl bg-white/[0.02] border border-white/[0.04] flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-all">
              {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </motion.button>
            <motion.button whileTap={{ scale: 0.9 }} onClick={() => handleDigit('0')} disabled={loading}
              className="h-14 w-full rounded-xl bg-white/[0.04] border border-white/[0.06] text-lg font-semibold text-foreground hover:bg-white/[0.08] active:bg-primary/[0.12] active:border-primary/30 transition-all duration-150 disabled:opacity-40">
              0
            </motion.button>
            <motion.button whileTap={{ scale: 0.9 }} onClick={handleDelete} disabled={loading}
              className="h-14 w-full rounded-xl bg-white/[0.02] border border-white/[0.04] flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-all disabled:opacity-40">
              <Delete className="h-4 w-4" />
            </motion.button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
