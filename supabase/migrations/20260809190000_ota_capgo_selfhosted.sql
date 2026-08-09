-- ============================================================================
-- OTA Capgo self-hosted — infrastructure des mises à jour Over-The-Air.
-- ============================================================================
-- Le plugin @capgo/capacitor-updater interroge NOS edge functions (pas le cloud
-- Capgo payant) pour savoir s'il existe un nouveau bundle web à télécharger.
-- Les bundles (zip de dist/) vivent dans le Storage Supabase, bucket public
-- `ota-bundles`. Les 3 tables ci-dessous sont l'état serveur :
--
--   * ota_channels  — les canaux de diffusion par app (production, beta).
--   * ota_bundles   — un bundle publié = 1 ligne (app_id + channel + version).
--   * ota_devices   — registre des appareils + override de canal (opt-in beta).
--   * ota_stats     — télémétrie brute envoyée par le plugin (statsUrl).
--
-- SÉCURITÉ : ces tables sont de l'INFRA, jamais lues/écrites par l'app cliente.
-- RLS activée, AUCUNE policy anon/authenticated → invisible depuis la clé anon.
-- Seules les edge functions (service_role, qui bypass RLS) et le script de
-- publication (service_role) y touchent. Le bucket est public en LECTURE
-- uniquement (le zip = code web déjà public sur yunoapp.eu) ; l'écriture passe
-- par le service_role du script `npm run ota:publish`.
--
-- Idempotent (IF NOT EXISTS / ON CONFLICT partout). Aucune table métier touchée.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Canaux de diffusion.
--    production = canal par défaut, verrouillé (allow_self_set = false : un
--    appareil ne peut pas s'y auto-inscrire, il y est par défaut).
--    beta = canal de test, allow_self_set = true (un appareil peut demander à
--    le rejoindre via setChannel(), ou on l'y force côté serveur via
--    ota_devices.channel).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ota_channels (
  app_id          text    NOT NULL,
  name            text    NOT NULL,
  allow_self_set  boolean NOT NULL DEFAULT false,
  is_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, name)
);

-- ----------------------------------------------------------------------------
-- 2. Bundles publiés.
--    native_version = la MARKETING_VERSION de la coquille native pour laquelle
--    ce bundle a été buildé (ex. "1.0"). GARDE-FOU ANTI-DOWNGRADE : l'endpoint
--    de mise à jour ne sert un bundle QUE si native_version == version_build de
--    l'appareil. Un bundle web "1.0.x" ne peut donc jamais atterrir sur une
--    future app native "2.0" (celle-ci n'accepte que des bundles "2.0.x").
--    active = pointeur du bundle courant pour (app_id, channel). Un seul actif
--    à la fois par (app_id, channel) — le rollback = ré-activer une ligne
--    antérieure.
--    url/checksum : le plugin télécharge `url` et vérifie que le SHA-256 du zip
--    == `checksum` (sinon rejet + rollback auto via notifyAppReady).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ota_bundles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          text    NOT NULL,
  channel         text    NOT NULL DEFAULT 'production',
  version         text    NOT NULL,
  native_version  text    NOT NULL,
  url             text    NOT NULL,
  checksum        text    NOT NULL,          -- SHA-256 hex du zip
  size_bytes      bigint,
  active          boolean NOT NULL DEFAULT false,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, channel, version)
);

CREATE INDEX IF NOT EXISTS ota_bundles_lookup_idx
  ON public.ota_bundles (app_id, channel, native_version, active, created_at DESC);

-- ----------------------------------------------------------------------------
-- 3. Registre des appareils.
--    Rempli à chaque check de mise à jour (updateUrl). Sert à :
--      - connaître le parc (quelle version tourne où),
--      - forcer un appareil sur un canal (channel != null = override serveur,
--        prioritaire sur le defaultChannel envoyé par l'app).
--    device_id est l'id opaque généré par le plugin (pas un user_id).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ota_devices (
  device_id       text NOT NULL,
  app_id          text NOT NULL,
  channel         text,                       -- override de canal (NULL = défaut)
  version_name    text,                        -- bundle web actuellement installé
  native_version  text,                        -- version native (version_build)
  platform        text,
  plugin_version  text,
  custom_id       text,
  first_seen      timestamptz NOT NULL DEFAULT now(),
  last_seen       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, app_id)
);

CREATE INDEX IF NOT EXISTS ota_devices_last_seen_idx
  ON public.ota_devices (app_id, last_seen DESC);

-- ----------------------------------------------------------------------------
-- 4. Télémétrie brute (statsUrl). Best-effort, purge libre. On garde le grain
--    fin pour diagnostiquer un déploiement raté (download_fail, update_fail...).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ota_stats (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id        text,
  app_id           text,
  action           text,
  version_name     text,
  old_version_name text,
  platform         text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ota_stats_app_time_idx
  ON public.ota_stats (app_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 5. RLS : verrouillage total côté client. Aucune policy → la clé anon ne voit
--    rien. service_role (edge functions + script de publication) bypass la RLS.
-- ----------------------------------------------------------------------------
ALTER TABLE public.ota_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ota_bundles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ota_devices  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ota_stats    ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 6. Seed des canaux pour les deux apps (client B2C + Pro).
-- ----------------------------------------------------------------------------
INSERT INTO public.ota_channels (app_id, name, allow_self_set, is_default) VALUES
  ('eu.yunoapp.app', 'production', false, true),
  ('eu.yunoapp.app', 'beta',       true,  false),
  ('eu.yunoapp.pro', 'production', false, true),
  ('eu.yunoapp.pro', 'beta',       true,  false)
ON CONFLICT (app_id, name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 7. Bucket Storage public pour les zips de bundles. Lecture publique (le code
--    web est déjà public) ; écriture réservée au service_role du script.
--    file_size_limit 200 Mo (un bundle Yuno ~= quelques Mo, large marge).
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('ota-bundles', 'ota-bundles', true, 209715200)
ON CONFLICT (id) DO UPDATE
  SET public = true, file_size_limit = 209715200;
