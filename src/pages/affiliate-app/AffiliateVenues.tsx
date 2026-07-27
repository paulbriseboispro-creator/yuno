import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Plus, Pencil, ToggleLeft, ToggleRight, Globe, MapPin, FileBarChart, Rocket } from 'lucide-react';
import { Instagram } from '@/components/icons/Instagram';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  AffPage, AffHeading, AffCard, Pill, AffLinkButton, AffSpinner, AffEmpty,
  RED, POS, T1, T2, T3, BORDER, C_FAINT, TILE_BG, F_BORDER,
} from '@/components/affiliate/affiliate-ui';

type VenueRow = {
  id: string;
  name: string;
  city: string | null;
  neighborhood: string | null;
  genres: string[];
  instagram: string | null;
  website: string | null;
  is_active: boolean;
  logo_url: string | null;
};

export default function AffiliateVenues() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [affiliateId, setAffiliateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) fetchVenues();
  }, [user]);

  const fetchVenues = async () => {
    if (!user) return;
    setLoading(true);
    const { data: aff } = await supabase.from('affiliates').select('id').eq('user_id', user.id).single();
    if (!aff) { setLoading(false); return; }
    setAffiliateId(aff.id);

    const { data } = await supabase
      .from('affiliate_venues')
      .select('id, name, city, neighborhood, genres, instagram, website, is_active, logo_url')
      .eq('affiliate_id', aff.id)
      .order('sort_order', { ascending: true });

    setVenues(data ?? []);
    setLoading(false);
  };

  const toggleActive = async (venue: VenueRow) => {
    const { error } = await supabase
      .from('affiliate_venues')
      .update({ is_active: !venue.is_active })
      .eq('id', venue.id);

    if (error) {
      toast({ title: t('aff.venues.errorTitle'), description: error.message, variant: 'destructive' });
      return;
    }
    setVenues((prev) => prev.map((v) => v.id === venue.id ? { ...v, is_active: !venue.is_active } : v));
  };

  // Rapport Club : lien public en lecture seule à envoyer au manager du club.
  // Créé au premier clic, réutilisé ensuite (un token stable par club).
  const copyReportLink = async (venue: VenueRow) => {
    if (!affiliateId) return;
    let token: string | null = null;
    const { data: existing } = await supabase
      .from('affiliate_report_links')
      .select('token')
      .eq('affiliate_venue_id', venue.id)
      .maybeSingle();
    if (existing) {
      token = existing.token;
    } else {
      const { data: created, error } = await supabase
        .from('affiliate_report_links')
        .insert({ affiliate_id: affiliateId, affiliate_venue_id: venue.id })
        .select('token')
        .single();
      if (error || !created) {
        toast({ title: t('aff.venues.errorTitle'), description: error?.message, variant: 'destructive' });
        return;
      }
      token = created.token;
    }
    navigator.clipboard.writeText(`${window.location.origin}/r/${token}`);
    toast({ title: t('aff.venues.reportCopied'), description: t('aff.venues.reportCopiedDesc') });
  };

  // Le flywheel : signaler au super admin que ce club est prêt pour la vente in-app.
  const sendYunoLead = async (venue: VenueRow) => {
    const { data, error } = await supabase.rpc('request_club_yuno_lead', { p_affiliate_venue_id: venue.id });
    const res = data as { ok?: boolean } | null;
    if (error || !res?.ok) {
      toast({ title: t('aff.venues.errorTitle'), description: error?.message, variant: 'destructive' });
      return;
    }
    toast({ title: t('aff.venues.yunoLeadSent'), description: t('aff.venues.yunoLeadSentDesc') });
  };

  if (loading) return <AffSpinner />;

  return (
    <AffPage>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffHeading
          title={t('aff.venues.title')}
          subtitle={(venues.length > 1 ? t('aff.venues.subtitleMany') : t('aff.venues.subtitleOne')).replace('{count}', String(venues.length))}
          right={
            <AffLinkButton to="/affiliate/venues/new" size="sm">
              <Plus className="h-4 w-4" /> {t('aff.venues.newClub')}
            </AffLinkButton>
          }
        />
      </motion.div>

      {venues.length === 0 ? (
        <AffEmpty
          icon={MapPin}
          title={t('aff.venues.emptyTitle')}
          description={t('aff.venues.emptyDesc')}
          action={<AffLinkButton to="/affiliate/venues/new" size="sm"><Plus className="h-4 w-4" /> {t('aff.venues.addClub')}</AffLinkButton>}
        />
      ) : (
        <div className="grid gap-3">
          {venues.map((venue, i) => (
            <motion.div key={venue.id}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 + i * 0.03 }}>
              <AffCard padding={14}>
                <div className="flex items-center gap-4">
                  {venue.logo_url ? (
                    <img src={venue.logo_url} alt={venue.name} className="w-16 h-16 rounded-xl object-cover flex-none" style={{ border: `1px solid ${BORDER}`, background: C_FAINT }} />
                  ) : (
                    <div className="w-16 h-16 rounded-xl flex-none flex items-center justify-center" style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
                      <MapPin className="h-5 w-5" style={{ color: T3 }} />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="truncate" style={{ color: T1, fontSize: 14.5, fontWeight: 600 }}>{venue.name}</h3>
                      {!venue.is_active && <Pill tone="muted">{t('aff.venues.inactive')}</Pill>}
                    </div>
                    <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>
                      {[venue.neighborhood, venue.city].filter(Boolean).join(', ') || '—'}
                    </p>
                    {venue.genres.length > 0 && (
                      <div className="flex gap-1.5 mt-2 flex-wrap">
                        {venue.genres.slice(0, 4).map((g) => (
                          <span key={g} style={{ fontSize: 10.5, color: T2, background: TILE_BG, border: `1px solid ${F_BORDER}`, padding: '2px 8px', borderRadius: 999 }}>{g}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 flex-none">
                    <button onClick={() => copyReportLink(venue)} className="p-2 transition-colors cursor-pointer"
                      title={t('aff.venues.reportLink')} style={{ color: T3 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = T1)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                      <FileBarChart className="h-4 w-4" />
                    </button>
                    <button onClick={() => sendYunoLead(venue)} className="p-2 transition-colors cursor-pointer"
                      title={t('aff.venues.yunoLead')} style={{ color: T3 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = RED)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                      <Rocket className="h-4 w-4" />
                    </button>
                    {venue.instagram && (
                      <a href={`https://instagram.com/${venue.instagram.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
                        className="p-2 transition-colors" style={{ color: T3 }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = T1)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                        <Instagram className="h-4 w-4" />
                      </a>
                    )}
                    {venue.website && (
                      <a href={venue.website} target="_blank" rel="noopener noreferrer"
                        className="p-2 transition-colors" style={{ color: T3 }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = T1)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                        <Globe className="h-4 w-4" />
                      </a>
                    )}
                    <button onClick={() => toggleActive(venue)} className="p-2 transition-colors" title={venue.is_active ? t('aff.venues.deactivate') : t('aff.venues.activate')}>
                      {venue.is_active
                        ? <ToggleRight className="h-5 w-5" style={{ color: POS }} />
                        : <ToggleLeft className="h-5 w-5" style={{ color: T3 }} />}
                    </button>
                    <Link to={`/affiliate/venues/${venue.id}/edit`}
                      className="p-2 transition-colors" style={{ color: T3 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = RED)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                      <Pencil className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </AffCard>
            </motion.div>
          ))}
        </div>
      )}
    </AffPage>
  );
}
