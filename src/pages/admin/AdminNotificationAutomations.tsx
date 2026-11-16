/**
 * Registre des notifications UNITAIRES hors soirée (achat, remboursement,
 * pro, découverte…) : un interrupteur par notification, ses chiffres sur
 * 30 jours. Monté par Système › Interrupteurs. Les règles du moteur de
 * soirée, la politique et les crédits vivent dans Communication ›
 * Notifications automatiques (src/admin/comms).
 */
import { useCallback, useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Card, Toggle, Pill, PageSkeleton, Inner, Notice, T1, T3,
} from '@/components/admin/ui';
import { fmtNum, fmtDate } from '@/lib/adminFormat';

interface KeyStats { notification_key: string; sent_total: number; failed_total: number; clicked_total: number; sent_30d: number; failed_30d: number; clicked_30d: number; last_sent_at: string | null }

// Notifications unitaires hors soirée (registre historique) — le moteur tient
// les règles de soirée, celles-ci restent des interrupteurs simples.
type SysCategory = 'transactional' | 'reminder' | 'engagement' | 'marketing';
const SYSTEM_CATALOG: { key: string; category: SysCategory; dormant?: boolean }[] = [
  { key: 'purchase_ticket', category: 'transactional' },
  { key: 'purchase_table', category: 'transactional' },
  { key: 'order_ready', category: 'transactional' },
  { key: 'refund_confirmed', category: 'transactional' },
  { key: 'guest_list_added', category: 'transactional' },
  { key: 'waitlist_presale', category: 'transactional' },
  { key: 'promoter_announcement', category: 'transactional' },
  { key: 'promoter_commission_cancelled', category: 'transactional' },
  { key: 'promoter_payout_declared', category: 'transactional' },
  { key: 'promoter_payout_confirmed', category: 'transactional' },
  { key: 'promoter_payout_disputed', category: 'transactional' },
  { key: 'collab_amendment_proposed', category: 'transactional' },
  { key: 'collab_amendment_signed', category: 'transactional' },
  { key: 'dj_booking_request', category: 'transactional' },
  { key: 'promoter_payout_reminder', category: 'reminder' },
  { key: 'door_manifest_preload', category: 'reminder' },
  { key: 'dj_lineup', category: 'engagement' },
  { key: 'promoter_goal_reached', category: 'engagement' },
  { key: 'promoter_sale_first', category: 'engagement' },
  { key: 'promoter_night_digest', category: 'engagement' },
  { key: 'promoter_team_override', category: 'engagement' },
  { key: 'promoter_event_assigned', category: 'engagement' },
  { key: 'audience_weekly_recap', category: 'engagement' },
  { key: 'night_recap', category: 'engagement' },
  { key: 'taste_discovery', category: 'marketing' },
  { key: 'inactivity_reminder', category: 'marketing' },
  { key: 'cart_abandonment_drinks', category: 'marketing' },
  { key: 'email_missed_you', category: 'marketing' },
  { key: 'email_next_event_rec', category: 'marketing' },
  { key: 'email_night_recap', category: 'marketing' },
  { key: 'email_weekly_digest', category: 'marketing' },
  { key: 'weekly_digest', category: 'marketing', dormant: true },
  { key: 'discovery_week', category: 'marketing', dormant: true },
  { key: 'discovery_weekend', category: 'marketing', dormant: true },
];

// ─── Système ─────────────────────────────────────────────────────────────────
export function SystemTab() {
  const { t, language } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [legacy, setLegacy] = useState<string[]>([]);
  const [stats, setStats] = useState<Record<string, KeyStats>>({});

  const load = useCallback(async () => {
    const [settingsRes, statsRes] = await Promise.all([
      supabase.from('platform_notification_settings' as never).select('notification_key, enabled, category'),
      supabase.rpc('get_auto_push_stats' as never),
    ]);
    const map: Record<string, boolean> = {};
    const legacyKeys: string[] = [];
    for (const row of ((settingsRes.data as unknown) as { notification_key: string; enabled: boolean; category: string }[]) ?? []) {
      map[row.notification_key] = row.enabled;
      if (row.category === 'legacy') legacyKeys.push(row.notification_key);
    }
    setEnabled(map);
    setLegacy(legacyKeys.sort());
    const s: Record<string, KeyStats> = {};
    for (const row of ((statsRes.data as unknown) as KeyStats[]) ?? []) s[row.notification_key] = row;
    setStats(s);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (key: string, next: boolean) => {
    const prev = enabled[key];
    setEnabled((m) => ({ ...m, [key]: next }));
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('platform_notification_settings' as never)
      .upsert({ notification_key: key, enabled: next, updated_at: new Date().toISOString(), updated_by: user?.id ?? null } as never, { onConflict: 'notification_key' });
    if (error) { setEnabled((m) => ({ ...m, [key]: prev })); toast.error(t('adminAutoPush.toggleError')); }
    else toast.success(next ? t('adminAutoPush.toggledOn') : t('adminAutoPush.toggledOff'));
  };

  const label = (key: string, base: 'name' | 'desc') => {
    const own = t(`adm.auto.k.${key}.${base}`);
    if (!own.startsWith('adm.auto.k.')) return own;
    const old = t(`adminAutoPush.k.${key}.${base}`);
    return old.startsWith('adminAutoPush.k.') ? (base === 'name' ? key : '') : old;
  };

  if (loading) return <PageSkeleton tiles={0} blocks={3} />;

  return (
    <div className="space-y-4">
      <Notice icon={BellRing}>{t('adm.engine.systemIntro')}</Notice>
      {(['transactional', 'reminder', 'engagement', 'marketing'] as SysCategory[]).map((cat) => (
        <Card key={cat} title={t(`adminAutoPush.cat.${cat}`)} subtitle={t(`adminAutoPush.catHint.${cat}`)}>
          <div className="space-y-2">
            {SYSTEM_CATALOG.filter((c) => c.category === cat).map(({ key, dormant }) => {
              const s = stats[key];
              const on = enabled[key] !== false;
              const ctr = s && s.sent_30d > 0 ? Math.round((s.clicked_30d / s.sent_30d) * 100) : null;
              return (
                <Inner key={key} pad="12px 14px" style={{ opacity: on ? 1 : 0.55 }}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{label(key, 'name')}</p>
                        {dormant && <Pill size="xs" tone="muted" title={t('adm.auto.dormantHint')}>{t('adm.auto.dormant')}</Pill>}
                      </div>
                      <p style={{ color: T3, fontSize: 11.5, marginTop: 2, lineHeight: 1.45 }}>{label(key, 'desc')}</p>
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <Pill size="xs" tone={(s?.sent_30d ?? 0) > 0 ? 'pos' : 'muted'}>{t('adminAutoPush.sent30d')} {fmtNum(s?.sent_30d ?? 0, language)}</Pill>
                        <Pill size="xs" tone="muted">{t('adminAutoPush.ctr')} {ctr == null ? '—' : `${ctr} %`}</Pill>
                        {(s?.failed_30d ?? 0) > 0 && <Pill size="xs" tone="neg">{t('adminAutoPush.failed30d')} {fmtNum(s?.failed_30d ?? 0, language)}</Pill>}
                        <span style={{ color: T3, fontSize: 10.5 }}>
                          {s?.last_sent_at ? `${t('adminAutoPush.lastSent')} ${fmtDate(s.last_sent_at, language, 'datetime')}` : t('adminAutoPush.neverSent')}
                        </span>
                      </div>
                    </div>
                    <Toggle checked={on} onChange={(v) => toggle(key, v)} />
                  </div>
                </Inner>
              );
            })}
          </div>
        </Card>
      ))}
      {legacy.length > 0 && (
        <Card title={t('adm.engine.legacyTitle')} subtitle={t('adm.engine.legacyHint')}>
          <div className="flex flex-wrap gap-1.5">
            {legacy.map((k) => <Pill key={k} size="xs" tone="muted">{k}</Pill>)}
          </div>
        </Card>
      )}
    </div>
  );
}

