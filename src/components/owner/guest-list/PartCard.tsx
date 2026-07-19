import { useState, useEffect } from 'react';
import { Users, Music, Megaphone, UserPlus, Link2, Copy, Clock, Wine, Eye, Trash2, CheckCircle, ChevronDown, Ticket, Crown, Hash, Infinity as InfinityIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { Part, PartEntry, HolderType } from '@/hooks/useGuestListParts';
import { buildShareLink } from '@/lib/guestListShare';
import {
  RED, POS, NEG, T1, T2, T3, BORDER, F_BORDER, INNER_BG, TILE_BG, CARD_BG, CARD_SHADOW, YunoSwitch,
} from './ui';

const HOLDER_ICON: Record<HolderType, typeof Users> = {
  club: Users, dj: Music, promoter: Megaphone, custom: UserPlus,
};

interface PartCardProps {
  part: Part | null;            // null = club draft (not yet persisted)
  holderType: HolderType;
  displayName: string;
  entries: PartEntry[];
  slug: string;
  eventId: string;
  t: (key: string) => string;
  onCreate?: (payload: Record<string, unknown>) => Promise<void>;
  onUpdate?: (id: string, payload: Record<string, unknown>) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onToggleActive?: (id: string, active: boolean) => Promise<void>;
  onSaveAsPreset?: (config: Record<string, unknown>, holderType: HolderType) => void;
  defaultOpen?: boolean;
}

export function PartCard({ part, holderType, displayName, entries, slug, eventId, t, onCreate, onUpdate, onDelete, onToggleActive, onSaveAsPreset, defaultOpen }: PartCardProps) {
  const isClub = holderType === 'club';
  const Icon = HOLDER_ICON[holderType];

  const [open, setOpen] = useState(defaultOpen ?? (isClub && !part));
  const [saving, setSaving] = useState(false);

  const [quota, setQuota] = useState(part?.quota ?? (isClub ? 100 : 20));
  // quota NULL = part illimitée (déléguées uniquement).
  const [unlimited, setUnlimited] = useState(!isClub && !!part && part.quota == null);
  // Per-type allocation for delegated parts (dj/promoter/custom). Legacy parts that only
  // carry a global quota seed as all-standard, so a re-save migrates them cleanly.
  const seedPerType = (p: Part | null) =>
    p && (p.quota_normal + p.quota_drink + p.quota_table) > 0
      ? { n: p.quota_normal, d: p.quota_drink, tb: p.quota_table }
      : { n: p?.quota ?? 20, d: 0, tb: 0 };
  const [qNormal, setQNormal] = useState(() => seedPerType(part).n);
  const [qDrink, setQDrink] = useState(() => seedPerType(part).d);
  const [qTable, setQTable] = useState(() => seedPerType(part).tb);
  const [freeBeforeTime, setFreeBeforeTime] = useState(part?.free_before_time?.substring(0, 5) || '02:00');
  const [entryDeadline, setEntryDeadline] = useState(part?.entry_deadline?.substring(0, 5) || '');
  const [includesDrink, setIncludesDrink] = useState(part?.includes_drink ?? false);
  const [visibleOnClubPage, setVisibleOnClubPage] = useState(part?.visible_on_club_page ?? isClub);
  const [showRemaining, setShowRemaining] = useState(part?.show_remaining ?? true);

  // Gender split — club only.
  const [enableGenderQuota, setEnableGenderQuota] = useState((part?.quota_female ?? null) !== null || (part?.quota_male ?? null) !== null);
  const [quotaMode, setQuotaMode] = useState<'number' | 'percentage'>('number');
  const [quotaFemale, setQuotaFemale] = useState(part?.quota_female ?? 70);
  const [quotaMale, setQuotaMale] = useState(part?.quota_male ?? 30);
  const [pctFemale, setPctFemale] = useState(70);
  const [pctMale, setPctMale] = useState(30);

  // Re-sync local form when the underlying part changes (reload / switch event).
  useEffect(() => {
    setQuota(part?.quota ?? (isClub ? 100 : 20));
    setUnlimited(!isClub && !!part && part.quota == null);
    const seed = seedPerType(part);
    setQNormal(seed.n); setQDrink(seed.d); setQTable(seed.tb);
    setFreeBeforeTime(part?.free_before_time?.substring(0, 5) || '02:00');
    setEntryDeadline(part?.entry_deadline?.substring(0, 5) || '');
    setIncludesDrink(part?.includes_drink ?? false);
    setVisibleOnClubPage(part?.visible_on_club_page ?? isClub);
    setShowRemaining(part?.show_remaining ?? true);
    setEnableGenderQuota((part?.quota_female ?? null) !== null || (part?.quota_male ?? null) !== null);
    setQuotaFemale(part?.quota_female ?? 70);
    setQuotaMale(part?.quota_male ?? 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part?.id, part?.quota, part?.quota_normal, part?.quota_drink, part?.quota_table, part?.quota_female, part?.quota_male, part?.free_before_time, part?.entry_deadline, part?.includes_drink, part?.visible_on_club_page, part?.show_remaining]);

  // Delegated parts allocate per type; the club keeps a single editable quota.
  const perTypeTotal = qNormal + qDrink + qTable;
  const effectiveQuota = isClub ? quota : perTypeTotal;
  const effectiveFemale = quotaMode === 'percentage' ? Math.round(effectiveQuota * pctFemale / 100) : quotaFemale;
  const effectiveMale   = quotaMode === 'percentage' ? Math.round(effectiveQuota * pctMale   / 100) : quotaMale;
  const genderSum = effectiveFemale + effectiveMale;
  const genderExceedsQuota = isClub && enableGenderQuota && genderSum > quota;

  const activeEntries = entries.filter(e => e.status !== 'cancelled');
  const scannedCount  = entries.filter(e => e.entry_scanned).length;
  const femaleCount   = activeEntries.filter(e => e.gender === 'female').length;
  const maleCount     = activeEntries.filter(e => e.gender === 'male').length;
  // Une part illimitée (quota NULL) n'est jamais pleine.
  const full          = !!part && part.is_active && part.quota != null && activeEntries.length >= part.quota;
  const genderLinks   = !!part && (part.quota_female !== null || part.quota_male !== null);

  // The reusable config shared by Save and "save as preset" (no identity/holder fields).
  // Delegated parts persist the per-type split (and derive quota + includes_drink from it);
  // the club keeps its single global quota and explicit includes-drink toggle.
  const buildConfig = (): Record<string, unknown> => ({
    // Part déléguée illimitée : quota NULL, aucun plafond par type.
    quota: !isClub && unlimited ? null : effectiveQuota,
    ...(isClub ? {} : unlimited
      ? { quota_normal: 0, quota_drink: 0, quota_table: 0 }
      : { quota_normal: qNormal, quota_drink: qDrink, quota_table: qTable }),
    quota_female: enableGenderQuota ? effectiveFemale : null,
    quota_male:   enableGenderQuota ? effectiveMale : null,
    free_before_time: freeBeforeTime,
    entry_deadline: entryDeadline || null,
    includes_drink: isClub ? includesDrink : (!unlimited && qDrink > 0),
    visible_on_club_page: visibleOnClubPage,
    show_remaining: showRemaining,
  });

  const handleSave = async () => {
    if (genderExceedsQuota) { toast.error(t('guestList.quotaExceedsTotal')); return; }
    if (!isClub && !unlimited && perTypeTotal < 1) { toast.error(t('guestList.presets.entryKind')); return; }
    setSaving(true);
    const payload = { ...buildConfig(), ...(isClub && !part ? { holder_label: null } : {}) };
    try {
      if (part) await onUpdate?.(part.id, payload);
      else await onCreate?.(payload);
      toast.success(part ? t('guestList.saved') : t('guestList.parts.created'));
    } catch (e) { toast.error(e instanceof Error ? e.message : t('guestList.saveError')); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!part || !onDelete) return;
    if (!confirm(t('guestList.parts.deleteConfirm'))) return;
    try { await onDelete(part.id); toast.success(t('guestList.deleted')); }
    catch (e) { toast.error(e instanceof Error ? e.message : t('guestList.deleteError')); }
  };

  const shareLink = (gender?: 'female' | 'male') =>
    part ? buildShareLink({ slug, eventId, token: part.share_token, gender }) : '';
  const copy = (gender?: 'female' | 'male') => { navigator.clipboard.writeText(shareLink(gender)); toast.success(t('common.copied')); };

  const accent = isClub ? BORDER : 'rgba(232,25,44,0.18)';
  const inputStyle = { background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '8px 12px', color: T1, fontSize: 14, fontFamily: 'inherit' } as const;

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${accent}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px' }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer" style={{ background: 'none', border: 'none', padding: 0 }}>
          <div className="h-9 w-9 rounded-full flex items-center justify-center flex-none" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
            <Icon className="h-4 w-4" style={{ color: RED }} />
          </div>
          <div className="min-w-0">
            <p className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 600, margin: 0 }}>{displayName}</p>
            <p style={{ color: T3, fontSize: 11, margin: 0 }}>
              {t(`guestList.holderType.${holderType}`)}
              {part && <> · {activeEntries.length}/{part.quota ?? '∞'}{full && <span style={{ color: NEG, fontWeight: 600 }}> · {t('guestList.quotaFull')}</span>}</>}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-2 flex-none">
          {part && onToggleActive && (
            <YunoSwitch checked={part.is_active} onChange={(v) => onToggleActive(part.id, v)} />
          )}
          <button type="button" onClick={() => setOpen(o => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T3 }}>
            <ChevronDown className="h-4 w-4" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          {/* Quota — club keeps one global number; delegated parts allocate per entry type */}
          {isClub ? (
            <div>
              <p style={{ color: T2, fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{t('guestList.totalQuota')}</p>
              <input type="number" min={1} max={10000} value={quota} onChange={e => setQuota(Math.max(1, Number(e.target.value)))} className="outline-none w-full" style={inputStyle} />
            </div>
          ) : (
            <div className="space-y-3">
              {/* Sans limite — quota NULL : le détenteur ajoute autant d'invités qu'il veut. */}
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5" style={{ color: unlimited ? T1 : T3, fontSize: 13, fontWeight: 500 }}>
                  <InfinityIcon className="h-3.5 w-3.5" />{t('guestList.unlimited')}
                </span>
                <YunoSwitch checked={unlimited} onChange={setUnlimited} />
              </div>
              {unlimited ? (
                <p style={{ color: T3, fontSize: 11.5 }}>{t('guestList.unlimitedHint')}</p>
              ) : (
              <div>
                <p style={{ color: T2, fontSize: 13, fontWeight: 500, marginBottom: 8 }}>{t('guestList.presets.entryKind')}</p>
                <div className="space-y-2">
                  {[
                    { icon: Ticket, key: 'guestList.presets.entryNormal', val: qNormal, set: setQNormal },
                    { icon: Wine,   key: 'guestList.presets.entryDrink',  val: qDrink,  set: setQDrink },
                    { icon: Crown,  key: 'guestList.presets.entryVip',    val: qTable,  set: setQTable },
                  ].map((row, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="flex items-center gap-1.5 flex-1" style={{ color: row.val > 0 ? T1 : T3, fontSize: 13, fontWeight: 500 }}><row.icon className="h-3.5 w-3.5" />{t(row.key)}</span>
                      <input type="number" min={0} max={10000} value={row.val} onChange={e => row.set(Math.max(0, Number(e.target.value)))} className="outline-none" style={{ ...inputStyle, width: 96, textAlign: 'center' }} />
                    </div>
                  ))}
                </div>
                <p style={{ color: T3, fontSize: 11.5, marginTop: 6 }}>{t('guestList.presets.totalSpots').replace('{n}', String(perTypeTotal))}</p>
              </div>
              )}
            </div>
          )}

          {/* Gender quotas — available on every part */}
          <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p style={{ color: T2, fontSize: 13, fontWeight: 500, margin: 0 }}>{t('guestList.genderQuotas')}</p>
                <YunoSwitch checked={enableGenderQuota} onChange={setEnableGenderQuota} />
              </div>
              {enableGenderQuota && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    {[{ v: 'number' as const, l: t('guestList.modeNumber') }, { v: 'percentage' as const, l: t('guestList.modePercentage') }].map(opt => (
                      <button key={opt.v} type="button" onClick={() => setQuotaMode(opt.v)}
                        style={{ flex: 1, padding: '7px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', background: quotaMode === opt.v ? 'rgba(232,25,44,0.14)' : TILE_BG, border: `1px solid ${quotaMode === opt.v ? RED : F_BORDER}`, color: quotaMode === opt.v ? '#ff4d5a' : T2 }}>
                        {opt.l}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p style={{ color: T3, fontSize: 11.5, marginBottom: 4 }}>{t('guestList.female')}{quotaMode === 'percentage' ? ' (%)' : ''}</p>
                      <input type="number" min={0} max={quotaMode === 'percentage' ? 100 : quota}
                        value={quotaMode === 'percentage' ? pctFemale : quotaFemale}
                        onChange={e => quotaMode === 'percentage' ? setPctFemale(Math.min(100, Math.max(0, Number(e.target.value)))) : setQuotaFemale(Math.max(0, Number(e.target.value)))}
                        className="w-full outline-none" style={inputStyle} />
                    </div>
                    <div>
                      <p style={{ color: T3, fontSize: 11.5, marginBottom: 4 }}>{t('guestList.male')}{quotaMode === 'percentage' ? ' (%)' : ''}</p>
                      <input type="number" min={0} max={quotaMode === 'percentage' ? 100 : quota}
                        value={quotaMode === 'percentage' ? pctMale : quotaMale}
                        onChange={e => quotaMode === 'percentage' ? setPctMale(Math.min(100, Math.max(0, Number(e.target.value)))) : setQuotaMale(Math.max(0, Number(e.target.value)))}
                        className="w-full outline-none" style={inputStyle} />
                    </div>
                  </div>
                  {quotaMode === 'percentage' && (
                    <p style={{ color: T3, fontSize: 11.5 }}>= {effectiveFemale} {t('guestList.female').toLowerCase()} + {effectiveMale} {t('guestList.male').toLowerCase()} ({genderSum} {t('guestList.totalLabel')})</p>
                  )}
                  {genderExceedsQuota && (
                    <div className="flex items-start gap-2" style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,92,99,0.08)', border: '1px solid rgba(255,92,99,0.25)' }}>
                      <span style={{ color: NEG }}>⚠️</span>
                      <p style={{ color: NEG, fontSize: 12, margin: 0 }}>{t('guestList.quotaExceedsTotal')} ({genderSum} &gt; {quota})</p>
                    </div>
                  )}
                </div>
              )}
            </div>

          {/* Free before time */}
          <div>
            <p className="flex items-center gap-2" style={{ color: T2, fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
              <Clock className="h-4 w-4" style={{ color: T3 }} />{t('guestList.freeBeforeTime')}
            </p>
            <input type="time" value={freeBeforeTime} onChange={e => setFreeBeforeTime(e.target.value)} className="outline-none" style={{ ...inputStyle, colorScheme: 'dark', width: 160 }} />
          </div>

          {/* Entry deadline */}
          <div>
            <p className="flex items-center gap-2" style={{ color: T2, fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
              <Clock className="h-4 w-4" style={{ color: T3 }} />{t('guestList.entryDeadline')}
            </p>
            <input type="time" value={entryDeadline} onChange={e => setEntryDeadline(e.target.value)} className="outline-none" style={{ ...inputStyle, colorScheme: 'dark', width: 160 }} />
          </div>

          {/* Includes drink — club only; delegated parts express drinks via the VIP/drink entry type */}
          {isClub && (
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2" style={{ color: T2, fontSize: 13, fontWeight: 500, margin: 0 }}>
                <Wine className="h-4 w-4" style={{ color: T3 }} />{t('guestList.includesDrink')}
              </p>
              <YunoSwitch checked={includesDrink} onChange={setIncludesDrink} />
            </div>
          )}

          {/* Visibilité — publique sur la page de la soirée, ou seulement via le lien de la part */}
          <div>
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2" style={{ color: T2, fontSize: 13, fontWeight: 500, margin: 0 }}>
                <Eye className="h-4 w-4" style={{ color: T3 }} />{t('guestList.visibleOnPage')}
              </p>
              <YunoSwitch checked={visibleOnClubPage} onChange={setVisibleOnClubPage} />
            </div>
            {!isClub && (
              <p style={{ color: T3, fontSize: 11, marginTop: 4 }}>{visibleOnClubPage ? t('guestList.parts.visibleHintOn') : t('guestList.parts.visibleHintOff')}</p>
            )}
          </div>

          {/* Compteur public — « X places restantes » ou seulement ouvert/complet */}
          <div>
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2" style={{ color: T2, fontSize: 13, fontWeight: 500, margin: 0 }}>
                <Hash className="h-4 w-4" style={{ color: T3 }} />{t('guestList.presets.showRemaining')}
              </p>
              <YunoSwitch checked={showRemaining} onChange={setShowRemaining} />
            </div>
            <p style={{ color: T3, fontSize: 11, marginTop: 4 }}>{t('guestList.presets.showRemainingHint')}</p>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {(() => {
              const saveDisabled = saving || genderExceedsQuota || (!isClub && !unlimited && perTypeTotal < 1);
              return (
                <button onClick={handleSave} disabled={saveDisabled}
                  style={{ flex: 1, background: saveDisabled ? INNER_BG : RED, border: 'none', borderRadius: 12, padding: '11px', color: '#fff', fontSize: 14, fontWeight: 600, cursor: saveDisabled ? 'not-allowed' : 'pointer', opacity: saveDisabled ? 0.6 : 1 }}>
                  {saving ? '…' : part ? t('owner.save') : t('guestList.create')}
                </button>
              );
            })()}
            {part && !isClub && onDelete && (
              <button onClick={handleDelete} style={{ width: 44, height: 42, background: 'rgba(255,92,99,0.10)', border: '1px solid rgba(255,92,99,0.25)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: NEG }}>
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>

          {part && onSaveAsPreset && (
            <button type="button" onClick={() => onSaveAsPreset(buildConfig(), holderType)}
              style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', color: T3, fontSize: 12, fontWeight: 600, padding: '2px' }}>
              {t('guestList.presets.saveAs')}
            </button>
          )}
        </div>
      )}

      {/* Share link(s) — persisted parts only */}
      {part && (
        genderLinks ? (
          <div className="mt-3 space-y-2">
            {(['female', 'male'] as const).map(g => {
              const cap = g === 'female' ? part.quota_female : part.quota_male;
              if (cap === null) return null;
              const cnt = g === 'female' ? femaleCount : maleCount;
              return (
                <div key={g}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span style={{ color: T2, fontSize: 12, fontWeight: 600 }}>{g === 'female' ? `♀ ${t('guestList.femaleList')}` : `♂ ${t('guestList.maleList')}`}</span>
                    <span style={{ color: cnt >= (cap || 0) ? NEG : T3, fontSize: 11.5 }}>{cnt}/{cap}</span>
                  </div>
                  <div className="flex gap-2">
                    <input value={shareLink(g)} readOnly className="flex-1 outline-none" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '6px 10px', color: T2, fontSize: 11, fontFamily: 'monospace', minWidth: 0 }} />
                    <button onClick={() => copy(g)} style={{ width: 36, height: 34, background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, color: T2 }}><Copy className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-3">
            <p className="flex items-center gap-1.5 mb-1.5" style={{ color: T2, fontSize: 12, fontWeight: 600 }}><Link2 className="h-3.5 w-3.5" style={{ color: RED }} />{t('guestList.shareLink')}</p>
            <div className="flex gap-2">
              <input value={shareLink()} readOnly className="flex-1 outline-none" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '6px 10px', color: T2, fontSize: 11, fontFamily: 'monospace', minWidth: 0 }} />
              <button onClick={() => copy()} style={{ width: 36, height: 34, background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, color: T2 }}><Copy className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        )
      )}

      {/* Entries — persisted parts only, when any exist */}
      {part && activeEntries.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-3 mb-2" style={{ color: T3, fontSize: 11.5 }}>
            <span>{activeEntries.length} {t('guestList.guestsCount')}</span>
            <span>·</span>
            <span><CheckCircle className="inline h-3 w-3" style={{ color: POS }} /> {scannedCount} {t('guestList.enteredCount')}</span>
          </div>
          <div className="space-y-1.5" style={{ maxHeight: 280, overflowY: 'auto' }}>
            {activeEntries.map(entry => (
              <div key={entry.id} className="flex items-center justify-between" style={{ padding: '8px 10px', borderRadius: 10, background: TILE_BG, border: `1px solid ${F_BORDER}` }}>
                <div className="min-w-0 flex-1">
                  <p style={{ color: T1, fontSize: 13, fontWeight: 500, margin: 0 }} className="truncate">{entry.full_name}</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p style={{ color: T3, fontSize: 11, margin: 0 }} className="truncate">{entry.email}</p>
                    {entry.gender && <span style={{ color: T3, fontSize: 10 }}>{entry.gender === 'female' ? '♀' : '♂'}</span>}
                    {entry.promoter_id && (
                      <span style={{ padding: '1px 6px', borderRadius: 5, fontSize: 10, fontWeight: 600, color: '#ff7a45', background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.2)' }}>{t('guestList.holderType.promoter')}</span>
                    )}
                    {entry.entry_type && entry.entry_type !== 'normal' && (
                      <span style={{ padding: '1px 6px', borderRadius: 5, fontSize: 10, fontWeight: 600, color: T2, background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                        {entry.entry_type === 'table' ? '🪩 VIP' : entry.entry_type === 'drink' ? `🍹 ${t('guestList.drinkBadge')}` : entry.entry_type}
                      </span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 ml-2">
                  {entry.entry_scanned ? (
                    <span className="flex items-center gap-1" style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, color: POS, background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.25)' }}><CheckCircle className="h-3 w-3" />{t('guestList.scanned')}</span>
                  ) : (
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, color: T3, background: INNER_BG, border: `1px solid ${F_BORDER}` }}>{t('guestList.waiting')}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
