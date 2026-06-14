import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || (req.method === 'POST' ? 'unsubscribe' : 'preview');
    let token: string | null = null;
    if (req.method === 'GET') {
      token = url.searchParams.get('token');
    } else {
      const body = await req.json().catch(() => ({}));
      token = body.token || url.searchParams.get('token');
    }
    if (!token) return new Response(JSON.stringify({ error: 'token required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    if (action === 'preview') {
      const { data, error } = await admin.rpc('preview_unsubscribe', { p_token: token });
      if (error) throw error;
      const row = (data as any[])?.[0];
      if (!row) return new Response(JSON.stringify({ found: false }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ found: true, ...row }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data, error } = await admin.rpc('unsubscribe_by_token', { p_token: token });
    if (error) throw error;
    const row = (data as any[])?.[0];
    return new Response(JSON.stringify(row || { success: false }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
