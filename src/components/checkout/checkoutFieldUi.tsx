// Primitives des champs du paiement public (DA éditoriale, docs/DESIGN_SYSTEM_PUBLIC.md) :
// libellé au-dessus du champ en mono capitales, champ de 48 px, une ligne d'aide
// qui dit POURQUOI on demande, un message d'erreur qui dit QUOI faire.
// Contrastes vérifiés sur #0A0A0A : libellés et aides #9A9A9A (7:1), textes
// d'exemple #8A8A8F (4,8:1 sur #1F1F22), erreur #FF5A68 (6:1).
import type { ReactNode } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { CHECKOUT_ERROR } from './checkoutFieldStyle';

export function FieldLabel({ htmlFor, id, invalid, children }: { htmlFor?: string; id?: string; invalid?: boolean; children: ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      id={id}
      className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em]"
      style={{ color: invalid ? CHECKOUT_ERROR : '#9A9A9A' }}
    >
      {children}
    </label>
  );
}

export function FieldHint({ id, children }: { id?: string; children: ReactNode }) {
  return <p id={id} className="text-[12.5px] leading-[1.45] text-[#9A9A9A]">{children}</p>;
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-[13px] font-medium leading-[1.4]" style={{ color: CHECKOUT_ERROR }}>
      <AlertCircle className="mt-px h-[15px] w-[15px] shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** Coche verte posée dans le champ quand la valeur est bonne (validation à la sortie du champ). */
export function FieldValidMark({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute right-3.5 top-1/2 flex -translate-y-1/2" role="img" aria-label={label}>
      <Check className="h-4 w-4 text-emerald-400" strokeWidth={2.6} aria-hidden />
    </span>
  );
}
