-- Apple Wallet — passes émis + enregistrements devices (web service PassKit).
-- Phase 2 du chantier iOS natif : passes statiques billets/VIP, servis par le
-- routeur /wallet de send-ticket-confirmation (webServiceURL permanent, D2).
-- Les pushes de mise à jour (Phase 5) réutiliseront wallet_pass_registrations.
--
-- RLS activée SANS policy : accès service-role uniquement (le front passe
-- toujours par l'edge function, qui contrôle la propriété avant d'émettre).

CREATE TABLE IF NOT EXISTS public.wallet_passes (
  serial text PRIMARY KEY,                       -- 't-<ticket_uuid>' | 'v-<reservation_uuid>'
  pass_type text NOT NULL CHECK (pass_type IN ('ticket', 'vip', 'credits')),
  reference_id uuid NOT NULL,                    -- tickets.id / table_reservations.id
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,  -- NULL = achat invité
  auth_token text NOT NULL,                      -- token lien email + « ApplePass » du web service
  lang text NOT NULL DEFAULT 'fr',
  voided boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()  -- bump en P5 à chaque changement de contenu
);

CREATE INDEX IF NOT EXISTS wallet_passes_reference_idx ON public.wallet_passes (reference_id);
CREATE INDEX IF NOT EXISTS wallet_passes_user_idx ON public.wallet_passes (user_id);

ALTER TABLE public.wallet_passes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.wallet_pass_registrations (
  device_library_id text NOT NULL,               -- identifiant Wallet du device
  pass_serial text NOT NULL REFERENCES public.wallet_passes(serial) ON DELETE CASCADE,
  push_token text NOT NULL,                      -- token APNs du pass (topic = Pass Type ID)
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_library_id, pass_serial)
);

CREATE INDEX IF NOT EXISTS wallet_pass_registrations_serial_idx
  ON public.wallet_pass_registrations (pass_serial);

ALTER TABLE public.wallet_pass_registrations ENABLE ROW LEVEL SECURITY;
