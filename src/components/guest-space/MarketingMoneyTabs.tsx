import { useState } from 'react';
import { Copy, Download, ExternalLink, Loader2, Plus } from 'lucide-react';
import { OrgButton, OrgPill, DarkTextarea, POS, T1, T2, T3, BORDER } from '@/components/org-ui';
import {
  answerStatement, createGuestLink, guestErrorCode, guestErrorText, guestLinkUrl, readyPostText, trackGuestSpace,
} from '@/lib/guestSpace';
import type { GuestTabProps } from './context';
import { Card, CardHead, Kpi, KpiGrid, Label, MONO, Note, Row, Steps, Table } from './ui';
import { GuestContractMoney } from './GuestContractMoney';

const CHANNELS = ['direct', 'story', 'bio', 'whatsapp', 'other'] as const;

/** Nom de fichier d'un visuel : la soirée + le format, extension de l'URL. */
function visualName(title: string, kind: string, url: string) {
  const ext = (url.split('?')[0].match(/\.([a-z0-9]{2,4})$/i)?.[1] ?? 'jpg').toLowerCase();
  const base = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'yuno';
  return `${base}-${kind}.${ext}`;
}

// ─── Marketing ─────────────────────────────────────────────────────────────

export function MarketingTab(p: GuestTabProps) {
  const { d, w, num, eur, token, reload, toast, date } = p;
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const links = d.my_links ?? [];
  const org = d.event?.organizer_name ?? '';
  const name = d.guest?.name ?? '';
  const tc = links.reduce((a, l) => a + l.clicks, 0);
  const tb = links.reduce((a, l) => a + l.tickets, 0);
  const tca = links.reduce((a, l) => a + (l.revenue ?? 0), 0);

  const copy = async (text: string, msg: string) => {
    try { await navigator.clipboard.writeText(text); toast(msg); trackGuestSpace(token, 'copy'); }
    catch { toast(w('guestSpace.err.generic'), 'err'); }
  };
  const create = async (channel: string) => {
    setBusy(channel); setMenu(false);
    try { await createGuestLink(token, channel); toast(w('guestSpace.mkt.created')); await reload(); }
    catch (err) { toast(guestErrorText(guestErrorCode(err), w), 'err'); }
    finally { setBusy(null); }
  };

  const ev = d.event!;
  const visuals = [
    ev.poster_url && { kind: 'square', url: ev.poster_url, label: w('guestSpace.mkt.poster') },
    ev.wide_url && { kind: 'wide', url: ev.wide_url, label: w('guestSpace.mkt.wide') },
    ev.video_url && { kind: 'video', url: ev.video_url, label: w('guestSpace.mkt.video') },
  ].filter(Boolean) as { kind: string; url: string; label: string }[];
  // Le fichier lui-même (un lien vers une autre origine ne se télécharge pas : il s'ouvrirait).
  const download = async (url: string, filename: string, kind: string) => {
    setBusy(`dl:${kind}`);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const { deliverDocument } = await import('@/lib/generateDocuments');
      await deliverDocument(await res.blob(), filename, ev.title);
      trackGuestSpace(token, 'share');
    } catch {
      window.open(url, '_blank', 'noopener');
    } finally {
      setBusy(null);
    }
  };
  // Le prix d'appel : le moins cher des billets PAYANTS en vente (un billet gratuit n'en est pas un).
  const prices = (d.tickets ?? []).filter((t) => t.status === 'on_sale' && Number(t.price) > 0).map((t) => Number(t.price));
  const dayLabel = date(ev.start_at, { weekday: 'long', day: 'numeric' });
  const story = links.find((l) => l.channel === 'story') ?? links[0];
  const drinkBefore = (d.tickets ?? []).find((t) => t.includes_drink && t.drink_cutoff)?.drink_cutoff ?? null;
  const text = story ? readyPostText(w, {
    date: dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1),
    event: ev.title,
    place: ev.location_name ?? name,
    price: prices.length ? eur(Math.min(...prices)) : null,
    drinkBefore,
    link: guestLinkUrl(story.code).replace(/^https?:\/\//, ''),
  }) : '';

  return (
    <div className="space-y-4">
      <Card>
        <CardHead title={w('guestSpace.mkt.title')} sub={w('guestSpace.mkt.sub', { name })}
          right={(
            <div className="relative">
              <OrgButton size="sm" variant="primary" disabled={!!busy || links.length >= 8} onClick={() => setMenu((v) => !v)}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} {w('guestSpace.mkt.create')}
              </OrgButton>
              {menu && (
                <div className="absolute right-0 z-10 mt-1.5 w-48 overflow-hidden rounded-xl py-1" style={{ background: 'var(--sf-141416)', border: `1px solid ${BORDER}` }}>
                  {CHANNELS.map((c) => (
                    <button key={c} type="button" onClick={() => void create(c)} className="block w-full px-3 py-2 text-left hover:bg-[rgb(var(--ink)/0.05)]" style={{ color: T1, fontSize: 13 }}>
                      {w(`guestSpace.mkt.channel.${c}` as Parameters<typeof w>[0])}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )} />
        <KpiGrid cols={3}>
          <Kpi label={w('guestSpace.mkt.clicks')} value={num(tc)} hint={w('guestSpace.mkt.clicksHint')} />
          <Kpi label={w('guestSpace.mkt.tickets')} value={num(tb)} hint={tc > 0 ? w('guestSpace.mkt.ticketsHint', { pct: num(Math.round((tb / tc) * 1000) / 10) }) : undefined} />
          {d.money_visible
            ? <Kpi label={w('guestSpace.mkt.ca')} value={eur(tca)} hint={w('guestSpace.mkt.caHint')} />
            : <Kpi label={w('guestSpace.kpi.tables')} value={num(links.reduce((a, l) => a + l.tables, 0))} />}
        </KpiGrid>
        <div className="mt-4">
          <Table
            head={[
              { label: w('guestSpace.mkt.col.channel') }, { label: w('guestSpace.mkt.col.link') },
              { label: w('guestSpace.mkt.clicks'), right: true }, { label: w('guestSpace.mkt.tickets'), right: true },
              ...(d.money_visible ? [{ label: w('guestSpace.sales.col.ca'), right: true }] : []), { label: '', right: true },
            ]}
            rows={links.map((l) => [
              <span key="c" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{w(`guestSpace.mkt.channel.${CHANNELS.includes(l.channel as typeof CHANNELS[number]) ? l.channel : 'other'}` as Parameters<typeof w>[0])}</span>,
              <span key="l" style={{ fontFamily: MONO, fontSize: 12, color: T2 }}>/l/{l.code}</span>,
              num(l.clicks), num(l.tickets),
              ...(d.money_visible ? [eur(l.revenue ?? 0)] : []),
              <button key="b" type="button" onClick={() => void copy(guestLinkUrl(l.code), w('guestSpace.mkt.copied'))}
                className="inline-flex items-center rounded-lg p-1.5" style={{ color: T2, border: `1px solid ${BORDER}` }}
                aria-label={`${w('guestSpace.mkt.copy')} ${l.code}`}>
                <Copy className="h-3.5 w-3.5" />
              </button>,
            ])}
          />
        </div>
        <p className="mt-3" style={{ color: T3, fontSize: 12 }}>{w('guestSpace.mkt.privacy')}</p>
      </Card>

      <Card>
        <CardHead title={w('guestSpace.mkt.visuals')} sub={w('guestSpace.mkt.visualsSub', { org })} />
        {visuals.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-3">
            {/* Les visuels tels qu'ils vivent sur Yuno (1:1, 16:9, vidéo), jamais recadrés dans un format qu'ils n'ont pas. */}
            {visuals.map((v) => (
              <div key={v.kind} className="flex flex-col gap-2">
                <Label>{v.label}</Label>
                {v.kind === 'video'
                  ? <video src={v.url} controls playsInline preload="metadata" className="w-full rounded-lg bg-black" style={{ maxHeight: 220, border: `1px solid ${BORDER}` }} />
                  : <img src={v.url} alt="" className="w-full rounded-lg object-contain" style={{ maxHeight: 220, border: `1px solid ${BORDER}` }} />}
                <div className="flex flex-wrap gap-1.5">
                  <OrgButton size="sm" disabled={busy === `dl:${v.kind}`} onClick={() => void download(v.url, visualName(ev.title, v.kind, v.url), v.kind)}>
                    {busy === `dl:${v.kind}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} {w('guestSpace.mkt.download')}
                  </OrgButton>
                  <OrgButton size="sm" variant="ghost" href={v.url}><ExternalLink className="h-3.5 w-3.5" /> {w('guestSpace.mkt.open')}</OrgButton>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: T3, fontSize: 13 }}>{w('guestSpace.mkt.noVisuals', { org })}</p>
        )}
        {text && (
          <>
            <div className="mb-2 mt-5"><Label>{w('guestSpace.mkt.text')}</Label></div>
            <Note>{text}</Note>
            <div className="mt-2">
              <OrgButton size="sm" onClick={() => void copy(text, w('guestSpace.mkt.copied'))}><Copy className="h-3.5 w-3.5" /> {w('guestSpace.mkt.copyText')}</OrgButton>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

// ─── Argent ────────────────────────────────────────────────────────────────

export function MoneyTab(p: GuestTabProps) {
  const { d, w, num, eur, date, token, reload, toast } = p;
  const m = d.money!;
  const f = d.figures;
  const org = d.event?.organizer_name ?? '';
  const collector = m.collector_name ?? org;
  const after = d.phase === 'after';
  const contract = m.mode === 'contract';
  // Contrat signé par l'invité dans son espace : même lecture de la part qu'un contrat Yuno.
  const bound = contract || m.mode === 'guest_contract';
  const [busy, setBusy] = useState<string | null>(null);
  const [contest, setContest] = useState(false);
  const [reason, setReason] = useState('');
  const member = (d.viewer?.member_level ?? 0) >= 3;
  const share = m.my_share;

  const respond = async (r: 'approved' | 'contested') => {
    setBusy(r);
    try {
      await answerStatement(token, r, r === 'contested' ? reason : undefined);
      toast(r === 'approved' ? w('guestSpace.money.approved', { org }) : w('guestSpace.money.contested', { org }));
      setContest(false);
      await reload();
    } catch (err) {
      toast(guestErrorText(guestErrorCode(err), w), 'err');
    } finally {
      setBusy(null);
    }
  };

  const statement = f ? (
    <>
      <div>
        <Row title={w('guestSpace.money.row.tickets', { n: num(f.tickets_count) })} right={eur(f.tickets_gross)} />
        <Row title={w('guestSpace.money.row.tables', { n: num(f.tables_count) })} right={eur(f.tables_gross)} />
        <Row title={<span style={{ color: T2, fontWeight: 500 }}>{f.refunds_count ? w('guestSpace.money.row.refundsN', { n: num(f.refunds_count) }) : w('guestSpace.money.row.refunds')}</span>} right={f.refunds > 0 ? eur(-f.refunds) : eur(0)} />
        <Row title={w('guestSpace.money.row.ca')} right={eur(f.ca)} />
        <Row title={<span style={{ color: T2, fontWeight: 500 }}>{w('guestSpace.money.row.stripe')}</span>} right={f.stripe > 0 ? eur(-f.stripe) : eur(0)} />
        <Row title={<b>{w('guestSpace.money.row.net', { name: collector })}</b>} right={<b>{eur(f.net)}</b>} />
      </div>
      <p className="mt-2" style={{ color: T3, fontSize: 12 }}>{w('guestSpace.money.yunoFees', { amount: eur(f.yuno_fees) })}</p>
    </>
  ) : <Note>{w('guestSpace.money.hidden', { org })}</Note>;

  const shareCard = share && (
    <Card>
      <CardHead title={bound ? w('guestSpace.money.shareTitle') : w('guestSpace.money.shareDeclaredTitle')}
        sub={bound ? undefined : w('guestSpace.money.shareDeclaredSub', { org })} />
      <div>
        <Row title={w('guestSpace.money.share.tickets')} right={share.tickets_pct != null ? w('guestSpace.money.share.pctNet', { n: num(share.tickets_pct) }) : '—'} />
        <Row title={w('guestSpace.money.share.tables')} right={share.tables_pct != null ? w('guestSpace.money.share.pctNet', { n: num(share.tables_pct) }) : '—'} />
        {d.guest?.kind === 'venue' && <Row title={w('guestSpace.money.share.bar')} right={w('guestSpace.money.share.barValue')} />}
        {share.amount != null && (
          <Row
            title={<b>{bound && m.transfer?.direction === 'out' ? w('guestSpace.money.share.youOwe', { org: collector }) : bound ? w('guestSpace.money.share.owed', { org: collector }) : w('guestSpace.money.share.yours')}</b>}
            right={<b style={{ color: POS }}>{eur(bound && m.transfer ? m.transfer.amount : share.amount)}</b>} />
        )}
      </div>
      {bound && (
        <div className="mt-3">
          <Note>
            {w('guestSpace.money.transferNote', { collector, n: num(m.payment_terms_days ?? 15) })}
            {m.transfer?.reference ? <> {w('guestSpace.money.referenceColon')} <span style={{ fontFamily: MONO }}>{m.transfer.reference}</span></> : null}
          </Note>
        </div>
      )}
    </Card>
  );

  const answer = share && <AnswerCard {...p} busy={busy} contest={contest} setContest={setContest} reason={reason} setReason={setReason} respond={respond} />;
  if (m.mode === 'guest_contract' && m.contract) {
    return <GuestContractMoney {...p} statement={statement} shareCard={shareCard} answer={answer} />;
  }

  if (!contract) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHead title={w('guestSpace.money.externalTitle')} sub={w('guestSpace.money.externalSub', { collector })}
            right={<OrgPill tone="muted">{w('guestSpace.money.externalPill')}</OrgPill>} />
          {statement}
        </Card>
        {shareCard}
        {share && after && <AnswerCard {...p} busy={busy} contest={contest} setContest={setContest} reason={reason} setReason={setReason} respond={respond} />}
      </div>
    );
  }

  const frozen = !!m.statement?.frozen;
  const steps = [
    { k: w('guestSpace.money.step.contract'), v: w('guestSpace.money.signed'), state: 'done' as const },
    { k: w('guestSpace.money.step.sales'), v: d.phase === 'before' || d.phase === 'live' ? w('guestSpace.money.ongoing') : w('guestSpace.money.done'), state: d.phase === 'before' || d.phase === 'live' ? 'now' as const : 'done' as const },
    { k: w('guestSpace.money.step.statement'), v: frozen ? w('guestSpace.money.frozen') : after ? w('guestSpace.money.toCheck') : w('guestSpace.money.afterNight'), state: after ? 'now' as const : 'next' as const },
    { k: w('guestSpace.money.step.transfer'), v: m.transfer?.due_at ? date(m.transfer.due_at, { day: 'numeric', month: 'long' }) : w('guestSpace.money.afterCheck'), state: m.transfer?.status === 'received' ? 'done' as const : 'next' as const },
  ];

  return (
    <div className="space-y-4">
      <Card><Steps steps={steps} /></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead title={after ? w('guestSpace.money.statementTitle') : w('guestSpace.money.statementLive')}
            sub={frozen && m.statement?.frozen_at ? w('guestSpace.money.statementFrozenSub', { date: date(m.statement.frozen_at, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) }) : w('guestSpace.money.statementLiveSub')}
            right={<OrgPill tone={after ? 'warn' : 'muted'}>{after ? w('guestSpace.money.toCheck') : w('guestSpace.money.estimate')}</OrgPill>} />
          {statement}
        </Card>
        {shareCard}
      </div>
      {after
        ? <AnswerCard {...p} busy={busy} contest={contest} setContest={setContest} reason={reason} setReason={setReason} respond={respond} />
        : (
          <Card>
            <CardHead title={w('guestSpace.money.afterTitle')} sub={w('guestSpace.money.afterSub')} />
            <Row title={w('guestSpace.money.iban')} right={m.transfer?.iban_set ? w('guestSpace.money.ibanSet') : w('guestSpace.money.ibanMissing')} />
            <Row title={w('guestSpace.money.terms')} right={w('guestSpace.money.termsValue', { n: num(m.payment_terms_days ?? 15) })} />
            <IbanHint {...p} member={member} />
          </Card>
        )}
    </div>
  );
}

function IbanHint({ w, member }: GuestTabProps & { member: boolean }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <p className="min-w-0 flex-1" style={{ color: T3, fontSize: 12 }}>{w('guestSpace.money.signInIban')}</p>
      {member
        ? <OrgButton size="sm" to="/owner/collaborations">{w('guestSpace.money.openConsole')}</OrgButton>
        : <OrgButton size="sm" to={`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`}>{w('guestSpace.money.signIn')}</OrgButton>}
    </div>
  );
}

function AnswerCard(p: GuestTabProps & {
  busy: string | null; contest: boolean; setContest: (v: boolean) => void; reason: string; setReason: (v: string) => void;
  respond: (r: 'approved' | 'contested') => Promise<void>;
}) {
  const { d, w, eur, date, busy, contest, setContest, reason, setReason, respond } = p;
  const m = d.money!;
  const amount = m.transfer?.amount ?? m.my_share?.amount ?? null;
  return (
    <Card>
      <CardHead title={w('guestSpace.money.answerTitle')} sub={w('guestSpace.money.answerSub')} />
      {m.response && m.responded_at && (
        <div className="mb-3">
          <Note tone={m.response === 'approved' ? 'green' : 'amber'}>
            {m.response === 'approved'
              ? w('guestSpace.money.yourAnswerApproved', { date: date(m.responded_at, { day: 'numeric', month: 'long' }) })
              : w('guestSpace.money.yourAnswerContested', { date: date(m.responded_at, { day: 'numeric', month: 'long' }), reason: m.response_reason ?? '' })}
          </Note>
        </div>
      )}
      {contest ? (
        <div className="space-y-2">
          <DarkTextarea value={reason} onChange={setReason} placeholder={w('guestSpace.money.contestPh')} rows={3} />
          <div className="flex gap-2">
            <OrgButton variant="primary" disabled={busy === 'contested' || reason.trim().length < 3} onClick={() => void respond('contested')}>{w('guestSpace.money.contestSend')}</OrgButton>
            <OrgButton variant="ghost" onClick={() => setContest(false)}>{w('guestSpace.org.cancel')}</OrgButton>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <OrgButton variant="primary" disabled={busy === 'approved'} onClick={() => void respond('approved')}>
            {w('guestSpace.money.approve')}{amount != null && d.money_visible ? ` · ${eur(amount)}` : ''}
          </OrgButton>
          <OrgButton onClick={() => setContest(true)}>{w('guestSpace.money.contest')}</OrgButton>
        </div>
      )}
      {m.mode === 'contract' && (
        <div className="mt-4">
          <Row title={w('guestSpace.money.iban')} right={m.transfer?.iban_set ? w('guestSpace.money.ibanSet') : w('guestSpace.money.ibanMissing')} />
          {m.transfer?.due_at && <Row title={w('guestSpace.money.due')} right={date(m.transfer.due_at, { day: 'numeric', month: 'long' })} />}
          <IbanHint {...p} member={(d.viewer?.member_level ?? 0) >= 3} />
        </div>
      )}
    </Card>
  );
}

