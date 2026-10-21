import { useState, type ReactNode } from 'react';
import { Check, Loader2, PenLine } from 'lucide-react';
import { OrgButton, OrgPill, DarkInput, DarkTextarea, POS, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import {
  confirmGuestTransfer, formatIban, guestErrorCode, guestErrorText, isValidIban, setGuestIban, signGuestContract,
} from '@/lib/guestSpace';
import type { GuestTabProps } from './context';
import { Card, CardHead, Label, MONO, Note, Row, Steps } from './ui';

/**
 * L'onglet Argent quand l'organisateur a proposé un CONTRAT à l'invité
 * (mode `guest_contract`) : l'invité le lit et le signe depuis son compte Yuno
 * rattaché à l'accès, donne son IBAN, puis suit le décompte et le virement.
 * Yuno n'est pas partie au contrat et ne verse rien : c'est écrit dedans.
 */
export function GuestContractMoney(p: GuestTabProps & { statement: ReactNode; shareCard: ReactNode; answer: ReactNode }) {
  const { d, w, date } = p;
  const m = d.money!;
  const c = m.contract!;
  const signed = c.status === 'signed';
  const frozen = !!m.statement?.frozen;
  const after = d.phase === 'after';
  const [showText, setShowText] = useState(!signed);
  const tr = m.transfer;

  const steps = [
    { k: w('guestSpace.money.step.contract'), v: signed ? w('guestSpace.contract.signed') : w('guestSpace.contract.toSign'), state: signed ? 'done' as const : 'now' as const },
    { k: w('guestSpace.money.step.sales'), v: d.phase === 'before' || d.phase === 'live' ? w('guestSpace.money.ongoing') : w('guestSpace.money.done'), state: !signed ? 'next' as const : d.phase === 'before' || d.phase === 'live' ? 'now' as const : 'done' as const },
    { k: w('guestSpace.money.step.statement'), v: frozen ? w('guestSpace.money.frozen') : w('guestSpace.money.afterNight'), state: frozen ? 'done' as const : after && signed ? 'now' as const : 'next' as const },
    { k: w('guestSpace.money.step.transfer'), v: tr?.status === 'received' ? w('guestSpace.contract.tr.received', { date: tr.received_at ? date(tr.received_at, { day: 'numeric', month: 'long' }) : '' }) : tr?.due_at ? date(tr.due_at, { day: 'numeric', month: 'long' }) : w('guestSpace.money.afterCheck'), state: tr?.status === 'received' ? 'done' as const : frozen ? 'now' as const : 'next' as const },
  ];

  return (
    <div className="space-y-4">
      <Card><Steps steps={steps} /></Card>

      <Card>
        <CardHead
          title={w('guestSpace.contract.title')}
          sub={signed
            ? w('guestSpace.contract.signedSub', {
              date: c.signed_at ? date(c.signed_at, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '',
              name: c.signer_name ?? '', guest: d.guest?.name ?? '', orgSigner: c.org_signer ?? '', org: d.event?.organizer_name ?? '',
            })
            : w('guestSpace.contract.proposedSub', { org: d.event?.organizer_name ?? '' })}
          right={<OrgPill tone={signed ? 'success' : 'warn'}>{signed ? w('guestSpace.contract.signed') : w('guestSpace.contract.toSign')} · {w('guestSpace.contract.version', { n: c.version })}</OrgPill>}
        />
        {showText ? <ContractText {...p} /> : (
          <OrgButton size="sm" variant="ghost" onClick={() => setShowText(true)}>{w('guestSpace.contract.read')}</OrgButton>
        )}
        {!signed && <SignBox {...p} />}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead
            title={frozen ? w('guestSpace.money.statementTitle') : w('guestSpace.money.statementLive')}
            sub={frozen && m.statement?.frozen_at
              ? w('guestSpace.money.statementFrozenSub', { date: date(m.statement.frozen_at, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) })
              : w('guestSpace.money.statementLiveSub')}
            right={<OrgPill tone={frozen ? 'success' : 'muted'}>{frozen ? w('guestSpace.money.frozen') : w('guestSpace.money.estimate')}</OrgPill>}
          />
          {p.statement}
        </Card>
        {p.shareCard}
      </div>

      {signed && <IbanBox {...p} />}
      {signed && frozen && <TransferBox {...p} />}
      {signed && after && p.answer}
    </div>
  );
}

function ContractText({ d, w, date, num }: GuestTabProps) {
  const m = d.money!;
  const c = m.contract!;
  const t = c.terms;
  const org = d.event?.organizer_name ?? '';
  const guest = d.guest?.name ?? '';
  const collector = m.collector_name ?? org;
  const when = d.event?.start_at ? date(d.event.start_at, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const vars = { org, guest, collector, event: d.event?.title ?? '', date: when };
  const art = (title: string, body: ReactNode) => (
    <div className="py-2.5" style={{ borderTop: `1px solid ${BORDER}` }}>
      <div style={{ color: T1, fontSize: 13, fontWeight: 650 }}>{title}</div>
      <div className="mt-1" style={{ color: T2, fontSize: 13, lineHeight: 1.55 }}>{body}</div>
    </div>
  );
  return (
    <div className="mb-3 rounded-xl px-4 py-1" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      {art(w('guestSpace.contract.art1T'), w('guestSpace.contract.art1', vars))}
      {art(w('guestSpace.contract.art2T'), <>
        {w('guestSpace.contract.art2', { ...vars, t: num(t.tickets_pct), tb: num(t.tables_pct) })}{' '}
        {d.guest?.kind === 'venue' && t.bar_to_guest ? w('guestSpace.contract.barGuest', vars) : w('guestSpace.contract.barNone')}
      </>)}
      {art(w('guestSpace.contract.art3T'), w('guestSpace.contract.art3', vars))}
      {art(w('guestSpace.contract.art4T'), <>
        {w('guestSpace.contract.art4', { ...vars, n: num(t.payment_terms_days), ref: '\u0001' }).split('\u0001').map((part, i, all) => (
          <span key={i}>{part}{i < all.length - 1 && <span style={{ fontFamily: MONO, color: T1 }}>{c.reference ?? '—'}</span>}</span>
        ))}
      </>)}
      {t.note && art(w('guestSpace.contract.art5T'), <span style={{ whiteSpace: 'pre-wrap' }}>{t.note}</span>)}
      {art(w('guestSpace.contract.art6T'), w('guestSpace.contract.art6'))}
    </div>
  );
}

function SignBox(p: GuestTabProps) {
  const { d, w, token, reload, toast } = p;
  const c = d.money!.contract!;
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const sign = async () => {
    setBusy(true);
    try {
      await signGuestContract(token, name.trim(), c.version);
      toast(w('guestSpace.contract.signedToast', { org: d.event?.organizer_name ?? '' }));
      await reload();
    } catch (err) {
      toast(guestErrorText(guestErrorCode(err), w), 'err');
      if (guestErrorCode(err) === 'contract_changed') await reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2.5 rounded-xl p-3" style={{ border: `1px solid ${BORDER}` }}>
      <Label>{w('guestSpace.contract.signerName')}</Label>
      <DarkInput value={name} onChange={setName} placeholder={w('guestSpace.contract.signerName')} maxLength={120} />
      {name.trim().length >= 3 && (
        <p style={{ color: T3, fontSize: 12 }}>{w('guestSpace.contract.agree', { name: name.trim(), guest: d.guest?.name ?? '' })}</p>
      )}
      <OrgButton variant="primary" disabled={busy || name.trim().length < 3} onClick={() => void sign()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
        {w('guestSpace.contract.sign')}
      </OrgButton>
    </div>
  );
}

function IbanBox(p: GuestTabProps) {
  const { d, w, token, reload, toast } = p;
  const m = d.money!;
  const tr = m.transfer;
  const locked = tr?.status === 'sent' || tr?.status === 'received';
  const [edit, setEdit] = useState(!tr?.iban_set);
  const [iban, setIban] = useState('');
  const [holder, setHolder] = useState(d.guest?.name ?? '');
  const [busy, setBusy] = useState(false);
  const ok = isValidIban(iban) && holder.trim().length >= 2;
  const save = async () => {
    setBusy(true);
    try {
      await setGuestIban(token, iban, holder.trim());
      toast(w('guestSpace.contract.ibanSaved'));
      setEdit(false);
      await reload();
    } catch (err) {
      toast(guestErrorText(guestErrorCode(err), w), 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHead
        title={w('guestSpace.contract.ibanTitle')}
        sub={w('guestSpace.contract.ibanSub', { collector: m.collector_name ?? d.event?.organizer_name ?? '' })}
        right={<OrgPill tone={tr?.iban_set ? 'success' : 'warn'}>{tr?.iban_set ? w('guestSpace.money.ibanSet') : w('guestSpace.money.ibanMissing')}</OrgPill>}
      />
      {!edit && tr?.iban_set ? (
        <div className="flex flex-wrap items-center gap-3">
          <span style={{ fontFamily: MONO, color: T1, fontSize: 14 }}>{tr.iban_masked}</span>
          {!locked && <OrgButton size="sm" variant="ghost" onClick={() => setEdit(true)}>{w('guestSpace.contract.ibanChange')}</OrgButton>}
        </div>
      ) : (
        <div className="space-y-2.5">
          <DarkInput value={formatIban(iban)} onChange={setIban} placeholder={w('guestSpace.contract.ibanPh')} maxLength={42} />
          <DarkInput value={holder} onChange={setHolder} placeholder={w('guestSpace.contract.holderPh')} maxLength={120} />
          {iban.replace(/\s/g, '').length >= 15 && !isValidIban(iban) && <Note tone="amber">{w('guestSpace.err.invalid_iban')}</Note>}
          <OrgButton variant="primary" disabled={busy || !ok} onClick={() => void save()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{w('guestSpace.contract.ibanSave')}
          </OrgButton>
        </div>
      )}
    </Card>
  );
}

function TransferBox(p: GuestTabProps) {
  const { d, w, eur, date, token, reload, toast } = p;
  const m = d.money!;
  const tr = m.transfer!;
  const collector = m.collector_name ?? d.event?.organizer_name ?? '';
  const [contest, setContest] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const dt = (iso?: string | null) => (iso ? date(iso, { day: 'numeric', month: 'long' }) : '');
  const answer = async (received: boolean) => {
    setBusy(true);
    try {
      await confirmGuestTransfer(token, received, received ? undefined : reason);
      toast(w('guestSpace.contract.receivedToast', { org: collector }));
      setContest(false);
      await reload();
    } catch (err) {
      toast(guestErrorText(guestErrorCode(err), w), 'err');
    } finally {
      setBusy(false);
    }
  };
  const line = !tr.amount
    ? w('guestSpace.contract.tr.nothing')
    : tr.status === 'received' ? w('guestSpace.contract.tr.received', { date: dt(tr.received_at) })
      : tr.status === 'sent' ? w('guestSpace.contract.tr.sent', { collector, date: dt(tr.sent_at) })
        : tr.status === 'disputed' ? w('guestSpace.contract.tr.disputed', { reason: tr.dispute_reason ?? '' })
          : tr.due_at ? w('guestSpace.contract.tr.pending', { date: dt(tr.due_at) }) : w('guestSpace.contract.tr.estimate');
  return (
    <Card>
      <CardHead title={w('guestSpace.contract.transferTitle')} right={<b style={{ color: POS, fontSize: 18 }}>{eur(tr.amount ?? 0)}</b>} />
      <Row title={line} right={tr.reference ? <span style={{ fontFamily: MONO, color: T2 }}>{tr.reference}</span> : null} />
      {tr.sent_reference && <Row title={w('guestSpace.org.transferRefPh')} right={<span style={{ fontFamily: MONO }}>{tr.sent_reference}</span>} />}
      {tr.status === 'sent' && (
        contest ? (
          <div className="mt-3 space-y-2">
            <DarkTextarea value={reason} onChange={setReason} placeholder={w('guestSpace.contract.notReceivedPh')} rows={2} />
            <div className="flex gap-2">
              <OrgButton variant="primary" disabled={busy || reason.trim().length < 3} onClick={() => void answer(false)}>{w('guestSpace.money.contestSend')}</OrgButton>
              <OrgButton variant="ghost" onClick={() => setContest(false)}>{w('guestSpace.org.cancel')}</OrgButton>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <OrgButton variant="primary" disabled={busy} onClick={() => void answer(true)}><Check className="h-4 w-4" />{w('guestSpace.contract.received')}</OrgButton>
            <OrgButton onClick={() => setContest(true)}>{w('guestSpace.contract.notReceived')}</OrgButton>
          </div>
        )
      )}
    </Card>
  );
}
