import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useAgencyData, promoterName, AgencyPromoter } from '@/hooks/useAgencyData';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { ArrowLeft, Wallet, ToggleLeft, ToggleRight, Hash } from 'lucide-react';
import {
  PromoCard, StatTile, SectionLabel, PromoEmpty, PromoAvatar, PromoPill, PromoButton, DarkInput, FieldLabel,
  T1, T2, T3, RED, POS, WARN, INNER_BG, BORDER,
} from '@/components/promoter/promoter-ui';

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
  const db = supabase as any;

  const clubName = contracts.find(c => c.venue_id === record.venue_id || c.organizer_user_id === record.organizer_user_id)?.venues?.name
    || record.venues?.name
    || record.venue_id
    || tt('Organisateur', 'Organizer');

  const recordConvs = conversions.filter(c => c.promoter_id === record.id);
  const grossClub = recordConvs.reduce((s, c) => s + Number(c.gross_amount || 0), 0);

  const handleToggle = async (field: 'agency_can_sell_tickets' | 'agency_can_sell_tables', val: boolean) => {
    const { error } = await db.from('promoters').update({ [field]: val }).eq('id', record.id);
    if (error) { toast.error(error.message); return; }
    await onSave({ [field]: val } as Partial<AgencyPromoter>, record.id);
  };

  const handleSaveCaps = async () => {
    setSaving(true);
    const patch = {
      agency_ticket_cap: caps.ticket !== '' ? parseInt(caps.ticket) : null,
      agency_table_cap: caps.table !== '' ? parseInt(caps.table) : null,
    };
    const { error } = await db.from('promoters').update(patch).eq('id', record.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
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
  const { promoters, contracts, conversions, groups, loading, refetch } = useAgencyData(agency?.id ?? null);
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => translate(language, fr, en);
  const [settling, setSettling] = useState<string | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);
  const db = supabase as any;

  const records = promoters.filter(p => p.user_id === userId);
  const person = records[0];

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

  const handleSettle = async (promoterId: string) => {
    setSettling(promoterId);
    const { data, error } = await db.rpc('settle_agency_promoter_payout', { p_promoter_id: promoterId });
    setSettling(null);
    if (error) { toast.error(error.message); return; }
    if (data?.settled) toast.success(tt('Réglé', 'Settled') + ` — ${eur(data.amount)}`);
    else toast.info(tt('Rien à régler', 'Nothing to settle'));
    refetch();
  };

  const handleSaveRecord = async (_patch: Partial<AgencyPromoter>, _id: string) => {
    await refetch();
  };

  const handleGroupChange = async (groupId: string) => {
    setSavingGroup(true);
    for (const r of records) {
      await db.from('promoters')
        .update({ agency_group_id: groupId || null })
        .eq('id', r.id);
    }
    setSavingGroup(false);
    toast.success(tt('Groupe mis à jour', 'Group updated'));
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
                    {new Date(c.created_at).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-GB', {
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
