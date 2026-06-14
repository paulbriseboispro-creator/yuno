import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { employeeId } = await req.json();

    if (!employeeId) {
      return new Response(
        JSON.stringify({ error: "Employee ID requis" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400 
        }
      );
    }

    // Verify the requesting user is an owner
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Non autorisé" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401 
        }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Non autorisé" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401 
        }
      );
    }

    // Create admin client
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Verify user is owner
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "owner");

    if (!roles || roles.length === 0) {
      return new Response(
        JSON.stringify({ error: "Accès réservé aux propriétaires" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 403 
        }
      );
    }

    // Get the owner's venue
    const { data: ownerVenue, error: venueError } = await supabaseAdmin
      .from("venues")
      .select("id")
      .eq("owner_id", user.id)
      .single();

    if (venueError || !ownerVenue) {
      console.error("Error finding owner's venue:", venueError);
      return new Response(
        JSON.stringify({ error: "Venue non trouvée" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404 
        }
      );
    }

    // Verify the target employee belongs to the owner's venue
    const { data: employeeProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("venue_id")
      .eq("id", employeeId)
      .single();

    if (profileError || !employeeProfile) {
      console.error("Error finding employee profile:", profileError);
      return new Response(
        JSON.stringify({ error: "Employé non trouvé" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404 
        }
      );
    }

    if (employeeProfile.venue_id !== ownerVenue.id) {
      console.error("Employee does not belong to owner's venue");
      return new Response(
        JSON.stringify({ error: "Cet employé n'appartient pas à votre établissement" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 403 
        }
      );
    }

    // Verify the target user has staff roles (barman, bouncer, or manager)
    const { data: employeeRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", employeeId)
      .in("role", ["barman", "bouncer", "manager"]);

    if (!employeeRoles || employeeRoles.length === 0) {
      return new Response(
        JSON.stringify({ error: "Cet utilisateur n'a pas de rôle staff" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 403 
        }
      );
    }

    console.log(`Removing staff access for employee ${employeeId} from venue ${ownerVenue.id}`);

    // 1. Delete all staff roles (barman, bouncer, manager)
    const { error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", employeeId)
      .in("role", ["barman", "bouncer", "manager"]);
    
    if (rolesError) {
      console.error("Error deleting roles:", rolesError);
      throw rolesError;
    }

    // 2. Delete manager permissions for this venue
    const { error: permError } = await supabaseAdmin
      .from("manager_permissions")
      .delete()
      .eq("user_id", employeeId)
      .eq("venue_id", ownerVenue.id);

    if (permError) {
      console.error("Error deleting manager permissions:", permError);
      // Non-fatal, continue
    }

    // 3. Dissociate profile from venue (clear PIN, venue_id, etc.)
    const { error: profileUpdateError } = await supabaseAdmin
      .from("profiles")
      .update({
        venue_id: null,
        employee_pin: null,
        is_click_collect_manager: false,
      })
      .eq("id", employeeId);

    if (profileUpdateError) {
      console.error("Error updating profile:", profileUpdateError);
      throw profileUpdateError;
    }

    console.log(`Successfully removed staff access for employee ${employeeId}`);

    return new Response(
      JSON.stringify({ success: true }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200 
      }
    );

  } catch (error: any) {
    console.error("Error in delete-employee:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Erreur serveur" }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500 
      }
    );
  }
});
