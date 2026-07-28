import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { Building2 } from 'lucide-react';
import {
  T1, T3, RED, F_BORDER,
  PromoButton, PromoCard, DarkInput, FieldLabel,
} from '@/components/promoter/promoter-ui';

/**
 * Profil de l'agence — l'identité maître. Les champs partagés (nom, ville,
 * bio, réseaux) sont synchronisés vers le bras externe (ligne `affiliates`)
 * par trigger : le linktree public reste en phase automatiquement.
 */
export default function AgencyProfile() {
  const { agency, loading, refetch } = useAgency();
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => translate(language, fr, en);

  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [bio, setBio] = useState('');
  const [instagram, setInstagram] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [website, setWebsite] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!agency) return;
    setName(agency.name ?? '');
    setCity(agency.city ?? '');
    setBio(agency.bio ?? '');
    setInstagram(agency.instagram_url ?? '');
    setWhatsapp(agency.whatsapp_number ?? '');
    setWebsite(agency.website_url ?? '');
    setEmail(agency.contact_email ?? '');
  }, [agency?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!agency) return;
    if (!name.trim()) { toast.error(tt('Le nom est requis', 'Name is required')); return; }
    setSaving(true);
    const { error } = await supabase.rpc('update_agency_profile', {
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
    refetch();
  };

  if (loading || !agency) return null;

  return (
    <div className="py-4 space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center flex-none"
          style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.22)' }}>
          <Building2 className="h-4.5 w-4.5" style={{ color: RED }} />
        </div>
        <div>
          <h1 style={{ color: T1, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {tt("Profil de l'agence", 'Agency profile')}
          </h1>
          <p style={{ color: T3, fontSize: 12 }}>
            {tt('Votre identité maître — le linktree public suit automatiquement.',
                'Your master identity — the public linktree follows automatically.')}
          </p>
        </div>
      </div>

      <PromoCard>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel>{tt('Nom', 'Name')} *</FieldLabel>
            <DarkInput value={name} onChange={setName} placeholder={tt("Nom de l'agence", 'Agency name')} />
          </div>
          <div>
            <FieldLabel>{tt('Ville', 'City')}</FieldLabel>
            <DarkInput value={city} onChange={setCity} placeholder="Madrid" />
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
            <DarkInput value={whatsapp} onChange={setWhatsapp} placeholder="+34 6 …" />
          </div>
          <div>
            <FieldLabel>{tt('Site web', 'Website')}</FieldLabel>
            <DarkInput value={website} onChange={setWebsite} placeholder="https://…" />
          </div>
          <div>
            <FieldLabel>{tt('Email de contact', 'Contact email')}</FieldLabel>
            <DarkInput value={email} onChange={setEmail} placeholder="contact@agence.es" type="email" />
          </div>
        </div>
        <div className="mt-4" style={{ borderTop: `1px solid ${F_BORDER}`, paddingTop: 14 }}>
          <PromoButton onClick={handleSave} disabled={saving} full>
            {saving ? tt('Enregistrement…', 'Saving…') : tt('Enregistrer', 'Save')}
          </PromoButton>
        </div>
      </PromoCard>
    </div>
  );
}
