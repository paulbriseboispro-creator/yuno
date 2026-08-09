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

# 4. Construire le bundle web (dist/) puis le synchroniser dans
#    ios/App/App/public + cabler les plugins natifs. Equivaut au script
#    npm "cap:sync".
npm run build
npx cap sync ios

echo "ci_post_clone (client): node_modules + dist + cap sync OK"
