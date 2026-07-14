import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { Plus, Trash2, Save, Loader2, GripVertical, Square, Image, ZoomIn, ZoomOut, Move, Copy, Check, AlertTriangle } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { FloorPlanTableShape } from '@/types';
import { renderTableShape, ShapeIcon } from '@/components/vip/floorPlanShapes';
import { getFittedBackgroundRect } from '@/lib/floorPlanBackground';

interface FloorTable {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  capacity: number;
  maxExtraPersons: number;
  extraPersonPrice: number;
  zoneId?: string;
  zoneName?: string;
  zoneColor?: string;
  shape?: FloorPlanTableShape;
  color?: string;
  borderRadius?: number;
  fillOpacity?: number;
}

interface FloorZoneArea {
  id: string;
  zoneId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fillOpacity?: number;
  borderRadius?: number;
  showLabel?: boolean;
  labelOffsetX?: number;
  labelOffsetY?: number;
  labelFontSize?: number;
  labelRotation?: number;
}

interface FloorPlanEditorProps {
  open: boolean;
  onClose: () => void;
  venueId: string;
  existingLayout?: { tables: FloorTable[]; zoneAreas?: FloorZoneArea[]; bgOffset?: { x: number; y: number }; bgScale?: number } | null;
  existingBackgroundUrl?: string | null;
  zones: { id: string; name: string; color: string }[];
  onSave: () => void;
}

const GRID_SIZE = 20;
const SNAP_THRESHOLD = 5;
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 400;

const SHAPES: FloorPlanTableShape[] = ['rectangle', 'circle', 'diamond', 'star'];

export function FloorPlanEditor({
  open,
  onClose,
  venueId,
  existingLayout,
  existingBackgroundUrl,
  zones,
  onSave,
}: FloorPlanEditorProps) {
  const { t } = useLanguage();
  const [tables, setTables] = useState<FloorTable[]>([]);
  const [zoneAreas, setZoneAreas] = useState<FloorZoneArea[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [selectedZoneArea, setSelectedZoneArea] = useState<string | null>(null);
  const [hoveredZoneArea, setHoveredZoneArea] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ type: 'table' | 'zone' | 'bg' | 'zone-label'; id: string } | null>(null);
  const [resizing, setResizing] = useState<{ type: 'table' | 'zone'; id: string; corner: string } | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [saving, setSaving] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [bgOpacity, setBgOpacity] = useState(0.75);
  const [bgOffset, setBgOffset] = useState({ x: 0, y: 0 });
  const [bgScale, setBgScale] = useState(1);
  const [bgDragMode, setBgDragMode] = useState(false);
  const [uploadingBg, setUploadingBg] = useState(false);
  const [bgImageSize, setBgImageSize] = useState({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
  const [alignGuides, setAlignGuides] = useState<{ type: 'h' | 'v'; pos: number }[]>([]);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSnapshotRef = useRef<string | null>(null);
  const errorToastShownRef = useRef(false);
  // Where a table sat when its drag began — lets handleEnd tell a real drag from a plain click.
  const tableDragStartRef = useRef<{ x: number; y: number } | null>(null);
  // Latest state, mirrored into a ref so async writers persist the CURRENT layout, never a
  // stale closure. writeChainRef serializes every write so they can't race / clobber.
  const liveRef = useRef({ tables, zoneAreas, bgOffset, bgScale, backgroundUrl, venueId });
  const writeChainRef = useRef<Promise<unknown>>(Promise.resolve());

  // Single canonical serializer — used for both the DB write and the dirty-check,
  // so the autosave snapshot and the saved layout always normalize identically.
  const buildLayout = (
    tbls: FloorTable[] = tables,
    zAreas: FloorZoneArea[] = zoneAreas,
    off: { x: number; y: number } = bgOffset,
    scale: number = bgScale,
  ) => ({
    tables: tbls.map(t => ({
      id: t.id, name: t.name, x: t.x, y: t.y, width: t.width, height: t.height,
      capacity: t.capacity, maxExtraPersons: t.maxExtraPersons || 0, extraPersonPrice: t.extraPersonPrice || 0,
      zoneId: t.zoneId || null, zoneName: t.zoneName || null,
      zoneColor: t.zoneColor || null, shape: t.shape || 'rectangle', color: t.color || null,
      borderRadius: t.borderRadius ?? 6, fillOpacity: t.fillOpacity ?? 0.55,
    })),
    zoneAreas: zAreas.map(z => ({ id: z.id, zoneId: z.zoneId, x: z.x, y: z.y, width: z.width, height: z.height, fillOpacity: z.fillOpacity ?? 0.05, borderRadius: z.borderRadius ?? 8, showLabel: z.showLabel ?? true, labelOffsetX: z.labelOffsetX ?? 0, labelOffsetY: z.labelOffsetY ?? 0, labelFontSize: z.labelFontSize ?? 10, labelRotation: z.labelRotation ?? 0 })),
    bgOffset: off, bgScale: scale,
  });

  const snapshotOf = (
    tbls: FloorTable[], zAreas: FloorZoneArea[], off: { x: number; y: number }, scale: number, bgUrl: string | null,
  ) => JSON.stringify({ layout: buildLayout(tbls, zAreas, off, scale), bg: bgUrl || null });

  // Mirror current state every render so async writers read the latest, not a stale closure.
  liveRef.current = { tables, zoneAreas, bgOffset, bgScale, backgroundUrl, venueId };

  type LiveState = typeof liveRef.current;

  // Atomic write, via RPC and not a PostgREST upsert: the venue-level plan is now guarded by a
  // PARTIAL unique index (venue_id WHERE event_id IS NULL), so a club can hold both its venue plan
  // and one event-scoped plan per co-event. Postgres cannot infer a partial index without its
  // predicate, and PostgREST cannot emit one — `onConflict: 'venue_id'` fails with 42P10. The RPC
  // spells the predicate out. It stays SECURITY INVOKER, so RLS and the seated-table guard (23514)
  // behave exactly as before. A null id back means the write was blocked (RLS / not the owner),
  // which we surface as an error instead of reporting a phantom success.
  const writeLayout = async (live: LiveState): Promise<{ ok: boolean; code?: string }> => {
    if (!live.venueId) return { ok: false, code: 'NO_VENUE' };
    const layout = buildLayout(live.tables, live.zoneAreas, live.bgOffset, live.bgScale);
    const { data: id, error } = await supabase.rpc('upsert_venue_floor_plan', {
      p_venue_id: live.venueId,
      p_layout: JSON.parse(JSON.stringify(layout)),
      p_background_image_url: live.backgroundUrl,
    });
    if (error) {
      console.error('Error saving floor plan:', error);
      return { ok: false, code: (error as { code?: string }).code };
    }
    if (!id) {
      console.error('Floor plan save persisted no row (RLS / ownership?)');
      return { ok: false, code: 'NO_ROW' };
    }
    return { ok: true };
  };

  // Single-flight writer: every save (autosave, manual, close) joins one promise chain, so writes
  // never overlap and each link persists the LATEST state from liveRef. Redundant links no-op via
  // the snapshot guard. This is what makes "add tables → save" land the final layout, every time.
  const persist = (): Promise<{ ok: boolean; code?: string }> => {
    const run = writeChainRef.current.then(async () => {
      const live = liveRef.current;
      const snap = snapshotOf(live.tables, live.zoneAreas, live.bgOffset, live.bgScale, live.backgroundUrl);
      if (snap === lastSavedSnapshotRef.current) return { ok: true };
      setSaveState('saving');
      const res = await writeLayout(live);
      if (res.ok) {
        lastSavedSnapshotRef.current = snap;
        errorToastShownRef.current = false;
        setSaveState('saved');
      } else {
        setSaveState('error');
      }
      return res;
    });
    writeChainRef.current = run.catch(() => undefined);
    return run;
  };

  useEffect(() => {
    const nextTables: FloorTable[] = existingLayout?.tables
      ? existingLayout.tables.map(t => ({ ...t, maxExtraPersons: t.maxExtraPersons ?? 0, extraPersonPrice: t.extraPersonPrice ?? 0 }))
      : [];
    const nextZoneAreas: FloorZoneArea[] = existingLayout?.zoneAreas ?? [];
    const nextBgOffset = existingLayout?.bgOffset ?? { x: 0, y: 0 };
    const nextBgScale = existingLayout?.bgScale ?? 1;
    const nextBgUrl = existingBackgroundUrl || null;
    setTables(nextTables);
    setZoneAreas(nextZoneAreas);
    setBgOffset(nextBgOffset);
    setBgScale(nextBgScale);
    setBackgroundUrl(nextBgUrl);
    // Capture the just-loaded layout as the baseline so autosave doesn't fire on open.
    lastSavedSnapshotRef.current = snapshotOf(nextTables, nextZoneAreas, nextBgOffset, nextBgScale, nextBgUrl);
    setSaveState('saved');
    errorToastShownRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingLayout, existingBackgroundUrl, open]);

  // Debounced autosave: persists ~1s after the last change to any saved field.
  // Snapshot equality keeps it from writing when nothing actually changed.
  useEffect(() => {
    if (!open || !venueId) return;
    const snapshot = snapshotOf(tables, zoneAreas, bgOffset, bgScale, backgroundUrl);
    if (snapshot === lastSavedSnapshotRef.current) return;
    setSaveState('saving');
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      persist().then(res => {
        if (!res.ok && !errorToastShownRef.current) {
          errorToastShownRef.current = true;
          toast.error(res.code === '23514' ? t('vipHost.floorPlanTableInUse') : t('common.error'));
        }
      });
    }, 1000);
    return () => { if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; } };
    // Content-only deps on purpose: reacting to `open` here would race the hydration
    // effect (stale snapshot vs freshly-set baseline). `open`/`venueId` are read via the guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, zoneAreas, bgOffset, bgScale, backgroundUrl]);

  useEffect(() => {
    if (!backgroundUrl) {
      setBgImageSize({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
      return;
    }

    const image = new window.Image();
    image.onload = () => {
      setBgImageSize({
        width: image.naturalWidth || CANVAS_WIDTH,
        height: image.naturalHeight || CANVAS_HEIGHT,
      });
    };
    image.src = backgroundUrl;
  }, [backgroundUrl]);

  const handleBgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingBg(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${venueId}/floor-plan-bg.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('venue-assets')
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('venue-assets').getPublicUrl(path);
      const cacheBustedUrl = `${urlData.publicUrl}?v=${Date.now()}`;
      setBackgroundUrl(cacheBustedUrl);
      setBgImageSize({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
      setBgOffset({ x: 0, y: 0 });
      setBgScale(1);
      toast.success(t('vipHost.bgUploaded'));
    } catch {
      toast.error(t('common.error'));
    } finally {
      setUploadingBg(false);
    }
  };

  const addZoneArea = (zoneId: string) => {
    const zone = zones.find(z => z.id === zoneId);
    if (!zone) return;
    const newZoneArea: FloorZoneArea = {
      id: crypto.randomUUID(),
      zoneId,
      x: 40, y: 40, width: 200, height: 150,
    };
    setZoneAreas([...zoneAreas, newZoneArea]);
    setSelectedZoneArea(newZoneArea.id);
    setSelectedTable(null);
  };

  // Next collision-free "Table N" label, scoped to a zone (or to unzoned tables when no zoneId).
  // Uses the highest existing index + 1 — NOT the count — so deletes/renames/duplicates can never
  // produce two tables with the same name in a zone (which would be ambiguous for staff & guests).
  const nextTableName = (pool: FloorTable[], zoneId?: string) => {
    const scoped = pool.filter(t => (zoneId ? t.zoneId === zoneId : !t.zoneId));
    let max = 0;
    for (const t of scoped) {
      const m = /(\d+)\s*$/.exec((t.name || '').trim());
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `Table ${max + 1}`;
  };

  const addTable = () => {
    // Cascade each new table so they don't stack on the exact same spot.
    const w = 40, h = 40;
    const slot = tables.length % 9;
    const newTable: FloorTable = {
      id: crypto.randomUUID(),
      name: nextTableName(tables),
      x: Math.min(60 + slot * 22, CANVAS_WIDTH - w),
      y: Math.min(60 + slot * 22, CANVAS_HEIGHT - h),
      width: w, height: h, capacity: 6, maxExtraPersons: 0, extraPersonPrice: 0,
      shape: 'rectangle',
    };
    setTables([...tables, newTable]);
    setSelectedTable(newTable.id);
    setSelectedZoneArea(null);
  };

  const duplicateTable = (tableId: string) => {
    const src = tables.find(t => t.id === tableId);
    if (!src) return;
    const dup: FloorTable = {
      ...src,
      id: crypto.randomUUID(),
      name: nextTableName(tables, src.zoneId),
      x: Math.min(src.x + 20, CANVAS_WIDTH - src.width),
      y: Math.min(src.y + 20, CANVAS_HEIGHT - src.height),
    };
    setTables([...tables, dup]);
    setSelectedTable(dup.id);
    setSelectedZoneArea(null);
  };

  const removeTable = (tableId: string) => {
    setTables(tables.filter(t => t.id !== tableId));
    if (selectedTable === tableId) setSelectedTable(null);
  };

  const removeZoneArea = (zoneAreaId: string) => {
    setZoneAreas(zoneAreas.filter(z => z.id !== zoneAreaId));
    if (selectedZoneArea === zoneAreaId) setSelectedZoneArea(null);
  };

  const updateTable = (tableId: string, updates: Partial<FloorTable>) => {
    setTables(tables.map(t => t.id === tableId ? { ...t, ...updates } : t));
  };

  const updateZoneArea = (zoneAreaId: string, updates: Partial<FloorZoneArea>) => {
    setZoneAreas(zoneAreas.map(z => z.id === zoneAreaId ? { ...z, ...updates } : z));
  };

  // Keyboard shortcuts — only when the editor is open and focus isn't in a field.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const tag = (el?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable) return;

      if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
        if (selectedTable) { e.preventDefault(); duplicateTable(selectedTable); }
        return;
      }
      if (e.key === 'Escape') { setSelectedTable(null); setSelectedZoneArea(null); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedTable) { e.preventDefault(); removeTable(selectedTable); }
        else if (selectedZoneArea) { e.preventDefault(); removeZoneArea(selectedZoneArea); }
        return;
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (!selectedTable) return;
        const tbl = tables.find(t => t.id === selectedTable);
        if (!tbl) return;
        e.preventDefault();
        const dist = e.shiftKey ? 10 : 1;
        let { x, y } = tbl;
        if (e.key === 'ArrowUp') y -= dist;
        if (e.key === 'ArrowDown') y += dist;
        if (e.key === 'ArrowLeft') x -= dist;
        if (e.key === 'ArrowRight') x += dist;
        updateTable(selectedTable, {
          x: Math.max(0, Math.min(x, CANVAS_WIDTH - tbl.width)),
          y: Math.max(0, Math.min(y, CANVAS_HEIGHT - tbl.height)),
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedTable, selectedZoneArea, tables]);

  const getEventPosition = (e: React.MouseEvent | React.TouchEvent) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    if ('touches' in e) {
      const touch = e.touches[0];
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const handleTableStart = (e: React.MouseEvent | React.TouchEvent, tableId: string) => {
    e.preventDefault(); e.stopPropagation();
    if (bgDragMode) return;
    const table = tables.find(t => t.id === tableId);
    if (!table) return;
    const pos = getEventPosition(e);
    setDragging({ type: 'table', id: tableId });
    setDragOffset({ x: pos.x - table.x, y: pos.y - table.y });
    tableDragStartRef.current = { x: table.x, y: table.y };
    setSelectedTable(tableId);
    setSelectedZoneArea(null);
  };

  const handleZoneStart = (e: React.MouseEvent | React.TouchEvent, zoneAreaId: string) => {
    e.preventDefault(); e.stopPropagation();
    if (bgDragMode) return;
    const zoneArea = zoneAreas.find(z => z.id === zoneAreaId);
    if (!zoneArea) return;
    const pos = getEventPosition(e);
    setDragging({ type: 'zone', id: zoneAreaId });
    setDragOffset({ x: pos.x - zoneArea.x, y: pos.y - zoneArea.y });
    setSelectedZoneArea(zoneAreaId);
    setSelectedTable(null);
  };

  const handleBgDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (!bgDragMode || !backgroundUrl) return;
    e.preventDefault();
    const pos = getEventPosition(e);
    setDragging({ type: 'bg', id: 'bg' });
    setDragOffset({ x: pos.x - bgOffset.x, y: pos.y - bgOffset.y });
  };

  const handleResizeStart = (e: React.MouseEvent | React.TouchEvent, type: 'table' | 'zone', id: string, corner: string) => {
    e.preventDefault(); e.stopPropagation();
    const pos = getEventPosition(e);
    if (type === 'zone') {
      const zoneArea = zoneAreas.find(z => z.id === id);
      if (zoneArea) setResizeStart({ x: pos.x, y: pos.y, width: zoneArea.width, height: zoneArea.height });
      setSelectedZoneArea(id); setSelectedTable(null);
    } else {
      const table = tables.find(t => t.id === id);
      if (table) setResizeStart({ x: pos.x, y: pos.y, width: table.width, height: table.height });
      setSelectedTable(id); setSelectedZoneArea(null);
    }
    setResizing({ type, id, corner });
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!svgRef.current) return;
    const pos = getEventPosition(e);

    if (resizing) {
      const deltaX = pos.x - resizeStart.x;
      const deltaY = pos.y - resizeStart.y;
      let newWidth = resizeStart.width;
      let newHeight = resizeStart.height;
      if (resizing.corner.includes('e')) newWidth = resizeStart.width + deltaX;
      if (resizing.corner.includes('s')) newHeight = resizeStart.height + deltaY;
      const minSize = resizing.type === 'zone' ? 30 : 15;
      newWidth = Math.max(minSize, Math.min(newWidth, CANVAS_WIDTH));
      newHeight = Math.max(minSize, Math.min(newHeight, CANVAS_HEIGHT));
      if (resizing.type === 'zone') updateZoneArea(resizing.id, { width: newWidth, height: newHeight });
      else updateTable(resizing.id, { width: newWidth, height: newHeight });
      return;
    }

    if (!dragging) return;

    if (dragging.type === 'bg') {
      setBgOffset({ x: pos.x - dragOffset.x, y: pos.y - dragOffset.y });
      return;
    }

    if (dragging.type === 'zone-label') {
      const zoneArea = zoneAreas.find(z => z.id === dragging.id);
      if (zoneArea) {
        const baseLabelX = zoneArea.x + zoneArea.width / 2;
        const baseLabelY = zoneArea.y + zoneArea.height + 13;
        updateZoneArea(dragging.id, {
          labelOffsetX: pos.x - dragOffset.x - baseLabelX,
          labelOffsetY: pos.y - dragOffset.y - baseLabelY,
        });
      }
      return;
    }

    let newX = pos.x - dragOffset.x;
    let newY = pos.y - dragOffset.y;

    // Smart alignment guides + snap to the nearest table edge/center (Figma-style)
    if (dragging.type === 'table') {
      const table = tables.find(t => t.id === dragging.id);
      if (table) {
        const cx = newX + table.width / 2;
        const cy = newY + table.height / 2;
        const right = newX + table.width;
        const bottom = newY + table.height;

        // Best snap candidate per axis: { dist, target (new x/y), guide (line position) }
        let bestVX: { dist: number; v: number; g: number } | null = null;
        let bestHY: { dist: number; v: number; g: number } | null = null;
        const considerV = (d: number, v: number, g: number) => { if (d < SNAP_THRESHOLD && (!bestVX || d < bestVX.dist)) bestVX = { dist: d, v, g }; };
        const considerH = (d: number, v: number, g: number) => { if (d < SNAP_THRESHOLD && (!bestHY || d < bestHY.dist)) bestHY = { dist: d, v, g }; };

        for (const other of tables) {
          if (other.id === dragging.id) continue;
          const oCx = other.x + other.width / 2;
          const oCy = other.y + other.height / 2;
          const oRight = other.x + other.width;
          const oBottom = other.y + other.height;

          // Vertical alignment (x): left/right edges, centers, edge-to-edge
          considerV(Math.abs(newX - other.x), other.x, other.x);
          considerV(Math.abs(right - oRight), oRight - table.width, oRight);
          considerV(Math.abs(cx - oCx), oCx - table.width / 2, oCx);
          considerV(Math.abs(newX - oRight), oRight, oRight);
          considerV(Math.abs(right - other.x), other.x - table.width, other.x);

          // Horizontal alignment (y): top/bottom edges, centers, edge-to-edge
          considerH(Math.abs(newY - other.y), other.y, other.y);
          considerH(Math.abs(bottom - oBottom), oBottom - table.height, oBottom);
          considerH(Math.abs(cy - oCy), oCy - table.height / 2, oCy);
          considerH(Math.abs(newY - oBottom), oBottom, oBottom);
          considerH(Math.abs(bottom - other.y), other.y - table.height, other.y);
        }

        const guides: { type: 'h' | 'v'; pos: number }[] = [];
        if (bestVX) { newX = (bestVX as { v: number }).v; guides.push({ type: 'v', pos: (bestVX as { g: number }).g }); }
        if (bestHY) { newY = (bestHY as { v: number }).v; guides.push({ type: 'h', pos: (bestHY as { g: number }).g }); }
        setAlignGuides(guides);
        newX = Math.max(0, Math.min(newX, CANVAS_WIDTH - table.width));
        newY = Math.max(0, Math.min(newY, CANVAS_HEIGHT - table.height));
      }
      updateTable(dragging.id, { x: newX, y: newY });
    } else {
      const zoneArea = zoneAreas.find(z => z.id === dragging.id);
      if (zoneArea) {
        newX = Math.max(0, Math.min(newX, CANVAS_WIDTH - zoneArea.width));
        newY = Math.max(0, Math.min(newY, CANVAS_HEIGHT - zoneArea.height));
      }
      updateZoneArea(dragging.id, { x: newX, y: newY });
    }
  };

  const handleEnd = () => {
    // Spatial zone membership only re-evaluates on a real DRAG — a plain click that just
    // selects a table must never change its zone. We compare against where the drag began.
    if (dragging?.type === 'table') {
      const table = tables.find(t => t.id === dragging.id);
      const start = tableDragStartRef.current;
      const moved = !!table && (!start || Math.abs(table.x - start.x) > 3 || Math.abs(table.y - start.y) > 3);
      if (table && moved) {
        const tableCx = table.x + table.width / 2;
        const tableCy = table.y + table.height / 2;
        const containingZone = zoneAreas.find(z =>
          tableCx >= z.x && tableCx <= z.x + z.width &&
          tableCy >= z.y && tableCy <= z.y + z.height
        );
        if (containingZone) {
          const zone = zones.find(z => z.id === containingZone.zoneId);
          if (zone && table.zoneId !== containingZone.zoneId) {
            // Count existing tables in this zone (excluding current)
            const name = nextTableName(tables.filter(t => t.id !== dragging.id), zone.id);
            updateTable(dragging.id, { zoneId: zone.id, zoneName: zone.name, zoneColor: zone.color, name });
          }
        } else if (table.zoneId && zoneAreas.some(z => z.zoneId === table.zoneId)) {
          // Only drop the zone if it's governed by a drawn area on the canvas and the table
          // was dragged out of it. Zones assigned via the dropdown (no area) stay put.
          updateTable(dragging.id, { zoneId: undefined, zoneName: undefined, zoneColor: undefined });
        }
      }
    }
    tableDragStartRef.current = null;
    setDragging(null); setResizing(null); setAlignGuides([]);
  };

  const backgroundRect = getFittedBackgroundRect({
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
    imageWidth: bgImageSize.width,
    imageHeight: bgImageSize.height,
    scale: bgScale,
    offsetX: bgOffset.x,
    offsetY: bgOffset.y,
  });

  // Explicit "Save" button — drains the write chain to the latest state, then closes.
  const handleSaveAndClose = async () => {
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
    if (!venueId) { onClose(); return; }
    setSaving(true);
    const res = await persist();
    setSaving(false);
    if (res.ok) {
      toast.success(t('vipHost.floorPlanSaved'));
      onSave();
      onClose();
    } else {
      // 23514 = the prevent_floor_plan_table_removal guard (table still seated).
      toast.error(res.code === '23514' ? t('vipHost.floorPlanTableInUse') : t('common.error'));
    }
  };

  // Closing via the X / overlay — flush any unsaved change through the chain, then refresh + close.
  const requestClose = () => {
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
    const snapshot = snapshotOf(tables, zoneAreas, bgOffset, bgScale, backgroundUrl);
    if (venueId && snapshot !== lastSavedSnapshotRef.current) {
      persist().finally(() => onSave());
    } else {
      onSave();
    }
    onClose();
  };

  const selectedTableData = tables.find(t => t.id === selectedTable);
  const selectedZoneAreaData = zoneAreas.find(z => z.id === selectedZoneArea);
  const getZoneInfo = (zoneId: string) => zones.find(z => z.id === zoneId);

  const handleZoneChange = (tableId: string, zoneId: string) => {
    const zone = zones.find(z => z.id === zoneId);
    const name = nextTableName(tables.filter(t => t.id !== tableId), zoneId);
    updateTable(tableId, { zoneId, zoneName: zone?.name, zoneColor: zone?.color, name });
  };

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && requestClose()}>
      <SheetContent side="bottom" className="h-[90vh] rounded-t-3xl">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center justify-between">
            <span className="flex items-center gap-3">
              {t('vipHost.floorPlanEditor')}
              <span className="flex items-center gap-1.5 text-xs font-normal" aria-live="polite">
                {saveState === 'saving' && <><Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /><span className="text-muted-foreground">{t('vipHost.autoSaving')}</span></>}
                {saveState === 'saved' && <><Check className="h-3 w-3 text-emerald-500" /><span className="text-muted-foreground">{t('vipHost.autoSaved')}</span></>}
                {saveState === 'error' && <><AlertTriangle className="h-3 w-3 text-destructive" /><span className="text-destructive">{t('vipHost.autoSaveError')}</span></>}
              </span>
            </span>
            <div className="flex gap-2 flex-wrap">
              <Select value="" onValueChange={(value) => value && addZoneArea(value)}>
                <SelectTrigger className="w-[140px] h-9">
                  <Square className="h-4 w-4 mr-1" />
                  <span className="text-sm">{t('vipHost.addZone')}</span>
                </SelectTrigger>
                <SelectContent>
                  {zones.map(zone => (
                    <SelectItem key={zone.id} value={zone.id}>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded" style={{ backgroundColor: zone.color }} />
                        {zone.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="cursor-pointer">
                <input type="file" accept="image/*" className="hidden" onChange={handleBgUpload} />
                <Button variant="outline" size="sm" asChild disabled={uploadingBg}>
                  <span>
                    {uploadingBg ? <Loader2 className="h-4 w-4 animate-spin" /> : <Image className="h-4 w-4 mr-1" />}
                    {backgroundUrl ? t('vipHost.changeBg') : t('vipHost.addBg')}
                  </span>
                </Button>
              </label>
              <Button variant="outline" size="sm" onClick={addTable}>
                <Plus className="h-4 w-4 mr-1" />
                {t('vipHost.addTable')}
              </Button>
              <Button size="sm" onClick={handleSaveAndClose} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1" />{t('common.save')}</>}
              </Button>
            </div>
          </SheetTitle>
        </SheetHeader>

        <div className="flex gap-4 h-[calc(100%-80px)]">
          {/* Canvas */}
          <div className="flex-1 bg-muted/30 rounded-xl p-4 overflow-auto">
            {/* BG controls */}
            {backgroundUrl && (
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-2 flex-1 min-w-[150px]">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{t('vipHost.bgOpacity')}</span>
                  <Slider value={[bgOpacity * 100]} onValueChange={([v]) => setBgOpacity(v / 100)} min={5} max={80} step={5} className="flex-1" />
                </div>
                <div className="flex items-center gap-2 flex-1 min-w-[150px]">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{t('vipHost.bgZoom')}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setBgScale(s => Math.max(0.2, s - 0.1))}>
                    <ZoomOut className="h-3 w-3" />
                  </Button>
                  <Slider value={[bgScale * 100]} onValueChange={([v]) => setBgScale(v / 100)} min={20} max={300} step={5} className="flex-1" />
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setBgScale(s => Math.min(3, s + 0.1))}>
                    <ZoomIn className="h-3 w-3" />
                  </Button>
                </div>
                <Button
                  variant={bgDragMode ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setBgDragMode(!bgDragMode)}
                >
                  <Move className="h-3 w-3 mr-1" />
                  {t('vipHost.moveBg')}
                </Button>
              </div>
            )}

            {/* Recommended size hint — always visible */}
            <p className="text-xs text-muted-foreground mb-2 text-center">
              📐 {t('vipHost.bgRecommended')}
            </p>

            <svg
              ref={svgRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              className={`bg-background rounded-lg border border-border mx-auto touch-none ${bgDragMode ? 'cursor-grab' : ''}`}
              onMouseMove={handleMove}
              onMouseUp={handleEnd}
              onMouseLeave={handleEnd}
              onTouchMove={handleMove}
              onTouchEnd={handleEnd}
              onTouchCancel={handleEnd}
              onMouseDown={(e) => {
                if (bgDragMode) { handleBgDragStart(e); return; }
                if (e.target === svgRef.current || (e.target as SVGElement).tagName === 'rect' && (e.target as SVGElement).getAttribute('fill') === 'url(#grid)') {
                  setSelectedTable(null);
                  setSelectedZoneArea(null);
                }
              }}
              onTouchStart={bgDragMode ? handleBgDragStart : undefined}
            >
              <defs>
                <pattern id="grid" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
                  <path d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`} fill="none" stroke="hsl(var(--border))" strokeWidth="0.3" strokeOpacity="0.15" />
                </pattern>
                <clipPath id="canvas-clip">
                  <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />
                </clipPath>
                <filter id="table-glow">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />

              {/* Empty-canvas hint */}
              {tables.length === 0 && zoneAreas.length === 0 && !backgroundUrl && (
                <text x={CANVAS_WIDTH / 2} y={CANVAS_HEIGHT / 2} textAnchor="middle" dominantBaseline="middle"
                  className="pointer-events-none select-none" fill="hsl(var(--muted-foreground))" opacity={0.55}
                  style={{ fontSize: '13px' }}>
                  {t('vipHost.emptyCanvasHint')}
                </text>
              )}

              {/* Background image with pan/zoom */}
              {backgroundUrl && (
                <g clipPath="url(#canvas-clip)">
                  <image
                    href={backgroundUrl}
                    x={backgroundRect.x}
                    y={backgroundRect.y}
                    width={backgroundRect.width}
                    height={backgroundRect.height}
                    preserveAspectRatio="xMidYMid meet"
                    opacity={bgOpacity}
                    className="pointer-events-none"
                  />
                </g>
              )}

              {/* Zone Areas — subtle outline only */}
              {zoneAreas.map((zoneArea) => {
                const zone = getZoneInfo(zoneArea.zoneId);
                if (!zone) return null;
                const isHovered = hoveredZoneArea === zoneArea.id;
                const showHandles = isHovered || resizing?.id === zoneArea.id;
                return (
                  <g key={zoneArea.id}
                    onMouseEnter={() => setHoveredZoneArea(zoneArea.id)}
                    onMouseLeave={() => setHoveredZoneArea(null)}
                  >
                    <rect x={zoneArea.x} y={zoneArea.y} width={zoneArea.width} height={zoneArea.height}
                      rx={zoneArea.borderRadius ?? 8} fill={zone.color} fillOpacity={zoneArea.fillOpacity ?? 0.05} stroke={zone.color} strokeWidth={0.75} strokeOpacity={0.4} strokeDasharray="6 4"
                      className="cursor-move touch-none"
                      onMouseDown={(e) => handleZoneStart(e, zoneArea.id)}
                      onTouchStart={(e) => handleZoneStart(e, zoneArea.id)}
                    />
                    {(zoneArea.showLabel !== false) && (
                      <text
                        x={zoneArea.x + zoneArea.width / 2 + (zoneArea.labelOffsetX ?? 0)}
                        y={zoneArea.y + zoneArea.height + 13 + (zoneArea.labelOffsetY ?? 0)}
                        textAnchor="middle" dominantBaseline="middle" fill={zone.color}
                        opacity={0.6}
                        transform={`rotate(${zoneArea.labelRotation ?? 0}, ${zoneArea.x + zoneArea.width / 2 + (zoneArea.labelOffsetX ?? 0)}, ${zoneArea.y + zoneArea.height + 13 + (zoneArea.labelOffsetY ?? 0)})`}
                        className="cursor-grab touch-none select-none" style={{ fontSize: (zoneArea.labelFontSize ?? 10) + 'px', fontWeight: 500, letterSpacing: '0.03em' }}
                        onMouseDown={(e) => {
                          e.preventDefault(); e.stopPropagation();
                          setDragging({ type: 'zone-label', id: zoneArea.id });
                          setDragOffset({ x: 0, y: 0 });
                          setSelectedZoneArea(zoneArea.id);
                          setSelectedTable(null);
                        }}
                        onTouchStart={(e) => {
                          e.preventDefault(); e.stopPropagation();
                          setDragging({ type: 'zone-label', id: zoneArea.id });
                          setDragOffset({ x: 0, y: 0 });
                          setSelectedZoneArea(zoneArea.id);
                          setSelectedTable(null);
                        }}
                      >{zone.name}</text>
                    )}
                    {showHandles && (
                      <>
                        <rect x={zoneArea.x + zoneArea.width - 10} y={zoneArea.y + zoneArea.height - 10} width={14} height={14} rx={3}
                          fill={zone.color} className="cursor-se-resize touch-none"
                          onMouseDown={(e) => handleResizeStart(e, 'zone', zoneArea.id, 'se')}
                          onTouchStart={(e) => handleResizeStart(e, 'zone', zoneArea.id, 'se')} />
                        <rect x={zoneArea.x + zoneArea.width - 3} y={zoneArea.y + zoneArea.height / 2 - 10} width={6} height={20} rx={3}
                          fill={zone.color} className="cursor-e-resize touch-none"
                          onMouseDown={(e) => handleResizeStart(e, 'zone', zoneArea.id, 'e')}
                          onTouchStart={(e) => handleResizeStart(e, 'zone', zoneArea.id, 'e')} />
                        <rect x={zoneArea.x + zoneArea.width / 2 - 10} y={zoneArea.y + zoneArea.height - 3} width={20} height={6} rx={3}
                          fill={zone.color} className="cursor-s-resize touch-none"
                          onMouseDown={(e) => handleResizeStart(e, 'zone', zoneArea.id, 's')}
                          onTouchStart={(e) => handleResizeStart(e, 'zone', zoneArea.id, 's')} />
                      </>
                    )}
                  </g>
                );
              })}

              {/* Tables — solid fill markers */}
              {tables.map((table) => {
                const isSelected = selectedTable === table.id;
                const accentColor = table.color || table.zoneColor || 'hsl(var(--primary))';
                const cx = table.x + table.width / 2;
                const cy = table.y + table.height / 2;
                const shortLabel = table.name.replace(/^table\s*/i, '').trim() || table.name;
                return (
                  <g key={table.id} filter={isSelected ? 'url(#table-glow)' : undefined}>
                    {renderTableShape({
                      shape: table.shape || 'rectangle',
                      x: table.x, y: table.y, width: table.width, height: table.height,
                      fill: accentColor,
                      fillOpacity: isSelected ? Math.min((table.fillOpacity ?? 0.55) + 0.15, 1) : (table.fillOpacity ?? 0.55),
                      stroke: isSelected ? 'white' : accentColor,
                      strokeWidth: isSelected ? 2 : 1,
                      borderRadius: table.borderRadius ?? 6,
                      className: 'cursor-move touch-none',
                      onMouseDown: (e) => handleTableStart(e, table.id),
                      onTouchStart: (e) => handleTableStart(e, table.id),
                    })}
                    <text x={cx} y={cy}
                      textAnchor="middle" dominantBaseline="central"
                      fill="white" opacity={isSelected ? 1 : 0.9}
                      className="pointer-events-none select-none"
                      style={{ fontSize: Math.min(table.width, table.height) * 0.4 + 'px', fontWeight: 700 }}>
                      {shortLabel}
                    </text>
                    {isSelected && (
                      <rect x={table.x + table.width - 6} y={table.y + table.height - 6} width={8} height={8} rx={2}
                        fill={accentColor} opacity={0.8} className="cursor-se-resize touch-none"
                        onMouseDown={(e) => handleResizeStart(e, 'table', table.id, 'se')}
                        onTouchStart={(e) => handleResizeStart(e, 'table', table.id, 'se')} />
                    )}
                  </g>
                );
              })}

              {/* Alignment guides */}
              {alignGuides.map((guide, i) =>
                guide.type === 'v' ? (
                  <line key={`guide-${i}`} x1={guide.pos} y1={0} x2={guide.pos} y2={CANVAS_HEIGHT}
                    stroke="hsl(var(--primary))" strokeWidth={0.5} strokeDasharray="4 3" opacity={0.6} className="pointer-events-none" />
                ) : (
                  <line key={`guide-${i}`} x1={0} y1={guide.pos} x2={CANVAS_WIDTH} y2={guide.pos}
                    stroke="hsl(var(--primary))" strokeWidth={0.5} strokeDasharray="4 3" opacity={0.6} className="pointer-events-none" />
                )
              )}
            </svg>
          </div>

          {/* Properties Panel */}
          <div className="w-72 bg-muted/30 rounded-xl p-4 overflow-y-auto">
            <h4 className="font-medium mb-4">
              {selectedZoneArea ? t('vipHost.zoneProperties') : t('vipHost.tableProperties')}
            </h4>

            {selectedZoneAreaData ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: getZoneInfo(selectedZoneAreaData.zoneId)?.color }} />
                  <span className="font-medium">{getZoneInfo(selectedZoneAreaData.zoneId)?.name}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">{t('vipHost.width')}</Label>
                    <Input type="number" value={selectedZoneAreaData.width}
                      onChange={(e) => updateZoneArea(selectedZoneAreaData.id, { width: parseInt(e.target.value) || 30 })}
                      min={30} max={600} step={1} />
                  </div>
                  <div>
                    <Label className="text-xs">{t('vipHost.height')}</Label>
                    <Input type="number" value={selectedZoneAreaData.height}
                      onChange={(e) => updateZoneArea(selectedZoneAreaData.id, { height: parseInt(e.target.value) || 30 })}
                      min={30} max={400} step={1} />
                  </div>
                </div>
                {/* Corner radius */}
                <div>
                  <Label className="text-xs">Coins arrondis</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Slider
                      value={[selectedZoneAreaData.borderRadius ?? 8]}
                      onValueChange={([v]) => updateZoneArea(selectedZoneAreaData.id, { borderRadius: v })}
                      min={0} max={40} step={1}
                      className="flex-1"
                    />
                    <span className="text-xs text-muted-foreground w-6 text-right">{selectedZoneAreaData.borderRadius ?? 8}</span>
                  </div>
                </div>
                {/* Fill opacity */}
                <div>
                  <Label className="text-xs">Opacité du fond</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Slider
                      value={[Math.round((selectedZoneAreaData.fillOpacity ?? 0.05) * 100)]}
                      onValueChange={([v]) => updateZoneArea(selectedZoneAreaData.id, { fillOpacity: v / 100 })}
                      min={0} max={100} step={5}
                      className="flex-1"
                    />
                    <span className="text-xs text-muted-foreground w-8 text-right">{Math.round((selectedZoneAreaData.fillOpacity ?? 0.05) * 100)}%</span>
                  </div>
                </div>

                {/* Show label toggle */}
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Afficher le nom</Label>
                  <Button
                    variant={selectedZoneAreaData.showLabel !== false ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => updateZoneArea(selectedZoneAreaData.id, { showLabel: selectedZoneAreaData.showLabel === false ? true : false })}
                  >
                    {selectedZoneAreaData.showLabel !== false ? 'Oui' : 'Non'}
                  </Button>
                </div>

                {/* Label font size & position offsets */}
                {selectedZoneAreaData.showLabel !== false && (
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs">Taille du texte</Label>
                      <div className="flex items-center gap-2 mt-1">
                        <Slider
                          value={[selectedZoneAreaData.labelFontSize ?? 10]}
                          onValueChange={([v]) => updateZoneArea(selectedZoneAreaData.id, { labelFontSize: v })}
                          min={6} max={24} step={1}
                          className="flex-1"
                        />
                        <span className="text-xs text-muted-foreground w-6 text-right">{selectedZoneAreaData.labelFontSize ?? 10}</span>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Position du texte</Label>
                      <div className="grid grid-cols-2 gap-2 mt-1">
                        <div>
                          <Label className="text-[10px] text-muted-foreground">Décalage X</Label>
                          <Input type="number" value={selectedZoneAreaData.labelOffsetX ?? 0}
                            onChange={(e) => updateZoneArea(selectedZoneAreaData.id, { labelOffsetX: parseInt(e.target.value) || 0 })}
                            step={5} />
                        </div>
                        <div>
                          <Label className="text-[10px] text-muted-foreground">Décalage Y</Label>
                          <Input type="number" value={selectedZoneAreaData.labelOffsetY ?? 0}
                            onChange={(e) => updateZoneArea(selectedZoneAreaData.id, { labelOffsetY: parseInt(e.target.value) || 0 })}
                            step={5} />
                        </div>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Rotation du texte</Label>
                      <div className="flex items-center gap-2 mt-1">
                        <Slider
                          value={[selectedZoneAreaData.labelRotation ?? 0]}
                          onValueChange={([v]) => updateZoneArea(selectedZoneAreaData.id, { labelRotation: v })}
                          min={-180} max={180} step={5}
                          className="flex-1"
                        />
                        <span className="text-xs text-muted-foreground w-8 text-right">{selectedZoneAreaData.labelRotation ?? 0}°</span>
                      </div>
                    </div>
                  </div>
                )}

                <Button variant="destructive" size="sm" className="w-full" onClick={() => removeZoneArea(selectedZoneAreaData.id)}>
                  <Trash2 className="h-4 w-4 mr-1" />
                  {t('vipHost.removeZone')}
                </Button>
              </div>
            ) : selectedTableData ? (
              <div className="space-y-4">
                <div>
                  <Label className="text-xs">{t('vipHost.tableName')}</Label>
                  <Input value={selectedTableData.name}
                    onChange={(e) => updateTable(selectedTableData.id, { name: e.target.value })} placeholder="Table 1" />
                </div>
                <div>
                  <Label className="text-xs">{t('vipHost.tableCapacity')}</Label>
                  <Input type="number" value={selectedTableData.capacity}
                    onChange={(e) => updateTable(selectedTableData.id, { capacity: parseInt(e.target.value) || 1 })}
                    min={1} max={20} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Max extra pers.</Label>
                    <Input type="number" value={selectedTableData.maxExtraPersons || 0}
                      onChange={(e) => updateTable(selectedTableData.id, { maxExtraPersons: parseInt(e.target.value) || 0 })}
                      min={0} max={20} />
                  </div>
                  <div>
                    <Label className="text-xs">Prix/extra (€)</Label>
                    <Input type="number" step="0.01" value={selectedTableData.extraPersonPrice || 0}
                      onChange={(e) => updateTable(selectedTableData.id, { extraPersonPrice: parseFloat(e.target.value) || 0 })}
                      min={0} />
                  </div>
                </div>

                {/* Shape selector */}
                <div>
                  <Label className="text-xs">{t('vipHost.tableShape')}</Label>
                  <div className="flex gap-1 mt-1">
                    {SHAPES.map(shape => (
                      <Button
                        key={shape}
                        variant={(selectedTableData.shape || 'rectangle') === shape ? 'default' : 'outline'}
                        size="icon"
                        className="h-9 w-9"
                        onClick={() => updateTable(selectedTableData.id, { shape })}
                        title={t(`vipHost.shape_${shape}`)}
                      >
                        <ShapeIcon shape={shape} size={18} color={(selectedTableData.shape || 'rectangle') === shape ? 'white' : undefined} />
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Corner radius (only for rectangles) */}
                {(!selectedTableData.shape || selectedTableData.shape === 'rectangle') && (
                  <div>
                    <Label className="text-xs">Coins arrondis</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <Slider
                        value={[selectedTableData.borderRadius ?? 6]}
                        onValueChange={([v]) => updateTable(selectedTableData.id, { borderRadius: v })}
                        min={0} max={30} step={1}
                        className="flex-1"
                      />
                      <span className="text-xs text-muted-foreground w-6 text-right">{selectedTableData.borderRadius ?? 6}</span>
                    </div>
                  </div>
                )}

                {/* Fill opacity */}
                <div>
                  <Label className="text-xs">Opacité du fond</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Slider
                      value={[Math.round((selectedTableData.fillOpacity ?? 0.55) * 100)]}
                      onValueChange={([v]) => updateTable(selectedTableData.id, { fillOpacity: v / 100 })}
                      min={10} max={100} step={5}
                      className="flex-1"
                    />
                    <span className="text-xs text-muted-foreground w-8 text-right">{Math.round((selectedTableData.fillOpacity ?? 0.55) * 100)}%</span>
                  </div>
                </div>

                <div>
                  <Label className="text-xs">{t('vipHost.tableColor')}</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="color"
                      value={selectedTableData.color || selectedTableData.zoneColor || '#6366f1'}
                      onChange={(e) => updateTable(selectedTableData.id, { color: e.target.value })}
                      className="w-8 h-8 rounded border border-border cursor-pointer"
                    />
                    <span className="text-xs text-muted-foreground flex-1">
                      {selectedTableData.color ? t('vipHost.customColor') : t('vipHost.zoneColorDefault')}
                    </span>
                    {selectedTableData.color && (
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => updateTable(selectedTableData.id, { color: undefined })}>
                        {t('common.reset')}
                      </Button>
                    )}
                  </div>
                </div>

                <div>
                  <Label className="text-xs">{t('vipHost.zone')}</Label>
                  <Select value={selectedTableData.zoneId || ''} onValueChange={(value) => handleZoneChange(selectedTableData.id, value)}>
                    <SelectTrigger><SelectValue placeholder={t('vipHost.selectZone')} /></SelectTrigger>
                    <SelectContent>
                      {zones.map(zone => (
                        <SelectItem key={zone.id} value={zone.id}>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: zone.color }} />
                            {zone.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">{t('vipHost.width')}</Label>
                    <Input type="number" value={selectedTableData.width}
                      onChange={(e) => updateTable(selectedTableData.id, { width: parseInt(e.target.value) || 20 })}
                      min={15} max={200} step={1} />
                  </div>
                  <div>
                    <Label className="text-xs">{t('vipHost.height')}</Label>
                    <Input type="number" value={selectedTableData.height}
                      onChange={(e) => updateTable(selectedTableData.id, { height: parseInt(e.target.value) || 20 })}
                      min={15} max={200} step={1} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" onClick={() => duplicateTable(selectedTableData.id)}>
                    <Copy className="h-4 w-4 mr-1" />
                    {t('vipHost.duplicateTable')}
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => removeTable(selectedTableData.id)}>
                    <Trash2 className="h-4 w-4 mr-1" />
                    {t('vipHost.removeTable')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-8">
                <GripVertical className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">{t('vipHost.selectTableToEdit')}</p>
              </div>
            )}

            {/* Tables List */}
            <div className="mt-6 pt-4 border-t border-border">
              <h5 className="text-xs font-medium text-muted-foreground mb-2">
                {t('vipHost.allTables')} ({tables.length})
              </h5>
              <ScrollArea className="h-40">
                <div className="space-y-1">
                  {tables.map(table => (
                    <div key={table.id}
                      className={`flex items-center justify-between py-2 px-3 rounded-lg cursor-pointer transition-colors ${selectedTable === table.id ? 'bg-primary/10' : 'hover:bg-muted/50'}`}
                      onClick={() => { setSelectedTable(table.id); setSelectedZoneArea(null); }}>
                      <div className="flex items-center gap-2">
                        {table.zoneColor && <div className="w-2 h-2 rounded-full" style={{ backgroundColor: table.color || table.zoneColor }} />}
                        <ShapeIcon shape={table.shape || 'rectangle'} size={14} />
                        <span className="text-sm">{table.name}</span>
                        {table.zoneName && (
                          <span className="text-[10px] text-muted-foreground">({table.zoneName})</span>
                        )}
                      </div>
                      <Badge variant="secondary" className="text-xs">{table.capacity}</Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground/70">
              {t('vipHost.shortcutsHint')}
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
