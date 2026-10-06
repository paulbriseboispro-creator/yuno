/**
 * La page d'inscription vue par le fan (« FanPage » du design, à l'identique) :
 * dix mises en page, quatre scènes (le formulaire, « C'est noté », le jour de
 * l'ouverture, page close) et une cinquième, « bientôt », pour une page
 * programmée. Le MÊME composant sert :
 *  - la page publique `/j/<slug>` (`mode="live"` : la vraie inscription) ;
 *  - l'aperçu du constructeur et de la fiche (`mode="preview"` : on peut la
 *    remplir, rien n'est enregistré) ;
 *  - les vignettes des gabarits (`mode="frozen"` : rien ne bouge).
 *
 * Le fan est tutoyé, comme dans le design. Les textes du pro (titre, accroche,
 * bouton, « C'est noté », réponses) arrivent tels quels dans `cfg`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useCrmT } from '@/crm/i18n';
import {
  COUNTRIES, composePhone, countryByCode, countryFromInternationalInput, countryFromTimezone,
} from '@/lib/countries';
import type { Country } from '@/lib/countries';
import {
  EXTRA_FIELD_INPUT, SP_ICON, activeExtras, countdownParts, dt, initials, rewardOf, titleSize, tokens, venueOf,
} from './model';
import type { ExtraField, SignupDesign, SignupFields, SignupKind, SignupReward } from './model';
import { buildPageTagData, customTokens, normalizeCustomDesign, sectionVisible } from './custom';
import type { CustomDesign, YunoSection } from './custom';
import CustomSection from './CustomSection';
import { useCustomFonts } from './useCustomFonts';

export type FanScene = 'form' | 'noted' | 'open' | 'closed' | 'soon';
export type FanMode = 'live' | 'preview' | 'frozen';

export interface FanCfg {
  kind: SignupKind;
  title: string;
  sub: string;
  btn: string;
  noted: string;
  design: SignupDesign;
  poster: string | null;
  club: string;
  /** « Sam. 17 oct. · 23:00 », ou « Date bientôt annoncée ». Absent pour la communauté. */
  date: string | null;
  /** « Le Bunker · Paris 11e ». */
  place: string;
  fields: SignupFields;
  reward: SignupReward;
  /** Ouverture de la vente (prévente) : compte à rebours, puis « C'est ouvert ». */
  saleAt: string | null;
  countdown: boolean;
  showCount: boolean;
  count: number;
  /** Liste d'attente : la soirée est complète. */
  full: boolean;
  ticketUrl?: string | null;
  opensAt?: string | null;
  /** Lien de la page (partage, calendrier). */
  pageUrl?: string | null;
  /** Soirée (calendrier). */
  eventStart?: string | null;
  eventEnd?: string | null;
  /** Pays proposé pour le téléphone (ISO alpha-2). */
  country?: string | null;
  /**
   * Design sur mesure (dessiné par l'IA du pro via le MCP, `custom.ts`) : il
   * remplace le gabarit. Lu tel qu'en base, normalisé et nettoyé ici.
   */
  custom?: CustomDesign | null;
  /** Marque de l'hôte, pour les balises d'un design sur mesure ({{host.logo}}…). */
  brand?: { logo?: string | null; city?: string | null; instagram?: string | null } | null;
  /** La soirée, pour les balises ({{event.venue}}, {{event.time}}…). */
  eventFacts?: { title: string; start_at: string; tz?: string | null; venue?: string | null; city?: string | null; poster?: string | null; ticket_url?: string | null; sold_out?: boolean } | null;
}


export type SubmitResult = 'ok' | 'already' | 'closed' | 'demo' | 'invalid_email' | 'invalid_phone' | 'disposable' | 'rate_limited' | 'consent_required' | 'invalid' | 'error';

export interface FanSubmit {
  first_name: string; last_name: string; email: string; phone: string; birthdate: string; instagram: string; city: string;
  answers: Record<string, string | string[]>; consent_text: string;
}

const okEmail = (c: string) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(c.trim());
const okPhone = (c: string) => c.replace(/\D/g, '').length >= 9;

function browserCountry(): Country | null {
  try { return countryFromTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { return null; }
}

export default function FanPage({ cfg, scene: sceneProp = 'form', mode = 'preview', onSubmit, onToast }: {
  cfg: FanCfg; scene?: FanScene; mode?: FanMode;
  onSubmit?: (v: FanSubmit) => Promise<SubmitResult>;
  /** Le toast d'un aperçu remonte à l'écran qui l'héberge (sinon il s'affiche dans la page). */
  onToast?: (msg: string) => void;
}) {
  const { t, lang, locale } = useCrmT();
  const custom = useMemo(() => normalizeCustomDesign(cfg.custom), [cfg.custom]);
  const K = useMemo(() => (custom ? customTokens(custom.theme) : tokens(cfg.design)), [custom, cfg.design]);
  useCustomFonts(custom?.theme);
  // Blocs Yuno placés par le design sur mesure : ils quittent leur place par défaut dans le formulaire.
  const placed = useMemo(() => new Set(custom ? custom.sections.filter((x): x is YunoSection => x.type === 'yuno').map((x) => x.block) : []), [custom]);
  const formSection = custom?.sections.find((x): x is YunoSection => x.type === 'yuno' && x.block === 'form');
  const wRef = useRef<HTMLDivElement>(null);
  const S = K.s, F = K.F, lay = K.lay;
  const frozen = mode === 'frozen';

  const [sub, setSub] = useState<null | 'noted'>(null);
  const [first, setFirst] = useState('');
  const [contact, setContact] = useState('');
  const [contact2, setContact2] = useState('');
  const [modeC, setModeC] = useState<'email' | 'phone'>('email');
  const [ans, setAns] = useState<Record<number, string | string[] | null>>({});
  const [ext, setExt] = useState<Partial<Record<ExtraField, string>>>({});
  const [consent, setConsent] = useState(false);
  const [tried, setTried] = useState(false);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [err, setErr] = useState('');
  const [country, setCountry] = useState<Country>(() => countryByCode(cfg.country) ?? browserCountry() ?? countryByCode('FR')!);
  const [now, setNow] = useState(() => Date.now());
  const scRef = useRef<HTMLDivElement>(null);
  const tToast = useRef<ReturnType<typeof setTimeout>>();

  // Compte à rebours vivant (jamais dans une vignette figée).
  useEffect(() => {
    if (frozen || !cfg.saleAt || cfg.kind !== 'prevente') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [frozen, cfg.saleAt, cfg.kind]);
  useEffect(() => () => clearTimeout(tToast.current), []);
  // Changer de scène ou de type remet la page en haut, comme le design.
  useEffect(() => {
    setSub(null);
    if (scRef.current) scRef.current.scrollTop = 0;
  }, [sceneProp, cfg.kind]);
  // Design sur mesure : la confirmation (dans le bloc formulaire) vient sous les yeux,
  // après l'inscription comme dans l'onglet « C'est noté » d'un aperçu.
  const notedNow = (sub ?? sceneProp) === 'noted';
  useEffect(() => {
    if (!custom || !notedNow || !wRef.current || !scRef.current) return;
    // Sous la barre d'état du téléphone d'aperçu (46 px), en haut de la page publique.
    scRef.current.scrollTop = Math.max(0, wRef.current.offsetTop - (mode === 'live' ? 16 : 62));
  }, [custom, notedNow, mode]);

  const flash = (m: string) => {
    if (onToast && mode !== 'live') { onToast(m); return; }
    setToast(m);
    clearTimeout(tToast.current);
    tToast.current = setTimeout(() => setToast(''), 2200);
  };

  const kind = cfg.kind;
  const club = cfg.club || 'Yuno';
  const title = cfg.title;
  const rem = cfg.saleAt && kind === 'prevente' ? Date.parse(cfg.saleAt) - now : 1;
  let scene: FanScene = sub ?? sceneProp;
  if (!sub && scene === 'form' && cfg.saleAt && kind === 'prevente' && rem <= 0 && !frozen) scene = 'open';
  const isForm = scene === 'form', isNoted = scene === 'noted', isOpen = scene === 'open', isClosed = scene === 'closed', isSoon = scene === 'soon';

  const cd = countdownParts(rem).map((v, i) => ({ v: String(v).padStart(2, '0'), l: t(`yc.sp.fan.cd.${['d', 'h', 'm', 's'][i]}`) }));
  const rw = rewardOf(cfg.reward);
  const rewardTxt = rw.isKey ? t(rw.fan) : (rw.fan || t('yc.sp.rw.customFan'));
  const rewardOn = cfg.reward.on;
  const cm = cfg.fields.contact, both = cm === 'both', all = cm === 'all';
  const cmode: 'email' | 'phone' = both ? modeC : cm === 'phone' ? 'phone' : 'email';
  const famOf = (n: 'body' | 'head' | 'mono') => (n === 'head' ? F.f + ',sans-serif' : n === 'mono' ? (K.id === 'terminal' ? "'Space Mono'" : "'Geist Mono'") + ',ui-monospace,monospace' : S.bodyF + ',system-ui,sans-serif');
  const okFirst = first.trim().length > 0;
  const okContact = all ? okEmail(contact) && okPhone(contact2) : cmode === 'email' ? okEmail(contact) : okPhone(contact);
  const extras = activeExtras(cfg.fields);
  const okExt = extras.every((x) => !x.req || (ext[x.id] || '').trim());
  const bdOf = (bad: boolean) => (bad ? K.errC : S.inBd);

  type In = { key: string; lab: string; opt: boolean; value: string; set: (v: string) => void; type: string; im: 'text' | 'email' | 'tel'; auto: string; bd: string; err: boolean; errT: string; modes: { l: string; on: boolean; pick: () => void }[]; phone?: boolean };
  const inputs: In[] = [{ key: 'first', lab: t('yc.sp.fan.first'), opt: false, value: first, set: setFirst, type: 'text', im: 'text', auto: 'given-name', bd: bdOf(tried && !okFirst), err: tried && !okFirst, errT: t('yc.sp.fan.eFirst'), modes: [] }];
  const mkEmail = (): In => ({ key: 'email', lab: t('yc.sp.fan.email'), opt: false, value: contact, set: setContact, type: 'email', im: 'email', auto: 'email', bd: bdOf(tried && !okEmail(contact)), err: tried && !okEmail(contact), errT: t('yc.sp.fan.eEmail'), modes: [] });
  if (all) {
    inputs.push(mkEmail());
    inputs.push({ key: 'phone', lab: t('yc.sp.fan.phone'), opt: false, value: contact2, set: setContact2, type: 'tel', im: 'tel', auto: 'tel', bd: bdOf(tried && !okPhone(contact2)), err: tried && !okPhone(contact2), errT: t('yc.sp.fan.ePhone'), modes: [], phone: true });
  } else {
    const isE = cmode === 'email', bad = tried && !okContact;
    inputs.push({
      key: 'contact', lab: both ? t('yc.sp.fan.where') : isE ? t('yc.sp.fan.email') : t('yc.sp.fan.phone'), opt: false, value: contact, set: setContact,
      type: isE ? 'email' : 'tel', im: isE ? 'email' : 'tel', auto: isE ? 'email' : 'tel', bd: bdOf(bad), err: bad, errT: isE ? t('yc.sp.fan.eEmail') : t('yc.sp.fan.ePhone'), phone: !isE,
      modes: both ? ([['email', t('yc.sp.fan.mEmail')], ['phone', t('yc.sp.fan.mPhone')]] as const).map(([k, l]) => ({ l, on: cmode === k, pick: () => { setModeC(k); setContact(''); } })) : [],
    });
  }
  const inputsEnd: In[] = [];
  for (const x of extras) {
    const bad = tried && x.req && !(ext[x.id] || '').trim();
    const def = EXTRA_FIELD_INPUT[x.id];
    const row: In = { key: x.id, lab: t(`yc.sp.fld.${x.id}.fan`), opt: !x.req, value: ext[x.id] || '', set: (v) => setExt((s) => ({ ...s, [x.id]: v })), type: def.type, im: 'text', auto: def.auto, bd: bdOf(bad), err: !!bad, errT: t('yc.sp.fan.eField'), modes: [] };
    if (x.id === 'nom') inputs.splice(1, 0, row);
    else if (x.id === 'ville') inputsEnd.push(row);
    else inputs.push(row);
  }

  const qs = cfg.fields.questions.map((q, qi) => {
    const cur = ans[qi];
    return {
      q: q.label,
      opts: q.options.map((o) => {
        const on = q.multi ? (Array.isArray(cur) ? cur : []).includes(o) : cur === o;
        return {
          t: o, on, bg: on ? K.a : 'transparent', fg: on ? K.aFg : K.k, bd: on ? K.a : S.chBd,
          pick: () => setAns((s) => {
            const a = { ...s };
            if (q.multi) { const l = Array.isArray(a[qi]) ? (a[qi] as string[]) : []; a[qi] = l.includes(o) ? l.filter((z) => z !== o) : [...l, o]; }
            else a[qi] = a[qi] === o ? null : o;
            return a;
          }),
        };
      }),
    };
  });

  const saleStr = dt(cfg.saleAt, locale).replace(' · ', lang === 'en' ? ' at ' : lang === 'es' ? ' a las ' : ' à ');
  const nameShown = first.trim() || t('yc.sp.fan.demoName');
  const steps = [
    t(`yc.sp.ty.${kind}.s1`),
    kind === 'prevente' ? (cfg.saleAt ? t('yc.sp.ty.prevente.s2', { sale: saleStr }) : t('yc.sp.ty.prevente.s2none'))
      : kind === 'communaute' ? (rewardOn ? t('yc.sp.ty.communaute.s2', { reward: rewardTxt }) : t('yc.sp.ty.communaute.s2none'))
      : t(`yc.sp.ty.${kind}.s2`),
    t(`yc.sp.ty.${kind}.s3`),
  ].map((txt, i) => ({ n: i + 1, txt, done: i === 0, bg: i === 0 ? K.a : 'transparent', fg: i === 0 ? K.aFg : K.kM, sh: i === 0 ? 'none' : 'inset 0 0 0 1.5px ' + K.kLine, c: i === 0 ? K.k : K.kM, bt: i === 0 ? '0' : '1px solid ' + K.kLine }));
  const isComm = kind === 'communaute', compact = isNoted;
  const badge = isOpen ? t('yc.sp.fan.badgeOpen') : isClosed ? t('yc.sp.fan.badgeClosed') : isSoon ? t('yc.sp.fan.badgeSoon')
    : kind === 'attente' && !cfg.full ? t('yc.sp.ty.attente.badgeOpen') : t(`yc.sp.ty.${kind}.badge`);
  const place = cfg.place || club;
  const kicker = isComm ? place : `${cfg.date ?? ''}${cfg.date ? ' · ' : ''}${place.split(' · ')[0]}`;
  const tSize = titleSize(S.hs, F.sc, title.length) + 'px';
  const nSize = Math.round(Math.min(34, S.hs * 0.8) * F.sc) + 'px';
  const outline = S.bMode === 'outline', square = /^0/.test(S.bRad), rd = (a: string) => (square ? '0' : a);
  const grad = S.grad ? `linear-gradient(110deg,${K.a},${K.b})` : K.a;
  const poster = cfg.poster || '';
  const arrow = !!S.arrow;
  const slugC = club.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_');
  const marq = `${club}  —  ${badge}  —  ${kicker}  —  `.toUpperCase().repeat(2);
  const ini = initials(club);
  const ch = all || both ? t('yc.sp.fan.chBoth') : cmode === 'email' ? t('yc.sp.fan.chEmail') : t('yc.sp.fan.chSms');
  const consentTxt = t('yc.sp.fan.consent', { club, what: t(`yc.sp.ty.${kind}.consent`), ch });
  const dot = isOpen ? '#4ADE80' : K.a;
  const dotAnim = isOpen ? 'fpulse 1.4s ease-in-out infinite' : 'none';
  const phBg = `radial-gradient(90% 80% at 50% 10%,rgba(${K.aRgb},.4),transparent 72%),repeating-linear-gradient(135deg,rgba(${K.inkRgb},.06) 0 12px,rgba(${K.inkRgb},.13) 12px 24px)`;
  const wBt = S.wBt === 'none' ? S.wBd : S.wBt;
  const cdRad = rd('18px'), icRad = rd('12px');
  const okRad = ['brut', 'type', 'edit', 'term', 'ticket'].includes(lay) ? '0' : '99px';
  const boxRad = square ? '0' : lay === 'clean' ? '99px' : '8px';
  const modeRad = square ? '0' : '99px';
  const okSh = lay === 'brut' || lay === 'flyer' ? '4px 4px 0 #1C1517' : `0 10px 30px rgba(${K.aRgb},.4)`;
  const bBg = outline ? 'transparent' : grad, bFg = outline ? K.a : K.aFg;
  const bH = S.bH + 'px', bH2 = Math.min(S.bH, 54) + 'px', bFs = S.bFs + 'px', bFs2 = Math.min(S.bFs, 16) + 'px';
  const bFamily = famOf(S.bFam), bJust = arrow ? 'space-between' : 'center', bPadL = arrow ? '24px' : '20px', bPadR = arrow ? '6px' : '20px';
  const btnTxt = S.bPre + cfg.btn + S.bSuf;
  const showCd = kind === 'prevente' && cfg.countdown && !!cfg.saleAt;
  const heroH = compact ? '210px' : '300px', fullH = compact ? '300px' : '460px', fullHdrH = compact ? '190px' : '340px', typeMt = compact ? '6px' : '40px';
  const showPoster = !compact;
  const shake = tried && !(okFirst && okContact && okExt && consent) ? 'fshake 360ms' : 'none';
  const lbStyle: CSSProperties = { fontFamily: famOf(S.lbF), fontSize: S.lbS + 'px', fontWeight: S.lbW, textTransform: S.lbT as CSSProperties['textTransform'], letterSpacing: S.lbLs, color: K.kM };
  const h1Style: CSSProperties = { margin: 0, fontFamily: F.f + ',sans-serif', fontWeight: F.w, fontSize: tSize, lineHeight: S.hlh, letterSpacing: F.ls, textTransform: S.hup as CSSProperties['textTransform'], textWrap: 'balance' as never, overflowWrap: 'anywhere' };
  const of = venueOf(club, lang);

  const submit = async () => {
    if (frozen || busy) return;
    setErr('');
    if (!(okFirst && okContact && okExt && consent)) {
      setTried(true);
      window.setTimeout(() => setTried(false), 2600);
      return;
    }
    if (mode !== 'live' || !onSubmit) { setSub('noted'); setTried(false); return; }
    const answers: Record<string, string | string[]> = {};
    cfg.fields.questions.forEach((q, i) => { const v = ans[i]; if (v && (!Array.isArray(v) || v.length)) answers[q.label] = v; });
    const email = all || cmode === 'email' ? contact.trim() : '';
    const phoneRaw = all ? contact2 : cmode === 'phone' ? contact : '';
    const phone = phoneRaw ? composePhone(phoneRaw, country).replace(/\s+/g, '') : '';
    setBusy(true);
    const r = await onSubmit({
      first_name: first.trim(), last_name: (ext.nom || '').trim(), email, phone, birthdate: (ext.naissance || '').trim(),
      instagram: (ext.insta || '').trim(), city: (ext.ville || '').trim(), answers, consent_text: consentTxt,
    }).catch(() => 'error' as SubmitResult);
    setBusy(false);
    if (r === 'ok' || r === 'already' || r === 'demo') { setResult(r); setSub('noted'); setTried(false); if (scRef.current) scRef.current.scrollTop = 0; }
    else if (r === 'closed') setErr(t('yc.sp.fan.err.closed'));
    else setErr(t(`yc.sp.fan.err.${r}`));
  };

  const addCal = () => {
    if (mode === 'live' && cfg.eventStart) {
      const fmtIcs = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const end = cfg.eventEnd || new Date(Date.parse(cfg.eventStart) + 6 * 3600e3).toISOString();
      const esc = (s: string) => s.replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
      const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Yuno//Signup//FR', 'BEGIN:VEVENT', `UID:${Date.now()}@yunoapp.eu`, `DTSTAMP:${fmtIcs(new Date().toISOString())}`,
        `DTSTART:${fmtIcs(cfg.eventStart)}`, `DTEND:${fmtIcs(end)}`, `SUMMARY:${esc(title)}`, `LOCATION:${esc(place)}`, ...(cfg.pageUrl ? [`URL:${cfg.pageUrl}`] : []), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
      a.download = `${title.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() || 'soiree'}.ics`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    flash(t('yc.sp.fan.calDone'));
  };
  const shareIt = async () => {
    const url = cfg.pageUrl ? `${cfg.pageUrl}${cfg.pageUrl.includes('?') ? '&' : '?'}src=share` : '';
    if (mode === 'live' && url) {
      if (navigator.share) {
        try { await navigator.share({ title, text: t('yc.sp.fan.shareText', { title }), url }); return; } catch { /* annulé : on copie */ }
      }
      try { await navigator.clipboard.writeText(url); } catch { /* pas de presse-papier */ }
    }
    flash(t('yc.sp.fan.shareDone'));
  };
  const goTickets = () => {
    if (mode === 'live' && cfg.ticketUrl) { window.location.href = cfg.ticketUrl; return; }
    flash(cfg.ticketUrl ? t('yc.sp.fan.previewTickets') : t('yc.sp.fan.ticketsSoon', { club }));
  };
  const showCal = isNoted && (mode !== 'live' || !!cfg.eventStart) && !isComm;

  // ── Blocs réutilisés par les mises en page ────────────────────────────────
  const posterImg = <img src={poster} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />;
  const ph = (top: string, label = t('yc.sp.fan.poster')) => (
    <div style={{ position: 'absolute', inset: 0, background: phBg }}><span style={{ position: 'absolute', left: 0, right: 0, top, textAlign: 'center', fontFamily: "'Geist Mono'", fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: K.inkF }}>{label}</span></div>
  );
  const hatch = (alpha1: string, alpha2: string, top: string, label: string, bold?: boolean) => (
    <div style={{ position: 'absolute', inset: 0, background: `repeating-linear-gradient(135deg,rgba(28,21,23,${alpha1}) 0 10px,rgba(28,21,23,${alpha2}) 10px 20px)` }}><span style={{ position: 'absolute', left: 0, right: 0, top, textAlign: 'center', fontFamily: "'Geist Mono'", fontSize: bold ? 11 : 10.5, fontWeight: bold ? 700 : undefined, letterSpacing: bold ? undefined : '.08em', textTransform: 'uppercase', color: bold ? 'rgba(28,21,23,.5)' : 'rgba(28,21,23,.45)' }}>{label}</span></div>
  );
  const clubChip = (bgc: string) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span style={{ flex: 'none', width: 28, height: 28, borderRadius: 99, background: bgc, color: K.aFg, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700 }}>{ini}</span>
      <b style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{club}</b>
    </span>
  );
  const badgePill = (extra: CSSProperties) => (
    <span style={{ flex: 'none', height: 28, padding: '0 12px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, ...extra }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: dot, animation: dotAnim }} />{badge}
    </span>
  );
  const blurPill: CSSProperties = { background: `rgba(${K.bgRgb},.5)`, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', boxShadow: `inset 0 0 0 1px ${K.line}` };
  const monoKicker = (color: string) => <span style={{ fontFamily: "'Geist Mono'", fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color }}>{kicker}</span>;

  const rewardBox = rewardOn && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: cdRad, background: `rgba(${K.aRgb},.14)`, boxShadow: `inset 0 0 0 1px rgba(${K.aRgb},.4)` }}>
      <span style={{ flex: 'none', width: 40, height: 40, borderRadius: icRad, background: K.a, color: K.aFg, display: 'grid', placeItems: 'center' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={SP_ICON[rw.icon] ?? SP_ICON.gift} /></svg>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span style={{ fontFamily: "'Geist Mono'", fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: K.kM }}>{t('yc.sp.fan.reward')}</span>
        <b style={{ fontSize: 15, fontWeight: 600 }}>{rewardTxt}</b>
        {rw.sub && <span style={{ fontSize: 13, color: K.kM }}>{rw.sub}</span>}
      </span>
    </div>
  );

  const renderInput = (f: In) => (
    <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={lbStyle}>{S.lbPre}{f.lab}{f.opt && <span style={{ fontWeight: 400, opacity: 0.8 }}>{t('yc.sp.fan.optional')}</span>}</span>
        {f.modes.length > 0 && (
          <span role="group" aria-label={t('yc.sp.fan.contactAria')} style={{ display: 'inline-flex', padding: 2, gap: 2, borderRadius: modeRad, background: K.kSoft }}>
            {f.modes.map((m) => (
              <button key={m.l} type="button" onClick={m.pick} aria-pressed={m.on} style={{ height: 28, padding: '0 12px', border: 0, borderRadius: modeRad, background: m.on ? K.k : 'transparent', color: m.on ? (K.card || K.bg) : K.kM, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>{m.l}</button>
            ))}
          </span>
        )}
      </span>
      {f.phone ? (
        <span style={{ position: 'relative', display: 'flex', alignItems: 'stretch' }}>
          <span style={{ position: 'absolute', left: 12, top: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: 4, fontSize: 15, color: K.k, pointerEvents: 'none' }}>
            <span aria-hidden>{country.flag}</span><span style={{ fontFamily: famOf('body') }}>{country.callingCode ?? country.dialCode}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}><path d="m6 9 6 6 6-6" /></svg>
          </span>
          <select aria-label={t('yc.sp.fan.country')} value={country.code} disabled={frozen} onChange={(e) => { const c = countryByCode(e.target.value); if (c) setCountry(c); }}
            style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 96, opacity: 0, cursor: 'pointer', fontSize: 16 }}>
            {COUNTRIES.filter((c) => !c.parentCode).map((c) => <option key={c.code} value={c.code}>{c.flag} {c.names[lang]} ({c.callingCode ?? c.dialCode})</option>)}
          </select>
          <input value={f.value} readOnly={frozen} tabIndex={frozen ? -1 : undefined}
            onChange={(e) => { const v = e.target.value; const c = countryFromInternationalInput(v); if (c) { setCountry(c); f.set(v.replace(/^\s*(\+|00)\d{1,4}\s*/, '')); } else f.set(v); }}
            type="tel" inputMode="tel" autoComplete="tel-national" aria-label={f.lab}
            style={{ flex: 1, minWidth: 0, height: S.inH + 'px', boxSizing: 'border-box', padding: '0 16px 0 104px', borderRadius: S.inRad, borderWidth: S.inBw, borderStyle: 'solid', borderColor: f.bd, background: S.inBg, color: K.k, fontSize: 16, fontFamily: famOf('body'), outline: 0, colorScheme: K.kDark ? 'dark' : 'light' }}
            onFocus={(e) => { e.currentTarget.style.borderColor = K.a; }} onBlur={(e) => { e.currentTarget.style.borderColor = f.bd; }} />
        </span>
      ) : (
        <input value={f.value} readOnly={frozen} tabIndex={frozen ? -1 : undefined} onChange={(e) => f.set(e.target.value)} type={f.type} inputMode={f.im} autoComplete={f.auto} aria-label={f.lab}
          style={{ height: S.inH + 'px', boxSizing: 'border-box', padding: '0 16px', borderRadius: S.inRad, borderWidth: S.inBw, borderStyle: 'solid', borderColor: f.bd, background: S.inBg, color: K.k, fontSize: 16, fontFamily: famOf('body'), outline: 0, colorScheme: K.kDark ? 'dark' : 'light', width: '100%' }}
          onFocus={(e) => { e.currentTarget.style.borderColor = K.a; }} onBlur={(e) => { e.currentTarget.style.borderColor = f.bd; }} />
      )}
      {f.err && <span style={{ fontSize: 13, color: K.errC }}>{f.errT}</span>}
    </div>
  );

  const ctaBtn = (label: string, onClick: () => void, disabled?: boolean) => (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{ height: bH, padding: `0 ${bPadR} 0 ${bPadL}`, borderWidth: 0, border: S.bBd, borderRadius: S.bRad, background: bBg, color: bFg, fontFamily: bFamily, fontSize: bFs, fontWeight: 600, textTransform: S.bUp as CSSProperties['textTransform'], letterSpacing: S.bLs, display: 'flex', alignItems: 'center', justifyContent: bJust, gap: 12, boxShadow: S.bSh, transform: S.bTr, cursor: disabled ? 'wait' : 'pointer', transition: 'transform 200ms cubic-bezier(.34,1.56,.64,1),filter 160ms', width: '100%', boxSizing: 'border-box' }}>
      <span>{label}</span>
      {arrow && <span style={{ width: 44, height: 44, borderRadius: 99, background: K.aFg, color: K.a, display: 'grid', placeItems: 'center', flex: 'none' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>}
    </button>
  );

  // ── Les blocs du formulaire, réutilisés par le design sur mesure ─────────
  const cdBox = (
    <div style={{ padding: 14, borderRadius: cdRad, background: K.kSoft, boxShadow: `inset 0 0 0 1px ${K.kLine}` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: '2px 10px', marginBottom: 10 }}>
        <span style={{ fontFamily: "'Geist Mono'", fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: K.kM }}>{t('yc.sp.fan.saleIn')}</span>
        <span style={{ fontSize: 12.5, color: K.kM }}>{saleStr}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
        {cd.map((c) => (
          <div key={c.l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, padding: '10px 0 8px', borderRadius: cdRad, background: K.kSoft }}>
            <b style={{ fontFamily: F.f + ',sans-serif', fontWeight: F.w, fontSize: 28, lineHeight: 1.05, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{c.v}</b>
            <span style={{ fontFamily: "'Geist Mono'", fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: K.kM }}>{c.l}</span>
          </div>
        ))}
      </div>
    </div>
  );
  const countRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: K.k }}>
      <span style={{ display: 'flex' }}>
        {['#5E5457', '#857B7D', '#A39A98'].map((c, i) => <i key={c} style={{ width: 22, height: 22, marginLeft: i ? -8 : 0, borderRadius: 99, background: c, boxShadow: `0 0 0 2px ${K.card || K.bg}`, display: 'block' }} />)}
      </span>
      <span><b style={{ fontWeight: 700 }}>{new Intl.NumberFormat(locale).format(Math.max(0, cfg.count)).replace(/[\u202f\u00a0]/g, ' ')}</b> {t('yc.sp.fan.count')}</span>
    </div>
  );

  const widget = (
    <div ref={wRef} style={{ position: 'relative', flex: S.wFlex, display: 'flex', flexDirection: 'column', gap: 18, margin: S.wMx, padding: S.wPad, background: S.wBg, border: S.wBd, borderTop: wBt, borderRadius: S.wRad, boxShadow: S.wSh, backdropFilter: S.wBlur, WebkitBackdropFilter: S.wBlur, color: K.k, boxSizing: 'border-box' }}>
      {lay === 'ticket' && (
        <>
          <i style={{ position: 'absolute', left: -10, top: -11, width: 20, height: 20, borderRadius: 99, background: K.bg, display: 'block' }} />
          <i style={{ position: 'absolute', right: -10, top: -11, width: 20, height: 20, borderRadius: 99, background: K.bg, display: 'block' }} />
        </>
      )}

      {isForm && (
        <>
          {formSection?.tagline !== false && cfg.sub && <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, color: K.k, textAlign: lay === 'clean' ? 'center' : 'left', textWrap: 'pretty' as never }}>{cfg.sub}</p>}
          {showCd && !placed.has('countdown') && cdBox}
          {!placed.has('reward') && rewardBox}
          {cfg.showCount && !placed.has('count') && countRow}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: shake }}>
            {inputs.map(renderInput)}
            {qs.map((q, qi) => (
              <div key={qi} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={lbStyle}>{S.lbPre}{q.q}</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {q.opts.map((o) => (
                    <button key={o.t} type="button" onClick={o.pick} aria-pressed={o.on} tabIndex={frozen ? -1 : undefined}
                      style={{ height: 42, padding: '0 16px', borderRadius: S.chRad, borderWidth: S.chBw, borderStyle: 'solid', borderColor: o.bd, background: o.bg, color: o.fg, fontSize: 14.5, fontWeight: 600, fontFamily: famOf('body'), cursor: 'pointer', transition: 'background 160ms,border-color 160ms,color 160ms' }}>{o.t}</button>
                  ))}
                </div>
              </div>
            ))}
            {inputsEnd.map(renderInput)}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <button type="button" role="checkbox" aria-checked={consent} onClick={() => setConsent((c) => !c)} tabIndex={frozen ? -1 : undefined}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 0, border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', color: K.k }}>
                <span style={{ flex: 'none', width: 24, height: 24, marginTop: 1, borderRadius: boxRad, boxSizing: 'border-box', border: `1.5px solid ${tried && !consent ? K.errC : consent ? K.a : K.kM}`, background: consent ? K.a : 'transparent', color: K.aFg, display: 'grid', placeItems: 'center', transition: 'background 160ms' }}>
                  {consent && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                </span>
                <span style={{ fontSize: 13.5, lineHeight: 1.45, color: K.kM }}>{consentTxt}</span>
              </button>
              {tried && !consent && <span style={{ fontSize: 13, color: K.errC, paddingLeft: 36 }}>{t('yc.sp.fan.eConsent')}</span>}
            </div>
            {err && <span role="alert" style={{ fontSize: 13.5, color: K.errC }}>{err}</span>}
          </div>
        </>
      )}

      {isNoted && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'fpop 520ms cubic-bezier(.22,1,.36,1) both' }}>
          <span style={{ width: 64, height: 64, borderRadius: okRad, background: K.a, color: K.aFg, display: 'grid', placeItems: 'center', boxShadow: okSh }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="30" style={{ animation: 'fdraw 600ms 260ms cubic-bezier(.22,1,.36,1) both' }}><path d="M20 6 9 17l-5-5" /></svg>
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 style={{ margin: 0, fontFamily: F.f + ',sans-serif', fontWeight: F.w, fontSize: nSize, lineHeight: 1.02, letterSpacing: F.ls, textTransform: S.hup as CSSProperties['textTransform'], overflowWrap: 'anywhere' }}>
              {result === 'demo' ? t('yc.sp.fan.demoT') : t('yc.sp.fan.noted', { name: nameShown })}
            </h2>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, color: K.k, textWrap: 'pretty' as never }}>
              {result === 'demo' ? t('yc.sp.fan.demoS') : result === 'already' ? t('yc.sp.fan.already') : cfg.noted}
            </p>
            {result === 'ok' && (all || cmode === 'email') && contact.trim() && (
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45, fontWeight: 600, color: K.k }}>{t('yc.sp.fan.checkMail', { email: contact.trim() })}</p>
            )}
          </div>
          {!placed.has('reward') && rewardBox}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '6px 14px', borderRadius: cdRad, background: K.kSoft, boxShadow: `inset 0 0 0 1px ${K.kLine}` }}>
            {steps.map((s) => (
              <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderTop: s.bt }}>
                <span style={{ flex: 'none', width: 24, height: 24, borderRadius: boxRad, boxSizing: 'border-box', background: s.bg, color: s.fg, boxShadow: s.sh, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>
                  {s.done ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg> : s.n}
                </span>
                <span style={{ fontSize: 14.5, lineHeight: 1.35, color: s.c }}>{s.txt}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'fpop 520ms cubic-bezier(.22,1,.36,1) both' }}>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, color: K.k, textWrap: 'pretty' as never }}>{t('yc.sp.fan.openTxt')}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: cdRad, background: 'rgba(23,163,74,.14)', boxShadow: 'inset 0 0 0 1px rgba(23,163,74,.45)' }}>
            <span style={{ width: 9, height: 9, borderRadius: 99, background: '#22C55E', animation: 'fpulse 1.4s ease-in-out infinite' }} />
            <b style={{ fontSize: 15, fontWeight: 600 }}>{t('yc.sp.fan.openBadge')}</b>
          </div>
        </div>
      )}

      {(isClosed || isSoon) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 18, borderRadius: cdRad, background: K.kSoft, boxShadow: `inset 0 0 0 1px ${K.kLine}` }}>
          <b style={{ fontFamily: F.f + ',sans-serif', fontWeight: F.w, fontSize: 22, letterSpacing: F.ls, textTransform: S.hup as CSSProperties['textTransform'] }}>{isSoon ? t('yc.sp.fan.soonT') : t('yc.sp.fan.closedT')}</b>
          <span style={{ fontSize: 15, lineHeight: 1.45, color: K.kM }}>{isSoon ? t('yc.sp.fan.soonS', { d: dt(cfg.opensAt, locale) }) : t('yc.sp.fan.closedS', { club, of })}</span>
        </div>
      )}
    </div>
  );

  // ── Design sur mesure : sections de l'IA + blocs Yuno, dans l'ordre ──────
  const tagData = buildPageTagData({
    locale, lang, kind, title, tagline: cfg.sub, button: cfg.btn, poster: cfg.poster, pageUrl: cfg.pageUrl ?? null,
    host: { name: club, logo: cfg.brand?.logo, city: cfg.brand?.city, instagram: cfg.brand?.instagram },
    event: kind === 'communaute' ? null : (cfg.eventFacts ?? null), count: cfg.showCount ? cfg.count : null,
    saleAt: cfg.saleAt, saleOpen: !!cfg.saleAt && rem <= 0, reward: { on: rewardOn, label: rewardTxt, how: rw.sub },
    scene, firstName: first.trim(), tbaLabel: t('yc.sp.w.nightNoneD'),
  });
  const customBody = custom && (
    <>
      {/* Sous la barre d'état du téléphone d'aperçu (la page publique n'en a pas). */}
      {mode !== 'live' && <div style={{ height: 46, flex: 'none' }} />}
      {custom.sections.filter((x) => sectionVisible(x, scene)).map((x) => {
        if (x.type === 'html') return <CustomSection key={x.id} html={x.html} css={x.css} sharedCss={custom.theme.css} data={tagData} />;
        if (x.block === 'form') return <div key={x.id} style={{ display: 'flex', flexDirection: 'column', flex: 'none' }}>{widget}</div>;
        const inner = x.block === 'countdown' ? (showCd && isForm ? cdBox : null) : x.block === 'reward' ? rewardBox : (cfg.showCount ? countRow : null);
        // Un bloc placé hors du formulaire est dessiné avec l'encre du formulaire : quand
        // elle ne se lit pas sur le fond de la page (formulaire clair sur page sombre, ou
        // l'inverse), il garde l'habit du formulaire ; sinon il se pose tel quel.
        const dress = K.kDark !== K.dark;
        return inner ? (
          <div key={x.id} style={dress
            ? { flex: 'none', margin: '8px 16px', padding: 14, background: S.wBg, border: S.wBd, borderRadius: S.wRad, backdropFilter: S.wBlur, WebkitBackdropFilter: S.wBlur, color: K.k }
            : { flex: 'none', margin: '8px 20px', color: K.k }}>{inner}</div>
        ) : null;
      })}
    </>
  );

  return (
    <div className="yc-fan" style={{ position: 'relative', width: '100%', height: '100%', minHeight: 560, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box', fontFamily: famOf('body'), color: K.ink, background: S.rootBg, pointerEvents: frozen ? 'none' : undefined }}>
      {lay === 'full' && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: fullH, overflow: 'hidden', pointerEvents: 'none', transition: 'height 460ms var(--ease-out, cubic-bezier(.22,1,.36,1))' }}>
          {poster ? posterImg : ph('32%')}
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg,rgba(${K.bgRgb},.55) 0%,rgba(${K.bgRgb},0) 30%,rgba(${K.bgRgb},.55) 72%,${K.bg} 100%)` }} />
        </div>
      )}
      {lay === 'glass' && poster && <img src={poster} alt="" style={{ position: 'absolute', left: -20, top: -20, width: 400, height: 420, objectFit: 'cover', display: 'block', filter: 'blur(36px) saturate(1.2)', opacity: 0.5, pointerEvents: 'none' }} />}

      <div ref={scRef} style={{ position: 'relative', flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'none', display: 'flex', flexDirection: 'column' }}>
        {lay === 'top' && (
          <div style={{ position: 'relative', flex: 'none', height: heroH, overflow: 'hidden', transition: 'height 460ms cubic-bezier(.22,1,.36,1)' }}>
            {poster ? posterImg : ph('40%')}
            <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg,rgba(${K.bgRgb},.62) 0%,rgba(${K.bgRgb},0) 32%,rgba(${K.bgRgb},.78) 78%,${K.bg} 100%)` }} />
            <div style={{ position: 'absolute', left: 18, right: 18, top: 50, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              {clubChip(grad)}
              {badgePill(blurPill)}
            </div>
            <div style={{ position: 'absolute', left: 20, right: 20, bottom: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {monoKicker(K.inkM)}
              <h1 style={h1Style}>{title}</h1>
            </div>
          </div>
        )}

        {lay === 'full' && (
          <div style={{ position: 'relative', flex: 'none', padding: '54px 18px 14px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: fullHdrH, boxSizing: 'border-box', transition: 'min-height 460ms cubic-bezier(.22,1,.36,1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>{clubChip(K.a)}{badgePill(blurPill)}</div>
            <div style={{ flex: 1 }} />
            {monoKicker(K.inkM)}
            <h1 style={h1Style}>{title}</h1>
          </div>
        )}

        {lay === 'brut' && (
          <div style={{ flex: 'none', padding: '56px 18px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ padding: '5px 12px', border: '2px solid #1C1517', borderRadius: 99, background: '#fff', color: '#1C1517', fontFamily: "'Geist Mono'", fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{club}</span>
              <span style={{ padding: '5px 10px', border: '2px solid #1C1517', background: K.a, color: K.aFg, fontFamily: "'Geist Mono'", fontSize: 12, fontWeight: 700, textTransform: 'uppercase', transform: 'rotate(3deg)', boxShadow: '3px 3px 0 #1C1517' }}>{badge}</span>
            </div>
            {showPoster && (
              <div style={{ position: 'relative', height: 168, border: '3px solid #1C1517', borderRadius: 14, boxShadow: '6px 6px 0 #1C1517', overflow: 'hidden', background: '#fff' }}>
                {poster ? posterImg : hatch('.05', '.12', '44%', t('yc.sp.fan.posterShort'), true)}
              </div>
            )}
            <h1 style={{ ...h1Style, margin: '4px 0 0' }}>{title}</h1>
            <span style={{ alignSelf: 'flex-start', padding: '4px 9px', background: K.ink, color: K.bg, fontFamily: "'Geist Mono'", fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{kicker}</span>
          </div>
        )}

        {lay === 'edit' && (
          <div style={{ flex: 'none', padding: '56px 22px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingBottom: 9, borderBottom: `1px solid ${K.ink}` }}>
              <b style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.2em', textTransform: 'uppercase' }}>{club}</b>
              <span style={{ fontFamily: F.f + ',sans-serif', fontStyle: 'italic', fontSize: 14, color: K.inkM }}>{badge}</span>
            </div>
            <span style={{ fontFamily: F.f + ',sans-serif', fontStyle: 'italic', fontSize: 16, color: K.inkM }}>{kicker}</span>
            <h1 style={h1Style}>{title}</h1>
            {showPoster && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ position: 'relative', height: 150, border: `1px solid ${K.ink}`, overflow: 'hidden' }}>
                  {poster ? posterImg : <div style={{ position: 'absolute', inset: 0, background: phBg }} />}
                </div>
                <span style={{ fontFamily: F.f + ',sans-serif', fontStyle: 'italic', fontSize: 12.5, color: K.inkF }}>{t('yc.sp.fan.posterCaption')}</span>
              </div>
            )}
          </div>
        )}

        {lay === 'ticket' && (
          <div style={{ flex: 'none', padding: '54px 16px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>{clubChip(K.a)}{badgePill({ boxShadow: `inset 0 0 0 1px ${K.ink}` })}</div>
            <div style={{ marginBottom: -14, background: '#FFFBF2', color: '#1C1517', borderRadius: '18px 18px 0 0', overflow: 'hidden' }}>
              {showPoster && <div style={{ position: 'relative', height: 112, overflow: 'hidden' }}>{poster ? posterImg : hatch('.05', '.11', '42%', t('yc.sp.fan.poster'))}</div>}
              <div style={{ padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontFamily: "'Geist Mono'", fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(28,21,23,.6)' }}>{kicker}</span>
                <h1 style={h1Style}>{title}</h1>
              </div>
            </div>
          </div>
        )}

        {lay === 'type' && (
          <div style={{ flex: 'none', display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginTop: 56, height: 32, overflow: 'hidden', display: 'flex', alignItems: 'center', background: K.a, color: K.aFg, whiteSpace: 'nowrap', fontFamily: "'Geist Mono'", fontSize: 12, fontWeight: 700, letterSpacing: '.08em' }}>
              <div style={{ display: 'inline-flex', animation: frozen ? undefined : 'fmarq 16s linear infinite' }}><span style={{ flex: 'none' }}>{marq}</span><span style={{ flex: 'none' }}>{marq}</span></div>
            </div>
            <div style={{ position: 'relative', padding: '16px 20px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ maxWidth: '58%', fontFamily: "'Geist Mono'", fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: K.inkM }}>{kicker}</span>
              {showPoster && (
                <div style={{ position: 'absolute', right: 18, top: 12, width: 100, height: 128, border: `3px solid ${K.ink}`, transform: 'rotate(5deg)', overflow: 'hidden', background: K.bg, zIndex: 1 }}>
                  {poster ? posterImg : <div style={{ position: 'absolute', inset: 0, background: phBg }} />}
                </div>
              )}
              <h1 style={{ ...h1Style, position: 'relative', zIndex: 2, margin: `${typeMt} 0 0`, textWrap: undefined }}>{title}</h1>
            </div>
          </div>
        )}

        {lay === 'glass' && (
          <div style={{ flex: 'none', padding: '54px 18px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>{clubChip(K.a)}{badgePill({ background: `rgba(${K.inkRgb},.1)`, boxShadow: `inset 0 0 0 1px ${K.line}` })}</div>
            {showPoster && (
              <div style={{ position: 'relative', height: 176, borderRadius: 26, overflow: 'hidden', boxShadow: `inset 0 0 0 1px ${K.line},0 18px 40px -16px rgba(0,0,0,.5)` }}>{poster ? posterImg : ph('44%')}</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 4px' }}>{monoKicker(K.inkM)}<h1 style={h1Style}>{title}</h1></div>
          </div>
        )}

        {lay === 'clean' && (
          <div style={{ flex: 'none', padding: '56px 24px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 26, height: 26, borderRadius: 99, background: K.a, color: K.aFg, display: 'grid', placeItems: 'center', fontSize: 10.5, fontWeight: 700 }}>{ini}</span>
              <b style={{ fontSize: 14, fontWeight: 600 }}>{club}</b>
            </span>
            {showPoster && <div style={{ position: 'relative', width: 164, height: 206, borderRadius: 26, overflow: 'hidden', boxShadow: '0 22px 40px -20px rgba(28,21,23,.45)' }}>{poster ? posterImg : ph('44%', t('yc.sp.fan.posterShort'))}</div>}
            <span style={{ height: 24, padding: '0 11px', borderRadius: 99, boxShadow: `inset 0 0 0 1px ${K.line}`, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: K.inkM }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: dot, animation: dotAnim }} />{badge}
            </span>
            <h1 style={h1Style}>{title}</h1>
            <span style={{ fontSize: 13.5, color: K.inkM }}>{kicker}</span>
          </div>
        )}

        {lay === 'flyer' && (
          <div style={{ position: 'relative', flex: 'none', padding: '56px 20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ alignSelf: 'flex-start', padding: '5px 12px', border: '2.5px solid #1C1517', borderRadius: 99, background: '#fff', color: '#1C1517', fontFamily: "'Geist Mono'", fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>{club}</span>
            <span style={{ position: 'absolute', right: 16, top: 52, zIndex: 3, width: 76, height: 76, border: '3px solid #1C1517', borderRadius: 99, background: K.a, color: K.aFg, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 6, boxSizing: 'border-box', transform: 'rotate(12deg)', fontFamily: F.f + ',sans-serif', fontSize: 13, lineHeight: 1, textTransform: 'uppercase', boxShadow: '0 4px 0 #1C1517' }}>{badge}</span>
            {showPoster && (
              <div style={{ alignSelf: 'flex-start', marginLeft: 8, width: 196, padding: '8px 8px 24px', background: '#fff', boxShadow: '6px 6px 0 #1C1517', border: '2.5px solid #1C1517', transform: 'rotate(-3deg)' }}>
                <div style={{ position: 'relative', height: 178, border: '2px solid #1C1517', overflow: 'hidden' }}>{poster ? posterImg : hatch('.06', '.14', '44%', t('yc.sp.fan.posterShort'), true)}</div>
              </div>
            )}
            <h1 style={{ ...h1Style, margin: '6px 0 0', lineHeight: 1.08 }}>
              <span style={{ background: `linear-gradient(transparent 60%,${K.a} 60%)`, padding: '0 4px', margin: '0 -4px', WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone' }}>{title}</span>
            </h1>
            <span style={{ fontFamily: "'Geist Mono'", fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: K.ink }}>{kicker}</span>
          </div>
        )}

        {lay === 'term' && (
          <div style={{ flex: 'none', padding: '50px 16px 0', display: 'flex', flexDirection: 'column', gap: 12, fontFamily: "'Space Mono',monospace" }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 2px', borderBottom: `1px solid ${K.line}` }}>
              <i style={{ width: 9, height: 9, borderRadius: 99, boxShadow: `inset 0 0 0 1px ${K.inkF}`, display: 'block' }} />
              <i style={{ width: 9, height: 9, borderRadius: 99, boxShadow: `inset 0 0 0 1px ${K.inkF}`, display: 'block' }} />
              <i style={{ width: 9, height: 9, borderRadius: 99, background: K.a, display: 'block' }} />
              <span style={{ marginLeft: 8, fontSize: 11, color: K.inkF }}>{slugC}@yuno ~ %</span>
            </div>
            <span style={{ fontSize: 12, color: K.inkF }}>$ cat {slugC}.txt</span>
            <h1 style={{ ...h1Style, textWrap: undefined }}>{title}<span style={{ color: K.a, animation: frozen ? undefined : 'fblink 1s steps(1) infinite' }}>_</span></h1>
            <span style={{ fontSize: 12.5, color: K.a }}>// {kicker}</span>
            <span style={{ fontSize: 12, color: K.inkM }}>[{badge}]</span>
            {showPoster && (
              <div style={{ position: 'relative', height: 96, border: `1px dashed ${K.a}`, overflow: 'hidden' }}>
                {poster ? <img src={poster} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: 0.85 }} />
                  : <span style={{ position: 'absolute', left: 0, right: 0, top: '40%', textAlign: 'center', fontSize: 11.5, color: K.inkF }}>{t('yc.sp.fan.posterFile')}</span>}
              </div>
            )}
          </div>
        )}

        {lay === 'custom' ? customBody : widget}

        <div style={{ marginTop: 'auto', padding: '14px 20px 22px', display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, lineHeight: 1.4, color: K.inkF }}>
          <span>{t('yc.sp.fan.foot1', { club })}</span>
          <span>{t('yc.sp.fan.powered')} <b style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, color: K.inkM }}>yuno</b> · {mode === 'live' ? <a href="/legal/privacy" style={{ color: 'inherit', textDecoration: 'none' }}>{t('yc.sp.fan.privacy')}</a> : t('yc.sp.fan.privacy')}</span>
        </div>
      </div>

      <div style={{ flex: 'none', padding: '12px 18px 30px', background: `linear-gradient(180deg,rgba(${K.bgRgb},0),${K.bg} 28%)`, display: 'flex', flexDirection: 'column', gap: 8, position: 'relative', zIndex: 2 }}>
        {isForm && ctaBtn(busy ? t('yc.sp.fan.sending') : btnTxt, () => { void submit(); }, busy)}
        {isNoted && (
          <>
            {showCal && (
              <button type="button" onClick={addCal} style={{ height: bH2, padding: '0 20px', border: S.bBd, borderRadius: S.bRad, background: bBg, color: bFg, fontFamily: bFamily, fontSize: bFs2, fontWeight: 600, textTransform: S.bUp as CSSProperties['textTransform'], letterSpacing: S.bLs, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: S.bSh, transform: S.bTr, cursor: 'pointer' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={SP_ICON.cal} /></svg>{t('yc.sp.fan.addCal')}
              </button>
            )}
            <button type="button" onClick={() => { void shareIt(); }} style={{ height: 50, padding: '0 20px', borderRadius: S.bRad, border: `1.5px solid ${K.line}`, background: 'transparent', color: K.ink, fontFamily: bFamily, fontSize: bFs2, fontWeight: 600, textTransform: S.bUp as CSSProperties['textTransform'], letterSpacing: S.bLs, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer' }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={SP_ICON.share} /></svg>{t('yc.sp.fan.share')}
            </button>
          </>
        )}
        {isOpen && ctaBtn(isComm ? t('yc.sp.fan.nextNights') : t('yc.sp.fan.take'), goTickets)}
        {(isClosed || isSoon) && <div style={{ height: 54, borderRadius: S.bRad, background: K.soft, color: K.inkF, display: 'grid', placeItems: 'center', fontSize: 16, fontWeight: 600 }}>{isSoon ? t('yc.sp.fan.soonBtn') : t('yc.sp.fan.closedBtn')}</div>}
      </div>
      {toast && <div role="status" style={{ position: 'absolute', left: '50%', bottom: 150, transform: 'translateX(-50%)', zIndex: 5, height: 40, padding: '0 18px', borderRadius: 99, background: K.ink, color: K.bg, fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', boxShadow: '0 8px 24px rgba(0,0,0,.4)', animation: 'fpop 240ms cubic-bezier(.22,1,.36,1) both' }}>{toast}</div>}
      <style>{FAN_KEYFRAMES}</style>
    </div>
  );
}

export const FAN_KEYFRAMES = '@keyframes fpop{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}@keyframes fpulse{0%,100%{opacity:1}50%{opacity:.3}}@keyframes fdraw{from{stroke-dashoffset:30}to{stroke-dashoffset:0}}@keyframes fshake{0%,100%{transform:none}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}@keyframes fmarq{from{transform:translateX(0)}to{transform:translateX(-50%)}}@keyframes fblink{50%{opacity:0}}.yc-fan ::selection{background:rgba(128,128,128,.3)}.yc-fan button,.yc-fan input,.yc-fan select{font:inherit}.yc-fan input::placeholder{color:inherit;opacity:.5}@media (prefers-reduced-motion:reduce){.yc-fan *{animation-duration:1ms!important;animation-delay:0ms!important;transition-duration:1ms!important}}';
