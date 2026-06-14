import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, Layers, Package, Image as ImageIcon, Upload, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import {
  OrgCard, OrgButton, OrgPill, OrgTabs, FieldLabel, DarkInput, DarkTextarea,
  RED, RED_SOFT, T1, T2, T3, BORDER, INNER_BG,
} from '@/components/org-ui';

interface OrgEventTablesPanelProps {
  eventId: string;
  /** Currently logged-in organizer user_id — becomes tables_owner_user_id */
  organizerUserId: string;
}

interface BasicZone {
  id: string;
  name: string;
  color: string;
  tables_count: number;
  position: number | null;
}

interface BasicPack {
  id: string;
  zone_id: string;
  name: string;
  description: string | null;
  base_price: number;
  base_capacity: number;
  deposit: number;
  included_items: string | null;
  is_active: boolean;
}


// Native input styled with the Yuno DA tokens (covers number/color which DarkInput doesn't).
const daInputStyle: React.CSSProperties = {
  width: '100%', background: INNER_BG, border: `1px solid ${BORDER}`, color: T1,
  outline: 'none', borderRadius: 12, padding: '10px 12px', fontSize: 13,
};

export function OrgEventTablesPanel({ eventId, organizerUserId }: OrgEventTablesPanelProps) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const [loading, setLoading] = useState(true);
  const [tablesEnabled, setTablesEnabled] = useState(false);
  const [tablesMode, setTablesMode] = useState<string | null>(null);
  const [tablesOwnerId, setTablesOwnerId] = useState<string | null>(null);
  const [zones, setZones] = useState<BasicZone[]>([]);
  const [packs, setPacks] = useState<BasicPack[]>([]);
  const [floorPlanUrl, setFloorPlanUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState<'zones' | 'packs' | 'plan'>('zones');

  // Zone dialog
  const [zoneOpen, setZoneOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<BasicZone | null>(null);
  const [zoneForm, setZoneForm] = useState({ name: '', color: '#3b82f6', tables_count: '4' });

  // Pack dialog
  const [packOpen, setPackOpen] = useState(false);
  const [editingPack, setEditingPack] = useState<BasicPack | null>(null);
  const [packForm, setPackForm] = useState({
    zone_id: '',
    name: '',
    description: '',
    base_price: '',
    base_capacity: '6',
    deposit: '0',
    included_items: '',
  });

  const isOwner = tablesOwnerId === organizerUserId;
  const canEdit = isOwner || !tablesOwnerId;

  useEffect(() => {
    loadAll();
  }, [eventId]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [{ data: ev }, { data: zs }, { data: ps }, { data: fp }] = await Promise.all([
        supabase.from('events').select('tables_enabled, tables_mode, tables_owner_user_id').eq('id', eventId).maybeSingle(),
        supabase.from('table_zones').select('id, name, color, tables_count, position').eq('event_id', eventId).order('position', { ascending: true, nullsFirst: false }),
        supabase.from('table_packs').select('id, zone_id, name, description, base_price, base_capacity, deposit, included_items, is_active').eq('event_id', eventId),
        supabase.from('venue_floor_plans').select('background_image_url').eq('event_id', eventId).maybeSingle(),
      ]);
      setTablesEnabled(!!ev?.tables_enabled);
      setTablesMode(ev?.tables_mode ?? null);
      setTablesOwnerId(ev?.tables_owner_user_id ?? null);
      setZones((zs ?? []) as BasicZone[]);
      setPacks((ps ?? []) as BasicPack[]);
      setFloorPlanUrl(fp?.background_image_url ?? null);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const enableBasicTables = async () => {
    const { error } = await supabase
      .from('events')
      .update({
        tables_enabled: true,
        tables_mode: 'basic',
        tables_owner_user_id: organizerUserId,
      })
      .eq('id', eventId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(tt('Vente de tables activée', 'Table sales enabled'));
    loadAll();
  };

  const disableBasicTables = async () => {
    if (!confirm(tt('Désactiver la vente de tables pour cet event ?', 'Disable table sales for this event?'))) return;
    const { error } = await supabase
      .from('events')
      .update({ tables_enabled: false })
      .eq('id', eventId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(tt('Vente de tables désactivée', 'Table sales disabled'));
    loadAll();
  };

  // ---- Zones ----
  const openZoneDialog = (z: BasicZone | null) => {
    setEditingZone(z);
    setZoneForm(
      z
        ? { name: z.name, color: z.color, tables_count: String(z.tables_count) }
        : { name: '', color: '#3b82f6', tables_count: '4' },
    );
    setZoneOpen(true);
  };

  const saveZone = async () => {
    if (!zoneForm.name.trim()) {
      toast.error(tt('Nom requis', 'Name required'));
      return;
    }
    const payload = {
      name: zoneForm.name.trim(),
      color: zoneForm.color,
      tables_count: parseInt(zoneForm.tables_count) || 1,
      event_id: eventId,
      created_by_user_id: organizerUserId,
      // Required by venue-scoped legacy column: use a placeholder when event-scoped.
      // venue_id is non-null in table_zones today, so we still store the partner venue id.
      venue_id: (await supabase.from('events').select('venue_id, partner_venue_id').eq('id', eventId).single()).data?.venue_id
        ?? (await supabase.from('events').select('partner_venue_id').eq('id', eventId).single()).data?.partner_venue_id,
    };
    const { error } = editingZone
      ? await supabase.from('table_zones').update(payload).eq('id', editingZone.id)
      : await supabase.from('table_zones').insert(payload);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(editingZone ? tt('Zone modifiée', 'Zone updated') : tt('Zone créée', 'Zone created'));
    setZoneOpen(false);
    loadAll();
  };

  const deleteZone = async (id: string) => {
    if (!confirm(tt('Supprimer cette zone et tous ses packs ?', 'Delete this zone and all its packs?'))) return;
    await supabase.from('table_packs').delete().eq('zone_id', id).eq('event_id', eventId);
    const { error } = await supabase.from('table_zones').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success(tt('Zone supprimée', 'Zone deleted')); loadAll(); }
  };

  // ---- Packs ----
  const openPackDialog = (p: BasicPack | null, zoneId?: string) => {
    setEditingPack(p);
    setPackForm(
      p
        ? {
            zone_id: p.zone_id,
            name: p.name,
            description: p.description ?? '',
            base_price: String(p.base_price),
            base_capacity: String(p.base_capacity),
            deposit: String(p.deposit ?? 0),
            included_items: p.included_items ?? '',
          }
        : {
            zone_id: zoneId ?? zones[0]?.id ?? '',
            name: '',
            description: '',
            base_price: '',
            base_capacity: '6',
            deposit: '0',
            included_items: '',
          },
    );
    setPackOpen(true);
  };

  const savePack = async () => {
    if (!packForm.zone_id || !packForm.name.trim() || !packForm.base_price) {
      toast.error(tt('Zone, nom et prix requis', 'Zone, name and price required'));
      return;
    }
    const venueIdRow = await supabase.from('events').select('venue_id, partner_venue_id').eq('id', eventId).single();
    const payload = {
      zone_id: packForm.zone_id,
      name: packForm.name.trim(),
      description: packForm.description.trim() || null,
      base_price: parseFloat(packForm.base_price),
      base_capacity: parseInt(packForm.base_capacity) || 1,
      deposit: parseFloat(packForm.deposit) || 0,
      deposit_type: 'fixed' as const,
      included_items: packForm.included_items.trim() || null,
      is_active: true,
      event_id: eventId,
      created_by_user_id: organizerUserId,
      venue_id: venueIdRow.data?.venue_id ?? venueIdRow.data?.partner_venue_id,
    };
    const { error } = editingPack
      ? await supabase.from('table_packs').update(payload).eq('id', editingPack.id)
      : await supabase.from('table_packs').insert(payload);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(editingPack ? tt('Pack modifié', 'Pack updated') : tt('Pack créé', 'Pack created'));
    setPackOpen(false);
    loadAll();
  };

  const deletePack = async (id: string) => {
    if (!confirm(tt('Supprimer ce pack ?', 'Delete this pack?'))) return;
    const { error } = await supabase.from('table_packs').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success(tt('Pack supprimé', 'Pack deleted')); loadAll(); }
  };

  // ---- Floor plan ----
  const onUploadPlan = async (file: File) => {
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `event-${eventId}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('floor-plans').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('floor-plans').getPublicUrl(path);
      const venueIdRow = await supabase.from('events').select('venue_id, partner_venue_id').eq('id', eventId).single();
      const venueId = venueIdRow.data?.venue_id ?? venueIdRow.data?.partner_venue_id;
      const { data: existing } = await supabase
        .from('venue_floor_plans')
        .select('id')
        .eq('event_id', eventId)
        .maybeSingle();
      const payload = {
        event_id: eventId,
        owner_user_id: organizerUserId,
        venue_id: venueId,
        background_image_url: pub.publicUrl,
        layout: { tables: [] },
      };
      const { error } = existing
        ? await supabase.from('venue_floor_plans').update(payload).eq('id', existing.id)
        : await supabase.from('venue_floor_plans').insert(payload);
      if (error) throw error;
      setFloorPlanUrl(pub.publicUrl);
      toast.success(tt('Plan importé', 'Plan uploaded'));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <OrgCard style={{ padding: 24 }}><p style={{ color: T3, fontSize: 13 }}>…</p></OrgCard>;

  // Initial state — no basic tables yet
  if (!tablesEnabled || tablesMode !== 'basic') {
    return (
      <OrgCard style={{ padding: 24 }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2" style={{ color: T1, fontSize: 16, fontWeight: 600 }}>
              <Sparkles className="h-5 w-5" style={{ color: RED }} />
              {tt('Tables VIP — Mode Basic', 'VIP Tables — Basic mode')}
            </h2>
            <p className="mt-1 max-w-xl" style={{ color: T3, fontSize: 12.5 }}>
              {tt(
                "Vendez des tables VIP simples : zones, packs, plan visuel. Pas de placement client interactif, pas de service VIP — réservation basique uniquement.",
                'Sell simple VIP tables: zones, packs, visual plan. No interactive client placement, no VIP service — basic reservations only.',
              )}
            </p>
          </div>
          <OrgButton variant="primary" size="sm" onClick={enableBasicTables}>
            {tt('Activer la vente de tables', 'Enable table sales')}
          </OrgButton>
        </div>
      </OrgCard>
    );
  }

  // Read-only banner if not the owner
  if (!canEdit) {
    return (
      <OrgCard style={{ padding: 16, background: 'rgba(232,25,44,0.05)', border: '1px solid rgba(232,25,44,0.2)' }}>
        <p style={{ color: T2, fontSize: 13 }}>
          {tt(
            'Les tables de cet event sont gérées par un autre compte.',
            'Tables for this event are managed by another account.',
          )}
        </p>
      </OrgCard>
    );
  }

  return (
    <OrgCard style={{ padding: 24 }}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2" style={{ color: T1, fontSize: 16, fontWeight: 600 }}>
            <Sparkles className="h-5 w-5" style={{ color: RED }} />
            {tt('Tables VIP — Basic', 'VIP Tables — Basic')}
          </h2>
          <p style={{ color: T3, fontSize: 11.5 }}>
            {tt('Réservation simple, sans placement interactif.', 'Simple booking, no interactive placement.')}
          </p>
        </div>
        <OrgButton variant="ghost" size="sm" onClick={disableBasicTables}>
          {tt('Désactiver', 'Disable')}
        </OrgButton>
      </div>

      <OrgTabs<'zones' | 'packs' | 'plan'>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'zones', label: tt('Zones', 'Zones'), icon: <Layers className="h-3.5 w-3.5" /> },
          { value: 'packs', label: tt('Packs', 'Packs'), icon: <Package className="h-3.5 w-3.5" /> },
          { value: 'plan', label: tt('Plan de salle', 'Floor plan'), icon: <ImageIcon className="h-3.5 w-3.5" /> },
        ]}
      />

      {/* ZONES */}
      {tab === 'zones' && (
        <div className="space-y-3 pt-4">
          <div className="flex justify-end">
            <OrgButton variant="primary" size="sm" onClick={() => openZoneDialog(null)}>
              <Plus className="h-4 w-4" /> {tt('Nouvelle zone', 'New zone')}
            </OrgButton>
          </div>
          {zones.length === 0 && (
            <p className="py-6 text-center" style={{ color: T3, fontSize: 13 }}>
              {tt('Aucune zone. Créez votre première zone (ex: Carré VIP, Pit, Mezzanine).', 'No zones yet. Create your first zone (e.g., VIP Pit, Mezzanine).')}
            </p>
          )}
          {zones.map((z) => (
            <div key={z.id} className="flex items-center justify-between rounded-xl p-3" style={{ border: `1px solid ${BORDER}`, background: INNER_BG }}>
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 rounded" style={{ background: z.color }} />
                <div>
                  <div style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{z.name}</div>
                  <div style={{ color: T3, fontSize: 11.5 }}>{z.tables_count} {tt('tables', 'tables')}</div>
                </div>
              </div>
              <div className="flex gap-1">
                <OrgButton variant="ghost" size="sm" className="!px-2" onClick={() => openZoneDialog(z)}><Pencil className="h-4 w-4" /></OrgButton>
                <OrgButton variant="ghost" size="sm" className="!px-2" onClick={() => deleteZone(z.id)}><Trash2 className="h-4 w-4" style={{ color: RED_SOFT }} /></OrgButton>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PACKS */}
      {tab === 'packs' && (
        <div className="space-y-3 pt-4">
          <div className="flex justify-end">
            <OrgButton variant="primary" size="sm" onClick={() => openPackDialog(null)} disabled={zones.length === 0}>
              <Plus className="h-4 w-4" /> {tt('Nouveau pack', 'New pack')}
            </OrgButton>
          </div>
          {zones.length === 0 && (
            <p className="py-6 text-center" style={{ color: T3, fontSize: 13 }}>
              {tt("Créez d'abord une zone.", 'Create a zone first.')}
            </p>
          )}
          {zones.map((z) => {
            const zonePacks = packs.filter((p) => p.zone_id === z.id);
            return (
              <div key={z.id} className="space-y-2">
                <div className="flex items-center gap-2" style={{ color: T1, fontSize: 13, fontWeight: 560 }}>
                  <div className="h-3 w-3 rounded" style={{ background: z.color }} />
                  {z.name}
                  <OrgPill tone="muted">{zonePacks.length}</OrgPill>
                </div>
                {zonePacks.map((p) => (
                  <div key={p.id} className="ml-5 flex items-center justify-between rounded-xl p-3" style={{ border: `1px solid ${BORDER}`, background: INNER_BG }}>
                    <div>
                      <div style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{p.name} <span style={{ color: T3 }}>— {Number(p.base_price).toFixed(0)}€</span></div>
                      <div style={{ color: T3, fontSize: 11.5 }}>
                        {p.base_capacity} {tt('pers.', 'guests')}
                        {Number(p.deposit) > 0 && <> · {tt('Acompte', 'Deposit')} {Number(p.deposit).toFixed(0)}€</>}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <OrgButton variant="ghost" size="sm" className="!px-2" onClick={() => openPackDialog(p)}><Pencil className="h-4 w-4" /></OrgButton>
                      <OrgButton variant="ghost" size="sm" className="!px-2" onClick={() => deletePack(p.id)}><Trash2 className="h-4 w-4" style={{ color: RED_SOFT }} /></OrgButton>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* FLOOR PLAN */}
      {tab === 'plan' && (
        <div className="space-y-3 pt-4">
          <p style={{ color: T3, fontSize: 11.5 }}>
            {tt(
              'Image illustrative affichée au client. Aucun placement interactif en mode basic.',
              'Illustrative image shown to clients. No interactive placement in basic mode.',
            )}
          </p>
          {floorPlanUrl && (
            <div className="overflow-hidden rounded-xl" style={{ border: `1px solid ${BORDER}` }}>
              <img src={floorPlanUrl} alt="Floor plan" className="h-auto w-full" />
            </div>
          )}
          <div>
            <input
              id={`floor-plan-upload-${eventId}`}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUploadPlan(f);
                e.target.value = '';
              }}
            />
            <OrgButton
              variant="secondary"
              size="sm"
              disabled={uploading}
              onClick={() => document.getElementById(`floor-plan-upload-${eventId}`)?.click()}
            >
              <Upload className="h-4 w-4" />
              {uploading
                ? tt('Envoi…', 'Uploading…')
                : floorPlanUrl
                  ? tt('Remplacer', 'Replace')
                  : tt('Importer', 'Upload')}
            </OrgButton>
          </div>
        </div>
      )}

      {/* Zone dialog */}
      <Dialog open={zoneOpen} onOpenChange={setZoneOpen}>
        <DialogContent style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18 }}>
          <DialogHeader><DialogTitle style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>{editingZone ? tt('Modifier zone', 'Edit zone') : tt('Nouvelle zone', 'New zone')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><FieldLabel>{tt('Nom', 'Name')}</FieldLabel><DarkInput value={zoneForm.name} onChange={(v) => setZoneForm({ ...zoneForm, name: v })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>{tt('Couleur', 'Color')}</FieldLabel>
                <input type="color" value={zoneForm.color} onChange={(e) => setZoneForm({ ...zoneForm, color: e.target.value })} style={{ ...daInputStyle, height: 42, padding: 4, cursor: 'pointer' }} />
              </div>
              <div>
                <FieldLabel>{tt('Nb. max de tables', 'Max tables')}</FieldLabel>
                <input type="number" min="1" value={zoneForm.tables_count} onChange={(e) => setZoneForm({ ...zoneForm, tables_count: e.target.value })} style={daInputStyle} />
                <p className="mt-1" style={{ color: T3, fontSize: 10 }}>
                  {tt(
                    'Limite la vente : aucune réservation ne sera acceptée au-delà.',
                    'Sales cap: bookings above this number will be rejected.'
                  )}
                </p>
              </div>
            </div>
          </div>
          <DialogFooter><OrgButton variant="primary" onClick={saveZone}>{tt('Enregistrer', 'Save')}</OrgButton></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pack dialog */}
      <Dialog open={packOpen} onOpenChange={setPackOpen}>
        <DialogContent style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18 }}>
          <DialogHeader><DialogTitle style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>{editingPack ? tt('Modifier pack', 'Edit pack') : tt('Nouveau pack', 'New pack')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <FieldLabel>{tt('Zone', 'Zone')}</FieldLabel>
              <select className="w-full" style={{ ...daInputStyle, height: 42, cursor: 'pointer' }} value={packForm.zone_id} onChange={(e) => setPackForm({ ...packForm, zone_id: e.target.value })}>
                <option value="" style={{ background: '#0a0a0c' }}>{tt('Choisir...', 'Choose...')}</option>
                {zones.map((z) => <option key={z.id} value={z.id} style={{ background: '#0a0a0c' }}>{z.name}</option>)}
              </select>
            </div>
            <div><FieldLabel>{tt('Nom', 'Name')}</FieldLabel><DarkInput value={packForm.name} onChange={(v) => setPackForm({ ...packForm, name: v })} /></div>
            <div><FieldLabel>{tt('Description', 'Description')}</FieldLabel><DarkTextarea rows={2} value={packForm.description} onChange={(v) => setPackForm({ ...packForm, description: v })} /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><FieldLabel>{tt('Prix €', 'Price €')}</FieldLabel><input type="number" min="0" step="1" value={packForm.base_price} onChange={(e) => setPackForm({ ...packForm, base_price: e.target.value })} style={daInputStyle} /></div>
              <div><FieldLabel>{tt('Capacité', 'Guests')}</FieldLabel><input type="number" min="1" value={packForm.base_capacity} onChange={(e) => setPackForm({ ...packForm, base_capacity: e.target.value })} style={daInputStyle} /></div>
              <div><FieldLabel>{tt('Acompte €', 'Deposit €')}</FieldLabel><input type="number" min="0" value={packForm.deposit} onChange={(e) => setPackForm({ ...packForm, deposit: e.target.value })} style={daInputStyle} /></div>
            </div>
            <div><FieldLabel>{tt('Inclus (texte libre)', 'Includes (free text)')}</FieldLabel><DarkTextarea rows={2} placeholder={tt('Ex: 1 bouteille de vodka, 6 mixers', 'e.g. 1 vodka bottle, 6 mixers')} value={packForm.included_items} onChange={(v) => setPackForm({ ...packForm, included_items: v })} /></div>
          </div>
          <DialogFooter><OrgButton variant="primary" onClick={savePack}>{tt('Enregistrer', 'Save')}</OrgButton></DialogFooter>
        </DialogContent>
      </Dialog>
    </OrgCard>
  );
}
