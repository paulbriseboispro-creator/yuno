/**
 * La logique des écrans Pages d'inscription, tirée du script du design
 * (`renderVals`, `newWz`, `defs`, `fill`, `publish`, `defRel`) et branchée sur
 * les vraies pages : l'assistant (brouillon local → enregistrement), le cycle
 * de vie affiché (ouverte le…, se ferme le…, prochaine étape), et les
 * messages de relance avec l'e-mail qui partira (blocs de l'Email Studio).
 */
import { makeBlock } from '@/lib/email/blocks';
import type { EmailBlock, EmailTheme } from '@/lib/email/types';
import { CRM_EMAIL_THEMES, venueAt } from '@/crm/lib/emailTemplates';
import type { SignupPageRow } from '@/crm/data/signupPages';
import type { NightRow } from '@/crm/data/nights';
import {
  DEFAULT_DESIGN, KIND_META, defaultReward, dt, fromLocalInput, lum, normalizeDesign, normalizeFields, parseOpts, toLocalInput, toStudioVars, tokens, venueOf,
} from '@/crm/signup/model';
import type { CloseMode, RelanceStep, RelanceStepId, SignupDesign, SignupFields, SignupKind, SignupRelance, SignupReward } from '@/crm/signup/model';
import { cap1 } from './signupUi';

type T = (key: string, vars?: Record<string, string | number | null | undefined>) => string;
type Lang = 'en' | 'fr' | 'es';

// ── L'assistant ────────────────────────────────────────────────────────────

/** Une question telle que l'assistant l'édite (réponses en une ligne, séparées par des virgules). */
export interface WzQuestion { q: string; raw: string; multi: boolean; party?: boolean }

export interface Wz {
  id: string | null;
  kind: SignupKind;
  /** La soirée Shotgun ; 'none' = prochaine date pas encore annoncée (liste d'attente) ; null = sans soirée. */
  eventId: string | 'none' | null;
  title: string; sub: string; btn: string; noted: string;
  touched: Partial<Record<'title' | 'sub' | 'btn' | 'noted', boolean>>;
  design: SignupDesign;
  poster: string;
  contact: SignupFields['contact'];
  extra: SignupFields['extra'];
  qs: WzQuestion[];
  reward: SignupReward;
  showCount: boolean;
  opens: 'now' | 'date';
  opensAt: string;
  saleAt: string;
  countdown: boolean;
  closes: CloseMode;
  closesAt: string;
  notify: boolean;
  ch: { email: boolean; sms: boolean };
  /** Étapes de relance déjà réglées (gardées à la modification). */
  relance: SignupRelance;
  status: SignupPageRow['status'] | null;
}

export function partyQuestion(t: T): WzQuestion {
  return { q: t('yc.sp.w.qParty'), raw: t('yc.sp.w.qPartyOpts'), multi: false, party: true };
}
export function styleQuestion(t: T): WzQuestion {
  return { q: t('yc.sp.w.qStyle'), raw: t('yc.sp.w.qStyleOpts'), multi: true };
}

/** La soirée proposée par défaut pour un type (comme `newWz` du design). */
export function defaultEventFor(kind: SignupKind, nights: NightRow[]): string | 'none' | null {
  if (kind === 'communaute') return null;
  const up = nights.filter((n) => n.upcoming);
  if (kind === 'attente') return up.find((n) => n.sold_out)?.id ?? 'none';
  return up[0]?.id ?? null;
}

/** Demain à 18:00 (heure de l'appareil), pour une prévente sans date de vente connue. */
function tomorrowAt18(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  return toLocalInput(d.toISOString());
}

export function newWz(kind: SignupKind, nights: NightRow[], t: T, base?: Partial<Wz>): Wz {
  const eventId = base?.eventId !== undefined ? base.eventId : defaultEventFor(kind, nights);
  const night = nights.find((n) => n.id === eventId) ?? null;
  const sale = night?.sale_opens_at && Date.parse(night.sale_opens_at) > Date.now() ? toLocalInput(night.sale_opens_at) : tomorrowAt18();
  const wz: Wz = {
    id: null, kind, eventId, title: '', sub: '', btn: '', noted: '', touched: {},
    design: { ...DEFAULT_DESIGN }, poster: '',
    contact: 'both', extra: {},
    qs: kind === 'venue' ? [partyQuestion(t)] : [styleQuestion(t)],
    reward: defaultReward(kind), showCount: false,
    opens: 'now', opensAt: '', saleAt: sale, countdown: true,
    closes: KIND_META[kind].closes[0], closesAt: '',
    notify: true, ch: { email: true, sms: false }, relance: {}, status: null,
    ...base,
  };
  return wz;
}

/** Les textes par défaut d'une page, selon le type, la soirée, la récompense (fonction `defs`). */
export function defaultTexts(wz: Wz, nights: NightRow[], host: string, t: T, lang: Lang): Pick<Wz, 'title' | 'sub' | 'btn' | 'noted'> {
  const night = nights.find((n) => n.id === wz.eventId) ?? null;
  const reward = rewardFanText(wz.reward, t);
  const of = venueOf(host, lang);
  const title = wz.kind === 'communaute' ? t('yc.sp.ty.communaute.title', { club: host, of }) : night ? night.title : t('yc.sp.w.nightNone');
  const sub = wz.kind === 'attente' && wz.eventId === 'none' ? t('yc.sp.ty.attente.subTba')
    : wz.kind === 'communaute' ? (wz.reward.on ? t('yc.sp.ty.communaute.subReward', { club: host, of, reward: reward.toLowerCase() }) : t('yc.sp.ty.communaute.subPlain', { club: host, of }))
    : wz.kind === 'attente' && !night?.sold_out ? t('yc.sp.ty.attente.subOpen')
    : t(`yc.sp.ty.${wz.kind}.sub`);
  return { title, sub, btn: t(`yc.sp.ty.${wz.kind}.btn1`), noted: t(`yc.sp.ty.${wz.kind}.noted`) };
}

/** Remplit les textes que le pro n'a pas encore touchés (fonction `fill`). */
export function fillWz(wz: Wz, nights: NightRow[], host: string, t: T, lang: Lang): Wz {
  const d = defaultTexts(wz, nights, host, t, lang);
  const o = { ...wz };
  (['title', 'sub', 'btn', 'noted'] as const).forEach((k) => { if (!wz.touched[k]) o[k] = k === 'title' ? d.title.slice(0, 40) : d[k]; });
  return o;
}

export function rewardFanText(r: SignupReward, t: T): string {
  if (r.preset === 'custom') return r.label || t('yc.sp.rw.customFan');
  return t(`yc.sp.rw.${r.preset}.fan`);
}

/** Une page enregistrée → l'assistant (« Modifier »). */
export function wzFromPage(p: SignupPageRow, nights: NightRow[], t: T): Wz {
  const f = normalizeFields(p.fields);
  const open = p.relance?.open;
  return newWz(p.kind, nights, t, {
    id: p.id, status: p.status,
    eventId: p.event_id ?? (p.kind === 'attente' ? 'none' : null),
    title: p.title, sub: p.tagline, btn: p.button_label, noted: p.thanks_message,
    touched: { title: true, sub: true, btn: true, noted: true },
    design: normalizeDesign(p.design),
    poster: p.poster_url ?? '',
    contact: f.contact, extra: f.extra,
    qs: f.questions.map((q) => ({ q: q.label, raw: q.options.join(', '), multi: q.multi, ...(q.party ? { party: true } : {}) })),
    reward: p.reward ? { ...defaultReward(p.kind), ...p.reward } : defaultReward(p.kind),
    showCount: p.show_count,
    opens: p.opens_at && Date.parse(p.opens_at) > Date.now() ? 'date' : 'now',
    opensAt: toLocalInput(p.opens_at),
    saleAt: p.sale_opens_at ? toLocalInput(p.sale_opens_at) : tomorrowAt18(),
    countdown: p.countdown,
    closes: p.closes_mode,
    closesAt: toLocalInput(p.closes_at),
    notify: open ? !!open.on : true,
    ch: { email: open ? !!open.email : true, sms: open ? !!open.sms : false },
    relance: p.relance ?? {},
  });
}

export interface WzCheck { oks: [boolean, boolean, boolean, boolean]; miss: string[]; qsOk: boolean; okDates: boolean; rewardOk: boolean }

export function checkWz(wz: Wz, t: T): WzCheck {
  const qsOk = wz.qs.every((q) => q.q.trim() && parseOpts(q.raw).length >= 2);
  const now = Date.now();
  const okDates = (wz.opens !== 'date' || !!wz.opensAt)
    && (wz.closes !== 'date' || (!!wz.closesAt && (Date.parse(wz.closesAt) > now)))
    && (wz.kind !== 'prevente' || !!wz.saleAt)
    && !(wz.opens === 'date' && wz.closes === 'date' && wz.closesAt && wz.opensAt >= wz.closesAt)
    && !(wz.closes === 'eve' && (!wz.eventId || wz.eventId === 'none'));
  const ok1 = !(KIND_META[wz.kind].night && wz.kind !== 'attente' && (!wz.eventId || wz.eventId === 'none'));
  const ok2 = wz.title.trim().length > 0 && wz.btn.trim().length > 0;
  const rewardOk = !wz.reward.on || wz.reward.preset !== 'custom' || !!wz.reward.label.trim();
  const ok3 = qsOk && okDates && rewardOk && (!wz.notify || wz.ch.email || wz.ch.sms);
  const miss: string[] = [];
  if (!ok1) miss.push(t('yc.sp.w.m.night'));
  if (!wz.title.trim()) miss.push(t('yc.sp.w.m.title'));
  if (!wz.btn.trim()) miss.push(t('yc.sp.w.m.btn'));
  if (!rewardOk) miss.push(t('yc.sp.w.m.reward'));
  if (!qsOk) miss.push(t('yc.sp.w.m.qs'));
  if (!okDates) miss.push(t('yc.sp.w.m.dates'));
  if (wz.notify && !wz.ch.email && !wz.ch.sms) miss.push(t('yc.sp.w.m.channel'));
  return { oks: [ok1, true, ok2, ok3], miss, qsOk, okDates, rewardOk };
}

/** Les champs tels que la base les enregistre. */
export function wzFields(wz: Wz): SignupFields {
  return {
    contact: wz.contact,
    extra: wz.extra,
    questions: wz.qs.map((q) => ({ label: q.q.trim(), options: parseOpts(q.raw), multi: q.multi, ...(q.party ? { party: true } : {}) })),
  };
}

// ── Relance ────────────────────────────────────────────────────────────────

export interface RelanceCtx { kind: SignupKind; title: string; host: string; lang: Lang; t: T; reward: string; accent: string; ctaUrl: string | null; logo: string | null }

/** Le message par défaut d'une étape (« {prénom} » reste à remplacer). */
export function defaultRelanceMsg(step: RelanceStepId, c: Omit<RelanceCtx, 'accent' | 'ctaUrl' | 'logo'>): string {
  const vars = { title: c.title, club: c.host, at: venueAt(c.host, c.lang), of: venueOf(c.host, c.lang), reward: c.reward };
  if (step === 'open') return c.t(`yc.sp.ty.${c.kind}.msg`, vars);
  return c.t(step === 'nudge' ? 'yc.sp.rl.nudgeMsg' : 'yc.sp.rl.lastMsg', vars);
}

/** Les étapes de relance par défaut d'une page (fonction `defRel` du design). */
export function defaultRelance(c: Omit<RelanceCtx, 'accent' | 'ctaUrl' | 'logo'>, open: { on: boolean; email: boolean; sms: boolean }): SignupRelance {
  return {
    open: { on: open.on, email: open.email, sms: open.sms, msg: defaultRelanceMsg('open', c) },
    nudge: { on: c.kind === 'prevente' || c.kind === 'attente', email: true, sms: false, delay: '48h', msg: defaultRelanceMsg('nudge', c) },
    last: { on: false, email: true, sms: false, delay: '2d', msg: defaultRelanceMsg('last', c) },
  };
}

/** Le thème de l'e-mail : le thème clair de la Console, à l'accent de la page s'il se lit sur blanc. */
export function relanceTheme(accent: string): EmailTheme {
  const base = { ...CRM_EMAIL_THEMES.clair };
  if (/^#[0-9a-f]{6}$/i.test(accent) && lum(accent) < 0.45) base.accent = accent;
  return base;
}

/**
 * L'e-mail d'une étape, en blocs de l'Email Studio (rendu à l'envoi par le
 * même moteur que les campagnes) : en-tête du club, sur-titre « club · page »,
 * titre (« C'est ouvert. »), « Salut {{prénom}», le message, le bouton.
 */
export function relanceEmail(step: RelanceStepId, s: RelanceStep, c: RelanceCtx): Pick<RelanceStep, 'subject' | 'email_blocks' | 'email_theme' | 'cta_url'> & { preheader: string; email_logo: string | null } {
  const vars = { title: c.title, club: c.host, at: venueAt(c.host, c.lang), of: venueOf(c.host, c.lang), reward: c.reward };
  const head = step === 'open' ? c.t(`yc.sp.ty.${c.kind}.mailHead`) : c.t(step === 'nudge' ? 'yc.sp.rl.nudgeHead' : 'yc.sp.rl.lastHead');
  const subject = step === 'open' ? c.t(`yc.sp.ty.${c.kind}.subject`, vars) : c.t(step === 'nudge' ? 'yc.sp.rl.nudgeSubject' : 'yc.sp.rl.lastSubject', vars);
  const btn = c.t(`yc.sp.ty.${c.kind}.mailBtn`);
  const b = (type: Parameters<typeof makeBlock>[0], patch: Record<string, unknown>) => ({ ...makeBlock(type, { venueName: c.host, logoUrl: c.logo ?? undefined }), ...patch }) as EmailBlock;
  const blocks: EmailBlock[] = [
    b('header', { logoSize: 'md', py: 24 }),
    b('text', { body: `${c.host} · ${c.title}`, variant: 'kicker', size: 11, px: 32, py: 4 }),
    b('text', { body: head, variant: 'headline', size: 34, px: 32, py: 6 }),
    b('text', { body: `${c.t('yc.sp.ph.hi', { name: '{{prénom}}' })}\n${toStudioVars(s.msg)}`, size: 16, px: 32, py: 12 }),
  ];
  if (c.ctaUrl) blocks.push(b('cta', { label: btn, url: c.ctaUrl, radius: 999, align: 'left', full: false, px: 32, py: 20 }));
  return { subject: subject.slice(0, 150), preheader: s.msg.replace(/\{\s*pr[ée]nom\s*\}/gi, '').slice(0, 140), email_blocks: blocks, email_theme: relanceTheme(c.accent), cta_url: c.ctaUrl, email_logo: c.logo };
}

/** La relance prête à enregistrer : chaque étape avec son e-mail recomposé. */
export function relanceForSave(rel: SignupRelance, c: RelanceCtx): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  (['open', 'nudge', 'last'] as const).forEach((k) => {
    const s = rel[k];
    if (!s) return;
    const mail = relanceEmail(k, s, c);
    out[k] = { on: s.on, email: s.email, sms: s.sms, delay: s.delay ?? '', msg: s.msg.slice(0, 480), ...mail };
  });
  return out;
}

/** Le lien du bouton : billets (prévente, attente), adresse (venue), prochaine soirée (communauté). */
export function relanceCta(kind: SignupKind, ev: { ticket_url: string | null; venue?: string | null; street?: string | null; city?: string | null } | null, nextNightUrl: string | null, pageUrl: string): string | null {
  if (kind === 'venue') {
    const q = [ev?.venue, ev?.street, ev?.city].filter(Boolean).join(', ');
    return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : pageUrl;
  }
  if (kind === 'communaute') return nextNightUrl || pageUrl;
  return ev?.ticket_url || pageUrl;
}

// ── Le cycle de vie affiché ────────────────────────────────────────────────

/** « Mar. 6 oct. à 18:00 » (fiche, relance). */
export function dtAt(iso: string | null | undefined, locale: string, lang: Lang, tz?: string): string {
  const s = dt(iso, locale, tz);
  if (!s) return '…';
  return cap1(s).replace(' · ', lang === 'en' ? ' at ' : lang === 'es' ? ' a las ' : ' à ');
}

/** La veille de la soirée à 18:00 (« Jeu. 15 oct. à 18:00 »). */
export function eveLabel(nightDate: string | null | undefined, locale: string, lang: Lang): string {
  if (!nightDate) return '…';
  const d = new Date(`${nightDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  const day = cap1(d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }));
  return `${day}${lang === 'en' ? ' at ' : lang === 'es' ? ' a las ' : ' à '}18:00`;
}

export interface Life { a: string; b: string; c: string; pct: number; next: string }

export function pageLife(p: SignupPageRow, t: T, tp: (k: string, n: number, v?: Record<string, string | number>) => string, f: { locale: string; lang: Lang; dShort: (d: string) => string; n: (v: number) => string }): Life {
  const { locale, lang } = f;
  const now = Date.now();
  const started = p.opens_at && Date.parse(p.opens_at) <= now ? p.opens_at : (p.published_at ?? p.created_at);
  const closeAt = p.close_at;
  const noBuy = Math.max(0, p.n - (p.buyers ?? 0));
  const a = p.state === 'draft' ? t('yc.sp.lf.draftA')
    : p.state === 'scheduled' ? t('yc.sp.lf.opensOn', { d: dt(p.opens_at, locale) })
    : p.kind === 'communaute' ? t('yc.sp.lf.openSince', { d: f.dShort(started) }) : t('yc.sp.lf.openedOn', { d: f.dShort(started) });
  let b: string;
  if (p.state === 'closed') {
    const when = p.status === 'closed' ? p.updated_at : (closeAt ?? p.updated_at);
    b = t('yc.sp.lf.closedOn', { d: dt(when, locale) });
  } else if (p.closes_mode === 'manual') b = p.event_id ? t('yc.sp.lf.manual') : t('yc.sp.lf.manualTba');
  else if (p.closes_mode === 'never' || !closeAt) b = t('yc.sp.lf.never');
  else b = t('yc.sp.lf.closesOn', { d: dt(closeAt, locale) });
  let c = '';
  if (p.state === 'open' && closeAt) {
    const ms = Date.parse(closeAt) - now;
    const days = Math.round(ms / 864e5);
    c = days >= 1 ? tp('yc.sp.lf.inDays', days) : t('yc.sp.lf.inHours', { n: Math.max(1, Math.round(ms / 36e5)) });
  } else if (p.state === 'closed' && p.status !== 'closed' && p.closes_mode === 'sale') c = t('yc.sp.lf.atSale');
  let pct = 0;
  if (p.state === 'closed') pct = 1;
  else if (p.state === 'open') {
    if (closeAt) {
      const s0 = Date.parse(started), s1 = Date.parse(closeAt);
      pct = s1 > s0 ? Math.max(0, Math.min(1, (now - s0) / (s1 - s0))) : 1;
    } else pct = 1;
  }
  const relOpen = p.relance?.open;
  const msgOn = !!relOpen?.on && (!!relOpen.email || !!relOpen.sms);
  let next: string;
  if (p.state === 'draft') next = t('yc.sp.lf.nDraft');
  else if (p.state === 'scheduled') next = t('yc.sp.lf.nScheduled', { d: dtAt(p.opens_at, locale, lang) });
  else if (p.state === 'closed') next = p.kind === 'prevente' && p.sale_open ? t('yc.sp.lf.nClosedSale', { n: f.n(noBuy) }) : t('yc.sp.lf.nClosed');
  else if (p.kind === 'prevente') next = p.sale_open ? t('yc.sp.lf.nClosedSale', { n: f.n(noBuy) })
    : !msgOn ? t('yc.sp.lf.nPreventeNoMsg', { d: dtAt(p.sale_opens_at, locale, lang) })
    : p.n ? tp('yc.sp.lf.nPrevente', p.n, { d: dtAt(p.sale_opens_at, locale, lang), n: f.n(p.n) }) : t('yc.sp.lf.nPreventeZero', { d: dtAt(p.sale_opens_at, locale, lang) });
  else if (p.kind === 'venue') next = !msgOn ? t('yc.sp.lf.nVenueNoMsg')
    : p.n ? tp('yc.sp.lf.nVenue', p.n, { d: eveLabel(p.event?.night_date, locale, lang), n: f.n(p.n) }) : t('yc.sp.lf.nVenueZero', { d: eveLabel(p.event?.night_date, locale, lang) });
  else if (p.kind === 'attente') next = p.notified_at ? t('yc.sp.lf.nAttenteSent', { d: dtAt(p.notified_at, locale, lang) }) : t('yc.sp.lf.nAttente', { n: f.n(noBuy) });
  else next = t('yc.sp.lf.nCommunity');
  return { a, b, c, pct, next };
}

/** La fermeture affichée dans une ligne de la liste (`win` du design). */
export function rowWindow(p: SignupPageRow, life: Life, t: T): string {
  if (p.state === 'scheduled' || p.state === 'draft') return life.a;
  if (p.state === 'closed') return life.b;
  return life.c ? t('yc.sp.l.closesIn', { c: life.c }) : life.b;
}

/** L'accent d'une page (pour l'e-mail de relance). */
export function pageAccent(design: SignupDesign): string {
  return tokens(design).a;
}

export { fromLocalInput };
