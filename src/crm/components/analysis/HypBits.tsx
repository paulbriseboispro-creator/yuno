/**
 * La pastille du statut d'une famille et les barres de force d'une hypothèse
 * (analyse client). Les phrases vivent dans hypText.ts.
 */
import { useState } from 'react';
import type { useCrmT } from '@/crm/i18n';
import { Badge } from '@/crm/ui/kit';
import type { Tone } from '@/crm/ui/kit';
import { displayStatus } from '@/crm/lib/analysis';
import type { DisplayStatus, Hypothesis } from '@/crm/lib/analysis';
import type { StatusLike } from './hypText';

type T = ReturnType<typeof useCrmT>;

const TONE: Record<DisplayStatus, Tone> = { supported: 'done', not_supported: 'wait', untested: 'wait', prior_only: 'warn', off: 'wait' };

/**
 * Statut d'une famille. Un groupe de RETOUR confirmé dit son sens (« Reviennent
 * plus / moins ») : « confirmée » seul laisserait croire qu'il revient plus.
 */
export function StatusBadge({ f, T }: { f: StatusLike; T: T }) {
  const ds = displayStatus(f);
  if (ds === 'supported' && f.kind === 'return' && f.direction) {
    return <Badge tone={f.direction === 'more' ? 'done' : 'warn'}>{T.t(`yc.why.dir.${f.direction}`)}</Badge>;
  }
  return <Badge tone={TONE[ds]} dot={ds !== 'off'}>{T.t(`yc.why.st.${ds}`)}</Badge>;
}

/** Photo ronde d'un artiste ; une image qui ne charge pas laisse un disque neutre. */
export function ArtistAvatar({ src, size }: { src: string | null | undefined; size: number }) {
  const [bad, setBad] = useState(false);
  const base = { flex: 'none' as const, width: size, height: size, borderRadius: 99, background: 'var(--sand-100)' };
  if (!src || bad) return <span aria-hidden="true" style={base} />;
  return <img src={src} alt="" width={size} height={size} loading="lazy" onError={() => setBad(true)} style={{ ...base, objectFit: 'cover' }} />;
}

/** Trois barres : la force d'une hypothèse. */
export function StrengthBars({ s, label }: { s: Hypothesis['s']; label: string }) {
  const lvl = s === 'strong' ? 3 : s === 'medium' ? 2 : 1;
  return (
    <span role="img" aria-label={label} title={label} style={{ flex: 'none', display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 14 }}>
      {[1, 2, 3].map((i) => (
        <i key={i} style={{ width: 4, height: 4 + i * 3, borderRadius: 2, background: i <= lvl ? 'var(--red-500)' : 'var(--sand-200)' }} />
      ))}
    </span>
  );
}
