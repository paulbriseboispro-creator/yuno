
-- Validation triggers (not CHECK constraints — needed for trim/regex flexibility)

CREATE OR REPLACE FUNCTION public.validate_public_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  email_re text := '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';
BEGIN
  -- Generic helpers
  IF TG_TABLE_NAME = 'launch_waitlist' THEN
    IF NEW.email IS NULL OR length(NEW.email) > 254 OR NEW.email !~ email_re THEN
      RAISE EXCEPTION 'Invalid email';
    END IF;
    IF length(coalesce(NEW.first_name,'')) > 100 OR length(coalesce(NEW.last_name,'')) > 100 THEN
      RAISE EXCEPTION 'Name too long';
    END IF;
    IF length(coalesce(NEW.city,'')) > 120 THEN
      RAISE EXCEPTION 'City too long';
    END IF;
    IF length(coalesce(NEW.phone,'')) > 30 THEN
      RAISE EXCEPTION 'Phone too long';
    END IF;
  ELSIF TG_TABLE_NAME = 'event_waitlist' THEN
    IF NEW.email IS NULL OR length(NEW.email) > 254 OR NEW.email !~ email_re THEN
      RAISE EXCEPTION 'Invalid email';
    END IF;
    IF length(coalesce(NEW.full_name,'')) > 150 THEN
      RAISE EXCEPTION 'Name too long';
    END IF;
  ELSIF TG_TABLE_NAME = 'ticket_waitlist' THEN
    IF NEW.email IS NULL OR length(NEW.email) > 254 OR NEW.email !~ email_re THEN
      RAISE EXCEPTION 'Invalid email';
    END IF;
  ELSIF TG_TABLE_NAME = 'feedback_issues' THEN
    IF length(coalesce(NEW.title,'')) = 0 OR length(NEW.title) > 200 THEN
      RAISE EXCEPTION 'Invalid title';
    END IF;
    IF length(coalesce(NEW.description,'')) > 5000 THEN
      RAISE EXCEPTION 'Description too long';
    END IF;
  ELSIF TG_TABLE_NAME = 'promoter_clicks' THEN
    IF length(coalesce(NEW.user_agent,'')) > 500 THEN
      NEW.user_agent := substr(NEW.user_agent, 1, 500);
    END IF;
    IF length(coalesce(NEW.referrer,'')) > 1000 THEN
      NEW.referrer := substr(NEW.referrer, 1, 1000);
    END IF;
    IF length(coalesce(NEW.source,'')) > 100 THEN
      RAISE EXCEPTION 'Source too long';
    END IF;
  ELSIF TG_TABLE_NAME = 'attribution_touchpoints' THEN
    IF length(coalesce(NEW.touch_type,'')) > 50 THEN
      RAISE EXCEPTION 'touch_type too long';
    END IF;
    IF length(coalesce(NEW.source,'')) > 100
       OR length(coalesce(NEW.medium,'')) > 100
       OR length(coalesce(NEW.campaign,'')) > 200
       OR length(coalesce(NEW.referrer_domain,'')) > 200 THEN
      RAISE EXCEPTION 'Tracking field too long';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_launch_waitlist ON public.launch_waitlist;
CREATE TRIGGER validate_launch_waitlist BEFORE INSERT ON public.launch_waitlist
FOR EACH ROW EXECUTE FUNCTION public.validate_public_insert();

DROP TRIGGER IF EXISTS validate_event_waitlist ON public.event_waitlist;
CREATE TRIGGER validate_event_waitlist BEFORE INSERT ON public.event_waitlist
FOR EACH ROW EXECUTE FUNCTION public.validate_public_insert();

DROP TRIGGER IF EXISTS validate_ticket_waitlist ON public.ticket_waitlist;
CREATE TRIGGER validate_ticket_waitlist BEFORE INSERT ON public.ticket_waitlist
FOR EACH ROW EXECUTE FUNCTION public.validate_public_insert();

DROP TRIGGER IF EXISTS validate_feedback_issues ON public.feedback_issues;
CREATE TRIGGER validate_feedback_issues BEFORE INSERT ON public.feedback_issues
FOR EACH ROW EXECUTE FUNCTION public.validate_public_insert();

DROP TRIGGER IF EXISTS validate_promoter_clicks ON public.promoter_clicks;
CREATE TRIGGER validate_promoter_clicks BEFORE INSERT ON public.promoter_clicks
FOR EACH ROW EXECUTE FUNCTION public.validate_public_insert();

DROP TRIGGER IF EXISTS validate_attribution_touchpoints ON public.attribution_touchpoints;
CREATE TRIGGER validate_attribution_touchpoints BEFORE INSERT ON public.attribution_touchpoints
FOR EACH ROW EXECUTE FUNCTION public.validate_public_insert();
