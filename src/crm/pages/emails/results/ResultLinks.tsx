/**
 * Résultats › Liens et clics : chaque lien de l'e-mail, du plus cliqué au
 * moins cliqué (personnes distinctes, part des clics), puis « Qui a cliqué
 * sans acheter ? » — les contacts intéressés, à qui écrire d'un clic.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE, clamp01, useProgress } from '@/crm/ui/motion';
import { useNarrow } from '@/crm/ui/useNarrow';
import { Skel } from '@/crm/ui/kit';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { useNights } from '@/crm/data/nights';
import { useEmailRecipientEmails, useEmailRecipients, type EmailResult } from '@/crm/data/emails';
import { cleanLink, linkKind, type LinkKind } from '@/crm/lib/emails';
import { LIFECYCLE_AVATAR, fullName, initials } from '@/crm/lib/lifecycle';
import type { Lifecycle } from '@/crm/data/clients';
import { WriteModal } from '@/crm/components/WriteModal';

const box = { display: 'flex', flexDirection: 'column', padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' } as const;
const h2 = { margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' } as const;
const subCss = { fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2, textWrap: 'pretty' } as const;

const hostOf = (url: string | null | undefined) => {
  if (!url) return '';
  try { return new URL(url).host.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
};

const FILL: Record<LinkKind, string> = {
  ticketing: 'var(--gradient-brand)',
  yuno: 'var(--gradient-brand)',
  social: 'var(--red-300)',
  other: 'var(--red-200)',
  unsub: 'var(--sand-300)',
};

export function ResultLinks({ r }: { r: EmailResult }) {
  const { t, n, pct } = useCrmT();
  const narrow = useNarrow(720);
  const nights = useNights();
  const g = useProgress(1100, 200, r.id);
  // Les billetteries des soirées du compte (Shotgun, page Yuno…) comptent
  // comme « billetterie », même sur un hôte que la liste ne connaît pas.
  const hosts = useMemo(() => [...new Set((nights.data?.nights ?? []).map((x) => hostOf(x.url)).filter(Boolean))], [nights.data]);
  const links = useMemo(() => [...r.links].sort((a, b) => b.people - a.people || b.clicks - a.clicks), [r.links]);
  const totalClicks = links.reduce((s, l) => s + l.clicks, 0);
  const top = Math.max(1, ...links.map((l) => l.people));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, animation: `yc-rise 520ms ${EASE} both` }}>
      <section style={{ ...box, gap: 18 }}>
        <div><h2 style={h2}>{t('yc.em.rs.l.t')}</h2><div style={subCss}>{t('yc.em.rs.l.s')}</div></div>
        {!links.length ? (
          <div style={{ padding: '26px 0 8px', fontSize: 15, color: 'var(--sand-500)' }}>{t('yc.em.rs.l.none')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {links.map((l, i) => {
              const kind = linkKind(l.link, hosts);
              const label = kind === 'unsub' ? t('yc.em.rs.l.unsub') : cleanLink(l.link);
              const w = (l.people / top) * 100 * clamp01(g * 1.4 - i * 0.08);
              const bar = (
                <div style={{ height: 10, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden', gridColumn: narrow ? '2 / -1' : undefined }}>
                  <div style={{ width: `${w}%`, height: '100%', borderRadius: 99, background: FILL[kind] }} />
                </div>
              );
              return (
                <div key={l.link} style={{ display: 'grid', gridTemplateColumns: narrow ? '36px minmax(0,1fr) 64px 64px' : '36px minmax(0,1.4fr) minmax(0,1.6fr) 90px 90px', gap: '8px 16px', alignItems: 'center', padding: '14px 0', borderTop: i ? '1px solid var(--sand-100)' : 'none' }}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, background: i === 0 ? 'var(--red-500)' : 'var(--sand-100)', color: i === 0 ? '#fff' : 'var(--sand-700)', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700 }}>{i + 1}</span>
                  <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <a href={l.link} target="_blank" rel="noopener noreferrer" title={l.link} style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</a>
                    <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t(`yc.em.rs.l.k.${kind}`)}</span>
                  </span>
                  {!narrow && bar}
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{n(l.people)}</b>
                    <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{t('yc.em.rs.l.people')}</span>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <b style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{pct(totalClicks ? (l.clicks / totalClicks) * 100 : 0)}</b>
                    <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{t('yc.em.rs.l.share')}</span>
                  </span>
                  {narrow && bar}
                </div>
              );
            })}
          </div>
        )}
      </section>
      <HotClickers id={r.id} />
    </div>
  );
}

function HotClickers({ id }: { id: string }) {
  const { t, tp, n } = useCrmT();
  const q = useEmailRecipients(id, 'hot', '', 0);
  const [write, setWrite] = useState(false);
  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  // Toutes les adresses, pas la première page : la fenêtre « Écrire » ne
  // s'ouvre qu'une fois la liste complète lue (sans elle, elle viserait
  // toute la base).
  const all = useEmailRecipientEmails(id, 'hot', total > 0);
  const emails = all.data?.emails ?? null;
  const shown = rows.slice(0, 12);
  const who = tp('yc.em.rs.hot.who', total, { n: n(total) });

  return (
    <section style={{ ...box, gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div><h2 style={h2}>{t('yc.em.rs.hot.t')}</h2><div style={subCss}>{t('yc.em.rs.hot.s')}</div></div>
        {total > 0 && (
          <Hv as="button" type="button" disabled={!emails?.length} onClick={() => setWrite(true)} style={{ height: 40, padding: '0 16px', borderRadius: 99, border: 0, background: 'var(--ink)', color: '#fff', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: emails?.length ? 'pointer' : 'default', opacity: emails?.length ? 1 : 0.5 }} hover={{ background: 'var(--sand-700)' }}>
            <Icon name="mail" size={16} stroke={2.2} />{t('yc.em.rs.hot.write')}
          </Hv>
        )}
      </div>
      {q.isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: 10 }}>
          {[0, 1, 2].map((k) => <Skel key={k} h={62} r={16} />)}
        </div>
      ) : !rows.length ? (
        <div style={{ padding: '10px 0', fontSize: 15, color: 'var(--sand-500)' }}>{t('yc.em.rs.hot.none')}</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: 10 }}>
            {shown.map((p) => {
              const life = (p.lifecycle ?? 'none') as Lifecycle;
              const [bg, fg] = LIFECYCLE_AVATAR[life] ?? LIFECYCLE_AVATAR.none;
              return (
                <Hv
                  as={Link}
                  key={p.email}
                  to={`${CRM_ROUTES.clients}?c=${encodeURIComponent(p.email)}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 16, background: 'var(--paper)', boxShadow: 'inset 0 0 0 1px var(--sand-100)', color: 'var(--ink)', textDecoration: 'none', transition: `translate 200ms ${EASE},box-shadow 200ms` }}
                  hover={{ translate: '0 -2px', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)', color: 'var(--ink)', textDecoration: 'none' }}
                >
                  <span style={{ flex: 'none', width: 38, height: 38, borderRadius: 99, background: bg, color: fg, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 600 }}>{initials(p.first_name, p.last_name, p.email)}</span>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <b style={{ fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fullName(p.first_name, p.last_name, p.email)}</b>
                    <span style={{ fontSize: 12.5, color: 'var(--sand-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email}</span>
                  </span>
                  <span style={{ flex: 'none', fontSize: 12.5, fontWeight: 600, color: 'var(--sand-600)' }}>{t('yc.em.rs.hot.clicked')}</span>
                </Hv>
              );
            })}
          </div>
          {total > shown.length && <div style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{tp('yc.em.rs.hot.more', total - shown.length, { n: n(total - shown.length) })}</div>}
        </>
      )}
      {write && emails?.length ? (
        <WriteModal open onClose={() => setWrite(false)} scope="sel" who={who} eyebrow={t('yc.em.rs.hot.t')} emails={emails} />
      ) : null}
    </section>
  );
}
