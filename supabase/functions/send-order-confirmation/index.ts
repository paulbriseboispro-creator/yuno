import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { EmailLanguage } from "../_shared/email-branding.ts";
import { buildOrderConfirmation } from "../_shared/email-templates.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
}

interface OrderConfirmationRequest {
  orderId: string;
  orderNumber?: string;
  email: string;
  firstName?: string;
  items: OrderItem[];
  total: number;
  venueName: string;
  venueAddress?: string;
  isGuest?: boolean;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { orderId, orderNumber, email, firstName, items, total, venueName, venueAddress, isGuest }: OrderConfirmationRequest = await req.json();
    
    // SECURITY: Validate orderId format
    if (!orderId || typeof orderId !== "string" || orderId.length < 10) {
      console.error("Invalid orderId format:", orderId);
      return new Response(
        JSON.stringify({ error: "Invalid order ID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // SECURITY: Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      console.error("Invalid email format");
      return new Response(
        JSON.stringify({ error: "Invalid email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create admin client to verify order exists
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // SECURITY: Verify order exists and matches the email
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id, user_email, status, user_id, order_number")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      console.error("Order not found:", orderId);
      return new Response(
        JSON.stringify({ error: "Order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // SECURITY: Verify email matches order
    if (order.user_email !== email) {
      console.error("Email mismatch for order:", orderId);
      return new Response(
        JSON.stringify({ error: "Email mismatch" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // SECURITY: Only send confirmation for paid orders
    if (order.status !== "paid") {
      console.error("Order not paid:", orderId);
      return new Response(
        JSON.stringify({ error: "Order not paid" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch user's preferred language
    let lang: EmailLanguage = 'fr';
    if (order.user_id) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('preferred_language')
        .eq('id', order.user_id)
        .single();
      
      if (profile?.preferred_language && ['en', 'es', 'fr'].includes(profile.preferred_language)) {
        lang = profile.preferred_language as EmailLanguage;
      }
    }

    console.log("Sending order confirmation for validated order:", orderId, "in language:", lang);

    const appBaseUrl = Deno.env.get("APP_BASE_URL") || "https://yunoapp.eu";

    // Render via the new shared editorial builder. Map the order's line items
    // (already validated above) into the builder's {k: label, v: price} rows.
    const builtItems = (items || []).map((item) => ({
      k: `${item.quantity || 1} × ${item.name}`,
      v: `€${(item.price ?? 0).toFixed(2)}`,
    }));
    const orderRef = order.order_number || orderNumber || orderId.slice(0, 8);
    const pickupInfo = lang === 'fr'
      ? 'Récupère au bar avec ta référence.'
      : lang === 'es'
      ? 'Recoge en la barra con tu referencia.'
      : 'Pick up at the bar with your reference.';
    const mail = buildOrderConfirmation({
      lang,
      firstName: firstName || undefined,
      venueName,
      items: builtItems,
      total: `€${(total ?? 0).toFixed(2)}`,
      reference: orderRef,
      pickupInfo,
      orderUrl: `${appBaseUrl}/order-confirmation?type=order&id=${orderId}`,
    });
    const html = mail.html;

    const rawFrom = Deno.env.get('RESEND_FROM_EMAIL');
    const from = rawFrom
      ? (rawFrom.includes('<') ? rawFrom : `Yuno <${rawFrom}>`)
      : 'Yuno <noreply@yunoapp.eu>';

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: mail.subject,
        html,
      }),
    });

    if (!emailResponse.ok) {
      const error = await emailResponse.text();
      console.error("Resend API error:", error);
      throw new Error(`Resend API error: ${error}`);
    }

    const data = await emailResponse.json();
    console.log("Order confirmation email sent successfully:", data);

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error sending order confirmation email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
