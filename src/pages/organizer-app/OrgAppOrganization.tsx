import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import {
  UserCircle, CreditCard, Users, Building2, FileText, RotateCcw,
  ChevronRight, ExternalLink, LogOut, Loader2, Lock,
} from 'lucide-react';
import {
  OrgPage, OrgPageHeader, OrgCard, OrgButton, OrgSectionLabel,
  RED, T1, T2, T3, BORDER, INNER_BG,
} from '@/components/org-ui';

interface OrgIdentity {
  name: string;
  slug: string | null;
  avatarUrl: string | null;
}

export default function OrgAppOrganization() {
  const { user, signOut } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const [identity, setIdentity] = useState<OrgIdentity>({ name: '', slug: null, avatarUrl: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: org } = await supabase
        .from('organizer_profiles')
        .select('display_name, slug, avatar_url')
        .eq('user_id', user.id)
        .maybeSingle();
      if (org) {
        setIdentity({ name: org.display_name || '', slug: org.slug, avatarUrl: org.avatar_url });
      } else {
        const { data: prof } = await supabase
          .from('profiles')
          .select('organization_name, organization_logo_url')
          .eq('id', user.id)
          .maybeSingle();
        setIdentity({ name: prof?.organization_name || '', slug: null, avatarUrl: prof?.organization_logo_url ?? null });
      }
      setLoading(false);
    })();
  }, [user]);

  const sections: {
    label: string;
    items: { icon: typeof UserCircle; title: string; desc: string; to: string; external?: boolean }[];
  }[] = [
    {
      label: t('Organisation', 'Organization'),
      items: [
        { icon: UserCircle, title: t('Profil public & vitrine', 'Public profile'), desc: t('Nom, logo, bannière, bio, liens et infos de facturation.', 'Name, logo, banner, bio, links and billing info.'), to: '/organizer-app/profile' },
        { icon: CreditCard, title: t('Paiements (Stripe)', 'Payments (Stripe)'), desc: t('Compte Stripe, encaissement et virements.', 'Stripe account, charges and payouts.'), to: '/organizer-app/payments' },
      ],
    },
    {
      label: t('Écosystème', 'Ecosystem'),
      items: [
        { icon: Users, title: t('Équipe & rôles', 'Team & roles'), desc: t('Invitez des membres et gérez leurs accès.', 'Invite members and manage their access.'), to: '/organizer-app/team' },
        { icon: Building2, title: t('Clubs partenaires', 'Partner clubs'), desc: t('Partenariats et partage de revenus.', 'Partnerships and revenue splits.'), to: '/organizer-app/partners' },
      ],
    },
    {
      label: t('Finances', 'Finance'),
      items: [
        { icon: FileText, title: t('Factures', 'Invoices'), desc: t('Historique des factures émises.', 'History of issued invoices.'), to: '/organizer-app/invoices' },
        { icon: RotateCcw, title: t('Remboursements', 'Refunds'), desc: t('Gérez les remboursements de vos soirées.', 'Manage refunds for your events.'), to: '/organizer-app/refunds' },
      ],
    },
  ];

  const publicUrl = identity.slug ? `/o/${identity.slug}` : null;
  const initials = identity.name ? identity.name.slice(0, 2).toUpperCase() : 'OR';

  return (
    <OrgPage className="mx-auto max-w-3xl">
      <OrgPageHeader
        title={t('Mon organisation', 'My organization')}
        subtitle={t('Tous les réglages de votre organisation au même endroit.', 'Every setting for your organization in one place.')}
        actions={publicUrl ? (
          <OrgButton variant="secondary" size="sm" href={publicUrl}>
            <ExternalLink className="h-4 w-4" />{t('Voir le profil public', 'View public profile')}
          </OrgButton>
        ) : undefined}
      />

      {/* Identity header */}
      <OrgCard style={{ padding: 20, marginBottom: 16 }}>
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            {loading ? (
              <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" style={{ color: T3 }} /></div>
            ) : identity.avatarUrl ? (
              <img src={identity.avatarUrl} alt={identity.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center font-mono font-bold" style={{ color: T3, fontSize: 16 }}>{initials}</div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate" style={{ color: T1, fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>
              {identity.name || t('Votre organisation', 'Your organization')}
            </p>
            {publicUrl ? (
              <p className="font-mono" style={{ color: RED, fontSize: 12, marginTop: 2 }}>{publicUrl}</p>
            ) : (
              <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>{t('Complétez votre profil public pour obtenir une URL.', 'Complete your public profile to get a URL.')}</p>
            )}
          </div>
          <OrgButton variant="secondary" size="sm" onClick={() => navigate('/organizer-app/profile')}>
            {t('Modifier', 'Edit')}
          </OrgButton>
        </div>
      </OrgCard>

      {/* Settings sections */}
      <div className="space-y-6">
        {sections.map((section) => (
          <div key={section.label}>
            <div className="mb-2 px-1">
              <OrgSectionLabel>{section.label}</OrgSectionLabel>
            </div>
            <OrgCard style={{ overflow: 'hidden' }}>
              {section.items.map((item, i) => (
                <button
                  key={item.title}
                  type="button"
                  onClick={() => navigate(item.to)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.02]"
                  style={{ borderTop: i > 0 ? `1px solid ${BORDER}` : 'none' }}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                    <item.icon className="h-4 w-4" style={{ color: T2 }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{item.title}</p>
                    <p className="truncate" style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>{item.desc}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0" style={{ color: T3 }} />
                </button>
              ))}
            </OrgCard>
          </div>
        ))}

        {/* Account */}
        <div>
          <div className="mb-2 px-1">
            <OrgSectionLabel>{t('Compte', 'Account')}</OrgSectionLabel>
          </div>
          <OrgCard style={{ padding: 16 }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Lock className="h-4 w-4" style={{ color: T3 }} />
                <div>
                  <p style={{ color: T1, fontSize: 13, fontWeight: 540 }}>{user?.email ?? t('Compte', 'Account')}</p>
                  <p style={{ color: T3, fontSize: 11.5 }}>{t('Connecté en tant qu\'organisateur', 'Signed in as organizer')}</p>
                </div>
              </div>
              <OrgButton variant="danger" size="sm" onClick={() => signOut()}>
                <LogOut className="h-4 w-4" />{t('Se déconnecter', 'Sign out')}
              </OrgButton>
            </div>
          </OrgCard>
        </div>
      </div>
    </OrgPage>
  );
}
