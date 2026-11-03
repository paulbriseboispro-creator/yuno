import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { Inbox } from 'lucide-react';
import { Card, Toggle, Pill, KeyValue, POS, NEG, T2, T3 } from '@/components/admin/ui';
import { fmtNum, fmtRelative } from '@/lib/adminFormat';

interface DayRow { day: string; gmail_sent: number; gmail_opened: number; other_sent: number; other_opened: number }
interface Deliverability {
  gmail_recovery: boolean;
  gmail_engaged_days: number;
  started_at: string;
  gmail_engaged_pool: number;
  gmail_held_30d: number;
  days: DayRow[];
}
interface Watch {
  senders: { scope_key: string; name: string; until: string; reason: string }[];
  waves: { id: string; name: string; state: 'testing' | 'done' | 'halted'; released: number | null; total: number | null;
           note: { cold?: number; sent?: number; bounced?: number; opened?: number; reason?: string } | null }[];
}

const pct = (opened: number, sent: number) => (sent >= 10 ? `${Math.round((1000 * opened) / sent) / 10} %` : '—');

/**
 * Mode reprise Gmail (migration 20261127100000) : chez Gmail, le marketing ne
 * part qu'aux adresses engagées ou fraîchement inscrites. La courbe dit si Gmail
 * remet news.yunoapp.eu en boîte de réception : on la lit jour après jour.
 */
export function GmailRecoveryCard() {
  const { t, language } = useLanguage();
  const [d, setD] = useState<Deliverability | null>(null);
  const [w, setW] = useState<Watch | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data, error }, { data: wd, error: we }] = await Promise.all([
      supabase.rpc('admin_email_deliverability' as never),
      supabase.rpc('admin_email_deliverability_watch' as never),
    ]);
    if (!error) setD(data as unknown as Deliverability);
    if (!we) setW(wd as unknown as Watch);
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (on: boolean) => {
    if (!d) return;
    const reason = window.prompt(t('adm.system.gmail.reason'));
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_set_email_deliverability' as never, {
      p_gmail_recovery: on, p_gmail_engaged_days: d.gmail_engaged_days, p_reason: reason.trim(),
    } as never);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setD(data as unknown as Deliverability);
    toast.success(t('adm.system.gmail.saved'));
  };

  const days = (d?.days ?? []).filter((r) => r.gmail_sent + r.other_sent >= 10).slice(-10);

  return (
    <Card title={t('adm.system.gmail.title')} subtitle={t('adm.system.gmail.sub')} icon={Inbox} accent={!!d?.gmail_recovery}
      right={<div className="flex items-center gap-2">
        {d && <Pill tone={d.gmail_recovery ? 'accent' : 'muted'}>{d.gmail_recovery ? t('adm.system.gmail.on') : t('adm.system.gmail.off')}</Pill>}
        <Toggle checked={!!d?.gmail_recovery} onChange={toggle} disabled={!d || busy} />
      </div>}>
      {d && (
        <>
          <KeyValue rows={[
            { k: t('adm.system.gmail.pool'), v: fmtNum(d.gmail_engaged_pool, language) },
            { k: t('adm.system.gmail.held'), v: fmtNum(d.gmail_held_30d, language) },
            { k: t('adm.system.gmail.window').replace('{n}', String(d.gmail_engaged_days)),
              v: d.gmail_recovery ? t('adm.system.gmail.since').replace('{t}', fmtRelative(d.started_at, language)) : '—' },
          ]} />
          <p style={{ color: T2, fontSize: 12, fontWeight: 600, margin: '14px 0 6px' }}>{t('adm.system.gmail.curve')}</p>
          {days.length === 0 ? (
            <p style={{ color: T3, fontSize: 12, margin: 0 }}>{t('adm.system.gmail.empty')}</p>
          ) : (
            <table className="w-full" style={{ fontSize: 12 }}>
              <thead><tr style={{ color: T3 }}>
                <th className="text-left font-medium py-1">{t('adm.system.gmail.day')}</th>
                <th className="text-right font-medium py-1">{t('adm.system.gmail.gmail')}</th>
                <th className="text-right font-medium py-1">{t('adm.system.gmail.others')}</th>
              </tr></thead>
              <tbody>
                {days.map((r) => {
                  const g = r.gmail_sent >= 10 ? r.gmail_opened / r.gmail_sent : null;
                  const o = r.other_sent >= 10 ? r.other_opened / r.other_sent : null;
                  const spam = g !== null && o !== null && g < 0.05 && o > 0.2;
                  return (
                    <tr key={r.day}>
                      <td className="py-1" style={{ color: T2 }}>{new Date(r.day).toLocaleDateString(language, { day: 'numeric', month: 'short' })}</td>
                      <td className="py-1 text-right tabular-nums" style={{ color: spam ? NEG : g !== null && g > 0.15 ? POS : T2 }}>
                        {pct(r.gmail_opened, r.gmail_sent)} <span style={{ color: T3 }}>· {fmtNum(r.gmail_sent, language)}</span>
                      </td>
                      <td className="py-1 text-right tabular-nums" style={{ color: T2 }}>
                        {pct(r.other_opened, r.other_sent)} <span style={{ color: T3 }}>· {fmtNum(r.other_sent, language)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.5, margin: '10px 0 0' }}>{t('adm.system.gmail.read')}</p>
          <p style={{ color: T2, fontSize: 12, fontWeight: 600, margin: '14px 0 6px' }}>{t('adm.system.gmail.senders')}</p>
          {(w?.senders ?? []).filter((x) => new Date(x.until).getTime() > Date.now()).length === 0 ? (
            <p style={{ color: T3, fontSize: 12, margin: 0 }}>{t('adm.system.gmail.sendersNone')}</p>
          ) : (w?.senders ?? []).filter((x) => new Date(x.until).getTime() > Date.now()).map((x) => (
            <p key={x.scope_key} style={{ color: T2, fontSize: 12, margin: '2px 0' }}>
              <span style={{ color: NEG }}>●</span> {x.name} · {x.reason} · {t('adm.system.gmail.until').replace('{t}', new Date(x.until).toLocaleDateString(language, { day: 'numeric', month: 'short' }))}
            </p>
          ))}
          <p style={{ color: T2, fontSize: 12, fontWeight: 600, margin: '14px 0 6px' }}>{t('adm.system.gmail.waves')}</p>
          {(w?.waves ?? []).length === 0 ? (
            <p style={{ color: T3, fontSize: 12, margin: 0 }}>{t('adm.system.gmail.wavesNone')}</p>
          ) : (w?.waves ?? []).slice(0, 8).map((x) => (
            <p key={x.id} style={{ color: T2, fontSize: 12, margin: '2px 0' }}>
              <span style={{ color: x.state === 'halted' ? NEG : x.state === 'done' ? POS : T3 }}>●</span> {x.name}
              {' · '}{t(`adm.system.gmail.wave.${x.state}`).replace('{r}', String(x.released ?? 0)).replace('{t}', String(x.total ?? 0))}
              {' · '}{t('adm.system.gmail.waveStats')
                .replace('{cold}', fmtNum(x.note?.cold ?? 0, language)).replace('{sent}', fmtNum(x.note?.sent ?? 0, language))
                .replace('{b}', fmtNum(x.note?.bounced ?? 0, language)).replace('{o}', fmtNum(x.note?.opened ?? 0, language))}
              {x.note?.reason ? ` · ${x.note.reason}` : ''}
            </p>
          ))}
        </>
      )}
    </Card>
  );
}
