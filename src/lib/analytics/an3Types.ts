/** Formes rendues par les RPC `get_analytics_*` (migrations `20261001*_analytics_v3_*`). */

export interface An3Scope { venueId?: string | null; organizerUserId?: string | null }

export interface An3Median {
  revenue: number | null; tickets: number | null; aov: number | null; conversion: number | null;
  attendance: number | null; new_share: number | null; fill: number | null; entries: number | null;
}

export interface An3Night {
  id: string; title: string; start_at: string; end_at: string; night: string; poster: string | null;
  money: boolean; revenue: number; tickets: number; tables: number; gl: number; cap: number | null; orders: number;
  entries: number; expected: number; scanned: boolean; visitors: number; buyers: number; customers: number; new_customers: number;
  aov: number | null; conversion: number | null; attendance: number | null; new_share: number | null; fill: number | null;
}

export interface An3Aggregate {
  nights: number; money_nights: number; revenue: number; rev_tickets: number; rev_tables: number; rev_bar: number; refunds: number;
  tickets: number; tables: number; gl_registered: number; cap: number | null; tickets_with_cap: number;
  orders: number; money_revenue: number; entries: number; expected: number; entries_all: number; expected_all: number;
  scanned_nights: number; visitors: number; buyers: number; customers: number; new_customers: number;
  median: An3Median; per_night: An3Night[];
}

export interface An3SeriesPoint { d: number; revenue: number | null; tickets: number | null; ref_revenue: number | null; ref_tickets: number | null }

export interface An3NightRow {
  id: string; title: string; start_at: string; end_at: string; night: string; poster: string | null; money: boolean;
  revenue: number; tickets: number; tables: number; gl: number; cap: number | null; entries: number; expected: number; scanned: boolean; customers: number;
  ref: { id: string; title: string; start_at: string; comparable: boolean; revenue: number | null; tickets: number; entries: number } | null;
}

export interface An3Overview {
  ok: true; money: boolean; tz: string; now: string;
  subject:
    | { kind: 'event'; event: { id: string; title: string; start_at: string; end_at: string; tz: string; status: 'upcoming' | 'live' | 'past'; poster: string | null } }
    | { kind: 'period'; from: string; to: string; tz: string };
  compare: {
    mode: string; kind: 'comparable' | 'previous' | 'median' | 'median_loose' | 'yoy' | 'previous_period' | 'none';
    n: number; median: boolean; ref_event: { id: string; title: string; start_at: string } | null; ref_from: string | null; ref_to: string | null;
  };
  current: An3Aggregate; reference: An3Aggregate | null;
  series: An3SeriesPoint[]; nights: An3NightRow[];
  breakdowns: {
    rounds: { name: string; price: number; qty: number; revenue: number | null; cap: number | null; rounds: number }[];
    promoters: { id: string; name: string; tickets: number; orders: number; revenue: number | null }[];
    sources: { source: string; orders: number; revenue: number | null }[];
  };
}

export interface An3PacingPoint { d: number; revenue: number | null; tickets: number | null; heads: number | null }
export interface An3PacingRef { d: number; tickets_med: number | null; tickets_min: number | null; tickets_max: number | null; revenue_med: number | null; revenue_min: number | null; revenue_max: number | null; heads_med: number | null }
export interface An3Pacing {
  ok: true; money: boolean;
  event: { id: string; title: string; start_at: string; end_at: string; tz: string; night: string; cap: number | null; status: 'upcoming' | 'live' | 'past' };
  days: number; today_d: number;
  compare: { mode: string; n: number; comparable: boolean; refs: { id: string; title: string; start_at: string }[] };
  curve: An3PacingPoint[]; reference: An3PacingRef[];
  status: 'good' | 'warn' | 'bad' | 'unknown' | 'no_reference_yet';
  at_d: { tickets: number | null; ref_tickets: number | null; ref_final: number | null };
  forecast: { tickets: number | null; tickets_low: number | null; tickets_high: number | null; share_sold_at_d: number | null } | null;
  markers: { kind: 'published' | 'tier' | 'email' | 'push'; d: number; at: string; label: string | null }[];
}

export interface An3Sales {
  ok: true; money: boolean; tz: string; nights: number;
  rounds: {
    id?: string; name: string; price: number; qty: number; revenue: number | null; cap?: number | null; sell_through: number | null;
    status?: 'sold_out' | 'on_sale' | 'closed'; first_sale_at?: string | null; sold_out_at?: string | null; opened_at?: string | null;
    hours_to_sell_out: number | null; rounds?: number; sold_out_rounds?: number;
  }[];
  last_minute: { units: number; last_7d: number; last_48h: number; day_of: number };
  lead_time: { median_days: number | null; buckets: { key: string; units: number }[] };
  heatmap: { total: number; cells: { w: number; h: number; n: number }[]; by_weekday: { w: number; n: number }[]; by_hour: { h: number; n: number }[] };
  small_multiples: { id: string; title: string; start_at: string; cap: number | null; tickets: number | null; revenue: number | null; curve: { d: number; tickets: number; revenue: number }[] | null }[];
}

export interface An3Door {
  ok: true; money: boolean; tz: string; nights: number;
  arrivals: { m: number; n: number; tickets: number | null; guest_list: number | null; tables: number | null }[];
  marks: { nights: number; scanned_nights: number; doors_open_m: number | null; gl_deadline_m: number | null; peak_m: number | null };
  by_type: {
    judged_nights: number;
    tickets: { expected: number; entered: number; expected_all: number; rate: number | null };
    guest_list: { expected: number; entered: number; expected_all: number; rate: number | null };
    tables: { booked: number; arrived: number; booked_all: number; guests_expected: number; guests_arrived: number; rate: number | null };
  };
  gl_to_paid: { people: number; converted: number; rate: number | null; matured: number };
  tables: {
    zones: { zone: string; zone_id: string | null; booked: number; requests: number; guests: number; arrived: number; no_show: number; revenue: number | null; deposits: number | null; revenue_per_table: number | null; minimum: number | null; spent: number | null; with_spend: number; spend_vs_min: number | null }[];
    totals: { booked: number; requests: number; arrived: number; no_show: number; guests: number; revenue: number | null; deposits: number | null; spent: number | null; minimum: number | null };
  };
  totals: { revenue: number | null; entries: number; expected: number; per_head: number | null; scanned_nights: number; finished_nights: number };
}

export interface An3Promoter {
  id: string; name: string | null; promo_code: string | null; active: boolean; agency_id: string | null;
  clicks: number; visitors: number; orders: number; tickets: number; tables: number; guest_list: number;
  attributed: number | null; conversion: number | null; attendance: number | null; judged: number; present: number;
  new_share: number | null; people: number; new_people: number; commission_due: number | null; commission_paid: number | null;
}
export interface An3Promoters {
  ok: true; money: boolean; nights: number; from: string; to: string;
  promoters: An3Promoter[];
  totals: { promoters: number; clicks: number; orders: number; tickets: number; attributed: number | null; commission_due: number | null; present: number; judged: number };
}

export interface An3Audience {
  ok: true; money: boolean; nights: number; k: number;
  per_night: { id: string; title: string; start_at: string; customers: number; new_customers: number; returning: number }[];
  return_90d: { customers: number; returning: number; rate: number | null };
  top_customers: { email: string; name: string | null; nights: number; tables: number; spend: number; last_at: string }[];
  age: { known: number; bands: { band: string; n: number | null; masked: boolean }[] };
  gender: { known: number; rows: { gender: string; n: number | null; masked: boolean }[] };
  cities: { known: number; rows: { city: string; n: number }[]; masked: number };
  totals: { customers: number; new_customers: number; buyers: number };
}

export type An3Denied = { ok: false; reason: 'not_authenticated' | 'forbidden' | 'not_found' | string };

export type An3SourceKey = 'promoter' | 'email' | 'instagram' | 'tiktok' | 'facebook' | 'whatsapp' | 'meta_ads' | 'partner' | 'link' | 'promo_code' | 'marketplace' | 'social' | 'search' | 'referral' | 'direct' | string;

export interface An3Sources {
  ok: true; money: boolean; nights: number; from: string; to: string;
  funnel: { step: 'club_page' | 'event_page' | 'selected' | 'checkout' | 'paid' | 'scanned'; n: number }[];
  sources: { source: An3SourceKey; sessions: number; visitors: number; orders: number; buyers: number; tickets: number; signups: number; revenue: number | null; conversion: number | null; revenue_per_visitor: number | null }[];
  totals: { sessions: number; visitors: number; orders: number; buyers: number; revenue: number | null; signups: number };
  yuno: { orders: number; buyers: number; revenue: number | null; new_customers: number; visits: number };
}

export interface An3EmailCampaignRow {
  id: string; name: string | null; subject: string | null; sent_at: string; event_id: string | null; automated: boolean;
  sent: number; delivered: number; opens: number; clicks: number; clickers: number; click_rate: number | null; open_rate_partial: number | null;
  orders_3d: number; buyers_3d: number; revenue_3d: number | null; orders_7d: number; buyers_7d: number; revenue_7d: number | null;
}
export interface An3PushCampaignRow {
  id: string; title: string | null; sent_at: string; event_id: string | null; automated: boolean;
  targeted: number; sent: number; taps: number; orders_3d: number; revenue_3d: number | null; orders_7d: number; revenue_7d: number | null;
}
export interface An3Campaigns { ok: true; money: boolean; from: string; to: string; email: An3EmailCampaignRow[]; push: An3PushCampaignRow[] }
