// Per-merchant fee configuration (pricing refonte Phase 2).
//
// Whether the merchant absorbs the Yuno commission instead of adding it on top of
// the fan's checkout total. Default false = fan pays (current behavior).
//
// Seller-of-record rule (doc §9.2): for a venue or co-event sale the CLUB (venue)
// governs, so its flag wins. Only when there is NO venue (organizer-only sale) does
// the ORGANIZER's flag apply.

// deno-lint-ignore no-explicit-any
type AnySupabase = any;

export async function getAbsorbYunoFees(
  supabase: AnySupabase,
  venueId: string | null | undefined,
  organizerUserId?: string | null,
): Promise<boolean> {
  if (venueId) {
    const { data } = await supabase
      .from("venues")
      .select("absorb_yuno_fees")
      .eq("id", venueId)
      .maybeSingle();
    return data?.absorb_yuno_fees === true;
  }
  if (organizerUserId) {
    const { data } = await supabase
      .from("organizer_profiles")
      .select("absorb_yuno_fees")
      .eq("user_id", organizerUserId)
      .maybeSingle();
    return data?.absorb_yuno_fees === true;
  }
  return false;
}
