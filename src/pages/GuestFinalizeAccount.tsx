import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle, Eye, EyeOff, UserPlus, Mail, User, Phone, Ticket, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';

interface GuestContext {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  reference: string;
  type: string;
  eventTitle?: string;
  venueName?: string;
}

export default function GuestFinalizeAccount() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useLanguage();

  const type = searchParams.get('type') || 'order';
  const id = searchParams.get('id') || '';

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [context, setContext] = useState<GuestContext | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!id) {
      setError(t('finalize.missingInfo'));
      setLoading(false);
      return;
    }
    loadContext();
  }, [id, type]);

  const loadContext = async () => {
    try {
      const { data, error: fnError } = await supabase.functions.invoke('claim-guest-order', {
        body: { action: 'finalize_context', purchaseId: id, purchaseType: type },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setContext(data);
    } catch (err: any) {
      setError(err.message || t('finalize.createError'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    setError('');

    if (password.length < 6) {
      setError(t('finalize.passwordMinLength'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('finalize.passwordMismatch'));
      return;
    }
    if (!context) return;

    setSubmitting(true);
    try {
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: context.email,
        password,
        options: {
          data: {
            first_name: context.firstName || undefined,
            last_name: context.lastName || undefined,
          },
        },
      });

      if (signUpError) {
        if (signUpError.message?.includes('already registered') || signUpError.message?.includes('User already registered')) {
          toast({
            title: t('finalize.existingAccount'),
            description: t('finalize.existingAccountDesc'),
          });
          navigate(`/auth?redirect=/claim?order=${encodeURIComponent(context.reference)}&type=${type}&email=${encodeURIComponent(context.email)}`);
          return;
        }
        throw signUpError;
      }

      if (authData.user && authData.session) {
        try {
          await supabase.functions.invoke('claim-guest-order', {
            body: {
              action: 'link_after_signup',
              purchaseId: id,
              purchaseType: type,
              userId: authData.user.id,
            },
          });
        } catch (linkError) {
          console.error('Link error (non-blocking):', linkError);
        }

        setDone(true);

        const tab = type === 'ticket' ? 'tickets' : type === 'table' ? 'vip' : 'drinks';
        setTimeout(() => {
          navigate(`/my-orders?tab=${tab}`);
        }, 2000);
      } else {
        toast({
          title: t('finalize.checkEmail'),
          description: t('finalize.confirmEmail'),
        });
        navigate('/');
      }
    } catch (err: any) {
      setError(err.message || t('finalize.createError'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center p-6">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-6 gap-4">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center gap-4">
          <CheckCircle className="h-14 w-14 text-green-500" />
          <h2 className="text-lg font-semibold">{t('finalize.success')}</h2>
          <p className="text-sm text-muted-foreground">{t('finalize.purchaseLinked')}</p>
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </motion.div>
      </div>
    );
  }

  if (error && !context) {
    return (
      <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-6 gap-4">
        <p className="text-destructive text-center">{error}</p>
        <Button variant="outline" onClick={() => navigate('/')}>{t('finalize.back')}</Button>
      </div>
    );
  }

  const TypeIcon = type === 'ticket' ? Ticket : Package;

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-6" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
            <UserPlus className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-bold">{t('finalize.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('finalize.desc')}
          </p>
        </div>

        {context && (
          <Card className="p-4 border border-border/30 bg-muted/30">
            <div className="flex items-center gap-2 mb-3">
              <TypeIcon className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">
                {context.eventTitle || context.venueName || t('finalize.yourPurchase')}
              </span>
            </div>
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5" />
                <span>{context.email}</span>
              </div>
              {(context.firstName || context.lastName) && (
                <div className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5" />
                  <span>{[context.firstName, context.lastName].filter(Boolean).join(' ')}</span>
                </div>
              )}
              {context.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5" />
                  <span>{context.phone}</span>
                </div>
              )}
            </div>
          </Card>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('finalize.password')}</Label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('finalize.passwordPlaceholder')}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('finalize.confirmPassword')}</Label>
            <Input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('finalize.confirmPlaceholder')}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}

          <Button
            onClick={handleSubmit}
            disabled={submitting || !password || !confirmPassword}
            className="w-full h-12 rounded-xl bg-primary text-base font-semibold"
          >
            {submitting ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <UserPlus className="h-5 w-5 mr-2" />
                {t('finalize.createAccount')}
              </>
            )}
          </Button>

          <Button
            variant="ghost"
            onClick={() => {
              navigate(`/order-confirmation?type=${type}&id=${id}`);
            }}
            className="w-full text-sm text-muted-foreground"
          >
            {t('finalize.later')}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
