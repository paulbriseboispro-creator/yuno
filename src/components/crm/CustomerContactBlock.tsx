import { useState } from 'react';
import { Mail, Phone, Copy, Check } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

// Coordonnées d'un client, dans la fiche du CRM club ET du CRM organisateur.
// La fiche affichait email et téléphone en gris pâle, non cliquables, et
// masquait purement la ligne téléphone quand le numéro manquait : impossible de
// savoir si le client n'a pas laissé de numéro ou si l'app ne le montrait pas.
// Ici tout est visible, copiable, et appelable en un geste — c'est ce dont un
// club a besoin quand il rappelle un client pour sa table.
const T1       = 'rgba(255,255,255,0.96)';
const T3       = 'rgba(255,255,255,0.36)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const INNER_BG = 'rgba(255,255,255,0.032)';

interface Props { email: string; phone?: string | null }

export function CustomerContactBlock({ email, phone }: Props) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState<string | null>(null);
  const cleanPhone = (phone || '').trim() || null;

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1600);
    } catch { /* presse-papiers refusé (WebView sans permission) : le lien reste utilisable */ }
  };

  const Row = ({ icon, value, href, k }: { icon: React.ReactNode; value: string; href: string; k: string }) => (
    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
      <span className="shrink-0" style={{ color: T3 }}>{icon}</span>
      <a href={href} className="flex-1 truncate" style={{ color: T1, fontSize: 13 }}>{value}</a>
      <button onClick={() => copy(value, k)} title={t('customers.copy')}
        className="shrink-0 p-1 rounded-lg cursor-pointer" style={{ color: copied === k ? '#34D399' : T3 }}>
        {copied === k ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );

  return (
    <div className="space-y-2">
      <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
        {t('customers.contact')}
      </p>
      <Row icon={<Mail className="w-3.5 h-3.5" />} value={email} href={`mailto:${email}`} k="email" />
      {cleanPhone ? (
        <Row icon={<Phone className="w-3.5 h-3.5" />} value={cleanPhone} href={`tel:${cleanPhone.replace(/[^\d+]/g, '')}`} k="phone" />
      ) : (
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
          <Phone className="w-3.5 h-3.5 shrink-0" style={{ color: T3 }} />
          <span style={{ color: T3, fontSize: 13 }}>{t('customers.noPhone')}</span>
        </div>
      )}
    </div>
  );
}
