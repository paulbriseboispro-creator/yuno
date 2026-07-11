// Signeur .pkpass — Deno natif, zéro dépendance Node-only.
// Un .pkpass = zip contenant pass.json + images + manifest.json (SHA-1 hex de
// chaque fichier) + signature (CMS/PKCS#7 DÉTACHÉE du manifest, signée par le
// cert Pass Type ID, chaîne WWDR G4 embarquée).
//
// Secrets attendus (Supabase) : WALLET_PASS_CERT_PEM, WALLET_PASS_KEY_PEM
// (clé RSA non chiffrée), WALLET_WWDR_PEM (G4 UNIQUEMENT — G2/G3/G5/G6 font
// échouer la validation Wallet), WALLET_PASS_TYPE_ID, WALLET_TEAM_ID.
//
// Validé par spike local (openssl cms -verify + iPhone) le 2026-07-11.
import forge from 'npm:node-forge@1.3.1';
import { zipSync } from 'npm:fflate@0.8.2';

export interface WalletCerts {
  /** Cert Pass Type ID (PEM). */
  signerCertPem: string;
  /** Clé privée RSA du cert, non chiffrée (PEM PKCS#8 ou PKCS#1). */
  signerKeyPem: string;
  /** Apple WWDR G4 (PEM). */
  wwdrPem: string;
}

/** Lit les certs depuis les secrets Supabase. Throw si un secret manque. */
export function walletCertsFromEnv(): WalletCerts {
  const signerCertPem = Deno.env.get('WALLET_PASS_CERT_PEM');
  const signerKeyPem = Deno.env.get('WALLET_PASS_KEY_PEM');
  const wwdrPem = Deno.env.get('WALLET_WWDR_PEM');
  if (!signerCertPem || !signerKeyPem || !wwdrPem) {
    throw new Error('Wallet certs missing (WALLET_PASS_CERT_PEM / WALLET_PASS_KEY_PEM / WALLET_WWDR_PEM)');
  }
  return { signerCertPem, signerKeyPem, wwdrPem };
}

async function sha1Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Signature CMS détachée du manifest (SHA-256, attributs signés standard). */
function signManifest(manifestBytes: Uint8Array, certs: WalletCerts): Uint8Array {
  const cert = forge.pki.certificateFromPem(certs.signerCertPem);
  const wwdr = forge.pki.certificateFromPem(certs.wwdrPem);
  const key = forge.pki.privateKeyFromPem(certs.signerKeyPem);

  const p7 = forge.pkcs7.createSignedData();
  // forge travaille en « binary strings » — le manifest est de l'ASCII pur.
  p7.content = forge.util.createBuffer(forge.util.binary.raw.encode(manifestBytes));
  p7.addCertificate(wwdr);
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign({ detached: true });

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.binary.raw.decode(der);
}

/**
 * Assemble et signe un .pkpass complet.
 * @param passJson  contenu de pass.json (déjà localisé)
 * @param assets    images du pass (icon.png, icon@2x.png, logo.png…)
 */
export async function buildPkpass(
  passJson: Record<string, unknown>,
  assets: Record<string, Uint8Array>,
  certs: WalletCerts,
): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {
    'pass.json': new TextEncoder().encode(JSON.stringify(passJson)),
    ...assets,
  };

  const manifest: Record<string, string> = {};
  for (const [name, data] of Object.entries(files)) {
    manifest[name] = await sha1Hex(data);
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const signature = signManifest(manifestBytes, certs);

  // Niveau 0 (store) : les PNG sont déjà compressés, et Wallet accepte les
  // deux — on privilégie la vitesse de génération dans l'edge function.
  return zipSync(
    { ...files, 'manifest.json': manifestBytes, signature },
    { level: 0 },
  );
}
