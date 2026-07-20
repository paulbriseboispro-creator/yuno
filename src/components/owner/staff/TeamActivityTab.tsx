/**
 * Onglet « Activité » du hub équipe owner.
 *
 * Le relevé de travail de chaque membre sur 30 jours : nuits travaillées,
 * actions par domaine, dernière action. Trié par ancienneté et JAMAIS par
 * volume — c'est un trombinoscope de travail, pas un classement. Un videur
 * poussé au scan rapide contrôle mal : on ne crée pas cette incitation.
 */

import { useEffect, useState } from 'react';
import { ScanLine, Wine, Shirt, Crown, Moon, Clock, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { staffInitials, isStaffRole, STAFF_ROLE_DEFS } from '@/lib/staffIdentity';

const T1      = 'rgba(255,255,255,0.96)';
const T2      = 'rgba(255,255,255,0.58)';
const T3      = 'rgba(255,255,255,0.36)';
const BORDER  = 'rgba(255,255,255,0.085)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface MemberActivity {
  user_id: string;
  name: string;
  title: string | null;
  avatar_url: string | null;
  staff_since: string | null;
  roles: string[];
  scans: number;
  orders: number;
  cloakroom: number;
  vip_items: number;
  nights_worked: number;
  last_action_at: string | null;
}

interface Props {
  venueId: string;
}

export function TeamActivityTab({ venueId }: Props) {
  const { t } = useLanguage();
  const [members, setMembers] = useState<MemberActivity[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc('get_venue_staff_activity', {
        p_venue_id: venueId,
        p_days: 30,
      });
      if (!cancelled) setMembers((data as unknown as MemberActivity[]) ?? []);
    })();
    return () => { cancelled = true; };
  }, [venueId]);

  if (members === null) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} />
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW }}>
        <p className="py-14 text-center" style={{ color: T3, fontSize: 13 }}>{t('owner.noEmployees')}</p>
      </div>
    );
  }

  const fmtLast = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
      : t('ownerteam.never');

  return (
    <div className="space-y-3">
      <p style={{ color: T3, fontSize: 11.5 }}>{t('ownerteam.activityHint')}</p>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {members.map((m) => {
          const domains: { icon: typeof ScanLine; label: string; value: number }[] = [
            { icon: ScanLine, label: t('staffme.stat.scans'), value: m.scans },
            { icon: Wine, label: t('staffme.stat.orders'), value: m.orders },
            { icon: Shirt, label: t('staffme.stat.cloakroom'), value: m.cloakroom },
            { icon: Crown, label: t('staffme.stat.vip'), value: m.vip_items },
          ].filter((d) => d.value > 0);

          const roleLabels = m.roles
            .filter(isStaffRole)
            .map((r) => t(STAFF_ROLE_DEFS[r].labelKey))
            .join(' · ');

          return (
            <div key={m.user_id} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 18 }}>
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <span style={{ color: T2, fontSize: 12, fontWeight: 700 }}>{staffInitials(m.name)}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{m.name}</p>
                  <p className="truncate" style={{ color: T3, fontSize: 11 }}>{m.title?.trim() || roleLabels}</p>
                </div>
              </div>

              <div className="mb-3 flex items-center justify-between rounded-xl px-3 py-2" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <span className="flex items-center gap-1.5" style={{ color: T2, fontSize: 11.5 }}>
                  <Moon className="h-3 w-3" />
                  {t('ownerteam.nights')}
                </span>
                <span className="tabular-nums" style={{ color: T1, fontSize: 14, fontWeight: 650 }}>{m.nights_worked}</span>
              </div>

              {domains.length > 0 && (
                <div className="mb-3 grid grid-cols-2 gap-1.5">
                  {domains.map(({ icon: Icon, label, value }) => (
                    <div key={label} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5" style={{ background: INNER_BG }}>
                      <Icon className="h-3 w-3 flex-none" style={{ color: T3 }} />
                      <span className="truncate" style={{ color: T3, fontSize: 10 }}>{label}</span>
                      <span className="ml-auto tabular-nums" style={{ color: T1, fontSize: 12, fontWeight: 600 }}>{value}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1" style={{ color: T3, fontSize: 10.5 }}>
                  <Clock className="h-3 w-3" />
                  {t('ownerteam.lastAction')}
                </span>
                <span style={{ color: T2, fontSize: 11 }}>{fmtLast(m.last_action_at)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
