// Déclaration sur l'honneur de majorité ("honor-system age declaration").
//
// L'âge réel ne peut pas être vérifié en ligne. L'acheteur certifie sur l'honneur être
// majeur (18+), et l'ÉTABLISSEMENT effectue le vrai contrôle de la pièce d'identité à
// l'entrée. Pour rendre cette déclaration exploitable on (1) la REND OBLIGATOIRE sur le
// chemin de paiement — elle ne peut donc pas être contournée par un appel API direct —
// et (2) on l'ENREGISTRE (horodatage + date de naissance auto-déclarée + IP) pour une
// trace auditable. Ce n'est volontairement PAS du KYC.

export const AGE_DECLARATION_REQUIRED_CODE = "AGE_DECLARATION_REQUIRED";

export class AgeDeclarationError extends Error {
  code = AGE_DECLARATION_REQUIRED_CODE;
  constructor(message = "Age declaration required") {
    super(message);
    this.name = "AgeDeclarationError";
  }
}

// Âge en années pleines à partir d'une chaîne YYYY-MM-DD, ou null si illisible.
function ageFromDate(dateStr: string): number | null {
  const birth = new Date(dateStr);
  if (isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

export interface AgeDeclarationRecord {
  declaredAt: string;
  birthDate: string | null;
  ip: string | null;
}

// Le front envoie `ageDeclaration: { confirmed: true, birthDate?: 'YYYY-MM-DD' }`
// (ou simplement `true`). Lève AgeDeclarationError si l'acheteur n'a pas certifié sa
// majorité, ou si une date de naissance auto-déclarée donne un âge < 18.
export function resolveAgeDeclaration(
  rawDeclaration: unknown,
  req: Request,
): AgeDeclarationRecord {
  const decl = rawDeclaration as { confirmed?: boolean; birthDate?: string } | boolean | undefined;
  const confirmed = decl === true || (!!decl && typeof decl === "object" && decl.confirmed === true);
  if (!confirmed) throw new AgeDeclarationError();

  let birthDate: string | null = null;
  if (decl && typeof decl === "object" && typeof decl.birthDate === "string" && decl.birthDate) {
    birthDate = decl.birthDate;
    const age = ageFromDate(birthDate);
    if (age !== null && age < 18) throw new AgeDeclarationError("Self-declared age is under 18");
  }

  const fwd = req.headers.get("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0].trim() : null) || req.headers.get("cf-connecting-ip") || null;

  return { declaredAt: new Date().toISOString(), birthDate, ip };
}
