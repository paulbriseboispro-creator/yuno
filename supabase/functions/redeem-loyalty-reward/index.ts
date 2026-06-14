import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { v4 as uuidv4 } from "https://esm.sh/uuid@9.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const generateQRCode = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'RWD-';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      throw new Error('Not authenticated');
    }

    const { 
      rewardId, 
      venueId, 
      drinkId, 
      eventId, 
      drinkName, 
      eventTitle,
      roundId,
      roundName 
    } = await req.json();

    if (!rewardId || !venueId) {
      throw new Error('Missing rewardId or venueId');
    }

    if (!rewardId || !venueId) {
      throw new Error('Missing rewardId or venueId');
    }

    // Get reward details
    const { data: reward, error: rewardError } = await supabaseAdmin
      .from('loyalty_rewards')
      .select('*')
      .eq('id', rewardId)
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .single();

    if (rewardError || !reward) {
      throw new Error('Reward not found or inactive');
    }

    // Check max redemptions if set
    if (reward.max_redemptions && reward.redemption_count >= reward.max_redemptions) {
      throw new Error('Reward is no longer available');
    }

    // Get customer loyalty
    const { data: loyalty, error: loyaltyError } = await supabaseAdmin
      .from('customer_loyalty')
      .select('*')
      .eq('venue_id', venueId)
      .eq('user_id', user.id)
      .single();

    if (loyaltyError || !loyalty) {
      throw new Error('Loyalty account not found');
    }

    // Check balance
    if (loyalty.current_balance < reward.points_required) {
      throw new Error('Insufficient points');
    }

    // Generate unique QR code
    let qrCode = generateQRCode();
    let attempts = 0;
    while (attempts < 5) {
      const { data: existing } = await supabaseAdmin
        .from('reward_redemptions')
        .select('id')
        .eq('qr_code', qrCode)
        .single();
      
      if (!existing) break;
      qrCode = generateQRCode();
      attempts++;
    }

    // Calculate expiration (30 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Create redemption record
    const { data: redemption, error: redemptionError } = await supabaseAdmin
      .from('reward_redemptions')
      .insert({
        customer_loyalty_id: loyalty.id,
        reward_id: rewardId,
        venue_id: venueId,
        user_id: user.id,
        points_spent: reward.points_required,
        qr_code: qrCode,
        expires_at: expiresAt.toISOString(),
        status: 'pending'
      })
      .select()
      .single();

    if (redemptionError) {
      console.error('Redemption error:', redemptionError);
      throw new Error('Failed to create redemption');
    }

    // Create transaction record
    await supabaseAdmin
      .from('loyalty_transactions')
      .insert({
        customer_loyalty_id: loyalty.id,
        venue_id: venueId,
        transaction_type: 'redeem',
        points: reward.points_required,
        description: `Redeemed: ${reward.name}`,
        reference_type: 'reward',
        reference_id: redemption.id
      });

    // Update loyalty balance
    await supabaseAdmin
      .from('customer_loyalty')
      .update({
        current_balance: loyalty.current_balance - reward.points_required,
        total_points_spent: loyalty.total_points_spent + reward.points_required,
        updated_at: new Date().toISOString()
      })
      .eq('id', loyalty.id);

    // Increment redemption count on reward
    await supabaseAdmin
      .from('loyalty_rewards')
      .update({
        redemption_count: (reward.redemption_count || 0) + 1
      })
      .eq('id', rewardId);

    let orderId = null;
    let ticketId = null;

    // If it's a free drink reward with drink and event selected, create an order
    if (reward.reward_type === 'free_drink' && drinkId && eventId) {
      // Get the drink details
      const { data: drink, error: drinkError } = await supabaseAdmin
        .from('drinks')
        .select('id, name, img_url, price')
        .eq('id', drinkId)
        .eq('venue_id', venueId)
        .single();

      if (drinkError || !drink) {
        console.error('Drink error:', drinkError);
        // Don't fail the redemption, just log the error
      } else {
        // Get event details
        const { data: event, error: eventError } = await supabaseAdmin
          .from('events')
          .select('id, title, start_at')
          .eq('id', eventId)
          .single();

        if (eventError || !event) {
          console.error('Event error:', eventError);
        } else {
          // Generate order token
          const orderToken = uuidv4().replace(/-/g, "").substring(0, 16).toUpperCase();
          const eventStartAt = event.start_at as string;
          const tokenExpiresAt = new Date(eventStartAt || new Date());
          tokenExpiresAt.setHours(tokenExpiresAt.getHours() + 8); // Valid for 8 hours after event start

          // Create the order
          const orderItems = [{
            drinkId: drink.id,
            name: drinkName || drink.name,
            unitPrice: 0, // Free drink from loyalty
            qty: 1,
            eventId: eventId,
            eventTitle: eventTitle || event.title,
            imgUrl: drink.img_url,
            isLoyaltyReward: true,
            rewardRedemptionId: redemption.id
          }];

          const { data: order, error: orderError } = await supabaseAdmin
            .from('orders')
            .insert({
              user_id: user.id,
              user_email: user.email,
              venue_id: venueId,
              event_id: eventId,
              items: orderItems,
              total: 0, // Free
              status: 'paid',
              paid_at: new Date().toISOString(),
              token: orderToken,
              token_expires_at: tokenExpiresAt.toISOString(),
              token_used: false
            })
            .select()
            .single();

          if (orderError) {
            console.error('Order creation error:', orderError);
          } else {
            orderId = order.id;
            console.log('Loyalty reward order created:', order.id);
          }
        }
      }
    }

    // If it's a free ticket reward with event and round selected, create a ticket
    if (reward.reward_type === 'free_ticket' && eventId && roundId) {
      // Get round details
      const { data: round, error: roundError } = await supabaseAdmin
        .from('ticket_rounds')
        .select('id, name, price, event_id, tickets_sold, max_tickets')
        .eq('id', roundId)
        .single();

      if (roundError || !round) {
        console.error('Round error:', roundError);
      } else if (round.tickets_sold >= round.max_tickets) {
        console.error('Round sold out');
      } else {
        // Get event details
        const { data: event, error: eventError } = await supabaseAdmin
          .from('events')
          .select('id, title, start_at, venue_id')
          .eq('id', eventId)
          .single();

        if (eventError || !event) {
          console.error('Event error:', eventError);
        } else {
          // Get user profile
          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('first_name, last_name, phone')
            .eq('id', user.id)
            .single();

          const fullName = profile ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') : user.email;
          
          // Generate ticket QR code
          const ticketQrCode = `TKT-${uuidv4().replace(/-/g, "").substring(0, 12).toUpperCase()}`;

          // Create the ticket (free)
          const { data: ticket, error: ticketError } = await supabaseAdmin
            .from('tickets')
            .insert({
              user_id: user.id,
              user_email: user.email,
              event_id: eventId,
              ticket_round_id: roundId,
              quantity: 1,
              unit_price: 0, // Free from loyalty
              service_fee: 0,
              total: 0,
              status: 'paid',
              paid_at: new Date().toISOString(),
              qr_code: ticketQrCode,
              full_name: fullName,
              phone: profile?.phone || null,
              is_loyalty_reward: true
            })
            .select()
            .single();

          if (ticketError) {
            console.error('Ticket creation error:', ticketError);
          } else {
            ticketId = ticket.id;
            
            // Create ticket attendee
            await supabaseAdmin
              .from('ticket_attendees')
              .insert({
                ticket_id: ticket.id,
                full_name: fullName,
                email: user.email,
                phone: profile?.phone || null,
                qr_code: ticketQrCode,
                is_primary: true
              });

            // Increment tickets_sold
            await supabaseAdmin
              .from('ticket_rounds')
              .update({ tickets_sold: round.tickets_sold + 1 })
              .eq('id', roundId);

            console.log('Loyalty reward ticket created:', ticket.id);
          }
        }
      }
    }

    // If it's a discount reward, store the discount info in redemption metadata
    if (reward.reward_type === 'discount') {
      const rewardValue = reward.reward_value as {
        discount_type?: 'percentage' | 'fixed';
        discount_value?: number;
        max_cart_value?: number;
        applies_to?: 'drinks' | 'tickets' | 'all';
      } | null;

      // Update redemption with discount details for use at checkout
      await supabaseAdmin
        .from('reward_redemptions')
        .update({
          metadata: {
            discount_type: rewardValue?.discount_type || 'percentage',
            discount_value: rewardValue?.discount_value || 10,
            max_cart_value: rewardValue?.max_cart_value,
            applies_to: rewardValue?.applies_to || 'all'
          }
        })
        .eq('id', redemption.id);
      
      console.log('Loyalty discount activated:', redemption.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        qrCode,
        redemptionId: redemption.id,
        expiresAt: expiresAt.toISOString(),
        orderId,
        ticketId
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in redeem-loyalty-reward:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
