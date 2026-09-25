import { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { OutboundLink } from '@/components/OutboundLink';
import { Wordmark } from '@/components/brand/Wordmark';
import { DEFAULT_LINKS_CONFIG, fetchLinksConfig, instagramFor, type LinksConfig } from '@/lib/yunoLinks';

/** Ce qu'il faut savoir d'une soirée pour nommer son bouton. */
export interface LinktreeCtaFacts {
  is_sold_out?: boolean | null;
  is_free?: boolean | null;
  tables_only?: boolean | null;
}

/**
 * Le bouton d'une soirée dit ce qu'on y obtient : une soirée « tables
 * uniquement » ne vend pas de billet, une soirée gratuite se rejoint par la
 * guest list. « Billets » ne reste que pour une entrée payante.
 */
export function linktreeCtaLabel(ev: LinktreeCtaFacts, t: (key: string) => string): string {
  if (ev.is_sold_out) return t('promoterLinktree.soldOut');
  if (ev.tables_only) return t('promoterLinktree.ctaTables');
  if (ev.is_free) return t('promoterLinktree.ctaGuestList');
  return t('promoterLinktree.tickets');
}

/** Hauteur réservée en bas de page pour que la barre ne cache pas le dernier bouton. */
export const POWERED_BAR_SPACE = 'calc(88px + env(safe-area-inset-bottom, 0px))';

/**
 * Barre flottante « Powered by Yuno » des linktrees publics. Un clic ouvre
 * l'Instagram de Yuno qui parle la langue du visiteur (yunoapp.fr pour un
 * visiteur francophone, yunoapp.eu sinon — réglé dans /admin/links).
 */
export function PoweredByYunoBar() {
  const { t, language } = useLanguage();
  const [config, setConfig] = useState<LinksConfig>(DEFAULT_LINKS_CONFIG);

  useEffect(() => {
    let active = true;
    fetchLinksConfig().then((c) => { if (active) setConfig(c); });
    return () => { active = false; };
  }, []);

  return (
    <div
      style={{
        position: 'fixed', left: 0, right: 0, zIndex: 40,
        bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
        display: 'flex', justifyContent: 'center', pointerEvents: 'none',
        padding: '0 16px',
      }}
    >
      <OutboundLink
        href={instagramFor(config, language)}
        aria-label={t('promoterLinktree.followYuno')}
        className="yuno-powered-bar"
        style={{
          pointerEvents: 'auto',
          display: 'inline-flex', alignItems: 'center', gap: 10,
          padding: '11px 18px',
          borderRadius: 999,
          background: 'rgba(10,10,10,0.86)',
          backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 10px 30px rgba(0,0,0,0.55), 0 0 0 1px rgba(232,25,44,0.10)',
          color: '#FFFFFF', textDecoration: 'none',
          transition: 'transform 200ms ease, border-color 200ms ease',
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 600,
            letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)',
            whiteSpace: 'nowrap',
          }}
        >
          Powered by
        </span>
        <Wordmark height={14} alt="Yuno" style={{ display: 'block' }} />
      </OutboundLink>
      <style>{`
        .yuno-powered-bar:hover { transform: translateY(-2px); border-color: rgba(232,25,44,0.45) !important; }
        @media (prefers-reduced-motion: reduce) { .yuno-powered-bar, .yuno-powered-bar:hover { transition: none; transform: none; } }
      `}</style>
    </div>
  );
}
