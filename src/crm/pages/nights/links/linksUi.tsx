/**
 * Pièces de l'onglet « Liens » d'une soirée : pastille de réseau, mini-courbe
 * des clics, barre des sources Shotgun, fenêtre QR, cartes « Bientôt ».
 */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Icon, type IconName } from '@/crm/ui/Icon';
import { Modal, PillButton, Skel } from '@/crm/ui/kit';
import { EASE } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import type { LinkPlacement, LinkPlatform, SourceKind } from '@/crm/lib/links';

export const PLATFORM_LOOK: Record<LinkPlatform, { bg: string; fg: string; icon: IconName }> = {
  instagram: { bg: 'linear-gradient(135deg,#FEDA75 0%,#FA7E1E 28%,#D62976 58%,#962FBF 82%,#4F5BD5 100%)', fg: '#fff', icon: 'instagram' },
  tiktok: { bg: '#111', fg: '#fff', icon: 'tiktok' },
  whatsapp: { bg: '#25D366', fg: '#fff', icon: 'whatsapp' },
  facebook: { bg: '#1877F2', fg: '#fff', icon: 'facebook' },
  snapchat: { bg: '#FFFC00', fg: '#111', icon: 'snapchat' },
  other: { bg: 'var(--sand-100)', fg: 'var(--sand-700)', icon: 'link' },
};

export const PLACEMENT_ICON: Record<LinkPlacement, IconName> = {
  story: 'story', bio: 'user', post: 'grid', reel: 'play', dm: 'send', video: 'play', group: 'users',
  message: 'message', event: 'calendar', flyer: 'qr', partner: 'users', link: 'link',
};

export function PlatformBadge({ platform, placement, size = 40 }: { platform: LinkPlatform; placement?: LinkPlacement; size?: number }) {
  const look = PLATFORM_LOOK[platform] ?? PLATFORM_LOOK.other;
  const icon = (platform === 'other' || !PLATFORM_LOOK[platform]) && placement && PLACEMENT_ICON[placement] ? PLACEMENT_ICON[placement] : look.icon;
  return (
    <span style={{ position: 'relative', flex: 'none', width: size, height: size, borderRadius: size * 0.32, background: look.bg, color: look.fg, display: 'grid', placeItems: 'center', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.04)' }}>
      <Icon name={icon} size={Math.round(size * 0.48)} stroke={2.2} />
      {placement && PLACEMENT_ICON[placement] && platform !== 'other' && PLATFORM_LOOK[platform] && (
        <span style={{ position: 'absolute', right: -5, bottom: -5, width: size * 0.5, height: size * 0.5, borderRadius: 99, background: '#fff', color: 'var(--ink)', display: 'grid', placeItems: 'center', boxShadow: '0 0 0 2px #fff, var(--shadow-xs)' }}>
          <Icon name={PLACEMENT_ICON[placement]} size={Math.round(size * 0.28)} stroke={2.6} />
        </span>
      )}
    </span>
  );
}

/** Clics des 14 derniers jours (barres fines, la dernière en rouge). */
export function Spark({ values, width = 96, height = 28 }: { values: number[]; width?: number; height?: number }) {
  const max = Math.max(1, ...values);
  const w = width / Math.max(1, values.length);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden style={{ display: 'block', flex: 'none' }}>
      {values.map((v, i) => {
        const h = v === 0 ? 2 : Math.max(3, (v / max) * height);
        return <rect key={i} x={i * w + 1} y={height - h} width={Math.max(2, w - 2)} height={h} rx={1.5} fill={i === values.length - 1 ? 'var(--red-500)' : v === 0 ? 'var(--sand-200)' : 'var(--sand-400)'} />;
      })}
    </svg>
  );
}

export const SOURCE_COLOR: Record<SourceKind, string> = {
  link: 'var(--red-500)',
  email: 'var(--tangerine-500)',
  sms: 'var(--amber-500)',
  dm: '#D62976',
  social: '#962FBF',
  shotgun: 'var(--ink)',
  site: 'var(--sand-500)',
  direct: 'var(--sand-400)',
  offline: 'var(--sand-200)',
};

/** QR d'un lien, téléchargeable (flyer, affiche, comptoir). */
export function QrModal({ open, onClose, url, label, display }: { open: boolean; onClose: () => void; url: string; label: string; display: string }) {
  const { t } = useCrmT();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let off = false;
    void QRCode.toDataURL(`${url}`, { margin: 1, width: 720, color: { dark: '#141012', light: '#ffffff' } }).then((x) => { if (!off) setSrc(x); });
    return () => { off = true; };
  }, [open, url]);
  const file = `qr-${label.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'lien'}.png`;
  return (
    <Modal open={open} onClose={onClose} width={420} label={t('yc.lk.qr.t')}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 28 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.lk.qr.k')}</span>
        <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.02em', textAlign: 'center' }}>{label}</b>
        {src ? <img src={src} alt={display} style={{ width: 280, height: 280, borderRadius: 20, boxShadow: 'inset 0 0 0 1px var(--sand-200)', animation: `yc-pop 320ms ${EASE} both` }} /> : <Skel w={280} h={280} r={20} />}
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--sand-600)' }}>{display}</span>
        <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)', textAlign: 'center', maxWidth: 320 }}>{t('yc.lk.qr.s')}</span>
        <div style={{ display: 'flex', gap: 10 }}>
          {src && (
            <PillButton tone="dark" icon="download" onClick={() => {
              const a = document.createElement('a');
              a.href = src; a.download = file; document.body.appendChild(a); a.click(); a.remove();
            }}>
              {t('yc.lk.qr.dl')}
            </PillButton>
          )}
          <PillButton onClick={onClose}>{t('yc.lk.close')}</PillButton>
        </div>
      </div>
    </Modal>
  );
}

/** Une mesure que seule l'intégration partenaire Shotgun ouvrira. */
export function SoonTile({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  const { t } = useCrmT();
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 16px 18px', borderRadius: 18, background: 'repeating-linear-gradient(135deg,var(--sand-50) 0 10px,#fff 10px 20px)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ width: 34, height: 34, borderRadius: 12, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', color: 'var(--sand-600)', display: 'grid', placeItems: 'center' }}>
          <Icon name={icon} size={16} stroke={2.2} />
        </span>
        <span style={{ height: 24, padding: '0 10px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 11.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="lock" size={11} stroke={2.6} />{t('yc.lk.soon.badge')}
        </span>
      </div>
      <b style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.3 }}>{title}</b>
      <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{body}</span>
    </div>
  );
}
