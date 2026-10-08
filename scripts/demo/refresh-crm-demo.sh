#!/bin/bash
# Remet le compte démo Yuno CRM (crm@womber.fr) « à neuf » : tout est ancré sur
# la date du jour (prochaine soirée dans 3 jours, ventes jusqu'à maintenant,
# envois relatifs aux soirées). À lancer avant un call de vente, et au plus
# tard tous les 3-4 jours : le calendrier avance, les données semées non.
#
#   bash scripts/demo/refresh-crm-demo.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
# Une base partagée a parfois un verrou ou un interblocage passager : on réessaie.
q() {
  echo "→ $1"
  for essai in 1 2 3; do
    if supabase db query --linked -f "scripts/demo/$1" 2>&1 | grep -q '"_tag":"Error"'; then
      echo "   échec (essai $essai), nouvelle tentative…"; sleep 10
    else
      return 0
    fi
  done
  echo "   $1 a échoué trois fois"; return 1
}

node scripts/demo/create-crm-account.mjs
q seed-crm-demo.sql        # connexion, soirées, billets, offre
q seed-crm-sms.sql         # numéros, accords SMS, SMS partis, brouillons
q seed-crm-messages.sql    # e-mails partis (ouvertures, clics)
q seed-crm-nights.sql      # stocks, soirées à venir, brouillon + envoi programmé
q seed-crm-links.sql       # liens de partage et sources de vente
q seed-crm-guestlist.sql   # guest list Shotgun : invitations, liste gratuite, scans (après seed-crm-nights)
q seed-crm-analysis.sql    # analyse client : line-up, formats, délais d'achat, commandes à plusieurs, codes postaux, calcul (après la guest list)

echo "→ automatisations (modèles + recettes)"
npx esbuild scripts/demo/seed-crm-automations.ts --bundle --platform=node --format=esm \
  --alias:@=./src --external:./lib.mjs --outfile=scripts/demo/.auto.mjs --log-level=error
node scripts/demo/.auto.mjs; rm -f scripts/demo/.auto.mjs
# Cette passe dépasse les ~100 s de la passerelle de l'API (erreur 524 côté client) alors
# que le serveur va au bout : on attend la fin de la requête, puis on vérifie le résultat.
supabase db query --linked -f scripts/demo/seed-crm-automations.sql >/dev/null 2>&1 || true
echo "select count(*)::int as n from pg_stat_activity where state = 'active' and query like '%7 semaines d''automatisations%' and query not like '%pg_stat_activity%'" > "${TMPDIR:-/tmp}/wait-auto.sql"
for _ in $(seq 1 120); do
  n=$(supabase db query --linked -f "${TMPDIR:-/tmp}/wait-auto.sql" -o json 2>/dev/null | grep -o '"n": *[0-9]*' | grep -o '[0-9]*$' || echo 0)
  [ "${n:-0}" = "0" ] && break
  sleep 5
done

echo "→ contenu des e-mails (blocs du Studio)"
npx esbuild scripts/demo/seed-crm-email-content.ts --bundle --platform=node --format=esm \
  --alias:@=./src --external:./lib.mjs --outfile=scripts/demo/.content.mjs --log-level=error
node scripts/demo/.content.mjs; rm -f scripts/demo/.content.mjs

q seed-crm-extras.sql      # Yunits, inscriptions, équipe, imports, notifications, Instagram…
q seed-crm-journeys.sql    # scénarios : 2 en ligne (dont un SMS retenu faute de Yunits), 1 en pause, 1 brouillon
# Statistiques fraîches : après des milliers de lignes réécrites, la base garde de
# vieux plans et les analyses mettent 20 s au lieu de 4 tant qu'elle n'a pas relu les tables.
for t in external_tickets external_events crm_person_profile crm_night_profile tracked_links email_campaign_recipients email_campaign_events imported_contacts newsletter_subscriptions crm_signup_entries crm_scenario_runs crm_scenario_steps; do
  echo "analyze public.$t" > "${TMPDIR:-/tmp}/analyze.sql"
  supabase db query --linked -f "${TMPDIR:-/tmp}/analyze.sql" >/dev/null 2>&1 || true
done
echo "démo CRM à jour."
