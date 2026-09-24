import { motion } from 'framer-motion';
import { User } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { StaffMember } from '@/hooks/useLiveNightData';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const POS      = 'var(--acc-34d399)';
const T1       = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T3       = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const BORDER   = 'rgb(var(--ink)/0.085)';
const C_FAINT  = 'rgb(var(--ink)/0.06)';
const TILE_BG  = 'rgb(var(--ink)/0.025)';
const CARD_BG  = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';

interface Props {
  staff: StaffMember[];
}

export function LiveStaffActivity({ staff }: Props) {
  const { t } = useLanguage();

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', overflow: 'hidden' }}>
      <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 16 }}>
        {t('live.staffActivity')}
      </h3>
      {staff.length === 0 ? (
        <p className="text-center py-4" style={{ color: T3, fontSize: 12 }}>
          {t('live.noStaffActivity')}
        </p>
      ) : (
        <div className="space-y-2">
          {staff.map((member, i) => (
            <motion.div
              key={member.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
              style={{ background: TILE_BG }}
            >
              <div className="p-1.5 rounded-lg flex-none" style={{ background: C_FAINT }}>
                <User className="h-3.5 w-3.5" style={{ color: T3 }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{member.name}</p>
                <p className="capitalize" style={{ color: T3, fontSize: 10.5 }}>{member.role.replace('_', ' ')}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="tabular-nums" style={{ color: T1, fontSize: 18, fontWeight: 640 }}>
                  {member.processedCount}
                </span>
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: member.isActive ? POS : 'rgb(var(--ink)/0.12)' }}
                />
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
