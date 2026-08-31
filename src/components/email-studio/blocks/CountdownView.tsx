import { useEffect, useState } from 'react';
import type { CountdownBlock, EmailTheme } from '@/lib/email';
import { countdownParts, isHexColor } from '@/lib/email';
import { EMAIL_FONT, blockPad, liveFor, type CanvasCtx } from './common';

/**
 * 3 cellules JOURS / HEURES / MIN (cdCard du prototype). L'aperçu TICKE en
 * direct ; l'email envoyé fige le décompte au moment de l'envoi (par nature :
 * un email ne peut pas exécuter de script).
 */
export default function CountdownView({ block, theme, ctx }: { block: CountdownBlock; theme: EmailTheme; ctx: CanvasCtx }) {
  const pad = blockPad(block);
  const live = liveFor(block, ctx);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // L'événement live prime ; sinon la date cible manuelle (miroir render.ts).
  const startIso = live?.startAt || (typeof block.targetAt === 'string' ? block.targetAt : '');
  const parts = startIso ? countdownParts(startIso, now) : null;
  const pad2 = (n: number) => String(Math.max(0, n)).padStart(2, '0');
  const cells: [string, string][] = parts
    ? [[pad2(parts.days), 'JOURS'], [pad2(parts.hours), 'HEURES'], [pad2(parts.mins), 'MIN']]
    : [['—', 'JOURS'], ['—', 'HEURES'], ['—', 'MIN']];
  return (
    <div style={{ padding: `${pad.py}px ${pad.px}px` }}>
      <div style={{ border: `1px solid ${theme.divider}`, borderRadius: 12, padding: 18, textAlign: 'center' }}>
        <div style={{
          fontFamily: EMAIL_FONT, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
          color: theme.muted, marginBottom: 12,
        }}>{block.label}</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
          {cells.map(([num, unit]) => (
            <div key={unit} style={{ minWidth: 62, padding: '10px 0', borderRadius: 9, background: theme.tile }}>
              <div style={{ fontFamily: EMAIL_FONT, fontSize: 24, fontWeight: 700, color: isHexColor(block.accent) ? block.accent.trim() : theme.accent, fontVariantNumeric: 'tabular-nums' }}>{num}</div>
              <div style={{ fontFamily: EMAIL_FONT, fontSize: 10, color: theme.muted, letterSpacing: '0.1em', marginTop: 2 }}>{unit}</div>
            </div>
          ))}
        </div>
        {!parts && (
          <div style={{ fontFamily: EMAIL_FONT, fontSize: 11, color: theme.muted, marginTop: 10 }}>
            Relie un événement ou choisis une date : le compteur sera calculé à l’envoi
          </div>
        )}
      </div>
    </div>
  );
}
