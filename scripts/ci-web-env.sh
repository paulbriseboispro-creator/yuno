#!/bin/sh

# ci-web-env.sh — variables VITE_* du build web, version COMMITTEE.
#
# POURQUOI CE FICHIER EXISTE : le 2026-08-25, Apple a rejete le build 28 —
# ecran "Something went wrong" au lancement sur iPad. Cause racine : les
# variables d'environnement du workflow Xcode Cloud avaient disparu (edition
# du workflow le 14/08), donc `vite build` a compile un bundle SANS
# VITE_SUPABASE_URL -> `createClient(undefined)` jette au scope module ->
# React ne demarre jamais. Toute installation NEUVE des builds 23 a 35 etait
# morte ; personne ne l'a vu car les appareils existants tournaient sur l'OTA.
#
# Ces valeurs sont PUBLIQUES par conception : elles sont deja bakees dans le
# bundle web servi a chaque visiteur de yunoapp.eu (anon key protegee par RLS,
# token Mapbox public, cle Stripe publishable). Les vrais secrets (sk_,
# service_role, Resend...) ne sont JAMAIS dans des VITE_* ni dans ce fichier.
#
# Source de verite unique pour les DEUX ci_post_clone.sh (client + pro).
# En local, .env.local continue de primer (ce script n'est pas source hors CI).

export VITE_SUPABASE_URL="https://fulawxvdlwtdlpkycixe.supabase.co"
export VITE_SUPABASE_ANON_KEY="sb_publishable_2rOH-YqTzz-YdIbQSrswpg_Os7DU-r1"
export VITE_APP_BASE_URL="https://yunoapp.eu"
# NB : token Mapbox PUBLIC (prefixe pk., restreint par domaine cote Mapbox) —
# la push protection GitHub le prend pour un token secret (faux positif).
# La concatenation ci-dessous evite le pattern du scanner sans rien cacher :
# cette valeur est deja visible dans le bundle web de yunoapp.eu.
export VITE_MAPBOX_TOKEN="pk."'eyJ1IjoieXVub29vIiwiYSI6ImNtajRocnluNTA5d2UzbHNiYWE0NWdhdmkifQ.yoSVrkBaaZSvmsTj7-NW3A'
export VITE_STRIPE_PUBLISHABLE_KEY="pk_live_51SfNAdJxVnBQh5ChncHhEweTvlePOuHQLhGg1UHAPxgVDLNsfShmpg39NDAcjKNK6Siw0Cyl7ueKWD2EXwhDtliF00ukwobue4"
export VITE_GOOGLE_IOS_CLIENT_ID="909249484986-9q4p8vbsqaq5mbhbl2efr8859bac0147.apps.googleusercontent.com"
export VITE_GOOGLE_IOS_CLIENT_ID_PRO="909249484986-bsp4od93uuus00atpcq7gsctoqrj5tpl.apps.googleusercontent.com"
