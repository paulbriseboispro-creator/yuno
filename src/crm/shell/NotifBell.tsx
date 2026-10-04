/**
 * Cloche de la barre du haut (NotifBell du design) : pastille du nombre à
 * voir, aperçu des cinq dernières notifications, raccourci vers ce qui est à
 * faire, « Tout marquer comme lu ».
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useCrmT } from '@/crm/i18n';
import { useCrmNotifAction, useCrmNotifications } from '@/crm/data/notifications';
import { NOTIF_ICON, NOTIF_TONE_COLORS, notifCopy } from './notifCopy';
import { CRM_ROUTES } from './nav';
import { useRelTime } from './relTime';

export function NotifBell({ unread }: { unread: number }) {
  const T = useCrmT();
  const { t, tp } = T;
  const rel = useRelTime();
  const [open, setOpen] = useState(false);
  const q = useCrmNotifications(open || unread > 0);
  const mark = useCrmNotifAction();

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open]);

  const all = (q.data ?? []).filter((i) => !i.archived && !(i.snoozed_until && new Date(i.snoozed_until) > new Date()));
  const need = all.filter((i) => i.need && !i.resolved);
  const info = all.filter((i) => !(i.need && !i.resolved));
  const un = info.filter((i) => !i.read);
  const count = q.data ? un.length + need.length : unread;
  const rows = info.slice(0, 5);

  return (
    <div style={{ position: 'relative' }}>
      {open && <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1 }} />}
      <Hv
        as="button"
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={count ? t('yc.notif.ariaSome', { n: count }) : t('yc.notif.ariaNone')}
        title={t('yc.notif.title')}
        style={{
          position: 'relative', zIndex: 2, width: 36, height: 36, padding: 0, borderRadius: 99, background: '#fff',
          border: `1px solid ${open ? 'var(--sand-400)' : 'var(--sand-200)'}`, display: 'grid', placeItems: 'center',
          color: 'var(--ink)', cursor: 'pointer', transition: 'border-color 160ms,transform 200ms var(--ease-spring)',
        }}
        hover={{ borderColor: 'var(--sand-300)' }}
        active={{ transform: 'scale(.94)' }}
      >
        <Icon name="bell" size={18} />
        {count > 0 && (
          <span style={{
            position: 'absolute', top: -5, right: -5, minWidth: 19, height: 19, padding: '0 5px', borderRadius: 99, background: 'var(--red-500)',
            color: '#fff', fontSize: 11.5, fontWeight: 600, lineHeight: 1, display: 'grid', placeItems: 'center', boxShadow: '0 0 0 2px var(--paper)',
            fontVariantNumeric: 'tabular-nums',
          }}>{count > 9 ? '9+' : count}</span>
        )}
      </Hv>
      {open && (
        <div role="dialog" aria-label={t('yc.notif.title')} style={{
          position: 'absolute', zIndex: 2, top: 44, right: 0, width: 'min(420px, calc(100vw - 32px))', borderRadius: 20, background: '#fff',
          boxShadow: 'var(--shadow-md),0 0 0 1px var(--sand-200)', overflow: 'hidden', transformOrigin: 'top right',
          animation: 'yc-pop 240ms var(--ease-out) both', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 88px)',
        }}>
          <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 20px 12px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em' }}>{t('yc.notif.title')}</span>
              {count > 0 && <span style={{ height: 22, padding: '0 9px', borderRadius: 99, background: 'var(--red-50)', color: 'var(--red-700)', fontSize: 12.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{t('yc.notif.toSee', { n: count })}</span>}
            </span>
            <Hv
              as="button"
              type="button"
              disabled={!un.length}
              onClick={() => un.length && mark.mutate({ ids: un.map((i) => i.id), action: 'read' })}
              style={{ border: 0, background: 'none', padding: '6px 8px', margin: '-6px -8px', borderRadius: 10, fontSize: 13.5, fontWeight: 600, color: un.length ? 'var(--ink)' : 'var(--sand-300)', cursor: un.length ? 'pointer' : 'default' }}
              hover={{ background: 'var(--sand-50)' }}
            >
              {t('yc.notif.readAll')}
            </Hv>
          </div>
          {need.length > 0 && (
            <Hv
              as={Link}
              to={`${CRM_ROUTES.notifications}#a-traiter`}
              onClick={() => setOpen(false)}
              style={{ flex: 'none', margin: '0 12px 8px', padding: '10px 12px', borderRadius: 14, background: 'var(--red-50)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 600, color: 'var(--red-700)', textDecoration: 'none' }}
              hover={{ background: 'var(--red-100)', color: 'var(--red-700)', textDecoration: 'none' }}
            >
              <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--red-500)' }} />
              <span style={{ flex: 1 }}>{tp('yc.notif.need', need.length)}</span>
              <Icon name="arrowRight" size={15} stroke={2.4} />
            </Hv>
          )}
          <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '4px 8px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {rows.map((i, k) => {
              const c = notifCopy(i, t, T);
              const tone = NOTIF_TONE_COLORS[i.tone] ?? NOTIF_TONE_COLORS.info;
              return (
                <Hv
                  key={i.id}
                  as={Link}
                  to={`${CRM_ROUTES.notifications}#${i.id}`}
                  onClick={() => { if (!i.read) mark.mutate({ ids: [i.id], action: 'read' }); setOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 12px', borderRadius: 14,
                    background: i.read ? 'transparent' : 'rgba(255,242,241,.6)', color: 'var(--ink)', textDecoration: 'none',
                    animation: `yc-rise 360ms var(--ease-out) ${k * 45}ms backwards`,
                  }}
                  hover={{ background: 'var(--sand-50)', color: 'var(--ink)', textDecoration: 'none' }}
                >
                  <span style={{ flex: 'none', width: 36, height: 36, borderRadius: 11, background: tone[0], color: tone[1], display: 'grid', placeItems: 'center' }}>
                    <Icon name={NOTIF_ICON[i.kind] ?? 'bell'} size={17} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 14.5, lineHeight: '19px', fontWeight: i.read ? 500 : 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</span>
                    <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.body}</span>
                    <span style={{ fontSize: 12.5, lineHeight: '16px', color: 'var(--sand-400)', marginTop: 2 }}>{rel(i.at)}</span>
                  </span>
                  {!i.read && <span style={{ flex: 'none', marginTop: 7, width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)' }} />}
                </Hv>
              );
            })}
            {!rows.length && !need.length && (
              <div style={{ padding: '28px 16px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
                <YunitFace mood="endormi" size={56} />
                <span style={{ fontSize: 15, fontWeight: 600 }}>{t('yc.notif.empty')}</span>
                <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-500)', maxWidth: 260 }}>{t('yc.notif.emptyHint')}</span>
              </div>
            )}
          </div>
          <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px', background: 'var(--sand-50)', borderTop: '1px solid var(--sand-100)' }}>
            <Hv as={Link} to={CRM_ROUTES.notifications} onClick={() => setOpen(false)} style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }} hover={{ color: 'var(--red-600)', textDecoration: 'none' }}>
              {t('yc.notif.seeAll')}<Icon name="arrowRight" size={15} stroke={2.4} />
            </Hv>
            <Hv as={Link} to={CRM_ROUTES.accountSection('notifications')} onClick={() => setOpen(false)} title={t('yc.notif.settings')} aria-label={t('yc.notif.settings')} style={{ width: 32, height: 32, margin: '-4px -8px -4px 0', borderRadius: 99, color: 'var(--sand-500)', display: 'grid', placeItems: 'center', textDecoration: 'none' }} hover={{ background: 'var(--sand-100)', color: 'var(--ink)', textDecoration: 'none' }}>
              <Icon name="sliders" size={17} />
            </Hv>
          </div>
        </div>
      )}
    </div>
  );
}
