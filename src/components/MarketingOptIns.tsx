import { Bell, Mail, MessageSquare, Check } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface MarketingOptInsProps {
  newsletterOptIn: boolean;
  onNewsletterChange: (value: boolean) => void;
  smsOptIn: boolean;
  onSmsChange: (value: boolean) => void;
  /** Hide the email row when the buyer already subscribed elsewhere. */
  showNewsletter?: boolean;
}

/**
 * Grouped, opt-in marketing consents (newsletter + SMS) presented as a single
 * clearly-optional card. Replaces the scattered bare checkboxes on the ticket
 * and VIP-table checkout pages so a first-time buyer can scan required vs
 * optional at a glance.
 */
export function MarketingOptIns({
  newsletterOptIn,
  onNewsletterChange,
  smsOptIn,
  onSmsChange,
  showNewsletter = true,
}: MarketingOptInsProps) {
  const { t } = useLanguage();

  return (
    <div className="rounded-[10px] border border-white/[0.08] bg-[#141414] p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-[#5A5A5E]" />
          <span className="font-mono uppercase text-[11px] font-semibold tracking-[0.10em] text-[#E5E5E5]">{t('consent.stayInformed')}</span>
        </div>
        <span className="font-mono uppercase text-[9px] font-semibold tracking-[0.12em] text-[#5A5A5E]">
          {t('consent.optional')}
        </span>
      </div>

      <div className="divide-y divide-white/[0.06]">
        {showNewsletter && (
          <ConsentRow
            icon={<Mail className="h-4 w-4" />}
            label={t('consent.emailOffers')}
            checked={newsletterOptIn}
            onToggle={() => onNewsletterChange(!newsletterOptIn)}
          />
        )}
        <ConsentRow
          icon={<MessageSquare className="h-4 w-4" />}
          label={t('consent.smsOffers')}
          checked={smsOptIn}
          onToggle={() => onSmsChange(!smsOptIn)}
        />
      </div>
    </div>
  );
}

function ConsentRow({
  icon,
  label,
  checked,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-3 w-full text-left py-2.5 transition-colors"
    >
      <span
        className={[
          'shrink-0 h-5 w-5 rounded-[4px] border flex items-center justify-center transition-colors',
          checked ? 'bg-primary border-primary' : 'bg-transparent border-white/25',
        ].join(' ')}
      >
        {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
      </span>
      <span className="text-[#5A5A5E] shrink-0">{icon}</span>
      <span className="text-sm text-[#9A9A9A] leading-snug">{label}</span>
    </button>
  );
}
