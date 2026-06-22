import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';

export interface GuestSignupContext {
  email: string;
  firstName?: string;
  lastName?: string;
  /** Reference (order code / qr) used for the existing-account /claim redirect. */
  reference?: string;
  purchaseId: string;
  purchaseType: string; // 'ticket' | 'table' | 'order'
}

/**
 * Shared guest → account conversion used by the post-payment screens
 * (VerifyTicketPayment inline, GuestFinalizeAccount). Validates the password,
 * signs the guest up with their checkout email, links the purchase to the new
 * account, and routes an already-registered email to /auth. The caller owns the
 * post-success UX through `onSuccess`.
 */
export function useGuestSignup() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const signup = async (
    ctx: GuestSignupContext,
    password: string,
    confirmPassword: string,
    onSuccess: () => void,
  ) => {
    setError('');

    if (password.length < 6) {
      setError(t('finalize.passwordMinLength'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('finalize.passwordMismatch'));
      return;
    }

    setSubmitting(true);
    try {
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: ctx.email,
        password,
        options: {
          data: {
            first_name: ctx.firstName || undefined,
            last_name: ctx.lastName || undefined,
          },
        },
      });

      if (signUpError) {
        if (
          signUpError.message?.includes('already registered') ||
          signUpError.message?.includes('User already registered')
        ) {
          toast({
            title: t('finalize.existingAccount'),
            description: t('finalize.existingAccountDesc'),
          });
          const ref = ctx.reference || ctx.purchaseId;
          navigate(
            `/auth?redirect=/claim?order=${encodeURIComponent(ref)}&type=${ctx.purchaseType}&email=${encodeURIComponent(ctx.email)}`,
          );
          return;
        }
        throw signUpError;
      }

      if (authData.user && authData.session) {
        // Link the guest purchase to the freshly created account. Non-blocking:
        // the account still exists even if the link RPC hiccups.
        try {
          await supabase.functions.invoke('claim-guest-order', {
            body: {
              action: 'link_after_signup',
              purchaseId: ctx.purchaseId,
              purchaseType: ctx.purchaseType,
              userId: authData.user.id,
            },
          });
        } catch (linkError) {
          console.error('Link error (non-blocking):', linkError);
        }
        onSuccess();
      } else {
        // Email confirmation required (no session yet) — can't link until login.
        toast({
          title: t('finalize.checkEmail'),
          description: t('finalize.confirmEmail'),
        });
        navigate('/');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('finalize.createError'));
    } finally {
      setSubmitting(false);
    }
  };

  return { submitting, error, setError, signup };
}
