import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Consentement marketing pour UN club (ou UN organisateur), pas pour une soirée.
 *
 * Une personne qui a accepté de recevoir les offres du Club A n'a aucune raison
 * de le réaccepter à chaque réservation : le consentement RGPD n'a pas de durée
 * légale, il court jusqu'à son retrait (EDPB 05/2020 §110). En revanche il est
 * lié à un destinataire nommé : le consentement donné au Club A ne vaut jamais
 * pour le Club B (EDPB 05/2020 §65 ; CNIL, sanctions FORIOU et HUBSIDE.STORE).
 *
 * D'où le contrat de ce hook : « pour CE club, cette personne a-t-elle déjà dit
 * oui ? » — et rien de plus large.
 *
 * Volontairement limité aux utilisateurs connectés. La RPC ignore tout email
 * passé en paramètre et ne travaille que sur `auth.uid()` : autrement, taper une
 * adresse dans le checkout invité permettrait de tester si elle est cliente d'un
 * club donné. Un invité revoit donc une case vierge, ce qui reste correct — la
 * recocher est un acte positif, donc un consentement valide.
 */
/**
 * Texte exact des deux consentements, pour un club donné.
 *
 * Vit ici, et pas dans le composant, parce que deux appelants en dépendent :
 * l'écran qui l'affiche et le checkout qui l'archive comme preuve. Or la
 * preuve RGPD doit contenir le libellé RÉELLEMENT montré (EDPB 05/2020 §108 :
 * « a copy of the information that was presented to the data subject at that
 * time »). Si le checkout recomposait sa propre variante de la phrase, la
 * preuve divergerait de l'écran en silence — et précisément le jour où elle
 * sert. Une seule source, donc.
 */
export function marketingConsentWording(
  t: (key: string) => string,
  scopeName?: string | null,
): { email: string; sms: string } {
  // Sans nom de destinataire, on retombe sur la formulation générique plutôt
  // que d'afficher un « offres de  » bancal.
  const named = (scopeName ?? '').trim();
  return {
    email: named
      ? t('consent.emailOffersFrom').replace('{{name}}', named)
      : t('consent.emailOffers'),
    sms: named
      ? t('consent.smsOffersFrom').replace('{{name}}', named)
      : t('consent.smsOffers'),
  };
}

export interface MarketingConsentScope {
  /** Club concerné. `null` pour une soirée portée par un organisateur seul. */
  venueId: string | null;
  /** Organisateur concerné, quand la soirée n'a pas de club. */
  organizerUserId?: string | null;
  /** Nom affiché dans la case à cocher — le destinataire DOIT être nommé. */
  scopeName: string;
}

interface ConsentState {
  emailGranted: boolean;
  smsGranted: boolean;
  loading: boolean;
}

const IDLE: ConsentState = { emailGranted: false, smsGranted: false, loading: false };

export function useMarketingConsent(scope: MarketingConsentScope | null) {
  const { user } = useAuth();
  const [state, setState] = useState<ConsentState>(IDLE);

  const venueId = scope?.venueId ?? null;
  const organizerUserId = scope?.organizerUserId ?? null;
  const hasScope = Boolean(venueId || organizerUserId);

  const refresh = useCallback(async () => {
    if (!user || !hasScope) {
      setState(IDLE);
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));

    const { data, error } = await supabase.rpc('get_my_marketing_consent', {
      p_venue_id: venueId,
      p_organizer_user_id: organizerUserId,
    });

    if (error) {
      // Échouer en « on redemande » plutôt qu'en « on suppose que oui » : une
      // case affichée en trop est une gêne, une case masquée à tort est un
      // envoi sans base légale.
      console.error('[marketing-consent] lecture impossible', error);
      setState(IDLE);
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    setState({
      emailGranted: row?.email_opted_in === true,
      smsGranted: row?.sms_opted_in === true,
      loading: false,
    });
  }, [user, hasScope, venueId, organizerUserId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Retrait immédiat, depuis l'écran où le consentement a été donné.
   * EDPB 05/2020 §114 : le retrait doit être possible « via the same electronic
   * interface » — un lien en pied d'email ne suffit pas. §116 : un retrait non
   * conforme invalide le mécanisme de consentement tout entier, donc la liste.
   */
  const withdraw = useCallback(
    async (channel: 'email' | 'sms', wordingText: string, locale: string, source: string) => {
      if (!user || !hasScope) return false;

      const { error } = await supabase.rpc('withdraw_my_marketing_consent', {
        p_channel: channel,
        p_venue_id: venueId,
        p_organizer_user_id: organizerUserId,
        p_wording_text: wordingText,
        p_locale: locale,
        p_source: source,
      });

      if (error) {
        console.error('[marketing-consent] retrait impossible', error);
        return false;
      }

      setState((prev) => ({
        ...prev,
        emailGranted: channel === 'email' ? false : prev.emailGranted,
        smsGranted: channel === 'sms' ? false : prev.smsGranted,
      }));
      return true;
    },
    [user, hasScope, venueId, organizerUserId],
  );

  return { ...state, refresh, withdraw };
}

/**
 * Trace la preuve d'un consentement donné (RGPD art. 7(1)).
 *
 * EDPB 05/2020 §108 exige de pouvoir montrer COMMENT, QUAND et avec QUELLE
 * information il a été recueilli, et précise qu'il ne suffit PAS de renvoyer à
 * « a correct configuration of the respective website ». Montrer le code source
 * ne prouve donc rien : on enregistre le texte exact affiché à cette personne,
 * dans sa langue, à cet instant.
 *
 * Best-effort : ne jamais faire échouer un paiement parce que la trace n'a pas
 * pu s'écrire. Une commande perdue coûte plus cher qu'une ligne de journal.
 */
export async function recordConsentGrant(params: {
  channel: 'email' | 'sms';
  wordingText: string;
  wordingKey?: string;
  venueId: string | null;
  organizerUserId?: string | null;
  email?: string | null;
  phoneE164?: string | null;
  locale: string;
  source: string;
}): Promise<void> {
  if (!params.venueId && !params.organizerUserId) return;

  try {
    const { error } = await supabase.rpc('record_marketing_consent_grant', {
      p_channel: params.channel,
      p_wording_text: params.wordingText,
      p_venue_id: params.venueId,
      p_organizer_user_id: params.organizerUserId ?? null,
      p_email: params.email ?? null,
      p_phone_e164: params.phoneE164 ?? null,
      p_wording_key: params.wordingKey ?? null,
      p_locale: params.locale,
      p_source: params.source,
    });
    if (error) console.error('[marketing-consent] preuve non enregistrée', error);
  } catch (err) {
    console.error('[marketing-consent] preuve non enregistrée', err);
  }
}
