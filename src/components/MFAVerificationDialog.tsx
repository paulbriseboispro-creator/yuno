import { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Shield, Delete, Eye, EyeOff } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { motion, AnimatePresence } from 'framer-motion';

interface MFAVerificationDialogProps {
  open: boolean;
  onVerified: () => void;
  onCancel: () => void;
}

export function MFAVerificationDialog({ open, onVerified, onCancel }: MFAVerificationDialogProps) {
  const { t } = useLanguage();
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [shake, setShake] = useState(false);
  const pinLength = 6;
  // Track last code that was submitted to prevent the auto-submit useEffect
  // from re-triggering in a loop after a failed verification.
  const lastSubmittedCodeRef = useRef<string>('');

  useEffect(() => {
    if (error) {
      setShake(true);
      const t1 = setTimeout(() => setShake(false), 500);
      const t2 = setTimeout(() => {
        setCode('');
        setError('');
        lastSubmittedCodeRef.current = '';
      }, 600);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [error]);

  const verifyCode = useCallback(async (currentCode?: string) => {
    const codeToVerify = currentCode || code;
    if (!useRecovery && !/^\d{6}$/.test(codeToVerify)) return;
    if (useRecovery && !recoveryCode.trim()) {
      toast.error(t('mfa.invalidCode'));
      return;
    }

    setLoading(true);
    setError('');
    try {
      const { data, error: fnError } = await supabase.functions.invoke('mfa', {
        body: { action: 'verify-login', ...(useRecovery ? { recoveryCode } : { code: codeToVerify }) },
      });

      if (fnError) {
        // Try to extract a server-provided message from the underlying Response
        let message: string = t('mfa.incorrectCode');
        try {
          const ctx: any = (fnError as any)?.context;
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json();
            if (body?.error && typeof body.error === 'string') message = body.error;
          } else if (ctx?.body?.error && typeof ctx.body.error === 'string') {
            message = ctx.body.error;
          } else if (fnError.message && !fnError.message.includes('non-2xx')) {
            message = fnError.message;
          }
        } catch {
          // keep default message
        }
        setError(message);
        return;
      }

      if (data?.error) {
        setError(typeof data.error === 'string' ? data.error : t('mfa.incorrectCode'));
        return;
      }

      toast.success(t('mfa.activated'));
      onVerified();
    } catch (err: any) {
      setError(err?.context?.body?.error || err?.message || t('mfa.incorrectCode'));
    } finally {
      setLoading(false);
    }
  }, [code, recoveryCode, useRecovery, t, onVerified]);

  // Auto-submit when 6 digits entered (TOTP mode).
  // Guard against re-submitting the same code repeatedly which previously
  // caused an infinite verify loop on incorrect codes.
  useEffect(() => {
    if (
      !useRecovery &&
      code.length === pinLength &&
      !loading &&
      !error &&
      lastSubmittedCodeRef.current !== code
    ) {
      lastSubmittedCodeRef.current = code;
      verifyCode(code);
    }
  }, [code, useRecovery, loading, error, verifyCode]);

  const handleDigit = (digit: string) => {
    if (loading || useRecovery) return;
    setCode(prev => prev.length < pinLength ? prev + digit : prev);
  };

  const handleDelete = () => {
    if (loading || useRecovery) return;
    setCode(prev => prev.slice(0, -1));
  };

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="sm:max-w-sm p-0 bg-background border-white/[0.06] overflow-hidden">
        <div className="relative px-6 pt-8 pb-6 flex flex-col items-center">
          {/* Ambient glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[150px] bg-primary/[0.06] rounded-full blur-[80px] pointer-events-none" />

          {/* Icon */}
          <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-[0_0_20px_rgba(220,38,38,0.1)] mb-4 relative z-10">
            <Shield className="h-7 w-7 text-primary" />
          </div>

          <h2 className="text-lg font-bold text-foreground mb-0.5 relative z-10">{t('mfa.title')}</h2>
          <p className="text-xs text-muted-foreground mb-6 relative z-10 text-center max-w-[240px]">
            {useRecovery ? (t('mfa.recoveryCodesDesc')) : (t('mfa.enterCode'))}
          </p>

          {!useRecovery ? (
            <>
              {/* PIN dots */}
              <motion.div
                animate={shake ? { x: [0, -12, 12, -8, 8, -4, 4, 0] } : {}}
                transition={{ duration: 0.4 }}
                className="flex items-center gap-2.5 mb-3 relative z-10"
              >
                {Array.from({ length: pinLength }).map((_, i) => {
                  const filled = i < code.length;
                  const active = i === code.length;
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
                              <span className="text-base font-bold text-primary">{code[i]}</span>
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

              <Button onClick={() => { setUseRecovery(true); setCode(''); setError(''); }} variant="ghost" className="mt-4 text-xs text-muted-foreground hover:text-primary relative z-10">
                {t('mfa.useRecoveryCode')}
              </Button>
            </>
          ) : (
            /* Recovery code mode */
            <div className="w-full space-y-4 relative z-10">
              <Input
                type="text"
                placeholder="XXXXXXXX"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
                className="text-center font-mono text-lg tracking-widest bg-white/[0.03] border-white/[0.1] focus:border-primary/40"
                autoFocus
              />
              {error && <p className="text-xs text-destructive text-center">{error}</p>}
              <Button onClick={() => verifyCode()} disabled={loading || !recoveryCode.trim()} className="w-full">
                {loading ? t('mfa.verifying') : t('mfa.verify')}
              </Button>
              <Button onClick={() => { setUseRecovery(false); setRecoveryCode(''); setError(''); }} variant="ghost" className="w-full text-xs text-muted-foreground hover:text-primary">
                {t('mfa.useAuthCode')}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
