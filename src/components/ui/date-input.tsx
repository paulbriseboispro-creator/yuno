import * as React from 'react';
import { Calendar } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

interface DateInputProps
  extends Omit<React.ComponentProps<'input'>, 'type' | 'value' | 'onChange'> {
  /** ISO `yyyy-mm-dd` value (or '' while empty/incomplete). */
  value?: string;
  /**
   * Fires with a synthetic change event whose `target.value` is the ISO
   * `yyyy-mm-dd` string once a full, valid date is typed (and '' otherwise),
   * so existing consumers keep reading `e.target.value` unchanged.
   */
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  /** Overlaid hint shown while the field is empty (defaults to the locale date format). */
  placeholderHint?: string;
}

type Segment = 'd' | 'm' | 'y';
const SEGMENT_LEN: Record<Segment, number> = { d: 2, m: 2, y: 4 };

// Typing order follows each locale's displayed format. en is month-first
// (MM / DD / YYYY); fr/es are day-first (JJ|DD / MM / AAAA).
const SEGMENT_ORDER: Record<string, Segment[]> = {
  en: ['m', 'd', 'y'],
};
const DEFAULT_ORDER: Segment[] = ['d', 'm', 'y'];

/** Pull the digit string (in `order`) out of an ISO `yyyy-mm-dd` value. */
function isoToDigits(iso: string, order: Segment[]): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  const parts: Record<Segment, string> = { y: m[1], m: m[2], d: m[3] };
  return order.map((seg) => parts[seg]).join('');
}

/** Lay out a digit string into `dd / mm / yyyy` (locale order) as the user types. */
function formatTyped(digits: string, order: Segment[]): string {
  const parts: string[] = [];
  let i = 0;
  for (const seg of order) {
    if (i >= digits.length) break;
    parts.push(digits.slice(i, i + SEGMENT_LEN[seg]));
    i += SEGMENT_LEN[seg];
  }
  return parts.join(' / ');
}

/** ISO `yyyy-mm-dd` for a complete, real calendar date — otherwise ''. */
function toISO(digits: string, order: Segment[]): string {
  if (digits.length !== 8) return '';
  const vals: Record<Segment, string> = { d: '', m: '', y: '' };
  let i = 0;
  for (const seg of order) {
    vals[seg] = digits.slice(i, i + SEGMENT_LEN[seg]);
    i += SEGMENT_LEN[seg];
  }
  const d = Number(vals.d);
  const m = Number(vals.m);
  const y = Number(vals.y);
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1) return '';
  // Reject non-existent dates (e.g. 31/02): round-trip through Date.
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return '';
  return `${vals.y}-${vals.m}-${vals.d}`;
}

/**
 * Date-of-birth field that is *typed*, not picked.
 *
 * We render a real text input that accepts digits only and masks them into the
 * locale date format (`JJ / MM / AAAA` in fr) as the user types — separators are
 * inserted for them, so they never type a slash. `inputMode="numeric"` makes
 * mobile show the number keypad for this field instead of the full keyboard.
 *
 * The public contract is ISO-in / ISO-out: `value` is `yyyy-mm-dd` and `onChange`
 * fires with `e.target.value` set to the ISO string (or '' until a valid full
 * date is entered), so consumers don't change.
 */
const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ className, value, placeholderHint, onChange, max: _max, ...props }, ref) => {
    const { t, language } = useLanguage();
    const order = SEGMENT_ORDER[language] ?? DEFAULT_ORDER;
    const raw = value == null ? '' : String(value);
    const hint = placeholderHint ?? t('common.dateFormatHint');

    const [digits, setDigits] = React.useState(() => isoToDigits(raw, order));

    // Re-sync local digits only when the parent pushes a value (or a language
    // change) that no longer matches what we're showing. Partial typing emits
    // ISO '' upstream, which must not wipe the half-typed digits here.
    React.useEffect(() => {
      const currentISO = toISO(digits, order);
      if (raw && raw !== currentISO) {
        setDigits(isoToDigits(raw, order));
      } else if (!raw && currentISO) {
        setDigits('');
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [raw, language]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value.replace(/\D/g, '').slice(0, 8);
      setDigits(next);
      const iso = toISO(next, order);
      onChange?.({
        ...e,
        target: { ...e.target, value: iso },
        currentTarget: { ...e.currentTarget, value: iso },
      } as React.ChangeEvent<HTMLInputElement>);
    };

    return (
      <div
        className={cn(
          'relative flex h-11 w-full items-center gap-2 overflow-hidden rounded-lg border border-white/[0.08] bg-[#1F1F22] px-3 transition-colors focus-within:border-primary/50',
          className,
        )}
      >
        <input
          ref={ref}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="bday"
          value={formatTyped(digits, order)}
          onChange={handleChange}
          placeholder={hint}
          className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-[#6B6B70] md:text-sm"
          {...props}
        />
        <Calendar aria-hidden="true" className="pointer-events-none h-4 w-4 shrink-0 text-primary/80" />
      </div>
    );
  },
);
DateInput.displayName = 'DateInput';

export { DateInput };
