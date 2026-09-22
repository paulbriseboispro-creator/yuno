// Brouillon de l'assistant : ce que le pro compose avant l'envoi à Meta.
// `DraftMedia` porte, en plus de ce qui part chez Meta, l'état de l'envoi du
// fichier (aperçu local, en cours, erreur) — retiré à la soumission.

import type { AdCreative, AudienceMode, BidStrategy, CampaignObjective, ConversionEvent, CreativeMedia, CtaType, CustomLocation, DetailedGroup, GeoChoice, InterestChoice, LocaleChoice, LocationType, ScheduleSlot, ZipChoice } from '@/lib/metaAds';

export interface DraftMedia extends CreativeMedia {
  localId: string;
  /** Aperçu local (object URL) tant que l'envoi n'a pas rendu l'URL publique. */
  preview?: string;
  uploading?: boolean;
  error?: string;
  /** Vidéo : durée lue à l'inspection (affichage). */
  duration?: number;
}

export interface DraftCreative extends Omit<AdCreative, 'media' | 'cta' | 'vertical_media'> {
  media: DraftMedia[];
  vertical_media?: DraftMedia | null;
  cta: CtaType;
}

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
  interests: InterestChoice[];
  locales: LocaleChoice[];
  audienceMode: AudienceMode;
  facebook: boolean;
  instagram: boolean;
  creatives: DraftCreative[];
  // ── Mode expert (tout facultatif) ──
  excludedCities: GeoChoice[];
  zips: ZipChoice[];
  customLocations: CustomLocation[];
  locationTypes: LocationType[];
  /** Groupes de critères détaillés (OU dedans, ET entre). Vide = pas de ciblage détaillé. */
  detailed: DetailedGroup[];
  /** Placements manuels ; vides = Meta choisit. */
  igPositions: string[];
  fbPositions: string[];
  devices: Array<'mobile' | 'desktop'>;
  conversionEvent: ConversionEvent;
  /** Visites : LINK_CLICKS | LANDING_PAGE_VIEWS ; Notoriété : REACH | IMPRESSIONS. */
  optimizationGoal: string;
  bidStrategy: BidStrategy;
  bidAmountEuros: number;
  roasFloor: number;
  schedule: ScheduleSlot[];
  frequencyMax: number;
  frequencyDays: number;
  urlTags: string;
}

export type WizardMode = 'create' | 'edit' | 'duplicate';

export type WizardCall = (action: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
