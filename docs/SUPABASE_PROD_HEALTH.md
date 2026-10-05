# Santé de la prod Supabase — panne du 05/10 et règles pour ne pas la refaire

Projet `fulawxvdlwtdlpkycixe` (« Yuno App »), région `eu-west-1`, organisation
`lccagejnotwizusoouei`. Rédigé le 2026-10-06 après la panne de la veille.

## Ce qui s'est passé (heures UTC, 05/10)

| Heure | Fait |
|---|---|
| 17:20 → 17:40 | API REST en 503 `PGRST002` et délais > 10 s : six tests SQL longs lancés par des sessions Claude concurrentes, une migration, les crons de la base de contacts. |
| ≈ 21:40 | La base tombe seule. Base, API REST, connexion (Auth) et stockage passent UNHEALTHY. Le site ne charge plus rien. |
| 22:41 | Diagnostic : la base répond mais presque sans requête en cours ; la machine ne répond plus (l'outil de métriques lui-même expire). |
| 22:46 | `contact-base-cache-refresh` (chaque minute) et `contact-engagement-sweep` (toutes les 10 min) mis en pause. Rien ne remonte seul. |
| 22:50 | Redémarrage du projet par l'API de gestion. |
| 22:55 | Tous les services au vert, API REST à ~0,2 s. |
| 23:10 | Les deux crons rallumés, plus espacés (migration `20261008120000`). |

## La cause : la machine est trop petite, le reste n'est qu'un déclencheur

La prod tourne sur l'**offre gratuite**, donc la plus petite machine (Nano).
Mesuré sur `/customer/v1/privileged/metrics` juste après le redémarrage :

| Mesure | Valeur | Ce que ça veut dire |
|---|---|---|
| RAM totale | **426 Mo** | Postgres, l'API REST, Auth, Storage, Realtime, pg_net et les exporteurs partagent ça. |
| `shared_buffers` | 224 Mo | Réglage posé par Supabase pour cette taille (`generated-optimizations.conf`), pas par nous. Plus de la moitié de la RAM. |
| Swap utilisé, à vide, 5 min après le démarrage | **≈ 390 Mo** | La machine swappe déjà sans aucune charge. |
| Défauts de page majeurs, en 5 min | 328 000 | Elle relit sans cesse sa mémoire sur le disque. |
| Chargement du cache de schéma de l'API REST | **21 s** | ≈ 1 400 fonctions SQL à lire. Pendant ce temps, l'API rend 503 `PGRST002`. |
| Taille de la base | 525 Mo | **Au-dessus du quota de 500 Mo de l'offre gratuite** (voir plus bas). |
| Disque `/data` | 2 Go, ~50 % utilisés | Pas le problème aujourd'hui. |

Dès qu'un pic arrive, la machine swappe jusqu'à ce que plus aucun service ne
réponde à temps aux contrôles de santé. Les déclencheurs connus :

- **Les tests SQL lourds en parallèle** (blocs `DO … RAISE 'SMOKE_OK'` qui
  jouent des RPC CRM, jusqu'à 3 min chacun), surtout quand plusieurs sessions
  Claude en lancent en même temps.
- **Chaque migration** suivie de `NOTIFY pgrst` : l'API REST recharge son cache
  de schéma (21 s à froid, plus sous charge) et rend des 503 pendant ce temps.
  Plusieurs migrations rapprochées = plusieurs coupures.
- **Les crons fréquents** : `contact-base-cache-refresh` tournait **chaque
  minute** (1 440 écritures par jour dans `cron.job_run_details`, plus une
  reconstruction de 12 000 lignes quand une portée était périmée).

## Le deuxième risque : la lecture seule

L'offre gratuite limite la **taille de la base à 500 Mo**. Au-delà, Supabase
peut passer le projet en **lecture seule** : plus aucun billet, aucune
inscription, aucun envoi ne s'écrit, les clients voient
`cannot execute INSERT in a read-only transaction` (SQLSTATE `25006`).
Au 06/10 la base fait 525 Mo et n'est pas encore en lecture seule
(`default_transaction_read_only = off`), mais rien ne garantit que ça dure.
Plus grosses tables : `cron.job_run_details` 56 Mo, `visitor_sessions` 54 Mo,
`email_campaign_events` 50 Mo, `email_campaign_recipients` 47 Mo.
Source : [Understanding Database and Disk Size](https://supabase.com/docs/guides/platform/database-size).

## La vraie correction (décision de Paul : c'est un paiement)

Passer l'organisation en **Pro** (25 $/mois, 10 $ de crédit de calcul inclus)
puis la machine en **Small** (2 Go de RAM, ~15 $/mois, donc ~5 $ de plus que le
crédit) ou au minimum **Micro** (1 Go, couvert par le crédit). Le Pro lève aussi
le quota de 500 Mo. Tant que ce n'est pas fait, la panne reviendra au prochain
pic, quoi qu'on optimise. Source :
[Compute and Disk](https://supabase.com/docs/guides/platform/compute-and-disk),
[Pricing](https://supabase.com/pricing).

Ne pas baisser `shared_buffers` à la main pour gagner de la RAM : c'est la valeur
de Supabase pour cette machine, la changer demande un redémarrage et déplace le
problème vers le disque, lui aussi limité.

## Règles pour toutes les sessions (agent compris)

1. **Pas de cron toutes les minutes.** Toutes les 5 minutes au plus fréquent,
   et seulement s'il ne fait rien quand il n'y a rien à faire.
2. **Un seul test SQL lourd à la fois sur la prod**, court, jamais en boucle,
   jamais pendant la migration d'une autre session. Regarder d'abord
   `pg_stat_activity` (requêtes `mgmt-api` actives). Préférer une transaction
   annulée courte à un `DO` qui joue dix RPC.
3. **Grouper les migrations** et ne lancer `NOTIFY pgrst, 'reload schema'` que
   si la migration change le schéma visible par l'API (table, colonne, fonction,
   droits). Un changement de cron, de données ou de réglage n'en a pas besoin.
4. **Ne pas ajouter de fonctions SQL « pour voir »** : chaque fonction allonge
   le chargement de 21 s de l'API REST.
5. **Ne jamais pousser `cron.job_run_details` ni les tables de mesure au-delà
   de leur purge** : `cron-history-purge` (30 j) et les purges `*-purge` sont ce
   qui garde la base sous le quota.

## Diagnostiquer (lecture seule, sans risque)

Le jeton `SUPABASE_ACCESS_TOKEN` et la clé `SUPABASE_SERVICE_ROLE_KEY` sont
dans `.env.local`.

```bash
# État de chaque service
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/fulawxvdlwtdlpkycixe/health?services=db&services=rest&services=auth&services=storage&services=realtime&services=pooler"
```

```bash
# Mémoire, swap et disque de la machine (expire quand elle est saturée : c'est déjà un diagnostic)
curl -s -u "service_role:$SUPABASE_SERVICE_ROLE_KEY" \
  "https://fulawxvdlwtdlpkycixe.supabase.co/customer/v1/privileged/metrics" \
  | grep -E '^node_memory_(MemTotal|MemAvailable|SwapTotal|SwapFree)_bytes|^pgrst_schema_cache_query_time'
```

Requêtes en cours, par l'API de gestion (`POST /v1/projects/{ref}/database/query`) :

```sql
SELECT application_name, state, count(*), max(now() - query_start)
  FROM pg_stat_activity GROUP BY 1, 2 ORDER BY 3 DESC;
```

Quand la machine est saturée, cet appel rend souvent
`Connection terminated due to connection timeout` : le relancer quelques fois.

## Réparer

1. Si une requête longue d'une session de test tourne, la laisser finir ou
   demander à Paul avant de l'annuler.
2. Mettre en pause les crons lourds le temps de la reprise :
   `SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname IN ('contact-base-cache-refresh', 'contact-engagement-sweep');`
3. Si les services ne remontent pas en quelques minutes, **redémarrer** :
   bouton « Restart project » du tableau de bord, ou
   `POST https://api.supabase.com/v1/projects/fulawxvdlwtdlpkycixe/restart`.
   Compter ~5 minutes : `RESTARTING`, puis base, Auth et Storage, puis l'API
   REST en dernier (son cache de schéma).
4. Vérifier : santé au vert, `GET /rest/v1/events?select=id&limit=1` en 200,
   `/auth/v1/health` en 200, puis rallumer les crons mis en pause.
