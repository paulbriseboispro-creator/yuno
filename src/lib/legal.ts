// Sécurisation juridique — helpers clickwrap.
//
// Chaque acceptation légale (CGU au signup, conditions pro + engagement de
// confidentialité à l'onboarding, engagement de confidentialité à l'entrée
// d'un aperçu démo) est enregistrée en base via la RPC record_legal_acceptance
// avec la VERSION du document accepté et un hash SHA-256 de son contenu :
// c'est le faisceau de preuves (qui / quoi / quelle version / quand / d'où).
//
// Quand un document légal change de façon substantielle, incrémenter sa version
// ici : le LegalConsentGate redemandera l'acceptation aux pros existants.

import { supabase } from '@/integrations/supabase/client';

export type LegalDocType =
  | 'cgu'
  | 'cgv_users'
  | 'terms_pro'
  | 'confidentiality'
  | 'demo_confidentiality'
  | 'privacy';

export const LEGAL_VERSIONS: Record<LegalDocType, string> = {
  cgu: '2026-07-06',
  cgv_users: '2026-07-06',
  terms_pro: '2026-07-06',
  confidentiality: '2026-07-06',
  demo_confidentiality: '2026-07-06',
  privacy: '2026-07-06',
};

/** SHA-256 hex du contenu accepté (preuve de la version exacte du texte). */
export async function sha256Hex(text: string): Promise<string | null> {
  try {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    // SubtleCrypto indisponible (contexte non sécurisé) : on enregistre sans hash.
    return null;
  }
}

interface RecordAcceptanceOptions {
  docType: LegalDocType;
  /** Contenu exact du document accepté — hashé pour preuve. */
  docContent?: string;
  email?: string;
  context?: Record<string, unknown>;
}

/**
 * Enregistre une acceptation légale. Ne lève jamais : l'échec d'enregistrement
 * (réseau, RLS) ne doit pas bloquer le parcours — la case cochée reste
 * l'assentiment, l'enregistrement est la preuve. Retourne true si tracé.
 */
export async function recordLegalAcceptance(opts: RecordAcceptanceOptions): Promise<boolean> {
  try {
    const hash = opts.docContent ? await sha256Hex(opts.docContent) : null;
    const { error } = await supabase.rpc('record_legal_acceptance' as never, {
      p_doc_type: opts.docType,
      p_doc_version: LEGAL_VERSIONS[opts.docType],
      p_doc_hash: hash,
      p_email: opts.email ?? null,
      p_context: opts.context ?? {},
    } as never);
    if (error) {
      console.warn('[legal] acceptance not recorded:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[legal] acceptance not recorded:', e);
    return false;
  }
}

/**
 * L'utilisateur connecté a-t-il déjà accepté la version COURANTE de ce document ?
 * Fail-open (true) en cas d'erreur : un pépin réseau ne doit pas murer un dashboard.
 */
export async function hasAcceptedLegal(docType: LegalDocType): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('has_accepted_legal' as never, {
      p_doc_type: docType,
      p_doc_version: LEGAL_VERSIONS[docType],
    } as never);
    if (error) return true;
    return Boolean(data);
  } catch {
    return true;
  }
}
