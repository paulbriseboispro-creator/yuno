// Console : le billet dont l'e-mail a rebondi (adresse qui n'existe pas).
// L'organisateur obtient la bonne adresse de l'acheteur (téléphone de la fiche)
// et renvoie le billet d'ici. Même porte serveur que la page de confirmation :
// send-ticket-confirmation `fix_email`, preuve = le QR du billet.
import { useState, type FormEvent } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { isPlausibleEmail, suggestEmail } from '@/lib/emailTypo';
import { useTicketEmailDelivery, type TicketEmailFixFailure } from '@/hooks/useTicketEmailDelivery';

const T1 = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2 = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const BORDER = 'rgb(var(--ink)/0.085)';
const ERR = 'var(--acc-ff7a80)';

export function TicketEmailBouncePanel({ ticketId, qrCode, onFixed }: {
  ticketId: string;
  qrCode: string | null;
  onFixed: (email: string) => void;
}) {
  const { t } = useLanguage();
  const { delivery, fix } = useTicketEmailDelivery(ticketId, qrCode, { poll: false });
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (!delivery || delivery.status !== 'bounced') return null;
  const suggestion = suggestEmail(value || delivery.email);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const email = value.trim();
    if (!isPlausibleEmail(email)) { setError(t('owner.ticketEmail.err.invalid_email')); return; }
    setSending(true);
    const res = await fix(email);
    setSending(false);
    if (res.ok) {
      toast.success(t('owner.ticketEmail.resent').replace('{email}', email.toLowerCase()));
      setValue('');
      onFixed(email.toLowerCase());
      return;
    }
    const known: TicketEmailFixFailure[] = ['invalid_email', 'same_email', 'too_many'];
    setError(t(`owner.ticketEmail.err.${res.reason && known.includes(res.reason) ? res.reason : 'error'}`));
  };

  return (
    <div className="p-4 rounded-xl space-y-2.5" style={{ background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.25)' }}>
      <p className="flex items-center gap-1.5" style={{ color: ERR, fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
        <AlertTriangle className="w-3.5 h-3.5" />
        {t('owner.ticketEmail.bounced')}
      </p>
      <p style={{ color: T2, fontSize: 13, lineHeight: 1.45 }} className="[overflow-wrap:anywhere]">
        <span style={{ color: T1, fontWeight: 560 }}>{delivery.email}</span> {t('owner.ticketEmail.bouncedBody')}
      </p>
      {delivery.canFix ? (
        <form onSubmit={submit} className="space-y-2" noValidate>
          <input
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={t('owner.ticketEmail.newAddress')}
            aria-label={t('owner.ticketEmail.newAddress')}
            value={value}
            onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
            className="w-full h-10 px-3 rounded-lg text-[13px] outline-none"
            style={{ background: 'rgb(var(--ink)/0.04)', border: `1px solid ${error ? ERR : BORDER}`, color: T1 }}
          />
          {error ? (
            <p style={{ color: ERR, fontSize: 12 }}>{error}</p>
          ) : suggestion && !value ? (
            <button type="button" onClick={() => setValue(suggestion)} style={{ color: T2, fontSize: 12 }} className="underline underline-offset-2">
              {t('owner.ticketEmail.tryThis').replace('{email}', suggestion)}
            </button>
          ) : null}
          <button
            type="submit"
            disabled={sending || !value.trim()}
            className="w-full h-10 rounded-lg flex items-center justify-center gap-2 text-[13px] font-semibold text-snow disabled:opacity-50"
            style={{ background: '#E8192C' }}
          >
            {sending && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('owner.ticketEmail.resend')}
          </button>
        </form>
      ) : (
        <p style={{ color: T2, fontSize: 12 }}>{t('owner.ticketEmail.err.too_many')}</p>
      )}
    </div>
  );
}
