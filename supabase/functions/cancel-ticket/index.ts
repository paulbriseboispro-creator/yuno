import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import Stripe from "https://esm.sh/stripe@18.5.0";
import { demoPreviewGuard } from "../_shared/demo-guard.ts";
import { alreadyRefundedCents, fromCents, planRefund, refundCapCents } from "../_shared/sale-refund.ts";
import {
  applyFullRefundEffects, applyRefundAmountEffects, loadSaleRefundContext, markSaleFullyRefunded,
  refundSaleOnStripe,
} from "../_shared/sale-refund-effects.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CANCEL-TICKET] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  // Lien démo : lecture seule garantie côté serveur (_shared/demo-guard.ts).
  const demoRefusal = await demoPreviewGuard(req, corsHeaders);
  if (demoRefusal) return demoRefusal;

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
      .select('*, events(id, title, start_at)')
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

    // Annulation assurée : le client récupère ce qu'il a payé moins les frais
    // Yuno — frais de service ET assurance, consommée par l'annulation. C'est le
    // montant que « Mes commandes » lui annonce, et le plafond de la Console
    // (`refundCapCents`). Avant, l'assurance lui était rendue en plus, prise sur
    // le compte du club qui ne l'avait jamais encaissée.
    const plan = planRefund(refundCapCents('ticket', ticket), alreadyRefundedCents(ticket), Number.MAX_SAFE_INTEGER);
    const refundAmount = plan ? fromCents(plan.amountCents) : 0;
    logStep("Refund calculation", { totalPrice: ticket.total_price, refundAmount });

    if (plan) {
      const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
      if (!stripeKey) throw new Error('Refunds are unavailable right now');
      const stripe = new Stripe(stripeKey, { apiVersion: '2025-08-27.basil' });
      const connectedAccountId = (ticket.stripe_connected_account_id as string | null) || null;

      let paymentIntentId: string | null = ticket.stripe_payment_intent_id || null;
      if (!paymentIntentId && ticket.stripe_session_id) {
        try {
          const session = await stripe.checkout.sessions.retrieve(
            ticket.stripe_session_id, undefined,
            connectedAccountId ? { stripeAccount: connectedAccountId } : undefined,
          );
          paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
        } catch (sessionError) {
          logStep("Could not read the Stripe session", { error: (sessionError as Error).message });
        }
      }
      // Sans paiement retrouvé, on ne marque RIEN remboursé : le client garderait
      // un billet annulé sans avoir revu son argent.
      if (!paymentIntentId) throw new Error('Payment not found — please contact support');

      // Verrou AVANT Stripe (même mécanique que owner-refund) : un double appel
      // ne rembourse qu'une fois, et le webhook `charge.refunded` trouvera le
      // montant déjà enregistré.
      const prevRaw = ticket.refund_amount as number | string | null;
      let claim = adminClient.from('tickets')
        .update({
          refund_amount: fromCents(plan.cumulativeCents),
          refunded_by: user.id,
          refunded_at: now.toISOString(),
          cancelled_at: now.toISOString(),
        })
        .eq('id', ticketId)
        .eq('status', 'paid');
      claim = prevRaw === null || prevRaw === undefined ? claim.is('refund_amount', null) : claim.eq('refund_amount', prevRaw);
      const { data: claimed, error: claimError } = await claim.select('id');
      if (claimError) throw claimError;
      if (!claimed || claimed.length === 0) throw new Error('This ticket is already being cancelled');

      const refund = await refundSaleOnStripe(stripe, adminClient, {
        paymentIntentId,
        amountCents: plan.amountCents,
        connectedAccountId,
        idempotencyKey: `cancel-ticket:${ticketId}:${plan.cumulativeCents}`,
        expectedCumulativeCents: plan.cumulativeCents,
      });
      if (!refund.ok) {
        // Avant, l'échec était journalisé puis le billet passait « remboursé » :
        // le client perdait son entrée ET son argent. Il garde son billet.
        await adminClient.from('tickets')
          .update({ refund_amount: prevRaw ?? null, refunded_by: null, refunded_at: null, cancelled_at: null })
          .eq('id', ticketId)
          .eq('refund_amount', fromCents(plan.cumulativeCents));
        logStep("Stripe refund error — ticket kept", { error: refund.error });
        throw new Error('The refund could not be processed — your ticket is still valid. Please try again later.');
      }
      logStep("Stripe refund processed", { paymentIntentId, amountCents: plan.amountCents, direct: !!connectedAccountId });
    }

    // Passage unique à « refunded » : places rendues à la jauge et crédits
    // boissons supprimés par le trigger `trg_release_refunded_ticket`.
    const ctx = await loadSaleRefundContext(adminClient, 'ticket', ticket);
    if (plan) await applyRefundAmountEffects(adminClient, ctx, plan.amountCents, { source: 'yuno' });
    if (await markSaleFullyRefunded(adminClient, 'ticket', ticketId)) {
      if (!plan) await adminClient.from('tickets').update({ cancelled_at: now.toISOString(), refunded_by: user.id }).eq('id', ticketId);
      await applyFullRefundEffects(adminClient, ctx);
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
