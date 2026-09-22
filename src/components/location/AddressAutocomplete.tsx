import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { geocodeCity } from '@/lib/geocode';

// Champ d'adresse à suggestions — même API Mapbox que le reste de l'app
// (AffiliateAddressSearch, ExploreHeader, geocode.ts). Le pro tape le début de
// son adresse, Yuno propose l'adresse COMPLÈTE, un clic la pose dans le
// formulaire. La saisie libre reste possible : une adresse que Mapbox ne
// connaît pas (un hangar, un domaine privé) doit rester saisissable à la main.

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

interface MapboxContext {
  id: string;
  text?: string;
  text_fr?: string;
  text_en?: string;
  text_es?: string;
}

interface MapboxFeature {
  id: string;
  /** Numéro de rue, seulement sur un résultat de type `address`. */
  address?: string;
  /** Nom court : la rue pour une adresse, l'enseigne pour un POI. */
  text: string;
  place_name: string;
  place_type: string[];
  properties?: { address?: string };
  context?: MapboxContext[];
}

export interface AddressPick {
  /** Ligne d'adresse seule (numéro + rue), sans ville ni pays. */
  address: string;
  /** Ville déduite du contexte Mapbox, quand elle existe. */
  city: string;
  postcode: string;
  country: string;
  /** Libellé complet tel que proposé dans la liste. */
  placeName: string;
  lat: number | null;
  lng: number | null;
}

function contextText(ctx: MapboxContext, language: string): string {
  if (language === 'fr') return ctx.text_fr ?? ctx.text ?? '';
  if (language === 'es') return ctx.text_es ?? ctx.text ?? '';
  return ctx.text_en ?? ctx.text ?? '';
}

function pickContext(feature: MapboxFeature, prefix: string, language: string): string {
  const hit = feature.context?.find((c) => c.id?.startsWith(`${prefix}.`));
  return hit ? contextText(hit, language) : '';
}

/** Ligne d'adresse d'un résultat : « 85 Rue de Limayrac », jamais la ville ni le pays. */
function streetLine(feature: MapboxFeature): string {
  if (feature.place_type?.includes('address')) {
    return [feature.address, feature.text].filter(Boolean).join(' ').trim();
  }
  // Repli défensif si Mapbox rend un autre type : on ne garde que la première
  // tranche du libellé, jamais la ville ni le pays qui suivent.
  return (feature.properties?.address || feature.place_name.split(',')[0] || feature.text).trim();
}

/** Reste du libellé complet, affiché en seconde ligne de la suggestion. */
function secondaryLine(feature: MapboxFeature, primary: string): string {
  const parts = feature.place_name.split(',').map((p) => p.trim()).filter(Boolean);
  const rest = parts[0]?.toLowerCase() === primary.toLowerCase() ? parts.slice(1) : parts;
  return rest.join(', ');
}

function toPick(feature: MapboxFeature, language: string): AddressPick {
  const [lng, lat] = Array.isArray((feature as { center?: number[] }).center)
    ? ((feature as { center: number[] }).center as [number, number])
    : [null, null];
  return {
    address: streetLine(feature),
    city: pickContext(feature, 'place', language) || pickContext(feature, 'locality', language),
    postcode: pickContext(feature, 'postcode', language),
    country: pickContext(feature, 'country', language),
    placeName: feature.place_name,
    lat,
    lng,
  };
}

/** Hauteur d'une suggestion (deux lignes) — sert au calcul d'ouverture. */
const ROW_HEIGHT = 54;

function measure(el: HTMLElement | null, count: number): { up: boolean; maxHeight: number } {
  const wanted = Math.min(count, 5) * ROW_HEIGHT + 2;
  const box = el?.getBoundingClientRect();
  if (!box) return { up: false, maxHeight: wanted };
  const below = window.innerHeight - box.bottom - 12;
  const above = box.top - 12;
  const up = below < wanted && above > below;
  return { up, maxHeight: Math.max(120, Math.min(wanted, up ? above : below)) };
}

interface AddressAutocompleteProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onPick: (pick: AddressPick) => void;
  /** Ville déjà saisie : oriente la recherche autour d'elle. */
  city?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Styles du champ, pour coller au formulaire hôte (org / owner). */
  inputClassName?: string;
  inputStyle?: React.CSSProperties;
}

export function AddressAutocomplete({
  id,
  value,
  onChange,
  onPick,
  city,
  placeholder,
  disabled,
  inputClassName,
  inputStyle,
}: AddressAutocompleteProps) {
  const { language } = useLanguage();

  const [results, setResults] = useState<MapboxFeature[]>([]);
  const [open, setOpen] = useState(false);
  /** Sens d'ouverture + hauteur, calculés sur la place réelle autour du champ. */
  const [drop, setDrop] = useState<{ up: boolean; maxHeight: number }>({ up: false, maxHeight: 300 });
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Dernière valeur posée par un clic : on ne relance pas une recherche dessus. */
  const pickedRef = useRef<string | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
  }, []);

  // La ville est lue au MOMENT de la requête : un état + useEffect laissait
  // partir la recherche avec l'ancien biais (ou aucun) quand le pro tapait son
  // adresse dans la foulée de sa ville — et « 85 rue de lima » à Toulouse
  // remontait alors Orléans, Hyères, Sillery. Mesuré le 2026-09-22.
  const cityRef = useRef(city);
  cityRef.current = city;

  const search = useCallback(async (q: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      // geocodeCity met en cache dans localStorage : un appel par ville, pas
      // un par frappe.
      const town = (cityRef.current ?? '').trim();
      const near = town ? await geocodeCity(town) : null;
      if (controller.signal.aborted) return;
      const params = new URLSearchParams({
        access_token: MAPBOX_TOKEN ?? '',
        // `address` seul : mesuré le 2026-09-22, l'index POI de Mapbox ne rend
        // AUCUN résultat avec notre token (0 sur « Le Bikini », lieu connu), et
        // l'ajouter ne ferait que rallonger l'URL. Ne pas le remettre sans
        // nouvelle mesure.
        types: 'address',
        limit: '5',
        language,
        autocomplete: 'true',
      });
      if (near) params.set('proximity', `${near.lng},${near.lat}`);
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?${params}`,
        { signal: controller.signal },
      );
      if (!res.ok) { setResults([]); return; }
      const data = await res.json();
      const features: MapboxFeature[] = Array.isArray(data?.features) ? data.features : [];
      setResults(features);
      setActive(-1);
      // Le champ est bas dans un dialogue qui défile : sans ce calcul la liste
      // sortait sous le bord du dialogue, par-dessus la page. On l'ouvre du côté
      // où il y a le plus de place, et on la borne à cette place.
      setDrop(measure(containerRef.current, features.length));
      setOpen(features.length > 0);
    } catch {
      // Requête annulée ou réseau coupé : la saisie libre reste valide, on se tait.
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, [language]);

  const handleChange = (next: string) => {
    onChange(next);
    pickedRef.current = null;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!MAPBOX_TOKEN || next.trim().length < 3) {
      abortRef.current?.abort();
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => search(next.trim()), 280);
  };

  const choose = (feature: MapboxFeature) => {
    const pick = toPick(feature, language);
    pickedRef.current = pick.address;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    setResults([]);
    setOpen(false);
    setActive(-1);
    setLoading(false);
    onPick(pick);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      // Entrée ne valide une suggestion que si le pro en a surligné une :
      // sinon il soumet son formulaire, comme dans n'importe quel champ.
      if (active >= 0) { e.preventDefault(); choose(results[active]); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active < 0) return;
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const rows = useMemo(
    () => results.map((f) => {
      const primary = streetLine(f);
      return { feature: f, primary, secondary: secondaryLine(f, primary) };
    }),
    [results],
  );

  return (
    <div ref={containerRef} className="relative">
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => { if (results.length > 0 && value.trim() !== pickedRef.current) setOpen(true); }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className={inputClassName}
        style={inputStyle}
      />
      {loading && (
        <Loader2
          className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin pointer-events-none"
          style={{ color: 'rgba(255,255,255,0.36)' }}
        />
      )}

      {open && rows.length > 0 && (
        <div
          className={`absolute left-0 right-0 z-50 overflow-hidden rounded-xl ${drop.up ? 'bottom-full mb-1' : 'top-full mt-1'}`}
          style={{
            background: '#0a0a0c',
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: '0 18px 40px -20px rgba(0,0,0,.9)',
            maxHeight: drop.maxHeight,
            overflowY: 'auto',
          }}
          role="listbox"
          ref={listRef}
        >
          {rows.map((row, i) => (
            <button
              key={row.feature.id ?? i}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(row.feature)}
              className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors"
              style={{
                background: i === active ? 'rgba(255,255,255,0.05)' : 'transparent',
                borderBottom: i === rows.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <MapPin className="mt-0.5 h-3.5 w-3.5 flex-none" style={{ color: '#E8192C' }} />
              <span className="min-w-0">
                <span className="block truncate" style={{ color: 'rgba(255,255,255,0.96)', fontSize: 13 }}>
                  {row.primary}
                </span>
                {row.secondary && (
                  <span className="block truncate" style={{ color: 'rgba(255,255,255,0.40)', fontSize: 11.5 }}>
                    {row.secondary}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
