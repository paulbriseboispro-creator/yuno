/**
 * Intégration Meta (Pixel + Conversions API, connexion Facebook Login for
 * Business) — interrupteur « en construction ».
 *
 * Tant qu'il est à `false`, la carte Meta des dashboards club et organisateur
 * (Réglages → Intégrations) affiche un état « En construction » et n'autorise
 * ni connexion, ni saisie : le pro voit ce qui arrive, rien ne part. La carte
 * de la plateforme (/admin/system, super admin) reste pleinement active pour
 * que Yuno teste le bout en bout avec son propre pixel.
 *
 * À passer à `true` une fois la checklist de docs/META_GO_LIVE_GUIDE.md
 * terminée : app Meta en mode Live, App Review accordée, secrets posés,
 * `meta-connect` déployée, parcours « Connecter avec Facebook » validé sur
 * un vrai compte pro.
 */
export const META_INTEGRATION_LIVE = false;
