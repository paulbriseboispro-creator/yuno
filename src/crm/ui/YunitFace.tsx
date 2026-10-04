/**
 * Le Yunit, mascotte de la monnaie de Yuno CRM (YunitFace du design) : une
 * pastille au dégradé Yuno, un visage en pixels découpé dans un masque. Cinq
 * humeurs ; il cligne des yeux de temps en temps, sauf si l'appareil demande
 * moins d'animations.
 */
import { useEffect, useId, useState } from 'react';
import { prefersReducedMotion } from './motion';

export type YunitMood = 'content' | 'ravi' | 'endormi' | 'inquiet' | 'surpris';

export function YunitFace({ mood = 'content', size = 48, blink = true }: { mood?: YunitMood; size?: number; blink?: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (!blink || prefersReducedMotion()) return;
    let t1: ReturnType<typeof setTimeout>;
    let t2: ReturnType<typeof setTimeout>;
    const loop = () => {
      t1 = setTimeout(() => {
        setClosed(true);
        t2 = setTimeout(() => { setClosed(false); loop(); }, 140);
      }, 2600 + Math.random() * 2600);
    };
    loop();
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [blink]);

  const tall = mood === 'ravi';
  const y0 = tall ? 430 : 458;
  const h0 = tall ? 170 : 136;
  const eyeY = closed ? y0 + h0 / 2 - 8 : y0;
  const eyeH = closed ? 16 : h0;
  const mid = `ym${uid}`;

  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'linear-gradient(65deg,#E3141B 8%,#FF6B35 96%)', flex: 'none', display: 'block', overflow: 'hidden', lineHeight: 0 }}>
      <svg viewBox="38 38 1175 1175" width="100%" height="100%" aria-hidden="true" style={{ display: 'block' }}>
        <mask id={mid} maskUnits="userSpaceOnUse" x="0" y="0" width="1250" height="1250">
          <rect x="0" y="0" width="1250" height="1250" fill="#fff" />
          {mood === 'content' && (
            <>
              <g fill="#000">
                <rect x="451" y={eyeY} width="110" height={eyeH} rx="12" />
                <rect x="692" y={eyeY} width="111" height={eyeH} rx="12" />
                <rect x="375" y="665" width="86" height="88" rx="12" />
                <rect x="787" y="665" width="90" height="88" rx="12" />
              </g>
              <path d="M455 722 C 540 790, 710 790, 795 722" fill="none" stroke="#000" strokeWidth="32" />
            </>
          )}
          {mood === 'ravi' && (
            <g fill="#000">
              <rect x="451" y={eyeY} width="110" height={eyeH} rx="12" />
              <rect x="692" y={eyeY} width="111" height={eyeH} rx="12" />
              <rect x="410" y="662" width="430" height="150" rx="26" />
            </g>
          )}
          {mood === 'endormi' && (
            <g fill="#000">
              <rect x="451" y="545" width="110" height="34" rx="10" />
              <rect x="692" y="545" width="111" height="34" rx="10" />
              <rect x="570" y="725" width="110" height="32" rx="10" />
            </g>
          )}
          {mood === 'inquiet' && (
            <>
              <g fill="#000">
                <rect x="451" y={eyeY} width="110" height={eyeH} rx="12" />
                <rect x="692" y={eyeY} width="111" height={eyeH} rx="12" />
                <rect x="375" y="722" width="86" height="88" rx="12" />
                <rect x="787" y="722" width="90" height="88" rx="12" />
              </g>
              <path d="M455 764 C 540 687, 710 687, 795 764" fill="none" stroke="#000" strokeWidth="32" />
            </>
          )}
          {mood === 'surpris' && (
            <g fill="#000">
              <rect x="451" y="440" width="110" height="150" rx="12" />
              <rect x="692" y="440" width="111" height="150" rx="12" />
              <rect x="570" y="690" width="110" height="120" rx="14" />
            </g>
          )}
        </mask>
        <g mask={`url(#${mid})`} fill="#fff" stroke="#fff" strokeWidth="22" strokeLinejoin="round">
          <rect x="471" y="273" width="313" height="78" />
          <rect x="329" y="369" width="595" height="113" />
          <rect x="211" y="499" width="831" height="246" />
          <rect x="325" y="763" width="602" height="100" />
          <rect x="466" y="879" width="320" height="74" />
          <rect x="471" y="340" width="313" height="40" />
          <rect x="329" y="470" width="595" height="40" />
          <rect x="325" y="735" width="602" height="40" />
          <rect x="466" y="851" width="320" height="40" />
        </g>
      </svg>
    </div>
  );
}
