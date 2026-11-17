/**
 * Briques communes de la rubrique « Légal » : état d'une obligation, champ de
 * formulaire, choix en segments, et l'encadré « à confirmer par un juriste ».
 */
import type { ReactNode } from 'react';
import { Scale } from 'lucide-react';
import { Badge, useAdminT, type Tone } from '@/admin/ui';
import type { LegalState } from './rules';

const STATE_TONE: Record<LegalState, Tone> = { ok: 'positive', todo: 'warning', late: 'negative' };

export function StateBadge({ state }: { state: LegalState }) {
  const { t } = useAdminT();
  return <Badge tone={STATE_TONE[state]}>{t(`adm.lg2.state.${state}`)}</Badge>;
}

/** Ce que l'écran affirme, et d'où il le tient (ou qu'un juriste doit le confirmer). */
export function SourceNote({ children, jurist }: { children: ReactNode; jurist?: boolean }) {
  const { t } = useAdminT();
  return (
    <div className="a-card flex items-start gap-3 px-4 py-3" style={{ background: 'var(--a-subtle)' }}>
      <Scale className="a-t3 mt-0.5 h-4 w-4 flex-none" />
      <p className="a-t2 text-[12.5px] leading-relaxed">
        {children}
        {jurist && <> <strong className="a-t1">{t('adm.lg2.jurist')}</strong></>}
      </p>
    </div>
  );
}

