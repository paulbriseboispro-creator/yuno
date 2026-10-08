-- Lint (plpgsql_check) des fonctions des lots 2 à 4, comme `supabase db lint`,
-- dans une transaction annulée : l'extension n'est pas gardée.
DO $smoke$
DECLARE
  f   text;
  r   record;
  v   jsonb := '[]'::jsonb;
BEGIN
  CREATE EXTENSION IF NOT EXISTS plpgsql_check;
  FOREACH f IN ARRAY ARRAY[
    'public._crm_score_targets(text,text,uuid,jsonb,boolean)', 'public._crm_score_build(jsonb)',
    'public._crm_logit_fit(integer,double precision,integer,double precision[],double precision)',
    'public._crm_score_eval()', 'public.crm_score_compute(text,uuid)', 'public._crm_an_pvalue(text,numeric,numeric,numeric)',
    'public._crm_an_engine(text,uuid,timestamp with time zone,jsonb,boolean)', 'public.crm_first_return_sms_collect()',
    'public.crm_automations__core(text,uuid,text)', 'public.crm_night_targets(text,uuid,uuid)'] LOOP
    FOR r IN SELECT * FROM plpgsql_check_function_tb(f::regprocedure) LOOP
      v := v || jsonb_build_array(jsonb_build_object('f', f, 'level', r.level, 'msg', r.message, 'line', r.lineno));
    END LOOP;
  END LOOP;
  RAISE EXCEPTION 'SMOKE_OK %', v::text;
END
$smoke$;
