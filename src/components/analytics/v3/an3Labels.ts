/** Libellés partagés : « vs sam. 17 sept. », « vs médiane des 5 samedis », « 30 j d'avant ». */
import type { An3Insight, An3Overview } from '@/lib/analytics/an3Types';
import { an3Locale, compactNumber } from '@/lib/analytics/an3Format';

export function compareLabel(t: (k: string) => string, language: string, cmp: An3Overview['compare']): string {
  const locale = an3Locale(language);
  const dateFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  switch (cmp.kind) {
    case 'comparable': return cmp.ref_event ? t('an3.vs.night').replace('{date}', dateFmt.format(new Date(cmp.ref_event.start_at))) : '';
    case 'previous': return cmp.ref_event ? t('an3.vs.previousNight').replace('{date}', dateFmt.format(new Date(cmp.ref_event.start_at))) : '';
    case 'median': return t('an3.vs.median').replace('{n}', String(cmp.n));
    case 'median_loose': return t('an3.vs.medianLoose').replace('{n}', String(cmp.n));
    case 'yoy': return t('an3.vs.yoy');
    case 'previous_period': return t('an3.vs.previousPeriod');
    default: return '';
  }
}

export function subjectLabel(t: (k: string) => string, language: string, subject: An3Overview['subject']): string {
  const locale = an3Locale(language);
  if (subject.kind === 'event') {
    const d = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(subject.event.start_at));
    return `${subject.event.title} · ${d}`;
  }
  const f = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  return `${f.format(new Date(subject.from))} → ${f.format(new Date(subject.to))}`;
}

/** Le nom d'une source dans la langue de l'écran ; une source inconnue s'affiche telle quelle. */
export function sourceLabel(t: (k: string) => string, source: string): string {
  const key = `an3.source.${source}`;
  const v = t(key);
  return v === key ? source : v;
}

/** Le texte d'un constat, paramètres remplacés dans la langue de l'écran. */
export function insightText(t: (k: string) => string, language: string, i: An3Insight): string {
  const locale = an3Locale(language);
  const p = i.params;
  const n = (k: string) => compactNumber(Number(p[k] ?? 0), locale);
  let s = t(`an3.ins.${i.key}`);
  for (const [k, v] of Object.entries(p)) {
    let val = v == null ? '' : String(v);
    if (k === 'source') val = sourceLabel(t, String(v));
    if (k === 'weekday') val = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(Date.UTC(2024, 0, Number(v), 12)));
    if (['n', 'tickets', 'ref', 'qty', 'checkouts'].includes(k)) val = n(k);
    if (k === 'hour') val = `${String(v).padStart(2, '0')}h–${String((Number(v) + 3) % 24).padStart(2, '0')}h`;
    s = s.split(`{${k}}`).join(val);
  }
  return s;
}

