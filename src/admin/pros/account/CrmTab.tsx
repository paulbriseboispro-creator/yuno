/**
 * Fiche d'un pro : onglet CRM. Tout vient de crm_admin_account (santé, mise
 * en route, usage, Yunits, synchros, envois), rien n'est recalculé ici.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { Badge, EmptyState, ErrorState, Grid, KeyValue, ReasonDialog, Section, Status, Timeline, useAdminT, Block, StatCell, StatRow } from '@/admin/ui';
import { fmtDate, fmtEur, fmtNum, fmtRelative } from '@/lib/adminFormat';
import { PROS_QK, type AccountCard } from '../data';
import { CrmGestures } from '../gestures';

const OB_KEYS = ['conn', 'import', 'files', 'sender', 'sent', 'recipe', 'team'] as const;
const H_KEYS = ['onboarding', 'activity', 'presence', 'sync'] as const;
const H_MAX = [40, 30, 15, 15];

export function CrmTab({ card }: { card: AccountCard }) {
  const { t, lang, label } = useAdminT();
  const crm = card.crm;
  if (!crm || crm.error || !crm.account) {
    return <div>{crm?.error ? <ErrorState /> : <EmptyState title={t('adm.pros.crm.none')} />}</div>;
  }
  const a = crm.account;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Status tone={a.state === 'paid' ? 'positive' : a.state === 'late' ? 'negative' : a.state === 'trial' ? 'accent' : 'neutral'}>{t(`adm.pros.crm.${a.state}`)}</Status>
        {a.founder && <Badge tone="accent">{t('adm.pros.crm.founder')}</Badge>}
        {a.granted && <Badge>{t('adm.pros.crm.granted')}</Badge>}
        {a.frozen_at && <Badge tone="negative">{t('adm.pros.crm.frozen')}</Badge>}
        <span className="flex-1" />
        <CrmGestures card={card} />
      </div>

      <StatRow>
        <StatCell label={t('adm.pros.k.crmHealth')} value={`${a.health}/100`} hint={t('adm.pros.k.crmHealthHint')} />
        <StatCell label="MRR" value={fmtEur(a.mrr, lang)} hint={t('adm.pros.crm.mrrHint')} />
        <StatCell label="Yunits" value={fmtNum(a.balance, lang)} />
        <StatCell label={t('adm.pros.crm.reach')} value={fmtNum(a.reach, lang)} hint={t('adm.pros.crm.reachHint', { n: fmtNum(a.contacts, lang) })} />
        <StatCell label={t('adm.pros.crm.sends30')} value={fmtNum(a.sends30, lang)} />
      </StatRow>

      <Grid cols={2} className="gap-x-10 gap-y-8">
        <Block title={t('adm.pros.crm.subscription')}>
          <KeyValue items={[
            { label: t('adm.pros.crm.state'), value: t(`adm.pros.crm.${a.state}`) },
            ...(a.trial_ends_at ? [{ label: t('adm.pros.crm.trialEnds'), value: `${fmtDate(a.trial_ends_at, lang, 'long')}${a.trial_left != null ? ` (${t('adm.pros.crm.daysLeft', { n: a.trial_left })})` : ''}` }] : []),
            ...(a.period_end ? [{ label: t('adm.pros.crm.periodEnd'), value: fmtDate(a.period_end, lang, 'long') }] : []),
            { label: t('adm.pros.crm.interval'), value: a.interval ? t(`adm.pros.crm.int.${a.interval}`) : '—' },
            { label: t('adm.pros.crm.trialExt'), value: t('adm.pros.crm.trialExtV', { used: crm.trial_ext.used, free: crm.trial_ext.free }) },
            { label: t('adm.pros.crm.buys'), value: `${fmtNum(a.buys, lang)} · ${fmtEur(a.buys_eur, lang)}` },
            ...(a.frozen_at ? [{ label: t('adm.pros.crm.frozen'), value: `${fmtDate(a.frozen_at, lang)} · ${a.frozen_reason ?? ''}` }] : []),
          ]} />
        </Block>
        <Block title={t('adm.pros.crm.health')}>
          <div className="flex flex-col gap-2.5">
            {H_KEYS.map((k, i) => (
              <div key={k} className="flex items-center gap-3 text-[12.5px]">
                <span className="a-t2 w-32 flex-none">{t(`adm.pros.crm.h.${k}`)}</span>
                <div className="a-subtle h-2 flex-1 overflow-hidden rounded-full"><div className="h-full rounded-full" style={{ width: `${Math.round(100 * (a.h?.[i] ?? 0) / H_MAX[i])}%`, background: 'var(--a-accent)' }} /></div>
                <span className="a-num a-t1 w-12 text-right">{a.h?.[i] ?? 0}/{H_MAX[i]}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {OB_KEYS.map((k, i) => <Badge key={k} tone={a.ob?.[i] ? 'positive' : 'neutral'}>{t(`adm.pros.crm.ob.${k}`)}</Badge>)}
          </div>
        </Block>
      </Grid>

      <Grid cols={2} className="gap-x-10 gap-y-8">
        <Block title={t('adm.pros.crm.sync')}>
          <KeyValue items={[
            { label: t('adm.pros.crm.provider'), value: a.provider ?? '—' },
            { label: t('adm.pros.crm.syncState'), value: <Status tone={a.sync === 'ok' ? 'positive' : a.sync === 'error' ? 'negative' : 'neutral'}>{t(`adm.pros.crm.sync.${a.sync}`)}</Status> },
            { label: t('adm.pros.crm.syncAt'), value: a.sync_at ? fmtRelative(a.sync_at, lang) : '—' },
            ...(a.sync_error ? [{ label: t('adm.pros.crm.syncError'), value: <span className="a-mono text-[12px]">{a.sync_error}</span> }] : []),
          ]} />
          {crm.runs.length > 0 && (
            <div className="mt-3 flex flex-col gap-1">
              {crm.runs.slice(0, 8).map((r, i) => (
                <div key={i} className="a-t2 flex gap-3 text-[12px]">
                  <span className="a-num w-28">{fmtDate(r.at, lang, 'datetime')}</span>
                  <Status tone={r.status === 'ok' || r.status === 'done' ? 'positive' : r.status === 'error' ? 'negative' : 'neutral'}>{label(r.status)}</Status>
                  <span className="a-num">{fmtNum(r.tickets, lang)} {t('adm.pros.crm.tickets')}</span>
                </div>
              ))}
            </div>
          )}
        </Block>
        <SmsAccess scopeKey={card.key} />
      </Grid>

      <Section title={t('adm.pros.crm.sends')}>
        <div className="divide-y border-y">
          {crm.sends.length === 0 ? <EmptyState title={t('adm.pros.crm.noSends')} /> : crm.sends.map((s, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              <span className="a-t1 min-w-0 flex-1 truncate">{s.name}</span>
              <Badge>{label(s.status)}</Badge>
              <span className="a-num a-t2 w-20 text-right">{fmtNum(s.recipients ?? 0, lang)}</span>
              <span className="a-num a-t3 w-28 text-right">{fmtDate(s.at, lang)}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t('adm.pros.crm.moves')}>
        <div className="">
          <Timeline items={crm.moves.slice(0, 20).map((m, i) => ({
            id: String(i), at: m.at, tone: m.delta >= 0 ? 'positive' : 'neutral',
            title: <span className="a-num">{m.delta > 0 ? '+' : ''}{fmtNum(m.delta, lang)} Yunits</span>,
            body: [m.label, m.lot_kind, m.channel].filter(Boolean).join(' · '),
          }))} />
        </div>
      </Section>
    </div>
  );
}

interface SmsAccessRow { status: 'none' | 'requested' | 'granted' | 'declined'; use_cases?: string[]; volume?: string | null; sender_wish?: string | null; requested_at?: string | null; decided_at?: string | null; decision_reason?: string | null }

/** Accès SMS du compte (bêta privée) : même RPC que l'ex-Admin CRM. */
function SmsAccess({ scopeKey }: { scopeKey: string }) {
  const { t, lang } = useAdminT();
  const [open, setOpen] = useState<null | 'granted' | 'declined'>(null);
  const q = useQuery({ queryKey: [PROS_QK, 'sms', scopeKey], queryFn: () => rpc<SmsAccessRow>('crm_admin_sms_access', { p_scope_key: scopeKey }) });
  const s = q.data;
  return (
    <Block title={t('adm.pros.crm.smsTitle')}>
      {q.error ? <ErrorState onRetry={() => void q.refetch()} /> : !s ? <div className="a-skel h-16" /> : (
        <>
          <KeyValue items={[
            { label: t('adm.pros.crm.state'), value: <Status tone={s.status === 'granted' ? 'positive' : s.status === 'requested' ? 'warning' : s.status === 'declined' ? 'negative' : 'neutral'}>{t(`adm.pros.crm.sms.${s.status}`)}</Status> },
            ...(s.requested_at ? [{ label: t('adm.pros.crm.smsAsked'), value: fmtDate(s.requested_at, lang, 'long') }] : []),
            ...(s.sender_wish ? [{ label: t('adm.pros.crm.smsSender'), value: s.sender_wish }] : []),
            ...(s.volume ? [{ label: t('adm.pros.crm.smsVolume'), value: s.volume }] : []),
            ...(s.decision_reason ? [{ label: t('adm.pros.crm.smsReason'), value: s.decision_reason }] : []),
          ]} />
          <div className="mt-3 flex gap-2">
            {s.status !== 'granted' && <button type="button" className="a-btn a-btn--sm" onClick={() => setOpen('granted')}>{t('adm.pros.crm.smsGrant')}</button>}
            {s.status !== 'declined' && <button type="button" className="a-btn a-btn--sm" onClick={() => setOpen('declined')}>{t(s.status === 'granted' ? 'adm.pros.crm.smsClose' : 'adm.pros.crm.smsDecline')}</button>}
          </div>
        </>
      )}
      <ReasonDialog open={!!open} onOpenChange={(v) => { if (!v) setOpen(null); }} tone={open === 'declined' ? 'danger' : 'primary'}
        title={t(open === 'granted' ? 'adm.pros.crm.smsGrant' : 'adm.pros.crm.smsDecline')} description={t('adm.pros.crm.smsBody')}
        onConfirm={async (reason) => {
          await rpc('crm_admin_sms_access_set', { p_scope_key: scopeKey, p_status: open, p_reason: reason });
          toast.success(t('adm.pros.g.saved'));
          void q.refetch();
        }} />
    </Block>
  );
}
