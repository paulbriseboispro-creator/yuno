import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutGrid, Users, Building2, Wallet, Layers, Calendar, BarChart2, Settings, X,
  TrendingUp, ShieldCheck,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import {
  T1, T2, T3, RED, INNER_BG, BORDER, F_BORDER,
  PromoButton, PromoCard, DarkInput, FieldLabel,
} from '@/components/promoter/promoter-ui';
import { Building2 as AgencyIcon } from 'lucide-react';

const NAV = [
  { to: '/agency-app',           end: true,  icon: LayoutGrid,  fr: 'Aperçu',      en: 'Overview' },
  { to: '/agency-app/promoters', end: false, icon: Users,       fr: 'Promoteurs',  en: 'Promoters' },
  { to: '/agency-app/groups',    end: false, icon: Layers,      fr: 'Groupes',     en: 'Groups' },
  { to: '/agency-app/clubs',     end: false, icon: Building2,   fr: 'Clubs',       en: 'Clubs' },
  { to: '/agency-app/events',    end: false, icon: Calendar,    fr: 'Événements',  en: 'Events' },
  { to: '/agency-app/stats',     end: false, icon: TrendingUp,  fr: 'Stats',       en: 'Stats' },
  { to: '/agency-app/rules',     end: false, icon: ShieldCheck, fr: 'Règles',      en: 'Rules' },
  { to: '/agency-app/analytics', end: false, icon: BarChart2,   fr: 'Graphiques',  en: 'Charts' },
  { to: '/agency-app/finance',   end: false, icon: Wallet,      fr: 'Finance',     en: 'Finance' },
];

type AgencyShape = NonNullable<ReturnType<typeof useAgency>['agency']>;

function AgencyProfileEditor({
  agency, onClose, onSaved,
}: {
  agency: AgencyShape;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => translate(language, fr, en);
  const [name, setName] = useState(agency.name ?? '');
  const [city, setCity] = useState(agency.city ?? '');
  const [bio, setBio] = useState(agency.bio ?? '');
  const [instagram, setInstagram] = useState(agency.instagram_url ?? '');
  const [whatsapp, setWhatsapp] = useState(agency.whatsapp_number ?? '');
  const [website, setWebsite] = useState(agency.website_url ?? '');
  const [email, setEmail] = useState(agency.contact_email ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { toast.error(tt('Le nom est requis', 'Name is required')); return; }
    setSaving(true);
    const { error } = await (supabase as any).rpc('update_agency_profile', {
      p_agency_id:        agency.id,
      p_name:             name.trim() || null,
      p_city:             city.trim() || null,
      p_bio:              bio.trim() || null,
      p_instagram_url:    instagram.trim() || null,
      p_whatsapp_number:  whatsapp.trim() || null,
      p_website_url:      website.trim() || null,
      p_contact_email:    email.trim() || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(tt('Profil enregistré', 'Profile saved'));
    onSaved();
    onClose();
  };

  return (
    <div style={{ background: 'rgba(0,0,0,0.92)', borderBottom: `1px solid ${F_BORDER}`, padding: '12px 16px' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <PromoCard>
          <div className="flex items-center justify-between mb-3">
            <span style={{ color: T1, fontSize: 13.5, fontWeight: 660 }}>
              {tt("Profil de l'agence", 'Agency profile')}
            </span>
            <button onClick={onClose} style={{ color: T3, cursor: 'pointer', background: 'none', border: 'none' }}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel>{tt('Nom', 'Name')} *</FieldLabel>
              <DarkInput value={name} onChange={setName} placeholder={tt("Nom de l'agence", 'Agency name')} />
            </div>
            <div>
              <FieldLabel>{tt('Ville', 'City')}</FieldLabel>
              <DarkInput value={city} onChange={setCity} placeholder="Paris" />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel>{tt('Bio', 'Bio')}</FieldLabel>
              <DarkInput value={bio} onChange={setBio} placeholder={tt('Courte description…', 'Short description…')} />
            </div>
            <div>
              <FieldLabel>Instagram</FieldLabel>
              <DarkInput value={instagram} onChange={setInstagram} placeholder="https://instagram.com/…" />
            </div>
            <div>
              <FieldLabel>WhatsApp</FieldLabel>
              <DarkInput value={whatsapp} onChange={setWhatsapp} placeholder="+33 6 …" />
            </div>
            <div>
              <FieldLabel>{tt('Site web', 'Website')}</FieldLabel>
              <DarkInput value={website} onChange={setWebsite} placeholder="https://…" />
            </div>
            <div>
              <FieldLabel>{tt('Email de contact', 'Contact email')}</FieldLabel>
              <DarkInput value={email} onChange={setEmail} placeholder="contact@agence.fr" type="email" />
            </div>
          </div>
          <div className="mt-3">
            <PromoButton onClick={handleSave} disabled={saving} full>
              {saving ? tt('Enregistrement…', 'Saving…') : tt('Enregistrer', 'Save')}
            </PromoButton>
          </div>
        </PromoCard>
      </div>
    </div>
  );
}

export default function AgencyAppLayout() {
  const { agency, loading, refetch: agencyRefetch } = useAgency();
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => translate(language, fr, en);
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#000' }}>
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-t-transparent"
          style={{ borderColor: RED, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  if (!agency) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center gap-4 px-6"
        style={{ background: '#000' }}>
        <AgencyIcon className="h-10 w-10" style={{ color: T3 }} />
        <p style={{ color: T1, fontSize: 15, fontWeight: 600 }}>
          {tt('Aucune agence configurée', 'No agency configured')}
        </p>
        <PromoButton onClick={() => navigate('/agency/start')}>
          {tt('Créer mon agence', 'Create my agency')}
        </PromoButton>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: '#000' }}>
      <header
        className="sticky top-0 z-40"
        style={{
          background: 'rgba(0,0,0,0.82)',
          backdropFilter: 'blur(14px)',
          borderBottom: `1px solid ${F_BORDER}`,
        }}
      >
        <div className="mx-auto flex items-center gap-3 px-4" style={{ height: 56, maxWidth: 1040 }}>
          {agency.logo_url ? (
            <img
              src={agency.logo_url}
              alt={agency.name}
              style={{ width: 30, height: 30, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
            />
          ) : (
            <div className="flex items-center justify-center flex-none"
              style={{
                width: 30, height: 30, borderRadius: 8,
                background: 'rgba(232,25,44,0.12)',
                border: '1px solid rgba(232,25,44,0.22)',
              }}>
              <AgencyIcon className="h-4 w-4" style={{ color: RED }} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate" style={{ color: T1, fontSize: 15, fontWeight: 680, letterSpacing: '-0.01em' }}>
              {agency.name}
            </p>
            <p style={{ color: T3, fontSize: 10.5 }}>
              {tt('Agence de promoteurs', 'Promoter agency')}
              {agency.city ? ` · ${agency.city}` : ''}
            </p>
          </div>
          <button
            onClick={() => setProfileOpen(v => !v)}
            title={tt('Modifier le profil', 'Edit profile')}
            style={{
              color: profileOpen ? T1 : T3,
              padding: 6,
              borderRadius: 8,
              background: profileOpen ? INNER_BG : 'transparent',
              border: `1px solid ${profileOpen ? BORDER : 'transparent'}`,
              cursor: 'pointer',
            }}
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
        <nav className="mx-auto flex items-center gap-1 px-3 overflow-x-auto"
          style={{ maxWidth: 1040, paddingBottom: 8 }}>
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className="flex items-center gap-2 flex-none"
              style={({ isActive }) => ({
                padding: '7px 13px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                color: isActive ? T1 : T2,
                background: isActive ? INNER_BG : 'transparent',
                border: `1px solid ${isActive ? BORDER : 'transparent'}`,
                whiteSpace: 'nowrap',
                textDecoration: 'none',
              })}
            >
              <n.icon className="h-4 w-4" />
              {tt(n.fr, n.en)}
            </NavLink>
          ))}
        </nav>
      </header>

      {profileOpen && agency && (
        <AgencyProfileEditor
          agency={agency}
          onClose={() => setProfileOpen(false)}
          onSaved={agencyRefetch}
        />
      )}

      <main className="mx-auto px-4 py-4" style={{ maxWidth: 1040 }}>
        <Outlet />
      </main>
    </div>
  );
}
