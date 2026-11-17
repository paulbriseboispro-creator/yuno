/**
 * Système › Interrupteurs : « Qu'est-ce que je peux couper, et qu'est-ce que
 * ça coupe ? » Maintenance et Paiements (motif obligatoire, au journal),
 * canaux de Yuno CRM, registre des notifications automatiques. Chaque
 * interrupteur dit en une phrase ce qu'il coupe.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Card, Dialog, Page, Section, Status, useAdminT } from '@/admin/ui';
import { fmtRelative } from '@/lib/adminFormat';
import { useAdminPricing } from '@/crm/admin/data';
import { NotificationRegistry } from './NotificationRegistry';
import { useReasonAction } from '../comms/reason';
import { rpc, useAppSettings, useSwitchLog } from './data';

const CHANNELS = ['email', 'sms', 'whatsapp', 'instagram'] as const;

function SwitchRow({ title, cuts, on, onLabel, offLabel, actionLabel, danger, onAction, extra }: {
  title: string; cuts: string; on: boolean; onLabel: string; offLabel: string; actionLabel: string; danger?: boolean; onAction: () => void; extra?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b py-3.5 last:border-b-0">
      <div className="min-w-[260px] flex-1">
        <div className="a-t1 flex items-center gap-2 text-[14px] font-medium">{title}<Status tone={on ? 'positive' : 'neutral'}>{on ? onLabel : offLabel}</Status></div>
        <p className="a-t2 mt-1 max-w-[70ch] text-[13px] leading-relaxed">{cuts}</p>
        {extra}
      </div>
      <button type="button" className={`a-btn a-btn--sm ${danger ? 'a-btn--danger' : ''}`} onClick={onAction}>{actionLabel}</button>
    </div>
  );
}

export default function Switches() {
  const { t, lang } = useAdminT();
  const qc = useQueryClient();
  const settings = useAppSettings();
  const log = useSwitchLog();
  const pricing = useAdminPricing();
  const { ask, dialog } = useReasonAction(['admin']);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const s = settings.data;

  const toggleMaintenance = () => {
    if (!s) return;
    const next = !s.maintenance_mode;
    ask({
      children: next ? (
        <label className="flex flex-col gap-1.5">
          <span className="a-t1 text-[12.5px] font-medium">{t('adm.sys.sw.maint.msg')}</span>
          <textarea id="maint-msg" className="a-input" rows={2} defaultValue={s.maintenance_message ?? ''} placeholder={t('adm.sys.sw.maint.msgPh')} />
        </label>
      ) : undefined,
      title: t(next ? 'adm.sys.sw.maint.onTitle' : 'adm.sys.sw.maint.offTitle'),
      description: t(next ? 'adm.sys.sw.maint.onDesc' : 'adm.sys.sw.maint.offDesc'),
      tone: next ? 'danger' : 'primary',
      run: (reason) => rpc('admin_set_platform_switch', { p_key: 'maintenance_mode', p_enabled: next, p_reason: reason, p_message: next ? (document.getElementById('maint-msg') as HTMLTextAreaElement | null)?.value || null : null }),
    });
  };
  const togglePayments = () => {
    if (!s) return;
    const cut = !s.payments_disabled;
    ask({
      title: t(cut ? 'adm.sys.sw.pay.cutTitle' : 'adm.sys.sw.pay.resumeTitle'),
      description: t(cut ? 'adm.sys.sw.pay.cutDesc' : 'adm.sys.sw.pay.resumeDesc'),
      tone: cut ? 'danger' : 'primary',
      run: (reason) => rpc('admin_set_platform_switch', { p_key: 'payments_disabled', p_enabled: cut, p_reason: reason }),
    });
  };
  const toggleChannel = (c: (typeof CHANNELS)[number]) => {
    const cfg = pricing.data?.cfg;
    if (!cfg) return;
    const next = !cfg.channels_live[c];
    ask({
      title: t(next ? 'adm.sys.sw.ch.onTitle' : 'adm.sys.sw.ch.offTitle', { c: t(`adm.sys.sw.ch.${c}`) }),
      description: t('adm.sys.sw.ch.desc'),
      tone: next ? 'primary' : 'danger',
      run: async (reason) => {
        await rpc('crm_admin_pricing_set', { p_patch: { channels_live: { ...cfg.channels_live, [c]: next } }, p_reason: reason });
        await qc.invalidateQueries({ queryKey: ['crm-admin'] });
      },
    });
  };
  const savePassword = async () => {
    if (!pw.trim()) return;
    try { await rpc('update_maintenance_password', { new_password: pw.trim() }); toast.success(t('adm.sys.sw.maint.pwSaved')); setPw(''); setPwOpen(false); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Page title={t('adm.sys.sw.title')} subtitle={t('adm.sys.sw.sub')}>
      <Section title={t('adm.sys.sw.platform')}>
        <Card>
          <SwitchRow title={t('adm.sys.sw.maint.title')} cuts={t('adm.sys.sw.maint.cuts')} on={!!s?.maintenance_mode}
            onLabel={t('adm.sys.sw.maint.on')} offLabel={t('adm.sys.sw.maint.off')}
            actionLabel={t(s?.maintenance_mode ? 'adm.sys.sw.maint.turnOff' : 'adm.sys.sw.maint.turnOn')} danger={!s?.maintenance_mode} onAction={toggleMaintenance}
            extra={<button type="button" className="a-t3 mt-1.5 text-[12.5px] underline" onClick={() => setPwOpen(true)}>{t('adm.sys.sw.maint.pwLink')}</button>} />
          <SwitchRow title={t('adm.sys.sw.pay.title')} cuts={t('adm.sys.sw.pay.cuts')} on={!s?.payments_disabled}
            onLabel={t('adm.sys.sw.pay.on')} offLabel={t('adm.sys.sw.pay.off')}
            actionLabel={t(s?.payments_disabled ? 'adm.sys.sw.pay.resume' : 'adm.sys.sw.pay.cut')} danger={!s?.payments_disabled} onAction={togglePayments} />
        </Card>
      </Section>

      <Section title={t('adm.sys.sw.channels')} description={t('adm.sys.sw.channelsSub')}>
        <Card>
          {CHANNELS.map((c) => {
            const on = !!pricing.data?.cfg.channels_live[c];
            return (
              <SwitchRow key={c} title={t(`adm.sys.sw.ch.${c}`)} cuts={t('adm.sys.sw.ch.cuts', { c: t(`adm.sys.sw.ch.${c}`) })} on={on}
                onLabel={t('adm.sys.sw.ch.live')} offLabel={t('adm.sys.sw.ch.notLive')} actionLabel={t(on ? 'adm.sys.sw.ch.close' : 'adm.sys.sw.ch.open')} danger={on} onAction={() => toggleChannel(c)} />
            );
          })}
          <p className="a-t3 pt-3 text-[12.5px]">{t('adm.sys.sw.ch.note')}</p>
        </Card>
      </Section>

      <Section title={t('adm.sys.sw.registry')} description={t('adm.sys.sw.registrySub')}>
        <NotificationRegistry />
      </Section>

      <Section title={t('adm.sys.sw.log')}>
        <Card padded={false}>
          {(log.data ?? []).length === 0 ? <p className="a-t3 p-4 text-[13px]">{t('adm.sys.sw.logNone')}</p> : (
            <ul>
              {log.data!.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-[13px] last:border-b-0">
                  <Badge tone={r.metadata?.enabled ? 'warning' : 'positive'}>{r.entity_id === 'maintenance_mode' ? t('adm.sys.sw.maint.title') : t('adm.sys.sw.pay.title')}</Badge>
                  <span className="a-t1 min-w-0 flex-1">{r.metadata?.reason ?? '—'}</span>
                  <span className="a-t3 text-[12px]">{fmtRelative(r.created_at, lang)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      {dialog}
      <Dialog open={pwOpen} onOpenChange={setPwOpen} title={t('adm.sys.sw.maint.pwTitle')} description={t('adm.sys.sw.maint.pwDesc')}
        confirmLabel={t('adm.sys.save')} onConfirm={() => void savePassword()}>
        <input className="a-input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </Dialog>
    </Page>
  );
}
