import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useAgencyData, promoterName } from '@/hooks/useAgencyData';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { errorToast } from '@/lib/errorToast';
import type { CommissionRules, CommissionRuleTier, CommissionTimeWindow } from '@/types/promoter';
import {
  Plus, Pencil, Trash2, X, ChevronDown, ChevronUp, CheckCircle2, Users, Coins, TrendingUp, Gift, Clock, Wine,
} from 'lucide-react';
import {
  PromoCard, PromoButton, PromoEmpty, PromoAvatar, PromoPill,
  DarkInput, FieldLabel, SectionLabel,
  T1, T2, T3, RED, POS, WARN, INNER_BG, BORDER,
} from '@/components/promoter/promoter-ui';

type TT = (fr: string, en: string, es?: string) => string;

type AgencyCommTemplate = {
  id: string;
  agency_id: string | null;
  name: string;
  rules: CommissionRules;
  created_at: string;
};

// ── Form state ────────────────────────────────────────────────────────────────
type FormState = {
  name: string;
  ticketType: 'percentage' | 'fixed';
  ticketValue: string;
  tableType: 'percentage' | 'fixed';
  tableValue: string;
  useTiers: boolean;
  tiers: { min: string; max: string; value: string }[];
  useBonus: boolean;
  bonusThreshold: string;
  bonusAmount: string;
  useWindows: boolean;
  windows: { before: string; type: 'fixed' | 'percentage'; value: string }[];
  useGl: boolean;
  glNormal: string;
  glDrink: string;
  glVip: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  ticketType: 'percentage', ticketValue: '0',
  tableType: 'percentage', tableValue: '0',
  useTiers: false, tiers: [],
  useBonus: false, bonusThreshold: '', bonusAmount: '',
  useWindows: false, windows: [],
  useGl: false, glNormal: '', glDrink: '', glVip: '',
};

function rulesToForm(name: string, r: CommissionRules): FormState {
  const tiers = (r.tiers ?? []).map(t => ({
    min: String(t.min ?? ''), max: t.max == null ? '' : String(t.max), value: String(t.ticketValue ?? ''),
  }));
  const windows = (r.time_windows ?? []).map(w => ({ before: w.before, type: w.type, value: String(w.value) }));
  const gl = r.guestlist_allocation?.types;
  return {
    name,
    ticketType: r.ticket?.type ?? 'percentage',
    ticketValue: String(r.ticket?.value ?? 0),
    tableType: r.table?.type ?? 'percentage',
    tableValue: String(r.table?.value ?? 0),
    useTiers: tiers.length > 0, tiers,
    useBonus: !!r.bonus, bonusThreshold: r.bonus ? String(r.bonus.threshold) : '', bonusAmount: r.bonus ? String(r.bonus.bonusAmount) : '',
    useWindows: windows.length > 0, windows,
    useGl: !!gl, glNormal: gl?.normal ? String(gl.normal.commission) : '', glDrink: gl?.drink ? String(gl.drink.commission) : '', glVip: gl?.table ? String(gl.table.commission) : '',
  };
}

function buildRules(f: FormState): CommissionRules {
  const rules: CommissionRules = {
    reward_type: 'money',
    ticket: { type: f.ticketType, value: parseFloat(f.ticketValue) || 0 },
    table: { type: f.tableType, value: parseFloat(f.tableValue) || 0 },
  };
  if (f.useTiers) {
    const tiers: CommissionRuleTier[] = f.tiers
      .filter(t => t.min !== '' || t.value !== '')
      .map(t => ({
        min: parseInt(t.min) || 0,
        max: t.max === '' ? null : parseInt(t.max),
        reward_type: 'money' as const,
        ticketValue: parseFloat(t.value) || 0,
      }));
    if (tiers.length) rules.tiers = tiers;
  }
  if (f.useBonus && parseInt(f.bonusThreshold) > 0) {
    rules.bonus = { threshold: parseInt(f.bonusThreshold), bonusAmount: parseFloat(f.bonusAmount) || 0 };
  }
  if (f.useWindows) {
    const windows: CommissionTimeWindow[] = f.windows
      .filter(w => w.before)
      .map(w => ({ before: w.before, type: w.type, value: parseFloat(w.value) || 0 }));
    if (windows.length) rules.time_windows = windows;
  }
  if (f.useGl) {
    // Un promoteur d'agence reçoit ses PLACES via l'enveloppe (spots ignorés) ;
    // ici on ne fixe que la commission PAR TÊTE lue au scan.
    const n = parseFloat(f.glNormal) || 0, d = parseFloat(f.glDrink) || 0, v = parseFloat(f.glVip) || 0;
    if (n > 0 || d > 0 || v > 0) {
      rules.guestlist_allocation = {
        types: {
          normal: { spots: 0, commission: n },
          drink: { spots: 0, commission: d },
          table: { spots: 0, commission: v },
        },
      };
      if (n > 0) rules.guestlist = { value: n }; // repli legacy
    }
  }
  return rules;
}

function summarizeCommission(type: string | undefined, value: number | undefined): string {
  if (!value) return '—';
  return type === 'fixed' ? `${value} €` : `${value}%`;
}

// ── Editor form ───────────────────────────────────────────────────────────────
function TemplateForm({ initial, onSave, onCancel, tt }: {
  initial: FormState; onSave: (f: FormState) => Promise<void>; onCancel: () => void; tt: TT;
}) {
  const [f, setF] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof FormState, v: any) => setF(prev => ({ ...prev, [k]: v }));

  const commTypeOpts = [
    { value: 'percentage', label: tt('Pourcentage (%)', 'Percentage (%)') },
    { value: 'fixed', label: tt('Fixe (€)', 'Fixed (€)') },
  ];

  const save = async () => {
    if (!f.name.trim()) { toast.error(tt('Le nom est requis', 'Name is required')); return; }
    setSaving(true); await onSave(f); setSaving(false);
  };

  const addTier = () => set('tiers', [...f.tiers, { min: '', max: '', value: '' }]);
  const setTier = (i: number, k: 'min' | 'max' | 'value', v: string) =>
    set('tiers', f.tiers.map((t, j) => j === i ? { ...t, [k]: v } : t));
  const rmTier = (i: number) => set('tiers', f.tiers.filter((_, j) => j !== i));

  const addWin = () => set('windows', [...f.windows, { before: '', type: 'fixed', value: '' }]);
  const setWin = (i: number, k: 'before' | 'type' | 'value', v: string) =>
    set('windows', f.windows.map((w, j) => j === i ? { ...w, [k]: v } : w));
  const rmWin = (i: number) => set('windows', f.windows.filter((_, j) => j !== i));

  const Select = ({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) => (
    <select value={value} onChange={e => onChange(e.target.value)} className="w-full outline-none"
      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '8px 10px', color: T1, fontSize: 13, cursor: 'pointer' }}>
      {options.map(o => <option key={o.value} value={o.value} style={{ background: '#111' }}>{o.label}</option>)}
    </select>
  );

  const Toggle = ({ value, onChange, label, icon: Icon }: { value: boolean; onChange: (v: boolean) => void; label: string; icon: any }) => (
    <div className="flex items-center justify-between" style={{ padding: '6px 0' }}>
      <p className="flex items-center gap-2" style={{ color: T2, fontSize: 13 }}><Icon className="h-3.5 w-3.5" style={{ color: T3 }} /> {label}</p>
      <button onClick={() => onChange(!value)} style={{ width: 40, height: 22, borderRadius: 11, cursor: 'pointer', background: value ? RED : 'rgba(255,255,255,0.12)', border: 'none', position: 'relative' }}>
        <span style={{ position: 'absolute', top: 3, left: value ? 20 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
      </button>
    </div>
  );

  return (
    <PromoCard>
      <div className="space-y-4">
        <div>
          <FieldLabel>{tt('Nom du modèle', 'Template name')}</FieldLabel>
          <DarkInput value={f.name} onChange={v => set('name', v)} placeholder={tt('ex. Rémunération standard', 'e.g. Standard pay')} />
        </div>

        {/* Commission de base */}
        <div style={{ borderTop: `1px solid rgba(255,255,255,0.07)`, paddingTop: 12 }}>
          <p className="flex items-center gap-1.5" style={{ color: T3, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            <Coins className="h-3 w-3" /> {tt('Commission de base', 'Base commission')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <FieldLabel>{tt('Billets — type', 'Tickets — type')}</FieldLabel>
              <Select value={f.ticketType} onChange={v => set('ticketType', v)} options={commTypeOpts} />
            </div>
            <div>
              <FieldLabel>{tt('Valeur', 'Value')} ({f.ticketType === 'percentage' ? '%' : '€'})</FieldLabel>
              <DarkInput value={f.ticketValue} onChange={v => set('ticketValue', v)} type="number" placeholder="0" />
            </div>
            <div>
              <FieldLabel>{tt('Tables — type', 'Tables — type')}</FieldLabel>
              <Select value={f.tableType} onChange={v => set('tableType', v)} options={commTypeOpts} />
            </div>
            <div>
              <FieldLabel>{tt('Valeur', 'Value')} ({f.tableType === 'percentage' ? '%' : '€'})</FieldLabel>
              <DarkInput value={f.tableValue} onChange={v => set('tableValue', v)} type="number" placeholder="0" />
            </div>
          </div>
        </div>

        {/* Paliers */}
        <div style={{ borderTop: `1px solid rgba(255,255,255,0.07)`, paddingTop: 8 }}>
          <Toggle value={f.useTiers} onChange={v => set('useTiers', v)} label={tt('Paliers progressifs (par nb de ventes)', 'Progressive tiers (by sale count)')} icon={TrendingUp} />
          {f.useTiers && (
            <div className="space-y-2 pt-1">
              {f.tiers.map((t, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <DarkInput value={t.min} onChange={v => setTier(i, 'min', v)} type="number" placeholder={tt('de', 'from')} />
                  <DarkInput value={t.max} onChange={v => setTier(i, 'max', v)} type="number" placeholder={tt('à (∞)', 'to (∞)')} />
                  <DarkInput value={t.value} onChange={v => setTier(i, 'value', v)} type="number" placeholder="€/vente" />
                  <button onClick={() => rmTier(i)} style={{ color: T3, background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><X className="h-4 w-4" /></button>
                </div>
              ))}
              <PromoButton size="sm" variant="ghost" onClick={addTier}><Plus className="h-3.5 w-3.5" /> {tt('Ajouter un palier', 'Add a tier')}</PromoButton>
            </div>
          )}
        </div>

        {/* Bonus */}
        <div style={{ borderTop: `1px solid rgba(255,255,255,0.07)`, paddingTop: 8 }}>
          <Toggle value={f.useBonus} onChange={v => set('useBonus', v)} label={tt('Bonus au franchissement d\'un seuil', 'One-off bonus at a threshold')} icon={Gift} />
          {f.useBonus && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <FieldLabel>{tt('Seuil (ventes)', 'Threshold (sales)')}</FieldLabel>
                <DarkInput value={f.bonusThreshold} onChange={v => set('bonusThreshold', v)} type="number" placeholder="ex. 50" />
              </div>
              <div>
                <FieldLabel>{tt('Bonus (€)', 'Bonus (€)')}</FieldLabel>
                <DarkInput value={f.bonusAmount} onChange={v => set('bonusAmount', v)} type="number" placeholder="ex. 100" />
              </div>
            </div>
          )}
        </div>

        {/* Fenêtres horaires */}
        <div style={{ borderTop: `1px solid rgba(255,255,255,0.07)`, paddingTop: 8 }}>
          <Toggle value={f.useWindows} onChange={v => set('useWindows', v)} label={tt('Fenêtres horaires à la porte', 'Door time windows')} icon={Clock} />
          {f.useWindows && (
            <div className="space-y-2 pt-1">
              {f.windows.map((w, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <DarkInput value={w.before} onChange={v => setWin(i, 'before', v)} placeholder={tt('avant (HH:MM)', 'before (HH:MM)')} />
                  <Select value={w.type} onChange={v => setWin(i, 'type', v)} options={commTypeOpts} />
                  <DarkInput value={w.value} onChange={v => setWin(i, 'value', v)} type="number" placeholder={tt('valeur', 'value')} />
                  <button onClick={() => rmWin(i)} style={{ color: T3, background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><X className="h-4 w-4" /></button>
                </div>
              ))}
              <PromoButton size="sm" variant="ghost" onClick={addWin}><Plus className="h-3.5 w-3.5" /> {tt('Ajouter une fenêtre', 'Add a window')}</PromoButton>
            </div>
          )}
        </div>

        {/* Commission guest list par tête */}
        <div style={{ borderTop: `1px solid rgba(255,255,255,0.07)`, paddingTop: 8 }}>
          <Toggle value={f.useGl} onChange={v => set('useGl', v)} label={tt('Commission guest list par tête (€)', 'Guest list commission per head (€)')} icon={Wine} />
          {f.useGl && (
            <>
              <p style={{ color: T3, fontSize: 10.5, margin: '2px 0 8px' }}>
                {tt('Les places viennent de l\'enveloppe accordée par le club — ici, seulement le € gagné par invité scanné, par type.',
                  'Spots come from the club\'s envelope — here, only the € earned per scanned guest, by type.')}
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div><FieldLabel>{tt('Normal', 'Standard')}</FieldLabel><DarkInput value={f.glNormal} onChange={v => set('glNormal', v)} type="number" placeholder="€" /></div>
                <div><FieldLabel>{tt('Conso', 'Drink')}</FieldLabel><DarkInput value={f.glDrink} onChange={v => set('glDrink', v)} type="number" placeholder="€" /></div>
                <div><FieldLabel>VIP</FieldLabel><DarkInput value={f.glVip} onChange={v => set('glVip', v)} type="number" placeholder="€" /></div>
              </div>
            </>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <PromoButton onClick={save} disabled={saving} full>{saving ? tt('Enregistrement…', 'Saving…') : tt('Enregistrer le modèle', 'Save template')}</PromoButton>
          <PromoButton variant="ghost" onClick={onCancel}><X className="h-4 w-4" /></PromoButton>
        </div>
      </div>
    </PromoCard>
  );
}

// ── Template card + assign ────────────────────────────────────────────────────
function TemplateCard({ tpl, promoters, groups, agencyId, onEdit, onDelete, onChanged, tt }: {
  tpl: AgencyCommTemplate;
  promoters: ReturnType<typeof useAgencyData>['promoters'];
  groups: ReturnType<typeof useAgencyData>['groups'];
  agencyId: string;
  onEdit: (t: AgencyCommTemplate) => void;
  onDelete: (id: string) => void;
  onChanged: () => void;
  tt: TT;
}) {
  const db = supabase as any;
  const [expanded, setExpanded] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [assignTarget, setAssignTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const assigned = promoters.filter(p => (p as any).default_commission_template_id === tpl.id);
  const r = tpl.rules || {};
  const glCount = r.guestlist_allocation?.types
    ? [r.guestlist_allocation.types.normal, r.guestlist_allocation.types.drink, r.guestlist_allocation.types.table].filter(x => x && x.commission > 0).length
    : 0;

  const assign = async () => {
    if (!assignTarget) { toast.error(tt('Choisissez une cible', 'Choose a target')); return; }
    const [type, id] = assignTarget.split(':');
    setBusy(true);
    const { data, error } = await db.rpc('assign_agency_commission_template', { p_template_id: tpl.id, p_target_type: type, p_target_id: id });
    setBusy(false);
    if (error) { errorToast(error); return; }
    toast.success(`${tt('Appliqué à', 'Applied to')} ${(data as any)?.applied_to ?? 0} ${tt('promoteur(s)', 'promoter(s)')}`);
    setAssignTarget(''); onChanged();
  };

  const unassign = async (promoterId: string) => {
    setBusy(true);
    const { error } = await db.rpc('clear_agency_commission_template', { p_agency_id: agencyId, p_target_type: 'promoter', p_target_id: promoterId });
    setBusy(false);
    if (error) { errorToast(error); return; }
    onChanged();
  };

  return (
    <PromoCard style={{ padding: 0, overflow: 'hidden' }}>
      <div className="flex items-center gap-3" style={{ padding: '12px 14px' }}>
        <div className="min-w-0 flex-1">
          <p style={{ color: T1, fontSize: 14, fontWeight: 640 }}>{tpl.name}</p>
          <div className="flex gap-1 mt-1 flex-wrap">
            <PromoPill tone="warn" style={{ fontSize: 10 }}>🎫 {summarizeCommission(r.ticket?.type, r.ticket?.value)}</PromoPill>
            {r.table?.value ? <PromoPill tone="warn" style={{ fontSize: 10 }}>🍾 {summarizeCommission(r.table?.type, r.table?.value)}</PromoPill> : null}
            {r.tiers?.length ? <PromoPill tone="muted" style={{ fontSize: 10 }}>📈 {r.tiers.length} {tt('paliers', 'tiers')}</PromoPill> : null}
            {r.bonus ? <PromoPill tone="muted" style={{ fontSize: 10 }}>🎁 {r.bonus.bonusAmount}€ @{r.bonus.threshold}</PromoPill> : null}
            {r.time_windows?.length ? <PromoPill tone="muted" style={{ fontSize: 10 }}>⏱ {r.time_windows.length}</PromoPill> : null}
            {glCount > 0 ? <PromoPill tone="muted" style={{ fontSize: 10 }}>🥂 GL €/{tt('tête', 'head')}</PromoPill> : null}
            {assigned.length > 0 ? <PromoPill tone="success" style={{ fontSize: 10 }}><Users className="h-2.5 w-2.5 inline mr-0.5" />{assigned.length}</PromoPill> : null}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-none">
          <button onClick={() => onEdit(tpl)} style={{ color: T3, background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={() => setConfirmDel(true)} style={{ color: T3, background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><Trash2 className="h-3.5 w-3.5" /></button>
          <button onClick={() => setExpanded(x => !x)} style={{ color: T3, background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
        </div>
      </div>

      {confirmDel && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(232,25,44,0.06)' }}>
          <p style={{ color: T1, fontSize: 13, marginBottom: 8 }}>{tt(`Supprimer « ${tpl.name} » ? Les promoteurs qui le portent repassent sur leur commission plate.`, `Delete "${tpl.name}"? Promoters using it fall back to their flat commission.`)}</p>
          <div className="flex gap-2">
            <PromoButton size="sm" variant="danger" onClick={() => onDelete(tpl.id)}>{tt('Supprimer', 'Delete')}</PromoButton>
            <PromoButton size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>{tt('Annuler', 'Cancel')}</PromoButton>
          </div>
        </div>
      )}

      {expanded && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 14px' }}>
          <p style={{ color: T3, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{tt('Appliquer à…', 'Apply to…')}</p>
          <div className="flex gap-2">
            <select value={assignTarget} onChange={e => setAssignTarget(e.target.value)} className="flex-1 outline-none"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '8px 10px', color: T1, fontSize: 12.5, cursor: 'pointer' }}>
              <option value="" style={{ background: '#111' }}>{tt('Choisir…', 'Choose…')}</option>
              {groups.length > 0 && (
                <optgroup label={tt('Groupes', 'Groups')} style={{ background: '#111' }}>
                  {groups.map(g => <option key={g.id} value={`group:${g.id}`} style={{ background: '#111' }}>🔵 {g.name}</option>)}
                </optgroup>
              )}
              <optgroup label={tt('Promoteurs', 'Promoters')} style={{ background: '#111' }}>
                {promoters.map(p => <option key={p.id} value={`promoter:${p.id}`} style={{ background: '#111' }}>{promoterName(p)} {p.venues?.name ? `· ${p.venues.name}` : ''}</option>)}
              </optgroup>
            </select>
            <PromoButton size="sm" onClick={assign} disabled={busy || !assignTarget}>{busy ? '…' : <CheckCircle2 className="h-4 w-4" />}</PromoButton>
          </div>

          {assigned.length > 0 && (
            <div className="mt-3">
              <p style={{ color: T3, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{tt('Assigné à', 'Assigned to')} ({assigned.length})</p>
              <div className="flex flex-wrap gap-2">
                {assigned.map(p => (
                  <div key={p.id} className="flex items-center gap-1.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 20, padding: '3px 6px 3px 4px' }}>
                    <PromoAvatar src={p.profile_image_url} fallback={promoterName(p).slice(0, 1)} size={20} />
                    <p style={{ color: T2, fontSize: 12 }}>{promoterName(p)}</p>
                    <button onClick={() => unassign(p.id)} title={tt('Retirer', 'Remove')} style={{ color: T3, background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </PromoCard>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AgencyCommissionTemplates() {
  const { agency } = useAgency();
  const { promoters, groups, refetch } = useAgencyData(agency?.id ?? null);
  const { language } = useLanguage();
  const tt: TT = (fr, en, es) => translate(language, fr, en, es);
  const db = supabase as any;

  const [templates, setTemplates] = useState<AgencyCommTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AgencyCommTemplate | null>(null);

  const load = useCallback(async () => {
    if (!agency?.id) return;
    setLoading(true);
    const { data, error } = await db.from('commission_templates').select('id, agency_id, name, rules, created_at')
      .eq('agency_id', agency.id).order('created_at', { ascending: true });
    if (error) {
      console.error('commission templates load error:', error);
      toast.error(tt('Impossible de charger les modèles. Réessaie.', "Couldn't load templates. Try again.", 'No se pudieron cargar las plantillas. Reintenta.'));
    }
    setTemplates((data ?? []) as AgencyCommTemplate[]);
    setLoading(false);
  }, [agency?.id]);

  useEffect(() => { load(); }, [load]);

  const initialForm = useMemo(() => editing ? rulesToForm(editing.name, editing.rules || {}) : EMPTY_FORM, [editing]);

  const handleSave = async (f: FormState) => {
    const payload = { name: f.name.trim(), rules: buildRules(f), updated_at: new Date().toISOString() };
    if (editing) {
      const { error } = await db.from('commission_templates').update(payload).eq('id', editing.id);
      if (error) { errorToast(error); return; }
      toast.success(tt('Modèle mis à jour', 'Template updated'));
    } else {
      const { error } = await db.from('commission_templates').insert({ ...payload, agency_id: agency!.id });
      if (error) { errorToast(error); return; }
      toast.success(tt('Modèle créé', 'Template created'));
    }
    setFormOpen(false); setEditing(null); load();
  };

  const handleDelete = async (id: string) => {
    const { error } = await db.from('commission_templates').delete().eq('id', id);
    if (error) { errorToast(error); return; }
    toast.success(tt('Modèle supprimé', 'Template deleted'));
    load(); refetch();
  };

  if (loading) return <div className="py-16 text-center" style={{ color: T3, fontSize: 13 }}>{tt('Chargement…', 'Loading…')}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionLabel>{tt('Modèles de rémunération', 'Pay templates')}</SectionLabel>
        <PromoButton size="sm" onClick={() => { setEditing(null); setFormOpen(true); }} disabled={formOpen}>
          <Plus className="h-4 w-4" /> {tt('Créer', 'Create')}
        </PromoButton>
      </div>

      <PromoCard style={{ padding: '11px 13px' }}>
        <p style={{ color: T2, fontSize: 12, lineHeight: 1.5 }}>
          {tt('Rémunération avancée pour tes promoteurs : paliers, bonus, fenêtres horaires et commission guest list par tête. Un modèle assigné remplace la commission plate du promoteur ; tes plafonds (page Règles) s\'appliquent toujours par-dessus.',
            'Advanced pay for your promoters: tiers, bonuses, door time windows and per-head guest list commission. An assigned template replaces the promoter\'s flat commission; your caps (Rules page) still apply on top.')}
        </p>
      </PromoCard>

      {formOpen && <TemplateForm initial={initialForm} onSave={handleSave} onCancel={() => { setFormOpen(false); setEditing(null); }} tt={tt} />}

      {!formOpen && templates.length === 0 && (
        <PromoEmpty icon={Coins} title={tt('Aucun modèle', 'No templates')}
          description={tt('Crée un modèle de rémunération et applique-le à un promoteur ou un groupe en un clic.', 'Create a pay template and apply it to a promoter or group in one click.')} />
      )}

      {!formOpen && templates.length > 0 && (
        <div className="space-y-2">
          {templates.map(tpl => (
            <TemplateCard key={tpl.id} tpl={tpl} promoters={promoters} groups={groups} agencyId={agency!.id}
              onEdit={t => { setEditing(t); setFormOpen(true); }} onDelete={handleDelete} onChanged={() => { load(); refetch(); }} tt={tt} />
          ))}
        </div>
      )}
    </div>
  );
}
