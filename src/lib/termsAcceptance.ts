// CGV : version en vigueur, et la trace de leur acceptation (record-terms-acceptance).
// Lu par la case à cocher (TermsAcceptance) ET par la phrase posée sous le bouton
// de paiement billet (TermsNotice), qui vaut acceptation au tap.
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export const SESSION_KEY_PREFIX = 'yuno_terms_accepted_';
export const DEFAULT_TERMS_URL = '/legal/cgv-utilisateurs';

export interface TermsSettings { version: string; url: string }

// Une lecture par session : la version des CGV ne change pas pendant un achat.
let termsSettingsPromise: Promise<TermsSettings> | null = null;

export function fetchTermsSettings(): Promise<TermsSettings> {
  if (!termsSettingsPromise) {
    termsSettingsPromise = (async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('terms_version, terms_url')
        .eq('id', 'global')
        .maybeSingle();
      return { version: data?.terms_version || 'v1.0.0', url: data?.terms_url || DEFAULT_TERMS_URL };
    })().catch(() => {
      termsSettingsPromise = null;
      return { version: 'v1.0.0', url: DEFAULT_TERMS_URL };
    });
  }
  return termsSettingsPromise;
}

/** Version et adresse des CGV en vigueur (adresse par défaut tant que la lecture court). */
export function useTermsSettings(): TermsSettings | null {
  const [settings, setSettings] = useState<TermsSettings | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchTermsSettings().then((s) => { if (alive) setSettings(s); });
    return () => { alive = false; };
  }, []);
  return settings;
}

/**
 * Trace l'acceptation des CGV (`record-terms-acceptance`) : version, contexte,
 * compte ou email invité, horodatage serveur. C'est la PREUVE de l'acceptation,
 * qu'elle vienne d'une case cochée ou du clic sur le bouton qui annonce « En
 * continuant, vous acceptez les conditions de vente » (aucun texte français
 * n'impose la case, Code civil 1119 : elle ne sert qu'à prouver). Ne lève jamais.
 */
export async function recordTermsAcceptance({ userId, guestEmail, context }: {
  userId?: string | null;
  guestEmail?: string | null;
  context: 'drink' | 'ticket' | 'table';
}): Promise<void> {
  try {
    const { version } = await fetchTermsSettings();
    if (!userId && sessionStorage.getItem(`${SESSION_KEY_PREFIX}${version}`) === 'true') return;
    await supabase.functions.invoke('record-terms-acceptance', {
      body: { terms_version: version, context, guest_email: !userId ? guestEmail : undefined },
    });
    if (!userId) sessionStorage.setItem(`${SESSION_KEY_PREFIX}${version}`, 'true');
  } catch (err) {
    console.error('Terms acceptance recording error:', err);
  }
}
