import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[JOIN-WAITLIST] ${step}${detailsStr}`);
};

// Email validation function
function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  // Max email length per RFC 5321
  if (email.length > 254) return false;
  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { roundId, email } = await req.json();
    
    if (!roundId || !email) {
      throw new Error('roundId and email are required');
    }

    // Validate and normalize email
    const normalizedEmail = String(email).toLowerCase().trim();
    if (!isValidEmail(normalizedEmail)) {
      throw new Error('Invalid email format');
    }

    logStep("Request data", { roundId, email: normalizedEmail });

    // Get user if authenticated
    let userId = null;
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const { data: { user } } = await supabaseClient.auth.getUser(
        authHeader.replace('Bearer ', '')
      );
      userId = user?.id;
    }

    // Validate round exists and is sold out
    const { data: round, error: roundError } = await supabaseClient
      .from('ticket_rounds')
      .select('*, events(id, start_at, title)')
      .eq('id', roundId)
      .single();

    if (roundError || !round) {
      throw new Error('Round not found');
    }

    logStep("Round found", { roundId: round.id, name: round.name, ticketsSold: round.tickets_sold, maxTickets: round.max_tickets });

    if (round.tickets_sold < round.max_tickets) {
      throw new Error('Tickets still available - no waitlist needed');
    }

    // Calculate position (next in line)
    const { count } = await supabaseClient
      .from('ticket_waitlist')
      .select('*', { count: 'exact', head: true })
      .eq('ticket_round_id', roundId)
      .eq('purchased', false);

    const position = (count || 0) + 1;

    logStep("Calculated position", { position });

    // Insert into waitlist
    const { data: entry, error: insertError } = await supabaseClient
      .from('ticket_waitlist')
      .insert({
        ticket_round_id: roundId,
        event_id: round.event_id,
        email: normalizedEmail,
        user_id: userId,
        position,
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        // Already on waitlist - get their position
        const { data: existingEntry } = await supabaseClient
          .from('ticket_waitlist')
          .select('position')
          .eq('ticket_round_id', roundId)
          .eq('email', normalizedEmail)
          .single();

        if (existingEntry) {
          return new Response(
            JSON.stringify({ success: true, position: existingEntry.position, alreadyRegistered: true }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        throw new Error('Already on the waitlist');
      }
      throw insertError;
    }

    logStep("Added to waitlist", { entryId: entry.id, position });

    return new Response(
      JSON.stringify({ success: true, position }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[JOIN-WAITLIST] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
