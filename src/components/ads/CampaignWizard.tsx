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
  DEFAULT_RADIUS_KM, FULL_MODE_AGE_MIN_CAP, MIN_BUDGET_CENTS, WIZARD_STEPS, creativeIssues, newCreative,
  type AdCreative, type AdsAudience, type AdsEvent,
} from '@/lib/metaAds';
import type { CampaignDraft, DraftCreative, WizardCall } from './wizard/types';
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

function posterCreative(e: AdsEvent | null): DraftCreative {
  const c = newCreative({ headline: e ? e.title.slice(0, 40) : '', cta: 'BUY_TICKETS' }) as DraftCreative;
  return { ...c, media: e?.poster_url ? [{ localId: `poster_${c.id}`, kind: 'image', url: e.poster_url }] : [] };
}

export function CampaignWizard({
  scope, events, audiences, homeCity, defaultEventId, currency, pageId, pageName, igUsername, onClose, onCreated,
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
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, language } = useLanguage();
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<{ lower: number; upper: number } | null | 'loading' | 'unknown'>(null);
  const uploadsRef = useRef<Map<string, DeferredUpload>>(new Map());
  const createdRef = useRef(false);

  const firstEvent = events.find((e) => e.id === defaultEventId) ?? events[0] ?? null;
  const [draft, setDraft] = useState<CampaignDraft>(() => {
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
    interests: draft.interests.map((i) => ({ id: i.id, name: i.name })), locales: draft.locales.map((l) => l.key), audience_mode: draft.audienceMode, advantage: draft.audienceMode !== 'strict',
  }), [draft.country, draft.cities, draft.ageMin, draft.ageMax, draft.genders, draft.audienceIds, draft.excludeAudienceIds, draft.interests, draft.locales, draft.audienceMode]);
  const placementsPayload = useMemo(() => ({ facebook: draft.facebook, instagram: draft.instagram }), [draft.facebook, draft.instagram]);

  // Estimation Meta de l'audience, recalculée 700 ms après le dernier réglage.
  useEffect(() => {
    if (step !== 2) return;
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
  const creativesOk = draft.creatives.every((c) => creativeIssues(c as unknown as AdCreative).length === 0 && !c.media.some((m) => m.uploading || m.error || !m.url));
  const stepValid = [
    !!draft.eventId && draft.name.trim().length >= 3,
    budgetCents >= MIN_BUDGET_CENTS && !Number.isNaN(startDate.getTime()) && (draft.budgetType === 'daily' || (!Number.isNaN(endDate.getTime()) && endDate > startDate)),
    !!draft.country && draft.ageMin >= 18 && draft.ageMax >= draft.ageMin && (draft.facebook || draft.instagram),
    creativesOk,
    true,
  ];
  const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000));
  const totalEstimate = draft.budgetType === 'daily' ? draft.budgetEuros * days : draft.budgetEuros;
  const fmtMoney = (eur: number) => new Intl.NumberFormat(language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR', { style: 'currency', currency: currency || 'EUR', maximumFractionDigits: 0 }).format(eur);

  const go = (i: number) => { setStep(i); setFurthest((f) => Math.max(f, i)); setSubmitError(null); };
  const next = () => go(Math.min(WIZARD_STEPS.length - 1, step + 1));

  // Toujours créée en pause : aucun argent ne part d'ici.
  const submit = async () => {
    setBusy(true);
    setSubmitError(null);
    try {
      // Un envoi encore en route : on l'attend plutôt que d'envoyer une URL vide.
      await Promise.all([...uploadsRef.current.values()].map((u) => u.result));
      const creatives = draft.creatives.map((c) => ({
        format: c.format,
        media: c.media.map((m) => ({ url: m.url, kind: m.kind, thumbnail_url: m.thumbnail_url ?? null, headline: m.headline ?? null, description: m.description ?? null })),
        headline: c.headline.trim(), body: c.body.trim(), description: c.description.trim() || null, cta: c.cta,
      }));
      if (creatives.some((c) => c.media.some((m) => !m.url))) throw new Error(t('ads.w.media.uploadFailed'));
      const res = await call('campaign_create', {
        eventId: draft.eventId, name: draft.name.trim(), objective: draft.objective,
        budgetType: draft.budgetType, budgetCents,
        startAt: startDate.toISOString(), endAt: draft.budgetType === 'lifetime' || draft.endAt ? endDate.toISOString() : null,
        targeting: targetingPayload,
        creatives,
        placements: placementsPayload,
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

  const steps = WIZARD_STEPS.map((k) => ({ key: k, label: t(`ads.wizard.step.${k}`), short: t(`ads.w.step.${k}.short`) }));
  const genderLabel = draft.genders.length === 0 ? t('ads.wizard.genderAll') : draft.genders[0] === 2 ? t('ads.wizard.genderWomen') : t('ads.wizard.genderMen');
  const reviewRows = [
    { label: t('ads.wizard.step.event'), value: `${event?.title ?? '—'} · ${draft.name}`, step: 0 },
    { label: t('ads.wizard.objective'), value: draft.objective === 'OUTCOME_SALES' ? t('ads.wizard.objectiveSales') : t('ads.wizard.objectiveTraffic'), step: 0 },
    { label: t('ads.wizard.step.budget'), value: `${fmtMoney(draft.budgetEuros)} ${draft.budgetType === 'daily' ? t('ads.wizard.perDay') : t('ads.wizard.inTotal')} · ${format(startDate, 'd MMM HH:mm', { locale })} → ${Number.isNaN(endDate.getTime()) ? '—' : format(endDate, 'd MMM HH:mm', { locale })}`, step: 1 },
    { label: t('ads.wizard.zone'), value: draft.cities.length ? draft.cities.map((c) => `${c.name}${c.type !== 'region' ? ` (${c.radius_km ?? DEFAULT_RADIUS_KM} km)` : ''}`).join(', ') : t('ads.wizard.wholeCountry').replace('{country}', t(`ads.w.country.${draft.country}`)), step: 2 },
    { label: t('ads.wizard.age'), value: `${draft.audienceMode === 'full' ? `${Math.min(FULL_MODE_AGE_MIN_CAP, draft.ageMin)}+` : `${draft.ageMin}–${draft.ageMax}`} · ${genderLabel}`, step: 2 },
    { label: t('ads.wizard.audiences'), value: [
      draft.audienceIds.length ? readyAudiences.filter((a) => draft.audienceIds.includes(a.id)).map((a) => a.name).join(', ') : t('ads.wizard.noAudienceSelected'),
      draft.excludeAudienceIds.length ? `${t('ads.wizard.exclude')} : ${readyAudiences.filter((a) => draft.excludeAudienceIds.includes(a.id)).map((a) => a.name).join(', ')}` : null,
      t(`ads.w.target.mode.${draft.audienceMode}`),
    ].filter(Boolean).join(' · '), step: 2 },
    ...(draft.interests.length || draft.locales.length ? [{ label: t('ads.w.target.advanced'), value: [draft.interests.map((i) => i.name).join(', '), draft.locales.map((l) => l.name).join(', ')].filter(Boolean).join(' · '), step: 2 }] : []),
    { label: t('ads.wizard.placements'), value: [draft.instagram ? 'Instagram' : null, draft.facebook ? 'Facebook' : null].filter(Boolean).join(' + '), step: 2 },
    { label: t('ads.wizard.identity'), value: [pageName ? `Page · ${pageName}` : null, draft.instagram && igUsername ? `Instagram · @${igUsername}` : null].filter(Boolean).join('   ·   ') || '—', step: 2 },
    { label: t('ads.w.creative.title'), value: t('ads.w.review.creativesValue').replace('{n}', String(draft.creatives.length)), step: 3 },
  ];

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.76)' }} role="dialog" aria-modal="true" aria-label={t('ads.wizard.title')}>
      <div className="w-full sm:max-w-[1120px] flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden" style={{ background: '#0c0c0e', border: `1px solid ${BORDER}`, height: 'min(96dvh, 960px)' }}>
        {/* En-tête + étapes */}
        <div className="flex-shrink-0 px-4 sm:px-6 pt-4 pb-3 space-y-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(232,25,44,0.14)', border: '1px solid rgba(232,25,44,0.35)' }}>
                <Rocket className="w-5 h-5" style={{ color: RED }} />
              </div>
              <div className="min-w-0">
                <p style={{ color: T1, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>{t('ads.wizard.title')}</p>
                <p className="truncate" style={{ color: T3, fontSize: 12.5 }}>{event?.title ?? t('ads.w.subtitle')}</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="h-10 w-10 rounded-xl flex items-center justify-center cursor-pointer hover:bg-white/[0.06] transition-colors duration-150" style={{ color: T3 }} aria-label={t('ads.wizard.close')}><X className="w-5 h-5" /></button>
          </div>
          <Stepper steps={steps} current={step} furthest={furthest} onGo={go} />
        </div>

        {/* Corps */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
          {step === 0 && <StepEvent draft={draft} events={events} onPickEvent={pickEvent} set={set} locale={locale} t={t} />}
          {step === 1 && <StepBudget draft={draft} set={set} currency={currency} days={days} totalEstimate={totalEstimate} fmtMoney={fmtMoney} t={t} />}
          {step === 2 && <StepTargeting draft={draft} set={set} audiences={audiences} homeCity={homeCity} call={call} language={language} estimate={estimate} t={t} />}
          {step === 3 && (
            <StepCreatives creatives={draft.creatives} selected={selectedCreative} onSelect={setSelectedCreative} onChange={(c) => set('creatives', c)}
              posterUrl={event?.poster_url ?? null} uploadsRef={uploadsRef} pageId={pageId} pageName={pageName} igUsername={igUsername} instagramOn={draft.instagram} t={t} />
          )}
          {step === 4 && (
            <>
              <StepReview rows={reviewRows} creatives={draft.creatives} onEdit={go} pageId={pageId} pageName={pageName} igUsername={igUsername} instagramOn={draft.instagram} t={t} />
              {submitError && (
                <div className="mt-4 flex items-start gap-2.5 rounded-xl px-4 py-3" style={{ border: '1px solid rgba(232,25,44,0.4)', background: 'rgba(232,25,44,0.08)' }}>
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#FF8A91' }} />
                  <div><p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{t('ads.wizard.failed')}</p><p className="mt-0.5" style={{ color: T2, fontSize: 13, lineHeight: 1.5 }}>{submitError}</p></div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Pied */}
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 py-3.5" style={{ background: '#0c0c0e', borderTop: `1px solid ${BORDER}` }}>
          <button type="button" onClick={() => go(Math.max(0, step - 1))} disabled={step === 0 || busy}
            className="inline-flex items-center gap-1.5 px-4 rounded-xl text-[14px] font-semibold cursor-pointer transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: FIELD_BG, border: `1px solid ${BORDER}`, color: T1, minHeight: 46 }}>
            <ChevronLeft className="w-4 h-4" /> {t('ads.wizard.back')}
          </button>
          <div className="flex items-center gap-3">
            {!stepValid[step] && step < 4 && <span className="hidden sm:block" style={{ color: T3, fontSize: 12.5 }}>{t(`ads.w.step.${WIZARD_STEPS[step]}.missing`)}</span>}
            {step < WIZARD_STEPS.length - 1 ? (
              <button type="button" onClick={next} disabled={!stepValid[step] || busy}
                className="inline-flex items-center gap-1.5 px-5 rounded-xl text-[14px] font-semibold cursor-pointer transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: RED, color: '#fff', minHeight: 46 }}>
                {t('ads.wizard.next')} <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button type="button" onClick={submit} disabled={busy}
                className="inline-flex items-center gap-2 px-5 rounded-xl text-[14px] font-semibold cursor-pointer transition-colors duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ background: META_BLUE, color: '#fff', minHeight: 46 }}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />} {busy ? t('ads.w.creating') : t('ads.wizard.createPaused')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
