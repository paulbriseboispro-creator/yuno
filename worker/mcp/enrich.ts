// Les constats que la base calcule déjà (« À retenir » du rapport de soirée et
// de Ventes, signaux d'analyse) arrivent comme { key, params } : l'écran les
// traduit avec ses clés i18n (so.tk.*, er.tk.*). Une IA, elle, devrait deviner
// ce que veut dire `channel_gap`. On lui donne la phrase, avec les chiffres,
// dans les mêmes termes que la Console (textes anglais de en.ts).
//
// Une phrase dont un paramètre manque n'est pas écrite : le constat reste
// brut, jamais faux. Pur et testé.

import { DRINKS_PILLAR_LIVE } from './config';

type Params = Record<string, unknown>;

const PILLAR_NAMES: Record<string, string> = { tickets: 'Tickets', tables: 'Tables', bar: 'The bar', guestList: 'Guest list' };

const TEMPLATES: Record<string, (p: Params) => string | null> = {
  gl_no_show: (p) => fill('Guest list: {pct}% of sign-ups showed up, {missing} empty spots.', p),
  presence_low: (p) => fill('{pct}% of expected guests got in: {missing} did not come.', p),
  spend_up: (p) => fill('Spend per head is up to {now} EUR (+{pct}% vs {prev} EUR before).', p),
  spend_down: (p) => fill('Spend per head is down to {now} EUR (-{pct}% vs {prev} EUR before).', p),
  mix_shift: (p) => {
    const name = PILLAR_NAMES[String(p.pillar)];
    return name ? fill(`${name} now make up {pct}% of revenue, vs {prev}% before.`, p) : null;
  },
  day_of: (p) => fill('{pct}% bought on the day of the event itself: the last-minute sale matters.', p),
  no_show: (p) => fill('{missing} expected guests did not come: {pct}% turnout.', p),
  msg_drove: (p) => fill(`The ${String(p.channel ?? p.kind ?? 'message')} "{title}" brought {n} sales and sign-ups ({pct}% of the total).`, p),
  low_conversion: (p) => fill('{visits} visits, but only {pct}% end with a purchase: the page or the prices hold people back.', p),
  visit_source: (p) => fill('First source of visits: {source} ({pct}%).', p),
  mostly_new: (p) => fill('{pct}% of the crowd came for the first time.', p),
  mostly_returning: (p) => fill('{pct}% of the crowd had come before: regulars carry the night.', p),
  pacing_behind: (p) => fill('At D-{d}, {tickets} tickets sold vs {ref} for comparable events at the same point (-{pct}%).', p),
  pacing_ahead: (p) => fill('At D-{d}, sales are {pct}% ahead of comparable events at the same point.', p),
  tier_gone_fast: (p) => fill('Tier "{name}" ({qty} tickets) sold out in {hours} h: it was likely underpriced or too small.', p),
  buy_timing: (p) => fill('{pct}% of {n} purchases happen on the same weekday (ISO {weekday}: 1 = Monday, 7 = Sunday), peak around {hour}:00.', p),
  channel_gap: (p) => fill('{source} brings {visits_pct}% of visits but {sales_pct}% of sales: this traffic does not convert.', p),
  checkout_leak: (p) => fill('Only {pct}% of {checkouts} started checkouts end with a payment.', p),
  guest_list_no_show: (p) => fill('Guest list turnout is {gl}% vs {tickets}% for tickets ({factor}x lower).', p),
  zone_minimums: (p) => fill('Table zone "{top}" spends {top_x}x its minimum while "{low}" spends {low_x}x: rebalance minimums or prices.', p),
  pillars_not_booked: (p) => fill('{n} of your best customers have not booked for "{title}" yet: invite them personally.', p),
};

function fmt(v: unknown): string | null {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
  if (typeof v === 'string' && v !== '') return v;
  return null;
}

function fill(template: string, p: Params): string | null {
  let missing = false;
  const out = template.replace(/\{([a-z_]+)\}/gi, (_, k: string) => {
    const v = fmt(p[k]);
    if (v === null) missing = true;
    return v ?? '';
  });
  return missing ? null : out;
}

function isFinding(v: unknown): v is { key: string; params?: Params } {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { key?: unknown }).key === 'string';
}

// Parcourt le résultat et ajoute `text` à chaque constat reconnu ; retire ceux
// du pilier boissons tant qu'il est en pause.
export function explainFindings(value: unknown, depth = 0): unknown {
  if (depth > 10 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value
      .filter((v) => DRINKS_PILLAR_LIVE || !(isFinding(v) && (v.params?.pillar === 'bar' || (v as { pillar?: unknown }).pillar === 'bar')))
      .map((v) => {
        if (isFinding(v) && v.params && typeof v.params === 'object') {
          const render = TEMPLATES[v.key];
          const text = render ? render(v.params) : null;
          return text ? { ...v, text } : v;
        }
        return explainFindings(v, depth + 1);
      });
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = explainFindings(v, depth + 1);
  return out;
}
