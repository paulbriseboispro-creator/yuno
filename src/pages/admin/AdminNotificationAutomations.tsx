import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Switch } from '@/components/ui/switch';
import { BellRing, Loader2, Receipt, Clock, HeartHandshake, Megaphone, Building2, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED        = '#E8192C';
const POS        = '#34D399';
const T1         = 'rgba(255,255,255,0.96)';
const T2         = 'rgba(255,255,255,0.58)';
const T3         = 'rgba(255,255,255,0.36)';
const BORDER     = 'rgba(255,255,255,0.085)';
const F_BORDER   = 'rgba(255,255,255,0.055)';
const TILE_BG    = 'rgba(255,255,255,0.025)';
const CARD_BG    = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// Catalogue des notifications automatiques — miroir front du registre serveur
// (_shared/auto-push.ts + push-automations.ts). Les libellés vivent en i18n
// sous adminAutoPush.k.<key>.name / .desc.
type Category = 'transactional' | 'reminder' | 'engagement' | 'marketing' | 'club_automation';

const CATEGORIES: { id: Category; icon: LucideIcon }[] = [
  { id: 'transactional', icon: Receipt },
  { id: 'reminder', icon: Clock },
  { id: 'engagement', icon: HeartHandshake },
  { id: 'marketing', icon: Megaphone },
  { id: 'club_automation', icon: Building2 },
];

const CATALOG: { key: string; category: Category }[] = [
  { key: 'purchase_ticket', category: 'transactional' },
  { key: 'purchase_table', category: 'transactional' },
  { key: 'order_ready', category: 'transactional' },
  { key: 'refund_confirmed', category: 'transactional' },
  { key: 'guest_list_added', category: 'transactional' },
  { key: 'event_reminder_4h', category: 'reminder' },
  { key: 'event_reminder_30m', category: 'reminder' },
  { key: 'new_event', category: 'engagement' },
  { key: 'dj_lineup', category: 'engagement' },
  { key: 'waitlist_presale', category: 'engagement' },
  { key: 'cart_abandonment', category: 'marketing' },
  { key: 'inactivity_reminder', category: 'marketing' },
  { key: 'weekly_digest', category: 'marketing' },
  { key: 'reminder_day_of', category: 'club_automation' },
  { key: 'event_live', category: 'club_automation' },
  { key: 'thank_you', category: 'club_automation' },
  { key: 'almost_sold_out', category: 'club_automation' },
  { key: 'drinks_preorder', category: 'club_automation' },
];

interface KeyStats {
  notification_key: string;
  sent_total: number;
  failed_total: number;
  clicked_total: number;
  sent_30d: number;
  failed_30d: number;
  clicked_30d: number;
  last_sent_at: string | null;
}

export default function AdminNotificationAutomations() {
  const { t } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [stats, setStats] = useState<Record<string, KeyStats>>({});
  const [clubAdoption, setClubAdoption] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    try {
      const [settingsRes, statsRes, adoptionRes] = await Promise.all([
        supabase.from('platform_notification_settings' as never).select('notification_key, enabled'),
        supabase.rpc('get_auto_push_stats' as never),
        supabase.from('venue_push_automations' as never).select('automation_key, enabled'),
      ]);

      const enabledMap: Record<string, boolean> = {};
      CATALOG.forEach(({ key }) => { enabledMap[key] = true; }); // absent = activé
      ((settingsRes.data as unknown as { notification_key: string; enabled: boolean }[]) || [])
        .forEach((row) => { enabledMap[row.notification_key] = row.enabled; });
      setEnabled(enabledMap);

      const statsMap: Record<string, KeyStats> = {};
      ((statsRes.data as unknown as KeyStats[]) || [])
        .forEach((row) => { statsMap[row.notification_key] = row; });
      setStats(statsMap);

      const adoption: Record<string, number> = {};
      ((adoptionRes.data as unknown as { automation_key: string; enabled: boolean }[]) || [])
        .forEach((row) => {
          if (row.enabled) adoption[row.automation_key] = (adoption[row.automation_key] || 0) + 1;
        });
      setClubAdoption(adoption);
    } catch (e) {
      console.error('AdminNotificationAutomations fetch error:', e);
      toast.error(t('adminAutoPush.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const toggle = async (key: string, next: boolean) => {
    const prev = enabled[key];
    setEnabled((m) => ({ ...m, [key]: next }));
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('platform_notification_settings' as never)
      .upsert(
        {
          notification_key: key,
          enabled: next,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        } as never,
        { onConflict: 'notification_key' },
      );
    if (error) {
      setEnabled((m) => ({ ...m, [key]: prev }));
      toast.error(t('adminAutoPush.toggleError'));
    } else {
      toast.success(next ? t('adminAutoPush.toggledOn') : t('adminAutoPush.toggledOff'));
    }
  };

  const ctr = (s?: KeyStats) => (s && s.sent_30d > 0 ? Math.round((s.clicked_30d / s.sent_30d) * 100) : null);

  const StatPill = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full tabular-nums whitespace-nowrap"
      style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, color: color || T2, fontSize: 10.5, fontWeight: 600 }}
    >
      <span style={{ color: T3, fontWeight: 500 }}>{label}</span> {value}
    </span>
  );

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      {/* Ambient vignette */}
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-start gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl flex-none"
            style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}
          >
            <BellRing className="h-4 w-4" style={{ color: RED }} />
          </div>
          <div>
            <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
              {t('adminAutoPush.title')}
            </h1>
            <p style={{ color: T3, fontSize: 12.5, marginTop: 6, maxWidth: 640 }}>
              {t('adminAutoPush.subtitle')}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} />
          </div>
        ) : (
          CATEGORIES.map(({ id, icon: Icon }) => {
            const items = CATALOG.filter((c) => c.category === id);
            if (items.length === 0) return null;
            return (
              <div key={id} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22, overflow: 'hidden' }}>
                <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                  <Icon className="h-4 w-4" style={{ color: T3 }} />
                  <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
                    {t(`adminAutoPush.cat.${id}`)}
                  </h3>
                </div>
                <p style={{ color: T3, fontSize: 11.5, marginBottom: 16 }}>
                  {t(`adminAutoPush.catHint.${id}`)}
                </p>

                <div className="space-y-2.5">
                  {items.map(({ key }) => {
                    const s = stats[key];
                    const keyCtr = ctr(s);
                    const isOn = enabled[key] !== false;
                    return (
                      <div
                        key={key}
                        className="flex items-start justify-between gap-4 p-3 rounded-xl"
                        style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, opacity: isOn ? 1 : 0.55 }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-[560]" style={{ color: T1, fontSize: 13 }}>
                            {t(`adminAutoPush.k.${key}.name`)}
                          </p>
                          <p style={{ color: T3, fontSize: 11.5, marginTop: 2, lineHeight: 1.45 }}>
                            {t(`adminAutoPush.k.${key}.desc`)}
                          </p>
                          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                            <StatPill label={t('adminAutoPush.sent30d')} value={String(s?.sent_30d ?? 0)} color={(s?.sent_30d ?? 0) > 0 ? POS : undefined} />
                            <StatPill label={t('adminAutoPush.ctr')} value={keyCtr === null ? '—' : `${keyCtr}%`} color={keyCtr !== null && keyCtr > 0 ? POS : undefined} />
                            {(s?.failed_30d ?? 0) > 0 && (
                              <StatPill label={t('adminAutoPush.failed30d')} value={String(s?.failed_30d)} color={RED} />
                            )}
                            <StatPill label={t('adminAutoPush.total')} value={String(s?.sent_total ?? 0)} />
                            <span style={{ color: T3, fontSize: 10.5 }} className="tabular-nums">
                              {s?.last_sent_at
                                ? `${t('adminAutoPush.lastSent')} ${new Date(s.last_sent_at).toLocaleDateString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                                : t('adminAutoPush.neverSent')}
                            </span>
                            {id === 'club_automation' && (
                              <span style={{ color: T2, fontSize: 10.5 }} className="tabular-nums">
                                · {t('adminAutoPush.enabledByClubs').replace('{count}', String(clubAdoption[key] || 0))}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex-none pt-1">
                          <Switch checked={isOn} onCheckedChange={(v) => toggle(key, v)} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}

      </div>
    </div>
  );
}
