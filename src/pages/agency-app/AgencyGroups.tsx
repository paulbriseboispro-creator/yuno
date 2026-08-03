import { useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useAgencyData, promoterName, AgencyPromoterGroup } from '@/hooks/useAgencyData';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { errorToast } from '@/lib/errorToast';
import { Layers, Plus, Pencil, Trash2, X, ChevronDown, ChevronUp, UserMinus } from 'lucide-react';
import {
  PromoCard, PromoButton, PromoEmpty, PromoAvatar, PromoPill, DarkInput, FieldLabel, SectionLabel,
  T1, T2, T3, RED, INNER_BG, BORDER,
} from '@/components/promoter/promoter-ui';

const COLORS = ['#E8192C', '#34D399', '#FBBF24', '#6366F1', '#EC4899', '#14B8A6', '#F97316'];

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {COLORS.map(c => (
        <button
          key={c}
          onClick={() => onChange(c)}
          style={{
            width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer',
            border: value === c ? '2px solid #fff' : '2px solid transparent',
            boxShadow: value === c ? `0 0 0 1px ${c}` : 'none',
          }}
        />
      ))}
    </div>
  );
}

type EditState = { name: string; color: string; description: string };
const DEFAULT_EDIT: EditState = { name: '', color: COLORS[0], description: '' };

// Éditeur d'override de chef de groupe (matérialise une équipe-ombre promoter_teams).
function GroupOverrideEditor({ group, members, tt, onSaved }: {
  group: AgencyPromoterGroup;
  members: { id: string; first_name: string | null; last_name: string | null; name: string | null; promo_code: string | null }[];
  tt: (fr: string, en: string, es?: string) => string;
  onSaved: () => void;
}) {
  const db = supabase as any;
  const [leader, setLeader] = useState(group.leader_promoter_id ?? '');
  const [type, setType] = useState<'percentage' | 'fixed'>(group.override_type ?? 'percentage');
  const [value, setValue] = useState(group.override_value ? String(group.override_value) : '');
  const [busy, setBusy] = useState(false);

  const call = async (clear: boolean) => {
    setBusy(true);
    const { error } = await db.rpc('set_agency_group_override', {
      p_group_id: group.id,
      p_leader_promoter_id: clear ? null : (leader || null),
      p_override_type: clear ? null : type,
      p_override_value: clear ? 0 : (value.trim() === '' ? 0 : parseFloat(value) || 0),
    });
    setBusy(false);
    if (error) { errorToast(error); return; }
    toast.success(clear ? tt('Override retiré', 'Override removed') : tt('Override enregistré', 'Override saved'));
    onSaved();
  };

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <p style={{ color: T3, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
        {tt('Chef de groupe (commission override)', 'Group leader (override commission)')}
      </p>
      <p style={{ color: T3, fontSize: 10.5, marginBottom: 8 }}>
        {tt('Le chef touche une part de chaque vente des membres du groupe (prélevée sur leur commission).',
          'The leader earns a cut of every member sale in the group (taken from their commission).')}
      </p>
      {members.length === 0 ? (
        <p style={{ color: T3, fontSize: 12 }}>{tt('Ajoutez des membres pour désigner un chef.', 'Add members to pick a leader.')}</p>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <select value={leader} onChange={e => setLeader(e.target.value)}
            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '7px 9px', color: T1, fontSize: 12.5, cursor: 'pointer' }}>
            <option value="" style={{ background: '#111' }}>{tt('Aucun chef', 'No leader')}</option>
            {members.map(m => <option key={m.id} value={m.id} style={{ background: '#111' }}>{promoterName(m)}</option>)}
          </select>
          <select value={type} onChange={e => setType(e.target.value as 'percentage' | 'fixed')}
            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '7px 9px', color: T1, fontSize: 12.5, cursor: 'pointer' }}>
            <option value="percentage" style={{ background: '#111' }}>%</option>
            <option value="fixed" style={{ background: '#111' }}>€</option>
          </select>
          <input type="number" min={0} value={value} onChange={e => setValue(e.target.value)}
            placeholder={type === 'percentage' ? '% ' + tt('de la commission', 'of commission') : '€/' + tt('vente', 'sale')}
            className="outline-none" style={{ width: 120, background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '7px 9px', color: T1, fontSize: 12.5 }} />
          <PromoButton size="sm" onClick={() => call(false)} disabled={busy || !leader || value.trim() === ''}>{tt('Enregistrer', 'Save')}</PromoButton>
          {group.leader_promoter_id && (
            <PromoButton size="sm" variant="ghost" onClick={() => call(true)} disabled={busy}>{tt('Retirer', 'Clear')}</PromoButton>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgencyGroups() {
  const { agency } = useAgency();
  const { promoters, groups, loading, refetch } = useAgencyData(agency?.id ?? null);
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<EditState>(DEFAULT_EDIT);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const db = supabase as any;

  const membersByGroup = useMemo(() => {
    const map = new Map<string, typeof promoters>();
    for (const p of promoters) {
      if (!p.agency_group_id) continue;
      if (!map.has(p.agency_group_id)) map.set(p.agency_group_id, []);
      map.get(p.agency_group_id)!.push(p);
    }
    return map;
  }, [promoters]);

  const ungrouped = promoters.filter(p => !p.agency_group_id);

  const openCreate = () => {
    setEditId(null);
    setForm(DEFAULT_EDIT);
    setFormOpen(true);
  };

  const openEdit = (g: AgencyPromoterGroup) => {
    setEditId(g.id);
    setForm({ name: g.name, color: g.color, description: g.description ?? '' });
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error(tt('Le nom est requis', 'Name is required')); return; }
    setSaving(true);
    if (editId) {
      const { error } = await db.from('agency_promoter_groups')
        .update({ name: form.name.trim(), color: form.color, description: form.description.trim() || null, updated_at: new Date().toISOString() })
        .eq('id', editId);
      if (error) { errorToast(error); setSaving(false); return; }
    } else {
      const { error } = await db.from('agency_promoter_groups')
        .insert({ agency_id: agency!.id, name: form.name.trim(), color: form.color, description: form.description.trim() || null });
      if (error) { errorToast(error); setSaving(false); return; }
    }
    setSaving(false);
    toast.success(editId ? tt('Groupe mis à jour', 'Group updated') : tt('Groupe créé', 'Group created'));
    setFormOpen(false); setEditId(null); setForm(DEFAULT_EDIT);
    refetch();
  };

  const handleDelete = async (id: string) => {
    const { error } = await db.from('agency_promoter_groups').delete().eq('id', id);
    if (error) { errorToast(error); return; }
    toast.success(tt('Groupe supprimé', 'Group deleted'));
    setConfirmDelete(null);
    refetch();
  };

  const removeFromGroup = async (promoterId: string) => {
    setRemoving(promoterId);
    const { error } = await db.from('promoters')
      .update({ agency_group_id: null })
      .eq('id', promoterId);
    setRemoving(null);
    if (error) { errorToast(error); return; }
    refetch();
  };

  const addToGroup = async (promoterId: string, groupId: string) => {
    const { error } = await db.from('promoters')
      .update({ agency_group_id: groupId })
      .eq('id', promoterId);
    if (error) { errorToast(error); return; }
    refetch();
  };

  if (loading) {
    return <div className="py-16 text-center" style={{ color: T3, fontSize: 13 }}>{tt('Chargement…', 'Loading…')}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionLabel>{tt('Groupes de promoteurs', 'Promoter groups')}</SectionLabel>
        <PromoButton size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" /> {tt('Créer', 'Create')}
        </PromoButton>
      </div>

      {/* Create / edit form */}
      {formOpen && (
        <PromoCard>
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>
              {editId ? tt('Modifier le groupe', 'Edit group') : tt('Nouveau groupe', 'New group')}
            </SectionLabel>
            <button
              onClick={() => { setFormOpen(false); setEditId(null); setForm(DEFAULT_EDIT); }}
              style={{ color: T3, cursor: 'pointer', background: 'none', border: 'none' }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <FieldLabel>{tt('Nom du groupe', 'Group name')}</FieldLabel>
              <DarkInput
                value={form.name}
                onChange={v => setForm(f => ({ ...f, name: v }))}
                placeholder={tt('ex. Paris VIP Team', 'e.g. Paris VIP Team')}
              />
            </div>
            <div>
              <FieldLabel>{tt('Couleur', 'Color')}</FieldLabel>
              <ColorPicker value={form.color} onChange={c => setForm(f => ({ ...f, color: c }))} />
            </div>
            <div>
              <FieldLabel>{tt('Description (optionnelle)', 'Description (optional)')}</FieldLabel>
              <DarkInput
                value={form.description}
                onChange={v => setForm(f => ({ ...f, description: v }))}
                placeholder={tt('Description courte…', 'Short description…')}
              />
            </div>
            <PromoButton onClick={handleSave} disabled={saving} full>
              {saving
                ? tt('Enregistrement…', 'Saving…')
                : editId ? tt('Enregistrer', 'Save') : tt('Créer le groupe', 'Create group')}
            </PromoButton>
          </div>
        </PromoCard>
      )}

      {/* Group list */}
      {groups.length === 0 ? (
        <PromoEmpty
          icon={Layers}
          title={tt('Aucun groupe', 'No groups')}
          description={tt("Créez des groupes pour organiser vos promoteurs.", 'Create groups to organize your promoters.')}
        />
      ) : (
        <div className="space-y-2">
          {groups.map(g => {
            const members = membersByGroup.get(g.id) ?? [];
            const isExpanded = expanded === g.id;
            return (
              <PromoCard key={g.id} style={{ padding: 0, overflow: 'hidden' }}>
                <div className="flex items-center gap-3" style={{ padding: '12px 14px' }}>
                  <span style={{ width: 12, height: 12, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
                  <div className="min-w-0 flex-1">
                    <p style={{ color: T1, fontSize: 14, fontWeight: 640 }}>{g.name}</p>
                    {g.description && (
                      <p className="truncate" style={{ color: T3, fontSize: 11.5 }}>{g.description}</p>
                    )}
                  </div>
                  <PromoPill tone="muted">{members.length}</PromoPill>
                  <button onClick={() => openEdit(g)} style={{ color: T3, cursor: 'pointer', background: 'none', border: 'none', padding: 4 }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(g.id)}
                    style={{ color: T3, cursor: 'pointer', background: 'none', border: 'none', padding: 4 }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setExpanded(isExpanded ? null : g.id)}
                    style={{ color: T3, cursor: 'pointer', background: 'none', border: 'none', padding: 4 }}
                  >
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                </div>

                {confirmDelete === g.id && (
                  <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(232,25,44,0.06)' }}>
                    <p style={{ color: T1, fontSize: 13, marginBottom: 8 }}>
                      {tt(
                        `Supprimer "${g.name}" ? Les promoteurs resteront dans l'agence, juste sans groupe.`,
                        `Delete "${g.name}"? Promoters will remain in the agency, just ungrouped.`,
                        `¿Eliminar "${g.name}"? Los promotores seguirán en la agencia, solo sin grupo.`,
                      )}
                    </p>
                    <div className="flex gap-2">
                      <PromoButton size="sm" variant="danger" onClick={() => handleDelete(g.id)}>
                        {tt('Supprimer', 'Delete')}
                      </PromoButton>
                      <PromoButton size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                        {tt('Annuler', 'Cancel')}
                      </PromoButton>
                    </div>
                  </div>
                )}

                {isExpanded && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '8px 14px 12px' }}>
                    {members.length === 0 ? (
                      <p style={{ color: T3, fontSize: 12 }}>{tt('Aucun membre dans ce groupe.', 'No members in this group.')}</p>
                    ) : (
                      <div className="space-y-1">
                        {members.map(p => (
                          <div key={p.id} className="flex items-center gap-2" style={{ padding: '6px 0' }}>
                            <PromoAvatar src={p.profile_image_url} fallback={promoterName(p).slice(0, 1)} size={28} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate" style={{ color: T1, fontSize: 13 }}>{promoterName(p)}</p>
                              <p className="truncate" style={{ color: T3, fontSize: 10.5 }}>
                                {p.venues?.name || p.venue_id || ''}
                              </p>
                            </div>
                            <button
                              onClick={() => removeFromGroup(p.id)}
                              disabled={removing === p.id}
                              style={{ color: T3, cursor: 'pointer', background: 'none', border: 'none', padding: 4 }}
                            >
                              <UserMinus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <GroupOverrideEditor group={g} members={members} tt={tt} onSaved={refetch} />
                  </div>
                )}
              </PromoCard>
            );
          })}
        </div>
      )}

      {/* Ungrouped promoters */}
      {ungrouped.length > 0 && groups.length > 0 && (
        <>
          <SectionLabel>{tt('Sans groupe', 'No group')} ({ungrouped.length})</SectionLabel>
          <PromoCard style={{ padding: 8 }}>
            {ungrouped.map((p, i) => (
              <div
                key={p.id}
                className="flex items-center gap-3"
                style={{ padding: '8px 6px', borderBottom: i < ungrouped.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined }}
              >
                <PromoAvatar src={p.profile_image_url} fallback={promoterName(p).slice(0, 1)} size={30} />
                <div className="min-w-0 flex-1">
                  <p className="truncate" style={{ color: T1, fontSize: 13 }}>{promoterName(p)}</p>
                  <p className="truncate" style={{ color: T3, fontSize: 10.5 }}>{p.venues?.name || p.venue_id || ''}</p>
                </div>
                {groups.length > 0 && (
                  <select
                    defaultValue=""
                    onChange={e => { if (e.target.value) addToGroup(p.id, e.target.value); }}
                    style={{
                      background: INNER_BG, border: `1px solid ${BORDER}`,
                      borderRadius: 8, padding: '4px 8px', color: T2, fontSize: 11.5, cursor: 'pointer',
                    }}
                  >
                    <option value="" style={{ background: '#111' }}>{tt('Assigner…', 'Assign…')}</option>
                    {groups.map(g => (
                      <option key={g.id} value={g.id} style={{ background: '#111' }}>{g.name}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </PromoCard>
        </>
      )}
    </div>
  );
}
