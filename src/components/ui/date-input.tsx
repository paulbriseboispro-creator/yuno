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
const DEFAULT_ORDER: Segment[] = ['d', 'm', 'y'];

/**
 * The typing order comes from the DEVICE locale, not from the UI language.
 *
 * It used to be hardcoded per language — `en` meant month-first — which silently
 * killed every checkout by a European buyer reading the app in English: typed
 * day-first, `23 / 10 / 2007` was read as month 23, resolved to nothing, and the
 * field kept displaying the date while the pay button stayed locked. A French
 * phone types day-first whatever language it browses in, and so does a British
 * one; only the device knows. Ask the platform which order it writes dates in
 * rather than guessing from the translation in use.
 */
function resolveOrder(): Segment[] {
  try {
    const locale = typeof navigator !== 'undefined' ? navigator.language : undefined;
    const parts = new Intl.DateTimeFormat(locale || undefined).formatToParts(new Date(2000, 0, 2));
    const order = parts
      .map((p) => (p.type === 'day' ? 'd' : p.type === 'month' ? 'm' : p.type === 'year' ? 'y' : null))
      .filter((s): s is Segment => s !== null);
    return order.length === 3 ? order : DEFAULT_ORDER;
  } catch {
    return DEFAULT_ORDER;
  }
}

/** The `dd / mm / yyyy` hint for an order, in the reader's own language. */
function formatHint(order: Segment[], t: (key: string) => string): string {
  const key: Record<Segment, string> = {
    d: 'common.dateSegDay',
    m: 'common.dateSegMonth',
    y: 'common.dateSegYear',
  };
  return order.map((seg) => t(key[seg])).join(' / ');
}

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

/** ISO `yyyy-mm-dd` for a real calendar date, otherwise ''. */
function buildISO(dd: string, mm: string, yyyy: string): string {
  const d = Number(dd);
  const m = Number(mm);
  const y = Number(yyyy);
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1) return '';
  // Reject non-existent dates (e.g. 31/02): round-trip through Date.
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return '';
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * ISO `yyyy-mm-dd` for a complete, valid date — otherwise ''.
 *
 * Reads the digits in the device's order first. If that reading is IMPOSSIBLE
 * (a 23rd month), day and month are swapped and read the other way round: a
 * buyer who types their real birth date in the other convention gets through
 * instead of hitting a wall. A reading that already works is never
 * second-guessed, so an ambiguous `03 / 10 / 2007` stays exactly what the
 * device's format says it is — we rescue the impossible, we don't reinterpret
 * the valid.
 */
function parseDigits(digits: string, order: Segment[]): string {
  if (digits.length !== 8) return '';
  const vals: Record<Segment, string> = { d: '', m: '', y: '' };
  let i = 0;
  for (const seg of order) {
    vals[seg] = digits.slice(i, i + SEGMENT_LEN[seg]);
    i += SEGMENT_LEN[seg];
  }
  return buildISO(vals.d, vals.m, vals.y) || buildISO(vals.m, vals.d, vals.y);
}

/**
 * Date-of-birth field that is *typed*, not picked.
 *
 * We render a real text input that accepts digits only and masks them into the
 * device date format (`JJ / MM / AAAA` on a French phone) as the user types —
 * separators are inserted for them, so they never type a slash.
 * `inputMode="numeric"` makes mobile show the number keypad for this field
 * instead of the full keyboard.
 *
 * The public contract is ISO-in / ISO-out: `value` is `yyyy-mm-dd` and `onChange`
 * fires with `e.target.value` set to the ISO string (or '' until a valid full
 * date is entered), so consumers don't change. A full date that resolves to
 * nothing says so under the field: emitting '' in silence is what let a filled-in
 * field sit next to a "enter your date of birth" message with no way out.
 */
const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ className, value, placeholderHint, onChange, max, ...props }, ref) => {
    const { t } = useLanguage();
    const order = React.useMemo(resolveOrder, []);
    const raw = value == null ? '' : String(value);
    const hint = placeholderHint ?? formatHint(order, t);
    const maxISO = max == null ? '' : String(max);

    const [digits, setDigits] = React.useState(() => isoToDigits(raw, order));

    // `max` is an ISO bound (callers pass today's date to forbid a birth date in
    // the future). ISO strings compare chronologically, so this is a plain string
    // comparison. It used to be dropped on the floor, which let a future date
    // through to the age gate and got answered with "you must be of legal age".
    const toISO = React.useCallback(
      (d: string) => {
        const iso = parseDigits(d, order);
        if (!iso) return '';
        return maxISO && iso > maxISO ? '' : iso;
      },
      [order, maxISO],
    );

    // Re-sync local digits only when the parent pushes a value (or a language
    // change) that no longer matches what we're showing. Partial typing emits
    // ISO '' upstream, which must not wipe the half-typed digits here.
    React.useEffect(() => {
      const currentISO = toISO(digits);
      if (raw && raw !== currentISO) {
        setDigits(isoToDigits(raw, order));
      } else if (!raw && currentISO) {
        setDigits('');
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [raw]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value.replace(/\D/g, '').slice(0, 8);
      setDigits(next);
      const iso = toISO(next);
      onChange?.({
        ...e,
        target: { ...e.target, value: iso },
        currentTarget: { ...e.currentTarget, value: iso },
      } as React.ChangeEvent<HTMLInputElement>);
    };

    // A complete date that resolves to nothing: either it isn't a real calendar
    // date, or it's past the allowed bound. Both get named — a full field that
    // blocks the purchase without a word is the bug this component just had.
    const complete = digits.length === 8;
    const parsed = complete ? parseDigits(digits, order) : '';
    const beyondMax = !!parsed && !!maxISO && parsed > maxISO;
    const unparseable = complete && !parsed;

    return (
      <div className="w-full">
        <div
          className={cn(
            'relative flex h-11 w-full items-center gap-2 overflow-hidden rounded-lg border border-white/[0.08] bg-[#1F1F22] px-3 transition-colors focus-within:border-primary/50',
            className,
            (unparseable || beyondMax) && 'border-primary/60',
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
            aria-invalid={unparseable || beyondMax}
            className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-[#6B6B70] md:text-sm"
            {...props}
          />
          <Calendar aria-hidden="true" className="pointer-events-none h-4 w-4 shrink-0 text-primary/80" />
        </div>
        {(unparseable || beyondMax) && (
          <p className="mt-1.5 text-[11px] text-primary">
            {beyondMax ? t('common.dateInFuture') : `${t('common.dateInvalid')} ${hint}`}
          </p>
        )}
      </div>
    );
  },
);
DateInput.displayName = 'DateInput';

export { DateInput };
