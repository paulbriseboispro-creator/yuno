-- Supprime les soirées récurrentes en draft dont la date dépasse
-- la fenêtre advance_days de leur template (créées trop en avance avant le fix).
-- Les soirées published/featured avec lien sont conservées quelle que soit leur date.

DELETE FROM affiliate_events ae
WHERE ae.recurring_template_id IS NOT NULL
  AND ae.status = 'draft'
  AND ae.event_date > CURRENT_DATE + (
    SELECT rt.advance_days
    FROM affiliate_recurring_templates rt
    WHERE rt.id = ae.recurring_template_id
  ) * INTERVAL '1 day';
