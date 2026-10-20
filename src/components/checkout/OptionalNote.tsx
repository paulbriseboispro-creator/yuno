// Un champ facultatif REPLIÉ (remarque pour le club) : la page garde ses quatre
// champs à l'écran, et la note ne s'ouvre que pour qui en a une. Même forme
// que les noms des amis du paiement billet (FriendNames).
import { useState } from 'react';
import { ChevronDown, MessageSquare } from 'lucide-react';
import { checkoutInputClass } from './checkoutFieldStyle';
import { FieldLabel } from './checkoutFieldUi';

interface OptionalNoteProps {
  id: string;
  title: string;
  hint: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
}

export function OptionalNote({ id, title, hint, label, placeholder, value, onChange, maxLength = 500 }: OptionalNoteProps) {
  const [open, setOpen] = useState(() => !!value.trim());
  return (
    <div className="overflow-hidden rounded-[10px] border border-white/[0.08] bg-[#141414]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        className="flex w-full items-center gap-3 p-3.5 text-left"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06]" aria-hidden>
          <MessageSquare className="h-[17px] w-[17px] text-[#E5E5E5]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-white">{title}</span>
          <span className="mt-0.5 block text-[12.5px] leading-[1.4] text-[#9A9A9A]">{hint}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[#9A9A9A] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div id={`${id}-panel`} className="flex flex-col gap-[7px] border-t border-white/[0.07] p-3.5">
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <textarea
            id={id}
            rows={3}
            maxLength={maxLength}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={checkoutInputClass(false, 'h-auto min-h-[88px] resize-none py-3 leading-[1.45]')}
          />
        </div>
      )}
    </div>
  );
}
