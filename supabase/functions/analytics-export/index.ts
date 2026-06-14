// Export analytics data to CSV for any of the 6 pillars (acquisition, behavior, revenue, audience, pulse, predictive).
// Scoped per venue or organizer. Caller must be authenticated and authorized.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Scope = { kind: 'venue'; id: string } | { kind: 'organizer'; id: string };
type Pillar = 'acquisition' | 'behavior' | 'revenue' | 'audience' | 'pulse';

function toCsv(rows: Record<string, any>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(','),
    ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
  ].join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    // Verify caller
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { scope, pillar, startDate, endDate } = body as {
      scope: Scope; pillar: Pillar; startDate?: string; endDate?: string;
    };

    if (!scope || !pillar) {
      return new Response(JSON.stringify({ error: 'Missing scope or pillar' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Authorization check
    if (scope.kind === 'venue') {
      const { data: venue } = await supabase.from('venues').select('owner_id').eq('id', scope.id).single();
      const isOwner = venue?.owner_id === user.id;
      const { data: roleAdmin } = await supabase.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'admin').maybeSingle();
      if (!isOwner && !roleAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      if (scope.id !== user.id) {
        const { data: roleAdmin } = await supabase.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'admin').maybeSingle();
        if (!roleAdmin) {
          return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400_000);
    const end = endDate ? new Date(endDate) : new Date();
    const scopeFilter = scope.kind === 'venue'
      ? { col: 'venue_id', val: scope.id }
      : { col: 'organizer_user_id', val: scope.id };

    let csv = '';
    let filename = `analytics-${pillar}-${scope.id}-${Date.now()}.csv`;

    if (pillar === 'acquisition') {
      const { data } = await supabase
        .from('visitor_sessions')
        .select('visited_at, utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, referrer, referrer_category, country, region, city, completed_order')
        .eq(scopeFilter.col, scopeFilter.val)
        .gte('visited_at', start.toISOString())
        .lte('visited_at', end.toISOString())
        .limit(10000);
      csv = toCsv(data || []);
    } else if (pillar === 'behavior') {
      const { data } = await supabase
        .from('visitor_sessions')
        .select('visited_at, device_type, pages_viewed, scroll_depth_max, duration_seconds, added_to_cart, proceeded_to_checkout, completed_order, is_returning, visit_number')
        .eq(scopeFilter.col, scopeFilter.val)
        .gte('visited_at', start.toISOString())
        .lte('visited_at', end.toISOString())
        .limit(10000);
      csv = toCsv(data || []);
    } else if (pillar === 'revenue') {
      // Use rollup view
      const { data } = await supabase
        .from('analytics_daily_rollup')
        .select('*')
        .eq(scopeFilter.col, scopeFilter.val)
        .gte('day', start.toISOString().slice(0, 10))
        .lte('day', end.toISOString().slice(0, 10))
        .order('day', { ascending: true });
      csv = toCsv(data || []);
    } else if (pillar === 'audience') {
      if (scope.kind === 'venue') {
        const { data } = await supabase
          .from('venue_customers')
          .select('user_email, full_name, total_spent, order_count, ticket_count, table_count, last_visit_at, first_visit_at, tier')
          .eq('venue_id', scope.id)
          .order('total_spent', { ascending: false })
          .limit(10000);
        csv = toCsv(data || []);
      } else {
        const { data } = await supabase
          .from('customer_activity_log')
          .select('user_id, activity_type, ref_id, amount_cents, ts')
          .eq('organizer_user_id', scope.id)
          .gte('ts', start.toISOString())
          .lte('ts', end.toISOString())
          .order('ts', { ascending: false })
          .limit(10000);
        csv = toCsv(data || []);
      }
    } else if (pillar === 'pulse') {
      const { data } = await supabase
        .from('visitor_sessions')
        .select('visited_at, ip_address, device_type, country, city, added_to_cart, proceeded_to_checkout, completed_order')
        .eq(scopeFilter.col, scopeFilter.val)
        .gte('visited_at', new Date(Date.now() - 24 * 3600_000).toISOString())
        .order('visited_at', { ascending: false })
        .limit(5000);
      csv = toCsv(data || []);
    } else {
      return new Response(JSON.stringify({ error: 'Unknown pillar' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(csv, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    console.error('analytics-export error', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
