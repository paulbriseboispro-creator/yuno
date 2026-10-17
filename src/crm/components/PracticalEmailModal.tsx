/**
 * « E-mail pratique aux détenteurs » (tiroir d'une soirée) : qui le recevra,
 * ce qu'il coûte, ce qu'il peut dire et ce qu'il ne doit jamais dire, puis le
 * brouillon dans l'éditeur. Rien ne part d'ici. La règle est serveur
 * (guard_crm_practical_email) ; doc docs/designs/CRM_PRACTICAL_EMAIL.md.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Modal } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps, useCrmScope } from '@/crm/scope';
import { useCrmShell } from '@/crm/data/shell';
import { createPracticalDraft, usePracticalNight } from '@/crm/data/practical';
import { buildPracticalEmail, practicalReasonKey } from '@/crm/lib/practicalEmail';
import { useInvalidateEmails } from '@/crm/data/emails';
import { CRM_ROUTES } from '@/crm/shell/nav';

export function PracticalEmailModal({
  open, onClose, night,
}: {
  open: boolean;
  onClose: () => void;
  night: { id: string; title: string; coverUrl: string | null; url: string | null } | null;
}) {
  const { t, tp, n, dLong, time } = useCrmT();
  const nav = useNavigate();
  const toast = useCrmToast();
  const { space, rpc: args } = useCrmScope();
  const caps = useCrmCaps();
  const shell = useCrmShell();
  const invalidate = useInvalidateEmails();
  const q = usePracticalNight(night?.id ?? null, open);
  const [busy, setBusy] = useState(false);

  const p = q.data;
  const reach = p?.reachable ?? 0;
  const perEmail = p?.yunits_per_email ?? 1;
  const cost = reach * perEmail;
  const balance = shell.data?.wallet.balance ?? 0;
  const short = balance - cost < 0;
  const blocked = busy || q.isLoading || !p?.eligible || reach === 0 || !caps.write || short;
  const until = p?.window_end ? new Date(p.window_end) : null;

  const go = async () => {
    if (!night || blocked) return;
    setBusy(true);
    try {
      const content = buildPracticalEmail({ venueName: space.name, t, night: { id: night.id, title: night.title, coverUrl: night.coverUrl, url: night.url } });
      const id = await createPracticalDraft({
        venueId: args.p_venue_id, organizerUserId: args.p_organizer_user_id, eventId: night.id,
        name: t('yc.pe.draftName', { title: night.title }), content,
      });
      invalidate();
      onClose();
      nav(CRM_ROUTES.emailStudio(id));
    } catch {
      toast(t('yc.pe.err.create'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={540} label={t('yc.pe.m.title')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '26px 28px 8px' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.pe.m.eyebrow')}</span>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, lineHeight: 1.1, letterSpacing: '-.03em' }}>{t('yc.pe.m.title')}</h2>
        <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>{night?.title}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '12px 28px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14.5 }}>
          <Line l={t('yc.pe.m.holders')} v={q.isLoading ? '…' : n(p?.holders ?? 0)} />
          <Line l={t('yc.pe.m.reach')} v={q.isLoading ? '…' : n(reach)} />
          {!q.isLoading && (p?.marketing_optin ?? 0) < reach && (
            <Line l={t('yc.pe.m.onlyHere')} v={n(reach - (p?.marketing_optin ?? 0))} muted />
          )}
          <div style={{ paddingTop: 10, borderTop: '1px solid var(--sand-100)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Line l={t('yc.cli.msg.cost')} v={tp('yc.cli.msg.yunits', cost, { n: n(cost) })} color={short ? 'var(--amber-700)' : undefined} />
            {p?.max != null && <Line l={t('yc.pe.m.sent')} v={t('yc.pe.m.sentV', { n: p.sent ?? 0, max: p.max })} muted />}
            {until && <Line l={t('yc.pe.m.until')} v={t('yc.em.sd.when', { day: dLong(until), time: time(until) })} muted />}
          </div>
        </div>

        {/* L'avertissement d'usage : ce que l'e-mail peut dire, et ce qu'il ne dira jamais. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', borderRadius: 16, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-100)', fontSize: 14, lineHeight: 1.5 }}>
          <b style={{ fontSize: 14.5 }}>{t('yc.pe.m.okT')}</b>
          <span style={{ color: 'var(--sand-700)' }}>{t('yc.pe.m.ok')}</span>
          <b style={{ fontSize: 14.5, marginTop: 4 }}>{t('yc.pe.m.noT')}</b>
          <span style={{ color: 'var(--sand-700)' }}>{t('yc.pe.m.no')}</span>
        </div>

        {p?.role === 'editor' && p.eligible && (
          <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 14, lineHeight: 1.45, fontWeight: 500 }}>
            {t('yc.pe.m.coorg')}
          </div>
        )}
        {p && !p.eligible && (
          <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--sand-50)', color: 'var(--sand-700)', fontSize: 14, lineHeight: 1.45 }}>
            {t(practicalReasonKey(p.reason), { max: p.max ?? 3 })}
          </div>
        )}
        {p?.eligible && reach === 0 && !q.isLoading && (
          <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--sand-50)', color: 'var(--sand-700)', fontSize: 14, lineHeight: 1.45 }}>
            {t('yc.pe.m.none')}
          </div>
        )}
        {short && reach > 0 && (
          <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 14, lineHeight: 1.45, fontWeight: 500 }}>
            {t('yc.pe.m.short')}
          </div>
        )}
        {!caps.write && (
          <div style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--sand-50)', color: 'var(--sand-600)', fontSize: 14, lineHeight: 1.45 }}>
            {t('yc.common.readOnly')}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '16px 28px', background: 'var(--sand-50)', borderTop: '1px solid var(--sand-100)', borderRadius: '0 0 28px 28px' }}>
        <Hv as="button" type="button" onClick={onClose} style={{ height: 44, padding: '0 18px', borderRadius: 99, border: 0, background: 'none', fontSize: 14.5, fontWeight: 600, color: 'var(--sand-600)', cursor: 'pointer' }} hover={{ color: 'var(--ink)' }}>
          {t('yc.common.cancel')}
        </Hv>
        <button
          type="button"
          onClick={() => void go()}
          disabled={blocked}
          style={{
            height: 44, padding: '0 22px', borderRadius: 99, border: 0, fontSize: 14.5, fontWeight: 600,
            background: blocked ? 'var(--sand-100)' : 'var(--gradient-brand)', color: blocked ? 'var(--sand-400)' : '#fff',
            cursor: blocked ? 'not-allowed' : 'pointer', boxShadow: blocked ? 'none' : 'var(--shadow-cta)',
          }}
        >
          {busy ? '…' : t('yc.pe.m.go')}
        </button>
      </div>
    </Modal>
  );
}

function Line({ l, v, muted, color }: { l: string; v: string; muted?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--sand-600)' }}>{l}</span>
      <b style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: color ?? (muted ? 'var(--sand-500)' : 'var(--ink)') }}>{v}</b>
    </div>
  );
}
