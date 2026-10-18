# LINK-01 — capture d'une story sur un lien de partage, au banc (2026-10-18T13:06Z)

`crm_link_create` et `tracked_links` lus sur la prod (`node scripts/crm-bench/link01.mjs dump`, lecture seule) ; portes d'accès remplacées par `true` (la séparation entre espaces est l'affaire d'`isolation.mjs`). « Avant » = la définition de la prod du 18/10 ; « Après » = `20261024100100_crm_link_create_image_regex.sql`.

- L'expression d'avant, seule : `2201B invalid regular expression: invalid repetition count(s)` (même erreur que sur la prod). Bornée à 255 : true (Postgres accepte jusqu'à 255).
- L'expression d'après contre la règle voulue (« `https://` puis 1 à 480 caractères sans espace ») sur 400 chaînes tirées au hasard : **0 écart(s)**, 72 gardées.

**13 / 13 cas conformes à l'attendu, avant ET après.**

Smoke de répétition sur la prod (`scripts/crm-bench/smoke/link01.sql`), joué au banc sur la base « après » : ✓ `SMOKE_OK {"capture": "gardée", "url_http": "écartée sans erreur", "lien_avec_capture": "Story smoke"}`.

| Cas | URL envoyée | Avant (prod) | Après (migration) |
|---|---|---|---|
| sans capture (NULL) | NULL | créé, sans capture | créé, sans capture |
| capture du Storage Yuno | https://fulawxvdlwtdlpkycixe.supabase.co… (106 car.) | erreur 2201B (invalid regular expression: invalid repetition count(s)) | créé, capture gardée |
| URL avec accents | `https://exemple.fr/été/story.jpg` | erreur 2201B (invalid regular expression: invalid repetition count(s)) | créé, capture gardée |
| 488 caractères (limite) | https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa… (488 car.) | erreur 2201B (invalid regular expression: invalid repetition count(s)) | créé, capture gardée |
| 489 caractères | https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa… (489 car.) | erreur 2201B (invalid regular expression: invalid repetition count(s)) | créé, sans capture |
| http:// | `http://exemple.fr/story.jpg` | erreur 2201B (invalid regular expression: invalid repetition count(s)) | créé, sans capture |
| https:// seul | `https://` | erreur 2201B (invalid regular expression: invalid repetition count(s)) | créé, sans capture |
| chaîne vide | `` | erreur 2201B (invalid regular expression: invalid repetition count(s)) | créé, sans capture |
| espace dans l’URL | `https://exemple.fr/ma story.jpg` | erreur 2201B (invalid regular expression: invalid repetition count(s)) | créé, sans capture |
| espace devant | ` https://exemple.fr/story.jpg` | erreur 2201B (invalid regular expression: invalid repetition count(s)) | créé, sans capture |
| retour à la ligne | `https://exemple.fr/a\nb.jpg` | erreur 2201B (invalid regular expression: invalid repetition count(s)) | créé, sans capture |
| tabulation | `https://exemple.fr/a\tb.jpg` | erreur 2201B (invalid regular expression: invalid repetition count(s)) | créé, sans capture |
| HTTPS en capitales | `HTTPS://exemple.fr/story.jpg` | erreur 2201B (invalid regular expression: invalid repetition count(s)) | créé, sans capture |
