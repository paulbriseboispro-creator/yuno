// L'e-mail du billet n'a pas pu être livré : l'acheteur corrige son adresse.
//
// Une faute dans l'adresse (« gmail.com » juste, une lettre fausse avant le @)
// ne se voit à aucun contrôle de format : seule la boîte de réception le dit,
// par un rebond qui arrive en quelques secondes, quand l'acheteur est encore
// sur cette page. La carte n'apparaît QUE dans ce cas (décision de Paul du
// 20/10) : un acheteur dont l'e-mail est parti normalement ne voit rien.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { isPlausibleEmail, suggestEmail } from '@/lib/emailTypo';
import { checkoutInputClass, CHECKOUT_ERROR } from '@/components/checkout/checkoutFieldStyle';
import { FieldError, FieldHint, FieldLabel } from '@/components/checkout/checkoutFieldUi';
import type { TicketEmailDelivery as Delivery, TicketEmailFixFailure, TicketEmailFixResult } from '@/hooks/useTicketEmailDelivery';

interface Props {
  delivery: Delivery | null;
  fix: (email: string) => Promise<TicketEmailFixResult>;
}

export function TicketEmailDelivery({ delivery, fix }: Props) {
  const { t } = useLanguage();
  const bounced = delivery?.status === 'bounced';
  // Le rebond arrive pendant que la personne regarde son QR, plus bas : un
  // message qui se voit où qu'elle soit dans la page, une fois.
  const announced = useRef(false);
  useEffect(() => {
    if (!bounced || announced.current) return;
    announced.current = true;
    toast.error(t('confirmation.mail.bouncedToast'), { duration: 10_000 });
  }, [bounced, t]);

  if (!delivery || !bounced) return null;

  return (
    <section
      role="alert"
      className="mt-6 rounded-[10px] p-4"
      style={{ background: 'rgba(232,25,44,0.07)', border: '1px solid rgba(255,90,104,0.45)' }}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0" style={{ color: CHECKOUT_ERROR }} aria-hidden />
        <div className="min-w-0">
          <h2 className="font-display text-[17px] font-bold leading-[1.2] text-white">{t('confirmation.mail.bouncedTitle')}</h2>
          <p className="mt-1.5 text-[13.5px] leading-[1.5] text-[#E5E5E5] [overflow-wrap:anywhere]">
            {t('confirmation.mail.bouncedBefore')}
            <strong className="font-semibold text-white">{delivery.email}</strong>
            {delivery.canFix ? t('confirmation.mail.bouncedAfter') : t('confirmation.mail.bouncedAfterNoFix')}
          </p>
        </div>
      </div>
      {delivery.canFix ? <EmailFixForm initial={delivery.email} fix={fix} /> : null}
      <p className="mt-3 text-[12.5px] leading-[1.45] text-[#9A9A9A]">{t('confirmation.mail.stillValid')}</p>
    </section>
  );
}

function EmailFixForm({ initial, fix }: { initial: string; fix: Props['fix'] }) {
  const { t } = useLanguage();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const suggestion = !error ? suggestEmail(value) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const email = value.trim();
    if (!isPlausibleEmail(email)) { setError(t('confirmation.mail.err.invalid_email')); return; }
    if (email.toLowerCase() === initial.toLowerCase()) { setError(t('confirmation.mail.err.same_email')); return; }
    setSending(true);
    const res = await fix(email);
    setSending(false);
    if (res.ok) {
      // La carte disparaît : l'e-mail repart, la page relit son état.
      toast.success(t('confirmation.mail.resent').replace('{email}', email.toLowerCase()));
      return;
    }
    const known: TicketEmailFixFailure[] = ['invalid_email', 'same_email', 'too_late', 'too_many'];
    setError(t(`confirmation.mail.err.${res.reason && known.includes(res.reason) ? res.reason : 'error'}`));
  };

  return (
    <form onSubmit={submit} className="mt-3.5 flex flex-col gap-[7px]" noValidate>
      <FieldLabel htmlFor="cf-email" invalid={!!error}>{t('confirmation.mail.fieldLabel')}</FieldLabel>
      <input
        id="cf-email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        value={value}
        onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
        aria-invalid={!!error || undefined}
        aria-describedby="cf-email-hint"
        className={checkoutInputClass(!!error)}
      />
      {error ? (
        <FieldError id="cf-email-hint">{error}</FieldError>
      ) : suggestion ? (
        <div id="cf-email-hint" role="status" className="flex items-center gap-2.5 rounded-lg border border-amber-400/35 bg-amber-400/[0.07] px-3 py-2.5">
          <span className="min-w-0 flex-1 text-[13px] leading-[1.4] text-[#E5E5E5] [overflow-wrap:anywhere]">
            {t('confirmation.mail.suggestBefore')}
            <strong className="font-semibold text-amber-300">{suggestion}</strong>
            {t('confirmation.mail.suggestAfter')}
          </span>
          <button
            type="button"
            onClick={() => setValue(suggestion)}
            className="h-9 shrink-0 rounded px-3 font-mono text-[10.5px] font-bold uppercase tracking-[0.08em] text-amber-300 transition-colors hover:bg-amber-400/10"
            style={{ border: '1px solid rgba(251,191,36,0.5)' }}
          >
            {t('confirmation.mail.suggestFix')}
          </button>
        </div>
      ) : (
        <FieldHint id="cf-email-hint">{t('confirmation.mail.fieldHint')}</FieldHint>
      )}
      <div className="mt-1.5 flex items-center gap-3">
        <button
          type="submit"
          disabled={sending}
          className="flex h-12 flex-1 items-center justify-center gap-2 bg-primary font-mono text-[12px] font-bold uppercase tracking-[0.10em] text-white transition-opacity disabled:opacity-60"
          style={{ borderRadius: 4 }}
        >
          {sending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {t('confirmation.mail.resend')}
        </button>
      </div>
    </form>
  );
}
