-- 1. Add plan_source column on venue_subscriptions
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_plan_source') THEN
    CREATE TYPE public.subscription_plan_source AS ENUM ('paid', 'collab_auto');
  END IF;
END$$;

ALTER TABLE public.venue_subscriptions
  ADD COLUMN IF NOT EXISTS plan_source public.subscription_plan_source NOT NULL DEFAULT 'paid';

-- 2. Trigger that auto-activates 'collab' plan when a partnership becomes 'active'
CREATE OR REPLACE FUNCTION public.activate_collab_plan_on_partnership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing RECORD;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN
    -- Already active, nothing to do
    RETURN NEW;
  END IF;

  SELECT subscription_plan, status, plan_source
  INTO v_existing
  FROM public.venue_subscriptions
  WHERE venue_id = NEW.venue_id;

  IF NOT FOUND THEN
    -- Brand-new venue: open it on collab tier (no payment, no expiry attached to the subscription row).
    INSERT INTO public.venue_subscriptions (venue_id, subscription_plan, status, plan_source)
    VALUES (NEW.venue_id, 'collab', 'active', 'collab_auto');
  ELSIF v_existing.subscription_plan IN ('core', 'collab')
        AND v_existing.plan_source = 'paid'
        AND v_existing.subscription_plan = 'core' THEN
    -- Free / core club discovered through an organizer: upgrade silently to collab tier.
    UPDATE public.venue_subscriptions
    SET subscription_plan = 'collab',
        status = 'active',
        plan_source = 'collab_auto',
        updated_at = now()
    WHERE venue_id = NEW.venue_id;
  END IF;
  -- Paid clubs (essential/pro/elite) keep their plan untouched.

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_activate_collab_plan ON public.venue_organizer_partnerships;
CREATE TRIGGER trg_activate_collab_plan
AFTER INSERT OR UPDATE OF status ON public.venue_organizer_partnerships
FOR EACH ROW
EXECUTE FUNCTION public.activate_collab_plan_on_partnership();