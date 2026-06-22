import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import QRCode from "https://esm.sh/qrcode@1.5.3";
import { 
  EmailLanguage, 
  t, 
  wrapEmailWithBranding,
  escapeHtml 
} from "../_shared/email-branding.ts";

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

    // Generate QR code as SVG (works in Deno without canvas)
    const appBaseUrl = Deno.env.get("APP_BASE_URL") || "https://yunoapp.eu";
    const qrCodeUrl = `${appBaseUrl}/order/${orderId}/qr`;
    const qrCodeSvg = await QRCode.toString(qrCodeUrl, {
      type: 'svg',
      width: 300,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#FFFFFF"
      }
    });
    // Convert SVG to base64 data URL for email embedding
    const qrCodeDataUrl = `data:image/svg+xml;base64,${btoa(qrCodeSvg)}`;

    // SECURITY: Escape all user-provided values before embedding in HTML
    const safeFirstName = escapeHtml(firstName) || '';
    const safeVenueName = escapeHtml(venueName);
    const safeVenueAddress = escapeHtml(venueAddress);

    // Build items HTML with escaped names and safe price handling
    const itemsHtml = (items || []).map(item => `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #1a1a1a; color: #fff;">
          <strong>${escapeHtml(item.name)}</strong>
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #1a1a1a; text-align: center; color: #a0a0a0;">
          x${item.quantity || 1}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #1a1a1a; text-align: right; color: #fff;">
          €${(item.price ?? 0).toFixed(2)}
        </td>
      </tr>
    `).join('');

    const emailContent = `
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 30px; text-align: center;">
        <div style="font-size: 24px; font-weight: bold; color: #fff; margin-bottom: 8px;">${safeVenueName}</div>
        <h1 style="color: white; margin: 0; font-size: 22px;">${t('order.confirmed', lang)}</h1>
      </div>

      <!-- Content -->
      <div style="padding: 30px;">
        <p style="color: #fff; font-size: 16px; margin-bottom: 20px;">
          ${safeFirstName ? `${t('order.greeting', lang)} ${safeFirstName}!` : `${t('order.greeting', lang)}!`}
        </p>
        
        <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6;">
          ${t('order.orderConfirmed', lang)} <strong style="color:#dc2626;">${safeVenueName}</strong>.
          ${safeVenueAddress ? `<br>${t('order.address', lang)}: ${safeVenueAddress}` : ''}
        </p>

        <!-- Order Details -->
        <div style="margin: 30px 0;">
          <h2 style="color: #fff; font-size: 18px; margin-bottom: 15px; border-bottom: 2px solid #dc2626; padding-bottom: 10px;">
            ${t('order.orderDetails', lang)}
          </h2>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background-color: #1a1a1a;">
                <th style="padding: 12px; text-align: left; color: #888; font-size: 14px;">${t('order.article', lang)}</th>
                <th style="padding: 12px; text-align: center; color: #888; font-size: 14px;">${t('order.qty', lang)}</th>
                <th style="padding: 12px; text-align: right; color: #888; font-size: 14px;">${t('order.price', lang)}</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2" style="padding: 15px; text-align: right; font-weight: bold; font-size: 16px; color: #fff;">
                  ${t('order.total', lang)}:
                </td>
                <td style="padding: 15px; text-align: right; font-weight: bold; font-size: 18px; color: #dc2626;">
                  €${(total ?? 0).toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <!-- QR Code -->
        <div style="text-align: center; margin: 30px 0; padding: 20px; background-color: #fff; border-radius: 12px;">
          <h3 style="color: #0a0a0a; margin-bottom: 15px;">${t('order.yourQRCode', lang)}</h3>
          <img src="${qrCodeDataUrl}" alt="Order QR Code" style="max-width: 200px; margin: 0 auto; display: block;" />
          <p style="color: #666; font-size: 12px; margin-top: 10px;">${t('order.orderNumber', lang)}${order.order_number || orderNumber || orderId.slice(0, 8)}</p>
          ${isGuest ? `
            <div style="margin-top: 15px; padding: 12px; background: #f5f5f5; border-radius: 8px;">
              <a href="${appBaseUrl}/claim?order=${order.order_number || orderNumber || ''}" style="color: #dc2626; text-decoration: none; font-weight: bold; font-size: 14px;">
                ${lang === 'en' ? 'Find my order' : lang === 'es' ? 'Encontrar mi pedido' : 'Retrouver ma commande'} →
              </a>
            </div>
          ` : ''}
        </div>

        <!-- How to Collect -->
        <div style="background: #1a1a1a; padding: 20px; border-radius: 12px; margin: 30px 0; border-left: 4px solid #dc2626;">
          <h3 style="color: #fff; margin-top: 0; margin-bottom: 15px; font-size: 16px;">
            ${t('order.howToCollect', lang)}
          </h3>
          <ol style="color: #a0a0a0; line-height: 1.8; margin: 0; padding-left: 20px;">
            <li style="margin-bottom: 8px;">
              <strong style="color:#fff;">${t('order.step1Title', lang)}</strong> ${t('order.step1Desc', lang)}
            </li>
            <li style="margin-bottom: 8px;">
              <strong style="color:#fff;">${t('order.step2Title', lang)}</strong> ${t('order.step2Desc', lang)} ${safeVenueName}.
            </li>
            <li style="margin-bottom: 8px;">
              <strong style="color:#fff;">${t('order.step3Title', lang)}</strong> ${t('order.step3Desc', lang)}
            </li>
            <li>
              <strong style="color:#fff;">${t('order.step4Title', lang)}</strong> ${t('order.step4Desc', lang)}
            </li>
          </ol>
        </div>

        <!-- Tips -->
        <div style="background-color: rgba(245, 158, 11, 0.1); border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0;">
          <p style="margin: 0; color: #f59e0b; font-size: 14px;">
            <strong>${t('order.tip', lang)}</strong> ${t('order.tipContent', lang)}
          </p>
        </div>

        <!-- Invoice Download -->
        <div style="text-align: center; margin: 24px 0; padding: 20px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px;">
          <p style="color: #fff; font-size: 16px; font-weight: 600; margin: 0 0 8px;">${t('invoice.sectionTitle', lang)}</p>
          <p style="color: #999; font-size: 13px; margin: 0 0 16px;">${t('invoice.description', lang)}</p>
          <a href="${appBaseUrl}/order-confirmation?type=order&id=${orderId}" 
             style="display: inline-block; background: #dc2626; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-weight: 600; font-size: 14px;">
            ${t('invoice.downloadCta', lang)} →
          </a>
        </div>

        <!-- Footer -->
        <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
          <p style="color: #666; font-size: 12px; margin: 5px 0;">
            ${t('order.thanks', lang)}
          </p>
        </div>
      </div>
    `;

    const html = wrapEmailWithBranding(emailContent, lang, venueName);

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
        subject: `${t('order.confirmed', lang)} - ${safeVenueName}`,
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
