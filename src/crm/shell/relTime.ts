/**
 * Temps relatif des notifications : « À l’instant », « Il y a 12 min »,
 * « Il y a 3 h », « Hier · 18:20 », puis « sam. 26 sept. · 14:02 ».
 */
import { useCallback } from 'react';
import { useCrmT } from '@/crm/i18n';

export function useRelTime() {
  const { t, time, dWeek } = useCrmT();
  return useCallback((iso: string, now: Date = new Date()) => {
    const d = new Date(iso);
    const diff = now.getTime() - d.getTime();
    const sod = new Date(now); sod.setHours(0, 0, 0, 0);
    if (d >= sod) {
      if (diff < 60_000) return t('yc.notif.justNow');
      const m = Math.floor(diff / 60_000);
      return m < 60 ? t('yc.notif.minAgo', { n: m }) : t('yc.notif.hAgo', { n: Math.floor(m / 60) });
    }
    const y = new Date(sod.getTime() - 86_400_000);
    if (d >= y) return t('yc.notif.yesterday', { time: time(d) });
    const w = dWeek(d);
    return `${w.charAt(0).toUpperCase()}${w.slice(1)} · ${time(d)}`;
  }, [t, time, dWeek]);
}
