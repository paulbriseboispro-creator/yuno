import { useState } from 'react';
import { Flame, Ban, HeartPulse, MoreHorizontal } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const T1     = 'rgba(255,255,255,0.96)';
const T3     = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';

interface Props {
  venueId: string;
  eventId?: string | null;
}

const KINDS = [
  { kind: 'incident_fight', icon: Flame, labelKey: 'bouncer.incident.fight' },
  { kind: 'incident_refusal', icon: Ban, labelKey: 'bouncer.incident.refusal' },
  { kind: 'incident_medical', icon: HeartPulse, labelKey: 'bouncer.incident.medical' },
  { kind: 'incident_other', icon: MoreHorizontal, labelKey: 'bouncer.incident.other' },
] as const;

/**
 * Signalement d'incident en 1 tap depuis la porte. Chaque bouton insère un
 * night_ops_events horodaté qui remonte instantanément dans le centre de
 * commandement owner (station Porte + radio staff). Gros boutons (≥48 px) :
 * ça se déclenche dans le noir, une main sur le scanner.
 */
export function IncidentQuickReport({ venueId, eventId }: Props) {
  const { t } = useLanguage();
  const [sending, setSending] = useState<string | null>(null);

  const report = async (kind: string) => {
    if (sending) return;
    setSending(kind);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth?.user?.id;
      if (!userId) return;
      const { error } = await (supabase as any).from('night_ops_events').insert({
        venue_id: venueId,
        event_id: eventId ?? null,
        reported_by: userId,
        kind,
      });
      if (error) throw error;
      toast.success(t('bouncer.incident.sent'));
    } catch {
      toast.error(t('bouncer.incident.error'));
    } finally {
      setSending(null);
    }
  };

  return (
    <div style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '14px 16px' }}>
      <p className="mb-2.5" style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
        {t('bouncer.incident.title')}
      </p>
      <div className="grid grid-cols-4 gap-2">
        {KINDS.map(({ kind, icon: Icon, labelKey }) => (
          <button
            key={kind}
            onClick={() => report(kind)}
            disabled={sending !== null}
            className="flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl px-1 cursor-pointer transition-opacity disabled:opacity-40"
            style={{ minHeight: 64, background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.2)' }}
          >
            <Icon className="h-5 w-5 flex-none" style={{ color: '#E8192C' }} />
            {/* Libellés courts mais variables selon la langue : tronqué plutôt que débordant */}
            <span className="max-w-full truncate leading-tight" style={{ color: T1, fontSize: 10.5, fontWeight: 600 }}>{t(labelKey)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
