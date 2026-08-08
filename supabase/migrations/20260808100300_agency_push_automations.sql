-- ─────────────────────────────────────────────────────────────────────────────
-- Notifications RP : push AUTO opt-in par agence + colonne agency_id sur les
-- campagnes + clé registre super admin.
--
-- Miroir de venue_push_automations (20260709180000), mais keyé agency_id et avec
-- une seule automatisation pour l'instant : 'new_event' — quand une soirée
-- rattachée à l'agence (par contrat actif) devient visible, pousser aux abonnés
-- de l'agence. ÉTEINT par défaut (opt-in) : aucune agence n'envoie tant qu'elle
-- n'a pas activé le toggle depuis /agency-app/push. Le dispatch vit dans
-- _shared/push-automations.ts (dispatchNewEventAgencyPushes), câblé au cron
-- process-scheduled-campaigns.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agency_push_automations (
  agency_id      uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  automation_key text NOT NULL CHECK (automation_key IN ('new_event')),
  enabled        boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, automation_key)
);

ALTER TABLE public.agency_push_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agency owners manage own push automations"
  ON public.agency_push_automations FOR ALL
  USING (public.is_agency_owner(auth.uid(), agency_id))
  WITH CHECK (public.is_agency_owner(auth.uid(), agency_id));

-- ── Campagnes push scopées agence ────────────────────────────────────────────
-- push_campaigns portait venue_id (campagne club) ; on ajoute agency_id pour les
-- campagnes RP (manuelles + auto). L'historique de /agency-app/push filtre sur
-- cette colonne ; l'auth (is_agency_owner) et le cap 4/24h aussi.
ALTER TABLE public.push_campaigns
  ADD COLUMN IF NOT EXISTS agency_id uuid REFERENCES public.agencies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_push_campaigns_agency
  ON public.push_campaigns(agency_id) WHERE agency_id IS NOT NULL;

-- ── Clé registre plateforme (kill switch super admin) ────────────────────────
-- Catégorie 'engagement', comme 'new_event'. Ligne présente + enabled=true : le
-- master switch est ouvert ; le vrai opt-in reste au niveau de chaque agence.
INSERT INTO public.platform_notification_settings (notification_key, category) VALUES
  ('agency_new_event', 'engagement')
ON CONFLICT (notification_key) DO NOTHING;
