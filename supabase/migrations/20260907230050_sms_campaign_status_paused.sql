-- Campagnes SMS : un envoi de masse peut se mettre en pause (manuelle, ou faute
-- de crédits en cours de route) et reprendre là où il s'était arrêté. La
-- valeur d'enum vit dans sa propre migration : PostgreSQL refuse d'utiliser
-- une valeur d'enum ajoutée dans la transaction qui l'a créée, et la CLI
-- Supabase exécute chaque fichier dans une transaction.
ALTER TYPE public.sms_campaign_status ADD VALUE IF NOT EXISTS 'paused' AFTER 'sending';
