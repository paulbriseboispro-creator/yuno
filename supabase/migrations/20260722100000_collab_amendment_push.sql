-- =============================================================================
-- Avenant de collaboration : déclarer la clé de notification automatique.
--
-- Constat (Paul) : « je n'ai même pas reçu de notification en tant qu'orga ».
-- Un avenant proposé n'apparaissait que si le partenaire pensait à ouvrir sa
-- page Collaborations — or c'est une demande de SIGNATURE, elle doit venir à lui.
--
-- La clé passe par le registre super admin (/admin/notifications) comme toute
-- notification automatique : elle est donc désactivable par la plateforme,
-- traçable dans auto_push_events, et localisée FR/EN/ES par sendAutoPush.
-- Audience 'pro' : c'est un sujet de gestion, il ne sort jamais dans l'app client.
-- =============================================================================
INSERT INTO public.platform_notification_settings (notification_key, category) VALUES
  ('collab_amendment_proposed', 'transactional'),
  ('collab_amendment_signed',   'transactional')
ON CONFLICT (notification_key) DO NOTHING;
