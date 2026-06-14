import { Input } from '@/components/ui/input';
import { User, Mail } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { PhoneInputWithCountry } from '@/components/PhoneInputWithCountry';

export interface AttendeeInfo {
  fullName: string;
  email: string;
  phone: string;
}

interface TicketAttendeeFormProps {
  index: number;
  attendee: AttendeeInfo;
  onChange: (index: number, field: keyof AttendeeInfo, value: string) => void;
  isPrimary?: boolean;
  showConfirmEmail?: boolean;
  confirmEmail?: string;
  onConfirmEmailChange?: (value: string) => void;
}

const inputClass =
  'pl-10 h-11 rounded-lg bg-[#1F1F22] border-white/[0.08] text-white placeholder:text-[#5A5A5E] focus-visible:ring-0 focus-visible:border-primary/50';
const fieldLabelClass = 'font-mono uppercase text-[10px] tracking-[0.10em] text-[#5A5A5E]';

export function TicketAttendeeForm({
  index,
  attendee,
  onChange,
  isPrimary = false,
  showConfirmEmail = false,
  confirmEmail = '',
  onConfirmEmailChange
}: TicketAttendeeFormProps) {
  const { t } = useLanguage();

  // Label: "VOUS" for primary, "INVITÉ X" for others (starting at 1)
  const getLabel = () => {
    if (isPrimary) {
      return t('ticketCheckout.you');
    }
    return `${t('ticketCheckout.guest')} ${index}`;
  };

  return (
    <div className="space-y-3 p-4 rounded-[10px] border border-white/[0.08] bg-[#141414]">
      <div className="flex items-center gap-2.5 mb-1">
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-primary"
          style={{ fontFamily: "'JetBrains Mono', monospace", background: 'rgba(232,25,44,0.12)' }}
        >
          {index + 1}
        </div>
        <span className="font-mono uppercase text-[11px] font-semibold tracking-[0.10em] text-[#E5E5E5]">
          {getLabel()}
        </span>
      </div>

      {/* Full name */}
      <div className="space-y-1.5">
        <label htmlFor={`fullName-${index}`} className={fieldLabelClass}>
          {t('ticketCheckout.fullName')} *
        </label>
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#5A5A5E]" />
          <Input
            id={`fullName-${index}`}
            placeholder={t('ticketCheckout.fullNamePlaceholder')}
            value={attendee.fullName}
            onChange={(e) => onChange(index, 'fullName', e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {/* Email */}
      <div className="space-y-1.5">
        <label htmlFor={`email-${index}`} className={fieldLabelClass}>
          {t('ticketCheckout.email')} *
        </label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#5A5A5E]" />
          <Input
            id={`email-${index}`}
            type="email"
            placeholder={t('ticketCheckout.emailPlaceholder')}
            value={attendee.email}
            onChange={(e) => onChange(index, 'email', e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {/* Confirm email - only for primary */}
      {showConfirmEmail && onConfirmEmailChange && (
        <div className="space-y-1.5">
          <label htmlFor={`confirmEmail-${index}`} className={fieldLabelClass}>
            {t('ticketCheckout.confirmEmail')} *
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#5A5A5E]" />
            <Input
              id={`confirmEmail-${index}`}
              type="email"
              placeholder={t('ticketCheckout.confirmEmailPlaceholder')}
              value={confirmEmail}
              onChange={(e) => onConfirmEmailChange(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      )}

      {/* Phone with country selector */}
      <div className="space-y-1.5">
        <label htmlFor={`phone-${index}`} className={fieldLabelClass}>
          {t('ticketCheckout.phone')} *
        </label>
        <PhoneInputWithCountry
          id={`phone-${index}`}
          value={attendee.phone}
          onChange={(value) => onChange(index, 'phone', value)}
          placeholder="6 12 34 56 78"
        />
      </div>
    </div>
  );
}
