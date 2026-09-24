// Étape 3 — à qui la pub s'adresse. Zone, âge, genre, audiences Yuno, mode de
// diffusion (strict ou élargi par Meta), puis les affinages facultatifs
// (centres d'intérêt, langues, réseaux) et l'estimation de Meta.

import { useEffect, useRef, useState } from 'react';
import { Search, MapPin, X, Loader2, Users, Sparkles, Target, Wand2, Globe2, Languages, Heart } from 'lucide-react';
import { DEFAULT_RADIUS_KM, FULL_MODE_AGE_MIN_CAP, type AdsAudience, type AudienceMode, type GeoChoice, type InterestChoice, type LocaleChoice } from '@/lib/metaAds';
import type { CampaignDraft, WizardCall } from './types';
import { ExpertGeo, ExpertDetailed, ExpertPlacements } from './ExpertTargeting';
import { StepHeader, Section, Field, Chip, ChoiceCards, ToggleRow, Tip, GhostButton, inputStyle, focusRing, T1, T2, T3, BORDER, INNER_BG, RED, WARN } from './ui';

function useDebouncedSearch<T>(query: string, deps: unknown[], fetcher: (q: string) => Promise<T[]>) {
  const [results, setResults] = useState<T[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (query.trim().length < 2) { setResults([]); setError(null); setEmpty(false); return; }
    timer.current = window.setTimeout(async () => {
      setBusy(true); setError(null);
      try { const r = await fetcher(query.trim()); setResults(r); setEmpty(r.length === 0); }
      catch (e) { setResults([]); setEmpty(false); setError(e instanceof Error ? e.message : 'error'); }
      finally { setBusy(false); }
    }, 350);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, ...deps]);
  return { results, busy, error, empty, clear: () => { setResults([]); setEmpty(false); } };
}

/** Sous un champ de recherche : « Meta refuse » ou « aucun résultat », jamais un silence. */
function SearchStatus({ error, empty, t }: { error: string | null; empty: boolean; t: (k: string) => string }) {
  if (error) return <p className="mt-1.5" style={{ color: 'var(--acc-ff8a91)', fontSize: 12.5, lineHeight: 1.45 }}>{t('ads.w.search.metaError')} {error}</p>;
  if (empty) return <p className="mt-1.5" style={{ color: T3, fontSize: 12.5 }}>{t('ads.w.search.noResult')}</p>;
  return null;
}

function SearchBox({ value, onChange, placeholder, busy, children }: { value: string; onChange: (v: string) => void; placeholder: string; busy: boolean; children?: React.ReactNode }) {
  return (
    <div>
      <div className="relative">
        <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2" style={{ color: T3 }} />
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ ...inputStyle, paddingLeft: 42 }} className={focusRing} />
        {busy && <Loader2 className="w-4 h-4 absolute right-4 top-1/2 -translate-y-1/2 animate-spin" style={{ color: T3 }} />}
      </div>
      {children}
    </div>
  );
}

function Dropdown({ children }: { children: React.ReactNode }) {
  return <div className="mt-1.5 rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}`, background: 'var(--sf-121214)' }}>{children}</div>;
}

export function StepTargeting({ draft, set, audiences, homeCity, call, language, estimate, expert, t }: {
  draft: CampaignDraft;
  set: <K extends keyof CampaignDraft>(k: K, v: CampaignDraft[K]) => void;
  audiences: AdsAudience[];
  homeCity: string | null;
  call: WizardCall;
  language: string;
  estimate: { lower: number; upper: number } | null | 'loading' | 'unknown';
  expert: boolean;
  t: (k: string) => string;
}) {
  const [geoQuery, setGeoQuery] = useState('');
  const [interestQuery, setInterestQuery] = useState('');
  const [localeQuery, setLocaleQuery] = useState('');
  const [advanced, setAdvanced] = useState(expert || draft.interests.length > 0 || draft.detailed.length > 0 || draft.locales.length > 0 || !draft.facebook || !draft.instagram);
  const fullMode = draft.audienceMode === 'full';
  const geo = useDebouncedSearch<GeoChoice>(geoQuery, [draft.country], async (q) => (((await call('ads_search_geo', { q, country: draft.country })).results as GeoChoice[] | undefined) ?? []).slice(0, 8));
  const interests = useDebouncedSearch<InterestChoice>(interestQuery, [language], async (q) => (((await call('ads_search', { type: 'interest', q, locale: language })).results as InterestChoice[] | undefined) ?? []).slice(0, 10));
  const locales = useDebouncedSearch<LocaleChoice>(localeQuery, [], async (q) => (((await call('ads_search', { type: 'locale', q })).results as LocaleChoice[] | undefined) ?? []).slice(0, 10));
  const readyAudiences = audiences.filter((a) => a.status === 'ready' && a.meta_audience_id);
  const fmtN = (n: number) => new Intl.NumberFormat(language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR', { maximumFractionDigits: 0 }).format(n);

  return (
    <div className="space-y-5">
      <StepHeader title={t('ads.w.target.title')} intro={t('ads.w.target.intro')} />

      <Section title={t('ads.wizard.zone')} desc={t('ads.wizard.zoneHint')}>
        <div className="flex gap-2 flex-wrap">
          {(['FR', 'ES', 'BE', 'CH'] as const).map((c) => <Chip key={c} active={draft.country === c} onClick={() => set('country', c)}>{t(`ads.w.country.${c}`)}</Chip>)}
        </div>
        <SearchBox value={geoQuery} onChange={setGeoQuery} placeholder={t('ads.w.target.cityPh').replace('{city}', homeCity ?? 'Paris')} busy={geo.busy}>
          {geo.results.length > 0 && (
            <Dropdown>
              {geo.results.map((g) => (
                <button key={g.key} type="button" className="w-full flex items-center gap-2.5 px-4 py-3 text-left cursor-pointer hover:bg-white/[0.05] transition-colors duration-150"
                  onClick={() => { if (!draft.cities.some((c) => c.key === g.key)) set('cities', [...draft.cities, { ...g, radius_km: DEFAULT_RADIUS_KM }]); setGeoQuery(''); geo.clear(); }}>
                  <MapPin className="w-4 h-4" style={{ color: T3 }} />
                  <span style={{ color: T1, fontSize: 14 }}>{g.name}</span>
                  <span style={{ color: T3, fontSize: 12.5 }}>{g.region ? `${g.region} · ` : ''}{g.country_code}{g.type === 'region' ? ` · ${t('ads.wizard.region')}` : ''}</span>
                </button>
              ))}
            </Dropdown>
          )}
          <SearchStatus error={geo.error} empty={geo.empty} t={t} />
        </SearchBox>
        {draft.cities.length > 0 ? (
          <div className="space-y-2">
            {draft.cities.map((c) => (
              <div key={c.key} className="flex items-center gap-3 rounded-xl px-4 py-3 flex-wrap" style={{ background: 'rgb(var(--ink)/0.03)', border: `1px solid ${BORDER}` }}>
                <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: RED }} />
                <span className="flex-1 truncate" style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{c.name}</span>
                {c.type !== 'region' && (
                  <label className="flex items-center gap-3" style={{ color: T2, fontSize: 13 }}>
                    <span style={{ color: T3, fontSize: 12 }}>{t('ads.w.target.radius')}</span>
                    <input type="range" min={10} max={80} step={5} value={c.radius_km ?? DEFAULT_RADIUS_KM} className="w-28 sm:w-36 cursor-pointer" style={{ accentColor: RED }}
                      onChange={(e) => set('cities', draft.cities.map((x) => x.key === c.key ? { ...x, radius_km: Number(e.target.value) } : x))} />
                    <span className="tabular-nums w-12 text-right" style={{ color: T1, fontWeight: 600 }}>{c.radius_km ?? DEFAULT_RADIUS_KM} km</span>
                  </label>
                )}
                <button type="button" onClick={() => set('cities', draft.cities.filter((x) => x.key !== c.key))} className="h-9 w-9 rounded-lg flex items-center justify-center cursor-pointer hover:bg-white/[0.06]" style={{ color: T3 }} aria-label={t('ads.wizard.remove')}><X className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        ) : (
          <Tip tone="warn">{t('ads.w.target.noCity').replace('{country}', t(`ads.w.country.${draft.country}`))}</Tip>
        )}
        {expert && <ExpertGeo draft={draft} set={set} call={call} t={t} />}
      </Section>

      <Section title={t('ads.w.target.profile')} desc={t('ads.w.target.profileDesc')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('ads.wizard.age')} hint={fullMode ? t('ads.w.target.ageHintFull').replace('{cap}', String(FULL_MODE_AGE_MIN_CAP)) : t('ads.w.target.ageHint')}>
            <div className="flex items-center gap-3">
              <input type="number" inputMode="numeric" min={18} max={fullMode ? FULL_MODE_AGE_MIN_CAP : 65} value={fullMode ? Math.min(FULL_MODE_AGE_MIN_CAP, draft.ageMin) : draft.ageMin} onChange={(e) => set('ageMin', Math.min(fullMode ? FULL_MODE_AGE_MIN_CAP : 65, Math.max(18, Number(e.target.value))))} style={inputStyle} className={`${focusRing} tabular-nums`} aria-label="min" />
              <span style={{ color: T3, fontSize: 16 }}>→</span>
              <input type="number" inputMode="numeric" min={18} max={65} value={fullMode ? 65 : draft.ageMax} disabled={fullMode} onChange={(e) => set('ageMax', Math.min(65, Math.max(18, Number(e.target.value))))} style={{ ...inputStyle, opacity: fullMode ? 0.45 : 1 }} className={`${focusRing} tabular-nums`} aria-label="max" />
            </div>
          </Field>
          <Field label={t('ads.wizard.gender')}>
            <div className="flex gap-2 flex-wrap">
              <Chip active={draft.genders.length === 0} onClick={() => set('genders', [])}>{t('ads.wizard.genderAll')}</Chip>
              <Chip active={draft.genders[0] === 2} onClick={() => set('genders', [2])}>{t('ads.wizard.genderWomen')}</Chip>
              <Chip active={draft.genders[0] === 1} onClick={() => set('genders', [1])}>{t('ads.wizard.genderMen')}</Chip>
            </div>
          </Field>
        </div>
      </Section>

      <Section title={t('ads.wizard.audiences')} desc={readyAudiences.length === 0 ? t('ads.wizard.noAudiencesHint') : t('ads.w.target.audiencesDesc')}>
        {readyAudiences.length > 0 && (
          <>
            <Field label={t('ads.w.target.include')}>
              <div className="flex gap-2 flex-wrap">
                {readyAudiences.map((a) => {
                  const on = draft.audienceIds.includes(a.id);
                  return <Chip key={a.id} active={on} onClick={() => set('audienceIds', on ? draft.audienceIds.filter((x) => x !== a.id) : [...draft.audienceIds, a.id])}>{a.kind === 'lookalike' ? <Sparkles className="w-3.5 h-3.5" style={{ color: WARN }} /> : <Users className="w-3.5 h-3.5" />}{a.name}{a.size_uploaded ? ` · ${fmtN(a.size_uploaded)}` : ''}</Chip>;
                })}
              </div>
            </Field>
            <Field label={t('ads.wizard.exclude')} hint={t('ads.wizard.excludeHint')}>
              <div className="flex gap-2 flex-wrap">
                {readyAudiences.map((a) => {
                  const on = draft.excludeAudienceIds.includes(a.id);
                  return <Chip key={a.id} active={on} onClick={() => set('excludeAudienceIds', on ? draft.excludeAudienceIds.filter((x) => x !== a.id) : [...draft.excludeAudienceIds, a.id])}>{a.name}</Chip>;
                })}
              </div>
            </Field>
          </>
        )}
        <Field label={t('ads.w.target.mode')} hint={t('ads.w.target.modeHint')}>
          <ChoiceCards<AudienceMode> value={draft.audienceMode} onChange={(v) => set('audienceMode', v)} columns={3} options={[
            { value: 'relaxed', label: t('ads.w.target.mode.relaxed'), desc: t('ads.w.target.mode.relaxedDesc'), icon: <Sparkles className="w-5 h-5" />, badge: t('ads.w.recommended') },
            { value: 'full', label: t('ads.w.target.mode.full'), desc: t('ads.w.target.mode.fullDesc').replace('{cap}', String(FULL_MODE_AGE_MIN_CAP)), icon: <Wand2 className="w-5 h-5" /> },
            { value: 'strict', label: t('ads.w.target.mode.strict'), desc: t('ads.w.target.mode.strictDesc'), icon: <Target className="w-5 h-5" /> },
          ]} />
        </Field>
        {draft.audienceMode === 'full' && <Tip tone="warn">{t('ads.w.target.fullAgeNote').replace('{cap}', String(FULL_MODE_AGE_MIN_CAP))}</Tip>}
      </Section>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p style={{ color: T2, fontSize: 13.5 }}>{t('ads.w.target.advancedIntro')}</p>
        <GhostButton small onClick={() => setAdvanced((v) => !v)}>{advanced ? t('ads.w.target.hideAdvanced') : t('ads.w.target.showAdvanced')}</GhostButton>
      </div>
      {advanced && (
        <Section title={t('ads.w.target.advanced')} desc={t('ads.w.target.advancedDesc')}>
          {expert ? <ExpertDetailed draft={draft} set={set} call={call} t={t} /> : (
          <Field label={<span className="inline-flex items-center gap-2"><Heart className="w-4 h-4" style={{ color: T3 }} />{t('ads.w.target.interests')}</span>} optional={t('ads.w.optional')} hint={t('ads.w.target.interestsHint')}>
            <SearchBox value={interestQuery} onChange={setInterestQuery} placeholder={t('ads.w.target.interestsPh')} busy={interests.busy}>
              {interests.results.length > 0 && (
                <Dropdown>
                  {interests.results.map((i) => (
                    <button key={i.id} type="button" className="w-full flex items-center gap-2.5 px-4 py-3 text-left cursor-pointer hover:bg-white/[0.05] transition-colors duration-150"
                      onClick={() => { if (!draft.interests.some((x) => x.id === i.id)) set('interests', [...draft.interests, i]); setInterestQuery(''); interests.clear(); }}>
                      <span className="flex-1 min-w-0"><span className="block truncate" style={{ color: T1, fontSize: 14 }}>{i.name}</span>{i.path && <span className="block truncate" style={{ color: T3, fontSize: 12 }}>{i.path}</span>}</span>
                      {i.size != null && <span className="tabular-nums" style={{ color: T3, fontSize: 12 }}>{fmtN(i.size)}</span>}
                    </button>
                  ))}
                </Dropdown>
              )}
              <SearchStatus error={interests.error} empty={interests.empty} t={t} />
            </SearchBox>
            {draft.interests.length > 0 && (
              <div className="mt-2.5 flex gap-2 flex-wrap">
                {draft.interests.map((i) => <Chip key={i.id} active onClick={() => set('interests', draft.interests.filter((x) => x.id !== i.id))}>{i.name} <X className="w-3.5 h-3.5" /></Chip>)}
              </div>
            )}
          </Field>
          )}
          <Field label={<span className="inline-flex items-center gap-2"><Languages className="w-4 h-4" style={{ color: T3 }} />{t('ads.w.target.languages')}</span>} optional={t('ads.w.optional')} hint={t('ads.w.target.languagesHint')}>
            <SearchBox value={localeQuery} onChange={setLocaleQuery} placeholder={t('ads.w.target.languagesPh')} busy={locales.busy}>
              {locales.results.length > 0 && (
                <Dropdown>
                  {locales.results.map((l) => (
                    <button key={l.key} type="button" className="w-full px-4 py-3 text-left cursor-pointer hover:bg-white/[0.05] transition-colors duration-150" style={{ color: T1, fontSize: 14 }}
                      onClick={() => { if (!draft.locales.some((x) => x.key === l.key)) set('locales', [...draft.locales, l]); setLocaleQuery(''); locales.clear(); }}>{l.name}</button>
                  ))}
                </Dropdown>
              )}
              <SearchStatus error={locales.error} empty={locales.empty} t={t} />
            </SearchBox>
            {draft.locales.length > 0 && (
              <div className="mt-2.5 flex gap-2 flex-wrap">
                {draft.locales.map((l) => <Chip key={l.key} active onClick={() => set('locales', draft.locales.filter((x) => x.key !== l.key))}>{l.name} <X className="w-3.5 h-3.5" /></Chip>)}
              </div>
            )}
          </Field>
          <Field label={<span className="inline-flex items-center gap-2"><Globe2 className="w-4 h-4" style={{ color: T3 }} />{t('ads.wizard.placements')}</span>} hint={t('ads.w.target.placementsHint')}>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <ToggleRow label="Instagram" desc={t('ads.w.target.instagramDesc')} checked={draft.instagram} onChange={(v) => set('instagram', v)} />
              <ToggleRow label="Facebook" desc={t('ads.w.target.facebookDesc')} checked={draft.facebook} onChange={(v) => set('facebook', v)} />
            </div>
          </Field>
          {expert && <ExpertPlacements draft={draft} set={set} t={t} />}
        </Section>
      )}

      <div className="rounded-2xl px-4 py-3.5 flex items-center gap-3 flex-wrap" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
        <Users className="w-5 h-5 flex-shrink-0" style={{ color: T3 }} />
        <div className="min-w-0 flex-1">
          <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{t('ads.w.target.reach')}</p>
          {estimate === 'loading' ? <p className="inline-flex items-center gap-2" style={{ color: T2, fontSize: 14 }}><Loader2 className="w-4 h-4 animate-spin" />{t('ads.w.target.reachLoading')}</p>
            : estimate && estimate !== 'unknown' ? <p className="tabular-nums" style={{ color: T1, fontSize: 18, fontWeight: 700 }}>{fmtN(estimate.lower)} – {fmtN(estimate.upper)} <span style={{ color: T2, fontSize: 13, fontWeight: 500 }}>{t('ads.w.target.people')}</span></p>
            : <p style={{ color: T2, fontSize: 13.5 }}>{t('ads.w.target.reachUnknown')}</p>}
        </div>
        <p className="w-full sm:w-auto sm:max-w-[320px]" style={{ color: T3, fontSize: 12, lineHeight: 1.45 }}>{t('ads.w.target.reachNote')}</p>
      </div>
    </div>
  );
}
