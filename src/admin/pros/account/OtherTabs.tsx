/** Fiche d'un pro : onglets Équipe, Support et légal, Journal et notes. */
import { useState } from 'react';
import { toast } from 'sonner';
import { Pin, PinOff, Trash2 } from 'lucide-react';
import { rpc } from '@/crm/lib/rpc';
import { Badge, Checkbox, EmptyState, Grid, KeyValue, Section, Status, Timeline, useAdminT, Block } from '@/admin/ui';
import { fmtDate, fmtRelative } from '@/lib/adminFormat';
import { useProsRefresh, type AccountCard } from '../data';

export function TeamTab({ card }: { card: AccountCard }) {
  const { t, lang } = useAdminT();
  const o = card.owner;
  const staff = card.venue_overview?.staff ?? [];
  const people = [
    ...(o ? [{ id: o.id, name: o.name, email: o.email, role: 'owner', mfa: o.mfa, since: o.created_at, status: 'accepted' }] : []),
    ...card.team.map((m) => ({ ...m, status: m.status ?? 'accepted' })),
  ];
  return (
    <div className="flex flex-col gap-6">
      <Section title={t('adm.pros.team.title')} description={t('adm.pros.team.sub')}>
        <div className="divide-y border-y">
          {people.length === 0 ? <EmptyState title={t('adm.pros.team.empty')} /> : people.map((p, i) => (
            <div key={`${p.id ?? p.email}-${i}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
              <div className="min-w-0 flex-1">
                <div className="a-t1 truncate font-medium">{p.name ?? p.email ?? '—'}</div>
                {p.name && <div className="a-t3 truncate text-[12px]">{p.email}</div>}
              </div>
              <Badge tone={p.role === 'owner' ? 'accent' : 'neutral'}>{t(`adm.pros.role.${p.role}`)}</Badge>
              {p.status === 'pending' && <Badge tone="warning">{t('adm.pros.team.pending')}</Badge>}
              <Status tone={p.mfa ? 'positive' : 'warning'}>{t(p.mfa ? 'adm.pros.f.mfaOn' : 'adm.pros.f.mfaOff')}</Status>
              <span className="a-t3 a-num w-24 text-right text-[12px]">{p.since ? fmtDate(p.since, lang) : ''}</span>
            </div>
          ))}
        </div>
      </Section>
      {staff.length > 0 && (
        <Section title={t('adm.pros.team.staff')} description={t('adm.pros.team.staffSub')}>
          <div className="divide-y border-y">
            {staff.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-[13px]">
                <span className="a-t1 min-w-0 flex-1 truncate">{s.name ?? s.email}</span>
                <span className="a-t3 text-[12px]">{(s.roles ?? []).filter((r) => r !== 'barman').join(', ')}</span>
                {s.has_pin && <Badge>PIN</Badge>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

export function SupportLegalTab({ card }: { card: AccountCard }) {
  const { t, lang } = useAdminT();
  const legal = card.legal;
  const sending = card.sending;
  return (
    <div className="flex flex-col gap-6">
      <Grid cols={2} className="gap-x-10 gap-y-8">
        <Block title={t('adm.pros.sl.support')}>
          <Timeline
            empty={t('adm.pros.sl.noSupport')}
            items={[
              ...card.support.grants.map((g) => ({
                id: `g${g.id}`, at: g.created_at,
                tone: (g.status === 'active' && !g.revoked_at ? 'positive' : g.status === 'pending' ? 'warning' : 'neutral') as 'positive' | 'warning' | 'neutral',
                title: t(`adm.pros.sl.grant.${g.revoked_at ? 'revoked' : g.status}`),
                body: g.reason ?? undefined,
              })),
              ...card.support.sessions.map((s) => ({
                id: `s${s.id}`, at: s.created_at, tone: 'accent' as const,
                title: t(s.via === 'agent' ? 'adm.pros.sl.sessionAgent' : 'adm.pros.sl.session'),
                actor: s.admin ?? undefined,
                body: s.ended_at ? t('adm.pros.sl.ended', { at: fmtDate(s.ended_at, lang, 'datetime') }) : undefined,
              })),
            ].sort((a, b) => b.at.localeCompare(a.at))} />
        </Block>
        <Block title={t('adm.pros.sl.feedback')}>
          {card.feedback.length + card.requests.length + card.nps.length === 0
            ? <EmptyState title={t('adm.pros.sl.noFeedback')} />
            : (
              <ul className="flex flex-col gap-2 text-[13px]">
                {card.feedback.map((f) => (
                  <li key={f.id} className="flex items-center gap-2">
                    <span className="a-t1 min-w-0 flex-1 truncate">{f.title}</span>
                    {f.status && <Badge tone={f.status === 'resolved' || f.status === 'closed' ? 'positive' : 'warning'}>{f.status}</Badge>}
                    <span className="a-t3 a-num text-[12px]">{fmtDate(f.at, lang)}</span>
                  </li>
                ))}
                {card.requests.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <span className="a-t1 min-w-0 flex-1 truncate">{r.body}</span>
                    <Badge>{t('adm.pros.sl.request')}</Badge>
                    <span className="a-t3 a-num text-[12px]">{fmtDate(r.at, lang)}</span>
                  </li>
                ))}
                {card.nps.map((n, i) => (
                  <li key={`n${i}`} className="flex items-center gap-2">
                    <span className="a-t1 min-w-0 flex-1 truncate">{n.comment || '—'}</span>
                    <Badge tone={n.score >= 9 ? 'positive' : n.score <= 6 ? 'negative' : 'neutral'}>NPS {n.score}</Badge>
                    <span className="a-t3 a-num text-[12px]">{fmtDate(n.at, lang)}</span>
                  </li>
                ))}
              </ul>
            )}
        </Block>
      </Grid>

      <Grid cols={2} className="gap-x-10 gap-y-8">
        <Block title={t('adm.pros.sl.legal')}>
          {legal && Object.values(legal).some(Boolean) ? (
            <KeyValue items={[
              { label: t('adm.pros.sl.legalName'), value: legal.legal_name ?? '—' },
              { label: 'SIRET', value: legal.siret ?? '—', mono: true },
              { label: t('adm.pros.sl.vat'), value: legal.vat_number ?? '—', mono: true },
              ...(legal.vat_regime !== undefined ? [{ label: t('adm.pros.sl.vatRegime'), value: legal.vat_regime ?? '—' }] : []),
              ...(legal.rna_number ? [{ label: 'RNA', value: legal.rna_number, mono: true }] : []),
              { label: t('adm.pros.f.address'), value: legal.legal_address ?? '—' },
            ]} />
          ) : <EmptyState title={t('adm.pros.sl.noLegal')} />}
        </Block>
        <Block title={t('adm.pros.sl.acceptances')}>
          {card.legal_acceptances.length === 0 ? <EmptyState title={t('adm.pros.sl.noAcceptances')} /> : (
            <ul className="flex flex-col gap-1.5 text-[13px]">
              {card.legal_acceptances.map((a, i) => (
                <li key={i} className="flex gap-2">
                  <span className="a-t1 flex-1">{a.doc}</span>
                  <span className="a-t3 a-mono text-[12px]">{a.version}</span>
                  <span className="a-t3 a-num w-24 text-right text-[12px]">{fmtDate(a.at, lang)}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </Grid>

      <Block title={t('adm.pros.sl.sending')}>
        {!sending ? <EmptyState title={t('adm.pros.sl.noSending')} /> : (
          <>
            <KeyValue columns={2} items={[
              { label: t('adm.pros.sl.level'), value: sending.level != null ? `${sending.level}/5` : '—' },
              { label: t('adm.pros.sl.levelSince'), value: sending.level_since ? fmtRelative(sending.level_since, lang) : '—' },
              { label: t('adm.pros.sl.frozenUntil'), value: sending.cold_frozen_until ? fmtDate(sending.cold_frozen_until, lang, 'long') : '—' },
              { label: t('adm.pros.sl.burst'), value: t(sending.burst_allowed ? 'adm.pros.yes' : 'adm.pros.no') },
            ]} />
            {sending.incidents.length > 0 && (
              <div className="mt-3">
                <Timeline items={sending.incidents.map((i, n) => ({ id: String(n), at: i.at, tone: 'warning' as const, title: i.kind }))} />
              </div>
            )}
          </>
        )}
      </Block>
    </div>
  );
}

export function JournalTab({ card }: { card: AccountCard }) {
  const { t, lang } = useAdminT();
  const refresh = useProsRefresh();
  const [body, setBody] = useState('');
  const [pin, setPin] = useState(false);
  const [tags, setTags] = useState(card.tags.join(', '));
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await refresh(); } catch (e) { toast.error(e instanceof Error ? e.message : t('adm.ui.error.title')); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-6">
      <Grid cols={2} className="gap-x-10 gap-y-8">
        <Block title={t('adm.pros.j.notes')}>
          <div className="flex flex-col gap-2">
            <textarea className="a-input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('adm.pros.j.notePh')} />
            <div className="flex items-center gap-3">
              <Checkbox checked={pin} onChange={setPin}>{t('adm.pros.j.pin')}</Checkbox>
              <span className="flex-1" />
              <button type="button" className="a-btn a-btn--primary a-btn--sm" disabled={busy || !body.trim()}
                onClick={() => void run(async () => { await rpc('admin_account_note_add', { p_key: card.key, p_body: body, p_pinned: pin }); setBody(''); setPin(false); })}>
                {t('adm.pros.j.add')}
              </button>
            </div>
          </div>
          <ul className="mt-4 flex flex-col divide-y">
            {card.notes.map((n) => (
              <li key={n.id} className="flex gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="a-t1 whitespace-pre-wrap text-[13px]">{n.body}</p>
                  <p className="a-t3 mt-0.5 text-[12px]">{n.author ?? '—'} · {fmtRelative(n.at, lang)}{n.pinned ? ` · ${t('adm.pros.j.pinned')}` : ''}</p>
                </div>
                <button type="button" className="a-btn a-btn--ghost a-btn--icon" aria-label={t(n.pinned ? 'adm.pros.j.unpin' : 'adm.pros.j.pin')} disabled={busy}
                  onClick={() => void run(() => rpc('admin_account_note_update', { p_id: n.id, p_pinned: !n.pinned }))}>
                  {n.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                </button>
                <button type="button" className="a-btn a-btn--ghost a-btn--icon" aria-label={t('adm.pros.j.delete')} disabled={busy}
                  onClick={() => { if (window.confirm(t('adm.pros.j.deleteConfirm'))) void run(() => rpc('admin_account_note_delete', { p_id: n.id })); }}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          {card.crm_note && (
            <div className="a-subtle mt-3 rounded-lg p-3">
              <p className="a-t3 mb-1 text-[12px]">{t('adm.pros.j.crmNote')}</p>
              <p className="a-t1 whitespace-pre-wrap text-[13px]">{card.crm_note}</p>
            </div>
          )}
        </Block>
        <Block title={t('adm.pros.j.tags')}>
          <div className="flex flex-col gap-2">
            <input className="a-input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('adm.pros.j.tagsPh')} />
            <div className="flex items-center gap-2">
              <span className="flex flex-1 flex-wrap gap-1">{card.tags.map((x) => <Badge key={x}>{x}</Badge>)}</span>
              <button type="button" className="a-btn a-btn--sm" disabled={busy}
                onClick={() => void run(() => rpc('admin_account_set_tags', { p_key: card.key, p_tags: tags.split(',').map((x) => x.trim()).filter(Boolean) }))}>
                {t('adm.pros.j.saveTags')}
              </button>
            </div>
          </div>
        </Block>
      </Grid>

      <Section title={t('adm.pros.j.audit')} description={t('adm.pros.j.auditSub')}>
        <div className="">
          <Timeline empty={t('adm.pros.j.noAudit')} items={card.audit.map((a, i) => {
            const reason = (a.meta as { reason?: string } | null)?.reason;
            return { id: String(i), at: a.at, title: a.action.replace(/_/g, ' '), actor: a.admin ?? undefined, body: reason };
          })} />
        </div>
      </Section>
    </div>
  );
}
