import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { useAgency } from '@/hooks/useAgency';
import { useAgencyData, promoterName, AgencyPromoter } from '@/hooks/useAgencyData';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { errorToast } from '@/lib/errorToast';
import { ArrowLeft, Wallet, ToggleLeft, ToggleRight, Hash, Globe, Eye, MousePointerClick, ExternalLink, Copy, CalendarRange, Link2 } from 'lucide-react';
import {
  PromoCard, StatTile, SectionLabel, PromoEmpty, PromoAvatar, PromoPill, PromoButton, DarkInput, FieldLabel,
  T1, T2, T3, RED, POS, WARN, INNER_BG, BORDER,
} from '@/components/promoter/promoter-ui';
import { preparePayout, payoutErrorKey } from '@/lib/promoterPayout';

const eur = (n: number) => `${(Number(n) || 0).toFixed(2)} €`;

function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!value)}
      style={{
        background: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer',
        color: value ? RED : T3, opacity: disabled ? 0.5 : 1, padding: 0,
      }}
    >
      {value
        ? <ToggleRight className="h-5 w-5" />
        : <ToggleLeft className="h-5 w-5" />
      }
    </button>
  );
}

function ClubRecord({
  record, contracts, conversions, onSettle, settling, onSave, tt,
}: {
  record: AgencyPromoter;
  contracts: ReturnType<typeof useAgencyData>['contracts'];
  conversions: ReturnType<typeof useAgencyData>['conversions'];
  onSettle: (id: string) => void;
  settling: string | null;
  onSave: (patch: Partial<AgencyPromoter>, id: string) => Promise<void>;
  tt: (fr: string, en: string) => string;
}) {
  const [caps, setCaps] = useState({
    ticket: record.agency_ticket_cap?.toString() ?? '',
    table: record.agency_table_cap?.toString() ?? '',
  });
  const [saving, setSaving] = useState(false);

  const clubName = contracts.find(c => c.venue_id === record.venue_id || c.organizer_user_id === record.organizer_user_id)?.venues?.name
    || record.venues?.name
    || record.venue_id
    || tt('Organisateur', 'Organizer');

  const recordConvs = conversions.filter(c => c.promoter_id === record.id);
  const grossClub = recordConvs.reduce((s, c) => s + Number(c.gross_amount || 0), 0);

  const handleToggle = async (field: 'agency_can_sell_tickets' | 'agency_can_sell_tables', val: boolean) => {
    const { error } = await supabase.from('promoters').update({ [field]: val } as Pick<TablesUpdate<'promoters'>, typeof field>).eq('id', record.id);
    if (error) { errorToast(error); return; }
    await onSave({ [field]: val } as Partial<AgencyPromoter>, record.id);
  };

  const handleSaveCaps = async () => {
    setSaving(true);
    const patch = {
      agency_ticket_cap: caps.ticket !== '' ? parseInt(caps.ticket) : null,
      agency_table_cap: caps.table !== '' ? parseInt(caps.table) : null,
    };
    const { error } = await supabase.from('promoters').update(patch).eq('id', record.id);
    setSaving(false);
    if (error) { errorToast(error); return; }
    toast.success(tt('Caps enregistrés', 'Caps saved'));
    await onSave(patch as Partial<AgencyPromoter>, record.id);
  };

  return (
    <PromoCard style={{ padding: 14 }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p style={{ color: T1, fontSize: 14, fontWeight: 660 }}>{clubName}</p>
          {record.promo_code && (
            <PromoPill tone="muted">
              <Hash className="h-3 w-3 inline mr-0.5" />{record.promo_code}
            </PromoPill>
          )}
        </div>
        <div className="text-right flex-none">
          <p style={{ color: T3, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {tt('Volume', 'Volume')}
          </p>
          <p style={{ color: POS, fontSize: 15, fontWeight: 680 }}>{eur(grossClub)}</p>
        </div>
      </div>

      {/* Permission toggles */}
      <div className="space-y-2 mb-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10 }}>
        <div className="flex items-center justify-between">
          <p style={{ color: T2, fontSize: 13 }}>{tt('Peut vendre des billets', 'Can sell tickets')}</p>
          <Toggle
            value={record.agency_can_sell_tickets}
            onChange={v => handleToggle('agency_can_sell_tickets', v)}
          />
        </div>
        <div className="flex items-center justify-between">
          <p style={{ color: T2, fontSize: 13 }}>{tt('Peut vendre des tables', 'Can sell tables')}</p>
          <Toggle
            value={record.agency_can_sell_tables}
            onChange={v => handleToggle('agency_can_sell_tables', v)}
          />
        </div>
      </div>

      {/* Caps */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <FieldLabel>{tt('Plafond billets', 'Ticket cap')}</FieldLabel>
          <DarkInput
            value={caps.ticket}
            onChange={v => setCaps(c => ({ ...c, ticket: v }))}
            placeholder={tt('Illimité', 'Unlimited')}
            type="number"
          />
        </div>
        <div>
          <FieldLabel>{tt('Plafond tables', 'Table cap')}</FieldLabel>
          <DarkInput
            value={caps.table}
            onChange={v => setCaps(c => ({ ...c, table: v }))}
            placeholder={tt('Illimité', 'Unlimited')}
            type="number"
          />
        </div>
      </div>
      <PromoButton size="sm" full onClick={handleSaveCaps} disabled={saving}>
        {saving ? tt('Enregistrement…', 'Saving…') : tt('Enregistrer les plafonds', 'Save caps')}
      </PromoButton>

      {/* Pending + settle */}
      {Number(record.pending_amount) > 0 && (
        <div className="flex items-center justify-between mt-3" style={{ paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <div>
            <p style={{ color: T3, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {tt('À reverser', 'To pay')}
            </p>
            <p style={{ color: WARN, fontSize: 15, fontWeight: 680 }}>{eur(record.pending_amount)}</p>
          </div>
          <PromoButton
            size="sm"
            variant="secondary"
            onClick={() => onSettle(record.id)}
            disabled={settling === record.id}
          >
            <Wallet className="h-3.5 w-3.5" />
            {settling === record.id ? '…' : tt('Régler', 'Settle')}
          </PromoButton>
        </div>
      )}
    </PromoCard>
  );
}

export default function AgencyPromoterDetail() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { agency } = useAgency();
  const { promoters, contracts, conversions, groups, externalMembers, loading, refetch } = useAgencyData(agency?.id ?? null);
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [settling, setSettling] = useState<string | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);

  const records = promoters.filter(p => p.user_id === userId);
  const person = records[0];

  // Bras externe : la même personne promeut aussi les clubs non-Yuno.
  const external = externalMembers.find(m => m.user_id === userId) ?? null;
  const [extStats, setExtStats] = useState<{ views: number; clicks: number } | null>(null);

  useEffect(() => {
    if (!external) { setExtStats(null); return; }
    let active = true;
    (async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const [v, c] = await Promise.all([
        supabase.from('affiliate_visitor_sessions')
          .select('id', { count: 'exact', head: true })
          .eq('affiliate_member_id', external.id).eq('is_internal', false)
          .gte('visited_at', since.toISOString()),
        supabase.from('affiliate_clicks')
          .select('id', { count: 'exact', head: true })
          .eq('affiliate_member_id', external.id).eq('is_internal', false)
          .gte('clicked_at', since.toISOString()),
      ]);
      if (active) setExtStats({ views: v.count ?? 0, clicks: c.count ?? 0 });
    })();
    return () => { active = false; };
  }, [external?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalGross = useMemo(() =>
    conversions.filter(c => records.some(r => r.id === c.promoter_id))
      .reduce((s, c) => s + Number(c.gross_amount || 0), 0),
    [conversions, records]);

  const totalPaid = useMemo(() =>
    records.reduce((s, r) => s + Number(r.total_paid || 0), 0),
    [records]);

  const totalPending = useMemo(() =>
    records.reduce((s, r) => s + Number(r.pending_amount || 0), 0),
    [records]);

  const totalConversions = useMemo(() =>
    conversions.filter(c => records.some(r => r.id === c.promoter_id)).length,
    [conversions, records]);

  const recentConversions = useMemo(() =>
    conversions
      .filter(c => records.some(r => r.id === c.promoter_id))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 20),
    [conversions, records]);

  // Règlement en trois temps : on PRÉPARE ici, IBAN + référence + déclaration
  // de virement vivent sur l'écran Finance.
  const handleSettle = async (promoterId: string) => {
    setSettling(promoterId);
    try {
      const res = await preparePayout(promoterId);
      setSettling(null);
      if (res?.prepared) {
        toast.success(tt('Règlement préparé — IBAN et référence dans Finance', 'Settlement prepared — IBAN and reference in Finance'));
        navigate('/agency-app/finance');
      } else {
        toast.info(tt('Rien à régler', 'Nothing to settle'));
      }
    } catch (err) {
      setSettling(null);
      toast.error(t(payoutErrorKey(err)));
    }
    refetch();
  };

  const handleSaveRecord = async (_patch: Partial<AgencyPromoter>, _id: string) => {
    await refetch();
  };

  const handleGroupChange = async (groupId: string) => {
    setSavingGroup(true);
    let failed = false;
    for (const r of records) {
      const { error } = await supabase.from('promoters')
        .update({ agency_group_id: groupId || null })
        .eq('id', r.id);
      if (error) { console.error('group update error:', error); failed = true; }
    }
    setSavingGroup(false);
    if (failed) {
      toast.error(tt('Certaines lignes n’ont pas été mises à jour. Réessaie.', 'Some rows were not updated. Try again.', 'Algunas filas no se actualizaron. Reintenta.'));
    } else {
      toast.success(tt('Groupe mis à jour', 'Group updated'));
    }
    refetch();
  };

  if (loading) {
    return <div className="py-16 text-center" style={{ color: T3, fontSize: 13 }}>{tt('Chargement…', 'Loading…')}</div>;
  }

  if (!person) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate('/agency-app/promoters')}
          style={{ color: T3, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
        >
          <ArrowLeft className="h-4 w-4" /> {tt('Retour', 'Back')}
        </button>
        <PromoEmpty icon={ArrowLeft} title={tt('Promoteur introuvable', 'Promoter not found')}
          description={tt('Ce promoteur ne fait plus partie de votre agence.', 'This promoter is no longer in your agency.')} />
      </div>
    );
  }

  const currentGroupId = person.agency_group_id ?? '';

  return (
    <div className="space-y-4">
      {/* Back nav */}
      <button
        onClick={() => navigate('/agency-app/promoters')}
        style={{ color: T3, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
      >
        <ArrowLeft className="h-4 w-4" /> {tt('Tous les promoteurs', 'All promoters')}
      </button>

      {/* Identity */}
      <div className="flex items-center gap-4">
        <PromoAvatar src={person.profile_image_url} fallback={promoterName(person).slice(0, 1)} size={56} />
        <div>
          <p style={{ color: T1, fontSize: 18, fontWeight: 700 }}>{promoterName(person)}</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {records.map(r => r.promo_code && (
              <PromoPill key={r.id} tone="muted">
                <Hash className="h-3 w-3 inline mr-0.5" />{r.promo_code}
              </PromoPill>
            ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile icon={Wallet} value={eur(totalGross)} label={tt('Volume total', 'Total volume')} tone="pos" />
        <StatTile icon={Wallet} value={eur(totalPaid)} label={tt('Versé', 'Paid out')} />
        <StatTile icon={Wallet} value={eur(totalPending)} label={tt('En attente', 'Pending')} tone="warn" />
        <StatTile icon={Hash} value={totalConversions} label={tt('Conversions', 'Conversions')} />
      </div>

      {/* Pages publiques Yuno : linktree (meilleures soirées) + agenda complet.
          Le lien agenda est pensé pour le QR / la bio : il s'ouvre toujours sur
          le web, et chaque soirée bascule vers l'app Yuno si elle est installée. */}
      {[...new Set(records.map(r => r.promo_code).filter(Boolean))].length > 0 && (
        <>
          <SectionLabel>{tt('Pages publiques', 'Public pages')}</SectionLabel>
          <PromoCard style={{ padding: 14 }}>
            <div className="space-y-3">
              {[...new Set(records.map(r => r.promo_code).filter(Boolean))].map(code => (
                <div key={code} className="space-y-2">
                  {[
                    { icon: Link2, path: `/promoteur/${code}`, label: tt('Linktree — meilleures soirées', 'Linktree — top nights') },
                    { icon: CalendarRange, path: `/promoteur/${code}/agenda`, label: tt('Agenda — toutes les soirées', 'Agenda — all nights') },
                  ].map(({ icon: Icon, path, label }) => (
                    <div key={path} className="flex items-center gap-3">
                      <Icon className="h-4 w-4 flex-none" style={{ color: T2 }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{path}</p>
                        <p style={{ color: T3, fontSize: 10.5 }}>{label}</p>
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`https://yunoapp.eu${path}`);
                          toast.success(tt('Lien copié', 'Link copied'));
                        }}
                        className="p-1.5 flex-none transition-colors"
                        style={{ color: T3, background: 'none', border: 'none', cursor: 'pointer' }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = T1)}
                        onMouseLeave={(e) => (e.currentTarget.style.color = T3)}
                        aria-label={tt('Copier le lien', 'Copy link')}
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <a
                        href={path}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 flex-none transition-colors"
                        style={{ color: T3 }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = T1)}
                        onMouseLeave={(e) => (e.currentTarget.style.color = T3)}
                        aria-label={tt('Ouvrir la page', 'Open page')}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </PromoCard>
        </>
      )}

      {/* Bras externe : linktree + trafic 30 jours */}
      {external && (
        <>
          <SectionLabel>{tt('Clubs externes', 'External clubs')}</SectionLabel>
          <PromoCard style={{ padding: 14 }}>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Globe className="h-4 w-4 flex-none" style={{ color: T2 }} />
                <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>
                  {external.linktree_slug ? `/promo/${external.linktree_slug}` : tt('Linktree non configuré', 'Linktree not set up')}
                </p>
              </div>
              <div className="flex items-center gap-4 flex-none tabular-nums">
                <span style={{ color: T2, fontSize: 12.5 }}>
                  <Eye className="h-3.5 w-3.5 inline mr-1" style={{ color: T3 }} />
                  {extStats?.views ?? '…'} {tt('vues 30 j', 'views 30d')}
                </span>
                <span style={{ color: T2, fontSize: 12.5 }}>
                  <MousePointerClick className="h-3.5 w-3.5 inline mr-1" style={{ color: T3 }} />
                  {extStats?.clicks ?? '…'} {tt('clics', 'clicks')}
                </span>
              </div>
              {external.linktree_slug && (
                <a href={`/promo/${external.linktree_slug}`} target="_blank" rel="noopener noreferrer"
                  className="p-1.5 flex-none transition-colors" style={{ color: T3 }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = T1)}
                  onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
          </PromoCard>
        </>
      )}

      {/* Per-club records */}
      <SectionLabel>{tt('Clubs', 'Clubs')} ({records.length})</SectionLabel>
      {records.map(r => (
        <ClubRecord
          key={r.id}
          record={r}
          contracts={contracts}
          conversions={conversions}
          onSettle={handleSettle}
          settling={settling}
          onSave={handleSaveRecord}
          tt={tt}
        />
      ))}

      {/* Group assignment */}
      {groups.length > 0 && (
        <>
          <SectionLabel>{tt('Groupe', 'Group')}</SectionLabel>
          <PromoCard>
            <select
              value={currentGroupId}
              onChange={e => handleGroupChange(e.target.value)}
              disabled={savingGroup}
              className="w-full outline-none"
              style={{
                background: INNER_BG, border: `1px solid ${BORDER}`,
                borderRadius: 10, padding: '9px 12px', color: T1, fontSize: 13.5, cursor: 'pointer',
              }}
            >
              <option value="" style={{ background: '#111' }}>{tt('Aucun groupe', 'No group')}</option>
              {groups.map(g => (
                <option key={g.id} value={g.id} style={{ background: '#111' }}>
                  {g.name}
                </option>
              ))}
            </select>
          </PromoCard>
        </>
      )}

      {/* Recent conversions */}
      {recentConversions.length > 0 && (
        <>
          <SectionLabel>{tt('20 dernières conversions', 'Last 20 conversions')}</SectionLabel>
          <PromoCard style={{ padding: 8 }}>
            {recentConversions.map((c, i) => (
              <div
                key={c.id}
                className="flex justify-between items-center"
                style={{ padding: '8px 8px', borderBottom: i < recentConversions.length - 1 ? '1px solid rgba(255,255,255,0.04)' : undefined }}
              >
                <div>
                  <p style={{ color: T2, fontSize: 12 }}>
                    {new Date(c.created_at).toLocaleDateString(language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB', {
                      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                  <p style={{ color: T3, fontSize: 10.5 }}>
                    {tt('Marge', 'Margin')}: {eur(c.margin_amount)}
                  </p>
                </div>
                <p style={{ color: POS, fontSize: 13.5, fontWeight: 680 }}>{eur(c.gross_amount)}</p>
              </div>
            ))}
          </PromoCard>
        </>
      )}
    </div>
  );
}
