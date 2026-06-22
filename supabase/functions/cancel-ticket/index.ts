import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Stripe fee calculation: 1.5% + 0.25€
const STRIPE_PERCENT = 0.015;
const STRIPE_FIXED_CENTS = 25;

function calcStripeFee(totalPriceCents: number): number {
  return (Math.round(totalPriceCents * STRIPE_PERCENT) + STRIPE_FIXED_CENTS) / 100;
}

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CANCEL-TICKET] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      throw new Error('Not authenticated');
    }

    logStep("User authenticated", { userId: user.id });

    const { ticketId } = await req.json();
    
    if (!ticketId) {
      throw new Error('ticketId is required');
    }

    const { data: ticket, error: ticketError } = await supabaseClient
      .from('tickets')
      .select('*, ticket_rounds(id, tickets_sold, event_id), events(id, title, start_at)')
      .eq('id', ticketId)
      .eq('user_id', user.id)
      .single();

    if (ticketError || !ticket) {
      throw new Error('Ticket not found or not owned by user');
    }

    logStep("Ticket found", { 
      ticketId: ticket.id, 
      hasInsurance: ticket.has_insurance,
      status: ticket.status 
    });

    if (!ticket.has_insurance) {
      throw new Error('This ticket does not have cancellation insurance');
    }

    if (ticket.status !== 'paid') {
      throw new Error('Only paid tickets can be cancelled');
    }

    const eventStart = new Date(ticket.events.start_at);
    const now = new Date();
    const hoursUntilEvent = (eventStart.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntilEvent < 24) {
      throw new Error('Cancellation deadline has passed (must cancel at least 24h before event)');
    }

    logStep("Validation passed", { hoursUntilEvent });

    // Insurance cancellation: full refund minus Yuno service fee only
    // Client paid: ticket price + insurance fee + service fee
    // Refund = totalPrice - serviceFee (i.e. ticket + insurance fee refunded, only Yuno keeps its cut)
    const totalPrice = Number(ticket.total_price);
    const serviceFee = Number(ticket.service_fee || 0);
    const refundAmount = Math.round(Math.max(0, totalPrice - serviceFee) * 100) / 100;

    logStep("Refund calculation", { 
      totalPrice,
      serviceFee,
      refundAmount 
    });

    // Process Stripe refund
    const paymentIntentId = ticket.stripe_payment_intent_id;
    if (paymentIntentId && refundAmount > 0) {
      const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
      if (stripeKey) {
        const stripe = new Stripe(stripeKey, { apiVersion: '2025-08-27.basil' });
        try {
          const refundAmountCents = Math.round(refundAmount * 100);
          // DIRECT charge → refund on the connected account (no transfer to reverse).
          // SEPARATE/platform charge → refund on the platform and reverse the transfers.
          const connectedAccount = ticket.stripe_connected_account_id as string | null;
          await stripe.refunds.create({
            payment_intent: paymentIntentId,
            amount: refundAmountCents,
            ...(connectedAccount ? {} : { reverse_transfer: true }),
            refund_application_fee: false,
          }, connectedAccount ? { stripeAccount: connectedAccount } : undefined);
          logStep("Stripe refund processed", { paymentIntentId, refundAmountCents, direct: !!connectedAccount });
        } catch (stripeError: any) {
          logStep("Stripe refund error", { error: stripeError.message });
        }
      }
    } else {
      logStep("No payment intent - skipping Stripe refund");
    }

    // Update ticket status
    const { error: updateError } = await adminClient
      .from('tickets')
      .update({
        status: 'refunded',
        cancelled_at: now.toISOString(),
        refund_amount: refundAmount,
      })
      .eq('id', ticketId);

    if (updateError) {
      throw updateError;
    }

    // Delete drink credits
    try {
      await adminClient.from('order_pack_credits').delete().eq('ticket_order_id', ticketId);
      await adminClient.from('ticket_upsell_selections').update({ status: 'cancelled' }).eq('ticket_id', ticketId);
      logStep("Deleted drink credits for ticket", { ticketId });
    } catch (e) { console.error("Error deleting drink credits:", e); }

    // Decrement tickets_sold
    const { error: roundUpdateError } = await adminClient
      .from('ticket_rounds')
      .update({ 
        tickets_sold: Math.max(0, ticket.ticket_rounds.tickets_sold - ticket.quantity) 
      })
      .eq('id', ticket.ticket_round_id);

    if (roundUpdateError) {
      console.error('Error updating round tickets_sold:', roundUpdateError);
    }

    logStep("Ticket cancelled, notifying waitlist");

    // Notify waitlist
    try {
      const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/notify-waitlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
        },
        body: JSON.stringify({
          roundId: ticket.ticket_round_id,
          ticketsFreed: ticket.quantity,
        }),
      });

      if (!response.ok) {
        console.error('Error notifying waitlist:', await response.text());
      } else {
        logStep("Waitlist notified");
      }
    } catch (notifyError) {
      console.error('Error calling notify-waitlist:', notifyError);
    }

    logStep("Cancellation complete", { refundAmount });

    return new Response(
      JSON.stringify({ 
        success: true, 
        refundAmount,
        message: 'Ticket cancelled successfully. Refund will be processed.' 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[CANCEL-TICKET] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
