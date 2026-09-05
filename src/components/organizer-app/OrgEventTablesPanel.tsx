import { canSideEdit } from '@/utils/collabResponsibilities';
import { CollabTablesPreview } from '@/components/collab/CollabTablesPreview';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Plus, Pencil, Trash2, Layers, Package, Image as ImageIcon, Upload, Sparkles, Lock, Map as MapIcon, Clock, LayoutGrid, MousePointerClick, Save, Building2, Crown, ArrowRight, Play, Maximize2, Ruler } from 'lucide-react';
import { toast } from 'sonner';
import {
  OrgCard, OrgButton, OrgPill, OrgTabs, FieldLabel, DarkInput, DarkTextarea,
  RED, RED_SOFT, T1, T2, T3, BORDER, INNER_BG,
} from '@/components/org-ui';
import { ClientFloorPlanPicker } from '@/components/vip/ClientFloorPlanPicker';
import { FloorPlanEditor } from '@/components/owner/FloorPlanEditor';
import { useTableAvailability } from '@/hooks/useTableAvailability';
import type { VenueFloorPlan } from '@/types';

interface OrgEventTablesPanelProps {
  eventId: string;
  /** Currently logged-in organizer user_id — becomes tables_owner_user_id */
  organizerUserId: string;
  /**
   * `summary` (page de la soirée) : état + interrupteur + liens vers l'atelier
   * (/organizer-app/tables) et le service du soir (/organizer-app/vip-service),
   * sans un seul chiffre d'argent. `full` (page Tables VIP) : l'atelier complet.
   */
  variant?: 'summary' | 'full';
  /** Appelé après tout changement d'état de la soirée (activation, mode…). */
  onChanged?: () => void;
}

interface VipRoomOption {
  id: string;
  name: string;
  location_name: string | null;
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
  arrival_deadline: string | null;
  is_active: boolean;
  payment_mode: 'online' | 'on_site';
  /** Plafond propre à la formule (voir migration pack_table_binding). */
  limit_tables: boolean;
  tables_count: number;
}


// Native input styled with the Yuno DA tokens (covers number/color which DarkInput doesn't).
const daInputStyle: React.CSSProperties = {
  width: '100%', background: INNER_BG, border: `1px solid ${BORDER}`, color: T1,
  outline: 'none', borderRadius: 12, padding: '10px 12px', fontSize: 13,
};

/**
 * Tables VIP d'une soirée vues par l'organisateur.
 *
 * Deux mondes, un seul panneau :
 *  • Co-soirée AVEC club : le plan et les zones viennent du club (verrouillés),
 *    l'organisateur ne règle que ses packs/prix — ou, si le club a un plan
 *    interactif, la soirée passe en élite sur CE plan (lecture seule ici).
 *  • Soirée SANS club (organisateur seul, lieu loué hors Yuno) : l'organisateur
 *    est son propre club. Il crée ses zones, ses packs, importe une image ou
 *    construit un plan interactif avec le MÊME éditeur que les clubs, et
 *    choisit si le client pointe sa table (élite) ou réserve une zone (basic).
 *    Tout est event-scopé (venue_id NULL) — migration 20260904120000.
 */
export function OrgEventTablesPanel({ eventId, organizerUserId, variant = 'full', onChanged }: OrgEventTablesPanelProps) {
  const { language, t } = useLanguage();
  const navigate = useNavigate();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const [loading, setLoading] = useState(true);
  const [tablesEnabled, setTablesEnabled] = useState(false);
  const [tablesMode, setTablesMode] = useState<string | null>(null);
  const [tablesOwnerId, setTablesOwnerId] = useState<string | null>(null);
  const [eventMode, setEventMode] = useState<string | null>(null);
  const [responsibilities, setResponsibilities] = useState<unknown>(null);
  // Club de la soirée (hôte ou partenaire). NULL = organisateur seul.
  const [clubId, setClubId] = useState<string | null>(null);
  // When true, the plan + zones come from the club and are read-only here —
  // the organizer only configures packs/prices on top of the club's layout.
  const [lockedToVenue, setLockedToVenue] = useState(false);
  const [zones, setZones] = useState<BasicZone[]>([]);
  const [packs, setPacks] = useState<BasicPack[]>([]);
  const [floorPlanUrl, setFloorPlanUrl] = useState<string | null>(null);
  // Full plan object (with interactive layout) — used in elite mode.
  const [floorPlan, setFloorPlan] = useState<VenueFloorPlan | null>(null);
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState<'zones' | 'packs' | 'plan'>('zones');
  const [planEditorOpen, setPlanEditorOpen] = useState(false);
  // Lightbox de l'image illustrative (mode basic).
  const [planPreviewOpen, setPlanPreviewOpen] = useState(false);
  const [modeSaving, setModeSaving] = useState(false);
  // Salles VIP de l'organisateur (historique rejouable) + enregistrement.
  const [rooms, setRooms] = useState<VipRoomOption[]>([]);
  const [roomToApply, setRoomToApply] = useState('');
  const [applyingRoom, setApplyingRoom] = useState(false);
  const [saveRoomOpen, setSaveRoomOpen] = useState(false);
  const [saveRoomName, setSaveRoomName] = useState('');
  const [saveRoomTarget, setSaveRoomTarget] = useState<'new' | string>('new');
  const [savingRoom, setSavingRoom] = useState(false);

  const soloOrganizer = !clubId;
  const isElite = tablesEnabled && tablesMode === 'elite';
  const planTableCount = floorPlan?.layout?.tables?.length ?? 0;
  // Live availability for the interactive plan — taken vs free tables.
  const { unavailableTableIds } = useTableAvailability(tablesEnabled && planTableCount > 0 ? eventId : undefined);

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
    arrival_deadline: '',
    payment_mode: 'online' as 'online' | 'on_site',
    limit_tables: false,
    tables_count: '1',
  });

  const isOwner = tablesOwnerId === organizerUserId;
  const canEdit = isOwner || !tablesOwnerId;

  useEffect(() => {
    loadAll();
  }, [eventId]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [{ data: ev }, { data: zs }, { data: ps }, { data: fp }, { data: rms }] = await Promise.all([
        supabase.from('events').select('tables_enabled, tables_mode, tables_owner_user_id, event_mode, tables_locked_to_venue, collab_responsibilities, venue_id, partner_venue_id, location_name').eq('id', eventId).maybeSingle(),
        supabase.from('table_zones').select('id, name, color, tables_count, position').eq('event_id', eventId).order('position', { ascending: true, nullsFirst: false }),
        supabase.from('table_packs').select('id, zone_id, name, description, base_price, base_capacity, deposit, included_items, arrival_deadline, is_active, payment_mode, limit_tables, tables_count').eq('event_id', eventId),
        supabase.from('venue_floor_plans').select('id, venue_id, layout, background_image_url').eq('event_id', eventId).maybeSingle(),
        supabase.from('organizer_vip_rooms').select('id, name, location_name').order('updated_at', { ascending: false }),
      ]);
      setRooms((rms ?? []) as VipRoomOption[]);
      if (!saveRoomName) setSaveRoomName(ev?.location_name ?? '');
      setTablesEnabled(!!ev?.tables_enabled);
      setTablesMode(ev?.tables_mode ?? null);
      setTablesOwnerId(ev?.tables_owner_user_id ?? null);
      setEventMode(ev?.event_mode ?? null);
      setResponsibilities(ev?.collab_responsibilities ?? null);
      setClubId(ev?.venue_id ?? ev?.partner_venue_id ?? null);
      setLockedToVenue(!!ev?.tables_locked_to_venue);
      setZones((zs ?? []) as BasicZone[]);
      setPacks((ps ?? []) as BasicPack[]);
      setFloorPlanUrl(fp?.background_image_url ?? null);
      setFloorPlan(fp ? {
        id: fp.id,
        venueId: fp.venue_id ?? '',
        backgroundImageUrl: fp.background_image_url ?? null,
        layout: (fp.layout ?? { tables: [] }) as VenueFloorPlan['layout'],
        createdAt: '', updatedAt: '',
      } : null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const enableTables = async () => {
    // RPC : avec un club → ÉLITE si le club a un plan interactif (le client
    // choisit sa table sur le plan du club), sinon BASIC (zones du club clonées
    // et verrouillées, l'orga règle ses packs/prix). Sans club → l'organisateur
    // garde ses propres zones/packs/plan ; élite dès qu'il a construit un plan.
    const { error } = await supabase.rpc('enable_collab_tables', { p_event_id: eventId });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(tt('Vente de tables activée', 'Table sales enabled', 'Venta de mesas activada'));
    loadAll();
    onChanged?.();
  };

  // Rejouer une salle VIP de l'historique sur cette soirée (sans club).
  const applyRoom = async () => {
    if (!roomToApply) return;
    setApplyingRoom(true);
    const { error } = await supabase.rpc('apply_vip_room_to_event', { p_room_id: roomToApply, p_event_id: eventId });
    setApplyingRoom(false);
    if (error) {
      toast.error(error.code === '23514'
        ? tt('Cette soirée a déjà des réservations : ses tables ne peuvent plus être remplacées.', 'This event already has reservations: its tables can no longer be replaced.', 'Esta noche ya tiene reservas: sus mesas ya no pueden reemplazarse.')
        : error.message);
      return;
    }
    toast.success(tt('Salle VIP appliquée : zones, packs et plan sont en place.', 'VIP room applied: zones, packs and plan are in place.', 'Sala VIP aplicada: zonas, packs y plano están listos.'));
    loadAll();
    onChanged?.();
  };

  // Photo de la soirée → salle VIP (nouvelle, ou mise à jour d'une existante).
  const saveRoom = async () => {
    setSavingRoom(true);
    const { error } = await supabase.rpc('save_event_vip_room', {
      p_event_id: eventId,
      p_name: saveRoomName.trim() || null,
      p_room_id: saveRoomTarget === 'new' ? null : saveRoomTarget,
    });
    setSavingRoom(false);
    if (error) {
      toast.error(error.code === '23514'
        ? tt('Rien à enregistrer : créez d’abord des zones ou un plan.', 'Nothing to save: create zones or a plan first.', 'Nada que guardar: crea primero zonas o un plano.')
        : error.message);
      return;
    }
    setSaveRoomOpen(false);
    toast.success(tt('Salle VIP enregistrée dans votre historique.', 'VIP room saved to your history.', 'Sala VIP guardada en tu historial.'));
    loadAll();
  };

  const disableTables = async () => {
    if (!confirm(tt('Désactiver la vente de tables pour cet event ?', 'Disable table sales for this event?', '¿Desactivar la venta de mesas para este evento?'))) return;
    const { error } = await supabase
      .from('events')
      .update({ tables_enabled: false })
      .eq('id', eventId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(tt('Vente de tables désactivée', 'Table sales disabled', 'Venta de mesas desactivada'));
    loadAll();
    onChanged?.();
  };

  // Soirée sans club : basic (réservation d'une zone) ⇄ élite (le client
  // pointe sa table sur le plan). Le serveur refuse l'élite sans plan.
  const setMode = async (elite: boolean) => {
    setModeSaving(true);
    const { error } = await supabase.rpc('set_event_tables_mode', { p_event_id: eventId, p_mode: elite ? 'elite' : 'basic' });
    setModeSaving(false);
    if (error) {
      toast.error(error.code === '23514'
        ? tt('Construisez d’abord un plan interactif avec au moins une table.', 'Build an interactive floor plan with at least one table first.', 'Construye primero un plano interactivo con al menos una mesa.')
        : error.message);
      return;
    }
    toast.success(elite
      ? tt('Le client choisira sa table sur le plan.', 'Guests will pick their table on the plan.', 'El cliente elegirá su mesa en el plano.')
      : tt('Réservation par zone activée.', 'Zone booking enabled.', 'Reserva por zona activada.'));
    loadAll();
    onChanged?.();
  };

  // Le plan interactif fait foi sur le nombre de tables vendables par zone :
  // après une sauvegarde, on aligne tables_count (plafond de vente) sur les
  // tables réellement posées. Une zone sans table sur le plan garde son compte
  // manuel — même règle que la page Tables du club.
  const syncZoneCountsFromLayout = async () => {
    const { data: fp } = await supabase.from('venue_floor_plans').select('layout').eq('event_id', eventId).maybeSingle();
    const planTables = ((fp?.layout as { tables?: { zoneId?: string | null }[] } | null)?.tables) ?? [];
    if (planTables.length === 0) return;
    const counts = new Map<string, number>();
    for (const t of planTables) { if (t.zoneId) counts.set(t.zoneId, (counts.get(t.zoneId) || 0) + 1); }
    const updates = zones.flatMap((z) => {
      const n = counts.get(z.id);
      if (n === undefined || n === z.tables_count) return [];
      return [supabase.from('table_zones').update({ tables_count: n }).eq('id', z.id)];
    });
    // Même règle pour les formules : des tables fixées à une formule en font
    // le plafond. Une formule sans table liée garde son réglage manuel.
    const packCounts = new Map<string, number>();
    for (const t of planTables as { packId?: string | null }[]) { if (t.packId) packCounts.set(t.packId, (packCounts.get(t.packId) || 0) + 1); }
    const packUpdates = packs.flatMap((pk) => {
      const n = packCounts.get(pk.id);
      if (n === undefined || (n === pk.tables_count && pk.limit_tables)) return [];
      return [supabase.from('table_packs').update({ tables_count: n, limit_tables: true }).eq('id', pk.id)];
    });
    if (updates.length + packUpdates.length > 0) await Promise.all([...updates, ...packUpdates]);
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
      toast.error(tt('Nom requis', 'Name required', 'Nombre obligatorio'));
      return;
    }
    const payload = {
      name: zoneForm.name.trim(),
      color: zoneForm.color,
      tables_count: parseInt(zoneForm.tables_count) || 1,
      event_id: eventId,
      created_by_user_id: organizerUserId,
      // Club de la soirée s'il y en a un ; NULL pour un organisateur seul
      // (la zone est alors purement event-scopée).
      venue_id: clubId,
    };
    const { error } = editingZone
      ? await supabase.from('table_zones').update(payload).eq('id', editingZone.id)
      : await supabase.from('table_zones').insert(payload);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(editingZone ? tt('Zone modifiée', 'Zone updated', 'Zona actualizada') : tt('Zone créée', 'Zone created', 'Zona creada'));
    setZoneOpen(false);
    loadAll();
  };

  const deleteZone = async (id: string) => {
    if (!confirm(tt('Supprimer cette zone et tous ses packs ?', 'Delete this zone and all its packs?', '¿Eliminar esta zona y todos sus packs?'))) return;
    const { error: packErr } = await supabase.from('table_packs').delete().eq('zone_id', id).eq('event_id', eventId);
    if (packErr) { toast.error(packErr.message); return; }
    const { error } = await supabase.from('table_zones').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success(tt('Zone supprimée', 'Zone deleted', 'Zona eliminada')); loadAll(); }
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
            arrival_deadline: p.arrival_deadline ?? '',
            payment_mode: p.payment_mode === 'on_site' ? 'on_site' : 'online',
            limit_tables: !!p.limit_tables,
            tables_count: String(p.tables_count || 1),
          }
        : {
            zone_id: zoneId ?? zones[0]?.id ?? '',
            name: '',
            description: '',
            base_price: '',
            base_capacity: '6',
            deposit: '0',
            included_items: '',
            arrival_deadline: '',
            // Nouveau pack : on hérite du mode du dernier pack de la soirée, pour
            // qu'une soirée « tout sur place » ne redemande pas le choix à chaque fois.
            payment_mode: packs[packs.length - 1]?.payment_mode === 'on_site' ? 'on_site' : 'online',
            limit_tables: false,
            tables_count: '1',
          },
    );
    setPackOpen(true);
  };

  const savePack = async () => {
    if (!packForm.zone_id || !packForm.name.trim() || !packForm.base_price) {
      toast.error(tt('Zone, nom et prix requis', 'Zone, name and price required', 'Zona, nombre y precio obligatorios'));
      return;
    }
    const payload = {
      zone_id: packForm.zone_id,
      name: packForm.name.trim(),
      description: packForm.description.trim() || null,
      base_price: parseFloat(packForm.base_price),
      base_capacity: parseInt(packForm.base_capacity) || 1,
      deposit: parseFloat(packForm.deposit) || 0,
      deposit_type: 'fixed' as const,
      included_items: packForm.included_items.trim() || null,
      arrival_deadline: packForm.arrival_deadline || null,
      payment_mode: packForm.payment_mode,
      limit_tables: packForm.limit_tables,
      tables_count: Math.max(1, parseInt(packForm.tables_count) || 1),
      is_active: true,
      event_id: eventId,
      created_by_user_id: organizerUserId,
      venue_id: clubId,
    };
    const { error } = editingPack
      ? await supabase.from('table_packs').update(payload).eq('id', editingPack.id)
      : await supabase.from('table_packs').insert(payload);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(editingPack ? tt('Pack modifié', 'Pack updated', 'Pack actualizado') : tt('Pack créé', 'Pack created', 'Pack creado'));
    setPackOpen(false);
    loadAll();
  };

  const deletePack = async (id: string) => {
    if (!confirm(tt('Supprimer ce pack ?', 'Delete this pack?', '¿Eliminar este pack?'))) return;
    const { error } = await supabase.from('table_packs').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success(tt('Pack supprimé', 'Pack deleted', 'Pack eliminado')); loadAll(); }
  };

  // ---- Floor plan (image illustrative) ----
  const onUploadPlan = async (file: File) => {
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `event-${eventId}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('floor-plans').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('floor-plans').getPublicUrl(path);
      const { data: existing } = await supabase
        .from('venue_floor_plans')
        .select('id')
        .eq('event_id', eventId)
        .maybeSingle();
      // Un plan existant garde son layout : remplacer l'image ne doit jamais
      // effacer les tables posées dans l'éditeur interactif.
      const { error } = existing
        ? await supabase.from('venue_floor_plans').update({ background_image_url: pub.publicUrl }).eq('id', existing.id)
        : await supabase.from('venue_floor_plans').insert({
            event_id: eventId,
            owner_user_id: organizerUserId,
            venue_id: clubId,
            background_image_url: pub.publicUrl,
            layout: { tables: [] },
          });
      if (error) throw error;
      setFloorPlanUrl(pub.publicUrl);
      toast.success(tt('Plan importé', 'Plan uploaded', 'Plano importado'));
      loadAll();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <OrgCard style={{ padding: 24 }}><p style={{ color: T3, fontSize: 13 }}>…</p></OrgCard>;

  // Les OPÉRATIONS (tables, plan de salle) peuvent être confiées au club seul :
  // soit par le mode org_hosted, soit — depuis l'axe responsabilités — sur
  // n'importe quelle co-soirée où l'orga tient le design et le club la logistique.
  // On lit le domaine plutôt que le mode, sinon la répartition serait ignorée ici
  // alors que le serveur, lui, la fait respecter (can_manage_event_tables).
  if (!canSideEdit(responsibilities, eventMode, 'operations', 'organizer')) {
    return (
      <OrgCard style={{ padding: 20, background: 'rgba(255,255,255,0.02)', border: `1px solid ${BORDER}` }}>
        <h2 className="flex items-center gap-2" style={{ color: T1, fontSize: 15, fontWeight: 600 }}>
          <Lock className="h-4 w-4" style={{ color: T3 }} />
          {tt('Tables VIP — gérées par le club', 'VIP Tables — managed by the club', 'Mesas VIP — gestionadas por el club')}
        </h2>
        <p className="mt-1.5" style={{ color: T3, fontSize: 12.5 }}>
          {tt(
            'Sur cette soirée, le club gère seul la mise en ligne des tables. Vous vous concentrez sur le marketing et le partage.',
            'For this event the club alone manages table sales. You focus on marketing and sharing.',
            'En esta noche, el club gestiona solo la venta de mesas. Tú te enfocas en el marketing y la difusión.',
          )}
        </p>
        {/* Lecture seule : le plan interactif du club (celui que voit le client) +
            les réservations VIP de la soirée. Savoir ce qui est en ligne sans y toucher. */}
        <div className="mt-3">
          <CollabTablesPreview eventId={eventId} />
        </div>
      </OrgCard>
    );
  }

  // ── Résumé (page de la soirée) : état, interrupteur, liens. Pas d'argent. ──
  if (variant === 'summary') {
    const statusLabel = !tablesEnabled
      ? tt('Non activées', 'Not enabled', 'No activadas')
      : isElite
        ? (soloOrganizer ? tt('Plan interactif', 'Interactive plan', 'Plano interactivo') : tt('Plan du club', 'Club plan', 'Plano del club'))
        : tt('Basic', 'Basic', 'Basic');
    const statusTone: 'success' | 'info' | 'warn' = !tablesEnabled ? 'warn' : isElite ? 'success' : 'info';
    return (
      <OrgCard style={{ padding: 20 }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.2)' }}>
              <Crown className="h-4 w-4" style={{ color: RED }} />
            </div>
            <div className="min-w-0">
              <h2 className="flex items-center gap-2" style={{ color: T1, fontSize: 15, fontWeight: 600 }}>
                {tt('Tables VIP', 'VIP Tables', 'Mesas VIP')}
                <OrgPill tone={statusTone}>{statusLabel}</OrgPill>
              </h2>
              <p style={{ color: T3, fontSize: 12 }}>
                {tablesEnabled
                  ? `${zones.length} ${tt('zones', 'zones', 'zonas')} · ${packs.length} packs · ${planTableCount} ${tt('tables sur le plan', 'tables on the plan', 'mesas en el plano')}`
                  : tt('Activez la vente pour configurer zones, packs et plan de salle.', 'Enable sales to configure zones, packs and floor plan.', 'Activa la venta para configurar zonas, packs y plano.')}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <Switch checked={tablesEnabled} onCheckedChange={(v) => (v ? enableTables() : disableTables())} />
            )}
            <OrgButton size="sm" variant={tablesEnabled ? 'secondary' : 'primary'} onClick={() => navigate(`/organizer-app/tables?event=${eventId}`)}>
              <LayoutGrid className="h-3.5 w-3.5" /> {tt('Configurer', 'Configure', 'Configurar')}
            </OrgButton>
            {tablesEnabled && (
              <OrgButton size="sm" variant="secondary" onClick={() => navigate(`/organizer-app/vip-service?event=${eventId}`)}>
                <Crown className="h-3.5 w-3.5" /> {tt('Service VIP', 'VIP Service', 'Servicio VIP')} <ArrowRight className="h-3.5 w-3.5" />
              </OrgButton>
            )}
          </div>
        </div>
      </OrgCard>
    );
  }

  // ÉLITE sur le plan du CLUB — the co-event reuses the club's interactive plan:
  // the client picks a table at checkout. Here the organizer sees the plan
  // (read-only) + the live reservations. Pricing/zones stay the club's.
  if (isElite && !soloOrganizer) {
    const hasInteractivePlan = planTableCount > 0;
    return (
      <OrgCard style={{ padding: 24 }}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2" style={{ color: T1, fontSize: 16, fontWeight: 600 }}>
              <MapIcon className="h-5 w-5" style={{ color: RED }} />
              {tt('Tables VIP — Plan du club', 'VIP Tables — Club floor plan', 'Mesas VIP — Plano del club')}
            </h2>
            <p className="mt-0.5 flex items-center gap-1.5" style={{ color: T3, fontSize: 11.5 }}>
              <Lock className="h-3.5 w-3.5" />
              {tt(
                'Plan interactif du club — le client choisit sa table. Tarifs et zones gérés par le club.',
                'Club interactive plan — the client picks their table. Pricing & zones managed by the club.',
                'Plano interactivo del club — el cliente elige su mesa. Precios y zonas gestionados por el club.',
              )}
            </p>
          </div>
          <OrgButton variant="ghost" size="sm" onClick={disableTables}>
            {tt('Désactiver', 'Disable', 'Desactivar')}
          </OrgButton>
        </div>

        {hasInteractivePlan ? (
          <>
            <div className="overflow-hidden rounded-xl" style={{ border: `1px solid ${BORDER}`, background: INNER_BG }}>
              <ClientFloorPlanPicker
                floorPlan={floorPlan}
                unavailableTableIds={unavailableTableIds}
                selectedTableId={null}
                onSelectTable={() => {}}
                onSkip={() => {}}
                readOnly
              />
            </div>
            <p className="mt-2" style={{ color: T3, fontSize: 11 }}>
              {tt(
                'Les tables déjà réservées apparaissent indisponibles. Aperçu identique à celui du client.',
                'Already-booked tables show as unavailable. Same view your customers see.',
                'Las mesas ya reservadas aparecen como no disponibles. Misma vista que ve tu cliente.',
              )}
            </p>
          </>
        ) : (
          <p style={{ color: T3, fontSize: 12.5 }}>
            {tt(
              "Le club n'a pas encore publié de plan de salle interactif.",
              'The club has not published an interactive floor plan yet.',
              'El club aún no ha publicado un plano de sala interactivo.',
            )}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 rounded-xl p-3" style={{ border: `1px solid ${BORDER}`, background: INNER_BG }}>
          <div className="flex items-center gap-2" style={{ color: T2, fontSize: 12.5 }}>
            <Crown className="h-4 w-4" style={{ color: RED }} />
            {tt('Réservations, placement et arrivées se gèrent dans le Service VIP.', 'Reservations, placement and arrivals are handled in the VIP Service.', 'Reservas, colocación y llegadas se gestionan en el Servicio VIP.')}
          </div>
          <OrgButton size="sm" variant="secondary" onClick={() => navigate(`/organizer-app/vip-service?event=${eventId}`)}>
            {tt('Ouvrir le Service VIP', 'Open VIP Service', 'Abrir Servicio VIP')} <ArrowRight className="h-3.5 w-3.5" />
          </OrgButton>
        </div>
      </OrgCard>
    );
  }

  // Initial state — tables not enabled yet
  if (!tablesEnabled) {
    return (
      <OrgCard style={{ padding: 24 }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2" style={{ color: T1, fontSize: 16, fontWeight: 600 }}>
              <Sparkles className="h-5 w-5" style={{ color: RED }} />
              {soloOrganizer
                ? tt('Tables VIP', 'VIP Tables', 'Mesas VIP')
                : tt('Tables VIP — Mode Basic', 'VIP Tables — Basic mode', 'Mesas VIP — Modo Basic')}
            </h2>
            <p className="mt-1 max-w-xl" style={{ color: T3, fontSize: 12.5 }}>
              {soloOrganizer
                ? tt(
                    'Vendez des tables VIP en autonomie : vos zones, vos packs et prix, votre plan de salle. Construisez un plan interactif et le client choisit sa table — le même outil que les clubs.',
                    'Sell VIP tables on your own: your zones, your packs and prices, your floor plan. Build an interactive plan and guests pick their table — the same tool clubs use.',
                    'Vende mesas VIP por tu cuenta: tus zonas, tus packs y precios, tu plano de sala. Construye un plano interactivo y el cliente elige su mesa: la misma herramienta que los clubs.',
                  )
                : tt(
                    "Vendez des tables VIP simples : zones, packs, plan visuel. Pas de placement client interactif, pas de service VIP — réservation basique uniquement.",
                    'Sell simple VIP tables: zones, packs, visual plan. No interactive client placement, no VIP service — basic reservations only.',
                    'Vende mesas VIP simples: zonas, packs, plano visual. Sin colocación interactiva ni servicio VIP: solo reserva básica.',
                  )}
            </p>
            {!soloOrganizer && (
              <p className="mt-2 flex items-start gap-1.5 max-w-xl" style={{ color: T3, fontSize: 11.5 }}>
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {tt(
                  'On reprend le plan de salle et les zones du club. Vous n’aurez qu’à configurer vos packs et prix.',
                  'We reuse the club’s floor plan and zones. You only configure your packs and prices.',
                  'Reutilizamos el plano y las zonas del club. Solo configuras tus packs y precios.',
                )}
              </p>
            )}
          </div>
          <OrgButton variant="primary" size="sm" onClick={enableTables}>
            {tt('Activer la vente de tables', 'Enable table sales', 'Activar la venta de mesas')}
          </OrgButton>
        </div>
        {/* Historique : rejouer une salle VIP déjà construite dans cet établissement. */}
        {soloOrganizer && rooms.length > 0 && (
          <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl p-3" style={{ border: `1px solid ${BORDER}`, background: INNER_BG }}>
            <div className="min-w-[220px] flex-1">
              <FieldLabel>{tt('Réutiliser une salle VIP', 'Reuse a VIP room', 'Reutilizar una sala VIP')}</FieldLabel>
              <select className="w-full" value={roomToApply} onChange={(e) => setRoomToApply(e.target.value)} style={{ ...daInputStyle, height: 42, cursor: 'pointer' }}>
                <option value="" style={{ background: '#0a0a0c' }}>{tt('Choisir une salle…', 'Choose a room…', 'Elegir una sala…')}</option>
                {rooms.map((r) => <option key={r.id} value={r.id} style={{ background: '#0a0a0c' }}>{r.name}{r.location_name && r.location_name !== r.name ? ` — ${r.location_name}` : ''}</option>)}
              </select>
            </div>
            <OrgButton variant="secondary" size="sm" disabled={!roomToApply || applyingRoom} onClick={applyRoom}>
              <Play className="h-4 w-4" /> {applyingRoom ? tt('Application…', 'Applying…', 'Aplicando…') : tt('Appliquer', 'Apply', 'Aplicar')}
            </OrgButton>
          </div>
        )}
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
            'Las mesas de este evento las gestiona otra cuenta.',
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
            {isElite ? <MapIcon className="h-5 w-5" style={{ color: RED }} /> : <Sparkles className="h-5 w-5" style={{ color: RED }} />}
            {isElite
              ? tt('Tables VIP — Plan interactif', 'VIP Tables — Interactive plan', 'Mesas VIP — Plano interactivo')
              : tt('Tables VIP — Basic', 'VIP Tables — Basic', 'Mesas VIP — Basic')}
          </h2>
          <p style={{ color: T3, fontSize: 11.5 }}>
            {isElite
              ? tt('Le client choisit sa table sur votre plan.', 'Guests pick their table on your plan.', 'El cliente elige su mesa en tu plano.')
              : tt('Réservation par zone, sans placement interactif.', 'Zone booking, no interactive placement.', 'Reserva por zona, sin colocación interactiva.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {soloOrganizer && (
            <OrgButton variant="secondary" size="sm" onClick={() => { setSaveRoomTarget('new'); setSaveRoomOpen(true); }}>
              <Save className="h-4 w-4" /> {tt('Enregistrer comme salle VIP', 'Save as VIP room', 'Guardar como sala VIP')}
            </OrgButton>
          )}
          <OrgButton variant="ghost" size="sm" onClick={disableTables}>
            {tt('Désactiver', 'Disable', 'Desactivar')}
          </OrgButton>
        </div>
      </div>

      {/* Salle VIP de l'historique : remplace zones/packs/plan (tant qu'aucune résa). */}
      {soloOrganizer && rooms.length > 0 && zones.length === 0 && planTableCount === 0 && (
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl p-3" style={{ border: `1px solid ${BORDER}`, background: INNER_BG }}>
          <div className="min-w-[220px] flex-1">
            <FieldLabel>{tt('Réutiliser une salle VIP', 'Reuse a VIP room', 'Reutilizar una sala VIP')}</FieldLabel>
            <select className="w-full" value={roomToApply} onChange={(e) => setRoomToApply(e.target.value)} style={{ ...daInputStyle, height: 42, cursor: 'pointer' }}>
              <option value="" style={{ background: '#0a0a0c' }}>{tt('Choisir une salle…', 'Choose a room…', 'Elegir una sala…')}</option>
              {rooms.map((r) => <option key={r.id} value={r.id} style={{ background: '#0a0a0c' }}>{r.name}{r.location_name && r.location_name !== r.name ? ` — ${r.location_name}` : ''}</option>)}
            </select>
          </div>
          <OrgButton variant="secondary" size="sm" disabled={!roomToApply || applyingRoom} onClick={applyRoom}>
            <Play className="h-4 w-4" /> {applyingRoom ? tt('Application…', 'Applying…', 'Aplicando…') : tt('Appliquer', 'Apply', 'Aplicar')}
          </OrgButton>
        </div>
      )}

      <OrgTabs<'zones' | 'packs' | 'plan'>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'zones', label: tt('Zones', 'Zones', 'Zonas'), icon: <Layers className="h-3.5 w-3.5" /> },
          { value: 'packs', label: tt('Packs', 'Packs', 'Packs'), icon: <Package className="h-3.5 w-3.5" /> },
          { value: 'plan', label: tt('Plan de salle', 'Floor plan', 'Plano de sala'), icon: <ImageIcon className="h-3.5 w-3.5" /> },
        ]}
      />

      {/* ZONES */}
      {tab === 'zones' && (
        <div className="space-y-3 pt-4">
          {lockedToVenue ? (
            <div className="flex items-start gap-2 rounded-xl p-3" style={{ border: `1px solid ${BORDER}`, background: INNER_BG }}>
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: T3 }} />
              <p style={{ color: T3, fontSize: 11.5 }}>
                {tt(
                  'Zones reprises du plan du club — verrouillées. Vous configurez vos packs/prix dans l’onglet Packs.',
                  'Zones taken from the club’s floor plan — locked. Configure your packs/prices in the Packs tab.',
                  'Zonas tomadas del plano del club — bloqueadas. Configura tus packs/precios en la pestaña Packs.',
                )}
              </p>
            </div>
          ) : (
            <div className="flex justify-end">
              <OrgButton variant="primary" size="sm" onClick={() => openZoneDialog(null)}>
                <Plus className="h-4 w-4" /> {tt('Nouvelle zone', 'New zone', 'Nueva zona')}
              </OrgButton>
            </div>
          )}
          {zones.length === 0 && (
            <p className="py-6 text-center" style={{ color: T3, fontSize: 13 }}>
              {tt('Aucune zone. Créez votre première zone (ex: Carré VIP, Pit, Mezzanine).', 'No zones yet. Create your first zone (e.g., VIP Pit, Mezzanine).', 'Sin zonas. Crea tu primera zona (p. ej. Zona VIP, Pit, Mezzanine).')}
            </p>
          )}
          {zones.map((z) => (
            <div key={z.id} className="flex items-center justify-between rounded-xl p-3" style={{ border: `1px solid ${BORDER}`, background: INNER_BG }}>
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 rounded" style={{ background: z.color }} />
                <div>
                  <div style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{z.name}</div>
                  <div style={{ color: T3, fontSize: 11.5 }}>{z.tables_count} {tt('tables', 'tables', 'mesas')}</div>
                </div>
              </div>
              {!lockedToVenue && (
                <div className="flex gap-1">
                  <OrgButton variant="ghost" size="sm" className="!px-2" onClick={() => openZoneDialog(z)}><Pencil className="h-4 w-4" /></OrgButton>
                  <OrgButton variant="ghost" size="sm" className="!px-2" onClick={() => deleteZone(z.id)}><Trash2 className="h-4 w-4" style={{ color: RED_SOFT }} /></OrgButton>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* PACKS */}
      {tab === 'packs' && (
        <div className="space-y-3 pt-4">
          <div className="flex justify-end">
            <OrgButton variant="primary" size="sm" onClick={() => openPackDialog(null)} disabled={zones.length === 0}>
              <Plus className="h-4 w-4" /> {tt('Nouveau pack', 'New pack', 'Nuevo pack')}
            </OrgButton>
          </div>
          {zones.length === 0 && (
            <p className="py-6 text-center" style={{ color: T3, fontSize: 13 }}>
              {tt("Créez d'abord une zone.", 'Create a zone first.', 'Crea primero una zona.')}
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
                        {p.base_capacity} {tt('pers.', 'guests', 'pers.')}
                        {p.limit_tables && <> · {p.tables_count} {tt('tables max', 'tables max', 'mesas máx.')}</>}
                        {p.payment_mode === 'on_site'
                          ? <> · <span style={{ color: '#34D399' }}>{tt('Règlement sur place', 'Paid on site', 'Pago en el local')}</span></>
                          : Number(p.deposit) > 0 && <> · {tt('Acompte', 'Deposit', 'Señal')} {Number(p.deposit).toFixed(0)}€</>}
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
        <div className="space-y-4 pt-4">
          {/* Organisateur seul : plan INTERACTIF (même éditeur que les clubs) +
              choix du mode. Le client pointe sa table (élite) ou réserve une
              zone (basic). */}
          {soloOrganizer && (
            <div className="space-y-3 rounded-xl p-4" style={{ border: `1px solid ${BORDER}`, background: INNER_BG }}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.2)' }}>
                    <LayoutGrid className="h-4 w-4" style={{ color: RED }} />
                  </div>
                  <div>
                    <div style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{tt('Plan interactif', 'Interactive plan', 'Plano interactivo')}</div>
                    <div style={{ color: T3, fontSize: 11.5 }}>
                      {planTableCount > 0
                        ? `${planTableCount} ${tt('tables posées sur le plan', 'tables placed on the plan', 'mesas colocadas en el plano')}`
                        : tt('Aucune table posée pour le moment.', 'No table placed yet.', 'Ninguna mesa colocada todavía.')}
                    </div>
                  </div>
                </div>
                {/* Jamais grisé : comme la page Tables du club, l'éditeur s'ouvre
                    sans zone (une table peut rester hors zone, l'éditeur crée
                    aussi les zones-surfaces). Les zones restent un conseil. */}
                <OrgButton
                  variant={planTableCount > 0 ? 'secondary' : 'primary'}
                  size="sm"
                  onClick={() => setPlanEditorOpen(true)}
                >
                  <MapIcon className="h-4 w-4" />
                  {planTableCount > 0 ? tt('Modifier le plan', 'Edit plan', 'Editar plano') : tt('Construire le plan', 'Build the plan', 'Construir el plano')}
                </OrgButton>
              </div>
              {zones.length === 0 && (
                <p style={{ color: T3, fontSize: 11.5 }}>
                  {tt('Conseil : créez vos zones pour rattacher chaque table du plan à ses packs. Vous pouvez aussi poser les tables d’abord et les affecter ensuite.', 'Tip: create your zones to attach each table on the plan to its packs. You can also place the tables first and assign them later.', 'Consejo: crea tus zonas para vincular cada mesa del plano a sus packs. También puedes colocar las mesas primero y asignarlas después.')}
                </p>
              )}
              <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl p-3" style={{ border: `1px solid ${BORDER}` }}>
                <div className="flex items-start gap-2.5">
                  <MousePointerClick className="mt-0.5 h-4 w-4 shrink-0" style={{ color: isElite ? RED : T3 }} />
                  <div>
                    <div style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{tt('Le client choisit sa table sur le plan', 'Guests pick their table on the plan', 'El cliente elige su mesa en el plano')}</div>
                    <div style={{ color: T3, fontSize: 11.5 }}>
                      {tt(
                        'Activé : placement interactif au checkout (mode élite). Désactivé : le client réserve une zone, vous placez à l’arrivée.',
                        'On: interactive placement at checkout (elite mode). Off: guests book a zone, you seat them on arrival.',
                        'Activado: colocación interactiva en el checkout (modo élite). Desactivado: el cliente reserva una zona, tú lo colocas al llegar.',
                      )}
                    </div>
                  </div>
                </div>
                <Switch checked={isElite} disabled={modeSaving || (!isElite && planTableCount === 0)} onCheckedChange={setMode} />
              </label>
            </div>
          )}

          {/* Carte du plan — toujours présente. À gauche l'aperçu (le plan
              interactif tel que le client le voit, sinon l'image illustrative
              sur son fond ambiant) ; à droite le contexte, les actions et le
              récapitulatif zones → formules, pour que la carte raconte toute
              la soirée d'un coup d'œil. */}
          {(() => {
            const hasPlan = planTableCount > 0 && !!floorPlan;
            const planTables = (floorPlan?.layout?.tables ?? []) as { zoneId?: string | null; packId?: string | null }[];
            const tablesByZone = new Map<string, number>();
            const tablesByPack = new Map<string, number>();
            for (const tb of planTables) {
              if (tb.zoneId) tablesByZone.set(tb.zoneId, (tablesByZone.get(tb.zoneId) || 0) + 1);
              if (tb.packId) tablesByPack.set(tb.packId, (tablesByPack.get(tb.packId) || 0) + 1);
            }
            const dividerCls = 'border-white/[0.085]';
            return (
              <div className="overflow-hidden rounded-xl" style={{ border: `1px solid ${BORDER}`, background: INNER_BG }}>
                <div className="flex flex-col lg:flex-row">
                  {/* Aperçu */}
                  <div className={`relative min-w-0 flex-1 border-b ${dividerCls} lg:border-b-0 lg:border-r`} style={{ background: 'rgba(0,0,0,0.38)' }}>
                    {hasPlan ? (
                      <div className="p-3">
                        <ClientFloorPlanPicker
                          floorPlan={floorPlan!}
                          unavailableTableIds={unavailableTableIds}
                          selectedTableId={null}
                          onSelectTable={() => {}}
                          onSkip={() => {}}
                          readOnly
                        />
                        <p className="mt-2" style={{ color: T3, fontSize: 11 }}>
                          {tt(
                            'Les tables déjà réservées apparaissent indisponibles. Aperçu identique à celui du client.',
                            'Already-booked tables show as unavailable. Same view your customers see.',
                            'Las mesas ya reservadas aparecen como no disponibles. Misma vista que ve tu cliente.',
                          )}
                        </p>
                      </div>
                    ) : floorPlanUrl ? (
                      <>
                        <img
                          aria-hidden
                          src={floorPlanUrl}
                          alt=""
                          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                          style={{ filter: 'blur(28px) saturate(1.35)', opacity: 0.4, transform: 'scale(1.35)' }}
                        />
                        <button
                          type="button"
                          onClick={() => setPlanPreviewOpen(true)}
                          aria-label={tt('Voir l’image en grand', 'View the image full size', 'Ver la imagen en grande')}
                          className="group relative flex h-full w-full cursor-pointer items-center justify-center p-4 outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                          style={{ minHeight: 260 }}
                        >
                          <img
                            src={floorPlanUrl}
                            alt={tt('Plan de salle illustratif', 'Illustrative floor plan', 'Plano de sala ilustrativo')}
                            className="block h-auto w-auto max-w-full rounded-lg object-contain transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                            style={{ maxHeight: 300, border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 14px 32px -14px rgba(0,0,0,0.85)' }}
                          />
                          <span
                            className="pointer-events-none absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
                            style={{ background: 'rgba(10,10,12,0.78)', border: `1px solid ${BORDER}`, color: T1 }}
                          >
                            <Maximize2 className="h-3.5 w-3.5" />
                          </span>
                        </button>
                      </>
                    ) : (
                      <div className="flex h-full w-full items-center justify-center p-4" style={{ minHeight: 260 }}>
                        <div
                          className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg px-4 py-8 text-center"
                          style={{ border: '1px dashed rgba(255,255,255,0.14)' }}
                        >
                          <ImageIcon className="h-7 w-7" style={{ color: 'rgba(255,255,255,0.14)' }} />
                          <span style={{ color: T3, fontSize: 11.5 }}>
                            {lockedToVenue
                              ? tt("Le club n'a pas encore importé de plan.", 'The club has not uploaded a plan yet.', 'El club aún no ha subido un plano.')
                              : tt('Aucune image pour le moment', 'No image yet', 'Ninguna imagen todavía')}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Contexte + actions + récapitulatif */}
                  <div className="flex w-full min-w-0 flex-col gap-4 p-5 lg:w-[340px] lg:shrink-0">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        {lockedToVenue ? (
                          <OrgPill tone="muted">
                            <Lock className="h-3 w-3" />
                            {tt('Fourni par le club', 'Provided by the club', 'Facilitado por el club')}
                          </OrgPill>
                        ) : hasPlan ? (
                          <OrgPill tone={isElite ? 'success' : 'info'} dot>
                            {isElite
                              ? tt('Placement client actif', 'Guest placement on', 'Colocación por el cliente activa')
                              : `${planTableCount} ${tt('tables sur le plan', 'tables on the plan', 'mesas en el plano')}`}
                          </OrgPill>
                        ) : floorPlanUrl ? (
                          <OrgPill tone="info" dot>{tt('Affichée au client', 'Shown to guests', 'Visible para el cliente')}</OrgPill>
                        ) : (
                          <OrgPill tone="muted">{tt('Aucune image', 'No image', 'Sin imagen')}</OrgPill>
                        )}
                      </div>
                      <div className="mt-2.5" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>
                        {hasPlan
                          ? tt('Plan de salle de la soirée', 'Floor plan of the night', 'Plano de sala de la noche')
                          : tt('Image illustrative du plan', 'Illustrative floor plan image', 'Imagen ilustrativa del plano')}
                      </div>
                      <p className="mt-1" style={{ color: T3, fontSize: 12, lineHeight: 1.55 }}>
                        {lockedToVenue
                          ? tt(
                              'Le plan de salle est fourni par le club et verrouillé pour cette soirée. Vous réglez vos packs et vos prix par-dessus.',
                              'The floor plan is provided by the club and locked for this event. You set your packs and prices on top of it.',
                              'El plano de sala lo facilita el club y está bloqueado para esta noche. Tú ajustas tus packs y precios encima.',
                            )
                          : hasPlan
                            ? isElite
                              ? tt(
                                  'Le client choisit sa table sur ce plan au checkout. L’image sert de fond au plan.',
                                  'Guests pick their table on this plan at checkout. The image is the plan’s background.',
                                  'El cliente elige su mesa en este plano en el checkout. La imagen es el fondo del plano.',
                                )
                              : tt(
                                  'Le client réserve une zone, vous placez à l’arrivée. Activez « Le client choisit sa table » pour le placement interactif.',
                                  'Guests book a zone, you seat them on arrival. Turn on “Guests pick their table” for interactive placement.',
                                  'El cliente reserva una zona, tú lo colocas al llegar. Activa «El cliente elige su mesa» para la colocación interactiva.',
                                )
                            : tt(
                                'Le client la voit au moment de réserver sa zone, pour se repérer. Aucun placement interactif tant que le plan interactif n’est pas construit.',
                                'Guests see it when booking their zone, to get their bearings. No interactive placement until the interactive plan is built.',
                                'El cliente la ve al reservar su zona, para orientarse. Sin colocación interactiva hasta construir el plano interactivo.',
                              )}
                      </p>
                      {!lockedToVenue && (
                        <p className="mt-2.5 inline-flex items-center gap-1.5" style={{ color: T2, fontSize: 11.5 }}>
                          <Ruler className="h-3.5 w-3.5 shrink-0" style={{ color: T3 }} />
                          {t('vipHost.bgRecommended')}
                        </p>
                      )}
                    </div>

                    {(!lockedToVenue || floorPlanUrl) && (
                      <div className="flex flex-wrap items-center gap-2">
                        {!lockedToVenue && (
                          <>
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
                              variant={floorPlanUrl ? 'secondary' : 'primary'}
                              size="sm"
                              disabled={uploading}
                              onClick={() => document.getElementById(`floor-plan-upload-${eventId}`)?.click()}
                            >
                              <Upload className="h-4 w-4" />
                              {uploading
                                ? tt('Envoi…', 'Uploading…', 'Enviando…')
                                : floorPlanUrl
                                  ? tt('Remplacer l’image', 'Replace the image', 'Reemplazar la imagen')
                                  : tt('Importer une image', 'Upload an image', 'Importar una imagen')}
                            </OrgButton>
                          </>
                        )}
                        {floorPlanUrl && (
                          <OrgButton variant="ghost" size="sm" onClick={() => setPlanPreviewOpen(true)}>
                            <Maximize2 className="h-4 w-4" />
                            {tt('Voir en grand', 'View full size', 'Ver en grande')}
                          </OrgButton>
                        )}
                      </div>
                    )}

                    {/* Zones → formules : ce que le client aura sous les yeux. */}
                    <div className={`border-t ${dividerCls} pt-4`}>
                      <div className="mb-2.5 flex items-center justify-between">
                        <FieldLabel>{tt('Zones & formules', 'Zones & packages', 'Zonas y fórmulas')}</FieldLabel>
                        <span style={{ color: T3, fontSize: 11 }}>{zones.length} · {packs.length}</span>
                      </div>
                      {zones.length === 0 ? (
                        <p style={{ color: T3, fontSize: 11.5 }}>
                          {tt('Aucune zone pour le moment. Créez-les dans l’onglet Zones.', 'No zone yet. Create them in the Zones tab.', 'Ninguna zona todavía. Créalas en la pestaña Zonas.')}
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {zones.map((z) => {
                            const zonePacks = packs.filter((pk) => pk.zone_id === z.id);
                            const onPlan = tablesByZone.get(z.id);
                            return (
                              <div key={z.id}>
                                <div className="flex items-center gap-2">
                                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: z.color }} />
                                  <span className="truncate" style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>{z.name}</span>
                                  <span className="shrink-0" style={{ color: T3, fontSize: 11 }}>
                                    · {onPlan ?? z.tables_count} {tt('tables', 'tables', 'mesas')}{onPlan !== undefined ? ` ${tt('sur le plan', 'on the plan', 'en el plano')}` : ''}
                                  </span>
                                </div>
                                {zonePacks.length === 0 ? (
                                  <p className="mt-1" style={{ color: T3, fontSize: 11, marginLeft: 18 }}>
                                    {tt('Aucune formule', 'No package', 'Sin fórmula')}
                                  </p>
                                ) : (
                                  <ul className="mt-1 space-y-0.5" style={{ marginLeft: 18 }}>
                                    {zonePacks.map((pk) => {
                                      const bound = tablesByPack.get(pk.id);
                                      return (
                                        <li key={pk.id} className="flex items-baseline justify-between gap-2">
                                          <span className="truncate" style={{ color: T2, fontSize: 12 }}>{pk.name}</span>
                                          <span className="shrink-0 tabular-nums" style={{ color: T3, fontSize: 11 }}>
                                            {Number(pk.base_price).toFixed(0)} € · {pk.base_capacity} {tt('pers.', 'guests', 'pers.')}
                                            {bound !== undefined
                                              ? ` · ${bound} ${tt('tables', 'tables', 'mesas')}`
                                              : pk.limit_tables ? ` · ${pk.tables_count} max` : ''}
                                            {pk.payment_mode === 'on_site' ? ` · ${tt('sur place', 'on site', 'en el local')}` : ''}
                                          </span>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Le service du soir (réservations, placement, arrivées) vit sur la page Service VIP. */}
      {soloOrganizer && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 rounded-xl p-3" style={{ border: `1px solid ${BORDER}`, background: INNER_BG }}>
          <div className="flex items-center gap-2" style={{ color: T2, fontSize: 12.5 }}>
            <Crown className="h-4 w-4" style={{ color: RED }} />
            {tt('Réservations, placement et arrivées se gèrent dans le Service VIP.', 'Reservations, placement and arrivals are handled in the VIP Service.', 'Reservas, colocación y llegadas se gestionan en el Servicio VIP.')}
          </div>
          <OrgButton size="sm" variant="secondary" onClick={() => navigate(`/organizer-app/vip-service?event=${eventId}`)}>
            {tt('Ouvrir le Service VIP', 'Open VIP Service', 'Abrir Servicio VIP')} <ArrowRight className="h-3.5 w-3.5" />
          </OrgButton>
        </div>
      )}

      {/* Enregistrer la soirée comme salle VIP */}
      <Dialog open={saveRoomOpen} onOpenChange={setSaveRoomOpen}>
        <DialogContent style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18 }}>
          <DialogHeader><DialogTitle style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>{tt('Enregistrer comme salle VIP', 'Save as VIP room', 'Guardar como sala VIP')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p style={{ color: T3, fontSize: 12.5 }}>
              {tt(
                'Le plan, les zones et les packs de cette soirée sont gardés dans votre historique pour être rejoués sur une prochaine soirée dans le même établissement.',
                'This event’s plan, zones and packs are kept in your history to replay on a future event at the same venue.',
                'El plano, zonas y packs de esta noche se guardan en tu historial para reutilizarlos en una próxima noche en el mismo local.',
              )}
            </p>
            <div>
              <FieldLabel>{tt('Nom de la salle (établissement)', 'Room name (venue)', 'Nombre de la sala (local)')}</FieldLabel>
              <DarkInput value={saveRoomName} onChange={setSaveRoomName} placeholder={tt('Ex : Le Baron — grande salle', 'e.g. Le Baron — main room', 'Ej.: Le Baron — sala principal')} />
            </div>
            {rooms.length > 0 && (
              <div>
                <FieldLabel>{tt('Enregistrer', 'Save', 'Guardar')}</FieldLabel>
                <select className="w-full" value={saveRoomTarget} onChange={(e) => setSaveRoomTarget(e.target.value)} style={{ ...daInputStyle, height: 42, cursor: 'pointer' }}>
                  <option value="new" style={{ background: '#0a0a0c' }}>{tt('Comme nouvelle salle', 'As a new room', 'Como nueva sala')}</option>
                  {rooms.map((r) => <option key={r.id} value={r.id} style={{ background: '#0a0a0c' }}>{tt('Mettre à jour', 'Update', 'Actualizar')} « {r.name} »</option>)}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <OrgButton variant="primary" disabled={savingRoom} onClick={saveRoom}>{savingRoom ? tt('Enregistrement…', 'Saving…', 'Guardando…') : tt('Enregistrer', 'Save', 'Guardar')}</OrgButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lightbox de l'image illustrative. */}
      <Dialog open={planPreviewOpen} onOpenChange={setPlanPreviewOpen}>
        <DialogContent className="max-w-4xl border-0 bg-[#0a0a0c] p-2 sm:p-3">
          <DialogHeader className="sr-only">
            <DialogTitle>{tt('Plan de salle illustratif', 'Illustrative floor plan', 'Plano de sala ilustrativo')}</DialogTitle>
          </DialogHeader>
          {floorPlanUrl && (
            <img
              src={floorPlanUrl}
              alt={tt('Plan de salle illustratif', 'Illustrative floor plan', 'Plano de sala ilustrativo')}
              className="mx-auto block h-auto w-auto max-w-full rounded-lg object-contain"
              style={{ maxHeight: '82vh' }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Éditeur de plan interactif — event-scopé (RPC upsert_event_floor_plan). */}
      {soloOrganizer && (
        <FloorPlanEditor
          open={planEditorOpen}
          onClose={() => setPlanEditorOpen(false)}
          venueId={clubId ?? ''}
          eventId={eventId}
          existingLayout={floorPlan?.layout as unknown as React.ComponentProps<typeof FloorPlanEditor>['existingLayout']}
          existingBackgroundUrl={floorPlanUrl}
          zones={zones.map((z) => ({ id: z.id, name: z.name, color: z.color }))}
          packs={packs.map((pk) => ({ id: pk.id, name: pk.name, zoneId: pk.zone_id, baseCapacity: pk.base_capacity, basePrice: Number(pk.base_price) }))}
          onSave={async () => { await syncZoneCountsFromLayout(); await loadAll(); }}
        />
      )}

      {/* Zone dialog */}
      <Dialog open={zoneOpen} onOpenChange={setZoneOpen}>
        <DialogContent style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18 }}>
          <DialogHeader><DialogTitle style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>{editingZone ? tt('Modifier zone', 'Edit zone', 'Editar zona') : tt('Nouvelle zone', 'New zone', 'Nueva zona')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><FieldLabel>{tt('Nom', 'Name', 'Nombre')}</FieldLabel><DarkInput value={zoneForm.name} onChange={(v) => setZoneForm({ ...zoneForm, name: v })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>{tt('Couleur', 'Color', 'Color')}</FieldLabel>
                <input type="color" value={zoneForm.color} onChange={(e) => setZoneForm({ ...zoneForm, color: e.target.value })} style={{ ...daInputStyle, height: 42, padding: 4, cursor: 'pointer' }} />
              </div>
              <div>
                <FieldLabel>{tt('Nb. max de tables', 'Max tables', 'Nº máx. de mesas')}</FieldLabel>
                <input type="number" min="1" value={zoneForm.tables_count} onChange={(e) => setZoneForm({ ...zoneForm, tables_count: e.target.value })} style={daInputStyle} />
                <p className="mt-1" style={{ color: T3, fontSize: 10 }}>
                  {tt(
                    'Limite la vente : aucune réservation ne sera acceptée au-delà.',
                    'Sales cap: bookings above this number will be rejected.',
                    'Límite de venta: no se aceptará ninguna reserva por encima.',
                  )}
                </p>
              </div>
            </div>
          </div>
          <DialogFooter><OrgButton variant="primary" onClick={saveZone}>{tt('Enregistrer', 'Save', 'Guardar')}</OrgButton></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pack dialog */}
      <Dialog open={packOpen} onOpenChange={setPackOpen}>
        <DialogContent style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18 }}>
          <DialogHeader><DialogTitle style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>{editingPack ? tt('Modifier pack', 'Edit pack', 'Editar pack') : tt('Nouveau pack', 'New pack', 'Nuevo pack')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <FieldLabel>{tt('Zone', 'Zone', 'Zona')}</FieldLabel>
              <select className="w-full" style={{ ...daInputStyle, height: 42, cursor: 'pointer' }} value={packForm.zone_id} onChange={(e) => setPackForm({ ...packForm, zone_id: e.target.value })}>
                <option value="" style={{ background: '#0a0a0c' }}>{tt('Choisir...', 'Choose...', 'Elegir...')}</option>
                {zones.map((z) => <option key={z.id} value={z.id} style={{ background: '#0a0a0c' }}>{z.name}</option>)}
              </select>
            </div>
            <div><FieldLabel>{tt('Nom', 'Name', 'Nombre')}</FieldLabel><DarkInput value={packForm.name} onChange={(v) => setPackForm({ ...packForm, name: v })} /></div>
            <div><FieldLabel>{tt('Description', 'Description', 'Descripción')}</FieldLabel><DarkTextarea rows={2} value={packForm.description} onChange={(v) => setPackForm({ ...packForm, description: v })} /></div>
            {/* Où l'argent se règle : en ligne via Yuno (acompte ou total), ou tout
                sur place — aucun paiement en ligne, aucun compte Stripe requis,
                la réservation est confirmée immédiatement. */}
            <div>
              <FieldLabel>{tt('Paiement', 'Payment', 'Pago')}</FieldLabel>
              <select className="w-full" style={{ ...daInputStyle, height: 42, cursor: 'pointer' }} value={packForm.payment_mode} onChange={(e) => setPackForm({ ...packForm, payment_mode: e.target.value as 'online' | 'on_site' })}>
                <option value="online" style={{ background: '#0a0a0c' }}>{tt('En ligne via Yuno (acompte ou total)', 'Online via Yuno (deposit or full)', 'En línea vía Yuno (señal o total)')}</option>
                <option value="on_site" style={{ background: '#0a0a0c' }}>{tt('Sur place — aucun paiement en ligne', 'On site — no online payment', 'En el local — sin pago en línea')}</option>
              </select>
              {packForm.payment_mode === 'on_site' && (
                <p style={{ color: '#34D399', fontSize: 11, marginTop: 4, lineHeight: 1.45 }}>
                  {tt(
                    'Le client réserve sans payer : la réservation est confirmée tout de suite, le prix affiché se règle au club. Aucun compte Stripe nécessaire.',
                    'Guests book without paying: the reservation is confirmed right away, the displayed price is settled at the venue. No Stripe account needed.',
                    'El cliente reserva sin pagar: la reserva se confirma al instante, el precio mostrado se paga en el local. No hace falta cuenta Stripe.',
                  )}
                </p>
              )}
            </div>
            {/* Plafond propre à la formule : « 4 tables à 600 € » dans une zone qui en compte 6. */}
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center gap-3 rounded-xl p-3" style={{ background: packForm.limit_tables ? 'rgba(232,25,44,0.06)' : INNER_BG, border: `1px solid ${packForm.limit_tables ? 'rgba(232,25,44,0.18)' : BORDER}` }}>
                <Switch checked={packForm.limit_tables} onCheckedChange={(v) => setPackForm({ ...packForm, limit_tables: v })} />
                <span style={{ color: packForm.limit_tables ? T1 : T2, fontSize: 13 }}>{tt('Nombre de tables limité pour cette formule', 'Limit the number of tables for this package', 'Número de mesas limitado para esta fórmula')}</span>
              </label>
              {packForm.limit_tables && (
                <div className="grid grid-cols-2 items-end gap-2">
                  <div><FieldLabel>{tt('Tables pour cette formule', 'Tables for this package', 'Mesas para esta fórmula')}</FieldLabel><input type="number" min="1" value={packForm.tables_count} onChange={(e) => setPackForm({ ...packForm, tables_count: e.target.value })} style={daInputStyle} /></div>
                  <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.45 }}>{tt('En plus du plafond de la zone. Si des tables du plan sont fixées à cette formule, leur nombre fait foi.', 'On top of the zone cap. When tables on the plan are pinned to this package, their count wins.', 'Además del tope de la zona. Si hay mesas del plano fijadas a esta fórmula, su número manda.')}</p>
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><FieldLabel>{tt('Prix €', 'Price €', 'Precio €')}</FieldLabel><input type="number" min="0" step="1" value={packForm.base_price} onChange={(e) => setPackForm({ ...packForm, base_price: e.target.value })} style={daInputStyle} /></div>
              <div><FieldLabel>{tt('Capacité', 'Guests', 'Capacidad')}</FieldLabel><input type="number" min="1" value={packForm.base_capacity} onChange={(e) => setPackForm({ ...packForm, base_capacity: e.target.value })} style={daInputStyle} /></div>
              <div><FieldLabel>{tt('Acompte €', 'Deposit €', 'Señal €')}</FieldLabel><input type="number" min="0" value={packForm.deposit} disabled={packForm.payment_mode === 'on_site'} onChange={(e) => setPackForm({ ...packForm, deposit: e.target.value })} style={{ ...daInputStyle, opacity: packForm.payment_mode === 'on_site' ? 0.4 : 1 }} /></div>
            </div>
            {/* Acompte 0 = paiement INTÉGRAL au checkout : dit noir sur blanc,
                sinon une table « 800 € sans acompte » débite 800 € sans prévenir. */}
            {packForm.payment_mode !== 'on_site' && <p style={{ color: (parseFloat(packForm.deposit) || 0) > 0 ? T3 : '#E8A019', fontSize: 11, marginTop: -4, lineHeight: 1.45 }}>
              {(parseFloat(packForm.deposit) || 0) > 0
                ? tt(
                    "Le client paie l'acompte en ligne, le reste sur place.",
                    'The client pays the deposit online, the rest at the venue.',
                    'El cliente paga la señal en línea y el resto en el local.',
                  )
                : tt(
                    'Acompte à 0 : le client paiera le prix total de la table en ligne.',
                    'Deposit at 0: the client will pay the full table price online.',
                    'Señal a 0: el cliente pagará el precio total de la mesa en línea.',
                  )}
            </p>}
            <div><FieldLabel>{tt('Inclus (texte libre)', 'Includes (free text)', 'Incluye (texto libre)')}</FieldLabel><DarkTextarea rows={2} placeholder={tt('Ex: 1 bouteille de vodka, 6 mixers', 'e.g. 1 vodka bottle, 6 mixers', 'Ej.: 1 botella de vodka, 6 mixers')} value={packForm.included_items} onChange={(v) => setPackForm({ ...packForm, included_items: v })} /></div>
            {/* Heure d'arrivée limite (optionnelle) — affichée au client à la résa */}
            <div>
              <label className="flex items-center gap-2.5 cursor-pointer" style={{ color: packForm.arrival_deadline ? T1 : T2, fontSize: 13 }}>
                <input type="checkbox" checked={!!packForm.arrival_deadline} onChange={(e) => setPackForm({ ...packForm, arrival_deadline: e.target.checked ? '01:00' : '' })} style={{ accentColor: RED, width: 15, height: 15 }} />
                <span className="flex items-center gap-1.5"><Clock size={13} />{tt('Heure d’arrivée limite', 'Arrival cutoff time', 'Hora límite de llegada')}</span>
              </label>
              {packForm.arrival_deadline && (
                <div className="mt-2">
                  <input type="time" value={packForm.arrival_deadline} onChange={(e) => setPackForm({ ...packForm, arrival_deadline: e.target.value })} style={{ ...daInputStyle, colorScheme: 'dark' }} />
                  <p style={{ color: T3, fontSize: 11, marginTop: 4 }}>{tt('Le client devra arriver avant cette heure, sinon sa table pourra être libérée.', 'Guests must arrive before this time, or their table may be released.', 'El cliente deberá llegar antes de esta hora, o su mesa podrá liberarse.')}</p>
                </div>
              )}
            </div>
          </div>
          <DialogFooter><OrgButton variant="primary" onClick={savePack}>{tt('Enregistrer', 'Save', 'Guardar')}</OrgButton></DialogFooter>
        </DialogContent>
      </Dialog>
    </OrgCard>
  );
}
