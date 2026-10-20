import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Building2, Copy, ExternalLink, Loader2, Mail, MessageCircle, Plus, Power, ScanLine, Settings2, UserPlus, Users,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { OrgCard, OrgButton, OrgPill, OrgSectionLabel, OrgTabs, DarkInput, RED, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import { PhoneInputWithCountry } from '@/components/PhoneInputWithCountry';
import { supabase } from '@/integrations/supabase/client';
import { inviteEventCohost, coorgErrorCode } from '@/lib/coorg';
import { marketCountry } from '@/lib/geo';
import { capturePosthog } from '@/lib/posthog';
import {
  createGuestPass, doorInviteUrl, guestErrorCode, guestErrorText, guestLanguageForEvent, guestSpaceLocale, guestSpaceShareText,
  guestSpaceUrl, guestUiWords, inviteEventDoorStaff, listEventDoorStaff, listGuestPasses, revokeEventDoorStaff,
  sendDoorInviteEmail, sendGuestPassEmail, toGuestSpaceLanguage, updateGuestPass, whatsappHref,
  type DoorStaffRow, type GuestKind, type GuestPassRow, type GuestSpaceLanguage,
} from '@/lib/guestSpace';
import { useCoorgErrorText, useCoorgT } from './coorgUi';

const LANG_TABS = [{ value: 'es', label: 'ES' }, { value: 'fr', label: 'FR' }, { value: 'en', label: 'EN' }] as const;

/**
 * « Espaces invités » (nom à nommer) sur la page Co-organisation : chaque club
 * ou organisation qui fait la soirée avec l'organisateur, sans compte Yuno,
 * reçoit son espace /h/<jeton> (six onglets). Ici l'organisateur l'ouvre,
 * l'envoie (email ou WhatsApp), règle ce que l'invité voit (montants, part
 * convenue, places de guest list), répond aux demandes de places, lit sa
 * réponse au décompte et invite le staff du club à la porte de CETTE soirée.
 * Réservé aux parties principales niveau ≥ 2 (la RPC refuse sinon, la carte se tait).
 */
export function GuestPassCard({ eventId, eventTitle }: { eventId: string; eventTitle: string }) {
  const { language } = useCoorgT();
  const coorgErr = useCoorgErrorText();
  const w = useMemo(() => guestUiWords(language), [language]);
  const [rows, setRows] = useState<GuestPassRow[] | null>(null);
  const [staff, setStaff] = useState<DoorStaffRow[]>([]);
  const [canMoney, setCanMoney] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [staffFor, setStaffFor] = useState<string | null>(null);
  const [ev, setEv] = useState<{ location_name: string | null; location_city: string | null; timezone: string | null } | null>(null);
  const [kind, setKind] = useState<GuestKind>('venue');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [lang, setLang] = useState<GuestSpaceLanguage>('en');
  const [money, setMoney] = useState(true);
  const [places, setPlaces] = useState(0);

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([listGuestPasses(eventId), listEventDoorStaff(eventId)]);
      setRows(r.passes);
      setCanMoney(r.canShowRevenue);
      setStaff(s ?? []);
      setForbidden(false);
    } catch {
      setForbidden(true);
      setRows([]);
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    supabase.from('events').select('location_name, location_city, timezone').eq('id', eventId).maybeSingle()
      .then(({ data }) => {
        const e = data as typeof ev;
        setEv(e);
        if (e) {
          setName((n) => n || e.location_name || '');
          setLang(guestLanguageForEvent(e.timezone, e.location_city));
        }
      });
  }, [eventId]);

  if (forbidden || rows === null) return null;

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
      await load();
    } catch (err) {
      toast.error(guestErrorText(guestErrorCode(err), w));
    } finally {
      setBusy(null);
    }
  };

  const country = marketCountry(ev?.timezone, ev?.location_city) ?? undefined;
  const emailOk = !email.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const canCreate = name.trim().length > 0 && (email.trim() || phone.trim()) && emailOk;

  const create = () => run('create', async () => {
    const pass = await createGuestPass({
      eventId, kind, name: name.trim(), email: email.trim() || null, phone: phone.trim() || null,
      language: lang, showRevenue: canMoney && money, places: places || null,
    });
    capturePosthog('guest_space_created', { event_id: eventId, guest_kind: kind, source: 'coorg_page', show_revenue: pass.show_revenue, channel: email.trim() ? 'email' : 'whatsapp' });
    if (email.trim()) {
      try { await sendGuestPassEmail(pass.id); toast.success(w('guestSpace.org.sent')); }
      catch (err) { toast.error(guestErrorText(guestErrorCode(err), w)); }
    } else {
      toast.success(w('guestSpace.org.created'));
      const href = whatsappHref(phone, guestSpaceShareText(lang, { guest: name.trim(), event: eventTitle, page: guestSpaceUrl(pass.token) }));
      if (href) window.open(href, '_blank', 'noopener');
    }
    setOpen(false); setEmail(''); setPhone(''); setPlaces(0);
  });

  const share = (r: GuestPassRow) => {
    const text = guestSpaceShareText(toGuestSpaceLanguage(r.language), { guest: r.guest_name, event: eventTitle, page: guestSpaceUrl(r.token) });
    window.open(whatsappHref(r.contact_phone, text) ?? `https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    capturePosthog('guest_space_shared', { event_id: eventId, channel: 'whatsapp' });
  };

  const copy = async (r: GuestPassRow) => {
    try { await navigator.clipboard.writeText(guestSpaceUrl(r.token)); toast.success(w('guestSpace.org.copied')); } catch { /* « Ouvrir l'espace » reste là */ }
  };

  const when = (iso: string) => new Intl.DateTimeFormat(guestSpaceLocale(toGuestSpaceLanguage(language, 'fr')), {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));

  const live = rows.filter((r) => !r.revoked);

  return (
    <OrgCard className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <OrgSectionLabel>{w('guestSpace.org.cardTitle')}</OrgSectionLabel>
          <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>{w('guestSpace.org.cardSub')}</p>
        </div>
        {!open && live.length < 8 && (
          <OrgButton size="sm" variant={rows.length ? 'secondary' : 'primary'} onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> {w('guestSpace.org.add')}
          </OrgButton>
        )}
      </div>

      {open && (
        <div className="mb-3 space-y-2 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
          <OrgTabs size="sm" value={kind} onChange={(v) => setKind(v as GuestKind)} tabs={[
            { value: 'venue', label: w('guestSpace.org.kindVenue') }, { value: 'org', label: w('guestSpace.org.kindOrg') },
          ]} />
          <DarkInput value={name} onChange={setName} placeholder={w('guestSpace.org.name')} />
          <DarkInput type="email" value={email} onChange={setEmail} placeholder={w('guestSpace.org.email')} />
          <PhoneInputWithCountry value={phone} onChange={setPhone} defaultCountry={country} size="sm" tone="dark" placeholder={w('guestSpace.org.phone')} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <span style={{ color: T3, fontSize: 11.5 }}>{w('guestSpace.org.language')}</span>
              <OrgTabs size="sm" value={lang} onChange={(v) => setLang(v as GuestSpaceLanguage)} tabs={[...LANG_TABS]} />
            </div>
            <label className="flex items-center gap-2" style={{ color: T2, fontSize: 12 }}>
              <span style={{ color: T3, fontSize: 11.5 }}>{w('guestSpace.org.places')}</span>
              <input type="number" min={0} max={500} value={places} onChange={(e) => setPlaces(Math.max(0, Math.min(500, Number(e.target.value) || 0)))}
                className="w-16 rounded-lg px-2 py-1 tabular-nums" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, fontSize: 12.5 }} />
            </label>
            <label className="flex items-center gap-2" style={{ color: canMoney ? T2 : T3, fontSize: 12 }}>
              <Switch checked={canMoney && money} disabled={!canMoney} onCheckedChange={setMoney} />
              {w('guestSpace.org.showRevenue')}
            </label>
          </div>
          <p style={{ color: T3, fontSize: 11, lineHeight: 1.45 }}>
            {canMoney ? w('guestSpace.org.showRevenueHint') : w('guestSpace.org.revenueLocked')} {w('guestSpace.org.roleHint')}
          </p>
          <div className="flex gap-2">
            <OrgButton size="sm" variant="primary" disabled={!canCreate || busy === 'create'} onClick={() => void create()}>
              {busy === 'create' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : email.trim() ? <Mail className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />}
              {email.trim() ? w('guestSpace.org.sendEmail') : w('guestSpace.org.create')}
            </OrgButton>
            <OrgButton size="sm" variant="ghost" onClick={() => setOpen(false)}>{w('guestSpace.org.cancel')}</OrgButton>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {rows.map((r) => (
          <PassRow key={r.id} r={r} w={w} busy={busy} canMoney={canMoney} when={when}
            staff={staff.filter((s) => s.guest_name === r.guest_name)}
            editing={editing === r.id} onEdit={() => setEditing(editing === r.id ? null : r.id)}
            staffOpen={staffFor === r.id} onStaff={() => setStaffFor(staffFor === r.id ? null : r.id)}
            country={country} eventId={eventId} eventTitle={eventTitle}
            run={run} share={share} copy={copy}
            onInviteParty={() => {
              if (!r.guest_party) return;
              const id = r.guest_party.slice(r.guest_party.indexOf(':') + 1);
              setBusy(`claim:${r.id}`);
              inviteEventCohost({ eventId, venueId: r.guest_kind === 'venue' ? id : null, organizerUserId: r.guest_kind === 'org' ? id : null, access: 'viewer', shareCrm: false })
                .then(() => { toast.success(w('guestSpace.org.claimInvited')); return load(); })
                .catch((err) => toast.error(coorgErr(coorgErrorCode(err))))
                .finally(() => setBusy(null));
            }} />
        ))}
        {rows.length === 0 && !open && <p style={{ color: T3, fontSize: 12, lineHeight: 1.5 }}>{w('guestSpace.org.roleHint')}</p>}
      </div>
    </OrgCard>
  );
}

function PassRow({ r, w, busy, canMoney, when, staff, editing, onEdit, staffOpen, onStaff, country, eventId, eventTitle, run, share, copy, onInviteParty }: {
  r: GuestPassRow; w: ReturnType<typeof guestUiWords>; busy: string | null; canMoney: boolean; when: (iso: string) => string;
  staff: DoorStaffRow[]; editing: boolean; onEdit: () => void; staffOpen: boolean; onStaff: () => void;
  country: string | undefined; eventId: string; eventTitle: string;
  run: (key: string, fn: () => Promise<unknown>, ok?: string) => Promise<void>;
  share: (r: GuestPassRow) => void; copy: (r: GuestPassRow) => Promise<void>; onInviteParty: () => void;
}) {
  const [places, setPlaces] = useState(r.guest_list?.places ?? 0);
  const [st, setSt] = useState(r.share_tickets_pct ?? '');
  const [sb, setSb] = useState(r.share_tables_pct ?? '');
  const [sName, setSName] = useState('');
  const [sEmail, setSEmail] = useState('');
  const [sPhone, setSPhone] = useState('');
  const Icon = r.guest_kind === 'venue' ? Building2 : Users;

  const inviteStaff = () => run(`staff:${r.id}`, async () => {
    const res = await inviteEventDoorStaff({ eventId, name: sName.trim(), email: sEmail.trim() || null, phone: sPhone.trim() || null, passId: r.id });
    if (res.email) await sendDoorInviteEmail(res.id, null);
    else if (res.phone) {
      const href = whatsappHref(res.phone, w('guestSpace.door.staffWhatsapp', { name: sName.trim().split(' ')[0], event: eventTitle, link: doorInviteUrl(res.invite_token) }));
      if (href) window.open(href, '_blank', 'noopener');
    }
    setSName(''); setSEmail(''); setSPhone('');
  }, w('guestSpace.door.staffInvited'));

  return (
    <div className="space-y-2 rounded-xl px-3 py-2.5" style={{ background: INNER_BG, border: `1px solid ${r.revoked ? BORDER : 'rgba(232,25,44,0.25)'}`, opacity: r.revoked ? 0.7 : 1 }}>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full" style={{ background: 'rgba(232,25,44,0.12)', color: RED }}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{r.guest_name}</p>
          <p className="truncate" style={{ color: T3, fontSize: 11.5 }}>
            {[r.contact_email, r.contact_phone].filter(Boolean).join(' · ')}{' · '}
            {r.revoked ? w('guestSpace.org.revoked')
              : r.opened_count === 0 ? w('guestSpace.org.neverOpened')
                : r.opened_count === 1 ? w('guestSpace.org.openedOnce', { when: when(r.last_opened_at ?? r.created_at) })
                  : w('guestSpace.org.opened', { n: r.opened_count, when: when(r.last_opened_at ?? r.created_at) })}
          </p>
        </div>
        {r.email_sent_count > 0 && <OrgPill tone="default">{w('guestSpace.org.emailSent')}</OrgPill>}
      </div>

      <p style={{ color: T3, fontSize: 11.5 }}>
        {r.guest_list ? `${w('guestSpace.org.glLine', { n: r.guest_list.registered, cap: r.guest_list.places })} · ` : ''}
        {w('guestSpace.org.linkStats', { clicks: r.link_clicks, sales: r.link_sales })}
      </p>

      {r.places_requested ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg px-2.5 py-2" style={{ border: `1px solid ${BORDER}` }}>
          <p className="min-w-0 flex-1" style={{ color: T2, fontSize: 12 }}>{w('guestSpace.org.placesRequested', { n: r.places_requested })}</p>
          <OrgButton size="sm" variant="primary" disabled={!!busy}
            onClick={() => run(`grant:${r.id}`, () => updateGuestPass(r.id, { places: (r.guest_list?.places ?? 0) + (r.places_requested ?? 0) }), w('guestSpace.org.saved'))}>
            {w('guestSpace.org.grant', { n: r.places_requested })}
          </OrgButton>
        </div>
      ) : null}
      {r.statement_response && (
        <p style={{ color: r.statement_response === 'approved' ? 'var(--acc-34d399)' : 'var(--acc-fcd34d)', fontSize: 12 }}>
          {r.statement_response === 'approved' ? w('guestSpace.org.approved') : w('guestSpace.org.contested', { reason: r.statement_reason ?? '' })}
        </p>
      )}
      {r.guest_party && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg px-2.5 py-2" style={{ border: `1px solid ${BORDER}` }}>
          <p className="min-w-0 flex-1" style={{ color: T2, fontSize: 12, lineHeight: 1.45 }}>
            {r.guest_is_party ? w('guestSpace.org.claimedAccepted', { name: r.guest_party_name ?? r.guest_name })
              : r.guest_invited ? w('guestSpace.org.claimInvited') : w('guestSpace.org.claimedPending', { name: r.guest_party_name ?? r.guest_name })}
          </p>
          {!r.guest_is_party && !r.guest_invited && r.claim_status === 'pending' && (
            <OrgButton size="sm" variant="primary" disabled={!!busy} onClick={onInviteParty}>
              <UserPlus className="h-3.5 w-3.5" /> {w('guestSpace.org.claimInvite')}
            </OrgButton>
          )}
        </div>
      )}

      {!r.revoked && (
        <div className="flex flex-wrap items-center gap-1.5">
          {r.contact_email && (
            <OrgButton size="sm" variant="secondary" disabled={!!busy}
              onClick={() => run(`mail:${r.id}`, () => sendGuestPassEmail(r.id), w('guestSpace.org.sent'))}>
              {busy === `mail:${r.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
              {r.email_sent_count > 0 ? w('guestSpace.org.resend') : w('guestSpace.org.sendEmail')}
            </OrgButton>
          )}
          <OrgButton size="sm" variant="secondary" onClick={() => share(r)}><MessageCircle className="h-3.5 w-3.5" /> {w('guestSpace.org.whatsapp')}</OrgButton>
          <OrgButton size="sm" variant="ghost" onClick={() => void copy(r)}><Copy className="h-3.5 w-3.5" /> {w('guestSpace.org.copy')}</OrgButton>
          <a href={guestSpaceUrl(r.token)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-2 py-1" style={{ color: T2, fontSize: 12, fontWeight: 560 }}>
            <ExternalLink className="h-3.5 w-3.5" /> {w('guestSpace.org.preview')}
          </a>
          <OrgButton size="sm" variant="ghost" onClick={onEdit}><Settings2 className="h-3.5 w-3.5" /> {w('guestSpace.org.edit')}</OrgButton>
          {r.guest_kind === 'venue' && (
            <OrgButton size="sm" variant="ghost" onClick={onStaff}><ScanLine className="h-3.5 w-3.5" /> {w('guestSpace.org.staffInvite')}</OrgButton>
          )}
        </div>
      )}

      {editing && !r.revoked && (
        <div className="space-y-2 rounded-lg p-2.5" style={{ border: `1px solid ${BORDER}` }}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2" style={{ fontSize: 12 }}>
              <span style={{ color: T3 }}>{w('guestSpace.org.places')}</span>
              <input type="number" min={0} max={500} value={places} onChange={(e) => setPlaces(Math.max(0, Math.min(500, Number(e.target.value) || 0)))}
                className="w-16 rounded-lg px-2 py-1 tabular-nums" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }} />
            </label>
            <label className="flex items-center gap-2" style={{ color: canMoney ? T2 : T3, fontSize: 12 }}>
              <Switch checked={r.show_revenue} disabled={!!busy || (!canMoney && !r.show_revenue)}
                onCheckedChange={(v) => run(`rev:${r.id}`, () => updateGuestPass(r.id, { showRevenue: v }))} />
              {w('guestSpace.org.showRevenue')}
            </label>
          </div>
          {canMoney && (
            <div className="space-y-1.5">
              <p style={{ color: T2, fontSize: 12, fontWeight: 600 }}>{w('guestSpace.org.shares')}</p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5" style={{ color: T3, fontSize: 12 }}>{w('guestSpace.org.shareTickets')}
                  <input type="number" min={0} max={100} value={st} onChange={(e) => setSt(e.target.value === '' ? '' : Math.max(0, Math.min(100, Number(e.target.value))))}
                    className="w-16 rounded-lg px-2 py-1 tabular-nums" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }} />
                </label>
                <label className="flex items-center gap-1.5" style={{ color: T3, fontSize: 12 }}>{w('guestSpace.org.shareTables')}
                  <input type="number" min={0} max={100} value={sb} onChange={(e) => setSb(e.target.value === '' ? '' : Math.max(0, Math.min(100, Number(e.target.value))))}
                    className="w-16 rounded-lg px-2 py-1 tabular-nums" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }} />
                </label>
              </div>
              <p style={{ color: T3, fontSize: 11 }}>{w('guestSpace.org.sharesHint')}</p>
            </div>
          )}
          <OrgButton size="sm" variant="primary" disabled={!!busy}
            onClick={() => run(`save:${r.id}`, () => updateGuestPass(r.id, {
              places, ...(canMoney ? (st === '' && sb === '' ? { clearShares: true } : { shareTicketsPct: st === '' ? null : Number(st), shareTablesPct: sb === '' ? null : Number(sb) }) : {}),
            }), w('guestSpace.org.saved'))}>
            {w('guestSpace.org.save')}
          </OrgButton>
        </div>
      )}

      {staffOpen && !r.revoked && (
        <div className="space-y-2 rounded-lg p-2.5" style={{ border: `1px solid ${BORDER}` }}>
          <p style={{ color: T2, fontSize: 12, fontWeight: 600 }}>{w('guestSpace.org.staffTitle')}</p>
          {staff.map((s) => (
            <div key={s.id} className="flex items-center gap-2" style={{ fontSize: 12.5 }}>
              <span className="min-w-0 flex-1 truncate" style={{ color: T1 }}>{s.name}</span>
              <OrgPill tone={s.status === 'accepted' ? 'success' : 'warn'}>{s.status === 'accepted' ? w('guestSpace.door.staffActive') : w('guestSpace.door.staffInvited')}</OrgPill>
              <button type="button" className="rounded p-1" style={{ color: T3 }} disabled={!!busy}
                onClick={() => run(`rs:${s.id}`, () => revokeEventDoorStaff(s.id))} aria-label={w('guestSpace.door.staffRemove')}>
                <Power className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <DarkInput value={sName} onChange={setSName} placeholder={w('guestSpace.door.staffNamePh')} />
            <DarkInput type="email" value={sEmail} onChange={setSEmail} placeholder="email@club.com" />
            <PhoneInputWithCountry value={sPhone} onChange={setSPhone} defaultCountry={country} size="sm" tone="dark" placeholder="WhatsApp" />
            <OrgButton size="sm" variant="primary" disabled={!!busy || sName.trim().length < 2 || (!sEmail.trim() && !sPhone.trim())} onClick={() => void inviteStaff()}>
              {w('guestSpace.door.staffInvite')}
            </OrgButton>
          </div>
          <p style={{ color: T3, fontSize: 11 }}>{w('guestSpace.org.staffRule')}</p>
        </div>
      )}

      <div className="flex justify-end">
        <OrgButton size="sm" variant="ghost" disabled={!!busy}
          onClick={() => run(`rv:${r.id}`, () => updateGuestPass(r.id, { revoked: !r.revoked }))}>
          <Power className="h-3.5 w-3.5" /> {r.revoked ? w('guestSpace.org.reopen') : w('guestSpace.org.revoke')}
        </OrgButton>
      </div>
    </div>
  );
}
