import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from 'yuno-design-system';

// The SMS check of src/pages/ClaimOrder.tsx:370–379 — a guest recovers the
// tickets bought without an account. Values are fixed strings (never
// Date.now()-derived) and onChange is a no-op so the render is deterministic:
// with no focus there is no blinking caret to make the capture flaky.

const mono: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#5A5A5E',
};

const slotClass = 'h-12 w-12 border-white/[0.10] bg-[#1F1F22] text-white text-base';

export const VerificationSMS = () => (
  <div style={{ display: 'grid', gap: 10 }}>
    <p className="font-mono" style={{ ...mono, margin: 0 }}>
      Code envoyé au +34 612 44 08 91
    </p>
    <InputOTP maxLength={6} value="482913" onChange={() => {}}>
      <InputOTPGroup>
        <InputOTPSlot index={0} className={slotClass} />
        <InputOTPSlot index={1} className={slotClass} />
        <InputOTPSlot index={2} className={slotClass} />
        <InputOTPSlot index={3} className={slotClass} />
        <InputOTPSlot index={4} className={slotClass} />
        <InputOTPSlot index={5} className={slotClass} />
      </InputOTPGroup>
    </InputOTP>
  </div>
);

export const SaisieEnCours = () => (
  <div style={{ display: 'grid', gap: 10 }}>
    <p className="font-mono" style={{ ...mono, margin: 0 }}>
      Saisie en cours
    </p>
    <InputOTP maxLength={6} value="482" onChange={() => {}}>
      <InputOTPGroup>
        <InputOTPSlot index={0} className={slotClass} />
        <InputOTPSlot index={1} className={slotClass} />
        <InputOTPSlot index={2} className={slotClass} />
        <InputOTPSlot index={3} className={slotClass} />
        <InputOTPSlot index={4} className={slotClass} />
        <InputOTPSlot index={5} className={slotClass} />
      </InputOTPGroup>
    </InputOTP>
  </div>
);

export const CodeEnDeuxBlocs = () => (
  <div style={{ display: 'grid', gap: 10 }}>
    <p className="font-mono" style={{ ...mono, margin: 0 }}>
      Retrait de commande au bar
    </p>
    <InputOTP maxLength={6} value="740265" onChange={() => {}}>
      <InputOTPGroup>
        <InputOTPSlot index={0} className={slotClass} />
        <InputOTPSlot index={1} className={slotClass} />
        <InputOTPSlot index={2} className={slotClass} />
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        <InputOTPSlot index={3} className={slotClass} />
        <InputOTPSlot index={4} className={slotClass} />
        <InputOTPSlot index={5} className={slotClass} />
      </InputOTPGroup>
    </InputOTP>
  </div>
);

export const Desactive = () => (
  <div style={{ display: 'grid', gap: 10 }}>
    <p className="font-mono" style={{ ...mono, margin: 0 }}>
      Code expiré — redemander un SMS
    </p>
    <InputOTP maxLength={4} value="4820" onChange={() => {}} disabled>
      <InputOTPGroup>
        <InputOTPSlot index={0} className={slotClass} />
        <InputOTPSlot index={1} className={slotClass} />
        <InputOTPSlot index={2} className={slotClass} />
        <InputOTPSlot index={3} className={slotClass} />
      </InputOTPGroup>
    </InputOTP>
  </div>
);
