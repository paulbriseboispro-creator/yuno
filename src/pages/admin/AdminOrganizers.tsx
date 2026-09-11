import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { Copy, ExternalLink, GraduationCap, Mail, Pencil, Plus, Send, Sparkles, Store, Trash2, Users, Eye } from 'lucide-react';
import { GenerateOnboardingLinkButton } from '@/components/onboarding/GenerateOnboardingLinkButton';
import {
  AdminPage, Card, Stat, Btn, Pill, Modal, Field, TableWrap, Th, Td, EmptyState, Spinner, INPUT_STYLE, INNER_BG, BORDER, RED, T1, T2, T3, F_BORDER,
} from '@/components/admin/ui';
import { fmtDate, fmtNum } from '@/lib/adminFormat';
import { SearchBox, safeLike } from './directory/Paginator';

interface Invitation { id: string; email: string; profile_type: string; organization_name: string | null; status: string; created_at: string; expires_at: string; accepted_at: string | null }
interface Org { user_id: string; display_name: string; slug: string | null; is_public: boolean; bde_verified: boolean; is_showcase_shadow: boolean | null; city: string | null; created_at: string; email: string | null; eventCount: number; venueCount: number }

export default function AdminOrganizers() {
  const { t, language } = useLanguage();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [orgName, setOrgName] = useState('');
  const [offerHelp, setOfferHelp] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [editTarget, setEditTarget] = useState<Org | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Org | null>(null);

  const [showcaseOpen, setShowcaseOpen] = useState(false);
  const [showcaseName, setShowcaseName] = useState('');
  const [showcaseEmail, setShowcaseEmail] = useState('');
  const [showcaseTouched, setShowcaseTouched] = useState(false);
  const [showcaseLink, setShowcaseLink] = useState<string | null>(null);

  const suggestEmail = (name: string) => `vitrine+${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'orga'}@yunoapp.eu`;

  const load = useCallback(async () => {
    setLoading(true);
    const [inv, op] = await Promise.all([
      // Seules les invitations ORGANISATEUR : la table sert aussi aux affiliés.
      supabase.from('platform_invitations').select('id, email, profile_type, organization_name, status, created_at, expires_at, accepted_at').eq('profile_type', 'organizer').order('created_at', { ascending: false }),
      supabase.from('organizer_profiles').select('user_id, display_name, slug, is_public, bde_verified, is_showcase_shadow, city, created_at').order('created_at', { ascending: false }),
    ]);
    if (inv.error) toast.error(inv.error.message);
    if (op.error) toast.error(op.error.message);
    setInvitations((inv.data ?? []) as Invitation[]);
    const rows = (op.data ?? []) as Omit<Org, 'email' | 'eventCount' | 'venueCount'>[];
    const ids = rows.map((r) => r.user_id);
    const [profiles, events, partners] = await Promise.all([
      ids.length ? supabase.from('profiles').select('id, email').in('id', ids) : Promise.resolve({ data: [] as { id: string; email: string | null }[] }),
      ids.length ? supabase.from('events').select('organizer_user_id').in('organizer_user_id', ids) : Promise.resolve({ data: [] as { organizer_user_id: string | null }[] }),
      ids.length ? supabase.from('venue_organizer_partnerships').select('organizer_user_id, venue_id').in('organizer_user_id', ids).eq('status', 'active') : Promise.resolve({ data: [] as { organizer_user_id: string; venue_id: string }[] }),
    ]);
    const emailMap = Object.fromEntries((profiles.data ?? []).map((p) => [p.id, p.email]));
    const ev: Record<string, number> = {}; for (const e of events.data ?? []) if (e.organizer_user_id) ev[e.organizer_user_id] = (ev[e.organizer_user_id] || 0) + 1;
    const vn: Record<string, Set<string>> = {}; for (const p of partners.data ?? []) (vn[p.organizer_user_id] ??= new Set()).add(p.venue_id);
    setOrgs(rows.map((r) => ({ ...r, email: emailMap[r.user_id] ?? null, eventCount: ev[r.user_id] || 0, venueCount: vn[r.user_id]?.size || 0 })));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = safeLike(search).toLowerCase();
    return s ? orgs.filter((o) => o.display_name.toLowerCase().includes(s) || (o.email ?? '').toLowerCase().includes(s) || (o.city ?? '').toLowerCase().includes(s)) : orgs;
  }, [orgs, search]);
  const pending = invitations.filter((i) => i.status === 'pending');
  const past = invitations.filter((i) => i.status !== 'pending');
  const sLabel = (s: string) => { const k = `adm.org.status.${s}`; const v = t(k); return v === k ? s : v; };

  const submit = async () => {
    if (!email || !orgName) return;
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke('invite-platform-user', { body: { email, organization_name: orgName, offer_support_help: offerHelp } });
    setSubmitting(false);
    const err = error?.message ?? (data as { error?: string })?.error;
    if (err) { toast.error(err); return; }
    const d = data as { user_exists?: boolean; support_offered?: boolean };
    toast.success(d?.user_exists ? (d?.support_offered ? t('adm.org.sentLinkedHelp') : t('adm.org.sentLinked')) : (offerHelp ? t('adm.org.sentEmailHelp') : t('adm.org.sentEmail')));
    setEmail(''); setOrgName(''); setOfferHelp(true); setInviteOpen(false); load();
  };
  const resend = async (inv: Invitation) => {
    if (!inv.organization_name) return;
    const { data, error } = await supabase.functions.invoke('invite-platform-user', { body: { email: inv.email, organization_name: inv.organization_name } });
    const err = error?.message ?? (data as { error?: string })?.error;
    if (err) toast.error(err); else { toast.success(t('adm.org.resent')); load(); }
  };
  const revoke = async (id: string) => {
    const { error } = await supabase.from('platform_invitations').update({ status: 'revoked' }).eq('id', id);
    if (error) toast.error(error.message); else { toast.success(t('adm.org.revoked')); load(); }
  };
  const deleteInvitation = async (id: string) => {
    const { error } = await supabase.from('platform_invitations').delete().eq('id', id);
    if (error) toast.error(error.message); else { toast.success(t('adm.org.deletedInv')); load(); }
  };
  const setBde = async (o: Org, next: boolean) => {
    setBusy(o.user_id);
    const { error } = await supabase.rpc('admin_set_organizer_bde_verified', { p_organizer_user_id: o.user_id, p_verified: next });
    setBusy(null);
    if (error) { toast.error(t('adm.common.actionFailed')); return; }
    setOrgs((prev) => prev.map((x) => (x.user_id === o.user_id ? { ...x, bde_verified: next } : x)));
    toast.success(next ? t('adm.org.bdeSet') : t('adm.org.bdeUnset'));
  };
  const saveEdit = async () => {
    if (!editTarget || !editName.trim()) return;
    setBusy('edit');
    const { error } = await supabase.from('profiles').update({ organization_name: editName.trim() }).eq('id', editTarget.user_id);
    const { error: e2 } = error ? { error } : await supabase.from('organizer_profiles').update({ display_name: editName.trim() }).eq('user_id', editTarget.user_id);
    setBusy(null);
    if (error || e2) { toast.error((error ?? e2)!.message); return; }
    toast.success(t('adm.org.updated')); setEditTarget(null); load();
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setBusy('delete');
    const { error } = await supabase.rpc('admin_delete_organizer', { _user_id: deleteTarget.user_id });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t('adm.org.removed')); setDeleteTarget(null); load();
  };
  const createShowcase = async () => {
    if (!showcaseName || !showcaseEmail) return;
    setBusy('showcase');
    const { data, error } = await supabase.functions.invoke('admin-account-recovery', { body: { action: 'create-showcase-organizer', name: showcaseName.trim(), email: showcaseEmail.trim() } });
    setBusy(null);
    const err = error?.message ?? (data as { error?: string })?.error;
    if (err) {
      if (err.includes('email_already_used')) toast.error(t('adm.org.emailUsed'));
      else if (err.includes('womber_email_forbidden')) toast.error(t('adm.org.womberForbidden'));
      else toast.error(err);
      return;
    }
    setShowcaseLink((data as { action_link: string }).action_link);
    toast.success(t('adm.org.showcaseReady')); load();
  };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.success(t('adm.org.builderCopied')); } catch { toast.error(t('adm.common.copyFailed')); } };

  const stats = { total: orgs.filter((o) => !o.is_showcase_shadow).length, bde: orgs.filter((o) => o.bde_verified).length, pub: orgs.filter((o) => o.is_public && !o.is_showcase_shadow).length, showcase: orgs.filter((o) => o.is_showcase_shadow).length };

  return (
    <AdminPage eyebrow={t('adm.org.eyebrow')} title={t('adm.org.title')} subtitle={t('adm.org.subtitle')}
      actions={<>
        <GenerateOnboardingLinkButton roles={['organizer']} buttonLabel={t('adm.org.signupLink')} variant="outline" size="sm" />
        <Btn onClick={() => setShowcaseOpen(true)} icon={Store}>{t('adm.org.showcase')}</Btn>
        <Btn onClick={() => setInviteOpen(true)} icon={Plus} variant="primary">{t('adm.org.invite')}</Btn>
      </>}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat compact label={t('adm.org.total')} value={fmtNum(stats.total, language)} icon={Sparkles} highlight />
        <Stat compact label={t('adm.org.bde')} value={fmtNum(stats.bde, language)} icon={GraduationCap} />
        <Stat compact label={t('adm.org.public')} value={fmtNum(stats.pub, language)} icon={Users} />
        <Stat compact label={t('adm.org.showcaseN')} value={fmtNum(stats.showcase, language)} icon={Store} to="/admin/demo-access" />
      </div>

      <Card title={t('adm.org.pending')} icon={Mail} accent={pending.length > 0} right={<Pill tone={pending.length ? 'hot' : 'muted'}>{pending.length}</Pill>}>
        {loading ? <Spinner /> : pending.length === 0 ? <EmptyState icon={Mail} text={t('adm.org.noPending')} /> : pending.map((inv) => (
          <div key={inv.id} className="flex items-center justify-between gap-3 py-2.5" style={{ borderBottom: `1px solid ${F_BORDER}` }}>
            <div className="min-w-0 flex-1">
              <div className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{inv.organization_name ?? '—'}</div>
              <div className="truncate" style={{ color: T3, fontSize: 11.5 }}>{inv.email} · {t('adm.org.expires').replace('{d}', fmtDate(inv.expires_at, language))}</div>
            </div>
            <Btn size="sm" variant="subtle" icon={Send} onClick={() => resend(inv)} title={t('adm.org.resend')} />
            <Btn size="sm" variant="danger" icon={Trash2} onClick={() => revoke(inv.id)} title={t('adm.org.revoke')} />
          </div>
        ))}
      </Card>

      <Card title={t('adm.org.accounts')} icon={Sparkles} flush right={<SearchBox value={search} onChange={setSearch} placeholder={t('adm.org.search')} />}>
        {loading ? <Spinner /> : filtered.length === 0 ? <EmptyState text={t('adm.org.noAccounts')} /> : (
          <TableWrap minWidth={760}>
            <thead><tr><Th>{t('adm.org.col.name')}</Th><Th>{t('adm.common.city')}</Th><Th right>{t('adm.org.col.events')}</Th><Th right>{t('adm.org.col.venues')}</Th><Th>{t('adm.org.col.public')}</Th><Th>{t('adm.org.col.bde')}</Th><Th right>{t('adm.common.created')}</Th><Th right>{t('adm.common.actions')}</Th></tr></thead>
            <tbody>{filtered.map((o) => (
              <tr key={o.user_id}>
                <Td strong>
                  <div className="flex items-center gap-2 min-w-0">
                    <Link to={`/admin/people/${o.user_id}`} style={{ color: T1 }} className="hover:underline truncate">{o.display_name}</Link>
                    {o.is_showcase_shadow && <Pill size="xs" tone="accent">{t('adm.org.shadow')}</Pill>}
                    {o.slug && <a href={`/o/${o.slug}`} target="_blank" rel="noopener noreferrer" title={t('adm.common.seePage')}><ExternalLink className="h-3 w-3" style={{ color: T3 }} /></a>}
                  </div>
                  <div className="truncate" style={{ color: T3, fontSize: 11, fontWeight: 400 }}>{o.email ?? ''}</div>
                </Td>
                <Td muted>{o.city ?? '—'}</Td>
                <Td right>{fmtNum(o.eventCount, language)}</Td>
                <Td right>{fmtNum(o.venueCount, language)}</Td>
                <Td><Pill size="xs" tone={o.is_public ? 'pos' : 'muted'} icon={Eye}>{o.is_public ? t('adm.common.yes') : t('adm.common.no')}</Pill></Td>
                <Td><Btn size="sm" variant={o.bde_verified ? 'primary' : 'ghost'} icon={GraduationCap} loading={busy === o.user_id} onClick={() => setBde(o, !o.bde_verified)} title={o.bde_verified ? t('adm.org.bdeTitleOn') : t('adm.org.bdeTitleOff')}>{o.bde_verified ? t('adm.org.bdeOn') : t('adm.org.bdeOff')}</Btn></Td>
                <Td right muted>{fmtDate(o.created_at, language)}</Td>
                <Td right><div className="flex justify-end gap-1"><Btn size="sm" variant="subtle" icon={Pencil} onClick={() => { setEditTarget(o); setEditName(o.display_name); }} title={t('adm.org.edit')} /><Btn size="sm" variant="subtle" icon={Trash2} onClick={() => setDeleteTarget(o)} title={t('adm.org.remove')} style={{ color: RED }} /></div></Td>
              </tr>
            ))}</tbody>
          </TableWrap>
        )}
      </Card>

      {past.length > 0 && (
        <Card title={t('adm.org.history')} icon={Mail}>
          {past.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-3 py-2" style={{ borderBottom: `1px solid ${F_BORDER}` }}>
              <div className="min-w-0 flex-1"><div className="truncate" style={{ color: T2, fontSize: 13 }}>{inv.organization_name ?? '—'}</div><div className="truncate" style={{ color: T3, fontSize: 11.5 }}>{inv.email} · {fmtDate(inv.created_at, language)}</div></div>
              <Pill size="xs" tone={inv.status === 'accepted' ? 'pos' : inv.status === 'revoked' || inv.status === 'expired' ? 'neg' : 'default'}>{sLabel(inv.status)}</Pill>
              {inv.status !== 'accepted' && inv.organization_name && <Btn size="sm" variant="subtle" icon={Send} onClick={() => resend(inv)} title={t('adm.org.resend')} />}
              <Btn size="sm" variant="subtle" icon={Trash2} onClick={() => deleteInvitation(inv.id)} title={t('adm.common.delete')} />
            </div>
          ))}
        </Card>
      )}

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title={t('adm.org.inviteTitle')}
        footer={<><Btn onClick={() => setInviteOpen(false)}>{t('adm.common.cancel')}</Btn><Btn variant="primary" onClick={submit} loading={submitting} disabled={!email || !orgName} icon={Send}>{t('adm.org.send')}</Btn></>}>
        <Field label={t('adm.common.email')}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contact@orga.com" style={INPUT_STYLE} /></Field>
        <Field label={t('adm.org.orgName')} hint={t('adm.org.inviteHint')}><input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder={t('adm.org.orgNamePh')} style={INPUT_STYLE} /></Field>
        <label className="flex items-start gap-3 rounded-xl p-3 cursor-pointer" style={{ background: INNER_BG, border: `1px solid ${offerHelp ? 'rgba(232,25,44,0.3)' : BORDER}` }}>
          <input type="checkbox" checked={offerHelp} onChange={(e) => setOfferHelp(e.target.checked)} style={{ marginTop: 2, accentColor: RED, width: 16, height: 16 }} />
          <span><span style={{ color: T1, fontSize: 13, fontWeight: 560, display: 'block' }}>{t('adm.org.offerHelp')}</span><span style={{ color: T3, fontSize: 11.5, lineHeight: 1.5, display: 'block', marginTop: 3 }}>{t('adm.org.offerHelpHint')}</span></span>
        </label>
      </Modal>

      <Modal open={showcaseOpen} onClose={() => { setShowcaseOpen(false); setShowcaseLink(null); setShowcaseName(''); setShowcaseEmail(''); setShowcaseTouched(false); }} title={t('adm.org.showcaseTitle')} subtitle={showcaseLink ? undefined : t('adm.org.showcaseHint')}
        footer={showcaseLink ? <Btn variant="primary" onClick={() => setShowcaseOpen(false)}>{t('adm.org.done')}</Btn> : <><Btn onClick={() => setShowcaseOpen(false)}>{t('adm.common.cancel')}</Btn><Btn variant="primary" onClick={createShowcase} loading={busy === 'showcase'} disabled={!showcaseName || !showcaseEmail} icon={Store}>{t('adm.org.createShowcase')}</Btn></>}>
        {showcaseLink ? (
          <div><p style={{ color: T2, fontSize: 13 }}>{t('adm.org.builderLink')}</p><div className="flex gap-2 mt-2"><input readOnly value={showcaseLink} style={{ ...INPUT_STYLE, flex: 1 }} onFocus={(e) => e.currentTarget.select()} /><Btn icon={Copy} onClick={() => copy(showcaseLink)}>{t('adm.common.copy')}</Btn></div></div>
        ) : (<>
          <Field label={t('adm.org.showcaseName')}><input value={showcaseName} onChange={(e) => { setShowcaseName(e.target.value); if (!showcaseTouched) setShowcaseEmail(suggestEmail(e.target.value)); }} placeholder={t('adm.org.showcaseNamePh')} style={INPUT_STYLE} /></Field>
          <Field label={t('adm.org.ghostEmail')} hint={t('adm.org.ghostEmailHint')}><input type="email" value={showcaseEmail} onChange={(e) => { setShowcaseEmail(e.target.value); setShowcaseTouched(true); }} style={INPUT_STYLE} /></Field>
        </>)}
      </Modal>

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={t('adm.org.editTitle')}
        footer={<><Btn onClick={() => setEditTarget(null)}>{t('adm.common.cancel')}</Btn><Btn variant="primary" onClick={saveEdit} loading={busy === 'edit'} disabled={!editName.trim()}>{t('adm.common.save')}</Btn></>}>
        <Field label={t('adm.org.emailRO')}><input value={editTarget?.email ?? ''} disabled style={{ ...INPUT_STYLE, opacity: 0.6 }} /></Field>
        <Field label={t('adm.org.orgName')}><input value={editName} onChange={(e) => setEditName(e.target.value)} style={INPUT_STYLE} /></Field>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={t('adm.org.removeTitle')} subtitle={t('adm.org.removeHint').replace('{name}', deleteTarget?.display_name ?? '').replace('{email}', deleteTarget?.email ?? '')}
        footer={<><Btn onClick={() => setDeleteTarget(null)}>{t('adm.common.cancel')}</Btn><Btn variant="danger" onClick={confirmDelete} loading={busy === 'delete'} icon={Trash2}>{busy === 'delete' ? t('adm.org.removing') : t('adm.org.remove')}</Btn></>}>
        <span />
      </Modal>
    </AdminPage>
  );
}
