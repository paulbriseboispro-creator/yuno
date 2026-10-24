/**
 * Fiche client de Yuno Tickets (volet droit, copie de
 * src/crm/pages/clients/ClientDrawer.tsx) : identité, statut, « Écrire à… »,
 * trois chiffres, le conseil du moment, le chemin vers habitué, le rythme sur
 * 12 mois, le parcours (achats Yuno + guest list + messages), les
 * coordonnées, les étiquettes et la note. À la place des hypothèses du CRM
 * (moteur d'analyse propre au CRM) : la porte du club, bannissement et
 * incidents (Console Club seulement, décision de Paul du 22/10).
 * Navigation ↑ / ↓ dans la liste en cours, Échap pour fermer.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Sheet, Skel } from '@/tickets/analytics/kit';
import { useTixToast } from '@/tickets/clients/toast';
import { EASE, SPRING } from '@/crm/ui/motion';
import { useTixT } from '@/tickets/analytics/i18n';
import { useTixCaps } from '@/tickets/clients/scope';
import { useClientCard, useSaveClient } from '@/tickets/clients/data/clients';
import type { ClientCard, SaleSourceLabel } from '@/tickets/clients/data/clients';
import { LIFECYCLE_AVATAR, LIFECYCLE_COLOR, fullName, initials, relDays } from '@/tickets/clients/lib/lifecycle';
import { LoadError } from '@/tickets/analytics/LoadError';
import { ClientDoor } from './ClientDoor';

const TL_ICON = {
  buy: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0',
  msg: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  click: 'M9 9l5 12 1.8-5.2L21 14zM7.2 2.2 8 5.1M5.1 8l-2.9-.8M14 4.1l-2.1 2M4.1 14l2.1-2',
  add: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6',
  tonight: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  gl: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
};
/** Par où est arrivé un achat : la famille d'attribution de la vente (clés de l'écran Trafic). */
function saleSourceText(src: SaleSourceLabel | null | undefined, t: (k: string) => string): string | null {
  return src?.kind ? t(`ya.ana.src.${src.kind}.s`) : null;
}
const TL_TONE = { buy: ['var(--ya-sand-100)', 'var(--ya-sand-700)'], msg: ['var(--ya-sand-50)', 'var(--ya-sand-600)'], todo: ['var(--ya-red-50)', 'var(--ya-red-600)'], gl: ['var(--ya-amber-50)', 'var(--ya-amber-700)'] } as const;
const SUGG = ['vip', 'guest', 'press', 'staff'] as const;

type TlItem = { k: 'buy' | 'msg' | 'gl'; at: number; t: string; s: string; amt?: string; ic: keyof typeof TL_ICON; tone: keyof typeof TL_TONE };

export function ClientDrawer({
  email, onClose, pos, onStep, onWrite, guardEscape,
}: {
  email: string | null;
  onClose: () => void;
  /** Position dans la liste en cours (0-based) et longueur ; null = hors liste. */
  pos: { i: number; n: number } | null;
  onStep: (d: 1 | -1) => void;
  onWrite: (card: ClientCard) => void;
  /** Une fenêtre au-dessus (Écrire) garde Échap pour elle. */
  guardEscape: boolean;
}) {
  const open = !!email;
  const [last, setLast] = useState(email);
  useEffect(() => { if (email) setLast(email); }, [email]);
  const q = useClientCard(open ? email : last);
  const card = q.data ?? null;
  const T = useTixT();
  const { t } = T;

  useEffect(() => {
    if (!open) return;
    const kd = (e: KeyboardEvent) => {
      const tg = (e.target as HTMLElement | null)?.tagName ?? '';
      if (guardEscape || tg === 'INPUT' || tg === 'TEXTAREA') return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); onStep(e.key === 'ArrowDown' ? 1 : -1); }
    };
    document.addEventListener('keydown', kd);
    return () => document.removeEventListener('keydown', kd);
  }, [open, guardEscape, onStep]);

  const posTxt = pos ? t('ya.cli.card.pos', { a: T.n(pos.i + 1), b: T.n(pos.n) }) : t('ya.cli.card.outOfList');
  return (
    <Sheet open={open} onClose={() => { if (!guardEscape) onClose(); }} label={t('ya.cli.card.label', { pos: posTxt })}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '14px 16px 14px 24px', borderBottom: '1px solid var(--ya-sand-100)', background: 'var(--ya-card)' }}>
        <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>{t('ya.cli.card.label', { pos: posTxt })}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <HeadBtn label={t('ya.cli.card.prev')} title={`${t('ya.cli.card.prev')} (↑)`} dim={!pos || pos.i <= 0} onClick={() => onStep(-1)} icon="chevronUp" />
          <HeadBtn label={t('ya.cli.card.next')} title={`${t('ya.cli.card.next')} (↓)`} dim={!pos || pos.i >= pos.n - 1} onClick={() => onStep(1)} icon="chevronDown" />
          <HeadBtn label={t('ya.common.close')} title={`${t('ya.common.close')} (Esc)`} onClick={onClose} icon="x" />
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {card ? <CardBody key={card.email} card={card} onWrite={() => onWrite(card)} />
          : q.isError ? <div style={{ padding: '0 20px 32px' }}><LoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /></div>
            // tix_client rend null pour une adresse hors de la base (lien ancien, contact effacé).
            : q.isSuccess ? <div style={{ padding: 32, fontSize: 15, color: 'var(--ya-sand-600)' }}>{t('ya.cli.card.notFound')}</div>
              : <CardSkeleton />}
      </div>
    </Sheet>
  );
}

function HeadBtn({ label, title, onClick, icon, dim }: { label: string; title: string; onClick: () => void; icon: 'chevronUp' | 'chevronDown' | 'x'; dim?: boolean }) {
  return (
    <Hv as="button" type="button" onClick={onClick} aria-label={label} title={title} disabled={dim} style={{ width: 36, height: 36, border: 0, borderRadius: 99, background: 'none', color: 'var(--ya-sand-600)', cursor: dim ? 'default' : 'pointer', display: 'grid', placeItems: 'center', opacity: dim ? 0.3 : 1 }} hover={dim ? undefined : { background: 'var(--ya-sand-100)' }}>
      <Icon name={icon} size={18} stroke={2.2} />
    </Hv>
  );
}

function CardSkeleton() {
  return (
    <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '24px 24px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Skel w={68} h={68} r={99} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}><Skel w={200} h={26} /><Skel w={160} h={16} /></div>
      </div>
      <Skel w={240} h={44} r={99} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 }}>{[0, 1, 2].map((i) => <Skel key={i} h={96} r={16} />)}</div>
      <Skel h={74} r={16} />
      <Skel h={90} r={12} />
      <Skel h={220} r={20} />
    </div>
  );
}

function CardBody({ card: c, onWrite }: { card: ClientCard; onWrite: () => void }) {
  const T = useTixT();
  const { t, tp, n, eur, locale } = T;
  const toast = useTixToast();
  const save = useSaveClient();
  const canEdit = useTixCaps().write;
  const [entered, setEntered] = useState(false);
  const [tlf, setTlf] = useState<'all' | 'buy' | 'gl' | 'msg'>('all');
  const [tlAll, setTlAll] = useState(false);
  const [tags, setTags] = useState<string[]>(c.tags ?? []);
  const [tagIn, setTagIn] = useState('');
  const [note, setNote] = useState(c.note ?? '');
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedNote = useRef(c.note ?? '');

  useEffect(() => {
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
    return () => cancelAnimationFrame(r);
  }, []);
  // Une note en cours d'écriture part quand on change de client ou qu'on ferme.
  useEffect(() => () => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
  }, []);

  const now = Date.now();
  const name = fullName(c.first_name, c.last_name, c.email);
  const first = c.first_name?.trim() || name.split(' ')[0];
  const av = LIFECYCLE_AVATAR[c.lifecycle];
  const lastD = c.last_night ? new Date(c.last_night) : null;
  const firstD = c.first_night ? new Date(c.first_night) : null;
  const days = lastD ? Math.max(0, Math.floor((now - lastD.getTime()) / 86_400_000)) : null;
  const fdLong = (d: Date) => d.toLocaleDateString(locale, { day: 'numeric', month: 'long', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
  const fdShort = (d: Date) => d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const since = firstD ?? (c.added_at ? new Date(c.added_at) : null);
  const pastNights = c.buys.filter((b) => !b.upcoming);
  const H = c.history ?? null;
  // Dépense des soirées passées : ventes Yuno, et l'historique du fichier quand il compte.
  const pastSpent = H?.mode === 'file' ? Number(H.spent ?? 0)
    : pastNights.reduce((a, b) => a + Number(b.amount || 0), 0) + (H?.mode === 'added' ? Number(H.spent ?? 0) : 0);
  const firstStart = firstD ?? (pastNights.length ? new Date(pastNights[pastNights.length - 1].event_start) : null);
  const span = firstStart && lastD ? (lastD.getTime() - firstStart.getTime()) / (7 * 86_400_000) : 0;
  const nSub = c.nights <= 1 ? t('ya.cli.card.once') : t('ya.cli.card.every', { n: Math.max(1, Math.round(span / Math.max(1, c.nights - 1))) });
  const minN = c.rules.min_nights;
  const wk = days !== null ? Math.max(1, Math.round(days / 7)) : 0;

  let advT = '';
  let advS = '';
  if (c.lifecycle === 'hab') {
    if ((days ?? 0) <= 21) { advT = t('ya.cli.card.adv.habOk', { name: first }); advS = t('ya.cli.card.adv.habOkS', { n: wk }); }
    else { advT = t('ya.cli.card.adv.habFar', { name: first }); advS = t(c.email_ok ? 'ya.cli.card.adv.habFarMail' : 'ya.cli.card.adv.habFarSms', { n: wk }); }
  } else if (c.lifecycle === 'occ') {
    advT = t('ya.cli.card.adv.occ', { name: first, n: c.nights }); advS = t('ya.cli.card.adv.occS', { m: minN });
  } else if (c.lifecycle === 'nou') {
    const d0 = firstD ? Math.max(0, Math.floor((now - firstD.getTime()) / 86_400_000)) : 0;
    advT = t('ya.cli.card.adv.nou', { n: d0 });
    advS = t(c.email_ok ? 'ya.cli.card.adv.nouMail' : c.phone_ok ? 'ya.cli.card.adv.nouSms' : 'ya.cli.card.adv.nouNone');
  } else if (c.lifecycle === 'end') {
    advT = t('ya.cli.card.adv.end', { name: first, n: Math.max(1, Math.round((days ?? 0) / 30.4)) });
    advS = !c.email_ok && !c.phone_ok ? t('ya.cli.card.adv.endNone') : t('ya.cli.card.adv.endMsg', { ch: t(c.email_ok ? 'ya.cli.msg.ch.email' : 'ya.cli.msg.ch.sms') });
  } else {
    advT = t('ya.cli.card.adv.none', { name: first }); advS = t('ya.cli.card.adv.noneS');
  }
  // Guest list : un invité qui vient sans jamais payer appelle un autre conseil.
  const G = c.gl && c.gl.n > 0 ? c.gl : null;
  if (G && G.paid_n === 0) {
    // « 1 sur 3 soirées » se compte sur les soirées passées : une inscription à venir n'est pas une absence.
    const past = c.guests ? c.guests.filter((g) => !g.upcoming).length : G.n;
    advT = G.came > 0
      ? tp('ya.gl.card.advT', past, { name: first, n: n(past), came: n(G.came) })
      : tp('ya.gl.card.advTNoCome', G.n, { name: first, n: n(G.n) });
    advS = t(c.email_ok || c.phone_ok ? 'ya.gl.card.advS' : 'ya.gl.card.advSNone');
  }
  const prog = c.lifecycle === 'occ' || c.lifecycle === 'nou';
  const progN = Math.min(c.nights_win, minN);

  const months = useMemo(() => c.months.map((m, i) => {
    const [y, mo] = m.m.split('-').map(Number);
    const d0 = new Date(y, mo - 1, 1);
    return {
      key: m.m,
      l: d0.toLocaleDateString(locale, { month: 'short' }).charAt(0).toUpperCase(),
      title: t('ya.cli.card.monthTitle', { month: d0.toLocaleDateString(locale, { month: 'long', year: 'numeric' }), n: m.n }),
      n: m.n,
      i,
    };
  }), [c.months, locale, t]);

  const tl = useMemo<TlItem[]>(() => {
    const out: TlItem[] = [];
    const fdShort = (d: Date) => d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    const glEvents = new Set((c.guests ?? []).map((g) => g.event_id));
    (c.guests ?? []).forEach((g) => {
      const title = g.title ?? '—';
      const list = g.list ?? t(`ya.gl.kind.${g.gl === 'mix' ? 'inv' : g.gl}`);
      const state = g.upcoming ? t('ya.gl.card.tlUp')
        : g.came ? (g.scanned_at ? t('ya.gl.card.tlCameAt', { time: new Date(g.scanned_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) }) : t('ya.cli.card.tl.scanned'))
          : g.scan_known ? t('ya.gl.card.tlNoShow') : '';
      out.push({ k: 'gl', at: new Date(g.event_start).getTime(), t: t(g.gl === 'free' ? 'ya.gl.card.tlFree' : 'ya.gl.card.tlInv', { title }), s: [list, state].filter(Boolean).join(' · '), ic: 'gl', tone: g.upcoming ? 'todo' : 'gl' });
    });
    c.buys.forEach((b) => {
      // Un billet à 0 € d'une soirée déjà dans la guest list : une seule ligne.
      if (glEvents.has(b.event_id) && Number(b.amount || 0) === 0) return;
      const title = b.title ?? '—';
      if (b.upcoming) {
        const via = saleSourceText(b.source, t);
        out.push({ k: 'buy', at: new Date(b.event_start).getTime(), t: t('ya.cli.card.tl.upcoming', { title }), s: [`${fdShort(new Date(b.event_start))} · ${new Date(b.event_start).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`, via ? t('ya.cli.card.tl.via', { src: via }) : ''].filter(Boolean).join(' · '), amt: eur(b.amount), ic: 'tonight', tone: 'todo' });
      } else {
        const paid = tp('ya.cli.card.tl.paid', b.tickets, { n: b.tickets });
        const via = saleSourceText(b.source, t);
        const s = [b.first ? t('ya.cli.card.tl.first') : paid, via ? t('ya.cli.card.tl.via', { src: via }) : '', b.scanned ? t('ya.cli.card.tl.scanned') : ''].filter(Boolean).join(' · ');
        out.push({ k: 'buy', at: new Date(b.event_start).getTime(), t: t('ya.cli.card.tl.buyT', { title }), s, amt: eur(b.amount), ic: 'buy', tone: 'buy' });
      }
    });
    c.messages.forEach((m) => {
      const at = new Date(m.at).getTime();
      out.push({ k: 'msg', at, t: t('ya.cli.card.tl.mailT', { name: m.name ?? '—' }), s: m.opened ? t('ya.cli.card.tl.opened') : t('ya.cli.card.tl.received'), ic: 'msg', tone: 'msg' });
      if (m.clicked) {
        // Le clic, la soirée vers laquelle il menait, et ce qui a suivi.
        const cat = m.clicked_at ? new Date(m.clicked_at).getTime() : at + 1;
        const after = m.bought_after === true ? t('ya.cli.card.tl.boughtAfter') : m.bought_after === false ? t('ya.cli.card.tl.notBought') : '';
        out.push({
          k: 'msg', at: cat,
          t: m.event_title ? t('ya.cli.card.tl.clickedEv', { title: m.event_title }) : t('ya.cli.card.tl.clicked'),
          s: [m.name ?? '', after].filter(Boolean).join(' · '), ic: 'click', tone: 'msg',
        });
      }
    });
    if (c.added_at && c.source !== 'yuno') {
      out.push({ k: 'msg', at: new Date(c.added_at).getTime() - 1, t: t(c.source === 'import' ? 'ya.cli.card.tl.addedImport' : 'ya.cli.card.tl.added'), s: '', ic: 'add', tone: 'msg' });
    }
    return out.sort((a, b) => b.at - a.at);
  }, [c, locale, t, tp, eur]);
  const filt = tl.filter((e) => tlf === 'all' || e.k === tlf);
  const shown = tlAll ? filt : filt.slice(0, 5);

  const rc = c.email_ok && c.phone_ok ? 'both' : c.email_ok ? 'mail' : c.phone_ok ? 'sms' : 'none';
  const SRC: Record<string, string> = { yuno: t('ya.cli.f.src.yuno'), import: t('ya.cli.f.src.import'), other: '—' };
  const info: { l: string; v: string; fg: string }[] = [
    { l: t('ya.cli.card.email'), v: c.email_ok ? c.email : t('ya.cli.card.emailStop', { email: c.email }), fg: c.email_ok ? 'var(--ya-ink)' : 'var(--ya-amber-700)' },
    { l: t('ya.cli.card.phone'), v: c.phone_ok && c.phone ? c.phone : t('ya.cli.card.phoneNone'), fg: c.phone_ok && c.phone ? 'var(--ya-ink)' : 'var(--ya-sand-500)' },
    { l: t('ya.cli.card.reachBy'), v: t(`ya.cli.card.reach.${rc}`), fg: rc === 'none' ? 'var(--ya-amber-700)' : 'var(--ya-ink)' },
    { l: t('ya.cli.card.came'), v: c.source === 'yuno' ? (saleSourceText(c.first_source, t) ?? SRC.yuno) : SRC[c.source] ?? '—', fg: 'var(--ya-ink)' },
    ...(firstD ? [{ l: t('ya.cli.card.firstNight'), v: fdLong(firstD), fg: 'var(--ya-ink)' }] : []),
  ];

  const persistTags = (next: string[]) => {
    setTags(next);
    save.mutate({ email: c.email, tags: next });
  };
  const addTag = (v: string) => {
    const tag = v.trim().slice(0, 24);
    setTagIn('');
    if (!tag || tags.some((x) => x.toLowerCase() === tag.toLowerCase())) return;
    persistTags([...tags, tag]);
  };
  const onNote = (v: string) => {
    setNote(v);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => {
      if (v === savedNote.current) return;
      save.mutate({ email: c.email, note: v }, { onSuccess: () => { savedNote.current = v; toast(t('ya.cli.card.noteSaved')); } });
    }, 900);
  };
  const flushNote = () => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    if (note !== savedNote.current) save.mutate({ email: c.email, note }, { onSuccess: () => { savedNote.current = note; } });
  };
  const sugg = SUGG.map((k) => t(`ya.cli.card.sugg.${k}`)).filter((l) => !tags.some((x) => x.toLowerCase() === l.toLowerCase()));
  const copy = () => {
    try { void navigator.clipboard?.writeText(c.email); } catch { /* presse-papier refusé : le toast suffit à montrer l'adresse */ }
    toast(t('ya.cli.card.copied', { email: c.email }));
  };
  const canWrite = c.email_ok || c.phone_ok;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '24px 24px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ flex: 'none', width: 68, height: 68, borderRadius: 99, background: av[0], color: av[1], display: 'grid', placeItems: 'center', fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.02em' }}>{initials(c.first_name, c.last_name, c.email)}</span>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 28, lineHeight: 1.05, letterSpacing: '-.03em', overflowWrap: 'anywhere' }}>{name}</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 8px' }}>
            <span style={{ height: 26, padding: '0 11px', borderRadius: 99, background: 'var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200)', display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600 }}>
              <i style={{ width: 8, height: 8, borderRadius: 3, background: c.lifecycle === 'none' ? 'var(--ya-sand-300)' : LIFECYCLE_COLOR[c.lifecycle] }} />{t(`ya.cli.seg.${c.lifecycle}`)}
            </span>
            {since && <span style={{ fontSize: 13.5, color: 'var(--ya-sand-500)' }}>{t('ya.cli.card.since', { date: fdLong(since) })}</span>}
            {c.tonight && (
              <span style={{ height: 24, padding: '0 9px', borderRadius: 99, background: 'var(--ya-red-50)', color: 'var(--ya-red-700)', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <i style={{ width: 5, height: 5, borderRadius: 99, background: 'var(--ya-red-500)' }} />{t('ya.cli.card.tonight')}
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {canWrite && (
          <Hv
            as="button"
            type="button"
            onClick={onWrite}
            style={{ height: 44, padding: '0 5px 0 18px', borderRadius: 99, border: 0, background: 'var(--ya-gradient-brand)', color: '#fff', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10, boxShadow: 'var(--ya-shadow-cta)', cursor: 'pointer', transition: `transform 200ms ${SPRING},filter 160ms` }}
            hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }}
            active={{ transform: 'scale(.97)' }}
          >
            {t('ya.cli.card.write', { name: first })}
            <span style={{ width: 34, height: 34, borderRadius: 99, background: '#fff', color: 'var(--ya-red-500)', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={15} stroke={2.4} /></span>
          </Hv>
        )}
        <Hv as="button" type="button" onClick={copy} style={{ height: 44, padding: '0 18px', borderRadius: 99, border: '1px solid var(--ya-sand-200)', background: 'var(--ya-card)', fontSize: 14.5, fontWeight: 600, color: 'var(--ya-ink)', cursor: 'pointer' }} hover={{ borderColor: 'var(--ya-sand-300)', background: 'var(--ya-paper)' }}>
          {t('ya.cli.card.copy')}
        </Hv>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 }}>
        <Stat l={t('ya.cli.card.nights')} v={n(c.nights)} s={nSub} />
        {/* Dépense par soirée : soirées PASSÉES seulement, des deux côtés de la division. */}
        <Stat l={t('ya.cli.card.spent')} v={eur(c.spent)} s={c.nights > 0 && c.spent !== null ? t('ya.cli.card.perNight', { v: eur(pastSpent / c.nights) }) : '—'} />
        <Stat l={t('ya.cli.card.last')} v={lastD ? fdShort(lastD) : '—'} s={days !== null ? relDays(days, t, tp) : t('ya.cli.list.never')} nowrap />
      </div>

      {H && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 16, background: 'var(--ya-sand-50)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-100)' }}>
          <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 99, background: 'var(--ya-card)', color: 'var(--ya-sand-700)', display: 'grid', placeItems: 'center' }}><Icon name="file" size={16} stroke={2.2} /></span>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <b style={{ fontSize: 14.5, fontWeight: 600 }}>
              {[
                t('ya.cli.card.hist.t'),
                tp('ya.cli.card.hist.nights', H.nights, { n: n(H.nights) }),
                H.spent !== null && H.spent > 0 ? t('ya.cli.card.hist.spent', { v: eur(H.spent) }) : '',
                H.last ? t('ya.cli.card.hist.last', { d: fdLong(new Date(H.last)) }) : '',
              ].filter(Boolean).join(' · ')}
            </b>
            <span style={{ fontSize: 13, color: 'var(--ya-sand-600)', textWrap: 'pretty' }}>
              {[
                H.list ? t('ya.cli.card.hist.file', { name: H.list }) : '',
                t(H.mode === 'file' ? 'ya.cli.card.hist.fileWins' : H.mode === 'live' ? 'ya.cli.card.hist.live'
                  : c.buys.length || (c.guests ?? []).length ? 'ya.cli.card.hist.added' : 'ya.cli.card.hist.only'),
              ].filter(Boolean).join(' · ')}
            </span>
          </span>
        </div>
      )}

      {G && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 16, background: 'var(--ya-amber-50)' }}>
          <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 99, background: 'var(--ya-card)', color: 'var(--ya-amber-700)', display: 'grid', placeItems: 'center' }}><Icon d={TL_ICON.gl} size={16} stroke={2.2} /></span>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <b style={{ fontSize: 14.5, fontWeight: 600 }}>{tp('ya.gl.card.stripT', G.n, { n: n(G.n) })}</b>
            <span style={{ fontSize: 13, color: 'var(--ya-amber-700)' }}>
              {[
                G.came > 0 ? tp('ya.gl.card.stripCame', G.came, { n: n(G.came) }) : '',
                G.conv ? t('ya.gl.card.stripConv') : G.paid_n === 0 ? t('ya.gl.card.stripNeverPaid') : t('ya.gl.card.stripAlsoPaid'),
                G.noshow >= 2 ? tp('ya.gl.card.stripNoShow', G.noshow, { n: n(G.noshow) }) : '',
              ].filter(Boolean).join(' · ')}
            </span>
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, padding: '16px 18px', borderRadius: 16, background: 'var(--ya-red-50)' }}>
        <span style={{ flex: 'none', width: 8, height: 8, marginTop: 7, borderRadius: 99, background: 'var(--ya-red-500)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 15, lineHeight: 1.45, fontWeight: 600, textWrap: 'pretty' }}>{advT}</span>
          <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--ya-red-800)', textWrap: 'pretty' }}>{advS}</span>
        </div>
      </div>

      {/* La porte du club : bannissement et incidents (Console Club seulement). */}
      {c.door && <ClientDoor card={c} />}

      {prog && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
            <span style={{ fontWeight: 600 }}>{t('ya.cli.card.path')}</span>
            <span style={{ color: 'var(--ya-sand-500)' }}>{t('ya.cli.card.pathTxt', { a: progN, b: minN })}</span>
          </div>
          <div style={{ height: 8, borderRadius: 99, background: 'var(--ya-sand-100)', overflow: 'hidden' }}>
            <div style={{ width: entered ? `${Math.min(100, (progN / Math.max(1, minN)) * 100)}%` : 0, height: '100%', borderRadius: 99, background: 'var(--ya-gradient-brand)', transition: `width 700ms ${EASE} 200ms` }} />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{t('ya.cli.card.rhythm')} <span style={{ fontWeight: 400, color: 'var(--ya-sand-500)' }}>{t('ya.cli.card.rhythmSub')}</span></span>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 56 }}>
          {months.map((m) => (
            <div key={m.key} title={m.title} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
              <div style={{ width: '100%', height: m.n ? (entered ? Math.min(56, 14 + m.n * 12) : 4) : 4, borderRadius: 4, background: m.n ? 'var(--ya-gradient-brand)' : 'var(--ya-sand-100)', transition: `height 600ms ${EASE} ${m.i * 30}ms` }} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          {months.map((m) => <span key={m.key} style={{ flex: 1, minWidth: 0, textAlign: 'center', fontFamily: 'var(--ya-font-mono)', fontSize: 10.5, color: 'var(--ya-sand-400)' }}>{m.l}</span>)}
        </div>
      </div>

      <Box>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{t('ya.cli.card.journey')}</span>
          <div role="group" aria-label={t('ya.cli.card.journey')} style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--ya-sand-100)', borderRadius: 99 }}>
            {(['all', 'buy', ...((c.guests?.length ?? 0) > 0 ? ['gl' as const] : []), 'msg'] as const).map((k) => {
              const on = tlf === k;
              return (
                <button key={k} type="button" onClick={() => { setTlf(k); setTlAll(false); }} aria-pressed={on} style={{ height: 30, padding: '0 13px', border: 0, borderRadius: 99, background: on ? 'var(--ya-seg-on)' : 'transparent', boxShadow: on ? 'var(--ya-shadow-xs)' : 'none', fontSize: 13, fontWeight: 600, color: on ? 'var(--ya-ink)' : 'var(--ya-sand-600)', cursor: 'pointer', transition: 'background 160ms,color 160ms' }}>
                  {k === 'gl' ? t('ya.gl.tab') : t(`ya.cli.card.tl.${k}`)}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {shown.map((e, i) => (
            <div key={`${tlf}-${i}-${e.at}`} style={{ display: 'flex', gap: 14, animation: `ya-rise 420ms ${EASE} both`, animationDelay: `${i * 40}ms` }}>
              <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ width: 32, height: 32, borderRadius: 99, background: TL_TONE[e.tone][0], color: TL_TONE[e.tone][1], display: 'grid', placeItems: 'center' }}><Icon d={TL_ICON[e.ic]} size={16} stroke={2} /></span>
                <span style={{ flex: 1, width: 1, background: i === shown.length - 1 ? 'transparent' : 'var(--ya-sand-200)', margin: '4px 0' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingBottom: 16 }}>
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600, lineHeight: '20px', textWrap: 'pretty' }}>{e.t}</span>
                  {e.s && <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--ya-sand-500)', textWrap: 'pretty' }}>{e.s}</span>}
                </div>
                <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                  <span style={{ fontSize: 13, color: 'var(--ya-sand-500)', whiteSpace: 'nowrap' }}>{fdLong(new Date(e.at))}</span>
                  {e.amt && <b style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{e.amt}</b>}
                </div>
              </div>
            </div>
          ))}
        </div>
        {filt.length > 5 && (
          <Hv as="button" type="button" onClick={() => setTlAll(!tlAll)} style={{ alignSelf: 'flex-start', border: 0, background: 'none', padding: 0, fontSize: 14, fontWeight: 600, color: 'var(--ya-ink)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }} hover={{ color: 'var(--ya-red-600)' }}>
            {tlAll ? t('ya.cli.card.tl.less') : t('ya.cli.card.tl.more', { n: filt.length - 5 })}
            <Icon name="chevronDown" size={14} stroke={2.4} style={{ transform: `rotate(${tlAll ? 180 : 0}deg)` }} />
          </Hv>
        )}
        {filt.length === 0 && <span style={{ fontSize: 14, color: 'var(--ya-sand-500)' }}>{t('ya.cli.card.tl.none')}</span>}
      </Box>

      <Box gap={10}>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{t('ya.cli.card.contact')}</span>
        {info.map((it) => (
          <div key={it.l} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, fontSize: 14.5 }}>
            <span style={{ flex: 'none', width: 120, color: 'var(--ya-sand-500)' }}>{it.l}</span>
            <span style={{ flex: 1, minWidth: 0, textAlign: 'right', fontWeight: 500, color: it.fg, overflowWrap: 'anywhere' }}>{it.v}</span>
          </div>
        ))}
      </Box>

      <Box>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{t('ya.cli.card.tags')}</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          {tags.map((g) => (
            <span key={g} style={{ height: 30, padding: '0 6px 0 12px', borderRadius: 99, background: 'var(--ya-sand-100)', color: 'var(--ya-sand-700)', fontSize: 13.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {g}
              {canEdit && <Hv as="button" type="button" onClick={() => persistTags(tags.filter((x) => x !== g))} aria-label={t('ya.cli.card.tagDel')} style={{ width: 22, height: 22, border: 0, borderRadius: 99, background: 'none', color: 'var(--ya-sand-500)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--ya-sand-200)', color: 'var(--ya-ink)' }}>
                <Icon name="x" size={11} stroke={2.8} />
              </Hv>}
            </span>
          ))}
          {canEdit && <input
            value={tagIn}
            onChange={(e) => setTagIn(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagIn); } }}
            onBlur={() => { if (tagIn.trim()) addTag(tagIn); }}
            placeholder={t('ya.cli.card.tagPh')}
            aria-label={t('ya.cli.card.tagAdd')}
            maxLength={24}
            style={{ height: 30, width: 112, padding: '0 12px', borderRadius: 99, border: '1px dashed var(--ya-sand-300)', outline: 0, background: 'transparent', font: '500 13.5px/1 var(--ya-font-body)', color: 'var(--ya-ink)', boxShadow: 'none' }}
          />}
        </div>
        {canEdit && sugg.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {sugg.map((l) => (
              <Hv key={l} as="button" type="button" onClick={() => addTag(l)} style={{ height: 26, padding: '0 10px', borderRadius: 99, border: '1px dashed var(--ya-sand-300)', background: 'none', color: 'var(--ya-sand-500)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }} hover={{ borderColor: 'var(--ya-sand-500)', color: 'var(--ya-ink)' }}>
                + {l}
              </Hv>
            ))}
          </div>
        )}
        <textarea
          readOnly={!canEdit}
          value={note}
          onChange={(e) => onNote(e.target.value)}
          onBlur={flushNote}
          rows={3}
          maxLength={2000}
          aria-label={t('ya.cli.card.notePh')}
          placeholder={t('ya.cli.card.notePh')}
          style={{ width: '100%', resize: 'vertical', padding: '12px 14px', borderRadius: 14, border: '1px solid var(--ya-sand-200)', outline: 0, background: 'var(--ya-paper)', font: '400 14.5px/1.45 var(--ya-font-body)', color: 'var(--ya-ink)', boxShadow: 'none' }}
        />
      </Box>
    </div>
  );
}

function Stat({ l, v, s, nowrap }: { l: string; v: string; s: string; nowrap?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '14px 16px', borderRadius: 16, background: 'var(--ya-card)', border: '1px solid var(--ya-sand-200)', minWidth: 0 }}>
      <span style={{ fontSize: 13, color: 'var(--ya-sand-500)' }}>{l}</span>
      <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 30, lineHeight: 1.05, letterSpacing: '-.035em', fontVariantNumeric: 'tabular-nums', whiteSpace: nowrap ? 'nowrap' : undefined, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</span>
      <span style={{ fontSize: 12.5, color: 'var(--ya-sand-500)' }}>{s}</span>
    </div>
  );
}

function Box({ children, gap = 12 }: { children: React.ReactNode; gap?: number }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap, padding: 18, borderRadius: 20, background: 'var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200)' }}>{children}</div>;
}
