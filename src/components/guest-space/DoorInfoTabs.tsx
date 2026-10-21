import { useState } from 'react';
import { Loader2, MessageCircle, X } from 'lucide-react';
import { OrgButton, OrgPill, DarkInput, POS, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import { PhoneInputWithCountry } from '@/components/PhoneInputWithCountry';
import { marketCountry } from '@/lib/geo';
import { openPendingTab } from '@/lib/stripeConnectClient';
import {
  doorInviteUrl, guestErrorCode, guestErrorText, guestInviteDoorStaff, guestRevokeDoorStaff, sendDoorInviteEmail,
  whatsappHref, daysToNight,
} from '@/lib/guestSpace';
import type { GuestTabProps } from './context';
import { GuestAvatar } from './GuestPhoto';
import { saveGuestPhoto, usePhotoPicker } from './guestPhotoActions';
import { Bar, Card, CardHead, Kpi, KpiGrid, Label, MONO, Note, Row } from './ui';

// ─── Porte ─────────────────────────────────────────────────────────────────

function DoorStaffCard(p: GuestTabProps) {
  const { d, w, token, reload, toast } = p;
  const org = d.event?.organizer_name ?? '';
  const staff = d.door_staff ?? [];
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const country = marketCountry(d.event?.timezone, d.event?.location_city) ?? undefined;

  const invite = async () => {
    setBusy('inv');
    // Onglet WhatsApp ouvert dans le geste du clic (Safari bloque un window.open après un await).
    const tab = !email.trim() && phone.trim() ? openPendingTab() : null;
    try {
      const r = await guestInviteDoorStaff(token, name.trim(), email.trim() || null, phone.trim() || null);
      if (r.email) {
        try { await sendDoorInviteEmail(r.id, token); } catch (err) { toast(guestErrorText(guestErrorCode(err), w), 'err'); }
      } else if (r.phone) {
        const href = whatsappHref(r.phone, w('guestSpace.door.staffWhatsapp', { name: name.trim().split(' ')[0], event: d.event?.title ?? '', link: doorInviteUrl(r.invite_token) }));
        if (href && tab) tab.go(href); else tab?.close();
      } else tab?.close();
      toast(w('guestSpace.door.staffInvited'));
      setName(''); setEmail(''); setPhone('');
      await reload();
    } catch (err) {
      tab?.close();
      toast(guestErrorText(guestErrorCode(err), w), 'err');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    try { await guestRevokeDoorStaff(token, id); await reload(); }
    catch (err) { toast(guestErrorText(guestErrorCode(err), w), 'err'); }
    finally { setBusy(null); }
  };

  const closed = d.phase === 'after' || d.phase === 'cancelled';
  return (
    <Card>
      <CardHead title={w('guestSpace.door.staffTitle')} sub={w('guestSpace.door.staffSub', { org })} />
      <div>
        {staff.length === 0 && <p style={{ color: T3, fontSize: 13 }}>{w('guestSpace.door.staffEmpty')}</p>}
        {staff.map((s) => (
          <Row key={s.id}
            title={s.name}
            meta={s.invited_by_kind === 'guest' ? w('guestSpace.door.staffByYou') : w('guestSpace.door.staffByOrg', { org })}
            right={(
              <span className="inline-flex items-center gap-2">
                <OrgPill tone={s.status === 'accepted' ? 'success' : 'warn'}>{s.status === 'accepted' ? w('guestSpace.door.staffActive') : w('guestSpace.door.staffInvited')}</OrgPill>
                {s.invited_by_kind === 'guest' && !closed && (
                  <button type="button" disabled={!!busy} onClick={() => void remove(s.id)} className="rounded-lg p-1" style={{ color: T3 }}
                    aria-label={w('guestSpace.door.staffRemove')}><X className="h-3.5 w-3.5" /></button>
                )}
              </span>
            )} />
        ))}
      </div>
      {!closed && (
        <form className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void invite(); }}>
          <DarkInput value={name} onChange={setName} placeholder={w('guestSpace.door.staffNamePh')} />
          <DarkInput type="email" value={email} onChange={setEmail} placeholder="email@club.com" />
          <PhoneInputWithCountry value={phone} onChange={setPhone} defaultCountry={country} size="sm" tone="dark" placeholder="WhatsApp" />
          <OrgButton type="submit" variant="primary" disabled={busy === 'inv' || name.trim().length < 2 || (!email.trim() && !phone.trim())}>
            {busy === 'inv' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{w('guestSpace.door.staffInvite')}
          </OrgButton>
        </form>
      )}
      <p className="mt-3" style={{ color: T3, fontSize: 12 }}>{w('guestSpace.door.staffRule', { org })}</p>
    </Card>
  );
}

/** Qui tient la porte : l'organisateur seul, le club invité seul, ou les deux (défaut d'un club). */
function doorModeOf(d: GuestTabProps['d']): 'organizer' | 'guest' | 'both' {
  if (d.guest?.kind !== 'venue') return 'organizer';
  return d.guest.door_mode ?? 'both';
}

export function DoorTab(p: GuestTabProps) {
  const { d, w, num, date } = p;
  const t = d.totals!;
  const org = d.event?.organizer_name ?? '';
  const mode = doorModeOf(d);
  // Le club n'a son équipe à la porte que si la porte est à lui (ou partagée).
  const staffOn = mode !== 'organizer';
  const heldBy = mode === 'guest' ? w('guestSpace.door.byGuest') : mode === 'both' ? w('guestSpace.door.byBoth', { org }) : w('guestSpace.door.byOrganizer', { org });
  const door = d.door ?? { deadlines: [], drink_heads: 0, drink_cutoff: null };
  const expTables = t.tables.guests;
  const entered = t.entered.tickets + t.entered.tables + t.entered.guest_list;
  const measured = entered >= 10 && entered * 10 >= Math.max(1, t.expected);

  if (d.phase === 'before') {
    const toNight = daysToNight(d.event!.start_at, d.event!.timezone);
    return (
      <div className="space-y-4">
        {staffOn && <DoorStaffCard {...p} />}
        <Card>
          <CardHead title={w('guestSpace.door.title')}
            sub={w('guestSpace.door.sub', { heldBy, date: date(d.event!.start_at, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) })}
            right={<OrgPill tone="muted">{toNight > 0 ? w('guestSpace.door.opensIn', { n: num(toNight) }) : w('guestSpace.door.opensTonight')}</OrgPill>} />
          <KpiGrid>
            <Kpi label={w('guestSpace.kpi.tickets')} value={num(t.tickets.sold)} hint={w('guestSpace.door.toScan')} />
            <Kpi label={w('guestSpace.kpi.guestList')} value={num(t.guest_list.registered)} hint={w('guestSpace.door.toCheck')} />
            <Kpi label={w('guestSpace.kpi.tables')} value={num(t.tables.booked)} hint={w('guestSpace.door.guests', { n: num(expTables) })} />
            <Kpi label={w('guestSpace.kpi.expected')} value={num(t.expected)} hint={w('guestSpace.door.total')} />
          </KpiGrid>
        </Card>
        <Card>
          <CardHead title={w('guestSpace.door.rules')} sub={w('guestSpace.door.rulesSub')} />
          {door.deadlines.length === 0 && door.drink_heads === 0 && <p style={{ color: T3, fontSize: 13 }}>{w('guestSpace.door.noRules')}</p>}
          {door.deadlines.map((dl) => (
            <Row key={dl} title={w('guestSpace.door.ruleDeadline')} right={w('guestSpace.door.ruleDeadlineValue', { time: dl })} />
          ))}
          {door.drink_heads > 0 && (
            <Row title={w('guestSpace.door.ruleDrink')} right={door.drink_cutoff ? w('guestSpace.door.ruleDrinkValue', { time: door.drink_cutoff }) : w('guestSpace.door.ruleDrinkValueNoTime')} />
          )}
        </Card>
      </div>
    );
  }

  const live = d.phase === 'live';
  const rows = [
    { n: w('guestSpace.door.type.tickets'), a: t.entered.tickets, b: t.tickets.sold },
    { n: w('guestSpace.door.type.gl'), a: t.entered.guest_list, b: t.guest_list.registered },
    { n: w('guestSpace.door.type.tables'), a: t.entered.tables, b: expTables },
  ];
  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          {live
            ? <span className="inline-flex items-center gap-2" style={{ color: POS, fontSize: 12, fontWeight: 650, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: POS }} />
                {w('guestSpace.door.live', { time: date(d.now ?? new Date().toISOString(), { hour: '2-digit', minute: '2-digit' }) })}
              </span>
            : <OrgPill tone="muted">{w('guestSpace.door.closed')}</OrgPill>}
          {live && t.entered.last_10min > 0 && <span style={{ color: T3, fontSize: 12.5 }}>{w('guestSpace.door.last10', { n: num(t.entered.last_10min) })}</span>}
        </div>
        <div className="flex flex-wrap items-end gap-7">
          <div>
            <Label>{w('guestSpace.door.entries')}</Label>
            <div className="tabular-nums" style={{ color: T1, fontSize: 'clamp(40px,5vw,56px)', fontWeight: 750, letterSpacing: '-0.03em', lineHeight: 1 }}>{num(entered)}</div>
            <div style={{ color: T3, fontSize: 12.5 }}>{w('guestSpace.door.ofExpected', { n: num(t.expected) })}</div>
          </div>
          <div className="min-w-0 flex-[1_1_260px]">
            <Bar pct={t.expected ? (entered / t.expected) * 100 : 0} className="!h-3" />
            <div className="mt-1.5" style={{ color: T3, fontSize: 12.5 }}>
              {measured || live ? w('guestSpace.door.pct', { n: num(t.expected ? Math.round((entered / t.expected) * 100) : 0) }) : w('guestSpace.door.notMeasured')}
            </div>
          </div>
        </div>
      </Card>
      <Card>
        <CardHead title={w('guestSpace.door.byType')} sub={w('guestSpace.door.byTypeSub')} />
        {rows.map((r) => (
          <Row key={r.n} title={r.n} meta={w('guestSpace.door.typeLine', { a: num(r.a), b: num(r.b) })}>
            <Bar className="w-28" pct={r.b ? (r.a / r.b) * 100 : 0} />
          </Row>
        ))}
      </Card>
      {staffOn && <DoorStaffCard {...p} />}
    </div>
  );
}

// ─── Infos & contrat ───────────────────────────────────────────────────────

/** Sa photo de profil : la changer ou la retirer (compte rattaché seulement). */
function PhotoCard(p: GuestTabProps) {
  const { d, w } = p;
  const g = d.guest!;
  const [busy, setBusy] = useState(false);
  const save = async (file: File | null) => {
    setBusy(true);
    await saveGuestPhoto(p, file, (err) => guestErrorText(guestErrorCode(err), w));
    setBusy(false);
  };
  const { input, pick } = usePhotoPicker((f) => void save(f));
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-4">
        <GuestAvatar url={g.photo_url} name={g.name} kind={g.kind} size={56} />
        <div className="min-w-0 flex-1">
          <div style={{ color: T1, fontSize: 14, fontWeight: 650 }}>{w('guestSpace.photo.title')}</div>
          <div style={{ color: T3, fontSize: 12.5, lineHeight: 1.45 }}>{w('guestSpace.photo.sub', { org: d.event?.organizer_name ?? '' })}</div>
          <div style={{ color: T3, fontSize: 11.5 }}>{w('guestSpace.photo.hint')}</div>
        </div>
        <div className="flex gap-1.5">
          <OrgButton size="sm" disabled={busy} onClick={pick}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{g.photo_url ? w('guestSpace.photo.change') : w('guestSpace.photo.add')}
          </OrgButton>
          {g.photo_url && <OrgButton size="sm" variant="ghost" disabled={busy} onClick={() => void save(null)}>{w('guestSpace.photo.remove')}</OrgButton>}
        </div>
        {input}
      </div>
    </Card>
  );
}

export function InfoTab(p: GuestTabProps) {
  const { d, w, num, date } = p;
  const ev = d.event!;
  const org = ev.organizer_name;
  const contract = d.money?.mode === 'contract';
  const guestContract = d.money?.mode === 'guest_contract' ? d.money.contract ?? null : null;
  const collector = d.money?.collector_name ?? org;
  const tickets = d.tickets ?? [];
  const packs = d.tables ?? [];
  const parts = d.guest_list_parts ?? [];
  const glPlaces = parts.reduce((a, g) => a + (g.places ?? 0), 0);
  const hours = `${date(ev.start_at, { hour: '2-digit', minute: '2-digit' })}${ev.end_at ? ` → ${date(ev.end_at, { hour: '2-digit', minute: '2-digit' })}` : ''}`;
  const isVenue = d.guest?.kind === 'venue';
  const paul = whatsappHref(d.paul_whatsapp, w('guestSpace.info.talkMessage', { name: d.guest?.name ?? '', event: ev.title }));
  const orgWa = whatsappHref(d.organizer_contact?.phone, '');
  const contact = (name: string, role: string, value: string | null, href?: string | null) => (
    <div className="min-w-0 rounded-2xl p-4" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <div style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{name}</div>
      <div style={{ color: T3, fontSize: 12 }}>{role}</div>
      {value && <div className="mt-2 truncate" style={{ fontFamily: MONO, fontSize: 12.5, color: T2, userSelect: 'all' }}>{value}</div>}
      {href && <div className="mt-2"><OrgButton size="sm" href={href}><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</OrgButton></div>}
    </div>
  );
  return (
    <div className="space-y-4">
      {d.guest?.account_email && <PhotoCard {...p} />}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead title={w('guestSpace.info.night')} sub={w('guestSpace.info.nightSub')} />
          <Row title={w('guestSpace.info.date')} right={date(ev.start_at, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} />
          <Row title={w('guestSpace.info.hours')} right={hours} />
          <Row title={w('guestSpace.info.address')} right={[ev.location_name, ev.location_address || ev.location_city].filter(Boolean).join(', ') || '—'} />
          <Row title={w('guestSpace.info.ticketing')} right={tickets.length
            ? (ev.ticket_selling_mode === 'free' ? w('guestSpace.info.ticketingFree', { n: num(tickets.length) }) : w('guestSpace.info.ticketingValue', { n: num(tickets.length) }))
            : w('guestSpace.info.none')} />
          <Row title={w('guestSpace.info.tables')} right={packs.length
            ? w(packs.length === 1 ? 'guestSpace.info.tablesValueOne' : 'guestSpace.info.tablesValue', { p: num(packs.length), n: num(packs.reduce((a, x) => a + (x.capacity ?? 0), 0)) })
            : w('guestSpace.info.none')} />
          <Row title={w('guestSpace.info.guestList')} right={parts.length
            ? w(parts.length === 1 ? 'guestSpace.info.guestListValueOne' : 'guestSpace.info.guestListValue', { p: num(parts.length), n: num(glPlaces) })
            : w('guestSpace.info.none')} />
          <p className="mt-3" style={{ color: T3, fontSize: 12 }}>{w('guestSpace.info.fix', { org })}</p>
        </Card>
        <Card>
          <CardHead title={contract || guestContract ? w('guestSpace.info.contract') : w('guestSpace.info.agreement')}
            sub={guestContract
              ? (guestContract.status === 'signed' ? w('guestSpace.info.contractSub') : w('guestSpace.contract.infoProposed'))
              : contract ? w('guestSpace.info.contractSub') : w('guestSpace.info.agreementSub')} />
          <Row title={w('guestSpace.info.leads')} right={org} />
          <Row title={w('guestSpace.info.collects')} right={w('guestSpace.info.collectsValue', { name: collector })} />
          {isVenue && (!guestContract || guestContract.terms.bar_to_guest) && <Row title={w('guestSpace.info.bar')} right={w('guestSpace.info.barValue', { name: d.guest?.name ?? '' })} />}
          <Row title={w('guestSpace.info.door')} right={doorModeOf(d) === 'guest' ? w('guestSpace.info.doorYours')
            : doorModeOf(d) === 'both' ? w('guestSpace.info.doorBoth', { name: org }) : w('guestSpace.info.doorValue', { name: org })} />
          {guestContract && (
            <div className="mt-3"><OrgButton size="sm" onClick={() => p.go('money')}>{w('guestSpace.contract.read')}</OrgButton></div>
          )}
          {contract && (d.viewer?.member_level ?? 0) >= 1 && (
            <div className="mt-3"><OrgButton size="sm" to={isVenue ? '/owner/collaborations' : '/organizer-app/collaborations'}>{w('guestSpace.info.pdf')}</OrgButton></div>
          )}
        </Card>
      </div>
      <Card>
        <CardHead title={w('guestSpace.info.contacts')} />
        <div className="grid gap-3 sm:grid-cols-2">
          {contact(org, w('guestSpace.info.contactOrg'), d.organizer_contact?.email ?? null, orgWa)}
          {contact('Yuno', w('guestSpace.info.contactYuno'), 'support@yunoapp.eu', paul)}
        </div>
        {d.closes_at && <p className="mt-3" style={{ color: T3, fontSize: 12 }}>{w('guestSpace.info.closes', { date: date(d.closes_at, { day: 'numeric', month: 'long' }) })}</p>}
      </Card>
    </div>
  );
}
