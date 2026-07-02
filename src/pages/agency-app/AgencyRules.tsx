import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useAgencyData, promoterName } from '@/hooks/useAgencyData';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import {
  Plus, Pencil, Trash2, X, ChevronDown, ChevronUp,
  Ticket, Layers, Users, CheckCircle2, ShieldCheck, Tag,
} from 'lucide-react';
import {
  PromoCard, PromoButton, PromoEmpty, PromoAvatar, PromoPill,
  DarkInput, FieldLabel, SectionLabel,
  T1, T2, T3, RED, POS, WARN, INNER_BG, BORDER,
} from '@/components/promoter/promoter-ui';

// ─── Types ────────────────────────────────────────────────────────────────────
type RuleTemplate = {
  id: string;
  agency_id: string;
  name: string;
  description: string | null;
  color: string;
  is_default: boolean;
  can_sell_tickets: boolean;
  can_sell_tables: boolean;
  can_scan_entries: boolean;
  guestlist_quota: number | null;
  ticket_cap: number | null;
  table_cap: number | null;
  ticket_commission_type: string;
  ticket_commission_value: number;
  table_commission_type: string;
  table_commission_value: number;
  customer_discount_type: string;
  customer_discount_value: number;
  created_at: string;
};

type FormState = {
  name: string;
  description: string;
  color: string;
  can_sell_tickets: boolean;
  can_sell_tables: boolean;
  can_scan_entries: boolean;
  guestlist_quota: string;
  ticket_cap: string;
  table_cap: string;
  ticket_commission_type: string;
  ticket_commission_value: string;
  table_commission_type: string;
  table_commission_value: string;
  customer_discount_type: string;
  customer_discount_value: string;
};

const COLORS = ['#E8192C', '#34D399', '#FBBF24', '#6366F1', '#EC4899', '#14B8A6', '#F97316'];
const DEFAULT_FORM: FormState = {
  name: '', description: '', color: COLORS[0],
  can_sell_tickets: true, can_sell_tables: false, can_scan_entries: false,
  guestlist_quota: '', ticket_cap: '', table_cap: '',
  ticket_commission_type: 'percentage', ticket_commission_value: '0',
  table_commission_type: 'percentage', table_commission_value: '0',
  customer_discount_type: 'none', customer_discount_value: '0',
};

// ─── Sub-components ───────────────────────────────────────────────────────────
function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex gap-2">
      {COLORS.map(c => (
        <button key={c} onClick={() => onChange(c)} style={{
          width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer',
          border: value === c ? '2px solid #fff' : '2px solid transparent',
          boxShadow: value === c ? `0 0 0 1.5px ${c}` : 'none',
        }} />
      ))}
    </div>
  );
}

function Toggle({
  value, onChange, label,
}: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center justify-between" style={{ padding: '8px 0' }}>
      <p style={{ color: T2, fontSize: 13 }}>{label}</p>
      <button
        onClick={() => onChange(!value)}
        style={{
          width: 40, height: 22, borderRadius: 11, cursor: 'pointer',
          background: value ? RED : 'rgba(255,255,255,0.12)',
          border: 'none', position: 'relative', transition: 'background .2s',
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: value ? 20 : 3,
          width: 16, height: 16, borderRadius: '50%', background: '#fff',
          transition: 'left .2s',
        }} />
      </button>
    </div>
  );
}

function TypeSelect({
  value, onChange, options,
}: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full outline-none"
      style={{
        background: INNER_BG, border: `1px solid ${BORDER}`,
        borderRadius: 10, padding: '8px 10px', color: T1, fontSize: 13, cursor: 'pointer',
      }}
    >
      {options.map(o => (
        <option key={o.value} value={o.value} style={{ background: '#111' }}>{o.label}</option>
      ))}
    </select>
  );
}

// Commission / discount summary label
function summarize(type: string, value: number, tt: (f: string, e: string) => string) {
  if (type === 'none' || value === 0) return tt('Aucune', 'None');
  if (type === 'percentage') return `${value}%`;
  return `${value} €`;
}

// ─── Rule form ────────────────────────────────────────────────────────────────
function RuleForm({
  initial, onSave, onCancel, tt,
}: {
  initial: FormState;
  onSave: (f: FormState) => Promise<void>;
  onCancel: () => void;
  tt: (fr: string, en: string) => string;
}) {
  const [f, setF] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof FormState, v: any) => setF(prev => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    if (!f.name.trim()) { toast.error(tt('Le nom est requis', 'Name is required')); return; }
    setSaving(true);
    await onSave(f);
    setSaving(false);
  };

  const commissionTypeOpts = [
    { value: 'percentage', label: tt('Pourcentage (%)', 'Percentage (%)') },
    { value: 'fixed',      label: tt('Fixe (€)',        'Fixed (€)') },
  ];
  const discountTypeOpts = [
    { value: 'none',       label: tt('Aucune remise',    'No discount') },
    { value: 'percentage', label: tt('Pourcentage (%)', 'Percentage (%)') },
    { value: 'fixed',      label: tt('Fixe (€)',        'Fixed (€)') },
  ];

  return (
    <PromoCard>
      <div className="space-y-4">
        {/* Identity */}
        <div>
          <FieldLabel>{tt('Nom du modèle', 'Template name')}</FieldLabel>
          <DarkInput value={f.name} onChange={v => set('name', v)}
            placeholder={tt('ex. Promoteur standard', 'e.g. Standard promoter')} />
        </div>
        <div>
          <FieldLabel>{tt('Description (optionnelle)', 'Description (optional)')}</FieldLabel>
          <DarkInput value={f.description} onChange={v => set('description', v)}
            placeholder={tt('Décrit ce modèle en une ligne', 'Describe this template')} />
        </div>
        <div>
          <FieldLabel>{tt('Couleur', 'Color')}</FieldLabel>
          <ColorPicker value={f.color} onChange={c => set('color', c)} />
        </div>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 12 }}>
          <p style={{ color: T3, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            {tt('Permissions', 'Permissions')}
          </p>
          <Toggle value={f.can_sell_tickets} onChange={v => set('can_sell_tickets', v)}
            label={tt('Vente de billets', 'Sell tickets')} />
          {f.can_sell_tickets && (
            <div className="pl-4 pb-1">
              <FieldLabel>{tt('Plafond billets (vide = illimité)', 'Ticket cap (empty = unlimited)')}</FieldLabel>
              <DarkInput value={f.ticket_cap} onChange={v => set('ticket_cap', v)}
                type="number" placeholder={tt('Illimité', 'Unlimited')} />
            </div>
          )}
          <Toggle value={f.can_sell_tables} onChange={v => set('can_sell_tables', v)}
            label={tt('Vente de tables VIP', 'Sell VIP tables')} />
          {f.can_sell_tables && (
            <div className="pl-4 pb-1">
              <FieldLabel>{tt('Plafond tables (vide = illimité)', 'Table cap (empty = unlimited)')}</FieldLabel>
              <DarkInput value={f.table_cap} onChange={v => set('table_cap', v)}
                type="number" placeholder={tt('Illimité', 'Unlimited')} />
            </div>
          )}
          <Toggle value={f.can_scan_entries} onChange={v => set('can_scan_entries', v)}
            label={tt('Scanner les entrées', 'Scan entries')} />
          <div style={{ paddingTop: 4 }}>
            <FieldLabel>
              {tt('Quota guest list (vide = non autorisé, 0 = illimité)', 'Guest list quota (empty = not allowed, 0 = unlimited)')}
            </FieldLabel>
            <DarkInput value={f.guestlist_quota} onChange={v => set('guestlist_quota', v)}
              type="number" placeholder={tt('Non autorisé', 'Not authorized')} />
          </div>
        </div>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 12 }}>
          <p style={{ color: T3, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            {tt('Commission promoteur', 'Promoter commission')}
          </p>
          <div className="space-y-3">
            <div>
              <FieldLabel>{tt('Type commission billets', 'Ticket commission type')}</FieldLabel>
              <TypeSelect value={f.ticket_commission_type}
                onChange={v => set('ticket_commission_type', v)} options={commissionTypeOpts} />
            </div>
            <div>
              <FieldLabel>
                {tt('Valeur', 'Value')} ({f.ticket_commission_type === 'percentage' ? '%' : '€'})
              </FieldLabel>
              <DarkInput value={f.ticket_commission_value}
                onChange={v => set('ticket_commission_value', v)} type="number" placeholder="0" />
            </div>
            {f.can_sell_tables && (
              <>
                <div>
                  <FieldLabel>{tt('Type commission tables', 'Table commission type')}</FieldLabel>
                  <TypeSelect value={f.table_commission_type}
                    onChange={v => set('table_commission_type', v)} options={commissionTypeOpts} />
                </div>
                <div>
                  <FieldLabel>
                    {tt('Valeur tables', 'Table value')} ({f.table_commission_type === 'percentage' ? '%' : '€'})
                  </FieldLabel>
                  <DarkInput value={f.table_commission_value}
                    onChange={v => set('table_commission_value', v)} type="number" placeholder="0" />
                </div>
              </>
            )}
          </div>
        </div>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 12 }}>
          <p style={{ color: T3, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            {tt('Remise client (code promo)', 'Client discount (promo code)')}
          </p>
          <div className="space-y-3">
            <TypeSelect value={f.customer_discount_type}
              onChange={v => set('customer_discount_type', v)} options={discountTypeOpts} />
            {f.customer_discount_type !== 'none' && (
              <div>
                <FieldLabel>
                  {tt('Valeur remise', 'Discount value')} ({f.customer_discount_type === 'percentage' ? '%' : '€'})
                </FieldLabel>
                <DarkInput value={f.customer_discount_value}
                  onChange={v => set('customer_discount_value', v)} type="number" placeholder="0" />
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <PromoButton onClick={handleSave} disabled={saving} full>
            {saving ? tt('Enregistrement…', 'Saving…') : tt('Enregistrer le modèle', 'Save template')}
          </PromoButton>
          <PromoButton variant="ghost" onClick={onCancel}>
            <X className="h-4 w-4" />
          </PromoButton>
        </div>
      </div>
    </PromoCard>
  );
}

// ─── Template card ────────────────────────────────────────────────────────────
function TemplateCard({
  tpl, promoters, groups, onEdit, onDelete, tt,
}: {
  tpl: RuleTemplate;
  promoters: ReturnType<typeof useAgencyData>['promoters'];
  groups: ReturnType<typeof useAgencyData>['groups'];
  onEdit: (t: RuleTemplate) => void;
  onDelete: (id: string) => void;
  tt: (fr: string, en: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignTarget, setAssignTarget] = useState('');
  const db = supabase as any;

  const assigned = promoters.filter(p => (p as any).agency_rule_template_id === tpl.id);

  const handleAssign = async () => {
    if (!assignTarget) { toast.error(tt('Choisissez une cible', 'Choose a target')); return; }
    setAssigning(true);
    const [type, id] = assignTarget.split(':');
    const { data, error } = await db.rpc('apply_agency_rule_template', {
      p_template_id: tpl.id,
      p_target_type: type,
      p_target_id: id,
    });
    setAssigning(false);
    if (error) { toast.error(error.message); return; }
    const count = (data as any)?.applied_to ?? 0;
    toast.success(`${tt('Appliqué à', 'Applied to')} ${count} ${tt('promoteur(s)', 'promoter(s)')}`);
    setAssignTarget('');
  };

  return (
    <PromoCard style={{ padding: 0, overflow: 'hidden' }}>
      <div className="flex items-center gap-3" style={{ padding: '12px 14px' }}>
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: tpl.color, flexShrink: 0 }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p style={{ color: T1, fontSize: 14, fontWeight: 640 }}>{tpl.name}</p>
            {tpl.is_default && (
              <PromoPill tone="success" style={{ fontSize: 10 }}>{tt('Défaut', 'Default')}</PromoPill>
            )}
          </div>
          {tpl.description && (
            <p className="truncate" style={{ color: T3, fontSize: 11.5 }}>{tpl.description}</p>
          )}
          {/* Badges résumé */}
          <div className="flex gap-1 mt-1 flex-wrap">
            {tpl.can_sell_tickets && (
              <PromoPill tone="success" style={{ fontSize: 10 }}>
                <Ticket className="h-2.5 w-2.5 inline mr-0.5" />
                {tt('Billets', 'Tickets')}
                {tpl.ticket_cap ? ` ≤${tpl.ticket_cap}` : ''}
              </PromoPill>
            )}
            {tpl.can_sell_tables && (
              <PromoPill tone="success" style={{ fontSize: 10 }}>
                🍾 {tt('Tables', 'Tables')}
                {tpl.table_cap ? ` ≤${tpl.table_cap}` : ''}
              </PromoPill>
            )}
            {tpl.guestlist_quota !== null && tpl.guestlist_quota !== undefined && (
              <PromoPill tone="muted" style={{ fontSize: 10 }}>
                👥 GL {tpl.guestlist_quota === 0 ? '∞' : tpl.guestlist_quota}
              </PromoPill>
            )}
            {tpl.can_scan_entries && (
              <PromoPill tone="muted" style={{ fontSize: 10 }}>
                <ShieldCheck className="h-2.5 w-2.5 inline mr-0.5" />Scan
              </PromoPill>
            )}
            {(tpl.ticket_commission_value > 0 || tpl.table_commission_value > 0) && (
              <PromoPill tone="warn" style={{ fontSize: 10 }}>
                💰 {summarize(tpl.ticket_commission_type, tpl.ticket_commission_value, tt)}
              </PromoPill>
            )}
            {tpl.customer_discount_type !== 'none' && tpl.customer_discount_value > 0 && (
              <PromoPill tone="warn" style={{ fontSize: 10 }}>
                <Tag className="h-2.5 w-2.5 inline mr-0.5" />
                -{summarize(tpl.customer_discount_type, tpl.customer_discount_value, tt)}
              </PromoPill>
            )}
            {assigned.length > 0 && (
              <PromoPill tone="muted" style={{ fontSize: 10 }}>
                <Users className="h-2.5 w-2.5 inline mr-0.5" />
                {assigned.length}
              </PromoPill>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-none">
          <button onClick={() => onEdit(tpl)} style={iconBtn}><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={() => setConfirmDel(true)} style={iconBtn}><Trash2 className="h-3.5 w-3.5" /></button>
          <button onClick={() => setExpanded(x => !x)} style={iconBtn}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Confirm delete */}
      {confirmDel && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(232,25,44,0.06)' }}>
          <p style={{ color: T1, fontSize: 13, marginBottom: 8 }}>
            {tt(`Supprimer "${tpl.name}" ? Les promoteurs garderont leurs droits actuels.`, `Delete "${tpl.name}"? Promoters will keep their current permissions.`)}
          </p>
          <div className="flex gap-2">
            <PromoButton size="sm" variant="danger" onClick={() => onDelete(tpl.id)}>
              {tt('Supprimer', 'Delete')}
            </PromoButton>
            <PromoButton size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>
              {tt('Annuler', 'Cancel')}
            </PromoButton>
          </div>
        </div>
      )}

      {/* Expanded: assign + who has it */}
      {expanded && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 14px' }}>
          {/* Assign UI */}
          <p style={{ color: T3, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            {tt('Appliquer à…', 'Apply to…')}
          </p>
          <div className="flex gap-2">
            <select
              value={assignTarget}
              onChange={e => setAssignTarget(e.target.value)}
              className="flex-1 outline-none"
              style={{
                background: INNER_BG, border: `1px solid ${BORDER}`,
                borderRadius: 10, padding: '8px 10px', color: T1, fontSize: 12.5, cursor: 'pointer',
              }}
            >
              <option value="" style={{ background: '#111' }}>{tt('Choisir…', 'Choose…')}</option>
              {groups.length > 0 && (
                <optgroup label={tt('Groupes', 'Groups')} style={{ background: '#111' }}>
                  {groups.map(g => (
                    <option key={g.id} value={`group:${g.id}`} style={{ background: '#111' }}>
                      🔵 {g.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label={tt('Promoteurs', 'Promoters')} style={{ background: '#111' }}>
                {promoters.map(p => (
                  <option key={p.id} value={`promoter:${p.id}`} style={{ background: '#111' }}>
                    {promoterName(p)} {p.venues?.name ? `· ${p.venues.name}` : ''}
                  </option>
                ))}
              </optgroup>
            </select>
            <PromoButton size="sm" onClick={handleAssign} disabled={assigning || !assignTarget}>
              {assigning ? '…' : <CheckCircle2 className="h-4 w-4" />}
            </PromoButton>
          </div>

          {/* Promoters currently using this template */}
          {assigned.length > 0 && (
            <div className="mt-3">
              <p style={{ color: T3, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                {tt('Actuellement assigné', 'Currently assigned')} ({assigned.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {assigned.map(p => (
                  <div key={p.id} className="flex items-center gap-1.5" style={{
                    background: INNER_BG, border: `1px solid ${BORDER}`,
                    borderRadius: 20, padding: '3px 10px 3px 4px',
                  }}>
                    <PromoAvatar src={p.profile_image_url} fallback={promoterName(p).slice(0, 1)} size={20} />
                    <p style={{ color: T2, fontSize: 12 }}>{promoterName(p)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Permissions detail */}
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1" style={{ fontSize: 12, color: T3 }}>
            <span>🎫 {tt('Billets', 'Tickets')}: <span style={{ color: tpl.can_sell_tickets ? POS : WARN }}>
              {tpl.can_sell_tickets ? `✓${tpl.ticket_cap ? ` ≤${tpl.ticket_cap}` : ''}` : '✗'}
            </span></span>
            <span>🍾 {tt('Tables', 'Tables')}: <span style={{ color: tpl.can_sell_tables ? POS : WARN }}>
              {tpl.can_sell_tables ? `✓${tpl.table_cap ? ` ≤${tpl.table_cap}` : ''}` : '✗'}
            </span></span>
            <span>👥 {tt('Guest list', 'Guest list')}: <span style={{ color: tpl.guestlist_quota !== null ? POS : WARN }}>
              {tpl.guestlist_quota !== null ? (tpl.guestlist_quota === 0 ? '∞' : tpl.guestlist_quota) : '✗'}
            </span></span>
            <span>🔍 {tt('Scanner', 'Scanner')}: <span style={{ color: tpl.can_scan_entries ? POS : WARN }}>
              {tpl.can_scan_entries ? '✓' : '✗'}
            </span></span>
            <span>💰 {tt('Comm. billet', 'Ticket comm.')}: {summarize(tpl.ticket_commission_type, tpl.ticket_commission_value, tt)}</span>
            <span>💰 {tt('Comm. table', 'Table comm.')}: {summarize(tpl.table_commission_type, tpl.table_commission_value, tt)}</span>
            <span style={{ gridColumn: '1/-1' }}>
              🏷 {tt('Remise client', 'Client discount')}: {summarize(tpl.customer_discount_type, tpl.customer_discount_value, tt)}
            </span>
          </div>
        </div>
      )}
    </PromoCard>
  );
}

const iconBtn: React.CSSProperties = {
  color: T3, cursor: 'pointer', background: 'none', border: 'none', padding: 4,
};

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AgencyRules() {
  const { agency } = useAgency();
  const { promoters, groups } = useAgencyData(agency?.id ?? null);
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => translate(language, fr, en);
  const db = supabase as any;

  const [templates, setTemplates] = useState<RuleTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTpl, setEditingTpl] = useState<RuleTemplate | null>(null);

  const loadTemplates = useCallback(async () => {
    if (!agency?.id) return;
    setLoading(true);
    const { data } = await db
      .from('agency_rule_templates')
      .select('*')
      .eq('agency_id', agency.id)
      .order('created_at', { ascending: true });
    setTemplates((data ?? []) as RuleTemplate[]);
    setLoading(false);
  }, [agency?.id]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const formToDb = (f: FormState) => ({
    name:                    f.name.trim(),
    description:             f.description.trim() || null,
    color:                   f.color,
    can_sell_tickets:        f.can_sell_tickets,
    can_sell_tables:         f.can_sell_tables,
    can_scan_entries:        f.can_scan_entries,
    guestlist_quota:         f.guestlist_quota !== '' ? parseInt(f.guestlist_quota) : null,
    ticket_cap:              f.ticket_cap  !== '' ? parseInt(f.ticket_cap)  : null,
    table_cap:               f.table_cap   !== '' ? parseInt(f.table_cap)   : null,
    ticket_commission_type:  f.ticket_commission_type,
    ticket_commission_value: parseFloat(f.ticket_commission_value) || 0,
    table_commission_type:   f.table_commission_type,
    table_commission_value:  parseFloat(f.table_commission_value) || 0,
    customer_discount_type:  f.customer_discount_type,
    customer_discount_value: parseFloat(f.customer_discount_value) || 0,
    updated_at:              new Date().toISOString(),
  });

  const handleSave = async (f: FormState) => {
    if (editingTpl) {
      const { error } = await db.from('agency_rule_templates').update(formToDb(f)).eq('id', editingTpl.id);
      if (error) { toast.error(error.message); return; }
      toast.success(tt('Modèle mis à jour', 'Template updated'));
    } else {
      const { error } = await db.from('agency_rule_templates').insert({
        ...formToDb(f), agency_id: agency!.id,
      });
      if (error) { toast.error(error.message); return; }
      toast.success(tt('Modèle créé', 'Template created'));
    }
    setFormOpen(false);
    setEditingTpl(null);
    loadTemplates();
  };

  const handleDelete = async (id: string) => {
    const { error } = await db.from('agency_rule_templates').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success(tt('Modèle supprimé', 'Template deleted'));
    loadTemplates();
  };

  const openEdit = (tpl: RuleTemplate) => {
    setEditingTpl(tpl);
    setFormOpen(true);
  };

  const openCreate = () => {
    setEditingTpl(null);
    setFormOpen(true);
  };

  const initialForm: FormState = useMemo(() => {
    if (!editingTpl) return DEFAULT_FORM;
    return {
      name: editingTpl.name,
      description: editingTpl.description ?? '',
      color: editingTpl.color,
      can_sell_tickets: editingTpl.can_sell_tickets,
      can_sell_tables: editingTpl.can_sell_tables,
      can_scan_entries: editingTpl.can_scan_entries,
      guestlist_quota: editingTpl.guestlist_quota?.toString() ?? '',
      ticket_cap: editingTpl.ticket_cap?.toString() ?? '',
      table_cap: editingTpl.table_cap?.toString() ?? '',
      ticket_commission_type: editingTpl.ticket_commission_type,
      ticket_commission_value: editingTpl.ticket_commission_value.toString(),
      table_commission_type: editingTpl.table_commission_type,
      table_commission_value: editingTpl.table_commission_value.toString(),
      customer_discount_type: editingTpl.customer_discount_type,
      customer_discount_value: editingTpl.customer_discount_value.toString(),
    };
  }, [editingTpl]);

  // Per-template summary: how many promoters have each template
  const templateAssignmentCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of promoters) {
      const tid = (p as any).agency_rule_template_id;
      if (tid) map.set(tid, (map.get(tid) ?? 0) + 1);
    }
    return map;
  }, [promoters]);

  if (loading) {
    return <div className="py-16 text-center" style={{ color: T3, fontSize: 13 }}>{tt('Chargement…', 'Loading…')}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionLabel>{tt('Modèles de règles', 'Rule templates')}</SectionLabel>
        <PromoButton size="sm" onClick={openCreate} disabled={formOpen}>
          <Plus className="h-4 w-4" /> {tt('Créer', 'Create')}
        </PromoButton>
      </div>

      {/* Explanation */}
      {templates.length === 0 && !formOpen && (
        <PromoEmpty
          icon={Layers}
          title={tt('Aucun modèle', 'No templates')}
          description={tt(
            'Créez des modèles définissant les droits, commissions et remises. Appliquez-les à vos promoteurs ou groupes en un clic.',
            'Create templates defining rights, commissions and discounts. Apply them to your promoters or groups in one click.',
          )}
        />
      )}

      {/* Create / edit form */}
      {formOpen && (
        <RuleForm
          initial={initialForm}
          onSave={handleSave}
          onCancel={() => { setFormOpen(false); setEditingTpl(null); }}
          tt={tt}
        />
      )}

      {/* Templates list */}
      {templates.length > 0 && !formOpen && (
        <div className="space-y-2">
          {templates.map(tpl => (
            <TemplateCard
              key={tpl.id}
              tpl={tpl}
              promoters={promoters}
              groups={groups}
              onEdit={openEdit}
              onDelete={handleDelete}
              tt={tt}
            />
          ))}
        </div>
      )}

      {/* Promoters without a template */}
      {templates.length > 0 && !formOpen && (
        (() => {
          const noTpl = promoters.filter(p => !(p as any).agency_rule_template_id);
          if (noTpl.length === 0) return null;
          return (
            <>
              <SectionLabel>{tt('Sans modèle', 'No template')} ({noTpl.length})</SectionLabel>
              <PromoCard style={{ padding: 8 }}>
                {noTpl.map((p, i) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3"
                    style={{ padding: '7px 6px', borderBottom: i < noTpl.length - 1 ? '1px solid rgba(255,255,255,0.04)' : undefined }}
                  >
                    <PromoAvatar src={p.profile_image_url} fallback={promoterName(p).slice(0, 1)} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate" style={{ color: T1, fontSize: 13 }}>{promoterName(p)}</p>
                      <p className="truncate" style={{ color: T3, fontSize: 10.5 }}>{p.venues?.name || ''}</p>
                    </div>
                    <PromoPill tone="warn" style={{ fontSize: 10 }}>{tt('Aucun modèle', 'No template')}</PromoPill>
                  </div>
                ))}
              </PromoCard>
            </>
          );
        })()
      )}
    </div>
  );
}
