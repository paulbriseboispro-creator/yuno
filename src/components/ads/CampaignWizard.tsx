// Assistant « Booster une soirée » — cinq étapes nommées, une campagne Meta
// créée EN PAUSE depuis Yuno (l'activation est un clic séparé et confirmé sur
// la page Publicité). Design : docs/designs/META_ADS_INTEGRATION_PLAN.md.
//
// Le pro ne voit jamais un identifiant Meta : il choisit une soirée, un
// budget, une zone, compose une ou plusieurs créations (image, carrousel,
// vidéo) et relit. L'edge `meta-connect` (`campaign_create`) transforme ça en
// campagne + ensemble + une pub par création, et pose un lien suivi Yuno qui
// attribuera les ventes réelles à cette campagne. Plusieurs créations
// partagent le budget : Meta le déplace vers celle qui vend le mieux.
//
// Les étapes vivent dans `./wizard/` ; ce fichier tient l'état, la
// validation, l'estimation d'audience et l'envoi.

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { X, ChevronRight, ChevronLeft, Loader2, Rocket, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import type { DeferredUpload } from '@/lib/deferredUpload';
import {
  DEFAULT_RADIUS_KM, FULL_MODE_AGE_MIN_CAP, MIN_BUDGET_CENTS, WIZARD_STEPS, CREATIVE_DESTINATIONS, creativeIssues, destinationAvailable, newCreative,
  type AdCreative, type AdsAudience, type AdsCampaign, type AdsEvent, type Delivery, type WizardStep,
} from '@/lib/metaAds';
import type { CampaignDraft, DraftCreative, WizardCall, WizardMode } from './wizard/types';
import { Sliders } from 'lucide-react';
import { Stepper } from './wizard/Stepper';
import { StepEvent } from './wizard/StepEvent';
import { StepBudget } from './wizard/StepBudget';
import { StepTargeting } from './wizard/StepTargeting';
import { StepCreatives } from './wizard/StepCreatives';
import { StepReview } from './wizard/StepReview';
import { RED, META_BLUE, T1, T2, T3, BORDER, FIELD_BG } from './wizard/ui';

export interface WizardScope { venueId?: string | null; organizerUserId?: string | null }

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EXPERT_DEFAULTS = {
  excludedCities: [], zips: [], customLocations: [], locationTypes: [], detailed: [],
  igPositions: [], fbPositions: [], devices: [],
  conversionEvent: 'PURCHASE' as const, optimizationGoal: '', bidStrategy: 'lowest' as const, bidAmountEuros: 5, roasFloor: 2,
  schedule: [], frequencyMax: 2, frequencyDays: 7, urlTags: '',
};

/** Brouillon depuis une campagne existante (modifier ou dupliquer). */
function draftFromCampaign(c: AdsCampaign, mode: WizardMode, language: string, event: AdsEvent | null): CampaignDraft {
  const tg = c.targeting ?? {}; const d: Delivery = c.delivery ?? {};
  const toLocal = (iso: string | null | undefined, fallback: Date) => toLocalInput(iso ? new Date(iso) : fallback);
  const start = mode === 'edit' ? new Date(c.start_at) : new Date(Date.now() + 15 * 60 * 1000);
  const end = c.end_at ? new Date(c.end_at) : (event ? new Date(event.start_at) : new Date(Date.now() + 7 * 24 * 3600 * 1000));
  const creatives: DraftCreative[] = (c.creatives ?? []).map((cr) => {
    const n = newCreative({ format: cr.format, headline: cr.headline, body: cr.body, description: cr.description ?? '', cta: cr.cta, enhancements: cr.enhancements === true, design: cr.design ?? null, destination: cr.destination ?? 'all' }) as DraftCreative;
    return { ...n, media: cr.media.map((m, i) => ({ ...m, localId: `${n.id}_${i}` })), vertical_media: cr.vertical_media?.url ? { ...cr.vertical_media, localId: `${n.id}_v` } : null };
  });
  return {
    eventId: c.event_id ?? event?.id ?? '',
    name: mode === 'edit' ? c.name : `${c.name} (${language === 'en' ? 'copy' : language === 'es' ? 'copia' : 'copie'})`.slice(0, 100),
    objective: c.objective,
    budgetType: c.budget_type,
    budgetEuros: Math.round(c.budget_cents / 100),
    startAt: toLocal(mode === 'edit' ? c.start_at : null, start),
    endAt: toLocalInput(end > start ? end : new Date(start.getTime() + 3 * 24 * 3600 * 1000)),
    cities: tg.cities ?? [],
    country: tg.countries?.[0] ?? (language === 'es' ? 'ES' : 'FR'),
    ageMin: tg.age_min ?? 18, ageMax: tg.age_max ?? 35, genders: tg.genders ?? [],
    audienceIds: tg.audience_ids ?? [], excludeAudienceIds: tg.exclude_audience_ids ?? [],
    interests: tg.interests ?? [], locales: [],
    audienceMode: tg.audience_mode ?? (tg.advantage === false ? 'strict' : 'full'),
    facebook: c.placements?.facebook !== false, instagram: c.placements?.instagram !== false,
    creatives: creatives.length ? creatives : [posterCreative(event)],
    ...EXPERT_DEFAULTS,
    excludedCities: tg.excluded_cities ?? [], zips: tg.zips ?? [], customLocations: tg.custom_locations ?? [], locationTypes: tg.location_types ?? [], detailed: tg.detailed ?? [],
    igPositions: c.placements?.positions?.instagram ?? [], fbPositions: c.placements?.positions?.facebook ?? [], devices: c.placements?.devices ?? [],
    conversionEvent: d.conversion_event ?? 'PURCHASE', optimizationGoal: d.optimization_goal ?? '',
    bidStrategy: d.bid?.strategy ?? 'lowest', bidAmountEuros: d.bid?.amount_cents ? d.bid.amount_cents / 100 : 5, roasFloor: d.bid?.roas_floor ?? 2,
    schedule: d.schedule ?? [], frequencyMax: d.frequency?.max ?? 2, frequencyDays: d.frequency?.days ?? 7, urlTags: d.url_tags ?? '',
  };
}

function posterCreative(e: AdsEvent | null): DraftCreative {
  const c = newCreative({ headline: e ? e.title.slice(0, 40) : '', cta: 'BUY_TICKETS' }) as DraftCreative;
  return { ...c, media: e?.poster_url ? [{ localId: `poster_${c.id}`, kind: 'image', url: e.poster_url }] : [] };
}

export function CampaignWizard({
  scope, events, audiences, homeCity, defaultEventId, currency, pageId, pageName, igUsername, mode: modeProp, initial, onClose, onCreated,
}: {
  scope: WizardScope;
  events: AdsEvent[];
  audiences: AdsAudience[];
  homeCity: string | null;
  defaultEventId?: string | null;
  currency: string;
  /** Identité retenue à la connexion : la Page (et son Instagram) sous laquelle la pub paraît. */
  pageId?: string | null;
  pageName?: string | null;
  igUsername?: string | null;
  /** `edit` : campagne vivante (soirée, objectif et créations figés) ; `duplicate` : nouvelle campagne pré-remplie. */
  mode?: WizardMode;
  initial?: AdsCampaign | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, language } = useLanguage();
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const mode: WizardMode = initial ? (modeProp ?? 'duplicate') : 'create';
  const editing = mode === 'edit';
  const activeSteps: WizardStep[] = editing ? WIZARD_STEPS.filter((k) => k !== 'creative') : [...WIZARD_STEPS];
  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  // Mode expert : tout ce qu'Ads Manager laisse régler. Mémorisé sur l'appareil.
  const [expert, setExpert] = useState<boolean>(() => { try { return localStorage.getItem('yuno:ads:expert') === '1'; } catch { return false; } });
  const toggleExpert = () => setExpert((v) => { try { localStorage.setItem('yuno:ads:expert', v ? '0' : '1'); } catch { /* no-op */ } return !v; });
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<{ lower: number; upper: number } | null | 'loading' | 'unknown'>(null);
  const uploadsRef = useRef<Map<string, DeferredUpload>>(new Map());
  const createdRef = useRef(false);

  const firstEvent = events.find((e) => e.id === (initial?.event_id ?? defaultEventId)) ?? events[0] ?? null;
  const [draft, setDraft] = useState<CampaignDraft>(() => {
    if (initial) return draftFromCampaign(initial, mode, language, firstEvent);
    const start = new Date(Date.now() + 15 * 60 * 1000);
    const end = firstEvent ? new Date(firstEvent.start_at) : new Date(Date.now() + 7 * 24 * 3600 * 1000);
    return {
      eventId: firstEvent?.id ?? '',
      name: firstEvent ? firstEvent.title.slice(0, 100) : '',
      objective: 'OUTCOME_SALES',
      budgetType: 'lifetime',
      budgetEuros: 50,
      startAt: toLocalInput(start),
      endAt: toLocalInput(end > start ? end : new Date(start.getTime() + 3 * 24 * 3600 * 1000)),
      cities: [],
      country: language === 'es' ? 'ES' : 'FR',
      ageMin: 18,
      ageMax: 35,
      genders: [],
      audienceIds: [],
      excludeAudienceIds: [],
      interests: [],
      locales: [],
      audienceMode: 'relaxed',
      facebook: true,
      instagram: true,
      creatives: [posterCreative(firstEvent)],
      ...EXPERT_DEFAULTS,
    };
  });
  const [selectedCreative, setSelectedCreative] = useState(() => draft.creatives[0].id);
  const set = <K extends keyof CampaignDraft>(k: K, v: CampaignDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const event = useMemo(() => events.find((e) => e.id === draft.eventId) ?? null, [events, draft.eventId]);

  // Choisir une soirée pré-remplit le nom, la fin, et l'affiche des créations
  // qui n'ont encore rien (une création déjà composée n'est jamais écrasée).
  const pickEvent = (e: AdsEvent) => {
    setDraft((d) => ({
      ...d,
      eventId: e.id,
      name: d.eventId === e.id ? d.name : e.title.slice(0, 100),
      endAt: toLocalInput(new Date(Math.max(new Date(e.start_at).getTime(), new Date(d.startAt).getTime() + 3600 * 1000))),
      creatives: d.creatives.map((c) => {
        const untouched = c.media.every((m) => m.localId.startsWith('poster_')) && c.body === '';
        if (!untouched) return c;
        return { ...c, headline: e.title.slice(0, 40), media: e.poster_url ? [{ localId: `poster_${c.id}`, kind: 'image', url: e.poster_url }] : [] };
      }),
    }));
  };

  const scopeBody = { venueId: scope.venueId ?? null, organizerUserId: scope.organizerUserId ?? null };
  const call: WizardCall = async (action, body) => {
    const { data, error } = await supabase.functions.invoke('meta-connect', { body: { action, scope: scopeBody, ...body } });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      let code: string | null = null; let detail: string | null = null;
      if (ctx instanceof Response) {
        try { const j = (await ctx.clone().json()) as { error?: string; detail?: string }; code = j.error ?? null; detail = j.detail ?? null; } catch { /* no-op */ }
      }
      throw new Error(detail ? `${code}: ${detail}` : (code ?? error.message));
    }
    return data as Record<string, unknown>;
  };

  const targetingPayload = useMemo(() => ({
    countries: [draft.country], cities: draft.cities, age_min: draft.ageMin, age_max: draft.ageMax,
    genders: draft.genders, audience_ids: draft.audienceIds, exclude_audience_ids: draft.excludeAudienceIds,
    interests: expert ? [] : draft.interests.map((i) => ({ id: i.id, name: i.name })),
    detailed: expert ? draft.detailed.filter((g) => g.items.length) : [],
    locales: draft.locales.map((l) => l.key), audience_mode: draft.audienceMode, advantage: draft.audienceMode !== 'strict',
    excluded_cities: expert ? draft.excludedCities : [], zips: expert ? draft.zips : [], custom_locations: expert ? draft.customLocations : [], location_types: expert ? draft.locationTypes : [],
  }), [expert, draft.country, draft.cities, draft.ageMin, draft.ageMax, draft.genders, draft.audienceIds, draft.excludeAudienceIds, draft.interests, draft.detailed, draft.locales, draft.audienceMode, draft.excludedCities, draft.zips, draft.customLocations, draft.locationTypes]);
  const placementsPayload = useMemo(() => ({
    facebook: draft.facebook, instagram: draft.instagram,
    ...(expert ? { positions: { instagram: draft.igPositions, facebook: draft.fbPositions }, devices: draft.devices } : {}),
  }), [expert, draft.facebook, draft.instagram, draft.igPositions, draft.fbPositions, draft.devices]);
  const deliveryPayload = useMemo((): Delivery => {
    const d: Delivery = {};
    if (draft.objective === 'OUTCOME_SALES') d.conversion_event = expert ? draft.conversionEvent : 'PURCHASE';
    if (draft.objective !== 'OUTCOME_SALES' && draft.optimizationGoal) d.optimization_goal = draft.optimizationGoal;
    if (!expert) return d;
    if (draft.bidStrategy !== 'lowest') d.bid = { strategy: draft.bidStrategy, amount_cents: Math.round(draft.bidAmountEuros * 100), roas_floor: draft.roasFloor };
    if (draft.budgetType === 'lifetime' && draft.schedule.length) d.schedule = draft.schedule.filter((sl) => sl.days.length && sl.end_hour > sl.start_hour);
    if (draft.objective === 'OUTCOME_AWARENESS') d.frequency = { max: draft.frequencyMax, days: draft.frequencyDays };
    if (draft.urlTags.trim()) d.url_tags = draft.urlTags.trim();
    return d;
  }, [expert, draft.objective, draft.conversionEvent, draft.optimizationGoal, draft.bidStrategy, draft.bidAmountEuros, draft.roasFloor, draft.budgetType, draft.schedule, draft.frequencyMax, draft.frequencyDays, draft.urlTags]);

  // Estimation Meta de l'audience, recalculée 700 ms après le dernier réglage.
  useEffect(() => {
    if (activeSteps[step] !== 'targeting') return;
    setEstimate('loading');
    const timer = window.setTimeout(async () => {
      try {
        const r = await call('ads_reach_estimate', { targeting: targetingPayload, placements: placementsPayload });
        const est = r.estimate as { lower: number; upper: number } | null;
        setEstimate(est ?? 'unknown');
      } catch { setEstimate('unknown'); }
    }, 700);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, targetingPayload, placementsPayload]);

  // Fermer sans créer : les fichiers envoyés ne servent à rien, on les retire.
  useEffect(() => () => { if (!createdRef.current) uploadsRef.current.forEach((u) => u.discard()); }, []);

  const readyAudiences = audiences.filter((a) => a.status === 'ready' && a.meta_audience_id);
  const budgetCents = Math.round(draft.budgetEuros * 100);
  const startDate = new Date(draft.startAt);
  const endDate = new Date(draft.endAt);
  const creativesOk = draft.creatives.every((c) => creativeIssues(c as unknown as AdCreative).length === 0 && !c.media.some((m) => m.uploading || m.error || (!m.url && m.kind !== 'ig_post')) && !(c.vertical_media && (c.vertical_media.uploading || c.vertical_media.error || !c.vertical_media.url)));
  const validByKey: Record<WizardStep, boolean> = {
    event: !!draft.eventId && draft.name.trim().length >= 3,
    budget: budgetCents >= MIN_BUDGET_CENTS && !Number.isNaN(startDate.getTime()) && (draft.budgetType === 'daily' || (!Number.isNaN(endDate.getTime()) && endDate > startDate))
      && (!expert || draft.bidStrategy === 'lowest' || (draft.bidStrategy === 'min_roas' ? draft.roasFloor > 0 : draft.bidAmountEuros > 0)),
    targeting: !!draft.country && draft.ageMin >= 18 && draft.ageMax >= draft.ageMin && (draft.facebook || draft.instagram),
    creative: creativesOk && draft.creatives.every((c) => destinationAvailable({ facebook: draft.facebook, instagram: draft.instagram, igPositions: expert ? draft.igPositions : [], fbPositions: expert ? draft.fbPositions : [] }, c.destination ?? 'all')),
    review: true,
  };
  const stepValid = activeSteps.map((k) => validByKey[k]);
  const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000));
  const totalEstimate = draft.budgetType === 'daily' ? draft.budgetEuros * days : draft.budgetEuros;
  const fmtMoney = (eur: number) => new Intl.NumberFormat(language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR', { style: 'currency', currency: currency || 'EUR', maximumFractionDigits: 0 }).format(eur);

  const go = (i: number) => { setStep(i); setFurthest((f) => Math.max(f, i)); setSubmitError(null); };
  const next = () => go(Math.min(activeSteps.length - 1, step + 1));

  // Toujours créée en pause : aucun argent ne part d'ici.
  const submit = async () => {
    setBusy(true);
    setSubmitError(null);
    try {
      // Un envoi encore en route : on l'attend plutôt que d'envoyer une URL vide.
      await Promise.all([...uploadsRef.current.values()].map((u) => u.result));
      const creatives = draft.creatives.map((c) => ({
        format: c.format,
        media: c.media.map((m) => ({ url: m.url, kind: m.kind, ig_media_id: m.ig_media_id ?? null, thumbnail_url: m.thumbnail_url ?? null, headline: m.headline ?? null, description: m.description ?? null })),
        vertical_media: c.vertical_media?.url ? { url: c.vertical_media.url, kind: c.vertical_media.kind, thumbnail_url: c.vertical_media.thumbnail_url ?? null } : null,
        enhancements: c.enhancements === true,
        design: c.design ?? null,
        destination: c.destination ?? 'all',
        headline: c.headline.trim(), body: c.body.trim(), description: c.description.trim() || null, cta: c.cta,
      }));
      if (creatives.some((c) => c.media.some((m) => !m.url && m.kind !== 'ig_post'))) throw new Error(t('ads.w.media.uploadFailed'));
      if (editing && initial) {
        const res = await call('campaign_update', {
          campaignId: initial.id, name: draft.name.trim(), budgetCents,
          startAt: startDate.toISOString(), endAt: draft.budgetType === 'lifetime' || draft.endAt ? endDate.toISOString() : null,
          targeting: targetingPayload, placements: placementsPayload, delivery: deliveryPayload,
        });
        if (res.ok) { createdRef.current = true; toast.success(t('ads.x.edit.saved')); onCreated(); onClose(); }
        else setSubmitError(String(res.error ?? t('ads.err.generic')));
        return;
      }
      const res = await call('campaign_create', {
        eventId: draft.eventId, name: draft.name.trim(), objective: draft.objective,
        budgetType: draft.budgetType, budgetCents,
        startAt: startDate.toISOString(), endAt: draft.budgetType === 'lifetime' || draft.endAt ? endDate.toISOString() : null,
        targeting: targetingPayload,
        creatives,
        placements: placementsPayload,
        delivery: deliveryPayload,
      });
      if (res.ok) {
        createdRef.current = true;
        uploadsRef.current.forEach((u) => u.keep());
        toast.success(t('ads.wizard.createdPaused'));
        onCreated();
        onClose();
      } else {
        // La ligne existe côté Yuno en « erreur » : la liste la montre aussi.
        setSubmitError(String(res.error ?? t('ads.err.generic')));
        onCreated();
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : t('ads.err.generic'));
    } finally {
      setBusy(false);
    }
  };

  // Où l'ensemble diffuse, en clair, et si stories / reels en font partie (la version verticale n'a de sens que là).
  const igPos = expert && draft.igPositions.length ? draft.igPositions : ['stream', 'story', 'reels'];
  const fbPos = expert && draft.fbPositions.length ? draft.fbPositions : ['feed', 'story', 'facebook_reels'];
  const verticalOn = (draft.instagram && igPos.some((p) => p === 'story' || p === 'reels')) || (draft.facebook && fbPos.some((p) => p === 'story' || p === 'facebook_reels'));
  const placementsLabel = [
    draft.instagram ? `Instagram (${(expert && draft.igPositions.length ? draft.igPositions : ['stream', 'story', 'reels']).map((p) => t(`ads.x.place.ig.${p}`)).join(', ')})` : null,
    draft.facebook ? `Facebook (${(expert && draft.fbPositions.length ? draft.fbPositions : ['feed', 'story', 'facebook_reels']).map((p) => t(`ads.x.place.fb.${p}`)).join(', ')})` : null,
  ].filter(Boolean).join(' · ') + (!expert || (!draft.igPositions.length && !draft.fbPositions.length) ? ` · ${t('ads.w.where.auto')}` : '');
  const destinationsAvailable = Object.fromEntries(CREATIVE_DESTINATIONS.map((d) => [d, destinationAvailable({ facebook: draft.facebook, instagram: draft.instagram, igPositions: expert ? draft.igPositions : [], fbPositions: expert ? draft.fbPositions : [] }, d)])) as Record<'all' | 'feed' | 'story' | 'reel', boolean>;
  const steps = activeSteps.map((k) => ({ key: k, label: t(`ads.wizard.step.${k}`), short: t(`ads.w.step.${k}.short`) }));
  const stepIndex = (k: WizardStep) => Math.max(0, activeSteps.indexOf(k));
  const current = activeSteps[step];
  const genderLabel = draft.genders.length === 0 ? t('ads.wizard.genderAll') : draft.genders[0] === 2 ? t('ads.wizard.genderWomen') : t('ads.wizard.genderMen');
  const objectiveLabel = draft.objective === 'OUTCOME_SALES' ? t('ads.wizard.objectiveSales') : draft.objective === 'OUTCOME_TRAFFIC' ? t('ads.wizard.objectiveTraffic') : t('ads.x.obj.awareness');
  const zoneParts = [
    draft.cities.length ? draft.cities.map((c) => `${c.name}${c.type !== 'region' ? ` (${c.radius_km ?? DEFAULT_RADIUS_KM} km)` : ''}`).join(', ') : null,
    expert && draft.zips.length ? draft.zips.map((z) => z.name).join(', ') : null,
    expert && draft.customLocations.length ? draft.customLocations.map((c) => `${c.name ?? '📍'} (${c.radius_km} km)`).join(', ') : null,
  ].filter(Boolean);
  const detailedLabel = expert
    ? draft.detailed.filter((g) => g.items.length).map((g) => g.items.map((i) => i.name).join(' / ')).join('  ET  ')
    : draft.interests.map((i) => i.name).join(', ');
  const deliveryLabel = [
    draft.objective === 'OUTCOME_SALES' && expert ? t(`ads.x.conv.${draft.conversionEvent}`) : null,
    draft.objective !== 'OUTCOME_SALES' && draft.optimizationGoal ? t(`ads.x.opt.${draft.optimizationGoal}`) : null,
    expert && draft.bidStrategy !== 'lowest' ? `${t(`ads.x.bid.${draft.bidStrategy}`)} ${draft.bidStrategy === 'min_roas' ? `${draft.roasFloor}×` : fmtMoney(draft.bidAmountEuros)}` : null,
    expert && draft.budgetType === 'lifetime' && draft.schedule.length ? t('ads.x.sched.summary').replace('{n}', String(draft.schedule.length)) : null,
    expert && draft.objective === 'OUTCOME_AWARENESS' ? `${draft.frequencyMax} / ${draft.frequencyDays} j` : null,
    expert && draft.urlTags.trim() ? 'UTM' : null,
  ].filter(Boolean).join(' · ');
  const reviewRows = [
    { label: t('ads.wizard.step.event'), value: `${event?.title ?? '—'} · ${draft.name}`, step: stepIndex('event') },
    { label: t('ads.wizard.objective'), value: objectiveLabel, step: stepIndex('event') },
    { label: t('ads.wizard.step.budget'), value: `${fmtMoney(draft.budgetEuros)} ${draft.budgetType === 'daily' ? t('ads.wizard.perDay') : t('ads.wizard.inTotal')} · ${format(startDate, 'd MMM HH:mm', { locale })} → ${Number.isNaN(endDate.getTime()) ? '—' : format(endDate, 'd MMM HH:mm', { locale })}`, step: stepIndex('budget') },
    ...(deliveryLabel ? [{ label: t('ads.x.review.delivery'), value: deliveryLabel, step: stepIndex('budget') }] : []),
    { label: t('ads.wizard.zone'), value: [zoneParts.length ? zoneParts.join(' · ') : t('ads.wizard.wholeCountry').replace('{country}', t(`ads.w.country.${draft.country}`)),
      expert && draft.locationTypes.length ? draft.locationTypes.map((x) => t(`ads.x.geo.type.${x}`)).join(' / ') : null,
      expert && draft.excludedCities.length ? `${t('ads.wizard.exclude')} : ${draft.excludedCities.map((c) => c.name).join(', ')}` : null].filter(Boolean).join(' · '), step: stepIndex('targeting') },
    { label: t('ads.wizard.age'), value: `${draft.audienceMode === 'full' ? `${Math.min(FULL_MODE_AGE_MIN_CAP, draft.ageMin)}+` : `${draft.ageMin}–${draft.ageMax}`} · ${genderLabel}`, step: stepIndex('targeting') },
    { label: t('ads.wizard.audiences'), value: [
      draft.audienceIds.length ? readyAudiences.filter((a) => draft.audienceIds.includes(a.id)).map((a) => a.name).join(', ') : t('ads.wizard.noAudienceSelected'),
      draft.excludeAudienceIds.length ? `${t('ads.wizard.exclude')} : ${readyAudiences.filter((a) => draft.excludeAudienceIds.includes(a.id)).map((a) => a.name).join(', ')}` : null,
      t(`ads.w.target.mode.${draft.audienceMode}`),
    ].filter(Boolean).join(' · '), step: stepIndex('targeting') },
    ...(detailedLabel || draft.locales.length ? [{ label: t('ads.w.target.advanced'), value: [detailedLabel, draft.locales.map((l) => l.name).join(', ')].filter(Boolean).join(' · '), step: stepIndex('targeting') }] : []),
    { label: t('ads.wizard.placements'), value: [
      [draft.instagram ? 'Instagram' : null, draft.facebook ? 'Facebook' : null].filter(Boolean).join(' + '),
      expert && (draft.igPositions.length || draft.fbPositions.length) ? [...draft.igPositions.map((p) => t(`ads.x.place.ig.${p}`)), ...draft.fbPositions.map((p) => t(`ads.x.place.fb.${p}`))].join(', ') : null,
      expert && draft.devices.length === 1 ? t(`ads.x.place.${draft.devices[0]}`) : null,
    ].filter(Boolean).join(' · '), step: stepIndex('targeting') },
    { label: t('ads.wizard.identity'), value: [pageName ? `Page · ${pageName}` : null, draft.instagram && igUsername ? `Instagram · @${igUsername}` : null].filter(Boolean).join('   ·   ') || '—', step: stepIndex('targeting') },
    ...(editing ? [] : [{ label: t('ads.w.creative.title'), value: (() => {
      const dests = [...new Set(draft.creatives.map((c) => c.destination ?? 'all'))];
      const split = !(dests.length === 1 && dests[0] === 'all');
      const counts = dests.map((d) => `${draft.creatives.filter((c) => (c.destination ?? 'all') === d).length} × ${t(`ads.w.dest.${d}`)}`).join(', ');
      return split ? t('ads.w.review.creativesSplit').replace('{n}', String(draft.creatives.length)).replace('{list}', counts) : t('ads.w.review.creativesValue').replace('{n}', String(draft.creatives.length));
    })(), step: stepIndex('creative') }]),
  ];

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.76)' }} role="dialog" aria-modal="true" aria-label={t('ads.wizard.title')}>
      <div className="w-full sm:max-w-[1120px] flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden" style={{ background: 'var(--sf-0c0c0e)', border: `1px solid ${BORDER}`, height: 'min(96dvh, 960px)' }}>
        {/* En-tête + étapes */}
        <div className="flex-shrink-0 px-4 sm:px-6 pt-4 pb-3 space-y-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(232,25,44,0.14)', border: '1px solid rgba(232,25,44,0.35)' }}>
                <Rocket className="w-5 h-5" style={{ color: RED }} />
              </div>
              <div className="min-w-0">
                <p style={{ color: T1, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>{editing ? t('ads.x.edit.title') : mode === 'duplicate' ? t('ads.x.dup.title') : t('ads.wizard.title')}</p>
                <p className="truncate" style={{ color: T3, fontSize: 12.5 }}>{event?.title ?? t('ads.w.subtitle')}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" role="switch" aria-checked={expert} onClick={toggleExpert}
                className="inline-flex items-center gap-2 pl-3 pr-1.5 rounded-xl cursor-pointer transition-colors duration-150"
                style={{ minHeight: 40, background: expert ? 'rgba(232,25,44,0.12)' : FIELD_BG, border: `1px solid ${expert ? 'rgba(232,25,44,0.45)' : BORDER}`, color: expert ? 'var(--acc-ff8a91)' : T2, fontSize: 13, fontWeight: 600 }}
                title={t('ads.x.expert.hint')}>
                <Sliders className="w-4 h-4" /> {t('ads.x.expert.toggle')}
                <span className="rounded-full transition-colors duration-200" style={{ display: 'inline-block', position: 'relative', width: 34, height: 20, flexShrink: 0, background: expert ? RED : 'rgb(var(--ink)/0.14)' }}>
                  <span className="rounded-full bg-white transition-transform duration-200" style={{ position: 'absolute', top: 2, left: 2, width: 16, height: 16, transform: `translateX(${expert ? 14 : 0}px)` }} />
                </span>
              </button>
              <button type="button" onClick={onClose} className="h-10 w-10 rounded-xl flex items-center justify-center cursor-pointer hover:bg-white/[0.06] transition-colors duration-150" style={{ color: T3 }} aria-label={t('ads.wizard.close')}><X className="w-5 h-5" /></button>
            </div>
          </div>
          <Stepper steps={steps} current={step} furthest={furthest} onGo={go} />
        </div>

        {/* Corps */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
          {current === 'event' && <StepEvent draft={draft} events={events} onPickEvent={pickEvent} set={set} locale={locale} expert={expert} locked={editing} t={t} />}
          {current === 'budget' && <StepBudget draft={draft} set={set} currency={currency} days={days} totalEstimate={totalEstimate} fmtMoney={fmtMoney} expert={expert} locked={editing} t={t} />}
          {current === 'targeting' && <StepTargeting draft={draft} set={set} audiences={audiences} homeCity={homeCity} call={call} language={language} estimate={estimate} expert={expert} t={t} />}
          {current === 'creative' && (
            <StepCreatives creatives={draft.creatives} selected={selectedCreative} onSelect={setSelectedCreative} onChange={(c) => set('creatives', c)}
              posterUrl={event?.poster_url ?? null} event={event} uploadsRef={uploadsRef} pageId={pageId} pageName={pageName} igUsername={igUsername} instagramOn={draft.instagram} facebookOn={draft.facebook}
              placementsLabel={placementsLabel} verticalOn={verticalOn} call={call} previewPayload={{ placements: placementsPayload, eventId: draft.eventId }} destinationsAvailable={destinationsAvailable} onEditPlacements={() => go(stepIndex('targeting'))} t={t} />
          )}
          {current === 'review' && (
            <>
              <StepReview rows={reviewRows} creatives={editing ? [] : draft.creatives} onEdit={go} pageId={pageId} pageName={pageName} igUsername={igUsername} instagramOn={draft.instagram} t={t} />
              {submitError && (
                <div className="mt-4 flex items-start gap-2.5 rounded-xl px-4 py-3" style={{ border: '1px solid rgba(232,25,44,0.4)', background: 'rgba(232,25,44,0.08)' }}>
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--acc-ff8a91)' }} />
                  <div><p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{t('ads.wizard.failed')}</p><p className="mt-0.5" style={{ color: T2, fontSize: 13, lineHeight: 1.5 }}>{submitError}</p></div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Pied */}
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 py-3.5" style={{ background: 'var(--sf-0c0c0e)', borderTop: `1px solid ${BORDER}` }}>
          <button type="button" onClick={() => go(Math.max(0, step - 1))} disabled={step === 0 || busy}
            className="inline-flex items-center gap-1.5 px-4 rounded-xl text-[14px] font-semibold cursor-pointer transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: FIELD_BG, border: `1px solid ${BORDER}`, color: T1, minHeight: 46 }}>
            <ChevronLeft className="w-4 h-4" /> {t('ads.wizard.back')}
          </button>
          <div className="flex items-center gap-3">
            {!stepValid[step] && current !== 'review' && <span className="hidden sm:block" style={{ color: T3, fontSize: 12.5 }}>{t(`ads.w.step.${current}.missing`)}</span>}
            {step < activeSteps.length - 1 ? (
              <button type="button" onClick={next} disabled={!stepValid[step] || busy}
                className="inline-flex items-center gap-1.5 px-5 rounded-xl text-[14px] font-semibold cursor-pointer transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: RED, color: '#fff', minHeight: 46 }}>
                {t('ads.wizard.next')} <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button type="button" onClick={submit} disabled={busy}
                className="inline-flex items-center gap-2 px-5 rounded-xl text-[14px] font-semibold cursor-pointer transition-colors duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ background: META_BLUE, color: '#fff', minHeight: 46 }}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />} {busy ? (editing ? t('ads.x.edit.saving') : t('ads.w.creating')) : (editing ? t('ads.x.edit.save') : t('ads.wizard.createPaused'))}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
