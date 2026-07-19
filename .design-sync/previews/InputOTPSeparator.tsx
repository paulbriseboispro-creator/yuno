import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from 'yuno-design-system';

// Alone the separator is a single lucide Dot on a dark canvas — a card that
// reads as empty. It only means anything BETWEEN two InputOTPGroups, so every
// story renders the whole OTP field and lets the separator do its one job:
// splitting a long code into blocks the eye can hold.

const mono: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#5A5A5E',
};

const slotClass = 'h-12 w-12 border-white/[0.10] bg-[#1F1F22] text-white text-base';
const sepClass = 'text-[#5A5A5E]';

export const TroisPlusTrois = () => (
  <div style={{ display: 'grid', gap: 10 }}>
    <p className="font-mono" style={{ ...mono, margin: 0 }}>
      Code de retrait — 740 · 265
    </p>
    <InputOTP maxLength={6} value="740265" onChange={() => {}}>
      <InputOTPGroup>
        <InputOTPSlot index={0} className={slotClass} />
        <InputOTPSlot index={1} className={slotClass} />
        <InputOTPSlot index={2} className={slotClass} />
      </InputOTPGroup>
      <InputOTPSeparator className={sepClass} />
      <InputOTPGroup>
        <InputOTPSlot index={3} className={slotClass} />
        <InputOTPSlot index={4} className={slotClass} />
        <InputOTPSlot index={5} className={slotClass} />
      </InputOTPGroup>
    </InputOTP>
  </div>
);

export const DeuxPlusDeuxPlusDeux = () => (
  <div style={{ display: 'grid', gap: 10 }}>
    <p className="font-mono" style={{ ...mono, margin: 0 }}>
      Deux séparateurs — code guest list
    </p>
    <InputOTP maxLength={6} value="482913" onChange={() => {}}>
      <InputOTPGroup>
        <InputOTPSlot index={0} className={slotClass} />
        <InputOTPSlot index={1} className={slotClass} />
      </InputOTPGroup>
      <InputOTPSeparator className={sepClass} />
      <InputOTPGroup>
        <InputOTPSlot index={2} className={slotClass} />
        <InputOTPSlot index={3} className={slotClass} />
      </InputOTPGroup>
      <InputOTPSeparator className={sepClass} />
      <InputOTPGroup>
        <InputOTPSlot index={4} className={slotClass} />
        <InputOTPSlot index={5} className={slotClass} />
      </InputOTPGroup>
    </InputOTP>
  </div>
);

export const SeparateurVide = () => (
  <div style={{ display: 'grid', gap: 10 }}>
    <p className="font-mono" style={{ ...mono, margin: 0 }}>
      Champ vierge — le séparateur tient la structure
    </p>
    <InputOTP maxLength={6} value="" onChange={() => {}}>
      <InputOTPGroup>
        <InputOTPSlot index={0} className={slotClass} />
        <InputOTPSlot index={1} className={slotClass} />
        <InputOTPSlot index={2} className={slotClass} />
      </InputOTPGroup>
      <InputOTPSeparator className={sepClass} />
      <InputOTPGroup>
        <InputOTPSlot index={3} className={slotClass} />
        <InputOTPSlot index={4} className={slotClass} />
        <InputOTPSlot index={5} className={slotClass} />
      </InputOTPGroup>
    </InputOTP>
  </div>
);
