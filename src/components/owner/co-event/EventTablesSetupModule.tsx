import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, Layers, Package, Image as ImageIcon, Upload, Sparkles, Info } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Configuration des tables (zones / packs / plan de salle) au niveau d'un event.
 *
 * Utilisé côté co-event dashboard, partagé entre l'orga lead et le club partenaire.
 * Toutes les écritures sont scopées à `event_id` ; les RLS
 * (Event-scoped zones/packs manageable by event managers) garantissent que
 * seuls les acteurs autorisés (lead venue, partner venue, lead orga, partner orga)
 * peuvent écrire.
 *
 * Plan de salle : on cherche d'abord l'event-scoped, sinon on hérite du plan
 * du club hôte (partner_venue_id ?? venue_id). Le club ou l'orga peut uploader
 * un nouveau plan dédié à cet event.
 */

interface Props {
  eventId: string;
  /** Optional readonly hint (kept false for paritary edition co-events). */
  readOnly?: boolean;
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

export function EventTablesSetupModule({ eventId, readOnly = false }: Props) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [tablesEnabled, setTablesEnabled] = useState(false);
  const [tablesMode, setTablesMode] = useState<string | null>(null);
  const [eventVenueId, setEventVenueId] = useState<string | null>(null);
  const [eventPartnerVenueId, setEventPartnerVenueId] = useState<string | null>(null);
  const [zones, setZones] = useState<BasicZone[]>([]);
  const [packs, setPacks] = useState<BasicPack[]>([]);
  const [floorPlanUrl, setFloorPlanUrl] = useState<string | null>(null);
  const [floorPlanIsInherited, setFloorPlanIsInherited] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [zoneOpen, setZoneOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<BasicZone | null>(null);
  const [zoneForm, setZoneForm] = useState({ name: '', color: '#3b82f6', tables_count: '4' });

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

  const hostVenueId = eventVenueId ?? eventPartnerVenueId;

  useEffect(() => {
    loadAll();
  }, [eventId]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [{ data: ev }, { data: zs }, { data: ps }, { data: fpEvent }] = await Promise.all([
        supabase.from('events').select('tables_enabled, tables_mode, venue_id, partner_venue_id').eq('id', eventId).maybeSingle(),
        supabase.from('table_zones').select('id, name, color, tables_count, position').eq('event_id', eventId).order('position', { ascending: true, nullsFirst: false }),
        supabase.from('table_packs').select('id, zone_id, name, description, base_price, base_capacity, deposit, included_items, is_active').eq('event_id', eventId),
        supabase.from('venue_floor_plans').select('background_image_url').eq('event_id', eventId).maybeSingle(),
      ]);
      setTablesEnabled(!!ev?.tables_enabled);
      setTablesMode(ev?.tables_mode ?? null);
      setEventVenueId(ev?.venue_id ?? null);
      setEventPartnerVenueId(ev?.partner_venue_id ?? null);
      setZones((zs ?? []) as BasicZone[]);
      setPacks((ps ?? []) as BasicPack[]);

      if (fpEvent?.background_image_url) {
        setFloorPlanUrl(fpEvent.background_image_url);
        setFloorPlanIsInherited(false);
      } else {
        // Fallback to host venue's plan
        const venueIdForPlan = ev?.venue_id ?? ev?.partner_venue_id;
        if (venueIdForPlan) {
          const { data: fpVenue } = await supabase
            .from('venue_floor_plans')
            .select('background_image_url')
            .eq('venue_id', venueIdForPlan)
            .is('event_id', null)
            .maybeSingle();
          setFloorPlanUrl(fpVenue?.background_image_url ?? null);
          setFloorPlanIsInherited(!!fpVenue?.background_image_url);
        } else {
          setFloorPlanUrl(null);
          setFloorPlanIsInherited(false);
        }
      }
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
        ...(user?.id ? { tables_owner_user_id: user.id } : {}),
      })
      .eq('id', eventId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t('coTables.salesEnabled'));
    loadAll();
  };

  const disableBasicTables = async () => {
    if (!confirm(t('coTables.confirmDisable'))) return;
    const { error } = await supabase.from('events').update({ tables_enabled: false }).eq('id', eventId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t('coTables.salesDisabled'));
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
      toast.error(t('coTables.nameRequired'));
      return;
    }
    if (!hostVenueId) {
      toast.error(t('coTables.noHostVenue'));
      return;
    }
    const payload: any = {
      name: zoneForm.name.trim(),
      color: zoneForm.color,
      tables_count: parseInt(zoneForm.tables_count) || 1,
      event_id: eventId,
      created_by_user_id: user?.id ?? null,
      venue_id: hostVenueId,
    };
    const { error } = editingZone
      ? await supabase.from('table_zones').update(payload).eq('id', editingZone.id)
      : await supabase.from('table_zones').insert(payload);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(editingZone ? t('coTables.zoneUpdated') : t('coTables.zoneCreated'));
    setZoneOpen(false);
    loadAll();
  };

  const deleteZone = async (id: string) => {
    if (!confirm('Supprimer cette zone et tous ses packs ?')) return;
    await supabase.from('table_packs').delete().eq('zone_id', id).eq('event_id', eventId);
    const { error } = await supabase.from('table_zones').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success(t('coTables.zoneDeleted')); loadAll(); }
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
      toast.error(t('coTables.zoneNamePriceRequired'));
      return;
    }
    if (!hostVenueId) {
      toast.error(t('coTables.noHostVenueShort'));
      return;
    }
    const payload: any = {
      zone_id: packForm.zone_id,
      name: packForm.name.trim(),
      description: packForm.description.trim() || null,
      base_price: parseFloat(packForm.base_price),
      base_capacity: parseInt(packForm.base_capacity) || 1,
      deposit: parseFloat(packForm.deposit) || 0,
      deposit_type: 'fixed',
      included_items: packForm.included_items.trim() || null,
      is_active: true,
      event_id: eventId,
      created_by_user_id: user?.id ?? null,
      venue_id: hostVenueId,
    };
    const { error } = editingPack
      ? await supabase.from('table_packs').update(payload).eq('id', editingPack.id)
      : await supabase.from('table_packs').insert(payload);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(editingPack ? t('coTables.packUpdated') : t('coTables.packCreated'));
    setPackOpen(false);
    loadAll();
  };

  const deletePack = async (id: string) => {
    if (!confirm('Supprimer ce pack ?')) return;
    const { error } = await supabase.from('table_packs').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success(t('coTables.packDeleted')); loadAll(); }
  };

  // ---- Floor plan (event-scoped, fallback to host venue plan) ----
  const onUploadPlan = async (file: File) => {
    setUploading(true);
    try {
      if (!hostVenueId) {
        toast.error(t('coTables.noHostVenuePlan'));
        return;
      }
      const ext = file.name.split('.').pop();
      const path = `event-${eventId}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('floor-plans').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('floor-plans').getPublicUrl(path);
      const { data: existing } = await supabase
        .from('venue_floor_plans').select('id').eq('event_id', eventId).maybeSingle();
      const payload: any = {
        event_id: eventId,
        owner_user_id: user?.id ?? null,
        venue_id: hostVenueId,
        background_image_url: pub.publicUrl,
        layout: { tables: [] },
      };
      const { error } = existing
        ? await supabase.from('venue_floor_plans').update(payload).eq('id', existing.id)
        : await supabase.from('venue_floor_plans').insert(payload);
      if (error) throw error;
      setFloorPlanUrl(pub.publicUrl);
      setFloorPlanIsInherited(false);
      toast.success(t('coTables.planImported'));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <Card className="p-6 text-sm text-muted-foreground">Chargement…</Card>;

  if (!tablesEnabled || tablesMode !== 'basic') {
    return (
      <Card className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              {t('coTables.title')}
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              {t('coTables.descFull')}
            </p>
          </div>
          {!readOnly && (
            <Button onClick={enableBasicTables} size="sm">
              {t('coTables.enableSales')}
            </Button>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {t('coTables.config')}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t('coTables.sharedSetupNote')}
          </p>
        </div>
        {!readOnly && (
          <Button variant="ghost" size="sm" onClick={disableBasicTables}>
            {t('coEvent.disable')}
          </Button>
        )}
      </div>

      <Tabs defaultValue="zones">
        <TabsList>
          <TabsTrigger value="zones"><Layers className="h-3.5 w-3.5 mr-1" /> {t('coTables.zones')}</TabsTrigger>
          <TabsTrigger value="packs"><Package className="h-3.5 w-3.5 mr-1" /> {t('coTables.packs')}</TabsTrigger>
          <TabsTrigger value="plan"><ImageIcon className="h-3.5 w-3.5 mr-1" /> {t('coTables.floorPlan')}</TabsTrigger>
        </TabsList>

        <TabsContent value="zones" className="space-y-3 pt-3">
          {!readOnly && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => openZoneDialog(null)}>
                <Plus className="h-4 w-4 mr-1" /> Nouvelle zone
              </Button>
            </div>
          )}
          {zones.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t('coTables.noZones')}
            </p>
          )}
          {zones.map((z) => (
            <div key={z.id} className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 rounded" style={{ background: z.color }} />
                <div>
                  <div className="font-medium text-sm">{z.name}</div>
                  <div className="text-xs text-muted-foreground">{z.tables_count} tables</div>
                </div>
              </div>
              {!readOnly && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openZoneDialog(z)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteZone(z.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              )}
            </div>
          ))}
        </TabsContent>

        <TabsContent value="packs" className="space-y-3 pt-3">
          {!readOnly && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => openPackDialog(null)} disabled={zones.length === 0}>
                <Plus className="h-4 w-4 mr-1" /> Nouveau pack
              </Button>
            </div>
          )}
          {zones.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t('coTables.createZoneFirst')}
            </p>
          )}
          {zones.map((z) => {
            const zonePacks = packs.filter((p) => p.zone_id === z.id);
            return (
              <div key={z.id} className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <div className="h-3 w-3 rounded" style={{ background: z.color }} />
                  {z.name}
                  <Badge variant="secondary">{zonePacks.length}</Badge>
                </div>
                {zonePacks.map((p) => (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border ml-5">
                    <div>
                      <div className="font-medium text-sm">
                        {p.name} <span className="text-muted-foreground">— {Number(p.base_price).toFixed(0)}€</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {p.base_capacity} pers.
                        {Number(p.deposit) > 0 && <> · Acompte {Number(p.deposit).toFixed(0)}€</>}
                      </div>
                    </div>
                    {!readOnly && (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openPackDialog(p)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => deletePack(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </TabsContent>

        <TabsContent value="plan" className="space-y-3 pt-3">
          {floorPlanIsInherited && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs">
              <Info className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
              <span>
                {t('coTables.inheritedPlanNote')}
              </span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {t('coTables.planImageNote')}
          </p>
          {floorPlanUrl && (
            <div className="rounded-lg overflow-hidden border">
              <img src={floorPlanUrl} alt="Plan de salle" className="w-full h-auto" />
            </div>
          )}
          {!readOnly && (
            <div>
              <input
                id={`event-floor-plan-upload-${eventId}`}
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={(e) => e.target.files?.[0] && onUploadPlan(e.target.files[0])}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => document.getElementById(`event-floor-plan-upload-${eventId}`)?.click()}
              >
                <Upload className="h-4 w-4 mr-1" />
                {uploading ? t('coTables.importing') : floorPlanUrl && !floorPlanIsInherited ? t('coTables.replacePlan') : t('coTables.importDedicatedPlan')}
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Zone dialog */}
      <Dialog open={zoneOpen} onOpenChange={setZoneOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingZone ? t('coTables.editZone') : t('coTables.newZone')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t('common.name')}</Label>
              <Input value={zoneForm.name} onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })} placeholder={t('coTables.zoneNamePlaceholder')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('coTables.color')}</Label>
                <Input type="color" value={zoneForm.color} onChange={(e) => setZoneForm({ ...zoneForm, color: e.target.value })} />
              </div>
              <div>
                <Label>{t('coTables.numTables')}</Label>
                <Input type="number" min={1} value={zoneForm.tables_count} onChange={(e) => setZoneForm({ ...zoneForm, tables_count: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setZoneOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={saveZone}>{editingZone ? t('common.save') : t('common.create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pack dialog */}
      <Dialog open={packOpen} onOpenChange={setPackOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPack ? t('coTables.editPack') : t('coTables.newPack')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t('coTables.zone')}</Label>
              <select
                className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                value={packForm.zone_id}
                onChange={(e) => setPackForm({ ...packForm, zone_id: e.target.value })}
              >
                {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </div>
            <div>
              <Label>{t('coTables.packName')}</Label>
              <Input value={packForm.name} onChange={(e) => setPackForm({ ...packForm, name: e.target.value })} placeholder={t('coTables.packNamePlaceholder')} />
            </div>
            <div>
              <Label>{t('coTables.description')}</Label>
              <Input value={packForm.description} onChange={(e) => setPackForm({ ...packForm, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>{t('coEvent.priceEur')}</Label>
                <Input type="number" min={0} step="0.01" value={packForm.base_price} onChange={(e) => setPackForm({ ...packForm, base_price: e.target.value })} />
              </div>
              <div>
                <Label>{t('coTables.capacity')}</Label>
                <Input type="number" min={1} value={packForm.base_capacity} onChange={(e) => setPackForm({ ...packForm, base_capacity: e.target.value })} />
              </div>
              <div>
                <Label>{t('coTables.deposit')}</Label>
                <Input type="number" min={0} step="0.01" value={packForm.deposit} onChange={(e) => setPackForm({ ...packForm, deposit: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>{t('coTables.included')}</Label>
              <Input value={packForm.included_items} onChange={(e) => setPackForm({ ...packForm, included_items: e.target.value })} placeholder={t('coTables.includedPlaceholder')} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPackOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={savePack}>{editingPack ? t('common.save') : t('common.create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
