-- Repasse en draft les soirées récurrentes published/featured sans lien billetterie
-- Seules les soirées avec external_ticket_url sont réellement visibles côté app client

UPDATE affiliate_events
SET status = 'draft'
WHERE recurring_template_id IS NOT NULL
  AND status IN ('published', 'featured')
  AND (external_ticket_url IS NULL OR external_ticket_url = '');
