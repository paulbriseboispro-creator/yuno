import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Building2, Copy, ExternalLink, FileSignature, Loader2, Mail, MessageCircle, Plus, Power, RotateCcw, ScanLine, Settings2, UserPlus, Users,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { OrgCard, OrgButton, OrgPill, OrgSectionLabel, OrgTabs, DarkInput, DarkTextarea, POS, RED, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import { PhoneInputWithCountry } from '@/components/PhoneInputWithCountry';
import { supabase } from '@/integrations/supabase/client';
import { inviteEventCohost, coorgErrorCode } from '@/lib/coorg';
import { marketCountry } from '@/lib/geo';
import { capturePosthog } from '@/lib/posthog';
import {
  cancelGuestContract, createGuestPass, declineGuestPlaces, doorInviteUrl, formatIban, markGuestTransferSent, proposeGuestContract, guestErrorCode, guestErrorText, guestLanguageForEvent, guestSpaceLocale, guestSpaceShareText,
  getGuestPassLink, guestInviteUrl, guestShareUrl, guestSpacePath, guestUiWords, resetGuestPassAccess, setGuestPassDoor, setGuestPassPhoto, uploadGuestPhoto, inviteEventDoorStaff, listEventDoorStaff, listGuestPasses, revokeEventDoorStaff,
  sendDoorInviteEmail, sendGuestPassEmail, toGuestSpaceLanguage, updateGuestPass, whatsappHref,
  type DoorStaffRow, type GuestContractTerms, type GuestDoorMode, type GuestKind, type GuestPassRow, type GuestSpaceLanguage,
} from '@/lib/guestSpace';
import { openPendingTab } from '@/lib/stripeConnectClient';
import { GuestAvatar, GuestAvatarButton } from '@/components/guest-space/GuestPhoto';
import { useCoorgErrorText, useCoorgT } from './coorgUi';

const LANG_TABS = [{ value: 'es', label: 'ES' }, { value: 'fr', label: 'FR' }, { value: 'en', label: 'EN' }] as const;

/** Deux choix indépendants à l'invitation (Paul, 20/10) : avec ou sans contrat, avec ou sans montants. */
/** Qui tient la porte d'une soirée pour un club invité (organisateur seul, club seul, les deux). */
const doorTabs = (w: ReturnType<typeof guestUiWords>) => [
  { value: 'organizer', label: w('guestSpace.org.doorOrganizer') },
  { value: 'guest', label: w('guestSpace.org.doorGuest') },
  { value: 'both', label: w('guestSpace.org.doorBoth') },
];
const DEFAULT_TERMS: GuestContractTerms = { tickets_pct: 20, tables_pct: 10, payment_terms_days: 15, bar_to_guest: true, note: null };
const eurFmt = (lang: string) => new Intl.NumberFormat(lang === 'en' ? 'en-GB' : lang === 'es' ? 'es-ES' : 'fr-FR', { style: 'currency', currency: 'EUR' });

/**
 * « Invités » sur la page Co-organisation : chaque club
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
  const [withContract, setWithContract] = useState(false);
  const [money, setMoney] = useState(true);
  const [terms, setTerms] = useState<GuestContractTerms>(DEFAULT_TERMS);
  const [places, setPlaces] = useState(0);
  // Photo préchargée (logo du club…) : envoyée une fois l'accès créé (le dossier porte son id).
  const [photo, setPhoto] = useState<File | null>(null);
  const photoPreview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview); }, [photoPreview]);
  const [door, setDoor] = useState<GuestDoorMode>('both');

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
  const contractOn = canMoney && withContract;
  const canCreate = name.trim().length > 0 && (email.trim() || phone.trim()) && emailOk;

  const create = () => run('create', async () => {
    // Onglet WhatsApp ouvert dans le geste du clic (Safari bloque un window.open après un await).
    const tab = !email.trim() && phone.trim() ? openPendingTab() : null;
    const pass = await createGuestPass({
      eventId, kind, name: name.trim(), email: email.trim() || null, phone: phone.trim() || null,
      language: lang, showRevenue: canMoney && money, places: places || null,
    });
    if (contractOn) await proposeGuestContract(pass.id, { ...terms, bar_to_guest: kind === 'venue' && terms.bar_to_guest });
    if (kind === 'venue' && door !== 'both') await setGuestPassDoor(pass.id, door);
    if (photo) {
      try { await setGuestPassPhoto(pass.id, await uploadGuestPhoto(pass.id, photo)); }
      catch (err) { toast.error(guestErrorText(guestErrorCode(err), w)); }
    }
    capturePosthog('guest_space_created', { event_id: eventId, guest_kind: kind, source: 'coorg_page', show_revenue: pass.show_revenue, channel: email.trim() ? 'email' : 'whatsapp', contract: contractOn });
    if (email.trim()) {
      try { await sendGuestPassEmail(pass.id); toast.success(w('guestSpace.org.sent')); }
      catch (err) { toast.error(guestErrorText(guestErrorCode(err), w)); }
    } else {
      toast.success(w('guestSpace.org.created'));
      const href = whatsappHref(phone, guestSpaceShareText(lang, { guest: name.trim(), event: eventTitle, page: guestInviteUrl(pass.token) }));
      if (href && tab) tab.go(href); else tab?.close();
    }
    setOpen(false); setEmail(''); setPhone(''); setPlaces(0); setPhoto(null);
  });

  // Un lien à partager = l'espace s'il est déjà rattaché, sinon une invitation NEUVE (jeton à usage unique).
  const share = async (r: GuestPassRow) => {
    const tab = openPendingTab();
    try {
      const link = guestShareUrl(await getGuestPassLink(r.id));
      const text = guestSpaceShareText(toGuestSpaceLanguage(r.language), { guest: r.guest_name, event: eventTitle, page: link });
      tab.go(whatsappHref(r.contact_phone, text) ?? `https://wa.me/?text=${encodeURIComponent(text)}`);
      capturePosthog('guest_space_shared', { event_id: eventId, channel: 'whatsapp' });
    } catch (err) {
      tab.close();
      toast.error(guestErrorText(guestErrorCode(err), w));
    }
  };

  const copy = async (r: GuestPassRow) => {
    try {
      const link = guestShareUrl(await getGuestPassLink(r.id));
      await navigator.clipboard.writeText(link);
      toast.success(w('guestSpace.org.copied'));
    } catch (err) {
      toast.error(guestErrorText(guestErrorCode(err), w));
    }
  };

  const resend = (r: GuestPassRow) => {
    if (!window.confirm(w('guestSpace.org.resendConfirm'))) return;
    void run(`reset:${r.id}`, async () => {
      const res = await resetGuestPassAccess(r.id);
      if (r.contact_email) await sendGuestPassEmail(r.id).catch(() => { /* le lien copié suffit */ });
      try { await navigator.clipboard.writeText(guestInviteUrl(res.token)); } catch { /* presse-papier refusé */ }
    }, w('guestSpace.org.resent'));
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
            {kind === 'venue' && (
              <div className="flex items-center gap-2">
                <span style={{ color: T3, fontSize: 11.5 }}>{w('guestSpace.org.door')}</span>
                <OrgTabs size="sm" value={door} onChange={(v) => setDoor(v as GuestDoorMode)} tabs={doorTabs(w)} />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <GuestAvatarButton url={photoPreview} name={name || '?'} kind={kind} size={36}
              label={w('guestSpace.org.photo')} onFile={(f) => setPhoto(f)} />
            <span style={{ color: T3, fontSize: 11.5, lineHeight: 1.4 }}>{w('guestSpace.org.photoHint')}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Choice w={w} label={w('guestSpace.org.contract')} value={contractOn} onChange={setWithContract} disabled={!canMoney}
              off={w('guestSpace.org.contractOff')} on={w('guestSpace.org.modeContract')}
              hint={contractOn ? w('guestSpace.org.contractOnHint') : w('guestSpace.org.contractOffHint')} />
            <Choice w={w} label={w('guestSpace.org.amounts')} value={canMoney && money} onChange={setMoney} disabled={!canMoney}
              off={w('guestSpace.org.amountsOff')} on={w('guestSpace.org.amountsOn')}
              hint={canMoney && money ? w('guestSpace.org.modeAmountsHint') : contractOn ? w('guestSpace.org.amountsOffContractHint') : w('guestSpace.org.modeStatsHint')} />
          </div>
          {contractOn && <ContractTermsFields w={w} value={terms} onChange={setTerms} isVenue={kind === 'venue'} />}
          {kind === 'venue' && <p style={{ color: T3, fontSize: 11, lineHeight: 1.45 }}>{w('guestSpace.org.doorHint')}</p>}
          <p style={{ color: T3, fontSize: 11, lineHeight: 1.45 }}>
            {canMoney ? '' : `${w('guestSpace.org.revenueLocked')} `}{w('guestSpace.org.roleHint')}
          </p>
          <div className="flex gap-2">
            <OrgButton size="sm" variant="primary" disabled={!canCreate || busy === 'create'} onClick={() => void create()}>
              {busy === 'create' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : contractOn ? <FileSignature className="h-3.5 w-3.5" /> : email.trim() ? <Mail className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />}
              {contractOn ? w('guestSpace.org.contractSend') : email.trim() ? w('guestSpace.org.sendEmail') : w('guestSpace.org.create')}
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
            run={run} share={share} copy={copy} resend={resend}
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

function PassRow({ r, w, busy, canMoney, when, staff, editing, onEdit, staffOpen, onStaff, country, eventId, eventTitle, run, share, copy, resend, onInviteParty }: {
  r: GuestPassRow; w: ReturnType<typeof guestUiWords>; busy: string | null; canMoney: boolean; when: (iso: string) => string;
  staff: DoorStaffRow[]; editing: boolean; onEdit: () => void; staffOpen: boolean; onStaff: () => void;
  country: string | undefined; eventId: string; eventTitle: string;
  run: (key: string, fn: () => Promise<unknown>, ok?: string) => Promise<void>;
  share: (r: GuestPassRow) => Promise<void>; copy: (r: GuestPassRow) => Promise<void>; resend: (r: GuestPassRow) => void; onInviteParty: () => void;
}) {
  const [places, setPlaces] = useState(r.guest_list?.places ?? 0);
  const [st, setSt] = useState(r.share_tickets_pct ?? '');
  const [sb, setSb] = useState(r.share_tables_pct ?? '');
  const [sName, setSName] = useState('');
  const [sEmail, setSEmail] = useState('');
  const [sPhone, setSPhone] = useState('');
  const [proposing, setProposing] = useState(false);
  const contractActive = r.contract_status === 'proposed' || r.contract_status === 'signed';

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
        {/* Photo : l'organisateur la précharge ou la change tant que l'invité n'a pas choisi la sienne. */}
        {r.revoked || r.photo_set_by === 'guest'
          ? <span title={r.photo_set_by === 'guest' ? w('guestSpace.org.photoByGuest') : undefined}><GuestAvatar url={r.photo_url} name={r.guest_name} kind={r.guest_kind} size={30} /></span>
          : <GuestAvatarButton url={r.photo_url} name={r.guest_name} kind={r.guest_kind} size={30} label={w('guestSpace.org.photo')}
              disabled={!!busy}
              onFile={(f) => void run(`photo:${r.id}`, async () => setGuestPassPhoto(r.id, await uploadGuestPhoto(r.id, f)), w('guestSpace.photo.saved'))} />}
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
      {!r.revoked && (
        <p className="truncate" style={{ color: r.account_email ? T2 : T3, fontSize: 11.5 }}>
          {r.account_email ? w('guestSpace.org.linkedTo', { email: r.account_email }) : w('guestSpace.org.notLinked')}
        </p>
      )}

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
          <OrgButton size="sm" variant="ghost" disabled={!!busy}
            onClick={() => run(`decline:${r.id}`, () => declineGuestPlaces(r.id), w('guestSpace.org.declined'))}>
            {w('guestSpace.org.decline')}
          </OrgButton>
        </div>
      ) : null}
      {r.statement_response && (
        <p style={{ color: r.statement_response === 'approved' ? 'var(--acc-34d399)' : 'var(--acc-fcd34d)', fontSize: 12 }}>
          {r.statement_response === 'approved' ? w('guestSpace.org.approved') : w('guestSpace.org.contested', { reason: r.statement_reason ?? '' })}
        </p>
      )}
      {canMoney && !r.revoked && (contractActive || proposing) && (
        <ContractSection r={r} w={w} busy={busy} run={run} startEditing={proposing} onClose={() => setProposing(false)} />
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
          <OrgButton size="sm" variant="secondary" onClick={() => void share(r)}><MessageCircle className="h-3.5 w-3.5" /> {w('guestSpace.org.whatsapp')}</OrgButton>
          <OrgButton size="sm" variant="ghost" onClick={() => void copy(r)}><Copy className="h-3.5 w-3.5" /> {w('guestSpace.org.copy')}</OrgButton>
          <a href={guestSpacePath(r.id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-2 py-1" style={{ color: T2, fontSize: 12, fontWeight: 560 }}>
            <ExternalLink className="h-3.5 w-3.5" /> {w('guestSpace.org.preview')}
          </a>
          {r.account_email && (
            <OrgButton size="sm" variant="ghost" disabled={!!busy} onClick={() => resend(r)}>
              {busy === `reset:${r.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} {w('guestSpace.org.resendInvite')}
            </OrgButton>
          )}
          <OrgButton size="sm" variant="ghost" onClick={onEdit}><Settings2 className="h-3.5 w-3.5" /> {w('guestSpace.org.edit')}</OrgButton>
          {canMoney && !contractActive && !proposing && (
            <OrgButton size="sm" variant="ghost" onClick={() => setProposing(true)}><FileSignature className="h-3.5 w-3.5" /> {w('guestSpace.org.contractPropose')}</OrgButton>
          )}
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
            {r.guest_kind === 'venue' && (
              <div className="flex items-center gap-2">
                <span style={{ color: T3, fontSize: 12 }}>{w('guestSpace.org.door')}</span>
                <OrgTabs size="sm" value={r.door_mode ?? 'both'} tabs={doorTabs(w)}
                  onChange={(v) => { if (!busy && v !== r.door_mode) void run(`door:${r.id}`, () => setGuestPassDoor(r.id, v as GuestDoorMode), w('guestSpace.org.saved')); }} />
              </div>
            )}
          </div>
          {canMoney && (r.contract_status !== 'proposed' && r.contract_status !== 'signed') && (
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
              places, ...(canMoney && r.contract_status !== 'proposed' && r.contract_status !== 'signed'
                ? (st === '' && sb === '' ? { clearShares: true } : { shareTicketsPct: st === '' ? null : Number(st), shareTablesPct: sb === '' ? null : Number(sb) }) : {}),
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

/** Un choix à deux positions (Sans / Avec), avec sa phrase d'explication. */
function Choice({ label, value, onChange, disabled, off, on, hint }: {
  w: ReturnType<typeof guestUiWords>; label: string; value: boolean; onChange: (v: boolean) => void;
  disabled?: boolean; off: string; on: string; hint: string;
}) {
  return (
    <div className="space-y-1.5 rounded-lg p-2.5" style={{ border: `1px solid ${BORDER}`, opacity: disabled ? 0.55 : 1 }}>
      <p style={{ color: T2, fontSize: 12, fontWeight: 600 }}>{label}</p>
      <OrgTabs size="sm" value={value ? 'on' : 'off'} onChange={(v) => { if (!disabled) onChange(v === 'on'); }}
        tabs={[{ value: 'off', label: off }, { value: 'on', label: on }]} />
      <p style={{ color: T3, fontSize: 11, lineHeight: 1.4 }}>{hint}</p>
    </div>
  );
}

function ContractTermsFields({ w, value, onChange, isVenue }: {
  w: ReturnType<typeof guestUiWords>; value: GuestContractTerms; onChange: (v: GuestContractTerms) => void; isVenue: boolean;
}) {
  const pct = (k: 'tickets_pct' | 'tables_pct', label: string) => (
    <label className="flex items-center gap-1.5" style={{ color: T3, fontSize: 12 }}>{label}
      <input type="number" min={0} max={100} value={value[k]}
        onChange={(e) => onChange({ ...value, [k]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
        className="w-16 rounded-lg px-2 py-1 tabular-nums" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }} />
    </label>
  );
  return (
    <div className="space-y-2 rounded-lg p-2.5" style={{ border: `1px solid ${BORDER}` }}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {pct('tickets_pct', w('guestSpace.org.ticketsPct'))}
        {pct('tables_pct', w('guestSpace.org.tablesPct'))}
        <div className="flex items-center gap-2">
          <span style={{ color: T3, fontSize: 12 }}>{w('guestSpace.org.payTerms')}</span>
          <OrgTabs size="sm" value={String(value.payment_terms_days)} onChange={(v) => onChange({ ...value, payment_terms_days: Number(v) as 7 | 15 | 30 })}
            tabs={[7, 15, 30].map((n) => ({ value: String(n), label: w('guestSpace.org.days', { n }) }))} />
        </div>
        {isVenue && (
          <label className="flex items-center gap-2" style={{ color: T2, fontSize: 12 }}>
            <Switch checked={value.bar_to_guest} onCheckedChange={(v) => onChange({ ...value, bar_to_guest: v })} />
            {w('guestSpace.org.barToGuest')}
          </label>
        )}
      </div>
      <DarkTextarea value={value.note ?? ''} onChange={(v) => onChange({ ...value, note: v || null })} placeholder={w('guestSpace.org.note')} rows={2} />
      <p style={{ color: T3, fontSize: 11, lineHeight: 1.45 }}>{w('guestSpace.org.contractHint')}</p>
    </div>
  );
}

/** Le contrat d'UN invité : proposer, suivre la signature, puis le virement. */
function ContractSection({ r, w, busy, run, startEditing = false, onClose }: {
  r: GuestPassRow; w: ReturnType<typeof guestUiWords>; busy: string | null;
  run: (key: string, fn: () => Promise<unknown>, ok?: string) => Promise<void>;
  startEditing?: boolean; onClose: () => void;
}) {
  const active = r.contract_status === 'proposed' || r.contract_status === 'signed';
  const [edit, setEditState] = useState(startEditing);
  const setEdit = (v: boolean) => { setEditState(v); if (!v) onClose(); };
  const [terms, setTerms] = useState<GuestContractTerms>(r.contract_terms ?? DEFAULT_TERMS);
  const [ref, setRef] = useState('');
  const [lang] = useState(() => (typeof document !== 'undefined' ? document.documentElement.lang : 'fr') || 'fr');
  const eur = eurFmt(lang);
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(lang || 'fr', { day: 'numeric', month: 'long' }) : '');
  const frozen = !!r.statement_frozen_at;
  const t = r.contract_terms;

  const status = !active ? w('guestSpace.org.contractNone')
    : r.contract_status === 'signed'
      ? w('guestSpace.org.contractSigned', { date: day(r.contract_signed_at), name: r.contract_signer_name ?? '' })
      : w('guestSpace.org.contractWaiting', { n: r.contract_version });

  return (
    <div className="space-y-2 rounded-lg px-2.5 py-2" style={{ border: `1px solid ${active ? 'rgba(232,25,44,0.25)' : BORDER}` }}>
      <div className="flex flex-wrap items-center gap-2">
        <FileSignature className="h-3.5 w-3.5 flex-none" style={{ color: active ? RED : T3 }} />
        <p className="min-w-0 flex-1" style={{ color: T2, fontSize: 12, lineHeight: 1.45 }}>
          <b style={{ color: T1 }}>{w('guestSpace.org.contract')}</b> · {status}
          {active && t ? ` · ${t.tickets_pct} % / ${t.tables_pct} % · ${w('guestSpace.org.days', { n: t.payment_terms_days })}` : ''}
        </p>
        {r.contract_status === 'signed' && <OrgPill tone="success">{w('guestSpace.contract.signed')}</OrgPill>}
        {r.contract_status === 'proposed' && <OrgPill tone="warn">{w('guestSpace.contract.toSign')}</OrgPill>}
        {!frozen && !edit && (
          <OrgButton size="sm" variant={active ? 'ghost' : 'secondary'} disabled={!!busy || !r.contact_email} onClick={() => setEdit(true)}>
            {active ? w('guestSpace.org.contractEdit') : w('guestSpace.org.contractPropose')}
          </OrgButton>
        )}
      </div>

      {edit && (
        <>
          <ContractTermsFields w={w} value={terms} onChange={setTerms} isVenue={r.guest_kind === 'venue'} />
          <div className="flex flex-wrap gap-2">
            <OrgButton size="sm" variant="primary" disabled={!!busy}
              onClick={() => run(`ct:${r.id}`, async () => {
                await proposeGuestContract(r.id, { ...terms, bar_to_guest: r.guest_kind === 'venue' && terms.bar_to_guest });
                setEdit(false);
                if (r.contact_email) await sendGuestPassEmail(r.id).catch(() => { /* l'espace montre le contrat de toute façon */ });
              }, w('guestSpace.org.contractSent', { guest: r.guest_name }))}>
              <FileSignature className="h-3.5 w-3.5" /> {w('guestSpace.org.contractSend')}
            </OrgButton>
            <OrgButton size="sm" variant="ghost" onClick={() => setEdit(false)}>{w('guestSpace.org.cancel')}</OrgButton>
            {active && (
              <OrgButton size="sm" variant="ghost" disabled={!!busy}
                onClick={() => run(`cc:${r.id}`, async () => { await cancelGuestContract(r.id); setEdit(false); }, w('guestSpace.org.contractWithdrawn'))}>
                {w('guestSpace.org.contractCancel')}
              </OrgButton>
            )}
          </div>
        </>
      )}

      {frozen && r.contract_status === 'signed' && (
        <div className="space-y-1.5 pt-1" style={{ borderTop: `1px solid ${BORDER}` }}>
          <p style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>
            {w('guestSpace.org.contractFrozen', { amount: eur.format(r.transfer_amount ?? 0) })}
            {r.transfer_reference ? <span style={{ color: T3, fontWeight: 500 }}> · {r.transfer_reference}</span> : null}
          </p>
          {r.guest_iban ? (
            <p style={{ color: T2, fontSize: 12 }}>
              {w('guestSpace.org.ibanOf', { guest: r.guest_name })} :{' '}
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: T1, userSelect: 'all' }}>{formatIban(r.guest_iban)}</span>
              {r.guest_iban_holder ? ` · ${r.guest_iban_holder}` : ''}
            </p>
          ) : <p style={{ color: 'var(--acc-fcd34d)', fontSize: 12 }}>{w('guestSpace.org.ibanWaiting', { guest: r.guest_name })}</p>}
          <p style={{ color: r.transfer_status === 'received' ? POS : r.transfer_status === 'disputed' ? 'var(--acc-fcd34d)' : T2, fontSize: 12 }}>
            {r.transfer_status === 'received' ? w('guestSpace.org.tr.received', { date: day(r.transfer_received_at) })
              : r.transfer_status === 'sent' ? w('guestSpace.org.tr.sent', { date: day(r.transfer_sent_at) })
                : r.transfer_status === 'disputed' ? w('guestSpace.org.tr.disputed', { reason: r.transfer_dispute_reason ?? '' })
                  : r.transfer_status === 'pending' ? w('guestSpace.org.tr.pending', { date: day(r.transfer_due_at) })
                    : w('guestSpace.contract.tr.nothing')}
          </p>
          {(r.transfer_status === 'pending' || r.transfer_status === 'disputed') && r.guest_iban && r.statement_response !== 'contested' && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-56"><DarkInput value={ref} onChange={setRef} placeholder={w('guestSpace.org.transferRefPh')} maxLength={80} /></div>
              <OrgButton size="sm" variant="primary" disabled={!!busy}
                onClick={() => run(`tr:${r.id}`, () => markGuestTransferSent(r.id, ref.trim() || null), w('guestSpace.org.transferSentToast', { guest: r.guest_name }))}>
                {w('guestSpace.org.transferSent')}
              </OrgButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
