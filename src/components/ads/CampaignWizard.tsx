// Assistant « Booster une soirée » — cinq écrans, une campagne Meta créée en
// pause (ou lancée) depuis Yuno. Design : docs/designs/META_ADS_INTEGRATION_PLAN.md.
//
// Le pro ne voit jamais un identifiant Meta : il choisit une soirée, un
// budget, une zone, un visuel et un texte. L'edge `meta-connect`
// (`campaign_create`) transforme ça en campagne + ensemble + créa + pub, et
// pose un lien suivi Yuno qui attribuera les ventes réelles à cette pub.

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { X, ChevronRight, ChevronLeft, Loader2, Rocket, Search, MapPin, Check, Image as ImageIcon, Sparkles } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import {
  CTA_OPTIONS, DEFAULT_RADIUS_KM, MIN_BUDGET_CENTS,
  type AdsAudience, type AdsEvent, type CampaignObjective, type CtaType, type GeoChoice,
} from '@/lib/metaAds';

const RED = '#E8192C';
const POS = '#34D399';
const WARN = '#FBBF24';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const META_BLUE = '#0866FF';

const inputStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, borderRadius: 12,
  padding: '10px 12px', fontSize: 13.5, width: '100%', outline: 'none',
};

export interface WizardScope { venueId?: string | null; organizerUserId?: string | null }

export interface CampaignDraft {
  eventId: string;
  name: string;
  objective: CampaignObjective;
  budgetType: 'daily' | 'lifetime';
  budgetEuros: number;
  startAt: string;   // datetime-local
  endAt: string;     // datetime-local
  cities: GeoChoice[];
  country: string;
  ageMin: number;
  ageMax: number;
  genders: number[];
  audienceIds: string[];
  excludeAudienceIds: string[];
  advantage: boolean;
  facebook: boolean;
  instagram: boolean;
  imageUrl: string;
  headline: string;
  body: string;
  cta: CtaType;
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5">
      <p style={{ color: T2, fontSize: 12, fontWeight: 600, letterSpacing: '0.02em' }}>{children}</p>
      {hint && <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{hint}</p>}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="px-3 py-1.5 rounded-full text-[12.5px] font-semibold"
      style={active ? { background: 'rgba(232,25,44,0.14)', border: '1px solid rgba(232,25,44,0.45)', color: '#FF7A82' } : { background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
      {children}
    </button>
  );
}

export function CampaignWizard({
  scope, events, audiences, homeCity, defaultEventId, currency, onClose, onCreated,
}: {
  scope: WizardScope;
  events: AdsEvent[];
  audiences: AdsAudience[];
  homeCity: string | null;
  defaultEventId?: string | null;
  currency: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, language } = useLanguage();
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<null | 'create' | 'launch' | 'geo'>(null);
  const [geoQuery, setGeoQuery] = useState('');
  const [geoResults, setGeoResults] = useState<GeoChoice[]>([]);
  const geoTimer = useRef<number | null>(null);

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
      advantage: true,
      facebook: true,
      instagram: true,
      imageUrl: firstEvent?.poster_url ?? '',
      headline: firstEvent?.title.slice(0, 40) ?? '',
      body: '',
      cta: 'BUY_TICKETS',
    };
  });
  const set = <K extends keyof CampaignDraft>(k: K, v: CampaignDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const event = useMemo(() => events.find((e) => e.id === draft.eventId) ?? null, [events, draft.eventId]);

  // Choisir une soirée pré-remplit le nom, le visuel, le titre et la fin.
  const pickEvent = (e: AdsEvent) => {
    setDraft((d) => ({
      ...d,
      eventId: e.id,
      name: e.title.slice(0, 100),
      imageUrl: d.imageUrl && d.eventId === e.id ? d.imageUrl : (e.poster_url ?? ''),
      headline: e.title.slice(0, 40),
      endAt: toLocalInput(new Date(Math.max(new Date(e.start_at).getTime(), new Date(d.startAt).getTime() + 3600 * 1000))),
    }));
  };

  const scopeBody = { venueId: scope.venueId ?? null, organizerUserId: scope.organizerUserId ?? null };
  const call = async (action: string, body: Record<string, unknown>) => {
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

  // Recherche de villes (debounce 350 ms) via Meta.
  useEffect(() => {
    if (geoTimer.current) window.clearTimeout(geoTimer.current);
    if (geoQuery.trim().length < 2) { setGeoResults([]); return; }
    geoTimer.current = window.setTimeout(async () => {
      setBusy('geo');
      try {
        const res = await call('ads_search_geo', { q: geoQuery.trim(), country: draft.country });
        setGeoResults(((res.results as GeoChoice[] | undefined) ?? []).slice(0, 8));
      } catch { setGeoResults([]); }
      finally { setBusy(null); }
    }, 350);
    return () => { if (geoTimer.current) window.clearTimeout(geoTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoQuery, draft.country]);

  const readyAudiences = audiences.filter((a) => a.status === 'ready' && a.meta_audience_id);
  const budgetCents = Math.round(draft.budgetEuros * 100);
  const startDate = new Date(draft.startAt);
  const endDate = new Date(draft.endAt);
  const stepValid = [
    !!draft.eventId && draft.name.trim().length >= 3,
    budgetCents >= MIN_BUDGET_CENTS && !Number.isNaN(startDate.getTime()) && (draft.budgetType === 'daily' || (!Number.isNaN(endDate.getTime()) && endDate > startDate)),
    (draft.cities.length > 0 || !!draft.country) && draft.ageMin >= 18 && draft.ageMax >= draft.ageMin && (draft.facebook || draft.instagram),
    /^https:\/\//.test(draft.imageUrl) && draft.headline.trim().length >= 3 && draft.body.trim().length >= 10,
    true,
  ];
  const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000));
  const totalEstimate = draft.budgetType === 'daily' ? draft.budgetEuros * days : draft.budgetEuros;
  const fmtMoney = (eur: number) => new Intl.NumberFormat(language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR', { style: 'currency', currency: currency || 'EUR', maximumFractionDigits: 0 }).format(eur);

  const submit = async (launch: boolean) => {
    setBusy(launch ? 'launch' : 'create');
    try {
      const res = await call('campaign_create', {
        eventId: draft.eventId, name: draft.name.trim(), objective: draft.objective,
        budgetType: draft.budgetType, budgetCents,
        startAt: startDate.toISOString(), endAt: draft.budgetType === 'lifetime' || draft.endAt ? endDate.toISOString() : null,
        targeting: {
          countries: [draft.country], cities: draft.cities, age_min: draft.ageMin, age_max: draft.ageMax,
          genders: draft.genders, audience_ids: draft.audienceIds, exclude_audience_ids: draft.excludeAudienceIds, advantage: draft.advantage,
        },
        creative: { image_url: draft.imageUrl, headline: draft.headline.trim(), body: draft.body.trim(), cta: draft.cta },
        placements: { facebook: draft.facebook, instagram: draft.instagram },
        launch,
      });
      if (res.ok) {
        toast.success(launch ? t('ads.wizard.launched') : t('ads.wizard.createdPaused'));
        onCreated();
        onClose();
      } else {
        toast.error(`${t('ads.wizard.failed')} ${String(res.error ?? '')}`.trim());
        onCreated();
      }
    } catch (e) {
      toast.error(`${t('ads.wizard.failed')} ${e instanceof Error ? e.message : ''}`.trim());
    } finally {
      setBusy(null);
    }
  };

  const steps = ['event', 'budget', 'targeting', 'creative', 'review'] as const;

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.72)' }} role="dialog" aria-modal="true">
      <div className="w-full sm:max-w-3xl max-h-[94vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl" style={{ background: '#0c0c0e', border: `1px solid ${BORDER}` }}>
        {/* En-tête */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4" style={{ background: '#0c0c0e', borderBottom: `1px solid ${BORDER}` }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(232,25,44,0.14)', border: '1px solid rgba(232,25,44,0.35)' }}>
              <Rocket className="w-4 h-4" style={{ color: RED }} />
            </div>
            <div className="min-w-0">
              <p style={{ color: T1, fontSize: 15, fontWeight: 700 }}>{t('ads.wizard.title')}</p>
              <p style={{ color: T3, fontSize: 12 }}>{t(`ads.wizard.step.${steps[step]}`)} · {step + 1}/{steps.length}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg" style={{ color: T3 }} aria-label={t('ads.wizard.close')}><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-5 space-y-5">
          {/* Étape 1 : soirée */}
          {step === 0 && (
            <>
              <p style={{ color: T2, fontSize: 13, lineHeight: 1.5 }}>{t('ads.wizard.eventIntro')}</p>
              {events.length === 0 ? (
                <div className="rounded-xl px-3 py-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                  <p style={{ color: T2, fontSize: 13 }}>{t('ads.wizard.noEvents')}</p>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {events.map((e) => {
                    const active = e.id === draft.eventId;
                    return (
                      <button key={e.id} type="button" onClick={() => pickEvent(e)}
                        className="flex items-center gap-3 rounded-xl p-2.5 text-left"
                        style={{ background: active ? 'rgba(232,25,44,0.10)' : INNER_BG, border: `1px solid ${active ? 'rgba(232,25,44,0.45)' : BORDER}` }}>
                        <div className="h-14 w-11 rounded-lg overflow-hidden flex-shrink-0" style={{ background: 'rgba(255,255,255,0.06)' }}>
                          {e.poster_url && <img src={e.poster_url} alt="" className="h-full w-full object-cover" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{e.title}</p>
                          <p style={{ color: T3, fontSize: 12 }}>{format(new Date(e.start_at), 'EEE d MMM, HH:mm', { locale })}{e.city ? ` · ${e.city}` : ''}</p>
                        </div>
                        {active && <Check className="w-4 h-4 flex-shrink-0" style={{ color: RED }} />}
                      </button>
                    );
                  })}
                </div>
              )}
              <div>
                <Label hint={t('ads.wizard.nameHint')}>{t('ads.wizard.name')}</Label>
                <input value={draft.name} onChange={(e) => set('name', e.target.value.slice(0, 100))} style={inputStyle} />
              </div>
              <div>
                <Label hint={t('ads.wizard.objectiveHint')}>{t('ads.wizard.objective')}</Label>
                <div className="flex gap-2 flex-wrap">
                  <Chip active={draft.objective === 'OUTCOME_SALES'} onClick={() => set('objective', 'OUTCOME_SALES')}>{t('ads.wizard.objectiveSales')}</Chip>
                  <Chip active={draft.objective === 'OUTCOME_TRAFFIC'} onClick={() => set('objective', 'OUTCOME_TRAFFIC')}>{t('ads.wizard.objectiveTraffic')}</Chip>
                </div>
              </div>
            </>
          )}

          {/* Étape 2 : budget et dates */}
          {step === 1 && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>{t('ads.wizard.budgetType')}</Label>
                  <div className="flex gap-2">
                    <Chip active={draft.budgetType === 'lifetime'} onClick={() => set('budgetType', 'lifetime')}>{t('ads.wizard.budgetLifetime')}</Chip>
                    <Chip active={draft.budgetType === 'daily'} onClick={() => set('budgetType', 'daily')}>{t('ads.wizard.budgetDaily')}</Chip>
                  </div>
                </div>
                <div>
                  <Label hint={t('ads.wizard.budgetHint').replace('{min}', fmtMoney(MIN_BUDGET_CENTS / 100))}>{draft.budgetType === 'daily' ? t('ads.wizard.budgetPerDay') : t('ads.wizard.budgetTotal')}</Label>
                  <div className="relative">
                    <input type="number" min={MIN_BUDGET_CENTS / 100} step={5} value={draft.budgetEuros} onChange={(e) => set('budgetEuros', Math.max(0, Number(e.target.value)))} style={{ ...inputStyle, paddingRight: 36 }} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: T3, fontSize: 13 }}>{currency === 'EUR' ? '€' : currency}</span>
                  </div>
                </div>
                <div>
                  <Label>{t('ads.wizard.startAt')}</Label>
                  <input type="datetime-local" value={draft.startAt} onChange={(e) => set('startAt', e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <Label hint={draft.budgetType === 'daily' ? t('ads.wizard.endOptional') : undefined}>{t('ads.wizard.endAt')}</Label>
                  <input type="datetime-local" value={draft.endAt} onChange={(e) => set('endAt', e.target.value)} style={inputStyle} />
                </div>
              </div>
              <div className="rounded-xl px-3 py-2.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <p style={{ color: T2, fontSize: 12.5 }}>
                  {t('ads.wizard.estimate').replace('{total}', fmtMoney(totalEstimate)).replace('{days}', String(days))}
                </p>
                <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{t('ads.wizard.billingNote')}</p>
              </div>
            </>
          )}

          {/* Étape 3 : ciblage */}
          {step === 2 && (
            <>
              <div>
                <Label hint={t('ads.wizard.zoneHint')}>{t('ads.wizard.zone')}</Label>
                <div className="flex gap-2 mb-2">
                  {(['FR', 'ES', 'BE', 'CH'] as const).map((c) => <Chip key={c} active={draft.country === c} onClick={() => set('country', c)}>{c}</Chip>)}
                </div>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: T3 }} />
                  <input value={geoQuery} onChange={(e) => setGeoQuery(e.target.value)} placeholder={homeCity ?? 'Paris'} style={{ ...inputStyle, paddingLeft: 34 }} />
                  {busy === 'geo' && <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin" style={{ color: T3 }} />}
                </div>
                {geoResults.length > 0 && (
                  <div className="mt-1 rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}`, background: '#101012' }}>
                    {geoResults.map((g) => (
                      <button key={g.key} type="button" className="w-full flex items-center gap-2 px-3 py-2 text-left"
                        onClick={() => { if (!draft.cities.some((c) => c.key === g.key)) set('cities', [...draft.cities, { ...g, radius_km: DEFAULT_RADIUS_KM }]); setGeoQuery(''); setGeoResults([]); }}>
                        <MapPin className="w-3.5 h-3.5" style={{ color: T3 }} />
                        <span style={{ color: T1, fontSize: 13 }}>{g.name}</span>
                        <span style={{ color: T3, fontSize: 12 }}>{g.region ? `${g.region} · ` : ''}{g.country_code}{g.type === 'region' ? ` · ${t('ads.wizard.region')}` : ''}</span>
                      </button>
                    ))}
                  </div>
                )}
                {draft.cities.length > 0 ? (
                  <div className="mt-2 space-y-1.5">
                    {draft.cities.map((c) => (
                      <div key={c.key} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                        <MapPin className="w-3.5 h-3.5 flex-shrink-0" style={{ color: RED }} />
                        <span className="flex-1 truncate" style={{ color: T1, fontSize: 13 }}>{c.name}</span>
                        {c.type !== 'region' && (
                          <label className="flex items-center gap-2" style={{ color: T3, fontSize: 12 }}>
                            <input type="range" min={10} max={80} step={5} value={c.radius_km ?? DEFAULT_RADIUS_KM}
                              onChange={(e) => set('cities', draft.cities.map((x) => x.key === c.key ? { ...x, radius_km: Number(e.target.value) } : x))} />
                            {c.radius_km ?? DEFAULT_RADIUS_KM} km
                          </label>
                        )}
                        <button type="button" onClick={() => set('cities', draft.cities.filter((x) => x.key !== c.key))} style={{ color: T3 }} aria-label={t('ads.wizard.remove')}><X className="w-4 h-4" /></button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2" style={{ color: T3, fontSize: 12 }}>{t('ads.wizard.wholeCountry').replace('{country}', draft.country)}</p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>{t('ads.wizard.age')}</Label>
                  <div className="flex items-center gap-2">
                    <input type="number" min={18} max={65} value={draft.ageMin} onChange={(e) => set('ageMin', Math.max(18, Number(e.target.value)))} style={inputStyle} />
                    <span style={{ color: T3 }}>–</span>
                    <input type="number" min={18} max={65} value={draft.ageMax} onChange={(e) => set('ageMax', Math.min(65, Number(e.target.value)))} style={inputStyle} />
                  </div>
                </div>
                <div>
                  <Label>{t('ads.wizard.gender')}</Label>
                  <div className="flex gap-2">
                    <Chip active={draft.genders.length === 0} onClick={() => set('genders', [])}>{t('ads.wizard.genderAll')}</Chip>
                    <Chip active={draft.genders[0] === 2} onClick={() => set('genders', [2])}>{t('ads.wizard.genderWomen')}</Chip>
                    <Chip active={draft.genders[0] === 1} onClick={() => set('genders', [1])}>{t('ads.wizard.genderMen')}</Chip>
                  </div>
                </div>
              </div>

              <div>
                <Label hint={readyAudiences.length === 0 ? t('ads.wizard.noAudiencesHint') : t('ads.wizard.audiencesHint')}>{t('ads.wizard.audiences')}</Label>
                {readyAudiences.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {readyAudiences.map((a) => {
                      const on = draft.audienceIds.includes(a.id);
                      return <Chip key={a.id} active={on} onClick={() => set('audienceIds', on ? draft.audienceIds.filter((x) => x !== a.id) : [...draft.audienceIds, a.id])}>{a.name}{a.size_uploaded ? ` · ${a.size_uploaded}` : ''}</Chip>;
                    })}
                  </div>
                )}
                {readyAudiences.length > 0 && (
                  <div className="mt-3">
                    <Label hint={t('ads.wizard.excludeHint')}>{t('ads.wizard.exclude')}</Label>
                    <div className="flex gap-2 flex-wrap">
                      {readyAudiences.map((a) => {
                        const on = draft.excludeAudienceIds.includes(a.id);
                        return <Chip key={a.id} active={on} onClick={() => set('excludeAudienceIds', on ? draft.excludeAudienceIds.filter((x) => x !== a.id) : [...draft.excludeAudienceIds, a.id])}>{a.name}</Chip>;
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                  <span style={{ color: T1, fontSize: 12.5 }}><Sparkles className="w-3.5 h-3.5 inline mr-1" style={{ color: WARN }} />{t('ads.wizard.advantage')}</span>
                  <Switch checked={draft.advantage} onCheckedChange={(v) => set('advantage', v)} />
                </div>
                <div className="flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                  <span style={{ color: T1, fontSize: 12.5 }}>Instagram</span>
                  <Switch checked={draft.instagram} onCheckedChange={(v) => set('instagram', v)} />
                </div>
                <div className="flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                  <span style={{ color: T1, fontSize: 12.5 }}>Facebook</span>
                  <Switch checked={draft.facebook} onCheckedChange={(v) => set('facebook', v)} />
                </div>
              </div>
            </>
          )}

          {/* Étape 4 : visuel et texte */}
          {step === 3 && (
            <div className="grid gap-5 sm:grid-cols-[1fr_260px]">
              <div className="space-y-4">
                <div>
                  <Label hint={t('ads.wizard.imageHint')}>{t('ads.wizard.image')}</Label>
                  <div className="flex gap-2">
                    <input value={draft.imageUrl} onChange={(e) => set('imageUrl', e.target.value.trim())} placeholder="https://…" style={inputStyle} />
                    {event?.poster_url && draft.imageUrl !== event.poster_url && (
                      <button type="button" onClick={() => set('imageUrl', event.poster_url!)} className="px-3 rounded-xl text-[12px] font-semibold flex-shrink-0" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                        <ImageIcon className="w-3.5 h-3.5 inline mr-1" />{t('ads.wizard.usePoster')}
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <Label hint={t('ads.wizard.headlineHint')}>{t('ads.wizard.headline')}</Label>
                  <input value={draft.headline} onChange={(e) => set('headline', e.target.value.slice(0, 40))} style={inputStyle} />
                  <p style={{ color: T3, fontSize: 11, marginTop: 4 }}>{draft.headline.length}/40</p>
                </div>
                <div>
                  <Label hint={t('ads.wizard.bodyHint')}>{t('ads.wizard.body')}</Label>
                  <textarea value={draft.body} onChange={(e) => set('body', e.target.value.slice(0, 400))} rows={4} style={{ ...inputStyle, resize: 'vertical' }} />
                  <p style={{ color: T3, fontSize: 11, marginTop: 4 }}>{draft.body.length}/400</p>
                </div>
                <div>
                  <Label>{t('ads.wizard.cta')}</Label>
                  <div className="flex gap-2 flex-wrap">
                    {CTA_OPTIONS.map((c) => <Chip key={c} active={draft.cta === c} onClick={() => set('cta', c)}>{t(`ads.cta.${c}`)}</Chip>)}
                  </div>
                </div>
              </div>
              {/* Aperçu façon feed */}
              <div className="rounded-2xl overflow-hidden self-start" style={{ background: '#111113', border: `1px solid ${BORDER}` }}>
                <div className="px-3 py-2 flex items-center gap-2">
                  <div className="h-7 w-7 rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }} />
                  <div><p style={{ color: T1, fontSize: 12, fontWeight: 600 }}>{t('ads.wizard.previewPage')}</p><p style={{ color: T3, fontSize: 10.5 }}>{t('ads.wizard.previewSponsored')}</p></div>
                </div>
                <div className="aspect-square" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  {/^https:\/\//.test(draft.imageUrl) && <img src={draft.imageUrl} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="px-3 py-2.5">
                  <p style={{ color: T1, fontSize: 12.5, lineHeight: 1.4 }}>{draft.body || t('ads.wizard.previewBody')}</p>
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-lg px-2.5 py-2" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="min-w-0"><p style={{ color: T3, fontSize: 10 }}>yunoapp.eu</p><p className="truncate" style={{ color: T1, fontSize: 12, fontWeight: 700 }}>{draft.headline || t('ads.wizard.previewHeadline')}</p></div>
                    <span className="px-2 py-1 rounded-md flex-shrink-0" style={{ background: 'rgba(255,255,255,0.12)', color: T1, fontSize: 11, fontWeight: 700 }}>{t(`ads.cta.${draft.cta}`)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Étape 5 : récapitulatif */}
          {step === 4 && (
            <div className="space-y-3">
              {[
                [t('ads.wizard.step.event'), `${event?.title ?? '—'} · ${draft.name}`],
                [t('ads.wizard.objective'), draft.objective === 'OUTCOME_SALES' ? t('ads.wizard.objectiveSales') : t('ads.wizard.objectiveTraffic')],
                [t('ads.wizard.step.budget'), `${fmtMoney(draft.budgetEuros)} ${draft.budgetType === 'daily' ? t('ads.wizard.perDay') : t('ads.wizard.inTotal')} · ${format(startDate, 'd MMM HH:mm', { locale })} → ${Number.isNaN(endDate.getTime()) ? '—' : format(endDate, 'd MMM HH:mm', { locale })}`],
                [t('ads.wizard.zone'), draft.cities.length ? draft.cities.map((c) => `${c.name}${c.type !== 'region' ? ` (${c.radius_km ?? DEFAULT_RADIUS_KM} km)` : ''}`).join(', ') : t('ads.wizard.wholeCountry').replace('{country}', draft.country)],
                [t('ads.wizard.age'), `${draft.ageMin}–${draft.ageMax} · ${draft.genders.length === 0 ? t('ads.wizard.genderAll') : draft.genders[0] === 2 ? t('ads.wizard.genderWomen') : t('ads.wizard.genderMen')}`],
                [t('ads.wizard.audiences'), draft.audienceIds.length ? readyAudiences.filter((a) => draft.audienceIds.includes(a.id)).map((a) => a.name).join(', ') : t('ads.wizard.noAudienceSelected')],
                [t('ads.wizard.placements'), [draft.instagram ? 'Instagram' : null, draft.facebook ? 'Facebook' : null].filter(Boolean).join(' + ')],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-3 rounded-xl px-3 py-2.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                  <span className="w-32 flex-shrink-0" style={{ color: T3, fontSize: 12 }}>{k}</span>
                  <span style={{ color: T1, fontSize: 12.5 }}>{v}</span>
                </div>
              ))}
              <div className="rounded-xl px-3 py-2.5" style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.18)' }}>
                <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.5 }}>{t('ads.wizard.reviewNote')}</p>
              </div>
            </div>
          )}
        </div>

        {/* Pied */}
        <div className="sticky bottom-0 flex items-center justify-between gap-3 px-5 py-4" style={{ background: '#0c0c0e', borderTop: `1px solid ${BORDER}` }}>
          <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy !== null}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-semibold disabled:opacity-40"
            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }}>
            <ChevronLeft className="w-4 h-4" /> {t('ads.wizard.back')}
          </button>
          {step < steps.length - 1 ? (
            <button type="button" onClick={() => setStep((s) => s + 1)} disabled={!stepValid[step] || busy !== null}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold disabled:opacity-40"
              style={{ background: RED, color: '#fff' }}>
              {t('ads.wizard.next')} <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => submit(false)} disabled={busy !== null}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-semibold disabled:opacity-60"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }}>
                {busy === 'create' ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {t('ads.wizard.createPaused')}
              </button>
              <button type="button" onClick={() => submit(true)} disabled={busy !== null}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold disabled:opacity-60"
                style={{ background: META_BLUE, color: '#fff' }}>
                {busy === 'launch' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />} {t('ads.wizard.launch')}
              </button>
            </div>
          )}
        </div>
        <span className="sr-only" style={{ color: POS }} />
      </div>
    </div>
  );
}
