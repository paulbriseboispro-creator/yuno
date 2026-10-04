/**
 * « Écrire à… » (Clients, Segments) : choisir le canal, voir qui recevra le
 * message, ce qu'il coûte en Yunits et ce qu'il restera. « Préparer le
 * message » garde l'audience pour l'éditeur (e-mail : galerie de modèles ;
 * SMS : composeur) — rien ne part d'ici.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Modal, PillButton } from '@/crm/ui/kit';
import { useCrmT } from '@/crm/i18n';
import { useCrmShell } from '@/crm/data/shell';
import { setPendingAudience, useAudienceCount } from '@/crm/data/clients';
import type { ClientFilterDef } from '@/crm/data/clients';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { SMS_MARKETING_LIVE } from '@/lib/smsMarketing';

export type WriteScope = 'one' | 'sel' | 'filtered' | 'all';

export function WriteModal({
  open, onClose, scope, who, def, emails, segmentId, eyebrow,
}: {
  open: boolean;
  onClose: () => void;
  scope: WriteScope;
  /** « Camille » pour un client, sinon « 1 284 clients ». */
  who: string;
  def?: ClientFilterDef | null;
  emails?: string[] | null;
  segmentId?: string | null;
  /** Remplace le surtitre (« Segment · Habitués »). */
  eyebrow?: string;
}) {
  const { t, tp, n } = useCrmT();
  const nav = useNavigate();
  const [ch, setCh] = useState<'email' | 'sms'>('email');
  const shell = useCrmShell();
  const counts = useAudienceCount(def ?? null, emails ?? null, open);
  const rates = shell.data?.wallet.rates ?? { email: 1, sms: 40 };
  const balance = shell.data?.wallet.balance ?? 0;
  const total = counts.data?.total ?? 0;
  const mail = counts.data?.email ?? 0;
  const sms = counts.data?.sms ?? 0;
  const reach = ch === 'email' ? mail : sms;
  const cost = reach * (ch === 'email' ? rates.email ?? 1 : rates.sms ?? 40);
  const left = balance - cost;
  const short = left < 0;
  const none = !counts.isLoading && reach === 0;
  const blocked = none || short || counts.isLoading;
  const chLabel = t(ch === 'email' ? 'yc.cli.msg.ch.email' : 'yc.cli.msg.ch.sms');

  const go = () => {
    if (blocked) return;
    setPendingAudience({
      channel: ch,
      label: who,
      def: def ?? undefined,
      emails: emails ?? undefined,
      segmentId: segmentId ?? undefined,
      count: reach,
    });
    onClose();
    nav(ch === 'email' ? `${CRM_ROUTES.emailTemplates}?from=audience` : CRM_ROUTES.smsCompose('new'));
  };

  const scopeLabel = eyebrow ?? t(`yc.cli.msg.scope.${scope}`);
  const chs: { k: 'email' | 'sms'; l: string; n: number; s: string }[] = [
    { k: 'email', l: 'E-mail', n: mail, s: t('yc.cli.msg.reachable', { rate: t('yc.cli.msg.rate.email') }) },
    { k: 'sms', l: 'SMS', n: sms, s: t('yc.cli.msg.reachable', { rate: t('yc.cli.msg.rate.sms', { n: rates.sms ?? 40 }) }) },
  ];

  return (
    <Modal open={open} onClose={onClose} width={520} label={t('yc.cli.msg.title', { who })}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '26px 28px 8px' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{scopeLabel}</span>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 28, lineHeight: 1.08, letterSpacing: '-.03em' }}>{t('yc.cli.msg.title', { who })}</h2>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '12px 28px 24px' }}>
        <div role="group" aria-label={t('yc.cli.msg.channel')} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {chs.map((x) => {
            const on = ch === x.k;
            return (
              <Hv
                key={x.k}
                as="button"
                type="button"
                onClick={() => setCh(x.k)}
                aria-pressed={on}
                style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2, padding: '14px 16px', borderRadius: 18, border: `1.5px solid ${on ? 'var(--ink)' : 'var(--sand-200)'}`, background: on ? 'var(--sand-50)' : '#fff', cursor: 'pointer', transition: 'border-color 160ms,background 160ms' }}
                hover={{ borderColor: 'var(--sand-400)' }}
              >
                <span style={{ fontSize: 15, fontWeight: 600 }}>{x.l}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em', lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>{counts.isLoading ? '…' : n(x.n)}</span>
                <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{x.s}</span>
              </Hv>
            );
          })}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14.5 }}>
          <Line l={t('yc.cli.msg.will')} v={n(reach)} />
          <Line l={t('yc.cli.msg.excluded', { ch: chLabel })} v={n(Math.max(0, total - reach))} muted />
          <div style={{ paddingTop: 10, borderTop: '1px solid var(--sand-100)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Line l={t('yc.cli.msg.cost')} v={tp('yc.cli.msg.yunits', cost, { n: n(cost) })} />
            <Line l={t('yc.cli.msg.left')} v={short ? `— ${n(-left)}` : tp('yc.cli.msg.yunits', left, { n: n(left) })} color={short ? 'var(--amber-700)' : 'var(--ink)'} />
          </div>
        </div>
        {short && !none && (
          <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 14, lineHeight: 1.45, fontWeight: 500 }}>
            {t('yc.cli.msg.short', { n: n(-left), x: Math.round((rates.sms ?? 40) / (rates.email ?? 1)) })}
          </div>
        )}
        {none && (
          <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--sand-50)', color: 'var(--sand-600)', fontSize: 14, lineHeight: 1.45 }}>
            {t('yc.cli.msg.none', { ch: chLabel })}
          </div>
        )}
        {ch === 'sms' && !SMS_MARKETING_LIVE && !none && (
          <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--sand-50)', color: 'var(--sand-600)', fontSize: 14, lineHeight: 1.45 }}>
            {t('yc.cli.msg.smsSoon')}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '16px 28px', background: 'var(--sand-50)', borderTop: '1px solid var(--sand-100)', borderRadius: '0 0 28px 28px' }}>
        <Hv as="button" type="button" onClick={onClose} style={{ height: 44, padding: '0 18px', borderRadius: 99, border: 0, background: 'none', fontSize: 14.5, fontWeight: 600, color: 'var(--sand-600)', cursor: 'pointer' }} hover={{ color: 'var(--ink)' }}>
          {t('yc.common.cancel')}
        </Hv>
        <div style={{ display: 'flex', gap: 8 }}>
          {short && !none && <PillButton to={CRM_ROUTES.yunits}>{t('yc.cli.msg.recharge')}</PillButton>}
          <button
            type="button"
            onClick={go}
            disabled={blocked}
            style={{
              height: 44, padding: '0 22px', borderRadius: 99, border: 0, fontSize: 14.5, fontWeight: 600,
              background: blocked ? 'var(--sand-100)' : 'var(--gradient-brand)', color: blocked ? 'var(--sand-400)' : '#fff',
              cursor: blocked ? 'not-allowed' : 'pointer', boxShadow: blocked ? 'none' : 'var(--shadow-cta)',
            }}
          >
            {t('yc.cli.msg.prepare')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Line({ l, v, muted, color }: { l: string; v: string; muted?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--sand-600)' }}>{l}</span>
      <b style={{ fontVariantNumeric: 'tabular-nums', color: color ?? (muted ? 'var(--sand-500)' : 'var(--ink)') }}>{v}</b>
    </div>
  );
}
