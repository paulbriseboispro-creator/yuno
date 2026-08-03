import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Vue guest list côté AGENCE : par soirée à venir où le club a accordé une
// enveloppe ('agency' part), la répartition entre les promoteurs de l'agence.
// Partition ⇒ sous-parts 'promoter' (quotas fixes) ; pool ⇒ tous puisent dans
// l'enveloppe. Lecture directe (policies additives 20260730095000), agrégation TS.

export type AgencyGlPromoterRow = {
  promoter_id: string;
  name: string;
  profile_image_url: string | null;
  assigned: boolean;
  subpart_id: string | null;
  sub_quota: number | null;
  sub_normal: number;
  sub_drink: number;
  sub_table: number;
  sub_used: number;   // invités posés sur la sous-part (partition)
  pool_used: number;  // invités attribués à ce promoteur dans l'enveloppe (pool)
};

export type AgencyGlEnvelope = {
  guest_list_id: string;
  event_id: string;
  event_title: string;
  start_at: string;
  venue_name: string | null;
  quota: number | null;
  quota_normal: number;
  quota_drink: number;
  quota_table: number;
  quota_female: number | null;
  quota_male: number | null;
  free_before_time: string | null;
  mode: 'partition' | 'pool';
  is_active: boolean;
  used_total: number;
  used_normal: number;
  used_drink: number;
  used_table: number;
  promoters: AgencyGlPromoterRow[];
};

type Raw = Record<string, any>;

function promoDisplayName(p: Raw): string {
  const full = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
  return full || p.promo_code || 'Promoteur';
}

export function useAgencyGuestList(agencyId: string | null) {
  const [envelopes, setEnvelopes] = useState<AgencyGlEnvelope[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!agencyId) { setEnvelopes([]); setLoading(false); return; }
    setLoading(true);
    const db = supabase as any;

    // 1) Enveloppes agence (toutes soirées) + promoteurs de l'agence, en parallèle.
    const [envRes, promRes] = await Promise.all([
      db.from('guest_lists')
        .select('id, event_id, quota, quota_normal, quota_drink, quota_table, quota_female, quota_male, free_before_time, agency_distribution_mode, is_active')
        .eq('holder_type', 'agency')
        .eq('agency_id', agencyId),
      db.from('promoters')
        .select('id, first_name, last_name, promo_code, profile_image_url')
        .eq('agency_id', agencyId),
    ]);

    const envRows = (envRes.data as Raw[]) ?? [];
    const promoters = (promRes.data as Raw[]) ?? [];
    if (envRows.length === 0) { setEnvelopes([]); setLoading(false); return; }

    const eventIds = [...new Set(envRows.map(e => e.event_id))];
    const promoterIds = promoters.map(p => p.id);

    // 2) Soirées (à venir), sous-parts promoteur, assignations, invités — en parallèle.
    const [evRes, subRes, assignRes] = await Promise.all([
      db.from('events').select('id, title, start_at, end_at, venue_id').in('id', eventIds),
      promoterIds.length
        ? db.from('guest_lists')
            .select('id, event_id, promoter_id, quota, quota_normal, quota_drink, quota_table')
            .eq('holder_type', 'promoter')
            .in('event_id', eventIds)
            .in('promoter_id', promoterIds)
        : Promise.resolve({ data: [] }),
      promoterIds.length
        ? db.from('promoter_event_assignments')
            .select('promoter_id, event_id')
            .in('event_id', eventIds)
            .in('promoter_id', promoterIds)
        : Promise.resolve({ data: [] }),
    ]);

    const events = (evRes.data as Raw[]) ?? [];
    const now = Date.now();
    const upcoming = events.filter(e => !e.end_at || new Date(e.end_at).getTime() >= now);
    const eventById = new Map(upcoming.map(e => [e.id, e]));

    const venueIds = [...new Set(upcoming.map(e => e.venue_id).filter(Boolean))];
    const venuesRes = venueIds.length
      ? await db.from('venues').select('id, name').in('id', venueIds)
      : { data: [] };
    const venueName = new Map(((venuesRes.data as Raw[]) ?? []).map(v => [v.id, v.name]));

    const subParts = (subRes.data as Raw[]) ?? [];
    const assignSet = new Set(((assignRes.data as Raw[]) ?? []).map(a => `${a.event_id}:${a.promoter_id}`));

    // 3) Invités : sur les enveloppes + les sous-parts (comptage partition/pool).
    const allPartIds = [
      ...envRows.map(e => e.id),
      ...subParts.map(s => s.id),
    ];
    const entriesRes = allPartIds.length
      ? await db.from('guest_list_entries')
          .select('guest_list_id, promoter_id, entry_type, status')
          .in('guest_list_id', allPartIds)
          .neq('status', 'cancelled')
      : { data: [] };
    const entries = (entriesRes.data as Raw[]) ?? [];

    // Comptages par part (total + par type), et par (enveloppe, promoteur) pour le pool.
    const partCount = new Map<string, { total: number; normal: number; drink: number; table: number }>();
    const poolByPromoter = new Map<string, number>(); // key `${gl_id}:${promoter_id}`
    for (const e of entries) {
      const k = e.guest_list_id;
      const c = partCount.get(k) ?? { total: 0, normal: 0, drink: 0, table: 0 };
      c.total += 1;
      const t = (e.entry_type as string) || 'normal';
      if (t === 'drink') c.drink += 1;
      else if (t === 'table') c.table += 1;
      else c.normal += 1;
      partCount.set(k, c);
      if (e.promoter_id) {
        const pk = `${e.guest_list_id}:${e.promoter_id}`;
        poolByPromoter.set(pk, (poolByPromoter.get(pk) ?? 0) + 1);
      }
    }

    const subByKey = new Map<string, Raw>(); // `${event_id}:${promoter_id}` → subpart
    for (const s of subParts) subByKey.set(`${s.event_id}:${s.promoter_id}`, s);

    // 4) Assemble une enveloppe par soirée à venir.
    const out: AgencyGlEnvelope[] = [];
    for (const env of envRows) {
      const ev = eventById.get(env.event_id);
      if (!ev) continue; // soirée passée / non lisible
      const envCount = partCount.get(env.id) ?? { total: 0, normal: 0, drink: 0, table: 0 };

      const proms: AgencyGlPromoterRow[] = promoters.map(p => {
        const sub = subByKey.get(`${env.event_id}:${p.id}`);
        const subCount = sub ? (partCount.get(sub.id) ?? { total: 0 }) : { total: 0 };
        return {
          promoter_id: p.id,
          name: promoDisplayName(p),
          profile_image_url: p.profile_image_url ?? null,
          assigned: assignSet.has(`${env.event_id}:${p.id}`),
          subpart_id: sub?.id ?? null,
          sub_quota: sub?.quota ?? null,
          sub_normal: sub?.quota_normal ?? 0,
          sub_drink: sub?.quota_drink ?? 0,
          sub_table: sub?.quota_table ?? 0,
          sub_used: subCount.total ?? 0,
          pool_used: poolByPromoter.get(`${env.id}:${p.id}`) ?? 0,
        };
      });

      out.push({
        guest_list_id: env.id,
        event_id: env.event_id,
        event_title: ev.title,
        start_at: ev.start_at,
        venue_name: ev.venue_id ? (venueName.get(ev.venue_id) ?? null) : null,
        quota: env.quota,
        quota_normal: env.quota_normal ?? 0,
        quota_drink: env.quota_drink ?? 0,
        quota_table: env.quota_table ?? 0,
        quota_female: env.quota_female,
        quota_male: env.quota_male,
        free_before_time: env.free_before_time,
        mode: (env.agency_distribution_mode as 'partition' | 'pool') ?? 'partition',
        is_active: env.is_active,
        used_total: envCount.total,
        used_normal: envCount.normal,
        used_drink: envCount.drink,
        used_table: envCount.table,
        promoters: proms,
      });
    }

    out.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
    setEnvelopes(out);
    setLoading(false);
  }, [agencyId]);

  useEffect(() => { load(); }, [load]);

  return { envelopes, loading, reload: load };
}
