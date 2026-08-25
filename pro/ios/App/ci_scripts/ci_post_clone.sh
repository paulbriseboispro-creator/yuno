#!/bin/sh

# ci_post_clone.sh — Xcode Cloud (app PRO Yuno, eu.yunoapp.pro)
#
# Difference avec l'app client : la coquille Pro a son PROPRE node_modules
# (plugins natifs Capacitor), tout en partageant le bundle web de la racine
# (webDir ../dist). Il faut donc DEUX `npm ci` :
#   1. racine  -> permet `npm run build` (bundle web dist/ partage)
#   2. pro/    -> rend les packages SPM locaux (@capacitor/*) accessibles au
#                projet pro/ios, sinon la resolution SPM echoue au tout debut
#                du build avec "the package at '.../node_modules/@capacitor/...'
#                cannot be accessed".
#
# Xcode Cloud clone le depot SANS node_modules (gitignore) et SANS le dossier
# web pro/ios/App/App/public (genere par `cap sync`). Ce script s'execute juste
# apres le clone, avant la resolution SPM et le build. Equivaut au script npm
# "cap:sync:pro", plus les deux installs de dependances.

set -e

# 1. Node n'est pas preinstalle sur les runners Xcode Cloud. On epingle la 22
#    pour coller au .nvmrc du projet (Vite 8 exige Node >= 20).
brew install node@22
export PATH="$(brew --prefix node@22)/bin:$PATH"

# 2. Se placer a la racine du depot clone (Xcode Cloud expose ce chemin).
cd "$CI_PRIMARY_REPOSITORY_PATH"

# 3. Dependances racine, puis construire le bundle web partage (dist/).
npm ci

# 3bis. Variables VITE_* du build web — depuis le REPO, plus jamais depuis
#    l'UI Xcode Cloud (cf. scripts/ci-web-env.sh : le build client 28 a ete
#    rejete par Apple car compile sans VITE_SUPABASE_URL, app morte au boot).
. ./scripts/ci-web-env.sh

npm run build

# 3ter. GARDE-FOU : echouer ICI si la config Supabase n'est pas bakee, plutot
#    que livrer une app Pro morte a l'installation neuve.
_SUPA_HOST=$(printf '%s' "$VITE_SUPABASE_URL" | sed 's|https://||;s|/.*||')
if [ -z "$_SUPA_HOST" ] || ! grep -rq "$_SUPA_HOST" dist/assets/; then
  echo "ERREUR: l'URL Supabase ($_SUPA_HOST) n'est pas bakee dans dist/assets — bundle inutilisable." >&2
  exit 1
fi
echo "verification bundle: URL Supabase bakee OK ($_SUPA_HOST)"

# 4. Dependances natives de la coquille Pro, puis synchroniser dist/ dans
#    pro/ios/App/App/public + cabler les plugins natifs. `cap sync` s'execute
#    depuis pro/ pour lire pro/capacitor.config.ts (webDir ../dist, appId
#    eu.yunoapp.pro).
cd pro
npm ci
npx cap sync ios

echo "ci_post_clone (pro): node_modules racine + dist + node_modules pro + cap sync OK"
