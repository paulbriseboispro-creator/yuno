/**
 * Réglages des Blocs Yuno dans le Studio CRM : Soirée, Billetterie, Compte à
 * rebours et Line-up. Mêmes réglages que l'Email Studio de la Billetterie
 * (src/components/email-studio/Inspector.tsx) — présentation, alignement,
 * couleur, affiche, sur-titre, accroche, fiche, arguments, bouton, note,
 * tarifs montrés —, dans le dessin du CRM. Les données (tarifs, lieu,
 * affiche, artistes et photos) viennent de la billetterie connectée et sont
 * relues à l'envoi : le panneau ne règle que leur présentation.
 */
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useCrmT } from '@/crm/i18n';
import type { NightRow } from '@/crm/data/nights';
import { useStudio } from '@/components/email-studio/store';
import {
  EVENT_CTA_LABEL, LINEUP_KICKER, artistInitials, artistKey, isHexColor, lineupPhoto, lineupUsesPhotos, lineupArtists,
  ticketsCtaLabel, ticketsKicker,
  type EmailBlock, type LineupArtist, type LiveEventData,
} from '@/lib/email';
import { Field, Note, Seg, TextInput, Toggle, NightPick } from './fields';
import { useEmailImageUpload, type Patch } from './fieldHelpers';

type Of<K extends EmailBlock['type']> = Extract<EmailBlock, { type: K }>;

export interface YunoFieldsProps<K extends EmailBlock['type']> {
  block: Of<K>;
  patch: Patch;
  /** Soirées proposées (à venir, plus celle déjà reliée). */
  nights: NightRow[];
  onPick: (n: NightRow) => void;
  /** Soirée du brouillon : un bloc sans soirée propre en hérite. */
  campaignEventId: string | null;
  /** Données live de la soirée du bloc (celles que l'aperçu affiche). */
  live: LiveEventData | undefined;
  /** E-mail d'une automatisation : le modèle ne garde rien d'une soirée précise. */
  template?: boolean;
}

/** Couleurs proposées : celles des boutons, plus l'or du pilier VIP. */
const ACCENT_CHOICES = ['#E3141B', '#FF6B35', '#F2B23C', '#9D0B12', '#1C1517'];

// ── Briques ───────────────────────────────────────────────────────────────

/** Choix à quatre options : deux par ligne (les libellés ne tiennent pas à quatre). */
function SegGrid<T extends string>({ value, options, onChange }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: 3, gap: 2, background: 'var(--sand-100)', borderRadius: 18 }}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button key={o.v} type="button" onClick={() => onChange(o.v)} aria-pressed={on} style={{ height: 34, padding: '0 6px', border: 0, borderRadius: 99, background: on ? '#fff' : 'transparent', boxShadow: on ? 'var(--shadow-xs)' : 'none', fontSize: 13.5, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--sand-600)', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 160ms,color 160ms' }}>
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

function AlignField({ value, onChange }: { value: 'left' | 'center' | 'right'; onChange: (v: 'left' | 'center' | 'right') => void }) {
  const { t } = useCrmT();
  return (
    <Field label={t('yc.em.st.f.align')}>
      <Seg value={value} onChange={onChange} options={[{ v: 'left', l: t('yc.em.st.f.left') }, { v: 'center', l: t('yc.em.st.f.center') }, { v: 'right', l: t('yc.em.st.f.right') }]} />
    </Field>
  );
}

/** Couleur d'accent du bloc : celle de l'e-mail, une des couleurs Yuno, ou une autre. */
function AccentField({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const { t } = useCrmT();
  const theme = useStudio((s) => s.campaign.theme);
  const current = isHexColor(value) ? value.trim().toUpperCase() : null;
  const custom = !!current && !ACCENT_CHOICES.includes(current);
  const ring = (c: string, on: boolean) => (on ? `0 0 0 2px #fff,0 0 0 4px ${c}` : 'inset 0 0 0 1px rgba(0,0,0,.1)');
  return (
    <Field label={t('yc.em.st.f.accent')}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <button type="button" onClick={() => onChange(undefined)} aria-pressed={!current} style={{ height: 34, padding: '0 12px 0 6px', borderRadius: 99, border: `1.5px solid ${!current ? 'var(--red-500)' : 'var(--sand-200)'}`, background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 20, height: 20, borderRadius: 99, background: theme.accent, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.1)' }} />
          {t('yc.em.st.f.accentMood')}
        </button>
        {ACCENT_CHOICES.map((c) => (
          <Hv key={c} as="button" type="button" onClick={() => onChange(c)} aria-label={t('yc.em.st.s.color', { c })} aria-pressed={current === c} style={{ width: 30, height: 30, borderRadius: 99, border: 0, background: c, boxShadow: ring(c, current === c), cursor: 'pointer' }} hover={{ transform: 'scale(1.1)' }} />
        ))}
        <label title={t('yc.em.st.f.accentCustom')} style={{ position: 'relative', width: 30, height: 30, borderRadius: 99, cursor: 'pointer', background: custom ? current! : 'conic-gradient(#E3141B,#F2B23C,#2BB673,#2E7CF6,#9B51E0,#E3141B)', boxShadow: ring(custom ? current! : '#999', custom) }}>
          <input type="color" aria-label={t('yc.em.st.f.accentCustom')} value={current ?? '#E3141B'} onChange={(e) => onChange(e.target.value.toUpperCase())} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 0, padding: 0 }} />
        </label>
      </div>
    </Field>
  );
}

function OptionalTag() {
  const { t } = useCrmT();
  return <span style={{ fontSize: 12.5, color: 'var(--sand-400)' }}>{t('yc.em.st.f.optional')}</span>;
}

function SmallBtn({ onClick, label, children, danger }: { onClick: () => void; label: string; children: ReactNode; danger?: boolean }) {
  return (
    <Hv as="button" type="button" onClick={onClick} aria-label={label} title={label} style={{ flex: 'none', width: 36, height: 36, border: 0, borderRadius: 99, background: 'var(--sand-100)', color: danger ? 'var(--red-600)' : 'var(--sand-600)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: danger ? 'var(--red-50)' : 'var(--sand-200)' }}>
      {children}
    </Hv>
  );
}

function AddBtn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Hv as="button" type="button" onClick={onClick} style={{ height: 40, border: '1.5px dashed var(--sand-300)', borderRadius: 12, background: 'none', color: 'var(--sand-700)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }} hover={{ background: 'var(--sand-50)' }}>
      <Icon name="plus" size={15} stroke={2.4} />{children}
    </Hv>
  );
}

/** Arguments de vente, un par ligne (coche accent dans l'e-mail). */
function PerksField({ perks, onChange }: { perks: string[]; onChange: (v: string[]) => void }) {
  const { t } = useCrmT();
  return (
    <Field label={t('yc.em.st.f.perks')} right={<OptionalTag />} hint={t('yc.em.st.f.perksHint')}>
      {perks.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <TextInput value={p} onChange={(v) => onChange(perks.map((x, j) => (j === i ? v : x)))} label={t('yc.em.st.f.perks')} />
          <SmallBtn danger onClick={() => onChange(perks.filter((_, j) => j !== i))} label={t('yc.em.st.f.remove')}><Icon name="trash" size={15} stroke={2.2} /></SmallBtn>
        </div>
      ))}
      <AddBtn onClick={() => onChange([...perks, ''])}>{t('yc.em.st.f.perkAdd')}</AddBtn>
    </Field>
  );
}

/** Bouton (libellé, largeur) et note de réassurance — mêmes trois réglages partout. */
function ButtonFields({ label, placeholder, full, onLabel, onFull, note, notePh, onNote }: {
  label: string; placeholder: string; full: boolean; onLabel: (v: string) => void; onFull: (v: boolean) => void;
  note: string; notePh: string; onNote: (v: string) => void;
}) {
  const { t } = useCrmT();
  return (
    <>
      <Field label={t('yc.em.st.f.btnLabel')}><TextInput value={label} placeholder={placeholder} onChange={onLabel} label={t('yc.em.st.f.btnLabel')} /></Field>
      <Toggle on={full} onChange={onFull} label={t('yc.em.st.f.full')} />
      <Field label={t('yc.em.st.f.note')} right={<OptionalTag />}><TextInput value={note} placeholder={notePh} onChange={onNote} label={t('yc.em.st.f.note')} /></Field>
    </>
  );
}

/** Visuel posé à la main (bloc Billetterie) : import, retrait, place dans la carte. */
function VisualField({ url, pos, onUrl, onPos }: { url?: string; pos?: 'top' | 'bottom'; onUrl: (v: string | undefined) => void; onPos: (v: 'top' | 'bottom') => void }) {
  const { t } = useCrmT();
  const { busy, upload } = useEmailImageUpload();
  const input = useRef<HTMLInputElement>(null);
  const pick = async (file: File | undefined) => {
    const next = await upload(file);
    if (next) onUrl(next);
    if (input.current) input.current.value = '';
  };
  return (
    <Field label={t('yc.em.st.f.visual')} right={<OptionalTag />}>
      {url && <img src={url} alt="" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 12, boxShadow: '0 0 0 1px var(--sand-200)' }} />}
      <label className="yc-field" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, borderRadius: 12, border: '1.5px dashed var(--sand-300)', background: 'var(--paper)', cursor: busy ? 'progress' : 'pointer', fontSize: 14, fontWeight: 600 }}>
        <Icon name={busy ? 'refresh' : 'upload'} size={17} stroke={2} color="var(--sand-500)" style={busy ? { animation: 'yc-spin 900ms linear infinite' } : undefined} />
        {busy ? t('yc.em.st.f.imgUploading') : t(url ? 'yc.em.st.f.imgReplace' : 'yc.em.st.f.imgAdd')}
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} style={{ display: 'none' }} />
      </label>
      {url && (
        <>
          <Seg value={pos ?? 'top'} onChange={onPos} options={[{ v: 'top', l: t('yc.em.st.f.coverTop') }, { v: 'bottom', l: t('yc.em.st.f.coverBottom') }]} />
          <Hv as="button" type="button" onClick={() => onUrl(undefined)} style={{ height: 36, border: 0, borderRadius: 99, background: 'var(--sand-100)', fontSize: 13.5, fontWeight: 600, color: 'var(--sand-700)', cursor: 'pointer' }} hover={{ background: 'var(--sand-200)' }}>
            {t('yc.em.st.f.imgRemove')}
          </Hv>
        </>
      )}
    </Field>
  );
}

function NightField({ label, value, nights, onPick }: { label: string; value?: string | null; nights: NightRow[]; onPick: (n: NightRow) => void }) {
  return <Field label={label}><NightPick value={value} nights={nights} onPick={onPick} /></Field>;
}

// ── Soirée ────────────────────────────────────────────────────────────────

export function EventFields({ block: b, patch, nights, onPick, campaignEventId }: YunoFieldsProps<'event'>) {
  const { t } = useCrmT();
  const layout = b.layout ?? 'showcase';
  const metaLocked = layout === 'banner';
  return (
    <>
      <NightField label={t('yc.em.st.f.night')} value={b.eventId ?? campaignEventId} nights={nights} onPick={onPick} />
      <Note>{t('yc.em.st.f.eventNote', { src: t('yc.em.st.f.ticketing') })}</Note>
      <Field label={t('yc.em.st.f.layout')}>
        <SegGrid value={layout} onChange={(v) => patch({ layout: v })} options={[
          { v: 'showcase', l: t('yc.em.st.f.l.showcase') }, { v: 'split', l: t('yc.em.st.f.l.split') },
          { v: 'banner', l: t('yc.em.st.f.l.banner') }, { v: 'minimal', l: t('yc.em.st.f.l.minimal') },
        ]} />
      </Field>
      <AlignField value={b.align ?? 'left'} onChange={(v) => patch({ align: v })} />
      <AccentField value={b.accent} onChange={(v) => patch({ accent: v })} />
      <Field label={t('yc.em.st.f.poster')} hint={b.cover && layout === 'split' ? t('yc.em.st.f.coverSplit') : undefined}>
        <Toggle on={b.cover} onChange={(v) => patch({ cover: v })} label={t('yc.em.st.f.cover')} />
        {b.cover && layout !== 'split' && (
          <Seg value={b.coverPos ?? 'top'} onChange={(v) => patch({ coverPos: v })} options={[{ v: 'top', l: t('yc.em.st.f.coverTop') }, { v: 'bottom', l: t('yc.em.st.f.coverBottom') }]} />
        )}
      </Field>
      <Field label={t('yc.em.st.f.kicker')} right={<OptionalTag />}>
        <TextInput value={b.kicker ?? ''} placeholder={t('yc.em.st.f.kickerPhEvent')} onChange={(v) => patch({ kicker: v })} label={t('yc.em.st.f.kicker')} />
      </Field>
      <Field label={t('yc.em.st.f.sub')} right={<OptionalTag />}>
        <TextInput value={b.sub ?? ''} placeholder={t('yc.em.st.f.subPh')} onChange={(v) => patch({ sub: v })} label={t('yc.em.st.f.sub')} />
      </Field>
      <Field label={t('yc.em.st.f.meta')} hint={metaLocked ? t('yc.em.st.f.metaBanner') : undefined}>
        {!metaLocked && (
          <Seg value={b.metaDisplay ?? 'stack'} onChange={(v) => patch({ metaDisplay: v })} options={[
            { v: 'stack', l: t('yc.em.st.f.metaStack') }, { v: 'inline', l: t('yc.em.st.f.metaInline') }, { v: 'rows', l: t('yc.em.st.f.metaRows') },
          ]} />
        )}
        <Toggle on={b.venue} onChange={(v) => patch({ venue: v })} label={t('yc.em.st.f.venueShow')} />
        <Toggle on={b.price} onChange={(v) => patch({ price: v })} label={t('yc.em.st.f.price')} />
      </Field>
      <PerksField perks={b.perks ?? []} onChange={(v) => patch({ perks: v })} />
      <ButtonFields
        label={b.ctaLabel} placeholder={EVENT_CTA_LABEL} onLabel={(v) => patch({ ctaLabel: v })}
        full={b.full ?? layout !== 'minimal'} onFull={(v) => patch({ full: v })}
        note={b.note ?? ''} notePh={t('yc.em.st.f.notePhEvent')} onNote={(v) => patch({ note: v })}
      />
    </>
  );
}

// ── Billetterie ───────────────────────────────────────────────────────────

export function TicketsFields({ block: b, patch, nights, onPick, campaignEventId, live }: YunoFieldsProps<'tickets'>) {
  const { t } = useCrmT();
  const layout = b.layout ?? 'showcase';
  const display = b.priceDisplay ?? 'rows';
  const hidden = b.hiddenRows ?? [];
  // Tarifs réels de la soirée (ceux qui partiront) : la liste que le pro décroche.
  const rows = (live?.tickets ?? []).filter((r) => !!r.id);
  return (
    <>
      <NightField label={t('yc.em.st.f.night')} value={b.eventId ?? campaignEventId} nights={nights} onPick={onPick} />
      <Note>{t('yc.em.st.f.ticketsNote')}</Note>
      <Field label={t('yc.em.st.f.layout')}>
        <Seg value={layout} onChange={(v) => patch({ layout: v })} options={[
          { v: 'showcase', l: t('yc.em.st.f.l.showcase') }, { v: 'banner', l: t('yc.em.st.f.l.banner') }, { v: 'minimal', l: t('yc.em.st.f.l.minimal') },
        ]} />
      </Field>
      {layout !== 'banner' && (
        <Field label={t('yc.em.st.f.priceDisplay')}>
          <Seg value={display} onChange={(v) => patch({ priceDisplay: v })} options={[{ v: 'rows', l: t('yc.em.st.f.pdRows') }, { v: 'from', l: t('yc.em.st.f.pdFrom') }]} />
        </Field>
      )}
      {rows.length > 0 && display !== 'from' && layout !== 'banner' && (
        <Field label={t('yc.em.st.f.tiers')} hint={t('yc.em.st.f.tiersHint')}>
          {rows.map((r) => (
            <Toggle
              key={r.id}
              on={!hidden.includes(r.id!)}
              onChange={(v) => patch({ hiddenRows: v ? hidden.filter((x) => x !== r.id) : [...hidden, r.id!] })}
              label={<span>{r.n} · <b style={{ fontWeight: 600 }}>{r.p}</b>{r.out && <span style={{ color: 'var(--sand-500)' }}> · {t('yc.em.st.f.tierOut')}</span>}</span>}
            />
          ))}
        </Field>
      )}
      <AlignField value={b.align ?? 'left'} onChange={(v) => patch({ align: v })} />
      <AccentField value={b.accent} onChange={(v) => patch({ accent: v })} />
      <Field label={t('yc.em.st.f.kicker')} right={<OptionalTag />}>
        <TextInput value={b.kicker ?? ''} placeholder={ticketsKicker(false)} onChange={(v) => patch({ kicker: v || undefined })} label={t('yc.em.st.f.kicker')} />
      </Field>
      <Field label={t('yc.em.st.f.title')} right={<OptionalTag />}>
        <TextInput value={b.title ?? ''} onChange={(v) => patch({ title: v })} label={t('yc.em.st.f.title')} />
      </Field>
      <Field label={t('yc.em.st.f.sub')} right={<OptionalTag />}>
        <TextInput value={b.sub ?? ''} placeholder={t('yc.em.st.f.subPh')} onChange={(v) => patch({ sub: v })} label={t('yc.em.st.f.sub')} />
      </Field>
      <PerksField perks={b.perks ?? []} onChange={(v) => patch({ perks: v })} />
      <VisualField url={b.coverUrl} pos={b.coverPos} onUrl={(v) => patch({ coverUrl: v })} onPos={(v) => patch({ coverPos: v })} />
      <ButtonFields
        label={b.ctaLabel ?? ''} placeholder={ticketsCtaLabel(false)} onLabel={(v) => patch({ ctaLabel: v || undefined })}
        full={b.full ?? layout !== 'minimal'} onFull={(v) => patch({ full: v })}
        note={b.note ?? ''} notePh={t('yc.em.st.f.notePhTickets')} onNote={(v) => patch({ note: v })}
      />
    </>
  );
}

// ── Compte à rebours ──────────────────────────────────────────────────────

/** ISO UTC → valeur d'un champ datetime-local (heure de l'appareil). */
function toLocalInput(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function CountdownFields({ block: b, patch, nights, onPick, campaignEventId }: YunoFieldsProps<'countdown'>) {
  const { t } = useCrmT();
  const linked = !!(b.eventId ?? campaignEventId);
  return (
    <>
      <Field label={t('yc.em.st.f.cdLabel')}><TextInput value={b.label} onChange={(v) => patch({ label: v })} label={t('yc.em.st.f.cdLabel')} /></Field>
      <NightField label={t('yc.em.st.f.nightCd')} value={b.eventId ?? campaignEventId} nights={nights} onPick={onPick} />
      {!linked && (
        <Field label={t('yc.em.st.f.cdDate')} hint={t('yc.em.st.f.cdDateHint')}>
          <input
            className="yc-field"
            type="datetime-local"
            aria-label={t('yc.em.st.f.cdDate')}
            value={toLocalInput(b.targetAt)}
            onChange={(e) => {
              const d = e.target.value ? new Date(e.target.value) : null;
              patch({ targetAt: d && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined });
            }}
            style={{ height: 44, boxSizing: 'border-box', padding: '0 14px', borderRadius: 12, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14.5, color: 'var(--ink)', width: '100%' }}
          />
        </Field>
      )}
      <AccentField value={b.accent} onChange={(v) => patch({ accent: v })} />
      <Note>{t('yc.em.st.f.cdNote')}</Note>
    </>
  );
}

// ── Line-up ───────────────────────────────────────────────────────────────

function Face({ a, size = 34 }: { a: LineupArtist; size?: number }) {
  const photo = lineupPhoto(a.photo);
  return photo
    ? <img src={photo} alt="" style={{ flex: 'none', width: size, height: size, borderRadius: 99, objectFit: 'cover', boxShadow: '0 0 0 1px var(--sand-200)' }} />
    : <span style={{ flex: 'none', width: size, height: size, borderRadius: 99, background: 'var(--red-50)', color: 'var(--red-700)', display: 'grid', placeItems: 'center', fontSize: size * 0.36, fontWeight: 700 }}>{artistInitials(a.name)}</span>;
}

/** Un artiste ajouté à la main : sa photo (facultative) et son nom. */
function ExtraArtistRow({ a, onChange, onRemove }: { a: LineupArtist; onChange: (a: LineupArtist) => void; onRemove: () => void }) {
  const { t } = useCrmT();
  const { busy, upload } = useEmailImageUpload();
  const input = useRef<HTMLInputElement>(null);
  const pick = async (file: File | undefined) => {
    const url = await upload(file);
    if (url) onChange({ ...a, photo: url });
    if (input.current) input.current.value = '';
  };
  const photo = lineupPhoto(a.photo);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <label title={t('yc.em.st.f.luPhotoAdd')} style={{ position: 'relative', flex: 'none', width: 44, height: 44, borderRadius: 99, cursor: busy ? 'progress' : 'pointer', background: 'var(--sand-100)', display: 'grid', placeItems: 'center', overflow: 'hidden', boxShadow: '0 0 0 1px var(--sand-200)' }}>
        {photo
          ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <Icon name={busy ? 'refresh' : 'upload'} size={16} stroke={2.2} color="var(--sand-500)" style={busy ? { animation: 'yc-spin 900ms linear infinite' } : undefined} />}
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" aria-label={t('yc.em.st.f.luPhotoAdd')} disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} style={{ display: 'none' }} />
      </label>
      <TextInput value={a.name} placeholder={t('yc.em.st.f.luName')} onChange={(v) => onChange({ ...a, name: v })} label={t('yc.em.st.f.luName')} />
      {photo && <SmallBtn onClick={() => onChange({ ...a, photo: null })} label={t('yc.em.st.f.luPhotoRemove')}><Icon name="x" size={14} stroke={2.4} /></SmallBtn>}
      <SmallBtn danger onClick={onRemove} label={t('yc.em.st.f.remove')}><Icon name="trash" size={15} stroke={2.2} /></SmallBtn>
    </div>
  );
}

export function LineupFields({ block: b, patch, nights, onPick, campaignEventId, live, template }: YunoFieldsProps<'lineup'>) {
  const { t } = useCrmT();
  const night = live?.lineup;
  const extra = b.extra ?? [];
  const hidden = new Set((b.hidden ?? []).map((h) => artistKey(h)));
  const shown = lineupArtists(night, b);
  const anyPhoto = shown.some((a) => !!a.photo);
  const grid = lineupUsesPhotos(b.photos, shown);
  const linked = !!(b.eventId ?? campaignEventId);
  const setHidden = (name: string, out: boolean) => {
    const rest = (b.hidden ?? []).filter((h) => artistKey(h) !== artistKey(name));
    patch({ hidden: out ? [...rest, name] : rest });
  };
  return (
    <>
      <NightField label={t('yc.em.st.f.night')} value={b.eventId ?? campaignEventId} nights={nights} onPick={onPick} />
      <Note>{t('yc.em.st.f.luNote')}</Note>
      {linked && (
        <Field label={t('yc.em.st.f.luNight')} hint={night && night.length ? t('yc.em.st.f.luNightHint') : undefined}>
          {night === undefined && <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{t('yc.em.st.f.luLoading')}</span>}
          {night && night.length === 0 && <Note>{t('yc.em.st.f.luNone')}</Note>}
          {night && night.map((a) => (
            <div key={artistKey(a.name)} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Face a={a} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <Toggle on={!hidden.has(artistKey(a.name))} onChange={(v) => setHidden(a.name, !v)} label={<b style={{ fontWeight: 600, color: 'var(--ink)' }}>{a.name}</b>} />
              </span>
            </div>
          ))}
        </Field>
      )}
      {template ? (
        <Note>{t('yc.em.st.f.luTemplate')}</Note>
      ) : (
        <Field label={t('yc.em.st.f.luExtra')} right={<OptionalTag />} hint={t('yc.em.st.f.luExtraHint')}>
          {extra.map((a, i) => (
            <ExtraArtistRow
              key={i}
              a={a}
              onChange={(next) => patch({ extra: extra.map((x, j) => (j === i ? next : x)) })}
              onRemove={() => patch({ extra: extra.filter((_, j) => j !== i) })}
            />
          ))}
          <AddBtn onClick={() => patch({ extra: [...extra, { name: '', photo: null }] })}>{t('yc.em.st.f.luAdd')}</AddBtn>
        </Field>
      )}
      <Field label={t('yc.em.st.f.luPhotosT')} hint={shown.length > 0 && !anyPhoto ? t('yc.em.st.f.luNoPhoto') : t('yc.em.st.f.luPhotosHint')}>
        <Toggle on={b.photos !== false} onChange={(v) => patch({ photos: v })} label={t('yc.em.st.f.luPhotos')} />
      </Field>
      <Field label={t('yc.em.st.f.kicker')} right={<OptionalTag />}>
        <TextInput value={b.kicker ?? ''} placeholder={LINEUP_KICKER} onChange={(v) => patch({ kicker: v || undefined })} label={t('yc.em.st.f.kicker')} />
      </Field>
      {!grid && <AlignField value={b.align ?? 'center'} onChange={(v) => patch({ align: v })} />}
      <AccentField value={b.accent} onChange={(v) => patch({ accent: v })} />
    </>
  );
}
