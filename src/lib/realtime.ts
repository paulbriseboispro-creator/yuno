/**
 * Build a unique Supabase realtime channel topic.
 *
 * Supabase memoizes channels by topic name, so a hardcoded topic gets reused
 * whenever a component mounts more than once: responsive dual-renders (a
 * component placed in both a `hidden sm:block` and a `sm:hidden` wrapper),
 * React StrictMode remounts, or two pages mounting the same hook at once.
 * The reused channel is already subscribed, so the second `.on('postgres_changes', …)`
 * runs after `.subscribe()` and throws:
 *
 *   "cannot add `postgres_changes` callbacks for realtime:<topic> after `subscribe()`"
 *
 * That throw happens inside a `useEffect`, so React's ErrorBoundary catches it
 * and the whole page renders "Une erreur est survenue." Appending a per-mount
 * random suffix guarantees every mount gets its own channel object. Cleanup
 * still works: `supabase.removeChannel(channel)` removes by object reference,
 * not by name.
 */
export const uniqueChannel = (base: string): string =>
  `${base}-${Math.random().toString(36).slice(2)}`;
