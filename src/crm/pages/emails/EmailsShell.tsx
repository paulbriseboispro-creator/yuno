/**
 * Haut commun des écrans E-mails (maquettes « Emails » et sœurs) : surtitre,
 * titre, sous-titre, « Nouvelle campagne », puis les onglets (EmailsNav).
 * Le bouton ouvre « Par où commencer ? » : un modèle, une page blanche ou un
 * brouillon.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Modal } from '@/crm/ui/kit';
import { EASE, SPRING } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';

export type EmailsTab = 'home' | 'campaigns' | 'analysis' | 'templates' | 'settings';

const TABS: { k: EmailsTab; to: string; d: string }[] = [
  { k: 'home', to: CRM_ROUTES.emails, d: 'M3 3v16a2 2 0 0 0 2 2h16M18 17V9M13 17V5M8 17v-3' },
  { k: 'campaigns', to: CRM_ROUTES.emailCampaigns, d: 'm22 2-7 20-4-9-9-4ZM22 2 11 13' },
  { k: 'analysis', to: CRM_ROUTES.emailAnalysis, d: 'M12 20V10M18 20V4M6 20v-4' },
  { k: 'templates', to: CRM_ROUTES.emailTemplates, d: 'M3 3h18v18H3zM3 9h18M9 21V9' },
  { k: 'settings', to: CRM_ROUTES.emailSettings, d: 'M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4' },
];

const enter = (d: number) => ({ animation: `yc-rise 800ms ${EASE} ${d}ms both` });

export function EmailsNav({ current, drafts }: { current: EmailsTab; drafts: number }) {
  const { t, n } = useCrmT();
  return (
    <div role="navigation" aria-label={t('yc.em.tabs')} className="yc-noscroll" style={{ display: 'flex', gap: 4, overflowX: 'auto', borderBottom: '1px solid var(--sand-200)' }}>
      {TABS.map((tb) => {
        const on = tb.k === current;
        return (
          <Hv
            key={tb.k}
            as={Link}
            to={tb.to}
            aria-current={on ? 'page' : undefined}
            style={{ position: 'relative', flex: 'none', height: 46, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: on ? 600 : 500, color: on ? 'var(--ink)' : 'var(--sand-500)', textDecoration: 'none', whiteSpace: 'nowrap', transition: 'color 160ms' }}
            hover={{ color: 'var(--ink)', textDecoration: 'none' }}
          >
            <Icon d={tb.d} size={17} stroke={2} />
            {t(`yc.em.tab.${tb.k}`)}
            {tb.k === 'campaigns' && drafts > 0 && (
              <span style={{ minWidth: 20, height: 20, padding: '0 6px', boxSizing: 'border-box', borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-700)', fontSize: 12, fontWeight: 600, display: 'grid', placeItems: 'center' }}>{n(drafts)}</span>
            )}
            <span style={{ position: 'absolute', left: 12, right: 12, bottom: -1, height: 2, borderRadius: 2, background: 'var(--gradient-brand)', opacity: on ? 1 : 0, transform: `scaleX(${on ? 1 : 0.4})`, transition: `opacity 200ms,transform 280ms ${EASE}` }} />
          </Hv>
        );
      })}
    </div>
  );
}

export function EmailsShell({
  tab, title, sub, drafts, children, kicker, hideNew = false,
}: { tab: EmailsTab; title: ReactNode; sub: string; drafts: number; children: ReactNode; kicker?: string; hideNew?: boolean }) {
  const { t } = useCrmT();
  const caps = useCrmCaps();
  const [open, setOpen] = useState(false);
  return (
    <main style={{ flex: 1, width: '100%', maxWidth: 1280, boxSizing: 'border-box', margin: '0 auto', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px) 72px', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)', ...enter(100) }}>{kicker ?? t('yc.em.kick')}</span>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em', ...enter(170) }}>{title}</h1>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--sand-600)', textWrap: 'pretty', maxWidth: 640, ...enter(240) }}>{sub}</p>
          </div>
          {!hideNew && caps.write && <div style={enter(300)}>
            <Hv
              as="button"
              type="button"
              onClick={() => setOpen(true)}
              style={{ height: 46, padding: '0 6px 0 20px', borderRadius: 99, border: 0, background: 'var(--gradient-brand)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, boxShadow: 'var(--shadow-cta)', cursor: 'pointer', whiteSpace: 'nowrap', transition: `transform 200ms ${SPRING},filter 160ms` }}
              hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }}
              active={{ transform: 'scale(.97)' }}
            >
              {t('yc.em.new')}
              <span style={{ width: 34, height: 34, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon name="plus" size={16} stroke={2.6} /></span>
            </Hv>
          </div>}
        </div>
        <div style={enter(340)}><EmailsNav current={tab} drafts={drafts} /></div>
      </div>
      {children}
      <NewCampaignModal open={open} onClose={() => setOpen(false)} />
    </main>
  );
}

export function NewCampaignModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useCrmT();
  const opts = [
    { k: 'tpl', to: CRM_ROUTES.emailTemplates, d: 'M3 3h18v18H3zM3 9h18M9 21V9', reco: true },
    { k: 'blank', to: `${CRM_ROUTES.emailStudio('new')}?new=vide`, d: 'M12 5v14M5 12h14', reco: false },
    { k: 'draft', to: `${CRM_ROUTES.emailCampaigns}?s=draft`, d: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z', reco: false },
  ];
  return (
    <Modal open={open} onClose={onClose} width={760} label={t('yc.em.newm.t')}>
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em' }}>{t('yc.em.newm.t')}</h2>
            <div style={{ fontSize: 14.5, color: 'var(--sand-500)', marginTop: 4 }}>{t('yc.em.newm.s')}</div>
          </div>
          <Hv as="button" type="button" onClick={onClose} aria-label={t('yc.em.close')} style={{ flex: 'none', width: 36, height: 36, border: 0, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-200)' }}>
            <Icon name="x" size={16} stroke={2.4} />
          </Hv>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))', gap: 12 }}>
          {opts.map((o) => (
            <Hv
              key={o.k}
              as={Link}
              to={o.to}
              onClick={onClose}
              style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, padding: 20, borderRadius: 20, border: `1.5px solid ${o.reco ? 'var(--red-200)' : 'var(--sand-200)'}`, background: o.reco ? 'var(--red-50)' : '#fff', color: 'var(--ink)', textDecoration: 'none', transition: `translate 220ms ${EASE},box-shadow 220ms,border-color 200ms` }}
              hover={{ translate: '0 -3px', boxShadow: 'var(--shadow-md)', borderColor: 'var(--sand-400)', color: 'var(--ink)', textDecoration: 'none' }}
            >
              {o.reco && <span style={{ position: 'absolute', top: 14, right: 14, height: 22, padding: '0 9px', borderRadius: 99, background: 'var(--red-500)', color: '#fff', fontSize: 11.5, fontWeight: 600, display: 'flex', alignItems: 'center' }}>{t('yc.em.newm.reco')}</span>}
              <span style={{ width: 44, height: 44, borderRadius: 14, background: o.reco ? '#fff' : 'var(--sand-100)', color: o.reco ? 'var(--red-600)' : 'var(--sand-700)', display: 'grid', placeItems: 'center' }}><Icon d={o.d} size={22} stroke={2} /></span>
              <b style={{ fontSize: 16.5, letterSpacing: '-.01em' }}>{t(`yc.em.newm.${o.k}.t`)}</b>
              <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t(`yc.em.newm.${o.k}.s`)}</span>
            </Hv>
          ))}
        </div>
      </div>
    </Modal>
  );
}
