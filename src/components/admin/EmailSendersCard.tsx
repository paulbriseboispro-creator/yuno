import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import { Card, Toggle, NEG, POS, T2, T3 } from '@/components/admin/ui';
import { fmtNum } from '@/lib/adminFormat';

interface Sender {
  scope_key: string; name: string; sent: number; bounced: number; complained: number; opened: number;
  gmail_sent: number; gmail_opened: number; burst_allowed: boolean; cold_frozen_until: string | null; reason: string | null;
  /** Droits d'envoi (20261127140000) ; absents avant. */
  level?: number;
  rights?: { daily_cap: number; per_hour: number; cold_daily: number; cold_gmail_daily: number; burst: boolean };
  checks?: Record<string, boolean>;
}

const pct = (a: number, b: number) => (b >= 30 ? `${Math.round((a * 1000) / b) / 10} %` : '—');

/**
 * Comptes expéditeurs (admin_email_senders, 20261127110000) : santé d'envoi
 * sur 30 jours, mise à l'écart, et l'autorisation « tout d'un coup »
 * (admin_set_sender_burst, motif obligatoire, audité).
 */
export function EmailSendersCard() {
  const { t, language } = useLanguage();
  const [rows, setRows] = useState<Sender[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_email_senders' as never);
    if (!error) setRows((data as unknown as Sender[]) ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const setBurst = async (s: Sender, allowed: boolean) => {
    const reason = window.prompt(t('adm.system.senders.reason'));
    if (!reason || reason.trim().length < 3) return;
    setBusy(s.scope_key);
    const { data, error } = await supabase.rpc('admin_set_sender_burst' as never, { p_scope_key: s.scope_key, p_allowed: allowed, p_reason: reason.trim() } as never);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    setRows((data as unknown as Sender[]) ?? []);
    toast.success(t('adm.system.senders.saved'));
  };

  // Lever un blocage (récidive ou mise à l'écart) : motif obligatoire, audité.
  const lift = async (s: Sender) => {
    const reason = window.prompt(t('adm.system.senders.liftReason'));
    if (!reason || reason.trim().length < 3) return;
    setBusy(s.scope_key);
    const { error } = await supabase.rpc('admin_lift_sender_freeze' as never, { p_scope_key: s.scope_key, p_reason: reason.trim() } as never);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t('adm.system.senders.saved'));
    void load();
  };

  return (
    <Card title={t('adm.system.senders.title')} subtitle={t('adm.system.senders.sub')} icon={Send}>
      {!rows ? null : rows.length === 0 ? (
        <p style={{ color: T3, fontSize: 12, margin: 0 }}>{t('adm.system.senders.none')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full" style={{ fontSize: 12, minWidth: 620 }}>
            <thead><tr style={{ color: T3 }}>
              <th className="text-left font-medium py-1">{t('adm.system.senders.account')}</th>
              <th className="text-left font-medium py-1">{t('adm.system.senders.level')}</th>
              <th className="text-right font-medium py-1">{t('adm.system.senders.sent')}</th>
              <th className="text-right font-medium py-1">{t('adm.system.senders.bounce')}</th>
              <th className="text-right font-medium py-1">{t('adm.system.senders.gmail')}</th>
              <th className="text-right font-medium py-1">{t('adm.system.senders.state')}</th>
              <th className="text-right font-medium py-1">{t('adm.system.senders.burst')}</th>
            </tr></thead>
            <tbody>
              {rows.map((s) => {
                const other = s.sent - s.gmail_sent;
                const frozen = s.cold_frozen_until && new Date(s.cold_frozen_until).getTime() > Date.now();
                return (
                  <tr key={s.scope_key} style={{ color: T2 }}>
                    <td className="py-1.5">{s.name}</td>
                    <td className="py-1.5" style={{ minWidth: 150 }}>
                      {s.level != null ? (() => {
                        const vals = Object.values(s.checks ?? {});
                        const ratio = vals.length ? vals.filter(Boolean).length / vals.length : 0;
                        return (
                          <div className="flex flex-col gap-1">
                            <span style={{ color: T2 }}>{t('adm.system.senders.levelN').replace('{n}', String(s.level))}</span>
                            {s.level < 5 && (
                              <div style={{ height: 4, borderRadius: 99, background: 'rgb(var(--ink)/0.1)', overflow: 'hidden' }} title={`${vals.filter(Boolean).length}/${vals.length}`}>
                                <div style={{ width: `${Math.max(4, ratio * 100)}%`, height: '100%', background: POS }} />
                              </div>
                            )}
                            {s.rights && (
                              <span style={{ color: T3, fontSize: 11 }}>
                                {s.rights.burst ? t('adm.system.senders.burstOn') : t('adm.system.senders.rights').replace('{d}', fmtNum(s.rights.daily_cap, language)).replace('{h}', fmtNum(s.rights.per_hour, language))}
                              </span>
                            )}
                          </div>
                        );
                      })() : <span style={{ color: T3 }}>—</span>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{fmtNum(s.sent, language)}</td>
                    <td className="py-1.5 text-right tabular-nums">{pct(s.bounced, s.sent)}</td>
                    <td className="py-1.5 text-right tabular-nums">{pct(s.gmail_opened, s.gmail_sent)} / {pct(s.opened - s.gmail_opened, other)}</td>
                    <td className="py-1.5 text-right" style={{ color: frozen ? NEG : POS }}>
                      {frozen
                        ? (s.reason === 'recidive'
                          ? t('adm.system.senders.recidive')
                          : t('adm.system.senders.frozen').replace('{t}', new Date(s.cold_frozen_until as string).toLocaleDateString(language, { day: 'numeric', month: 'short' })))
                        : t('adm.system.senders.ok')}
                      {frozen && (
                        <button type="button" disabled={busy === s.scope_key} onClick={() => { void lift(s); }}
                          className="ml-2 underline cursor-pointer" style={{ color: T2 }}>{t('adm.system.senders.lift')}</button>
                      )}
                    </td>
                    <td className="py-1.5 text-right"><Toggle checked={s.burst_allowed} disabled={busy === s.scope_key} onChange={(v) => { void setBurst(s, v); }} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
