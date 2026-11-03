/**
 * E-mails › Santé (`/crm/emails/health`) — « mes e-mails arrivent-ils, et que
 * puis-je envoyer ? ». La page en schémas (HealthDashboard, partagée avec la
 * Billetterie) : le feu du verdict et le niveau, les plafonds du jour, ce que
 * le compte peut faire, les 30 derniers jours, les trois signaux, la base
 * joignable, ce que Yuno a mis de côté, les incidents, les dernières campagnes.
 * Rien d'estimé : tout vient des envois réels.
 */
import type { CSSProperties } from 'react';
import { Skel } from '@/crm/ui/kit';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { useEmailCampaigns } from '@/crm/data/emails';
import { useSenderHealth } from '@/lib/email/senderHealth';
import { useSenderHealthVisual } from '@/lib/email/senderHealthVisual';
import { healthWord, type HealthLang } from '@/lib/email/senderHealthWords';
import { HealthDashboard, type HealthPalette } from '@/components/email-health/HealthDashboard';
import { EmailsShell } from '../EmailsShell';

const card: CSSProperties = { borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', padding: 'clamp(18px,3vw,26px)', display: 'flex', flexDirection: 'column', gap: 14 };

const CRM: HealthPalette = {
  ink: 'var(--ink)', sub: 'var(--sand-600)', muted: 'var(--sand-500)', line: 'var(--sand-200)', inner: 'var(--sand-50)',
  card, h2: { margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em', color: 'var(--ink)' },
  display: 'var(--font-display)',
  green: 'var(--green-500)', amber: 'var(--amber-500, #f59e0b)', red: 'var(--red-500)', neutral: 'var(--sand-400)', blue: '#3b82f6',
  toneBg: { ok: 'rgba(23,163,74,.08)', warn: 'var(--amber-50)', bad: 'rgba(232,25,44,.07)', neutral: 'var(--sand-50)' },
  onInk: '#fff',
};

export default function EmailHealthPage() {
  const { n, dShort, time, lang } = useCrmT();
  const { rpc } = useCrmScope();
  const list = useEmailCampaigns();
  const drafts = (list.data?.campaigns ?? []).filter((c) => c.status === 'draft').length;
  const q = useSenderHealth(rpc.p_venue_id, rpc.p_organizer_user_id, 'crm');
  const v = useSenderHealthVisual(rpc.p_venue_id, rpc.p_organizer_user_id, 'crm');
  const L = lang as HealthLang;
  const w = (k: string, vars?: Record<string, string | number | null | undefined>) => healthWord(L, k, vars);

  return (
    <EmailsShell tab="health" title={w('title')} sub={w('v.sub')} drafts={drafts} hideNew>
      {q.loading && !q.data ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Skel h={150} r={28} /><Skel h={200} r={28} /><Skel h={240} r={28} />
        </div>
      ) : q.error || !q.data ? (
        <section style={{ ...card, alignItems: 'flex-start' }}>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--sand-600)' }}>{w('error')}</p>
          <button type="button" onClick={() => { void q.reload(); void v.reload(); }} style={{ height: 40, padding: '0 18px', border: 0, borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }}>{w('retry')}</button>
        </section>
      ) : (
        <HealthDashboard report={q.data} visual={v.data} lang={L} n={n} dShort={dShort} time={time} P={CRM}
          campaignHref={(id) => CRM_ROUTES.emailResults(id)} />
      )}
    </EmailsShell>
  );
}
