-- Console CRM — une campagne des listes porte les couleurs de son thème
-- (vignette en couleurs de la liste « Campagnes »).
CREATE OR REPLACE FUNCTION public._crm_email_row(ec public.email_campaigns)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'id', ec.id, 'name', ec.name, 'subject', ec.subject, 'status', ec.status,
    'scheduled_at', ec.scheduled_at, 'sent_at', ec.sent_at, 'updated_at', ec.updated_at, 'created_at', ec.created_at,
    'audiences', COALESCE(ec.audiences_json, '[]'::jsonb), 'event_id', ec.event_id, 'template_kind', ec.template_kind,
    'total_recipients', ec.total_recipients,
    'has_content', jsonb_typeof(ec.blocks_json) = 'array' AND jsonb_array_length(ec.blocks_json) > 0,
    'paused_reason', ec.paused_reason,
    'theme', CASE WHEN jsonb_typeof(ec.theme_json) = 'object' THEN jsonb_build_object(
               'bg', ec.theme_json->>'bg', 'headerBg', ec.theme_json->>'headerBg', 'accent', ec.theme_json->>'accent',
               'divider', ec.theme_json->>'divider', 'tile', ec.theme_json->>'tile') END);
$$;
