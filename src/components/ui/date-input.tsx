import * as React from 'react';
import { Calendar } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

interface DateInputProps extends Omit<React.ComponentProps<'input'>, 'type'> {
  /** Overlaid hint shown while the field is empty (defaults to the locale date format). */
  placeholderHint?: string;
}

const LOCALES: Record<string, string> = { en: 'en-US', fr: 'fr-FR', es: 'es-ES' };

/** Format an ISO `yyyy-mm-dd` value for display without timezone drift. */
function formatDisplay(value: string, language: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(LOCALES[language] ?? language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/**
 * Date-of-birth field that always reads as a tappable calendar.
 *
 * iOS Safari renders a native <input type="date"> with its own width and
 * alignment (value centered, control overflowing its container) that CSS can't
 * reliably tame. So instead of styling the native control, we draw the visible
 * field ourselves — a plain div with the formatted date (or a format hint) and
 * a calendar icon — and layer a transparent native date input on top purely to
 * capture the tap and open the iOS picker. The design is fully ours; iOS's
 * native rendering never shows.
 */
const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ className, value, placeholderHint, ...props }, ref) => {
    const { t, language } = useLanguage();
    const raw = value == null ? '' : String(value);
    const isEmpty = raw === '';
    const hint = placeholderHint ?? t('common.dateFormatHint');
    const display = isEmpty ? hint : formatDisplay(raw, language);

    return (
      <div
        className={cn(
          // A plain box we fully control: it always respects its width and never
          // inherits the native date control's sizing or centering.
          'relative flex h-11 w-full items-center gap-2 overflow-hidden rounded-lg border border-white/[0.08] bg-[#1F1F22] px-3 transition-colors focus-within:border-primary/50',
          className,
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex-1 truncate text-base md:text-sm',
            isEmpty ? 'text-[#6B6B70]' : 'text-white',
          )}
        >
          {display}
        </span>
        <Calendar aria-hidden="true" className="h-4 w-4 shrink-0 text-primary/80" />
        {/* Invisible native date input: captures the tap, opens the iOS picker,
            renders nothing itself so the box above stays pixel-exact. */}
        <input
          ref={ref}
          type="date"
          value={value}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          {...props}
        />
      </div>
    );
  },
);
DateInput.displayName = 'DateInput';

export { DateInput };
