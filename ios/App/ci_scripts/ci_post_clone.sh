#!/bin/sh

# ci_post_clone.sh — Xcode Cloud (app CLIENT Yuno, eu.yunoapp.app)
#
# Xcode Cloud clone le depot SANS node_modules (gitignore) et SANS le dossier
# web App/public (genere par `cap sync`, non versionne). Or les plugins
# Capacitor sont des packages Swift LOCAUX qui pointent dans node_modules/.
# Sans ce script, la resolution des packages SPM echoue au tout debut du build
# avec "the package at '.../node_modules/@capacitor/...' cannot be accessed".
#
# Ce script s'execute juste apres le clone, avant la resolution SPM et le build.

set -e

# 1. Node n'est pas preinstalle sur les runners Xcode Cloud. On epingle la 22
#    pour coller au .nvmrc du projet (Vite 8 exige Node >= 20).
brew install node@22
export PATH="$(brew --prefix node@22)/bin:$PATH"

# 2. Se placer a la racine du depot clone (Xcode Cloud expose ce chemin).
cd "$CI_PRIMARY_REPOSITORY_PATH"

# 3. Recreer node_modules a l'identique du lockfile -> rend les packages SPM
#    locaux accessibles.
npm ci

# 4. Variables VITE_* du build web — depuis le REPO, plus jamais depuis l'UI
#    Xcode Cloud. Le 25/08/2026, Apple a rejete le build 28 : les variables du
#    workflow avaient disparu et le bundle embarque, compile sans
#    VITE_SUPABASE_URL, mourait au lancement ("supabaseUrl is required.").
. ./scripts/ci-web-env.sh

# 5. Construire le bundle web (dist/) puis le synchroniser dans
#    ios/App/App/public + cabler les plugins natifs. Equivaut au script
#    npm "cap:sync".
npm run build

# 6. GARDE-FOU : un bundle sans la config Supabase bakee est une app morte a
#    l'installation neuve (les appareils existants sont sauves par l'OTA, un
#    reviewer Apple ne l'est pas). On echoue le build ICI plutot que chez Apple.
_SUPA_HOST=$(printf '%s' "$VITE_SUPABASE_URL" | sed 's|https://||;s|/.*||')
if [ -z "$_SUPA_HOST" ] || ! grep -rq "$_SUPA_HOST" dist/assets/; then
  echo "ERREUR: l'URL Supabase ($_SUPA_HOST) n'est pas bakee dans dist/assets — bundle inutilisable." >&2
  exit 1
fi
echo "verification bundle: URL Supabase bakee OK ($_SUPA_HOST)"

npx cap sync ios

echo "ci_post_clone (client): node_modules + dist + cap sync OK"
