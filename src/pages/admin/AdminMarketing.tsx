// ───────────────────────────────────────────────────────────────────────────
// Marketing Yuno : les éditeurs partagés avec la Console des pros, montés en
// portée « plateforme » (les deux colonnes de portée à NULL en base, un
// créneau que seule la RLS du super admin ouvre). Ce n'est PAS un second
// système : c'est la troisième portée du moteur qui sert déjà les clubs et
// les organisateurs (Email Studio, file d'envoi, gouverneur de quota, liste
// de suppression). La liste des campagnes, la base et le quota sont dans
// src/admin/comms/Campaigns.tsx. Voir docs/PLATFORM_MARKETING.md.
// ───────────────────────────────────────────────────────────────────────────

import StudioShell from '@/components/email-studio/StudioShell';
import CampaignReport from '@/components/campaigns/CampaignReport';
import EmailAutomationsPanel from '@/components/campaigns/EmailAutomationsPanel';
import type { StudioScope } from '@/components/email-studio/hooks';

const PLATFORM_SCOPE: StudioScope = { kind: 'platform', name: 'Yuno' };
const EMAIL_BASE = '/admin/comms/email';

/** Éditeur (Email Studio) en portée plateforme. */
export function AdminMarketingEmailEditor() {
  return <StudioShell basePath={EMAIL_BASE} scope={PLATFORM_SCOPE} />;
}

/** Rapport de campagne en portée plateforme. */
export function AdminMarketingEmailReport() {
  return <CampaignReport basePath={EMAIL_BASE} scope={PLATFORM_SCOPE} />;
}

/** Modèle d'email de Yuno, ouvert seul dans le studio (même contrat que le club). */
export function AdminMarketingTemplateEditor() {
  return <StudioShell basePath={EMAIL_BASE} scope={PLATFORM_SCOPE} templateMode />;
}

/**
 * Recettes automatiques de Yuno lui-même : bienvenue, merci d'être venu, on t'a
 * manqué, panier abandonné, reconquête — dans les modèles Yuno, vers le
 * registre de consentement plateforme uniquement. Même moteur, mêmes règles
 * que les clubs ; quand une recette Yuno est allumée, l'email historique
 * équivalent (send-missed-you) s'efface : une soirée, un message.
 */
export function AdminMarketingAutomations() {
  return <EmailAutomationsPanel basePath={EMAIL_BASE} scope={PLATFORM_SCOPE} />;
}
