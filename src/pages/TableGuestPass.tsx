/**
 * TableGuestPass — /t/:qr
 *
 * Le QR d'UN invité d'une table VIP, partagé par le titulaire (lien WhatsApp, feuille de partage). Sans compte : le QR
 * de l'URL est la clé (RPC get_table_guest_pass). La page n'affiche que ce QR, la soirée, l'heure, la formule et l'état :
 * rien sur l'acheteur, ni prix, ni autre invité.
 *
 * DA publique (docs/DESIGN_SYSTEM_PUBLIC.md) : fond noir, titres Space Grotesk en capitales, métadonnées en mono. Aucune
 * étape d'accueil (`/t/` est dans linktreePaths) : la page parle la langue du téléphone.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { formatInTimeZone } from 'date-fns-tz';
import { enUS, fr, es } from 'date-fns/locale';
import { CheckCircle2, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Wordmark } from '@/components/brand/Wordmark';
import { Seo } from '@/components/Seo';
import { fetchTableGuestPass, type TableGuestPass } from '@/lib/tableReceipt';

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const GROTESK = "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif";
const RED = '#E8192C';

const mono = (size = 10, color = '#9A9A9A'): React.CSSProperties => ({
  fontFamily: MONO, fontSize: size, letterSpacing: '0.14em', textTransform: 'uppercase', color,
});

export default function TableGuestPass() {
  const { qr } = useParams<{ qr: string }>();
  const { t, language } = useLanguage();
  const [pass, setPass] = useState<TableGuestPass | null>(null);
  const [image, setImage] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!qr) { setLoading(false); return; }
      const res = await fetchTableGuestPass(supabase as unknown as Parameters<typeof fetchTableGuestPass>[0], qr);
      if (cancelled) return;
      setPass(res);
      if (res) {
        const img = await QRCode.toDataURL(res.qr_code, { width: 480, margin: 2, color: { dark: '#000000', light: '#ffffff' } }).catch(() => '');
        if (!cancelled) setImage(img);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [qr]);

  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const tz = pass?.event.timezone || 'Europe/Paris';
  const start = pass?.event.start_at ? new Date(pass.event.start_at) : null;
  const dayLabel = start ? formatInTimeZone(start, tz, 'EEEE d MMMM', { locale }) : null;
  const timeLabel = start ? formatInTimeZone(start, tz, 'HH:mm') : null;

  const shell = (children: React.ReactNode) => (
    <div className="min-h-[100dvh] flex flex-col items-center" style={{ background: '#0A0A0A', color: '#fff', padding: 'calc(env(safe-area-inset-top) + 28px) 20px calc(env(safe-area-inset-bottom) + 32px)' }}>
      <Seo title="Yuno" noindex />
      <Wordmark height={22} />
      <div className="w-full" style={{ maxWidth: 420, marginTop: 28 }}>{children}</div>
    </div>
  );

  if (loading) {
    return shell(<div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-white/30 border-t-white" /></div>);
  }

  if (!pass) {
    return shell(
      <div className="text-center" style={{ paddingTop: 48 }}>
        <h1 style={{ fontFamily: GROTESK, fontWeight: 700, fontSize: 26, textTransform: 'uppercase', letterSpacing: '-0.02em' }}>{t('tblc.pass.notFoundTitle')}</h1>
        <p style={{ marginTop: 12, fontSize: 14, lineHeight: 1.5, color: '#9A9A9A' }}>{t('tblc.pass.notFoundBody')}</p>
      </div>,
    );
  }

  const used = pass.entry_scanned;
  const valid = pass.scannable && !used;
  const stateLabel = used ? t('tblc.pass.used') : valid ? t('tblc.pass.valid') : t('tblc.pass.notValid');

  return shell(
    <div className="text-center">
      <p style={mono(10.5, RED)}>{pass.is_holder ? t('tblc.pass.holder') : t('tblc.pass.guest').replace('{n}', String(pass.guest_number))}</p>
      <h1 style={{ fontFamily: GROTESK, fontWeight: 700, fontSize: 'clamp(28px, 8vw, 40px)', lineHeight: 0.95, letterSpacing: '-0.025em', textTransform: 'uppercase', marginTop: 10 }}>
        {pass.event.title}
      </h1>
      {(dayLabel || pass.event.city) && (
        <p style={{ ...mono(11), marginTop: 12 }}>
          {[dayLabel && timeLabel ? `${dayLabel} · ${timeLabel}` : dayLabel, pass.event.city].filter(Boolean).join('  —  ')}
        </p>
      )}
      {pass.pack_name && <p style={{ ...mono(10.5, '#E5E5E5'), marginTop: 8 }}>{pass.pack_name}</p>}

      <div className="mx-auto" style={{ marginTop: 26, background: '#fff', padding: 16, borderRadius: 12, width: 'fit-content', opacity: valid ? 1 : 0.45 }}>
        {image ? <img src={image} alt={t('tblc.pass.qrAlt')} style={{ width: 240, height: 240, display: 'block' }} /> : <div style={{ width: 240, height: 240 }} />}
      </div>

      <div className="inline-flex items-center gap-1.5" style={{ ...mono(10.5, valid ? '#34D399' : '#F87171'), marginTop: 18 }}>
        {valid ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
        {stateLabel}
      </div>
      <p style={{ marginTop: 14, fontSize: 13, lineHeight: 1.5, color: '#9A9A9A' }}>{t('tblc.pass.hint')}</p>
      <p style={{ ...mono(10), marginTop: 14, letterSpacing: '0.18em' }}>{pass.qr_code.slice(-8)}</p>
    </div>,
  );
}
