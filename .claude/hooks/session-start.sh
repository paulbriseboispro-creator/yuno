#!/bin/bash
# Démarrage d'une session Claude Code dans le cloud : installe les dépendances
# npm pour que `npm run build`, `npm run lint` et `npm test` marchent d'emblée.
# Ne fait rien en local (VS Code / Mac) : node_modules y est déjà là.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# `npm install` plutôt que `npm ci` : il réutilise le node_modules mis en cache
# avec le conteneur au lieu de tout effacer à chaque session.
npm install --no-audit --no-fund --no-update-notifier --loglevel=error
