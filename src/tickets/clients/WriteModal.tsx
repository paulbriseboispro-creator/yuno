/**
 * « Écrire à… » de Yuno Tickets (Clients, Segments) — le dessin de la fenêtre
 * du CRM (src/crm/components/WriteModal.tsx) : choisir le canal, voir qui
 * recevra le message. Décision de Paul du 22/10 : le message part DÉJÀ ciblé.
 *
 *   E-mail : l'audience `{kind: 'tix', segmentId | def}` est gardée pour la
 *            galerie « Nouvelle campagne » (`?aud=tix`), qui crée le brouillon
 *            avec elle ; l'étape Audience du Studio la montre, modifiable.
 *   SMS    : seulement un segment enregistré (le moteur SMS vise des
 *            segments) : l'éditeur SMS s'ouvre sur ce segment.
 *
 * Pas de Yunits (monnaie du CRM) : l'envoi suit les quotas de la Console.
 * Rien ne part d'ici ; le consentement est relu à l'envoi.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Modal } from '@/tickets/analytics/kit';
import { useTixT } from '@/tickets/analytics/i18n';
import { setPendingAudience, useAudienceCount } from '@/tickets/clients/data/clients';
import type { ClientFilterDef } from '@/tickets/clients/data/clients';
import { useTixClientRoutes } from '@/tickets/clients/routes';
import { useTixCaps } from '@/tickets/clients/scope';

export type WriteScope = 'one' | 'sel' | 'filtered' | 'all';

export function WriteModal({
  open, onClose, scope, who, def, emails, segmentId, eyebrow, eventId,
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
  /** Soirée annoncée : le brouillon lui sera relié. */
  eventId?: string | null;
}) {
  const R = useTixClientRoutes();
  const { t, n } = useTixT();
  const nav = useNavigate();
  const [ch, setCh] = useState<'email' | 'sms'>('email');
  const counts = useAudienceCount(def ?? null, emails ?? null, open);
  const total = counts.data?.total ?? 0;
  const mail = counts.data?.email ?? 0;
  const sms = counts.data?.sms ?? 0;
  const reach = ch === 'email' ? mail : sms;
  const none = !counts.isLoading && reach === 0;
  const caps = useTixCaps();
  // Le moteur SMS vise des segments enregistrés (segment_filters.type 'tix_segment').
  const smsNeedsSegment = ch === 'sms' && !segmentId;
  const blocked = none || counts.isLoading || !caps.send || smsNeedsSegment;
  const chLabel = t(ch === 'email' ? 'ya.cli.msg.ch.email' : 'ya.cli.msg.ch.sms');

  const go = () => {
    if (blocked) return;
    if (ch === 'email') {
      setPendingAudience({
        channel: 'email',
        label: who,
        def: segmentId ? undefined : emails ? { seg: 'all', f: { emails } } : def ?? undefined,
        segmentId: segmentId ?? undefined,
        eventId: eventId ?? undefined,
        count: reach,
      });
      onClose();
      nav(`${R.campaigns}/new?aud=tix${eventId ? `&event=${eventId}` : ''}`);
      return;
    }
    onClose();
    nav(`${R.sms}?compose=1&tixseg=${segmentId}`);
  };

  const scopeLabel = eyebrow ?? t(`ya.cli.msg.scope.${scope}`);
  const chs: { k: 'email' | 'sms'; l: string; n: number; s: string }[] = [
    { k: 'email', l: 'E-mail', n: mail, s: t('ya.cli.msg.reachableTix') },
    { k: 'sms', l: 'SMS', n: sms, s: t('ya.cli.msg.reachableTix') },
  ];

  return (
    <Modal open={open} onClose={onClose} width={520} label={t('ya.cli.msg.title', { who })}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '26px 28px 8px' }}>
        <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>{scopeLabel}</span>
        <h2 style={{ margin: 0, fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 28, lineHeight: 1.08, letterSpacing: '-.03em' }}>{t('ya.cli.msg.title', { who })}</h2>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '12px 28px 24px' }}>
        <div role="group" aria-label={t('ya.cli.msg.channel')} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {chs.map((x) => {
            const on = ch === x.k;
            return (
              <Hv
                key={x.k}
                as="button"
                type="button"
                onClick={() => setCh(x.k)}
                aria-pressed={on}
                style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2, padding: '14px 16px', borderRadius: 18, border: `1.5px solid ${on ? 'var(--ya-ink)' : 'var(--ya-sand-200)'}`, background: on ? 'var(--ya-sand-50)' : 'var(--ya-card)', color: 'var(--ya-ink)', cursor: 'pointer', transition: 'border-color 160ms,background 160ms' }}
                hover={{ borderColor: 'var(--ya-sand-400)' }}
              >
                <span style={{ fontSize: 15, fontWeight: 600 }}>{x.l}</span>
                <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em', lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>{counts.isLoading ? '…' : n(x.n)}</span>
                <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{x.s}</span>
              </Hv>
            );
          })}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14.5 }}>
          <Line l={t('ya.cli.msg.will')} v={n(reach)} />
          <Line l={t('ya.cli.msg.excluded', { ch: chLabel })} v={n(Math.max(0, total - reach))} muted />
        </div>
        {none && !smsNeedsSegment && (
          <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--ya-sand-50)', color: 'var(--ya-sand-600)', fontSize: 14, lineHeight: 1.45 }}>
            {t('ya.cli.msg.none', { ch: chLabel })}
          </div>
        )}
        {smsNeedsSegment && (
          <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--ya-sand-50)', color: 'var(--ya-sand-600)', fontSize: 14, lineHeight: 1.45 }}>
            {t('ya.cli.msg.smsSegmentFirst')}
          </div>
        )}
        {!caps.send && (
          <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--ya-sand-50)', color: 'var(--ya-sand-600)', fontSize: 14, lineHeight: 1.45 }}>
            {t('ya.common.readOnly')}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '16px 28px', background: 'var(--ya-sand-50)', borderTop: '1px solid var(--ya-sand-100)', borderRadius: '0 0 28px 28px' }}>
        <Hv as="button" type="button" onClick={onClose} style={{ height: 44, padding: '0 18px', borderRadius: 99, border: 0, background: 'none', fontSize: 14.5, fontWeight: 600, color: 'var(--ya-sand-600)', cursor: 'pointer' }} hover={{ color: 'var(--ya-ink)' }}>
          {t('ya.common.cancel')}
        </Hv>
        <button
          type="button"
          onClick={go}
          disabled={blocked}
          style={{
            height: 44, padding: '0 22px', borderRadius: 99, border: 0, fontSize: 14.5, fontWeight: 600,
            background: blocked ? 'var(--ya-sand-100)' : 'var(--ya-gradient-brand)', color: blocked ? 'var(--ya-sand-400)' : '#fff',
            cursor: blocked ? 'not-allowed' : 'pointer', boxShadow: blocked ? 'none' : 'var(--ya-shadow-cta)',
          }}
        >
          {t('ya.cli.msg.prepare')}
        </button>
      </div>
    </Modal>
  );
}

function Line({ l, v, muted }: { l: string; v: string; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--ya-sand-600)' }}>{l}</span>
      <b style={{ fontVariantNumeric: 'tabular-nums', color: muted ? 'var(--ya-sand-500)' : 'var(--ya-ink)' }}>{v}</b>
    </div>
  );
}
