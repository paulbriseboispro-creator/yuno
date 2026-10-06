/**
 * Pages d'inscription › l'assistant (`/crm/signup-pages/new`, `/:id/edit`) —
 * design « Pages inscription », vue ASSISTANT, à l'identique : quatre étapes
 * (le type, le style, couleurs et texte, champs et dates), la barre collée en
 * bas (Retour / Brouillon / Continuer / Publier), et à droite « Ce que verra
 * le fan » : le téléphone en direct (la page, « C'est noté », le message).
 * Le brouillon vit dans l'écran ; « Brouillon » et « Publier » l'enregistrent
 * (`crm_signup_page_save`), « Publier » le met en ligne (titulaire seul).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps, useCrmScope } from '@/crm/scope';
import { Modal, PillButton, Skel } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { useCrmToast } from '@/crm/ui/toast';
import { useNights } from '@/crm/data/nights';
import type { NightRow } from '@/crm/data/nights';
import { rpcCode, signupUrl, useSignupMutations, useSignupPages } from '@/crm/data/signupPages';
import FanPage from '@/crm/signup/FanPage';
import { normalizeCustomDesign } from '@/crm/signup/custom';
import type { CustomDesign } from '@/crm/signup/custom';
import type { FanCfg } from '@/crm/signup/FanPage';
import InscriptionPhone from '@/crm/signup/InscriptionPhone';
import type { PhoneScene } from '@/crm/signup/InscriptionPhone';
import { CRM_SMS_SIGNUP_LIVE } from '@/crm/lib/sms';
import {
  EXTRA_FIELDS, FONTS, KIND_META, REWARD_ICONS, REWARD_IDS, SIGNUP_KINDS, SP_ICON, TPL, dt, fieldCount, fromLocalInput, parseOpts, tokens, tplOf,
} from '@/crm/signup/model';
import type { CloseMode, SignupKind } from '@/crm/signup/model';
import { SP_ROUTES, SpMain } from './SignupPagesPage';
import {
  BackLink, D_ARROW, D_PLUS, D_TICK, D_X, Knob, Seg, SpSvg, SwitchRow, anim, cap1, eventDate, focusOff, focusOn, inputBase, monoLabel,
} from './signupUi';
import {
  checkWz, defaultRelance, fillWz, newWz, pageAccent, partyQuestion, relanceCta, relanceForSave, rewardFanText, styleQuestion, wzFields, wzFromPage,
} from './signupLogic';
import type { Wz } from './signupLogic';

const KNOWN_ERRORS = ['owner_only', 'incomplete', 'closes_in_past', 'support_session', 'bad_fields', 'bad_event', 'ai_changed'];

/** Image ramenée à 1600 px au plus (JPEG), pour une affiche légère. */
async function fitImage(file: File, max = 1600): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; });
    const k = Math.min(1, max / Math.max(img.width, img.height));
    if (k === 1 && file.size < 1.5 * 1024 * 1024 && file.type === 'image/jpeg') return file;
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const ctx = c.getContext('2d');
    if (!ctx) return file;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((ok) => c.toBlob((b) => ok(b ?? file), 'image/jpeg', 0.86));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function SignupWizardPage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const caps = useCrmCaps();
  const q = useSignupPages();
  const nights = useNights();
  const { t } = useCrmT();
  // Pendant l'édition d'une page, la liste se relit toutes les 8 s (onglet
  // visible) : une modification faite par l'IA du pro arrive dans l'écran.
  const refetch = q.refetch;
  useEffect(() => {
    if (!id) return;
    const iv = window.setInterval(() => { if (document.visibilityState === 'visible') void refetch(); }, 8000);
    return () => window.clearInterval(iv);
  }, [id, refetch]);
  if (!caps.write) return <Navigate to={SP_ROUTES.list} replace />;
  if ((q.isError && !q.data) || (nights.isError && !nights.data)) {
    const err = q.error ?? nights.error;
    return <SpMain><CrmLoadError error={err} onRetry={() => { void q.refetch(); void nights.refetch(); }} retrying={q.isFetching || nights.isFetching} /></SpMain>;
  }
  if (!q.data || !nights.data) return <SpMain><Skel h={720} r={28} /></SpMain>;
  const page = id ? q.data.pages.find((p) => p.id === id) ?? null : null;
  if (id && !page) return <SpMain><BackLink label={t('yc.sp.back')} onClick={() => history.back()} /><b>{t('yc.sp.f.notFound')}</b></SpMain>;
  const kind = (SIGNUP_KINDS as readonly string[]).includes(sp.get('type') ?? '') ? (sp.get('type') as SignupKind) : 'prevente';
  return <Wizard key={id ?? 'new'} page={page} kind={kind} nights={nights.data.nights} canPublish={q.data.can_publish} review={sp.get('review') === '1'} onStale={() => { void q.refetch(); }} />;
}

function Wizard({ page, kind, nights, canPublish, review, onStale }: {
  page: import('@/crm/data/signupPages').SignupPageRow | null; kind: SignupKind; nights: NightRow[]; canPublish: boolean;
  /** Ouvert depuis « Publier » d'une page préparée par l'IA : directement à la dernière étape. */
  review?: boolean;
  /** L'enregistrement a été refusé parce que l'IA venait d'écrire : relire tout de suite. */
  onStale: () => void;
}) {
  const T = useCrmT();
  const { t, lang, locale } = T;
  const { space } = useCrmScope();
  const nav = useNavigate();
  const toast = useCrmToast();
  const m = useSignupMutations();
  const host = space.name;
  const upcoming = useMemo(() => nights.filter((n) => n.upcoming), [nights]);
  const [wz, setWzState] = useState<Wz>(() => fillWz(page ? wzFromPage(page, nights, t) : newWz(kind, nights, t), nights, host, t, lang));
  const [step, setStep] = useState(page ? (review ? 4 : 3) : 1);
  // Design sur mesure (préparé par l'IA via le MCP) : il remplace le gabarit
  // tant que le pro n'en choisit pas un autre.
  const [custom, setCustom] = useState<CustomDesign | null>(() => normalizeCustomDesign(page?.custom_design));
  const [askTpl, setAskTpl] = useState<string | null>(null);
  const [wzTab, setWzTab] = useState<'page' | 'noted' | 'msg'>('page');
  const [ch, setCh] = useState<'email' | 'sms'>('email');
  const [busy, setBusy] = useState(false);
  const [posterBusy, setPosterBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isNew = !page;
  const go = (n: number) => { setStep(n); window.scrollTo(0, 0); };

  const upd = (patch: Partial<Wz>, touched?: 'title' | 'sub' | 'btn' | 'noted') =>
    setWzState((s) => fillWz({ ...s, ...patch, touched: touched ? { ...s.touched, [touched]: true } : s.touched }, nights, host, t, lang));

  // La version de l'IA : adoptée dès qu'elle arrive (rien n'est réécrit par-dessus),
  // l'état d'avant reste à un clic (« Revenir à la mienne »), et l'enregistrement
  // dit à la base quelle version l'écran a vue (`_seen_ai_at`).
  const seenAi = useRef<string | null>(page?.ai_updated_at ?? null);
  const latest = useRef<{ wz: Wz; custom: CustomDesign | null }>({ wz, custom });
  latest.current = { wz, custom };
  useEffect(() => {
    const at = page?.ai_updated_at ?? null;
    if (!page || !at || at === seenAi.current) return;
    seenAi.current = at;
    const before = latest.current;
    setWzState(fillWz(wzFromPage(page, nights, t), nights, host, t, lang));
    setCustom(normalizeCustomDesign(page.custom_design));
    toast(t('yc.sp.ai.adopted', { ai: page.ai_author || 'IA' }), { label: t('yc.sp.ai.undo'), onClick: () => { setWzState(before.wz); setCustom(before.custom); } });
  }, [page, nights, t, host, lang, toast]);

  const night = nights.find((n) => n.id === wz.eventId) ?? null;
  const TPLo = tplOf(wz.design.tpl);
  const tk = tokens(wz.design);
  const check = checkWz(wz, t);
  const { oks, miss } = check;

  const cfg: FanCfg = useMemo(() => ({
    kind: wz.kind, title: wz.title, sub: wz.sub, btn: wz.btn, noted: wz.noted, design: wz.design,
    poster: wz.poster || night?.cover_url || null, club: host,
    date: wz.kind === 'communaute' ? null : night ? cap1(dt(night.start_at, locale, night.tz)) : t('yc.sp.w.nightNoneD'),
    place: night ? [host, night.city].filter(Boolean).join(' · ') : host,
    fields: wzFields(wz), reward: wz.reward,
    saleAt: wz.kind === 'prevente' ? fromLocalInput(wz.saleAt) : null, countdown: wz.countdown,
    showCount: wz.showCount, count: page?.n ?? 0, full: wz.kind === 'attente' && !!night?.sold_out,
    ticketUrl: night?.url ?? null, opensAt: fromLocalInput(wz.opensAt), pageUrl: page ? signupUrl(page.slug) : null,
    eventStart: night?.start_at ?? null, eventEnd: night?.end_at ?? null,
    custom, brand: { logo: space.logoUrl },
    eventFacts: night ? { title: night.title, start_at: night.start_at, tz: night.tz, venue: host, city: night.city, poster: night.cover_url, ticket_url: night.url, sold_out: night.sold_out } : null,
  }), [wz, night, host, locale, t, page, custom, space.logoUrl]);

  // ── Enregistrer ──────────────────────────────────────────────────────────
  const save = async (publish: boolean) => {
    if (busy) return;
    if (publish && !oks.every(Boolean)) { toast(t('yc.sp.w.missToast', { x: miss.join(t('yc.sp.w.listSep')) })); return; }
    setBusy(true);
    try {
      const rewardTxt = rewardFanText(wz.reward, t);
      const relBase = Object.keys(wz.relance ?? {}).length
        ? { ...wz.relance, open: { ...(wz.relance.open ?? { msg: '' }), on: wz.notify, email: wz.ch.email, sms: wz.ch.sms, msg: wz.relance.open?.msg || '' } }
        : defaultRelance({ kind: wz.kind, title: wz.title, host, lang, t, reward: rewardTxt }, { on: wz.notify, ...wz.ch });
      const defaults = defaultRelance({ kind: wz.kind, title: wz.title, host, lang, t, reward: rewardTxt }, { on: wz.notify, ...wz.ch });
      (['open', 'nudge', 'last'] as const).forEach((k) => { const s = relBase[k]; if (s && !s.msg) relBase[k] = { ...s, msg: defaults[k]?.msg ?? '' }; });
      const nextNight = upcoming[0]?.url ?? null;
      const pageUrl = page ? signupUrl(page.slug) : '';
      const relance = relanceForSave(relBase, {
        kind: wz.kind, title: wz.title, host, lang, t, reward: rewardTxt, accent: custom ? custom.theme.accent : pageAccent(wz.design), logo: space.logoUrl,
        ctaUrl: relanceCta(wz.kind, night ? { ticket_url: night.url, venue: host, street: night.street, city: night.city } : null, nextNight, pageUrl),
      });
      const patch: Record<string, unknown> = {
        kind: wz.kind,
        event_id: wz.eventId && wz.eventId !== 'none' ? wz.eventId : null,
        title: wz.title.trim(), tagline: wz.sub.trim(), button_label: wz.btn.trim(), thanks_message: wz.noted.trim(),
        poster_url: wz.poster || null,
        design: wz.design, fields: wzFields(wz), show_count: wz.showCount, reward: wz.reward,
        opens_at: wz.opens === 'date' ? fromLocalInput(wz.opensAt) : null,
        sale_opens_at: wz.kind === 'prevente' ? fromLocalInput(wz.saleAt) : null,
        closes_mode: wz.closes, closes_at: wz.closes === 'date' ? fromLocalInput(wz.closesAt) : null,
        countdown: wz.countdown, relance, lang,
      };
      if (page) {
        patch._seen_ai_at = seenAi.current;
        // Un gabarit choisi à la place du design sur mesure : la base le retire.
        if (page.custom_design && !custom) patch.custom_design = null;
      }
      const id = await m.save.mutateAsync({ id: wz.id, patch });
      if (!publish) {
        toast(t('yc.sp.w.draftSaved'));
        nav(SP_ROUTES.list);
        return;
      }
      if (canPublish && wz.status !== 'live') await m.status.mutateAsync({ id, status: 'live' });
      nav(SP_ROUTES.done(id));
    } catch (e) {
      const c = rpcCode(e);
      toast(KNOWN_ERRORS.includes(c) ? t(`yc.sp.e.${c}`) : t('yc.sp.err'));
      if (c === 'ai_changed') onStale();
    } finally {
      setBusy(false);
    }
  };

  const uploadPoster = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024 || !file.type.startsWith('image/')) { toast(t('yc.sp.w.posterFail')); return; }
    setPosterBusy(true);
    try {
      const blob = await fitImage(file);
      const folder = space.venueId ? `venue/${space.venueId}` : `org/${space.organizerUserId}`;
      const path = `${folder}/signup/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error } = await supabase.storage.from('email-assets').upload(path, blob, { upsert: false, contentType: blob.type || 'image/jpeg' });
      if (error) throw error;
      upd({ poster: supabase.storage.from('email-assets').getPublicUrl(path).data.publicUrl });
    } catch {
      toast(t('yc.sp.w.posterFail'));
    } finally {
      setPosterBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // ── Rendu ───────────────────────────────────────────────────────────────
  const stepper = [t('yc.sp.w.st1'), t('yc.sp.w.st2'), t('yc.sp.w.st3'), t('yc.sp.w.st4')];
  const reach = (n: number) => () => { if (n <= step || oks.slice(0, n - 1).every(Boolean)) setStep(n); };
  const isLast = step === 4, allOk = oks.every(Boolean), cur = oks[step - 1];
  const note = isLast
    ? (allOk ? (!canPublish ? t('yc.sp.w.noteOwner') : isNew ? t('yc.sp.w.noteReadyNew') : t('yc.sp.w.noteReadyEdit')) : t('yc.sp.w.noteMiss', { list: miss.join(t('yc.sp.w.listSep')) }))
    : (cur ? t('yc.sp.w.noteStepOk', { n: step }) : t('yc.sp.w.noteStepKo', { n: step }));
  const noteC = isLast && allOk ? 'var(--green-700)' : 'var(--sand-600)';
  const scene: PhoneScene = wzTab === 'page' ? 'page' : wzTab === 'noted' ? 'noted' : ch;
  const h2: CSSProperties = { margin: 0, fontFamily: "'Bricolage Grotesque'", fontWeight: 600, fontSize: 24, letterSpacing: '-.02em' };
  const lab: CSSProperties = { fontSize: 14, fontWeight: 600 };
  const hint: CSSProperties = { fontSize: 13, color: 'var(--sand-500)' };

  return (
    <SpMain>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, animation: anim('sp-in', 700) }}>
        <BackLink label={t('yc.sp.back')} onClick={() => nav(page ? SP_ROUTES.page(page.id) : SP_ROUTES.list)} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h1 style={{ margin: 0, fontFamily: "'Bricolage Grotesque'", fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em' }}>{isNew ? t('yc.sp.w.headNew') : t('yc.sp.w.headEdit', { title: page?.title ?? '' })}</h1>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            {stepper.map((l, i) => {
              const n = i + 1, on = step === n, done = n < step && oks[i];
              return (
                <span key={n} style={{ display: 'contents' }}>
                  <button type="button" onClick={reach(n)} style={{ height: 42, padding: '0 16px 0 6px', border: 0, borderRadius: 99, background: on ? '#fff' : 'transparent', boxShadow: on ? 'inset 0 0 0 1.5px var(--sand-300)' : 'none', display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 14.5, fontWeight: 600, color: on || done ? 'var(--ink)' : 'var(--sand-500)', cursor: 'pointer' }}>
                    <span style={{ flex: 'none', width: 30, height: 30, borderRadius: 99, background: done ? 'var(--green-500)' : on ? 'var(--ink)' : 'var(--sand-100)', color: done || on ? '#fff' : 'var(--sand-600)', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 600 }}>
                      {done ? <SpSvg d="M5 12l5 5L20 7" size={14} sw={3} /> : n}
                    </span>{l}
                  </button>
                  {n < 4 && <i style={{ width: 22, height: 2, borderRadius: 2, background: 'var(--sand-200)', display: 'block' }} />}
                </span>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
          <div style={{ flex: '1.5 1 500px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section style={{ display: 'flex', flexDirection: 'column', gap: 26, padding: 'clamp(20px,2.4vw,30px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}>

              {step === 1 && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><h2 style={h2}>{t('yc.sp.w.s1T')}</h2><span style={{ fontSize: 14.5, color: 'var(--sand-600)' }}>{t('yc.sp.w.s1S')}</span></div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 10 }}>
                    {SIGNUP_KINDS.map((k) => {
                      const on = wz.kind === k;
                      return (
                        <Hv key={k} as="button" type="button" aria-pressed={on}
                          onClick={() => setWzState(fillWz(newWz(k, nights, t, { id: wz.id, status: wz.status, design: wz.design, poster: wz.poster, contact: wz.contact, extra: wz.extra, relance: wz.relance }), nights, host, t, lang))}
                          style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, padding: 18, borderRadius: 18, borderWidth: 1.5, borderStyle: 'solid', borderColor: on ? 'var(--red-400)' : 'var(--sand-200)', background: on ? 'var(--red-50)' : '#fff', textAlign: 'left', cursor: 'pointer', color: 'var(--ink)', transition: 'border-color 160ms,background 160ms' }}
                          hover={{ borderColor: on ? 'var(--red-400)' : 'var(--sand-400)' }}>
                          <span style={{ width: 40, height: 40, borderRadius: 12, background: on ? '#fff' : 'var(--sand-100)', color: on ? 'var(--red-600)' : 'var(--sand-700)', display: 'grid', placeItems: 'center' }}><SpSvg d={SP_ICON[KIND_META[k].icon]} size={19} sw={2} /></span>
                          <b style={{ fontSize: 16, paddingRight: 26 }}>{t(`yc.sp.ty.${k}.label`)}</b>
                          <span style={{ fontSize: 14, lineHeight: 1.4, fontWeight: 500 }}>« {t(`yc.sp.ty.${k}.promise`)} »</span>
                          <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-600)' }}>{t(`yc.sp.ty.${k}.use`)}</span>
                          {on && <span style={{ position: 'absolute', top: 14, right: 14, width: 22, height: 22, borderRadius: 99, background: 'var(--red-500)', color: '#fff', display: 'grid', placeItems: 'center' }}><SpSvg d={D_TICK} size={13} sw={3} /></span>}
                        </Hv>
                      );
                    })}
                  </div>
                  {KIND_META[wz.kind].night && (
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 8, animation: anim('sp-pop', 280) }}>
                      <span style={lab}>{t('yc.sp.w.night')}</span>
                      <select value={wz.eventId ?? ''} onChange={(e) => upd({ eventId: e.target.value === '' ? null : e.target.value })}
                        style={{ height: 50, boxSizing: 'border-box', padding: '0 14px', borderRadius: 12, borderWidth: 1.5, borderStyle: 'solid', borderColor: 'var(--sand-200)', background: '#fff', fontSize: 15, color: 'var(--ink)', outline: 0 }}>
                        {wz.kind !== 'attente' && !wz.eventId && <option value="">{t('yc.sp.w.night')}</option>}
                        {upcoming.map((n) => <option key={n.id} value={n.id}>{n.title} · {cap1(dt(n.start_at, locale, n.tz))}{n.sold_out ? ` · ${t('yc.sp.w.nightFull')}` : ''}</option>)}
                        {wz.kind === 'attente' && <option value="none">{t('yc.sp.w.nightNone')} · {t('yc.sp.w.nightNoneD')}</option>}
                      </select>
                      <span style={hint}>{upcoming.length ? t('yc.sp.w.nightHint') : t('yc.sp.w.noNights')}</span>
                    </label>
                  )}
                </>
              )}

              {step === 2 && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><h2 style={h2}>{t('yc.sp.w.s2T')}</h2><span style={{ fontSize: 14.5, color: 'var(--sand-600)' }}>{t('yc.sp.w.s2S')}</span></div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(164px,1fr))', gap: 12 }}>
                    {page?.custom_design && (() => {
                      const on = !!custom;
                      const restore = () => { if (!custom) setCustom(normalizeCustomDesign(page.custom_design)); };
                      return (
                        <Hv as="div" role="button" tabIndex={0} aria-pressed={on} onClick={restore}
                          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); restore(); } }}
                          style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 12, padding: '10px 10px 14px', borderRadius: 20, borderWidth: 1.5, borderStyle: 'solid', borderColor: on ? 'var(--red-400)' : 'var(--sand-200)', background: on ? 'var(--red-50)' : '#fff', textAlign: 'left', cursor: 'pointer', color: 'var(--ink)', transition: 'border-color 160ms,background 160ms,translate 220ms cubic-bezier(.22,1,.36,1)' }}
                          hover={{ borderColor: on ? 'var(--red-400)' : 'var(--sand-400)', translate: '0 -2px' }}>
                          <span style={{ display: 'block', position: 'relative', alignSelf: 'center', width: 144, height: 296, borderRadius: 16, overflow: 'hidden', pointerEvents: 'none', boxShadow: '0 0 0 1px rgba(28,21,23,.12),0 6px 16px -8px rgba(28,21,23,.3)' }}>
                            <span style={{ position: 'absolute', left: 0, top: 0, display: 'block', width: 360, height: 740, transform: 'scale(.4)', transformOrigin: 'top left' }}>
                              <FanPage cfg={{ ...cfg, custom: normalizeCustomDesign(page.custom_design) }} scene="form" mode="frozen" />
                            </span>
                          </span>
                          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 4px' }}>
                            <b style={{ fontSize: 15, paddingRight: 24 }}>{t('yc.sp.ai.custom')}</b>
                            <span style={{ fontSize: 13, lineHeight: 1.35, color: 'var(--sand-600)' }}>{page.ai_author ? t('yc.sp.ai.by', { ai: page.ai_author }) : t('yc.sp.ai.customOwn')}</span>
                          </span>
                          {on && <span style={{ position: 'absolute', right: 14, bottom: 16, width: 22, height: 22, borderRadius: 99, background: 'var(--red-500)', color: '#fff', display: 'grid', placeItems: 'center' }}><SpSvg d={D_TICK} size={13} sw={3} /></span>}
                        </Hv>
                      );
                    })()}
                    {TPL.map((tp) => {
                      const on = !custom && tp.id === TPLo.id;
                      const pick = () => { if (custom) setAskTpl(tp.id); else upd({ design: { tpl: tp.id, pal: tp.pals[0].id, bg: '', acc: '', font: '' } }); };
                      return (
                        <Hv key={tp.id} as="div" role="button" tabIndex={0} aria-pressed={on} onClick={pick}
                          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}
                          style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 12, padding: '10px 10px 14px', borderRadius: 20, borderWidth: 1.5, borderStyle: 'solid', borderColor: on ? 'var(--red-400)' : 'var(--sand-200)', background: on ? 'var(--red-50)' : '#fff', textAlign: 'left', cursor: 'pointer', color: 'var(--ink)', transition: 'border-color 160ms,background 160ms,translate 220ms cubic-bezier(.22,1,.36,1)' }}
                          hover={{ borderColor: on ? 'var(--red-400)' : 'var(--sand-400)', translate: '0 -2px' }}>
                          <span style={{ display: 'block', position: 'relative', alignSelf: 'center', width: 144, height: 296, borderRadius: 16, overflow: 'hidden', pointerEvents: 'none', boxShadow: '0 0 0 1px rgba(28,21,23,.12),0 6px 16px -8px rgba(28,21,23,.3)' }}>
                            <span style={{ position: 'absolute', left: 0, top: 0, display: 'block', width: 360, height: 740, transform: 'scale(.4)', transformOrigin: 'top left' }}>
                              <FanPage cfg={{ ...cfg, custom: null, design: { tpl: tp.id, pal: tp.pals[0].id, bg: '', acc: '', font: '' } }} scene="form" mode="frozen" />
                            </span>
                          </span>
                          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 4px' }}>
                            <b style={{ fontSize: 15, paddingRight: 24 }}>{t(`yc.sp.tpl.${tp.id}`)}</b>
                            <span style={{ fontSize: 13, lineHeight: 1.35, color: 'var(--sand-600)' }}>{t(`yc.sp.tplv.${tp.id}`)}</span>
                          </span>
                          {on && <span style={{ position: 'absolute', right: 14, bottom: 16, width: 22, height: 22, borderRadius: 99, background: 'var(--red-500)', color: '#fff', display: 'grid', placeItems: 'center' }}><SpSvg d={D_TICK} size={13} sw={3} /></span>}
                        </Hv>
                      );
                    })}
                  </div>
                  {custom && <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>{page?.ai_author ? t('yc.sp.ai.customSub', { ai: page.ai_author }) : t('yc.sp.ai.customSubOwn')}</span>}
                  <Modal open={!!askTpl} onClose={() => setAskTpl(null)} label={t('yc.sp.ai.replaceT')} width={440}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 24 }}>
                      <b style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 21, fontWeight: 600, letterSpacing: '-.02em' }}>{t('yc.sp.ai.replaceT')}</b>
                      <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-600)' }}>{t('yc.sp.ai.replaceS')}</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
                        <PillButton tone="ghost" onClick={() => setAskTpl(null)}>{t('yc.sp.ai.cancel')}</PillButton>
                        <PillButton tone="dark" onClick={() => {
                          const tp = TPL.find((x) => x.id === askTpl);
                          if (tp) { setCustom(null); upd({ design: { tpl: tp.id, pal: tp.pals[0].id, bg: '', acc: '', font: '' } }); }
                          setAskTpl(null);
                        }}>{t('yc.sp.ai.replaceOk')}</PillButton>
                      </div>
                    </div>
                  </Modal>
                </>
              )}

              {step === 3 && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><h2 style={h2}>{t('yc.sp.w.s3T')}</h2><span style={{ fontSize: 14.5, color: 'var(--sand-600)' }}>{t('yc.sp.w.s3S')}</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <span style={lab}>{t('yc.sp.w.poster')}</span>
                    <Hv as="label" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 14, borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'var(--sand-300)', background: 'var(--sand-50)', cursor: 'pointer' }}
                      hover={{ borderColor: 'var(--red-300)', background: 'var(--red-50)' }}
                      onDragOver={(e: React.DragEvent) => e.preventDefault()} onDrop={(e: React.DragEvent) => { e.preventDefault(); void uploadPoster(e.dataTransfer.files?.[0]); }}>
                      <input ref={fileRef} type="file" accept="image/*" onChange={(e) => { void uploadPoster(e.target.files?.[0]); }} style={{ display: 'none' }} />
                      {cfg.poster ? (
                        <span aria-hidden style={{ flex: 'none', display: 'block', width: 64, height: 80, borderRadius: 10, backgroundColor: 'var(--sand-100)', backgroundImage: `url(${cfg.poster})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                      ) : (
                        <span style={{ flex: 'none', width: 64, height: 80, borderRadius: 10, background: 'repeating-linear-gradient(135deg,#f1eeed 0 8px,#e9e5e4 8px 16px)', display: 'grid', placeItems: 'center', color: 'var(--sand-500)' }}><SpSvg d={SP_ICON.img} size={20} sw={2} /></span>
                      )}
                      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <b style={{ fontSize: 15 }}>{posterBusy ? t('yc.sp.w.posterBusy') : wz.poster ? t('yc.sp.w.posterAdded') : night?.cover_url ? t('yc.sp.w.posterShotgun') : t('yc.sp.w.posterDrop')}</b>
                        <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{t('yc.sp.w.posterHint')}</span>
                      </span>
                      {wz.poster && (
                        <Hv as="button" type="button" onClick={(e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); upd({ poster: '' }); }}
                          style={{ flex: 'none', height: 34, padding: '0 14px', borderRadius: 99, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--sand-200)', background: '#fff', fontSize: 13.5, fontWeight: 600, color: 'var(--sand-700)', cursor: 'pointer' }}
                          hover={{ background: 'var(--paper)' }}>{t('yc.sp.w.remove')}</Hv>
                      )}
                    </Hv>
                  </div>
                  {custom && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px', borderRadius: 14, background: 'var(--sand-50)', fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>
                      <SpSvg d={SP_ICON.pen} size={16} sw={2.2} style={{ flex: 'none', marginTop: 2 }} />
                      <span>{t('yc.sp.ai.colorsCustom', { ai: page?.ai_author || 'IA' })}</span>
                    </div>
                  )}
                  {!custom && (<>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <span style={lab}>{t('yc.sp.w.colours')}</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {[...TPLo.pals.map((x) => ({ id: x.id, l: t(`yc.sp.pal.${x.l}`), bg: x.bg, a: x.a })), { id: 'custom', l: t('yc.sp.pal.custom'), bg: tk.bg, a: tk.a }].map((x) => {
                        const on = (wz.design.pal === 'custom' ? 'custom' : (TPLo.pals.find((p) => p.id === wz.design.pal) ?? TPLo.pals[0]).id) === x.id;
                        return (
                          <Hv key={x.id} as="button" type="button" aria-pressed={on}
                            onClick={() => upd({ design: x.id === 'custom' ? { ...wz.design, pal: 'custom', bg: wz.design.bg || tk.bg, acc: wz.design.acc || tk.a } : { ...wz.design, pal: x.id, bg: '', acc: '' } })}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, height: 46, padding: '0 16px 0 7px', borderRadius: 99, borderWidth: 1.5, borderStyle: 'solid', borderColor: on ? 'var(--ink)' : 'var(--sand-200)', background: on ? 'var(--sand-50)' : '#fff', fontSize: 14, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }}
                            hover={{ borderColor: on ? 'var(--ink)' : 'var(--sand-400)' }}>
                            <span style={{ width: 32, height: 32, borderRadius: 99, background: `linear-gradient(135deg,${x.bg} 50%,${x.a} 50%)`, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.14)' }} />{x.l}
                          </Hv>
                        );
                      })}
                    </div>
                    {wz.design.pal === 'custom' && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 24px', padding: '14px 16px', borderRadius: 16, background: 'var(--sand-50)', animation: anim('sp-pop', 280) }}>
                        {([['bg', tk.bg, 'yc.sp.w.bg', 'yc.sp.w.bgAria'], ['acc', tk.a, 'yc.sp.w.acc', 'yc.sp.w.accAria']] as const).map(([k, v, l, aria]) => (
                          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                            <input type="color" value={v} onInput={(e) => upd({ design: { ...wz.design, [k]: (e.target as HTMLInputElement).value.toUpperCase() } })} aria-label={t(aria)} style={{ width: 44, height: 44, padding: 0, border: 0, borderRadius: 12, background: 'none', cursor: 'pointer' }} />
                            <span style={{ display: 'flex', flexDirection: 'column' }}><b style={{ fontSize: 14 }}>{t(l)}</b><span style={{ fontFamily: "'Geist Mono'", fontSize: 12, color: 'var(--sand-500)' }}>{v}</span></span>
                          </label>
                        ))}
                        <span style={{ flex: '1 1 200px', fontSize: 13, lineHeight: 1.4, color: 'var(--sand-600)' }}>{t('yc.sp.w.customHint')}</span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <span style={lab}>{t('yc.sp.w.font')}</span>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8 }}>
                      {FONTS.map((f) => {
                        const on = (wz.design.font || TPLo.font) === f.id;
                        return (
                          <Hv key={f.id} as="button" type="button" aria-pressed={on} onClick={() => upd({ design: { ...wz.design, font: f.id } })}
                            style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '12px 14px', borderRadius: 14, borderWidth: 1.5, borderStyle: 'solid', borderColor: on ? 'var(--red-400)' : 'var(--sand-200)', background: on ? 'var(--red-50)' : '#fff', textAlign: 'left', cursor: 'pointer', color: 'var(--ink)' }}
                            hover={{ borderColor: on ? 'var(--red-400)' : 'var(--sand-400)' }}>
                            <span style={{ fontFamily: `${f.f},sans-serif`, fontWeight: f.w, fontSize: 22, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{(wz.title || 'Acid Reign').slice(0, 16)}</span>
                            <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t(`yc.sp.font.${f.id}`)}</span>
                          </Hv>
                        );
                      })}
                    </div>
                  </div>
                  </>)}
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={lab}>{t('yc.sp.w.title')}</span>
                    <input value={wz.title} onChange={(e) => upd({ title: e.target.value }, 'title')} maxLength={40} style={inputBase} onFocus={focusOn} onBlur={focusOff} />
                    <span style={hint}>{t('yc.sp.w.chars', { n: wz.title.length, max: 40 })}</span>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={lab}>{t('yc.sp.w.sub')}</span>
                    <textarea value={wz.sub} onChange={(e) => upd({ sub: e.target.value }, 'sub')} rows={3} maxLength={140} style={{ ...inputBase, height: 'auto', padding: '14px 16px', fontSize: 15.5, lineHeight: 1.45, resize: 'vertical' }} onFocus={focusOn} onBlur={focusOff} />
                    <span style={hint}>{t('yc.sp.w.chars', { n: wz.sub.length, max: 140 })}</span>
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span style={lab}>{t('yc.sp.w.btn')}</span>
                      <input value={wz.btn} onChange={(e) => upd({ btn: e.target.value }, 'btn')} maxLength={28} style={inputBase} onFocus={focusOn} onBlur={focusOff} />
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {[1, 2, 3].map((i) => t(`yc.sp.ty.${wz.kind}.btn${i}`)).filter((b) => b !== wz.btn).map((b) => (
                        <Hv key={b} as="button" type="button" onClick={() => upd({ btn: b }, 'btn')}
                          style={{ height: 32, padding: '0 12px', borderRadius: 99, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--sand-200)', background: '#fff', fontSize: 13, fontWeight: 500, color: 'var(--sand-700)', cursor: 'pointer' }}
                          hover={{ borderColor: 'var(--sand-400)', background: 'var(--paper)' }}>{b}</Hv>
                      ))}
                    </div>
                  </div>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={lab}>{t('yc.sp.w.noted')}</span>
                    <textarea value={wz.noted} onChange={(e) => upd({ noted: e.target.value }, 'noted')} rows={2} maxLength={140} style={{ ...inputBase, height: 'auto', padding: '14px 16px', fontSize: 15.5, lineHeight: 1.45, resize: 'vertical' }} onFocus={focusOn} onBlur={focusOff} />
                    <span style={hint}>{t('yc.sp.w.notedHint')}</span>
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 14, background: 'var(--sand-50)', fontSize: 13.5, color: 'var(--sand-600)' }}>
                    <SpSvg d={SP_ICON.pin} size={16} sw={2.2} style={{ flex: 'none' }} />
                    <span>{wz.kind === 'communaute' ? t('yc.sp.w.dateCommunity') : !night ? t('yc.sp.w.dateNone') : t('yc.sp.w.dateFrom', { date: eventDate({ start_at: night.start_at, tz: night.tz }, locale), place: [host, night.city].filter(Boolean).join(' · ') })}</span>
                  </div>
                </>
              )}

              {step === 4 && <StepFields wz={wz} upd={upd} t={t} />}
            </section>

            <div style={{ position: 'sticky', bottom: 16, zIndex: 5, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px 20px', padding: '14px 18px', borderRadius: 22, background: 'rgba(255,255,255,.94)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', boxShadow: 'var(--shadow-md),inset 0 0 0 1px var(--sand-200)' }}>
              <span style={{ flex: '1 1 200px', fontSize: 14, lineHeight: 1.4, color: noteC, fontWeight: 500 }}>{note}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                {step > 1 && (
                  <Hv as="button" type="button" onClick={() => setStep(step - 1)} style={{ height: 46, padding: '0 16px', border: 0, background: 'none', fontSize: 15, fontWeight: 600, color: 'var(--sand-600)', cursor: 'pointer' }} hover={{ color: 'var(--ink)' }}>{t('yc.sp.w.backBtn')}</Hv>
                )}
                {isLast && (
                  <Hv as="button" type="button" onClick={() => { void save(false); }} disabled={busy}
                    style={{ height: 46, padding: '0 20px', borderRadius: 99, background: '#fff', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--sand-200)', color: 'var(--ink)', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
                    hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }}>{t('yc.sp.w.draft')}</Hv>
                )}
                {!isLast && (
                  <Hv as="button" type="button" onClick={() => { if (cur) go(step + 1); else toast(t('yc.sp.w.missToast', { x: miss[0] || t('yc.sp.w.m.choice') })); }}
                    style={{ height: 46, padding: '0 6px 0 22px', border: 0, borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                    hover={{ background: 'var(--sand-700)' }} active={{ transform: 'scale(.97)' }}>
                    {t('yc.sp.w.next')}<span style={{ width: 36, height: 36, borderRadius: 99, background: '#fff', color: 'var(--ink)', display: 'grid', placeItems: 'center' }}><SpSvg d={D_ARROW} size={16} sw={2.4} /></span>
                  </Hv>
                )}
                {isLast && (
                  <Hv as="button" type="button" onClick={() => { void save(true); }} aria-disabled={!allOk || busy}
                    style={{ height: 46, padding: `0 ${allOk ? '5px' : '22px'} 0 22px`, border: 0, borderRadius: 99, background: allOk ? 'var(--gradient-brand)' : 'var(--sand-100)', color: allOk ? '#fff' : 'var(--sand-500)', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, boxShadow: allOk ? 'var(--shadow-cta)' : 'none', cursor: allOk ? (busy ? 'wait' : 'pointer') : 'not-allowed', whiteSpace: 'nowrap', transition: 'transform 200ms cubic-bezier(.34,1.56,.64,1),filter 160ms,background 200ms' }}
                    hover={allOk ? { filter: 'brightness(1.05)', transform: 'translateY(-1px)' } : { filter: 'none' }} active={allOk ? { transform: 'scale(.97)' } : { transform: 'none' }}>
                    {isNew ? t('yc.sp.w.publish') : t('yc.sp.w.save')}
                    {allOk && <span style={{ width: 36, height: 36, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><SpSvg d={D_TICK} size={16} sw={2.6} /></span>}
                  </Hv>
                )}
              </div>
            </div>
          </div>

          <aside style={{ flex: '1 1 360px', minWidth: 0, position: 'sticky', top: 88, maxHeight: 'calc(100vh - 104px)', overflowY: 'auto', overscrollBehavior: 'contain', scrollbarWidth: 'thin', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '22px 16px 20px', borderRadius: 28, background: 'radial-gradient(90% 60% at 50% 0%,rgba(255,107,53,.1),transparent 70%),var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
            <span style={{ ...monoLabel, alignSelf: 'flex-start', paddingLeft: 4 }}>{t('yc.sp.w.preview')}</span>
            <Seg aria={t('yc.sp.w.previewAria')} value={wzTab} onChange={setWzTab} items={[{ v: 'page', l: t('yc.sp.w.tab.page') }, { v: 'noted', l: t('yc.sp.w.tab.noted') }, { v: 'msg', l: t('yc.sp.w.tab.msg') }]} />
            {wzTab === 'msg' && <Seg aria={t('yc.sp.w.channel')} value={ch} onChange={setCh} h={30} fs={13} items={[{ v: 'email', l: t('yc.sp.w.chEmail') }, { v: 'sms', l: t('yc.sp.w.chSms') }]} />}
            <InscriptionPhone cfg={cfg} scene={scene} scale={0.9} onToast={toast} />
            <span style={{ fontSize: 12.5, lineHeight: 1.4, color: 'var(--sand-500)', textAlign: 'center', textWrap: 'pretty' } as CSSProperties}>{t('yc.sp.w.previewHint')}</span>
          </aside>
        </div>
      </div>
    </SpMain>
  );
}

/** Étape 4 : les champs, la récompense, les dates, le message après l'inscription. */
function StepFields({ wz, upd, t }: { wz: Wz; upd: (p: Partial<Wz>, touched?: 'title' | 'sub' | 'btn' | 'noted') => void; t: (k: string, v?: Record<string, string | number | null | undefined>) => string }) {
  const { tp, locale } = useCrmT();
  const h2: CSSProperties = { margin: 0, fontFamily: "'Bricolage Grotesque'", fontWeight: 600, fontSize: 24, letterSpacing: '-.02em' };
  const lab: CSSProperties = { fontSize: 14, fontWeight: 600 };
  const locked = (title: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 14, background: 'var(--sand-50)' }}>
      <SpSvg d={SP_ICON.lock} size={16} sw={2.2} color="var(--sand-500)" style={{ flex: 'none' }} />
      <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600 }}>{title}</span>
      <ReqPill t={t} />
    </div>
  );
  const fields = { contact: wz.contact, extra: wz.extra, questions: wz.qs.map((q) => ({ label: q.q, options: parseOpts(q.raw), multi: q.multi })) };
  const nFields = fieldCount(fields);
  const setQ = (i: number, p: Partial<Wz['qs'][number]>) => upd({ qs: wz.qs.map((q, j) => (j === i ? { ...q, ...p } : q)) });
  const sugs = [partyQuestion(t), styleQuestion(t), { q: '', raw: '', multi: false }].filter((s) => !s.q || !wz.qs.some((q) => q.q === s.q));
  const rewards = [...REWARD_IDS.map((id) => ({ id, t: t(`yc.sp.rw.${id}.t`), s: t(`yc.sp.rw.${id}.s`), d: SP_ICON[id === 'prio' ? 'ticket' : id === 'drink' ? 'gift' : 'bolt'] })), { id: 'custom' as const, t: t('yc.sp.rw.custom.t'), s: t('yc.sp.rw.custom.s'), d: SP_ICON.pen }];
  const closeLabel: Record<CloseMode, string> = { sale: t('yc.sp.w.cl.sale'), date: t('yc.sp.w.cl.date'), eve: t('yc.sp.w.cl.eve'), manual: t('yc.sp.w.cl.manual'), never: t('yc.sp.w.cl.never') };
  const dtl = (v: string) => dt(fromLocalInput(v), locale) || '…';
  const opensTxt = wz.opens === 'now' ? t('yc.sp.w.sumNow') : t('yc.sp.w.sumAt', { d: dtl(wz.opensAt) });
  const closesTxt = wz.closes === 'sale' ? t('yc.sp.w.sc.sale', { d: dtl(wz.saleAt) }) : wz.closes === 'date' ? t('yc.sp.w.sc.date', { d: dtl(wz.closesAt) }) : t(`yc.sp.w.sc.${wz.closes}`);
  const dtInput = (value: string, onChange: (v: string) => void, aria: string) => (
    <input type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} aria-label={aria}
      style={{ alignSelf: 'flex-start', height: 46, boxSizing: 'border-box', padding: '0 14px', borderRadius: 12, borderWidth: 1.5, borderStyle: 'solid', borderColor: 'var(--sand-200)', background: '#fff', fontSize: 15, color: 'var(--ink)', outline: 0 }} onFocus={focusOn} onBlur={focusOff} />
  );
  const radio = (on: boolean, size = 22) => (
    <span style={{ flex: 'none', width: size, height: size, borderRadius: 99, boxSizing: 'border-box', border: on ? 0 : '1.5px solid var(--sand-300)', background: on ? 'var(--red-500)' : '#fff', display: 'grid', placeItems: 'center', color: '#fff' }}>
      {on && <SpSvg d={D_TICK} size={size === 22 ? 13 : 11} sw={size === 22 ? 3 : 3.4} />}
    </span>
  );

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><h2 style={h2}>{t('yc.sp.w.s4T')}</h2><span style={{ fontSize: 14.5, color: 'var(--sand-600)' }}>{t('yc.sp.w.s4S')}</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={monoLabel}>{t('yc.sp.w.fields')}</span>
        {locked(t('yc.sp.w.first'))}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', borderRadius: 14, background: 'var(--sand-50)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <SpSvg d={SP_ICON.lock} size={16} sw={2.2} color="var(--sand-500)" style={{ flex: 'none' }} />
            <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600 }}>{t('yc.sp.w.contact')}</span>
            <ReqPill t={t} />
          </div>
          <Seg aria={t('yc.sp.w.contactAria')} value={wz.contact} onChange={(v) => upd({ contact: v })} fs={13.5} radius={20} wrap style={{ alignSelf: 'flex-start' }}
            items={(['both', 'email', 'phone', 'all'] as const).map((c) => ({ v: c, l: t(`yc.sp.w.ct.${c}`) }))} />
        </div>
        <span style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--sand-500)' }}>{t(`yc.sp.w.ch.${wz.contact}`)}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={lab}>{t('yc.sp.w.askMore')}</span>
          {EXTRA_FIELDS.map((id) => {
            const v = wz.extra[id];
            const on = !!v?.on;
            const setF = (p: { on?: boolean; req?: boolean }) => upd({ extra: { ...wz.extra, [id]: { on: false, req: false, ...v, ...p } } });
            return (
              <div key={id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px', padding: '12px 16px', borderRadius: 14, background: on ? '#fff' : 'var(--sand-50)', borderWidth: 1.5, borderStyle: 'solid', borderColor: on ? 'var(--sand-300)' : 'transparent' }}>
                <button type="button" role="switch" aria-checked={on} aria-label={t(`yc.sp.fld.${id}.pro`)} onClick={() => setF({ on: !on })} style={{ flex: 'none', padding: 0, border: 0, background: 'none', cursor: 'pointer', display: 'flex' }}><Knob on={on} /></button>
                <span style={{ flex: '1 1 150px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <b style={{ fontSize: 14.5 }}>{t(`yc.sp.fld.${id}.pro`)}</b>
                  <span style={{ fontSize: 13, color: 'var(--sand-600)' }}>{t(`yc.sp.fld.${id}.s`)}</span>
                </span>
                {on && <Seg aria={t('yc.sp.w.reqAria')} value={v?.req ? 'req' : 'opt'} onChange={(r) => setF({ req: r === 'req' })} h={30} fs={13} padX={12}
                  items={[{ v: 'req', l: t('yc.sp.w.required') }, { v: 'opt', l: t('yc.sp.w.optional') }]} />}
              </div>
            );
          })}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, background: nFields > 5 ? 'var(--amber-50)' : 'var(--sand-50)', fontSize: 13, lineHeight: 1.4, color: nFields > 5 ? 'var(--amber-700)' : 'var(--sand-600)' }}>
            {tp('yc.sp.w.fcount', nFields)}{nFields > 5 ? t('yc.sp.w.fcountMany') : t('yc.sp.w.fcountOk')}
          </div>
        </div>
        {wz.qs.map((q, i) => {
          const opts = parseOpts(q.raw);
          const bad = !q.q.trim() || opts.length < 2;
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', borderRadius: 14, borderWidth: 1.5, borderStyle: 'solid', borderColor: 'var(--sand-200)', background: '#fff', animation: anim('sp-pop', 280) }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input value={q.q} onChange={(e) => setQ(i, { q: e.target.value })} maxLength={50} aria-label={t('yc.sp.w.q')} placeholder={t('yc.sp.w.qMine')}
                  style={{ ...inputBase, flex: 1, minWidth: 0, height: 44, borderRadius: 10, padding: '0 14px', fontSize: 15, fontWeight: 600 }} onFocus={focusOn} onBlur={focusOff} />
                <Hv as="button" type="button" onClick={() => upd({ qs: wz.qs.filter((_, j) => j !== i) })} aria-label={t('yc.sp.w.qDel')}
                  style={{ flex: 'none', width: 36, height: 36, border: 0, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
                  hover={{ background: 'var(--red-50)', color: 'var(--red-700)' }}><SpSvg d={D_X} size={14} sw={2.4} /></Hv>
              </div>
              <input value={q.raw} onChange={(e) => setQ(i, { raw: e.target.value })} aria-label={t('yc.sp.w.qOpts')} placeholder={t('yc.sp.w.qOptsPh')}
                style={{ ...inputBase, height: 42, borderRadius: 10, padding: '0 14px', fontSize: 14.5 }} onFocus={focusOn} onBlur={focusOff} />
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {opts.map((o) => <span key={o} style={{ height: 28, padding: '0 12px', borderRadius: 99, background: 'var(--sand-100)', fontSize: 13, fontWeight: 600, color: 'var(--sand-700)', display: 'inline-flex', alignItems: 'center' }}>{o}</span>)}
                </span>
                <Hv as="button" type="button" role="switch" aria-checked={q.multi} onClick={() => setQ(i, { multi: !q.multi })}
                  style={{ height: 32, padding: '0 12px', borderRadius: 99, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--sand-200)', background: '#fff', fontSize: 13, fontWeight: 600, color: 'var(--sand-700)', cursor: 'pointer' }}
                  hover={{ background: 'var(--paper)' }}>{q.multi ? t('yc.sp.w.qMulti') : t('yc.sp.w.qSingle')}</Hv>
              </div>
              {bad && <span style={{ fontSize: 13, color: 'var(--red-600)' }}>{t('yc.sp.w.qBad')}</span>}
            </div>
          );
        })}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {wz.qs.length < 2 ? (
            <>
              <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.sp.w.qAdd')}</span>
              {sugs.map((s) => (
                <Hv key={s.q || 'mine'} as="button" type="button" onClick={() => upd({ qs: [...wz.qs, { ...s }] })}
                  style={{ height: 34, padding: '0 14px 0 10px', borderRadius: 99, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'var(--sand-300)', background: 'transparent', color: 'var(--sand-700)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  hover={{ borderColor: 'var(--red-300)', background: 'var(--red-50)', color: 'var(--red-700)' }}>
                  <SpSvg d={D_PLUS} size={14} sw={2.4} />{s.q || t('yc.sp.w.qMine')}
                </Hv>
              ))}
            </>
          ) : <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.sp.w.qMax')}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderRadius: 14, background: 'var(--sand-50)' }}>
          <SpSvg d={SP_ICON.lock} size={16} sw={2.2} color="var(--sand-500)" style={{ flex: 'none', marginTop: 2 }} />
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>{t('yc.sp.w.consentT')}</span>
            <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-600)' }}>{t('yc.sp.w.consentS')}</span>
          </span>
          <ReqPill t={t} />
        </div>
        <SwitchRow on={wz.showCount} onClick={() => upd({ showCount: !wz.showCount })} title={t('yc.sp.w.countT')} sub={t('yc.sp.w.countS')} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={monoLabel}>{t('yc.sp.w.reward')}</span>
        <SwitchRow on={wz.reward.on} onClick={() => upd({ reward: { ...wz.reward, on: !wz.reward.on } })} title={t('yc.sp.w.rewardT')} sub={t('yc.sp.w.rewardS')} />
        {wz.reward.on && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, animation: anim('sp-pop', 280) }}>
            {rewards.map((r) => {
              const on = wz.reward.preset === r.id;
              return (
                <Hv key={r.id} as="button" type="button" aria-pressed={on} onClick={() => upd({ reward: { ...wz.reward, preset: r.id } })}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', borderRadius: 16, borderWidth: 1.5, borderStyle: 'solid', borderColor: on ? 'var(--red-400)' : 'var(--sand-200)', background: on ? 'var(--red-50)' : '#fff', textAlign: 'left', cursor: 'pointer', color: 'var(--ink)' }}
                  hover={{ borderColor: on ? 'var(--red-400)' : 'var(--sand-400)' }}>
                  <span style={{ flex: 'none', width: 38, height: 38, borderRadius: 12, background: on ? '#fff' : 'var(--sand-100)', color: on ? 'var(--red-600)' : 'var(--sand-700)', display: 'grid', placeItems: 'center' }}><SpSvg d={r.d} size={18} sw={2} /></span>
                  <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}><b style={{ fontSize: 15 }}>{r.t}</b><span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{r.s}</span></span>
                  {radio(on)}
                </Hv>
              );
            })}
            {wz.reward.preset === 'custom' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, borderRadius: 16, background: 'var(--sand-50)', animation: anim('sp-pop', 280) }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={lab}>{t('yc.sp.w.rcT')}</span>
                  <input value={wz.reward.label} onChange={(e) => upd({ reward: { ...wz.reward, label: e.target.value } })} maxLength={40} placeholder={t('yc.sp.w.rcTPh')} style={{ ...inputBase, height: 46, padding: '0 14px', fontSize: 15.5 }} onFocus={focusOn} onBlur={focusOff} />
                  <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.sp.w.chars', { n: wz.reward.label.length, max: 40 })}</span>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={lab}>{t('yc.sp.w.rcS')} <span style={{ fontWeight: 400, color: 'var(--sand-500)' }}>{t('yc.sp.w.rcSOpt')}</span></span>
                  <input value={wz.reward.how} onChange={(e) => upd({ reward: { ...wz.reward, how: e.target.value } })} maxLength={70} placeholder={t('yc.sp.w.rcSPh')} style={{ ...inputBase, height: 46, padding: '0 14px', fontSize: 15.5 }} onFocus={focusOn} onBlur={focusOff} />
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={lab}>{t('yc.sp.w.rcIcon')}</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {REWARD_ICONS.map((ic) => {
                      const on = wz.reward.icon === ic;
                      return (
                        <button key={ic} type="button" onClick={() => upd({ reward: { ...wz.reward, icon: ic } })} aria-pressed={on} aria-label={t(`yc.sp.ri.${ic}`)} title={t(`yc.sp.ri.${ic}`)}
                          style={{ width: 44, height: 44, borderRadius: 12, borderWidth: 1.5, borderStyle: 'solid', borderColor: on ? 'var(--red-400)' : 'var(--sand-200)', background: on ? 'var(--red-50)' : '#fff', color: on ? 'var(--red-600)' : 'var(--sand-700)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                          <SpSvg d={SP_ICON[ic]} size={19} sw={2} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={monoLabel}>{t('yc.sp.w.dates')}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={lab}>{t('yc.sp.w.opens')}</span>
          <Seg aria={t('yc.sp.w.opensAria')} value={wz.opens} onChange={(v) => upd({ opens: v })} padX={16} style={{ alignSelf: 'flex-start' }}
            items={[{ v: 'now', l: t('yc.sp.w.op.now') }, { v: 'date', l: t('yc.sp.w.op.date') }]} />
          {wz.opens === 'date' && dtInput(wz.opensAt, (v) => upd({ opensAt: v }), t('yc.sp.w.opensAt'))}
        </div>
        {wz.kind === 'prevente' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={lab}>{t('yc.sp.w.saleAt')}</span>
            {dtInput(wz.saleAt, (v) => upd({ saleAt: v }), t('yc.sp.w.saleAtAria'))}
            <SwitchRow on={wz.countdown} onClick={() => upd({ countdown: !wz.countdown })} title={t('yc.sp.w.cdT')} sub={t('yc.sp.w.cdS')} />
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={lab}>{t('yc.sp.w.closes')}</span>
          {KIND_META[wz.kind].closes.map((c) => {
            const on = wz.closes === c;
            return (
              <Hv key={c} as="button" type="button" aria-pressed={on} onClick={() => upd({ closes: c })}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderRadius: 14, borderWidth: 1.5, borderStyle: 'solid', borderColor: on ? 'var(--red-400)' : 'var(--sand-200)', background: on ? 'var(--red-50)' : '#fff', textAlign: 'left', cursor: 'pointer', color: 'var(--ink)' }}
                hover={{ borderColor: on ? 'var(--red-400)' : 'var(--sand-400)' }}>
                {radio(on, 20)}<span style={{ fontSize: 14.5, fontWeight: 600 }}>{closeLabel[c]}</span>
              </Hv>
            );
          })}
          {wz.closes === 'date' && dtInput(wz.closesAt, (v) => upd({ closesAt: v }), t('yc.sp.w.closesAt'))}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderRadius: 14, background: 'var(--red-50)' }}>
          <span style={{ flex: 'none', width: 8, height: 8, marginTop: 7, borderRadius: 99, background: 'var(--red-500)' }} />
          <span style={{ fontSize: 14.5, lineHeight: 1.45, fontWeight: 500, textWrap: 'pretty' } as CSSProperties}>{opensTxt}{t('yc.sp.w.sumThen')}{closesTxt}{t('yc.sp.w.sumEnd')}</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={monoLabel}>{t('yc.sp.w.after')}</span>
        <SwitchRow on={wz.notify} onClick={() => upd({ notify: !wz.notify })} title={t(`yc.sp.ty.${wz.kind}.msgOn`)} sub={t(`yc.sp.ty.${wz.kind}.msgOnS`)} />
        {wz.notify && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, animation: anim('sp-pop', 280) }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {([['email', t('yc.sp.w.chEmail'), SP_ICON.mail, t('yc.sp.w.costEmail')], ['sms', t('yc.sp.w.chSms'), SP_ICON.sms, t('yc.sp.w.costSms')]] as const).map(([k, l, d, cost]) => {
                const on = wz.ch[k];
                return (
                  <button key={k} type="button" onClick={() => upd({ ch: { ...wz.ch, [k]: !on } })} aria-pressed={on}
                    style={{ height: 40, padding: '0 16px 0 12px', borderRadius: 99, borderWidth: 1.5, borderStyle: 'solid', borderColor: on ? 'var(--red-400)' : 'var(--sand-200)', background: on ? 'var(--red-50)' : '#fff', fontSize: 14.5, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <SpSvg d={d} size={16} sw={2.2} />{l}<span style={{ fontWeight: 500, color: 'var(--sand-500)' }}>{cost}</span>
                  </button>
                );
              })}
            </div>
            <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.sp.w.chHint')}</span>
            {wz.ch.sms && !CRM_SMS_SIGNUP_LIVE && <span style={{ fontSize: 13, color: 'var(--amber-700)' }}>{t('yc.sp.w.smsSoon')}</span>}
          </div>
        )}
      </div>
    </>
  );
}

function ReqPill({ t }: { t: (k: string) => string }) {
  return <span style={{ height: 24, padding: '0 10px', borderRadius: 99, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', fontSize: 12, fontWeight: 600, color: 'var(--sand-600)', display: 'inline-flex', alignItems: 'center' }}>{t('yc.sp.w.required')}</span>;
}
