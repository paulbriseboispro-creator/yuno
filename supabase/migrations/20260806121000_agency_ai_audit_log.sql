-- ============================================================
-- Journal d'audit de l'assistant IA agence (miroir d'owner_ai_audit_log).
-- Chaque tool d'écriture exécuté par agency-assistant y laisse une trace.
-- Écrit uniquement par le service role (l'edge function) — pas de policy INSERT.
-- ============================================================

CREATE TABLE public.agency_ai_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  agency_id uuid NOT NULL,
  tool_name text NOT NULL,
  tool_args jsonb DEFAULT '{}'::jsonb,
  result text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.agency_ai_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agency owners can view their audit logs"
ON public.agency_ai_audit_log FOR SELECT TO authenticated
USING (public.is_agency_owner(auth.uid(), agency_id));
