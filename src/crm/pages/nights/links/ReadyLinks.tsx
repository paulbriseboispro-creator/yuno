/**
 * Les liens que Yuno pose seul sur chaque soirée à venir (migration
 * 20261120100000_crm_ready_links.sql) : le pro n'a rien à créer, il copie.
 *
 *   ReadyLinksCard     → onglet « Liens de partage » : bio Instagram, story,
 *                        bio TikTok, groupe WhatsApp, événement Facebook.
 *   GuestListLinksCard → onglet « Gratuits » : chaque guest list Shotgun (tarif
 *                        à 0 € vendu en ligne) avec son lien pour un e-mail
 *                        (page Shotgun ouverte sur le tarif, suivi posé par
 *                        Yuno à l'envoi) et son lien de partage /go/.
 *
 * Un lien prêt jamais utilisé n'entre dans aucun chiffre (règle de Paul) : ces
 * cartes montrent ses clics et ses billets seulement quand il en a.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useCrmToast } from '@/crm/ui/toast';
import { EASE } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { PUBLIC_BASE_URL } from '@/lib/native';
import { useNightLinks, type NightGuestListDeal, type NightLinksData } from '@/crm/data/links';
import { goDisplay, goUrl, splitLinks, type NightLink } from '@/crm/lib/links';
import { PlatformBadge, QrModal } from './linksUi';
import { copyText } from '@/crm/lib/clipboard';

const card = (delay: number) => ({
  display: 'flex', flexDirection: 'column' as const, gap: 14, padding: 22, borderRadius: 24, background: '#fff',
  boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-xs)', animation: `yc-row 600ms ${EASE} ${delay}ms both`,
});
const h3 = { margin: 0, fontSize: 16, fontWeight: 600 } as const;
const sub = { fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' as const };

/** Copier avec un « Copié » de 2 s sur le bouton et un conseil en toast. */
function useCopy() {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, text: string, tip: string) => {
    if (await copyText(text)) {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2200);
      toast(tip);
    } else {
      toast(t('yc.lk.err.copy'));
    }
  };
  return { copied, copy };
}

function CopyBtn({ done, label, onClick, primary }: { done: boolean; label: string; onClick: () => void; primary?: boolean }) {
  const { t } = useCrmT();
  return (
    <Hv
      as="button"
      type="button"
      onClick={onClick}
      style={{
        height: 36, padding: '0 14px', borderRadius: 99, border: 0, cursor: 'pointer', whiteSpace: 'nowrap',
        display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 600,
        background: done ? 'var(--green-50)' : primary ? 'var(--ink)' : 'var(--sand-100)',
        color: done ? 'var(--green-700)' : primary ? '#fff' : 'var(--ink)',
        transition: 'background 160ms',
      }}
      hover={{ background: done ? undefined : primary ? 'var(--sand-700)' : 'var(--sand-200)' }}
    >
      <Icon name={done ? 'check' : 'copy'} size={14} stroke={2.4} />
      {done ? t('yc.lk.copied') : label}
    </Hv>
  );
}

function QrBtn({ onClick }: { onClick: () => void }) {
  const { t } = useCrmT();
  return (
    <Hv
      as="button"
      type="button"
      onClick={onClick}
      aria-label={t('yc.lk.qr')}
      title={t('yc.lk.qr')}
      style={{ width: 36, height: 36, borderRadius: 99, border: 0, background: 'var(--sand-100)', color: 'var(--ink)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
      hover={{ background: 'var(--sand-200)' }}
    >
      <Icon name="qr" size={15} stroke={2.2} />
    </Hv>
  );
}

/** « 12 clics · 3 billets » — rien tant que le lien n'a pas servi. */
function usedLine(l: Pick<NightLink, 'clicks' | 'tickets'>, confirmed: boolean, T: ReturnType<typeof useCrmT>): string | null {
  if (!l.clicks && !l.tickets) return null;
  const parts = [T.tp('yc.lk.ready.clicks', l.clicks, { n: T.n(l.clicks) })];
  if (confirmed || l.tickets > 0) parts.push(T.tp('yc.lk.ready.tickets', l.tickets, { n: T.n(l.tickets) }));
  return parts.join(' · ');
}

// ── Onglet « Liens de partage » ─────────────────────────────────────────────

export function ReadyLinksCard({ d }: { d: NightLinksData }) {
  const T = useCrmT();
  const { t } = T;
  const { copied, copy } = useCopy();
  const [qr, setQr] = useState<NightLink | null>(null);
  const [, setParams] = useSearchParams();
  const { ready } = splitLinks(d.links);
  const guestLists = d.guestlists?.length ?? 0;
  if (!d.event.upcoming || ready.length === 0) return null;

  const openGuestLists = () => setParams((p) => { const q = new URLSearchParams(p); q.set('v', 'gl'); return q; }, { replace: true });

  return (
    <section style={card(60)}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h3 style={h3}>{t('yc.lk.ready.t')}</h3>
        <span style={sub}>{t('yc.lk.ready.s')}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {ready.map((l, i) => {
          const used = usedLine(l, d.confirmed, T);
          return (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: i ? '1px solid var(--sand-100)' : undefined }}>
              <PlatformBadge platform={l.platform} placement={l.placement} size={36} />
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <b style={{ fontSize: 14.5, fontWeight: 600 }}>{t(`yc.lk.ready.k.${l.auto}`)}</b>
                <span style={{ fontSize: 12.5, color: 'var(--sand-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {used ?? goDisplay(PUBLIC_BASE_URL, l.code)}
                </span>
              </span>
              <CopyBtn done={copied === l.id} label={t('yc.lk.ready.copy')} onClick={() => void copy(l.id, goUrl(PUBLIC_BASE_URL, l.code), t(`yc.lk.tip.${l.placement}`))} />
              <QrBtn onClick={() => setQr(l)} />
            </div>
          );
        })}
      </div>
      {guestLists > 0 && (
        <button type="button" onClick={openGuestLists} style={{ alignSelf: 'flex-start', border: 0, background: 'none', padding: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--red-600)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {T.tp('yc.lk.ready.gl', guestLists, { n: T.n(guestLists) })}
          <Icon name="arrowRight" size={14} stroke={2.4} />
        </button>
      )}
      {qr && <QrModal open={!!qr} onClose={() => setQr(null)} url={goUrl(PUBLIC_BASE_URL, qr.code)} display={goDisplay(PUBLIC_BASE_URL, qr.code)} label={t(`yc.lk.ready.k.${qr.auto}`)} />}
    </section>
  );
}

// ── Onglet « Gratuits » ─────────────────────────────────────────────────────

export function GuestListLinksCard({ eventId }: { eventId: string }) {
  const q = useNightLinks(eventId);
  const d = q.data && q.data.event?.id === eventId ? q.data : undefined;
  if (!d || d.error === 'not_found' || !d.event.upcoming || !d.guestlists?.length) return null;
  return <GuestListLinksBody d={d} lists={d.guestlists} />;
}

function GuestListLinksBody({ d, lists }: { d: NightLinksData; lists: NightGuestListDeal[] }) {
  const T = useCrmT();
  const { t, n } = T;
  const { copied, copy } = useCopy();
  const [qr, setQr] = useState<{ link: NightLink; name: string } | null>(null);
  const { byDeal } = splitLinks(d.links);

  return (
    <section style={card(40)}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h3 style={h3}>{T.tp('yc.lk.gl.t', lists.length, { n: n(lists.length) })}</h3>
        <span style={sub}>{t('yc.lk.gl.s')}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {lists.map((g, i) => {
          const link = byDeal.get(g.id) ?? null;
          const used = link ? usedLine(link, d.confirmed, T) : null;
          const count = g.out
            ? t('yc.lk.gl.full')
            : g.quantity
              ? t('yc.lk.gl.taken', { n: n(g.taken), q: n(g.quantity) })
              : T.tp('yc.lk.gl.takenOpen', g.taken, { n: n(g.taken) });
          return (
            <div key={g.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 12px', padding: '12px 0', borderTop: i ? '1px solid var(--sand-100)' : undefined, opacity: g.out ? 0.6 : 1 }}>
              <span style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <b style={{ fontSize: 14.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</b>
                  <span style={{ flex: 'none', padding: '2px 8px', borderRadius: 99, fontSize: 11.5, fontWeight: 600, background: 'var(--sand-100)', color: 'var(--sand-600)' }}>
                    {t(g.public ? 'yc.lk.gl.public' : 'yc.lk.gl.private')}
                  </span>
                </span>
                <span style={{ fontSize: 12.5, color: g.out ? 'var(--red-600)' : 'var(--sand-500)' }}>
                  {used ? `${count} · ${used}` : count}
                </span>
              </span>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {g.email_url && (
                  <CopyBtn primary done={copied === `m:${g.id}`} label={t('yc.lk.gl.email')} onClick={() => void copy(`m:${g.id}`, g.email_url!, t('yc.lk.gl.emailTip'))} />
                )}
                {link && (
                  <>
                    <CopyBtn done={copied === `s:${g.id}`} label={t('yc.lk.gl.share')} onClick={() => void copy(`s:${g.id}`, goUrl(PUBLIC_BASE_URL, link.code), t('yc.lk.gl.shareTip'))} />
                    <QrBtn onClick={() => setQr({ link, name: g.name })} />
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 16, background: 'var(--sand-50)', fontSize: 13, lineHeight: 1.5, color: 'var(--sand-700)' }}>
        <Icon name="mail" size={15} stroke={2.2} style={{ flex: 'none', marginTop: 2 }} />
        <span>{t('yc.lk.gl.how')}</span>
      </div>
      {qr && <QrModal open={!!qr} onClose={() => setQr(null)} url={goUrl(PUBLIC_BASE_URL, qr.link.code)} display={goDisplay(PUBLIC_BASE_URL, qr.link.code)} label={qr.name} />}
    </section>
  );
}
