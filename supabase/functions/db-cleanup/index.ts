import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { authorizeCronRequest } from "../_shared/cron-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function cleanupExpiredOrders(supabase: any): Promise<{ deletedCount: number }> {
  const { data: orders } = await supabase
    .from("orders")
    .select("id, events!inner(end_at)")
    .eq("status", "paid")
    .is("served_at", null);

  const now = new Date();
  const toDelete: string[] = [];

  for (const order of orders || []) {
    const event = Array.isArray(order.events) ? order.events[0] : order.events;
    if (event?.end_at && now > new Date(event.end_at)) toDelete.push(order.id);
  }

  if (toDelete.length > 0) {
    await supabase.from("orders").delete().in("id", toDelete);
  }

  console.log(`Deleted ${toDelete.length} expired orders`);
  return { deletedCount: toDelete.length };
}

async function cleanupExpiredInvoices(supabase: any): Promise<{ deletedCount: number }> {
  const { data } = await supabase
    .from("invoices")
    .delete()
    .lt("expires_at", new Date().toISOString())
    .select("id");

  const deletedCount = data?.length || 0;
  console.log(`Cleaned up ${deletedCount} expired invoices`);
  return { deletedCount };
}

async function archiveExpiredOrders(supabase: any): Promise<void> {
  const { error } = await supabase.rpc("archive_expired_event_orders");
  if (error) throw error;
  console.log("Successfully archived expired orders");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const cronAuth = await authorizeCronRequest(req);
  if (!cronAuth.ok) {
    return new Response(JSON.stringify({ error: cronAuth.message }), {
      status: cronAuth.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const type: string = body.type || "orders";

    let result: Record<string, unknown> = {};

    if (type === "invoices") {
      result = await cleanupExpiredInvoices(supabase);
    } else if (type === "archive-orders") {
      await archiveExpiredOrders(supabase);
      result = { message: "Expired orders archived successfully" };
    } else {
      result = await cleanupExpiredOrders(supabase);
    }

    return new Response(
      JSON.stringify({ success: true, type, ...result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[DB-CLEANUP] Error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
