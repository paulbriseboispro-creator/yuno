import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useAffiliateShell } from '@/contexts/AffiliateShellContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import {
  Store, Globe, Link2, ExternalLink, MapPin, CalendarDays, CheckCircle2,
  Circle, Sparkles, Building2, QrCode, Settings, ChevronRight, CalendarRange,
} from 'lucide-react';
import {
  T1, T2, T3, RED, POS, BORDER, C_FAINT, INNER_BG,
  PromoCard, PromoButton, PromoPill, SectionLabel, CopyField,
} from '@/components/promoter/promoter-ui';

/**
 * « Ma vitrine » — le hub de la présence publique de l'agence.
 * Répartition claire : ICI on voit et partage les deux pages publiques et on
 * mesure si la vitrine est complète ; l'identité s'édite dans Profil de
 * l'agence ; l'adresse/tri/QR dans Linktree & externe ; le catalogue dans
 * Clubs externes / Soirées externes. Chaque carte pointe vers le bon éditeur.
 */
export default function AgencyShowcase() {
  const { agency } = useAgency();
  const shell = useAffiliateShell();
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const navigate = useNavigate();

  const [arm, setArm] = useState<{ linktree_slug: string | null; trust_stats: unknown[] } | null>(null);
  const [counts, setCounts] = useState<{ venues: number; extEvents: number; contracts: number } | null>(null);

  useEffect(() => {
    const affiliateId = shell?.affiliateId;
    if (!affiliateId || !agency) return;
    let active = true;
    (async () => {
      const today = new Date().toISOString().split('T')[0];
      const [aff, ven, ev, ctr] = await Promise.all([
        supabase.from('affiliates').select('linktree_slug, trust_stats').eq('id', affiliateId).maybeSingle(),
        supabase.from('affiliate_venues').select('id', { count: 'exact', head: true })
          .eq('affiliate_id', affiliateId).eq('is_active', true),
        supabase.from('affiliate_events').select('id', { count: 'exact', head: true })
          .eq('affiliate_id', affiliateId).in('status', ['published', 'featured']).gte('event_date', today),
        (supabase as any).from('agency_venue_contracts').select('id', { count: 'exact', head: true })
          .eq('agency_id', agency.id).eq('status', 'active'),
      ]);
      if (!active) return;
      setArm({
        linktree_slug: aff.data?.linktree_slug ?? null,
        trust_stats: Array.isArray(aff.data?.trust_stats) ? (aff.data!.trust_stats as unknown[]) : [],
      });
      setCounts({ venues: ven.count ?? 0, extEvents: ev.count ?? 0, contracts: ctr.count ?? 0 });
    })();
    return () => { active = false; };
  }, [shell?.affiliateId, agency?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const slug = arm?.linktree_slug ?? null;
  const origin = window.location.origin;

  // Check-list de complétude : chaque item pointe vers l'éditeur qui le règle.
  const checklist = useMemo(() => {
    if (!agency || !arm || !counts) return [];
    return [
      {
        done: !!slug,
        label: tt('Choisir votre adresse publique (slug)', 'Choose your public address (slug)', 'Elegir tu dirección pública (slug)'),
        to: '/affiliate/settings',
      },
      {
        done: !!agency.logo_url,
        label: tt('Ajouter votre logo', 'Add your logo', 'Añadir tu logo'),
        to: '/agency-app/profile',
      },
      {
        done: !!agency.bio?.trim(),
        label: tt('Écrire une bio', 'Write a bio', 'Escribir una bio'),
        to: '/agency-app/profile',
      },
      {
        done: !!agency.city?.trim(),
        label: tt('Renseigner votre ville', 'Set your city', 'Indicar tu ciudad'),
        to: '/agency-app/profile',
      },
      {
        done: !!(agency.instagram_url || agency.tiktok_url || agency.website_url),
        label: tt('Relier au moins un réseau (Instagram, TikTok, site)', 'Link at least one social (Instagram, TikTok, website)', 'Vincular al menos una red (Instagram, TikTok, web)'),
        to: '/agency-app/profile',
      },
      {
        done: counts.venues > 0 || counts.contracts > 0,
        label: tt('Ajouter un club (externe ou contrat Yuno)', 'Add a club (external or Yuno contract)', 'Añadir un club (externo o contrato Yuno)'),
        to: counts.contracts > 0 ? '/agency-app/clubs' : '/affiliate/venues',
      },
      {
        done: counts.extEvents > 0,
        label: tt('Publier une soirée externe à venir', 'Publish an upcoming external event', 'Publicar una próxima fiesta externa'),
        to: '/affiliate/events',
      },
      {
        done: (arm.trust_stats?.length ?? 0) > 0,
        label: tt('Ajouter des stats de confiance (linktree)', 'Add trust stats (linktree)', 'Añadir estadísticas de confianza (linktree)'),
        to: '/affiliate/settings',
      },
    ];
  }, [agency, arm, counts, language]); // eslint-disable-line react-hooks/exhaustive-deps

  const doneCount = checklist.filter(c => c.done).length;

  if (!agency) return null;

  return (
    <div className="py-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center flex-none"
          style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.22)' }}>
          <Store className="h-4.5 w-4.5" style={{ color: RED }} />
        </div>
        <div>
          <h1 style={{ color: T1, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {tt('Ma vitrine publique', 'My public showcase', 'Mi vitrina pública')}
          </h1>
          <p style={{ color: T3, fontSize: 12 }}>
            {tt('Vos deux pages publiques, leur complétude, et où éditer quoi.',
                'Your two public pages, how complete they are, and where to edit what.',
                'Tus dos páginas públicas, su nivel de completitud y dónde editar cada cosa.')}
          </p>
        </div>
      </div>

      {/* Les deux pages publiques */}
      {slug ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PromoCard>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4" style={{ color: RED }} />
                <p style={{ color: T1, fontSize: 14, fontWeight: 650 }}>{tt('Page RP', 'RP page', 'Página RP')}</p>
              </div>
              <PromoPill tone="red">Yuno</PromoPill>
            </div>
            <p style={{ color: T3, fontSize: 12, lineHeight: 1.55 }}>
              {tt('Votre vitrine marketplace dans Yuno : clubs partenaires, soirées Yuno et externes. Les clients y arrivent depuis les cartes « RP » des fiches soirée.',
                  'Your marketplace showcase inside Yuno: partner clubs, Yuno and external events. Clients reach it from the “RP” cards on event pages.',
                  'Tu vitrina marketplace dentro de Yuno: clubs socios, fiestas Yuno y externas. Los clientes llegan desde las tarjetas «RP» de las fichas de fiesta.')}
            </p>
            <div className="mt-3 space-y-2">
              <CopyField label="URL" value={`${origin}/rp/${slug}`} mono={false} />
              <PromoButton size="sm" variant="secondary" full onClick={() => window.open(`/rp/${slug}`, '_blank')}>
                <ExternalLink className="h-4 w-4" /> {tt('Ouvrir la page', 'Open page', 'Abrir la página')}
              </PromoButton>
            </div>
          </PromoCard>

          <PromoCard>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4" style={{ color: RED }} />
                <p style={{ color: T1, fontSize: 14, fontWeight: 650 }}>Linktree</p>
              </div>
              <PromoPill tone="muted">{tt('Bio / QR', 'Bio / QR', 'Bio / QR')}</PromoPill>
            </div>
            <p style={{ color: T3, fontSize: 12, lineHeight: 1.55 }}>
              {tt('Votre lien unique pour la bio Instagram, les stories et les QR : toutes vos soirées, triées comme vous voulez, avec vos stats de confiance.',
                  'Your single link for Instagram bio, stories and QR codes: all your events, sorted your way, with your trust stats.',
                  'Tu enlace único para la bio de Instagram, stories y códigos QR: todas tus fiestas, ordenadas a tu manera, con tus estadísticas de confianza.')}
            </p>
            <div className="mt-3 space-y-2">
              <CopyField label="URL" value={`${origin}/p/${slug}`} mono={false} />
              <div className="grid grid-cols-2 gap-2">
                <PromoButton size="sm" variant="secondary" onClick={() => window.open(`/p/${slug}`, '_blank')}>
                  <ExternalLink className="h-4 w-4" /> {tt('Ouvrir', 'Open', 'Abrir')}
                </PromoButton>
                <PromoButton size="sm" variant="secondary" onClick={() => window.open(`/p/${slug}/agenda`, '_blank')}>
                  <CalendarRange className="h-4 w-4" /> {tt('Agenda', 'Agenda', 'Agenda')}
                </PromoButton>
              </div>
            </div>
          </PromoCard>
        </div>
      ) : (
        <PromoCard>
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 flex-none mt-0.5" style={{ color: RED }} />
            <div>
              <p style={{ color: T1, fontSize: 14, fontWeight: 650 }}>
                {tt("Choisissez votre adresse publique", 'Choose your public address', 'Elige tu dirección pública')}
              </p>
              <p style={{ color: T3, fontSize: 12.5, marginTop: 4, lineHeight: 1.55 }}>
                {tt('Le « slug » (yunoapp.eu/p/votre-nom) alimente vos deux pages publiques. Il se choisit dans Linktree & externe — une fois posé, tout le reste s\'active.',
                    'The “slug” (yunoapp.eu/p/your-name) powers both public pages. Set it in Linktree & external — once set, everything else lights up.',
                    'El «slug» (yunoapp.eu/p/tu-nombre) alimenta tus dos páginas públicas. Se elige en Linktree y externo: una vez puesto, todo lo demás se activa.')}
              </p>
              <div className="mt-3">
                <PromoButton size="sm" onClick={() => navigate('/affiliate/settings')}>
                  <Settings className="h-4 w-4" /> {tt("Choisir l'adresse", 'Choose address', 'Elegir la dirección')}
                </PromoButton>
              </div>
            </div>
          </div>
        </PromoCard>
      )}

      {/* Check-list de complétude */}
      <SectionLabel
        action={
          <span style={{ color: doneCount === checklist.length && checklist.length > 0 ? POS : T3, fontSize: 12, fontWeight: 700 }}>
            {checklist.length > 0 ? `${doneCount}/${checklist.length}` : ''}
          </span>
        }
      >
        {tt('Votre vitrine est-elle complète ?', 'Is your showcase complete?', '¿Está completa tu vitrina?')}
      </SectionLabel>
      <PromoCard style={{ padding: 8 }}>
        {checklist.map((item, i) => (
          <button
            key={i}
            onClick={() => navigate(item.to)}
            className="flex w-full items-center gap-3 text-left cursor-pointer"
            style={{
              padding: '10px 8px', background: 'none', border: 'none',
              borderBottom: i < checklist.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined,
            }}
          >
            {item.done
              ? <CheckCircle2 className="h-4.5 w-4.5 flex-none" style={{ color: POS }} />
              : <Circle className="h-4.5 w-4.5 flex-none" style={{ color: T3 }} />}
            <span className="flex-1 min-w-0" style={{ color: item.done ? T2 : T1, fontSize: 13, fontWeight: item.done ? 450 : 600 }}>
              {item.label}
            </span>
            {!item.done && <ChevronRight className="h-4 w-4 flex-none" style={{ color: T3 }} />}
          </button>
        ))}
      </PromoCard>

      {/* Répartition : où éditer quoi */}
      <SectionLabel>{tt('Où éditer quoi', 'Where to edit what', 'Dónde editar cada cosa')}</SectionLabel>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[
          {
            icon: Building2,
            title: tt("Profil de l'agence", 'Agency profile', 'Perfil de la agencia'),
            desc: tt('Nom, logo, bio, ville, réseaux — votre identité maître, synchronisée sur les deux pages.',
                     'Name, logo, bio, city, socials — your master identity, synced to both pages.',
                     'Nombre, logo, bio, ciudad, redes: tu identidad maestra, sincronizada en ambas páginas.'),
            to: '/agency-app/profile',
          },
          {
            icon: QrCode,
            title: tt('Linktree & externe', 'Linktree & external', 'Linktree y externo'),
            desc: tt('Adresse publique (slug), ordre des soirées, stats de confiance, QR codes.',
                     'Public address (slug), event ordering, trust stats, QR codes.',
                     'Dirección pública (slug), orden de las fiestas, estadísticas de confianza, códigos QR.'),
            to: '/affiliate/settings',
          },
          {
            icon: MapPin,
            title: tt('Clubs externes', 'External clubs', 'Clubs externos'),
            desc: tt('Le catalogue des clubs hors Yuno : logos, photos, descriptions, pages club publiques.',
                     'Your non-Yuno club catalog: logos, photos, descriptions, public club pages.',
                     'El catálogo de clubs fuera de Yuno: logos, fotos, descripciones, páginas públicas de club.'),
            to: '/affiliate/venues',
          },
          {
            icon: CalendarDays,
            title: tt('Soirées externes', 'External events', 'Fiestas externas'),
            desc: tt('Les soirées à billetterie externe affichées sur vos pages (les soirées Yuno sous contrat arrivent toutes seules).',
                     'External-ticketing events shown on your pages (Yuno events under contract appear automatically).',
                     'Las fiestas con venta externa que se muestran en tus páginas (las fiestas Yuno con contrato aparecen solas).'),
            to: '/affiliate/events',
          },
        ].map((card, i) => (
          <Link key={i} to={card.to} className="block">
            <div
              className="h-full rounded-2xl p-4 transition-colors hover:bg-white/[0.04]"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}
            >
              <div className="flex items-center gap-2.5 mb-1.5">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-none"
                  style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
                  <card.icon className="h-4 w-4" style={{ color: T2 }} />
                </div>
                <p style={{ color: T1, fontSize: 13.5, fontWeight: 650 }}>{card.title}</p>
                <ChevronRight className="h-4 w-4 ml-auto flex-none" style={{ color: T3 }} />
              </div>
              <p style={{ color: T3, fontSize: 12, lineHeight: 1.55 }}>{card.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
