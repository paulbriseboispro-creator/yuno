/**
 * Système › Interrupteurs › Registre des notifications UNITAIRES hors soirée
 * (achat, remboursement, pro, découverte…) : un interrupteur par notification
 * et ses chiffres sur 30 jours, un tableau par catégorie. Les règles du moteur
 * de soirée, la politique et les crédits vivent dans Communication ›
 * Notifications automatiques.
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Block, Switch, useAdminT, EmptyLine, Ledger, MiniBar } from '@/admin/ui';
import { fmtDate, fmtNum, fmtPct } from '@/lib/adminFormat';

interface KeyStats { notification_key: string; sent_total: number; failed_total: number; clicked_total: number; sent_30d: number; failed_30d: number; clicked_30d: number; last_sent_at: string | null }

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

interface Row { key: string; dormant: boolean; on: boolean; s: KeyStats | undefined }

export function NotificationRegistry() {
  const { t, lang } = useAdminT();
  const [loaded, setLoaded] = useState(false);
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
    setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggle = useCallback(async (key: string, next: boolean) => {
    const prev = enabled[key];
    setEnabled((m) => ({ ...m, [key]: next }));
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('platform_notification_settings' as never)
      .upsert({ notification_key: key, enabled: next, updated_at: new Date().toISOString(), updated_by: user?.id ?? null } as never, { onConflict: 'notification_key' });
    if (error) { setEnabled((m) => ({ ...m, [key]: prev })); toast.error(t('adminAutoPush.toggleError')); }
    else toast.success(next ? t('adminAutoPush.toggledOn') : t('adminAutoPush.toggledOff'));
  }, [enabled, t]);

  const label = useCallback((key: string, base: 'name' | 'desc') => {
    const own = t(`adm.auto.k.${key}.${base}`);
    if (!own.startsWith('adm.auto.k.')) return own;
    const old = t(`adminAutoPush.k.${key}.${base}`);
    return old.startsWith('adminAutoPush.k.') ? (base === 'name' ? key : '') : old;
  }, [t]);

  const maxSent = Math.max(0, ...Object.values(stats).map((x) => x.sent_30d));
  const maxCtr = Math.max(0, ...Object.values(stats).map((x) => (x.sent_30d > 0 ? (x.clicked_30d / x.sent_30d) * 100 : 0)));

  return (
    <div className="flex flex-col gap-8">
      <EmptyLine>{t('adm.engine.systemIntro')}</EmptyLine>
      {(['transactional', 'reminder', 'engagement', 'marketing'] as SysCategory[]).map((cat) => {
        const rows: Row[] = SYSTEM_CATALOG.filter((c) => c.category === cat)
          .map(({ key, dormant }) => ({ key, dormant: !!dormant, on: enabled[key] !== false, s: stats[key] }));
        return (
          <Block key={cat} title={t(`adminAutoPush.cat.${cat}`)} meta={t(`adminAutoPush.catHint.${cat}`)}>
            {!loaded ? <div className="a-skel h-24 w-full" /> : (
              <Ledger>
                {rows.map((r) => {
                  const ctr = r.s && r.s.sent_30d > 0 ? (r.s.clicked_30d / r.s.sent_30d) * 100 : null;
                  return (
                    <div key={r.key} className={`grid grid-cols-1 items-center gap-x-4 gap-y-1 px-1 py-2.5 lg:grid-cols-[minmax(0,1.6fr)_140px_130px_70px_110px_auto] ${r.on ? '' : 'opacity-60'}`}>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><span className="a-t1 text-[13.5px] font-medium">{label(r.key, 'name')}</span>{r.dormant && <span className="a-mono a-t3 text-[10.5px] uppercase">{t('adm.auto.dormant')}</span>}</div>
                        <div className="a-t3 max-w-[60ch] text-[12px] leading-snug">{label(r.key, 'desc')}</div>
                      </div>
                      <MiniBar value={r.s?.sent_30d ?? 0} max={maxSent} display={fmtNum(r.s?.sent_30d ?? 0, lang)} width={64} />
                      <MiniBar value={ctr} max={maxCtr} display={ctr == null ? '—' : fmtPct(ctr, 0, lang)} width={56} />
                      <span className="a-num text-[12.5px]" style={(r.s?.failed_30d ?? 0) > 0 ? { color: 'var(--a-neg)', fontWeight: 600 } : undefined}>{fmtNum(r.s?.failed_30d ?? 0, lang)}</span>
                      <span className="a-mono a-t3 text-[11px]">{r.s?.last_sent_at ? fmtDate(r.s.last_sent_at, lang, 'short') : t('adminAutoPush.neverSent')}</span>
                      <Switch checked={r.on} label={label(r.key, 'name')} onChange={(v) => void toggle(r.key, v)} />
                    </div>
                  );
                })}
              </Ledger>
            )}
          </Block>
        );
      })}
      {legacy.length > 0 && (
        <Block title={t('adm.engine.legacyTitle')} meta={t('adm.engine.legacyHint')}>
          <div className="flex flex-wrap gap-x-4 gap-y-1">{legacy.map((k) => <span key={k} className="a-mono a-t3 text-[11.5px]">{k}</span>)}</div>
        </Block>
      )}
    </div>
  );
}
