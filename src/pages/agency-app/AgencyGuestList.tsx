import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useAgencyGuestList, AgencyGlEnvelope, AgencyGlPromoterRow } from '@/hooks/useAgencyGuestList';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { errorToast } from '@/lib/errorToast';
import { ClipboardList, Users, Layers, Waves, Check, UserPlus, Calendar } from 'lucide-react';
import {
  PromoCard, PromoButton, PromoEmpty, PromoAvatar, PromoPill, PromoProgress, SectionLabel,
  T1, T2, T3, RED, POS, WARN, INNER_BG, BORDER,
} from '@/components/promoter/promoter-ui';

type TT = (fr: string, en: string, es?: string) => string;

function fmtDate(iso: string, lang: string) {
  return new Date(iso).toLocaleDateString(lang === 'fr' ? 'fr-FR' : lang === 'es' ? 'es-ES' : 'en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

// Petit champ nombre compact pour la grille de répartition.
function NumCell({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <input
      type="number" min={0} inputMode="numeric"
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      className="outline-none text-center"
      style={{
        width: 46, background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 8,
        padding: '6px 4px', color: disabled ? T3 : T1, fontSize: 13, fontFamily: 'inherit',
      }}
    />
  );
}

// ── Enveloppe d'une soirée ────────────────────────────────────────────────────
function EnvelopeCard({ env, reload, tt, lang }: { env: AgencyGlEnvelope; reload: () => void; tt: TT; lang: string }) {
  const db = supabase as any;
  const [busy, setBusy] = useState(false);
  // Brouillon de partition : { [promoterId]: { normal, drink, table } } (strings).
  const [draft, setDraft] = useState<Record<string, { normal: string; drink: string; table: string }>>({});

  useEffect(() => {
    const next: Record<string, { normal: string; drink: string; table: string }> = {};
    for (const p of env.promoters) {
      next[p.promoter_id] = {
        normal: p.sub_normal ? String(p.sub_normal) : '',
        drink: p.sub_drink ? String(p.sub_drink) : '',
        table: p.sub_table ? String(p.sub_table) : '',
      };
    }
    setDraft(next);
  }, [env]);

  const n = (v: string) => Math.max(0, parseInt(v || '0') || 0);
  const sum = useMemo(() => {
    let normal = 0, drink = 0, table = 0;
    for (const p of env.promoters) {
      const d = draft[p.promoter_id];
      if (!d) continue;
      normal += n(d.normal); drink += n(d.drink); table += n(d.table);
    }
    return { normal, drink, table, total: normal + drink + table };
  }, [draft, env]);

  // Capacité par dimension : 0/NULL = illimité (on n'affiche pas de garde).
  const cap = { normal: env.quota_normal, drink: env.quota_drink, table: env.quota_table };
  const overNormal = cap.normal > 0 && sum.normal > cap.normal;
  const overDrink = cap.drink > 0 && sum.drink > cap.drink;
  const overTable = cap.table > 0 && sum.table > cap.table;
  const overTotal = env.quota != null && env.quota > 0 && sum.total > env.quota;
  const anyOver = overNormal || overDrink || overTable || overTotal;

  const setMode = async (mode: 'partition' | 'pool') => {
    if (mode === env.mode) return;
    setBusy(true);
    const { error } = await db.rpc('set_agency_guestlist_mode', { p_guest_list_id: env.guest_list_id, p_mode: mode });
    setBusy(false);
    if (error) { errorToast(error); return; }
    toast.success(mode === 'pool' ? tt('Passé en pool', 'Switched to pool') : tt('Passé en partition', 'Switched to partition'));
    reload();
  };

  const saveDistribution = async () => {
    if (anyOver) { toast.error(tt('La somme dépasse l\'enveloppe', 'Distribution exceeds the envelope')); return; }
    const allocations = env.promoters.map(p => {
      const d = draft[p.promoter_id] || { normal: '', drink: '', table: '' };
      return { promoter_id: p.promoter_id, normal: n(d.normal), drink: n(d.drink), table: n(d.table) };
    });
    setBusy(true);
    const { error } = await db.rpc('distribute_agency_guestlist', { p_guest_list_id: env.guest_list_id, p_allocations: allocations });
    setBusy(false);
    if (error) { errorToast(error); return; }
    toast.success(tt('Répartition enregistrée', 'Distribution saved'));
    reload();
  };

  const envelopeLabel = env.quota == null || env.quota === 0
    ? tt('illimité', 'unlimited')
    : String(env.quota);

  // Promoteurs : assignés d'abord.
  const sortedProms = useMemo(
    () => [...env.promoters].sort((a, b) => Number(b.assigned) - Number(a.assigned) || a.name.localeCompare(b.name)),
    [env.promoters],
  );

  return (
    <PromoCard style={{ padding: 0, overflow: 'hidden' }}>
      {/* En-tête soirée + enveloppe */}
      <div style={{ padding: '13px 15px', borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p style={{ color: T1, fontSize: 14.5, fontWeight: 660 }} className="truncate">{env.event_title}</p>
            <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
              {fmtDate(env.start_at, lang)}{env.venue_name ? ` · ${env.venue_name}` : ''}
            </p>
          </div>
          <PromoPill tone="red" style={{ fontSize: 11, flexShrink: 0 }}>
            {tt('Enveloppe', 'Envelope')} {envelopeLabel}
          </PromoPill>
        </div>
        {/* Ventilation par type si présente */}
        {(env.quota_normal + env.quota_drink + env.quota_table) > 0 && (
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {env.quota_normal > 0 && <PromoPill tone="muted" style={{ fontSize: 10 }}>{tt('Normal', 'Standard')} {env.quota_normal}</PromoPill>}
            {env.quota_drink > 0 && <PromoPill tone="muted" style={{ fontSize: 10 }}>{tt('Conso', 'Drink')} {env.quota_drink}</PromoPill>}
            {env.quota_table > 0 && <PromoPill tone="muted" style={{ fontSize: 10 }}>VIP {env.quota_table}</PromoPill>}
          </div>
        )}

        {/* Bascule de mode */}
        <div className="flex gap-1.5 mt-3">
          <button
            onClick={() => setMode('partition')}
            disabled={busy}
            className="flex items-center gap-1.5"
            style={{
              padding: '6px 12px', borderRadius: 9, fontSize: 12, fontWeight: 620, cursor: 'pointer',
              background: env.mode === 'partition' ? RED : INNER_BG,
              color: env.mode === 'partition' ? '#fff' : T2,
              border: `1px solid ${env.mode === 'partition' ? RED : BORDER}`,
            }}
          >
            <Layers className="h-3.5 w-3.5" /> {tt('Partition', 'Partition')}
          </button>
          <button
            onClick={() => setMode('pool')}
            disabled={busy}
            className="flex items-center gap-1.5"
            style={{
              padding: '6px 12px', borderRadius: 9, fontSize: 12, fontWeight: 620, cursor: 'pointer',
              background: env.mode === 'pool' ? RED : INNER_BG,
              color: env.mode === 'pool' ? '#fff' : T2,
              border: `1px solid ${env.mode === 'pool' ? RED : BORDER}`,
            }}
          >
            <Waves className="h-3.5 w-3.5" /> {tt('Pool libre', 'Free pool')}
          </button>
        </div>
        <p style={{ color: T3, fontSize: 10.5, marginTop: 6 }}>
          {env.mode === 'partition'
            ? tt('Chaque promoteur reçoit un quota fixe (somme ≤ enveloppe).', 'Each promoter gets a fixed quota (sum ≤ envelope).')
            : tt('Tous puisent dans l\'enveloppe, premier arrivé, jusqu\'à épuisement.', 'Everyone draws from the envelope, first come, until it\'s exhausted.')}
        </p>
      </div>

      {/* Corps selon mode */}
      {env.mode === 'partition'
        ? <PartitionBody env={env} sortedProms={sortedProms} draft={draft} setDraft={setDraft}
            sum={sum} cap={cap} anyOver={anyOver} overTotal={overTotal} busy={busy}
            onSave={saveDistribution} tt={tt} />
        : <PoolBody env={env} sortedProms={sortedProms} reload={reload} tt={tt} />}
    </PromoCard>
  );
}

// ── Corps PARTITION ───────────────────────────────────────────────────────────
function PartitionBody({
  env, sortedProms, draft, setDraft, sum, cap, anyOver, overTotal, busy, onSave, tt,
}: {
  env: AgencyGlEnvelope; sortedProms: AgencyGlPromoterRow[];
  draft: Record<string, { normal: string; drink: string; table: string }>;
  setDraft: React.Dispatch<React.SetStateAction<Record<string, { normal: string; drink: string; table: string }>>>;
  sum: { normal: number; drink: number; table: number; total: number };
  cap: { normal: number; drink: number; table: number };
  anyOver: boolean; overTotal: boolean; busy: boolean; onSave: () => void; tt: TT;
}) {
  const set = (pid: string, k: 'normal' | 'drink' | 'table', v: string) =>
    setDraft(prev => ({ ...prev, [pid]: { ...(prev[pid] || { normal: '', drink: '', table: '' }), [k]: v } }));

  const hasType = (env.quota_normal + env.quota_drink + env.quota_table) > 0;
  // Colonnes affichées : celles ventilées, sinon juste « Normal » (total).
  const cols: ('normal' | 'drink' | 'table')[] = hasType
    ? ([['normal', env.quota_normal], ['drink', env.quota_drink], ['table', env.quota_table]] as const)
        .filter(([, q]) => q > 0).map(([k]) => k)
    : ['normal'];

  return (
    <div style={{ padding: '10px 12px' }}>
      {/* En-tête colonnes */}
      <div className="flex items-center gap-2" style={{ padding: '2px 4px 6px' }}>
        <div className="flex-1" style={{ color: T3, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {tt('Promoteur', 'Promoter')}
        </div>
        {cols.map(c => (
          <div key={c} style={{ width: 46, textAlign: 'center', color: T3, fontSize: 10 }}>
            {c === 'normal' ? tt('Norm', 'Std') : c === 'drink' ? tt('Conso', 'Drk') : 'VIP'}
          </div>
        ))}
        <div style={{ width: 40, textAlign: 'center', color: T3, fontSize: 10 }}>{tt('Pris', 'Used')}</div>
      </div>

      {sortedProms.map(p => (
        <div key={p.promoter_id} className="flex items-center gap-2" style={{ padding: '6px 4px', borderTop: `1px solid rgba(255,255,255,0.04)` }}>
          <PromoAvatar src={p.profile_image_url} fallback={p.name.slice(0, 1)} size={26} />
          <div className="flex-1 min-w-0">
            <p className="truncate" style={{ color: T1, fontSize: 12.5 }}>{p.name}</p>
            {!p.assigned && (
              <p style={{ color: WARN, fontSize: 9.5 }}>{tt('non assigné à la soirée', 'not assigned to the event')}</p>
            )}
          </div>
          {cols.map(c => (
            <NumCell key={c}
              value={draft[p.promoter_id]?.[c] ?? ''}
              onChange={v => set(p.promoter_id, c, v)}
              disabled={!p.assigned} />
          ))}
          <div style={{ width: 40, textAlign: 'center', color: p.sub_used > 0 ? POS : T3, fontSize: 12 }}>{p.sub_used}</div>
        </div>
      ))}

      {/* Récap somme / enveloppe + enregistrer */}
      <div className="flex items-center justify-between gap-3" style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDER}` }}>
        <div style={{ fontSize: 11.5, color: anyOver ? RED : T2 }}>
          {tt('Réparti', 'Distributed')} <b style={{ color: anyOver ? RED : T1 }}>{sum.total}</b>
          {env.quota != null && env.quota > 0 ? ` / ${env.quota}` : ` / ${tt('illimité', 'unlimited')}`}
          {overTotal && ` · ${tt('dépasse l\'enveloppe', 'exceeds envelope')}`}
        </div>
        <PromoButton size="sm" onClick={onSave} disabled={busy || anyOver}>
          <Check className="h-3.5 w-3.5" /> {tt('Enregistrer', 'Save')}
        </PromoButton>
      </div>
    </div>
  );
}

// ── Corps POOL ────────────────────────────────────────────────────────────────
function PoolBody({ env, sortedProms, reload, tt }: {
  env: AgencyGlEnvelope; sortedProms: AgencyGlPromoterRow[]; reload: () => void; tt: TT;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [type, setType] = useState('normal');
  const [busy, setBusy] = useState(false);

  const unlimited = env.quota == null || env.quota === 0;
  const pct = unlimited ? 0 : Math.round((env.used_total / env.quota!) * 100);

  const addGuest = async () => {
    if (!name.trim()) { toast.error(tt('Nom requis', 'Name required')); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('guest-list-manage', {
      body: { action: 'add_guest', guestListId: env.guest_list_id, fullName: name.trim(), email: email.trim() || undefined, entryType: type },
    });
    setBusy(false);
    if (error || (data as any)?.error) { toast.error((data as any)?.error || error?.message || tt('Échec', 'Failed')); return; }
    toast.success(tt('Invité ajouté au pool', 'Guest added to the pool'));
    setName(''); setEmail(''); setAddOpen(false);
    reload();
  };

  const typeCols = [
    { k: 'normal', q: env.quota_normal, used: env.used_normal, label: tt('Normal', 'Standard') },
    { k: 'drink', q: env.quota_drink, used: env.used_drink, label: tt('Conso', 'Drink') },
    { k: 'table', q: env.quota_table, used: env.used_table, label: 'VIP' },
  ].filter(c => c.q > 0);

  return (
    <div style={{ padding: '12px 14px' }}>
      {/* Compteur global */}
      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
        <span style={{ color: T2, fontSize: 12 }}>{tt('Rempli', 'Filled')}</span>
        <span style={{ color: T1, fontSize: 12.5, fontWeight: 620 }}>
          {env.used_total}{unlimited ? '' : ` / ${env.quota}`}
        </span>
      </div>
      {!unlimited && <PromoProgress value={pct} tone={pct >= 100 ? 'warn' : 'red'} />}
      {unlimited && <p style={{ color: T3, fontSize: 11 }}>{tt('Pool illimité', 'Unlimited pool')}</p>}

      {typeCols.length > 0 && (
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {typeCols.map(c => (
            <PromoPill key={c.k} tone="muted" style={{ fontSize: 10 }}>{c.label} {c.used}/{c.q}</PromoPill>
          ))}
        </div>
      )}

      {/* Contributions par promoteur */}
      <div style={{ marginTop: 10 }}>
        {sortedProms.filter(p => p.assigned || p.pool_used > 0).map(p => (
          <div key={p.promoter_id} className="flex items-center gap-2" style={{ padding: '5px 2px', borderTop: `1px solid rgba(255,255,255,0.04)` }}>
            <PromoAvatar src={p.profile_image_url} fallback={p.name.slice(0, 1)} size={24} />
            <p className="flex-1 truncate" style={{ color: T1, fontSize: 12 }}>{p.name}</p>
            <span style={{ color: p.pool_used > 0 ? POS : T3, fontSize: 12 }}>{p.pool_used}</span>
          </div>
        ))}
      </div>

      {/* Ajout direct par le chef d'agence (maison, non attribué) */}
      {addOpen ? (
        <div style={{ marginTop: 10, borderTop: `1px solid ${BORDER}`, paddingTop: 10 }} className="space-y-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder={tt('Nom complet', 'Full name')}
            className="w-full outline-none" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 9, padding: '8px 10px', color: T1, fontSize: 13 }} />
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder={tt('Email (optionnel)', 'Email (optional)')}
            className="w-full outline-none" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 9, padding: '8px 10px', color: T1, fontSize: 13 }} />
          <div className="flex gap-2">
            <select value={type} onChange={e => setType(e.target.value)}
              className="outline-none" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 9, padding: '8px 10px', color: T1, fontSize: 13, flex: 1 }}>
              <option value="normal" style={{ background: '#111' }}>{tt('Normal', 'Standard')}</option>
              {env.quota_drink > 0 && <option value="drink" style={{ background: '#111' }}>{tt('Conso', 'Drink')}</option>}
              {env.quota_table > 0 && <option value="table" style={{ background: '#111' }}>VIP</option>}
            </select>
            <PromoButton size="sm" onClick={addGuest} disabled={busy}>{tt('Ajouter', 'Add')}</PromoButton>
            <PromoButton size="sm" variant="ghost" onClick={() => setAddOpen(false)}>{tt('Annuler', 'Cancel')}</PromoButton>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <PromoButton size="sm" variant="secondary" onClick={() => setAddOpen(true)}>
            <UserPlus className="h-3.5 w-3.5" /> {tt('Ajouter un invité au pool', 'Add a guest to the pool')}
          </PromoButton>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AgencyGuestList() {
  const { agency } = useAgency();
  const { language } = useLanguage();
  const tt: TT = (fr, en, es) => translate(language, fr, en, es);
  const { envelopes, loading, reload } = useAgencyGuestList(agency?.id ?? null);

  return (
    <div className="space-y-4">
      <SectionLabel>{tt('Guest list — répartition', 'Guest list — distribution')}</SectionLabel>

      <PromoCard style={{ padding: '12px 14px' }}>
        <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.5 }}>
          {tt(
            'Le club accorde à votre agence une enveloppe de places par soirée. Vous la répartissez entre vos promoteurs : en partition (un quota fixe chacun) ou en pool (libre accès jusqu\'à épuisement).',
            'The club grants your agency an envelope of spots per event. You distribute it among your promoters: partition (a fixed quota each) or pool (free access until it runs out).',
          )}
        </p>
      </PromoCard>

      {loading ? (
        <div className="py-14 text-center" style={{ color: T3, fontSize: 13 }}>{tt('Chargement…', 'Loading…')}</div>
      ) : envelopes.length === 0 ? (
        <PromoEmpty
          icon={ClipboardList}
          title={tt('Aucune enveloppe', 'No envelope yet')}
          description={tt(
            'Dès qu\'un club partenaire vous accorde une guest list (dans le contrat ou pour une soirée) et qu\'un de vos promoteurs est assigné à la soirée, l\'enveloppe apparaît ici.',
            'Once a partner club grants you a guest list (in the contract or for an event) and one of your promoters is assigned to it, the envelope shows up here.',
          )}
        />
      ) : (
        <div className="space-y-3">
          {envelopes.map(env => (
            <EnvelopeCard key={env.guest_list_id} env={env} reload={reload} tt={tt} lang={language} />
          ))}
        </div>
      )}
    </div>
  );
}
