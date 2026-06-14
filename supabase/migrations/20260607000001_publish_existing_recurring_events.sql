-- Publish auto-generated recurring events that are stuck in draft
-- and backfill flyer_url from their parent template
UPDATE affiliate_events ae
SET
  status = 'published',
  flyer_url = COALESCE(ae.flyer_url, art.flyer_url),
  external_ticket_url = COALESCE(ae.external_ticket_url, art.publication_url)
FROM affiliate_recurring_templates art
WHERE ae.recurring_template_id = art.id
  AND ae.status = 'draft'
  AND art.is_active = true;
