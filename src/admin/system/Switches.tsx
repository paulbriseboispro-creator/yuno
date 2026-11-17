/**
 * Système › Interrupteurs : « Qu'est-ce que je peux couper, et qu'est-ce que
 * ça coupe ? » Maintenance et Paiements (motif obligatoire, au journal),
 * canaux de Yuno CRM, registre des notifications automatiques. Chaque
 * interrupteur dit en une phrase ce qu'il coupe.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Block, Dialog, Page, useAdminT } from '@/admin/ui';
import { fmtRelative } from '@/lib/adminFormat';
import { useAdminPricing } from '@/crm/admin/data';
import { NotificationRegistry } from './NotificationRegistry';
import { useReasonAction } from '../comms/reason';
import { rpc, useAppSettings, useSwitchLog } from './data';
import { Cutoff, Ledger, StateMark, Verdict } from '../legal/parts';

const CHANNELS = ['email', 'sms', 'whatsapp', 'instagram'] as const;

/** Un interrupteur = une ligne nette : ce qu'il coupe en une phrase, son état, qui l'a changé en dernier, le geste. */
function SwitchRow({ title, cuts, on, onLabel, offLabel, actionLabel, danger, onAction, extra, last }: {
  title: string; cuts: string; on: boolean; onLabel: string; offLabel: string; actionLabel: string; danger?: boolean; onAction: () => void; extra?: React.ReactNode; last?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 items-center gap-x-6 gap-y-2 px-1 py-4 md:grid-cols-[minmax(0,1fr)_120px_190px_auto]">
      <div className="min-w-0">
        <div className="a-t1 text-[14px] font-medium">{title}</div>
        <p className="a-t2 mt-0.5 max-w-[70ch] text-[13px] leading-relaxed">{cuts}</p>
        {extra}
      </div>
      <StateMark tone={on ? 'ok' : 'none'}>{on ? onLabel : offLabel}</StateMark>
      <span className="a-t3 text-[12px]">{last ?? ''}</span>
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

  // Dernier changement et auteur de chaque interrupteur plateforme, lus dans le journal d'audit.
  const lastOf = (key: string) => {
    const r = (log.data ?? []).find((x) => x.entity_id === key);
    return r ? t('adm.sys3.sw.last', { t: fmtRelative(r.created_at, lang) }) : t('adm.sys3.sw.never');
  };
  const platformOn = !!s && !s.maintenance_mode && !s.payments_disabled;

  return (
    <Page title={t('adm.sys.sw.title')} subtitle={t('adm.sys.sw.sub')}>
      {!s ? <div className="a-skel h-10 w-[24rem] max-w-full" /> : (
        <Verdict tone={platformOn ? 'ok' : 'late'} kicker={t('adm.sys3.sw.kicker')}
          headline={platformOn ? t('adm.sys3.sw.allOn') : s.maintenance_mode && s.payments_disabled ? t('adm.sys3.sw.both') : s.maintenance_mode ? t('adm.sys3.sw.maint') : t('adm.sys3.sw.pay')}
          sub={t('adm.sys3.sw.sub')} />
      )}

      <Block title={t('adm.sys.sw.platform')} meta={t('adm.sys3.sw.platformMeta')}>
        <Ledger>
          <SwitchRow title={t('adm.sys.sw.maint.title')} cuts={t('adm.sys.sw.maint.cuts')} on={!s?.maintenance_mode} last={lastOf('maintenance_mode')}
            onLabel={t('adm.sys.sw.maint.off')} offLabel={t('adm.sys.sw.maint.on')}
            actionLabel={t(s?.maintenance_mode ? 'adm.sys.sw.maint.turnOff' : 'adm.sys.sw.maint.turnOn')} danger={!s?.maintenance_mode} onAction={toggleMaintenance}
            extra={<button type="button" className="a-t3 mt-1.5 text-[12.5px] underline" onClick={() => setPwOpen(true)}>{t('adm.sys.sw.maint.pwLink')}</button>} />
          <SwitchRow title={t('adm.sys.sw.pay.title')} cuts={t('adm.sys.sw.pay.cuts')} on={!s?.payments_disabled} last={lastOf('payments_disabled')}
            onLabel={t('adm.sys.sw.pay.on')} offLabel={t('adm.sys.sw.pay.off')}
            actionLabel={t(s?.payments_disabled ? 'adm.sys.sw.pay.resume' : 'adm.sys.sw.pay.cut')} danger={!s?.payments_disabled} onAction={togglePayments} />
        </Ledger>
      </Block>

      <Block title={t('adm.sys.sw.channels')} meta={t('adm.sys.sw.channelsSub')}>
        <Ledger>
          {CHANNELS.map((c) => {
            const on = !!pricing.data?.cfg.channels_live[c];
            return (
              <SwitchRow key={c} title={t(`adm.sys.sw.ch.${c}`)} cuts={t('adm.sys.sw.ch.cuts', { c: t(`adm.sys.sw.ch.${c}`) })} on={on}
                onLabel={t('adm.sys.sw.ch.live')} offLabel={t('adm.sys.sw.ch.notLive')} actionLabel={t(on ? 'adm.sys.sw.ch.close' : 'adm.sys.sw.ch.open')} danger={on} onAction={() => toggleChannel(c)} />
            );
          })}
        </Ledger>
        <p className="a-t3 text-[12.5px]">{t('adm.sys.sw.ch.note')}</p>
      </Block>

      <Block title={t('adm.sys.sw.registry')} meta={t('adm.sys.sw.registrySub')}>
        <NotificationRegistry />
      </Block>

      <Block title={t('adm.sys.sw.log')} meta={t('adm.sys3.sw.logMeta')}>
        {(log.data ?? []).length === 0 ? <Cutoff>{t('adm.sys.sw.logNone')}</Cutoff> : (
          <Ledger>
            {log.data!.map((r) => (
              <div key={r.id} className="grid grid-cols-1 items-baseline gap-x-4 px-1 py-2.5 text-[13px] md:grid-cols-[150px_minmax(0,1fr)_110px]">
                <StateMark tone={r.metadata?.enabled ? 'todo' : 'ok'}>{r.entity_id === 'maintenance_mode' ? t('adm.sys.sw.maint.title') : t('adm.sys.sw.pay.title')}</StateMark>
                <span className="a-t1 min-w-0">{r.metadata?.reason ?? '—'}</span>
                <span className="a-mono a-t3 text-[11px]">{fmtRelative(r.created_at, lang)}</span>
              </div>
            ))}
          </Ledger>
        )}
      </Block>

      {dialog}
      <Dialog open={pwOpen} onOpenChange={setPwOpen} title={t('adm.sys.sw.maint.pwTitle')} description={t('adm.sys.sw.maint.pwDesc')}
        confirmLabel={t('adm.sys.save')} onConfirm={() => void savePassword()}>
        <input className="a-input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </Dialog>
    </Page>
  );
}
