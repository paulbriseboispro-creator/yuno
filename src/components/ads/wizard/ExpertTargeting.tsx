// Mode expert de l'étape Ciblage : ce qu'Ads Manager laisse régler et qu'un
// novice n'a pas besoin de voir. Présence dans la zone, villes exclues, codes
// postaux, point précis (adresse + rayon), ciblage détaillé par groupes (OU
// dedans, ET entre : le « affiner l'audience » de Meta), placements manuels.

import { useState } from 'react';
import { Search, MapPin, X, Loader2, Plus, Layers, Smartphone, Monitor } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { AddressAutocomplete } from '@/components/location/AddressAutocomplete';
import {
  FACEBOOK_POSITIONS, INSTAGRAM_POSITIONS,
  type CustomLocation, type DetailedCriterion, type DetailedGroup, type GeoChoice, type LocationType, type ZipChoice,
} from '@/lib/metaAds';
import type { CampaignDraft, WizardCall } from './types';
import { Field, Chip, Tip, GhostButton, inputStyle, focusRing, T1, T2, T3, BORDER, RED, INNER_BG } from './ui';

function useSearch<T>(fetcher: (q: string) => Promise<T[]>) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<T[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timer, setTimer] = useState<number | null>(null);
  const onChange = (v: string) => {
    setQ(v);
    if (timer) window.clearTimeout(timer);
    if (v.trim().length < 2) { setResults([]); setError(null); return; }
    setTimer(window.setTimeout(async () => {
      setBusy(true); setError(null);
      try { setResults(await fetcher(v.trim())); } catch (e) { setResults([]); setError(e instanceof Error ? e.message : 'error'); } finally { setBusy(false); }
    }, 350));
  };
  return { q, onChange, results, busy, error, clear: () => { setQ(''); setResults([]); setError(null); } };
}
const SearchError = ({ error, t }: { error: string | null; t: (k: string) => string }) => error ? <p className="mt-1.5" style={{ color: 'var(--acc-ff8a91)', fontSize: 12.5, lineHeight: 1.45 }}>{t('ads.w.search.metaError')} {error}</p> : null;

function Box({ value, onChange, placeholder, busy, children }: { value: string; onChange: (v: string) => void; placeholder: string; busy: boolean; children?: React.ReactNode }) {
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
const Drop = ({ children }: { children: React.ReactNode }) => <div className="mt-1.5 rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}`, background: 'var(--sf-121214)' }}>{children}</div>;
const Row = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} className="w-full flex items-center gap-2.5 px-4 py-3 text-left cursor-pointer hover:bg-white/[0.05] transition-colors duration-150">{children}</button>
);

export function ExpertGeo({ draft, set, call, t }: { draft: CampaignDraft; set: <K extends keyof CampaignDraft>(k: K, v: CampaignDraft[K]) => void; call: WizardCall; t: (k: string) => string }) {
  const [pinAddress, setPinAddress] = useState('');
  const [pinRadius, setPinRadius] = useState(10);
  const excl = useSearch<GeoChoice>(async (q) => (((await call('ads_search_geo', { q, country: draft.country })).results as GeoChoice[] | undefined) ?? []).slice(0, 8));
  const zips = useSearch<ZipChoice>(async (q) => (((await call('ads_search_geo', { q, country: draft.country, kind: 'zip' })).results as ZipChoice[] | undefined) ?? []).slice(0, 8));
  const toggleType = (x: LocationType) => set('locationTypes', draft.locationTypes.includes(x) ? draft.locationTypes.filter((y) => y !== x) : [...draft.locationTypes, x]);
  return (
    <div className="space-y-4">
      <Field label={t('ads.x.geo.types')} hint={t('ads.x.geo.typesHint')}>
        <div className="flex gap-2 flex-wrap">
          {(['home', 'recent', 'travel_in'] as LocationType[]).map((x) => <Chip key={x} active={draft.locationTypes.includes(x)} onClick={() => toggleType(x)}>{t(`ads.x.geo.type.${x}`)}</Chip>)}
        </div>
      </Field>
      <Field label={t('ads.x.geo.exclude')} optional={t('ads.w.optional')} hint={t('ads.x.geo.excludeHint')}>
        <Box value={excl.q} onChange={excl.onChange} placeholder={t('ads.x.geo.excludePh')} busy={excl.busy}>
          {excl.results.length > 0 && <Drop>{excl.results.map((g) => (
            <Row key={g.key} onClick={() => { if (!draft.excludedCities.some((c) => c.key === g.key)) set('excludedCities', [...draft.excludedCities, { ...g, radius_km: 17 }]); excl.clear(); }}>
              <MapPin className="w-4 h-4" style={{ color: T3 }} /><span style={{ color: T1, fontSize: 14 }}>{g.name}</span><span style={{ color: T3, fontSize: 12.5 }}>{g.region ? `${g.region} · ` : ''}{g.country_code}</span>
            </Row>))}</Drop>}
          <SearchError error={excl.error} t={t} />
        </Box>
        {draft.excludedCities.length > 0 && <div className="mt-2 flex gap-2 flex-wrap">{draft.excludedCities.map((c) => <Chip key={c.key} active onClick={() => set('excludedCities', draft.excludedCities.filter((x) => x.key !== c.key))}>{c.name} <X className="w-3.5 h-3.5" /></Chip>)}</div>}
      </Field>
      <Field label={t('ads.x.geo.zips')} optional={t('ads.w.optional')} hint={t('ads.x.geo.zipsHint')}>
        <Box value={zips.q} onChange={zips.onChange} placeholder={t('ads.x.geo.zipsPh')} busy={zips.busy}>
          {zips.results.length > 0 && <Drop>{zips.results.map((z) => (
            <Row key={z.key} onClick={() => { if (!draft.zips.some((c) => c.key === z.key)) set('zips', [...draft.zips, { key: z.key, name: z.name, primary_city: z.primary_city }]); zips.clear(); }}>
              <span style={{ color: T1, fontSize: 14 }}>{z.name}</span><span style={{ color: T3, fontSize: 12.5 }}>{z.primary_city ?? ''}</span>
            </Row>))}</Drop>}
          <SearchError error={zips.error} t={t} />
        </Box>
        {draft.zips.length > 0 && <div className="mt-2 flex gap-2 flex-wrap">{draft.zips.map((z) => <Chip key={z.key} active onClick={() => set('zips', draft.zips.filter((x) => x.key !== z.key))}>{z.name}{z.primary_city ? ` · ${z.primary_city}` : ''} <X className="w-3.5 h-3.5" /></Chip>)}</div>}
      </Field>
      <Field label={t('ads.x.geo.pin')} optional={t('ads.w.optional')} hint={t('ads.x.geo.pinHint')}>
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <AddressAutocomplete value={pinAddress} onChange={setPinAddress} placeholder={t('ads.x.geo.pinPh')} inputStyle={inputStyle}
            onPick={(pick) => {
              if (pick.lat == null || pick.lng == null) return;
              const loc: CustomLocation = { latitude: pick.lat, longitude: pick.lng, radius_km: pinRadius, name: pick.placeName };
              set('customLocations', [...draft.customLocations, loc]);
              setPinAddress('');
            }} />
          <label className="flex items-center gap-3" style={{ color: T2, fontSize: 13 }}>
            <input type="range" min={1} max={80} step={1} value={pinRadius} onChange={(e) => setPinRadius(Number(e.target.value))} className="flex-1 cursor-pointer" style={{ accentColor: RED }} />
            <span className="tabular-nums w-14 text-right" style={{ color: T1, fontWeight: 600 }}>{pinRadius} km</span>
          </label>
        </div>
        {draft.customLocations.length > 0 && (
          <div className="mt-2 space-y-2">
            {draft.customLocations.map((c, i) => (
              <div key={`${c.latitude},${c.longitude},${i}`} className="flex items-center gap-3 rounded-xl px-4 py-2.5" style={{ background: 'rgb(var(--ink)/0.03)', border: `1px solid ${BORDER}` }}>
                <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: RED }} />
                <span className="flex-1 truncate" style={{ color: T1, fontSize: 13.5 }}>{c.name ?? `${c.latitude.toFixed(3)}, ${c.longitude.toFixed(3)}`}</span>
                <span className="tabular-nums" style={{ color: T3, fontSize: 12.5 }}>{c.radius_km} km</span>
                <button type="button" onClick={() => set('customLocations', draft.customLocations.filter((_, j) => j !== i))} className="h-9 w-9 rounded-lg flex items-center justify-center cursor-pointer hover:bg-white/[0.06]" style={{ color: T3 }} aria-label={t('ads.wizard.remove')}><X className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}
      </Field>
    </div>
  );
}

export function ExpertDetailed({ draft, set, call, t }: { draft: CampaignDraft; set: <K extends keyof CampaignDraft>(k: K, v: CampaignDraft[K]) => void; call: WizardCall; t: (k: string) => string }) {
  const { language } = useLanguage();
  const [activeGroup, setActiveGroup] = useState(0);
  const search = useSearch<DetailedCriterion>(async (q) => (((await call('ads_search', { type: 'detailed', q, locale: language })).results as DetailedCriterion[] | undefined) ?? []).slice(0, 14));
  const fmtN = (n: number) => new Intl.NumberFormat(language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR', { maximumFractionDigits: 0 }).format(n);
  const groups: DetailedGroup[] = draft.detailed.length ? draft.detailed : [{ items: [] }];
  const setGroups = (g: DetailedGroup[]) => set('detailed', g.filter((x, i) => x.items.length > 0 || i === g.length - 1));
  const add = (c: DetailedCriterion) => {
    const g = groups.map((x, i) => (i === activeGroup && !x.items.some((y) => y.id === c.id) ? { items: [...x.items, { id: c.id, name: c.name, type: c.type }] } : x));
    set('detailed', g); search.clear();
  };
  const remove = (gi: number, id: string) => setGroups(groups.map((x, i) => (i === gi ? { items: x.items.filter((y) => y.id !== id) } : x)));
  const typeLabel = (type: string) => type === 'interests' ? t('ads.x.detailed.kind.interests') : type === 'behaviors' ? t('ads.x.detailed.kind.behaviors') : t('ads.x.detailed.kind.demographics');
  return (
    <Field label={<span className="inline-flex items-center gap-2"><Layers className="w-4 h-4" style={{ color: T3 }} />{t('ads.x.detailed.title')}</span>} optional={t('ads.w.optional')} hint={t('ads.x.detailed.hint')}>
      <div className="space-y-3">
        {groups.map((g, gi) => (
          <div key={gi} className="rounded-xl p-3 space-y-2" style={{ background: 'rgb(var(--ink)/0.03)', border: `1px solid ${gi === activeGroup ? 'rgba(232,25,44,0.45)' : BORDER}` }}>
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => setActiveGroup(gi)} className="text-left cursor-pointer" style={{ color: T2, fontSize: 12.5, fontWeight: 600 }}>
                {gi === 0 ? t('ads.x.detailed.group1') : t('ads.x.detailed.groupN').replace('{n}', String(gi + 1))}
              </button>
              {groups.length > 1 && <button type="button" onClick={() => { setGroups(groups.filter((_, i) => i !== gi)); setActiveGroup(0); }} className="h-8 w-8 rounded-lg flex items-center justify-center cursor-pointer hover:bg-white/[0.06]" style={{ color: T3 }} aria-label={t('ads.wizard.remove')}><X className="w-4 h-4" /></button>}
            </div>
            {g.items.length === 0 ? <p style={{ color: T3, fontSize: 12.5 }}>{t('ads.x.detailed.empty')}</p> : (
              <div className="flex gap-2 flex-wrap">{g.items.map((c) => <Chip key={c.id} active onClick={() => remove(gi, c.id)}><span style={{ color: T3, fontSize: 11 }}>{typeLabel(c.type)}</span>{c.name} <X className="w-3.5 h-3.5" /></Chip>)}</div>
            )}
          </div>
        ))}
        <Box value={search.q} onChange={search.onChange} placeholder={t('ads.x.detailed.ph')} busy={search.busy}>
          {search.results.length > 0 && <Drop>{search.results.map((c) => (
            <Row key={`${c.type}:${c.id}`} onClick={() => add(c)}>
              <span className="px-1.5 py-0.5 rounded text-[10.5px] font-bold uppercase tracking-wider flex-shrink-0" style={{ background: INNER_BG, color: T3, border: `1px solid ${BORDER}` }}>{typeLabel(c.type)}</span>
              <span className="flex-1 min-w-0"><span className="block truncate" style={{ color: T1, fontSize: 14 }}>{c.name}</span>{c.path && <span className="block truncate" style={{ color: T3, fontSize: 12 }}>{c.path}</span>}</span>
              {c.size != null && <span className="tabular-nums" style={{ color: T3, fontSize: 12 }}>{fmtN(c.size)}</span>}
            </Row>))}</Drop>}
          <SearchError error={search.error} t={t} />
        </Box>
        {groups[groups.length - 1].items.length > 0 && groups.length < 5 && (
          <GhostButton small onClick={() => { set('detailed', [...groups, { items: [] }]); setActiveGroup(groups.length); }}><Plus className="w-3.5 h-3.5" /> {t('ads.x.detailed.narrow')}</GhostButton>
        )}
        <Tip>{t('ads.x.detailed.noExclusion')}</Tip>
      </div>
    </Field>
  );
}

export function ExpertPlacements({ draft, set, t }: { draft: CampaignDraft; set: <K extends keyof CampaignDraft>(k: K, v: CampaignDraft[K]) => void; t: (k: string) => string }) {
  const toggle = (k: 'igPositions' | 'fbPositions', v: string) => set(k, draft[k].includes(v) ? draft[k].filter((x) => x !== v) : [...draft[k], v]);
  const toggleDevice = (d: 'mobile' | 'desktop') => set('devices', draft.devices.includes(d) ? draft.devices.filter((x) => x !== d) : [...draft.devices, d]);
  return (
    <div className="space-y-4">
      <Field label={t('ads.x.place.manual')} hint={t('ads.x.place.manualHint')}>
        {draft.instagram && (
          <div className="mb-3">
            <p className="mb-1.5" style={{ color: T3, fontSize: 12, fontWeight: 600 }}>Instagram</p>
            <div className="flex gap-2 flex-wrap">{INSTAGRAM_POSITIONS.map((p) => <Chip key={p} active={draft.igPositions.includes(p)} onClick={() => toggle('igPositions', p)}>{t(`ads.x.place.ig.${p}`)}</Chip>)}</div>
          </div>
        )}
        {draft.facebook && (
          <div>
            <p className="mb-1.5" style={{ color: T3, fontSize: 12, fontWeight: 600 }}>Facebook</p>
            <div className="flex gap-2 flex-wrap">{FACEBOOK_POSITIONS.map((p) => <Chip key={p} active={draft.fbPositions.includes(p)} onClick={() => toggle('fbPositions', p)}>{t(`ads.x.place.fb.${p}`)}</Chip>)}</div>
          </div>
        )}
      </Field>
      <Field label={t('ads.x.place.devices')} hint={t('ads.x.place.devicesHint')}>
        <div className="flex gap-2 flex-wrap">
          <Chip active={draft.devices.includes('mobile')} onClick={() => toggleDevice('mobile')}><Smartphone className="w-3.5 h-3.5" />{t('ads.x.place.mobile')}</Chip>
          <Chip active={draft.devices.includes('desktop')} onClick={() => toggleDevice('desktop')}><Monitor className="w-3.5 h-3.5" />{t('ads.x.place.desktop')}</Chip>
        </div>
      </Field>
    </div>
  );
}
