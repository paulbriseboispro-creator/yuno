-- Ajouter un champ pour le barman référent du click & collect
ALTER TABLE public.profiles
ADD COLUMN is_click_collect_manager boolean DEFAULT false;

COMMENT ON COLUMN public.profiles.is_click_collect_manager IS 'Indique si cet employé est le responsable du click & collect';