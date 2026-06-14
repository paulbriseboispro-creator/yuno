import * as React from 'react';
import { Calendar } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

interface DateInputProps extends Omit<React.ComponentProps<typeof Input>, 'type'> {
  /** Overlaid format hint shown while the field is empty (defaults to the locale date format). */
  placeholderHint?: string;
}

/**
 * `type="date"` field that always reads as a tappable calendar.
 *
 * iOS Safari renders an empty <input type="date"> with only a faint native
 * "jj/mm/aaaa" hint and no icon, so on a dark background the field looks like a
 * dead grey box — users can't tell it opens a date picker. We hide the native
 * placeholder while empty, overlay a clearly visible format hint, and add a
 * calendar icon. The native webkit picker indicator is kept (just invisible)
 * underneath our icon so desktop click-to-open still works; on iOS, tapping the
 * field opens the picker natively.
 */
const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ className, value, placeholderHint, ...props }, ref) => {
    const { t } = useLanguage();
    const isEmpty = value === undefined || value === null || value === '';
    const hint = placeholderHint ?? t('common.dateFormatHint');
    return (
      <div className="relative">
        <Input
          ref={ref}
          type="date"
          value={value}
          className={cn(
            // The shared Input base is display:flex. iOS renders a flex
            // type="date" with its value centered and lets the control overflow
            // its container. Force a normal block box, keep it inside its width,
            // and left-align the native value so it reads like every other field.
            'block w-full min-w-0 pr-10 text-left',
            '[&::-webkit-calendar-picker-indicator]:opacity-0',
            '[&::-webkit-date-and-time-value]:m-0 [&::-webkit-date-and-time-value]:text-left',
            // Hide the faint native placeholder while empty so our overlay is the
            // only thing on screen; the picked value shows normally otherwise.
            isEmpty && '[&::-webkit-datetime-edit]:opacity-0',
            className,
          )}
          {...props}
        />
        {isEmpty && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-[#6B6B70] md:text-sm"
          >
            {hint}
          </span>
        )}
        <Calendar
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/80"
        />
      </div>
    );
  },
);
DateInput.displayName = 'DateInput';

export { DateInput };
