-- ─────────────────────────────────────────────────────────────────────────────
-- Export « audience pub » (custom audiences Meta / Google / TikTok).
--
-- Renvoie UNIQUEMENT les contacts qui ont donné un consentement marketing au
-- club : opt-in newsletter (newsletter_subscriptions.opted_in) ∪ consentement
-- SMS (venue_sms_contacts non désabonnés). Jamais la base clients brute —
-- exporter vers une régie publicitaire est un transfert à un tiers, la ligne
-- de consentement est la porte.
--
-- Gate : owner du club ou super admin seulement (PAS les managers — export
-- PII en masse). Le front (page Clients) en fait un CSV côté client.
-- Le pays est dérivé du préfixe E.164 (utile au geo-targeting des régies).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.export_venue_ad_audience(p_venue_id text)
RETURNS TABLE(email text, phone text, first_name text, last_name text, country text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (is_super_admin() OR is_venue_owner(auth.uid(), p_venue_id)) THEN
    RAISE EXCEPTION 'Not authorized for venue %' , p_venue_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH sms AS (
    SELECT lower(COALESCE(vsc.email, '')) AS em, vsc.phone_e164, vsc.full_name
      FROM public.venue_sms_contacts vsc
     WHERE vsc.venue_id = p_venue_id AND vsc.unsubscribed = false AND vsc.phone_e164 IS NOT NULL
  ),
  news AS (
    SELECT lower(ns.email) AS em, ns.user_id
      FROM public.newsletter_subscriptions ns
     WHERE ns.venue_id = p_venue_id AND ns.opted_in = true
  ),
  merged AS (
    -- Opt-in newsletter, enrichi du téléphone si le même email a aussi consenti au SMS
    SELECT n.em,
           (SELECT s.phone_e164 FROM sms s WHERE s.em = n.em LIMIT 1) AS phone_e164,
           pr.first_name, pr.last_name
      FROM news n
      LEFT JOIN public.profiles pr ON pr.id = n.user_id
    UNION
    -- Consentement SMS pur (pas d'opt-in newsletter au même email)
    SELECT s.em,
           s.phone_e164,
           NULLIF(split_part(COALESCE(s.full_name, ''), ' ', 1), ''),
           NULLIF(regexp_replace(COALESCE(s.full_name, ''), '^\S+\s*', ''), '')
      FROM sms s
     WHERE s.em = '' OR s.em NOT IN (SELECT n2.em FROM news n2)
  )
  SELECT
    NULLIF(m.em, '')::text,
    m.phone_e164::text,
    m.first_name::text,
    m.last_name::text,
    (CASE
      WHEN m.phone_e164 LIKE '+33%' THEN 'FR'
      WHEN m.phone_e164 LIKE '+34%' THEN 'ES'
      WHEN m.phone_e164 LIKE '+44%' THEN 'GB'
      WHEN m.phone_e164 LIKE '+49%' THEN 'DE'
      WHEN m.phone_e164 LIKE '+39%' THEN 'IT'
      WHEN m.phone_e164 LIKE '+32%' THEN 'BE'
      WHEN m.phone_e164 LIKE '+41%' THEN 'CH'
      WHEN m.phone_e164 LIKE '+351%' THEN 'PT'
      WHEN m.phone_e164 LIKE '+31%' THEN 'NL'
      WHEN m.phone_e164 LIKE '+352%' THEN 'LU'
      WHEN m.phone_e164 LIKE '+377%' THEN 'MC'
      WHEN m.phone_e164 LIKE '+1%' THEN 'US'
      ELSE ''
    END)::text AS country
  FROM merged m
  WHERE NULLIF(m.em, '') IS NOT NULL OR m.phone_e164 IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.export_venue_ad_audience(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.export_venue_ad_audience(text) TO authenticated;
