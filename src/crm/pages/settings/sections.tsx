/**
 * Les cinq sections de l'écran Réglages, telles que le design les dessine.
 * Chacune reçoit le formulaire et n'écrit que dans lui : rien ne part au
 * serveur avant « Enregistrer » (SettingsPage).
 */
import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Badge } from '@/crm/ui/kit';
import { EASE, SPRING } from '@/crm/ui/motion';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import type { CrmSettings, RulesPreview } from '@/crm/data/settings';
import { hourLabel, initials, nightHours, slugify, type SettingsForm } from './form';
import { fieldCss, GreenSwitch, LockNote, SecCard, SecHead, Seg, useTween } from './settingsUi';

type Set = <K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) => void;

/** Logo de l'espace, ou ses initiales sur le dégradé Yuno. */
export function LogoTile({ url, name, size, radius }: { url: string | null; name: string; size: number; radius: number }) {
  if (url) {
    return <img src={url} alt="" style={{ flex: 'none', width: size, height: size, borderRadius: radius, objectFit: 'cover', display: 'block', boxShadow: '0 0 0 1px rgba(28,21,23,.08)' }} />;
  }
  return (
    <span aria-hidden style={{ flex: 'none', width: size, height: size, borderRadius: radius, background: 'var(--gradient-brand)', color: '#fff', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: Math.round(size * 0.38), letterSpacing: '-.02em' }}>
      {initials(name)}
    </span>
  );
}

export interface NextNightLite { title: string; at: string }

// ── A · Établissement ─────────────────────────────────────────────────────

export function SectionIdentity({
  delay, f, set, s, canEdit, lockNote, onLogo, uploading, next, senderName,
}: {
  delay: number | undefined; f: SettingsForm; set: Set; s: CrmSettings; canEdit: boolean; lockNote: boolean;
  onLogo: (file: File) => void; uploading: boolean; next: NextNightLite | null; senderName: string | null;
}) {
  const { t, dWeek, dLong, time } = useCrmT();
  const [tab, setTab] = useState<'mail' | 'inbox'>('mail');
  const whenLabel = (at: string) => {
    const d = new Date(at);
    const day = (x: Date) => x.toDateString();
    const tm = new Date(); tm.setDate(tm.getDate() + 1);
    if (day(d) === day(new Date())) return t('yc.set.a.tonight', { time: time(d) });
    if (day(d) === day(tm)) return t('yc.set.a.tomorrow', { time: time(d) });
    return `${dWeek(d)}, ${time(d)}`;
  };
  const nameOk = f.name.trim().length >= 2;
  const lockUntil = s.identity?.rename_locked_until && new Date(s.identity.rename_locked_until) > new Date() ? s.identity.rename_locked_until : null;
  const nameChanged = f.name.trim() !== (s.identity?.name ?? '').trim();
  const nameShown = f.name.trim() || t('yc.set.a.yourName');
  const subLine = [f.city.trim(), t(`yc.set.type.${f.type}`)].filter(Boolean).join(' · ');
  const nightTitle = next?.title ?? t('yc.set.a.nextNone');
  const nightWhen = next ? whenLabel(next.at) : '';
  const inboxName = senderName?.trim() || nameShown;
  const nameBad = !nameOk || (!!lockUntil && nameChanged);
  const nameHint = !nameOk ? t('yc.set.a.nameBad') : lockUntil ? t('yc.set.a.nameLock', { date: dLong(lockUntil) }) : t('yc.set.a.nameHint');
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onLogo(file);
  };

  return (
    <SecCard id="a" delay={delay}>
      <SecHead id="a" title={t('yc.set.a.t')} sub={t('yc.set.a.s')} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '26px 32px', alignItems: 'flex-start' }}>
        <fieldset disabled={!canEdit} style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18, border: 0, margin: 0, padding: 0 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sand-700)' }}>{t('yc.set.a.name')}</span>
            <input
              value={f.name}
              onChange={(e) => set('name', e.target.value)}
              autoComplete="off"
              maxLength={40}
              className="yc-field"
              style={fieldCss(nameBad)}
            />
            <span style={{ fontSize: 13, lineHeight: 1.4, color: nameBad ? 'var(--red-600)' : 'var(--sand-500)' }}>{nameHint}</span>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sand-700)' }}>{t('yc.set.a.city')}</span>
            <input value={f.city} onChange={(e) => set('city', e.target.value)} autoComplete="off" maxLength={32} className="yc-field" style={fieldCss(false)} />
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sand-700)' }}>{t('yc.set.a.type')}</span>
            <div style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
              <Seg
                label={t('yc.set.a.type')}
                options={[{ v: 'club' as const, l: t('yc.set.type.club') }, { v: 'organizer' as const, l: t('yc.set.type.organizer') }]}
                value={f.type}
                onChange={(v) => set('type', v)}
                disabled={!canEdit}
                h={38}
                px={20}
                fs={14.5}
              />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sand-700)' }}>{t('yc.set.a.logo')}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 16px' }}>
              <span style={{ position: 'relative', display: 'block', borderRadius: 16, boxShadow: 'var(--shadow-xs)' }}>
                <LogoTile url={f.logo} name={f.name} size={56} radius={16} />
                {uploading && (
                  <span style={{ position: 'absolute', inset: 0, borderRadius: 16, background: 'rgba(28,21,23,.5)', display: 'grid', placeItems: 'center' }}>
                    <span style={{ width: 18, height: 18, borderRadius: 99, border: '2.5px solid rgba(255,255,255,.35)', borderTopColor: '#fff', animation: 'yc-spin 700ms linear infinite' }} />
                  </span>
                )}
              </span>
              <Hv
                as="label"
                style={{ height: 42, padding: '0 18px 0 14px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: canEdit ? 'pointer' : 'not-allowed', boxShadow: 'var(--shadow-xs)', opacity: canEdit ? 1 : 0.55, transition: 'background 160ms,border-color 160ms' }}
                hover={canEdit ? { background: 'var(--paper)', borderColor: 'var(--sand-300)' } : {}}
                active={canEdit ? { transform: 'scale(.97)' } : {}}
              >
                <Icon d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" size={17} stroke={2.2} />
                {t(f.logo ? 'yc.set.a.logoChange' : 'yc.set.a.logoAdd')}
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} disabled={!canEdit || uploading} style={{ display: 'none' }} />
              </Hv>
              {f.logo && canEdit && (
                <Hv as="button" type="button" onClick={() => set('logo', null)} style={{ height: 42, padding: '0 6px', border: 0, background: 'none', fontSize: 14.5, fontWeight: 600, color: 'var(--sand-600)', cursor: 'pointer' }} hover={{ color: 'var(--ink)' }}>
                  {t('yc.set.a.logoRm')}
                </Hv>
              )}
            </div>
            <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.set.a.logoHint')}</span>
          </div>
          {lockNote && <LockNote>{t('yc.set.a.locked')}</LockNote>}
        </fieldset>

        {/* Aperçu en direct */}
        <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: 18, borderRadius: 22, background: 'var(--sand-50)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.set.a.preview')}</span>
            <div style={{ display: 'flex', padding: 3, gap: 2, borderRadius: 99, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
              {(['mail', 'inbox'] as const).map((k) => (
                <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k} style={{ height: 30, padding: '0 13px', border: 0, borderRadius: 99, background: tab === k ? 'var(--ink)' : 'transparent', color: tab === k ? '#fff' : 'var(--sand-600)', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'background 200ms,color 200ms', whiteSpace: 'nowrap' }}>
                  {t(`yc.set.a.tab.${k}`)}
                </button>
              ))}
            </div>
          </div>
          {tab === 'mail' ? (
            <div key="mail" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '22px 20px', borderRadius: 18, background: '#fff', boxShadow: 'var(--shadow-sm),0 0 0 1px var(--sand-100)', animation: `yc-fade 320ms ${EASE} both` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <LogoTile url={f.logo} name={nameShown} size={56} radius={16} />
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, lineHeight: 1.1, letterSpacing: '-.03em', overflowWrap: 'anywhere' }}>{nameShown}</span>
                  <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{subLine}</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', borderRadius: 14, background: 'var(--sand-50)' }}>
                <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.set.a.next')}</span>
                <span style={{ fontSize: 15, fontWeight: 600, overflowWrap: 'anywhere' }}>{nightWhen ? `${nightTitle} · ${nightWhen}` : nightTitle}</span>
              </div>
              <span style={{ alignSelf: 'flex-start', height: 38, padding: '0 18px', borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{t('yc.set.a.see')}</span>
            </div>
          ) : (
            <div key="inbox" style={{ display: 'flex', flexDirection: 'column', borderRadius: 18, background: '#fff', boxShadow: 'var(--shadow-sm),0 0 0 1px var(--sand-100)', overflow: 'hidden', animation: `yc-fade 320ms ${EASE} both` }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 16 }}>
                <LogoTile url={f.logo} name={inboxName} size={40} radius={99} />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 700, overflowWrap: 'anywhere' }}>{inboxName}</span>
                    <span style={{ flex: 'none', fontSize: 12.5, color: 'var(--sand-400)' }}>{time(new Date())}</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{t('yc.set.a.subject', { night: nightTitle })}</span>
                  <span style={{ fontSize: 13.5, color: 'var(--sand-500)', lineHeight: 1.4 }}>{t('yc.set.a.snippet')}</span>
                </div>
              </div>
              <div style={{ padding: '10px 16px', background: 'var(--sand-50)', fontSize: 12.5, lineHeight: 1.4, color: 'var(--sand-500)' }}>
                {senderName?.trim() ? (
                  <>{t('yc.set.a.inboxSender', { name: senderName.trim() })} <Link to={CRM_ROUTES.emailSettings} style={{ fontWeight: 600 }}>→</Link></>
                ) : t('yc.set.a.inboxNote')}
              </div>
            </div>
          )}
        </div>
      </div>
    </SecCard>
  );
}

// ── B · Votre page (à venir) ──────────────────────────────────────────────

export function SectionPage({
  delay, f, next, notified, onNotify, notifyBusy,
}: { delay: number | undefined; f: SettingsForm; next: NextNightLite | null; notified: boolean; onNotify: () => void; notifyBusy: boolean }) {
  const { t, dWeek, time } = useCrmT();
  const slug = slugify(f.name);
  const nameShown = f.name.trim() || t('yc.set.a.yourName');
  const subLine = [f.city.trim(), t(`yc.set.type.${f.type}`)].filter(Boolean).join(' · ');
  const shown = delay !== undefined;
  return (
    <SecCard id="b" delay={delay}>
      <SecHead id="b" title={t('yc.set.b.t')} sub={t('yc.set.b.s')} right={<Badge tone="warn" style={{ height: 28, padding: '0 12px', fontSize: 12.5 }}>{t('yc.soon.badge')}</Badge>} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '28px 36px', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, opacity: 0.62 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sand-700)' }}>{t('yc.set.b.addr')}</span>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', height: 50, boxSizing: 'border-box', padding: '0 14px 0 16px', borderRadius: 12, border: '1px solid var(--sand-200)', background: '#fff' }}>
                <span style={{ flex: 'none', fontFamily: 'var(--font-mono)', fontSize: 14.5, color: 'var(--sand-400)' }}>yunoapp.eu/</span>
                <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 14.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slug}</span>
                <Icon name="lock" size={15} stroke={2.2} color="var(--sand-400)" />
              </span>
              <span aria-hidden style={{ flex: 'none', height: 50, padding: '0 18px 0 14px', boxSizing: 'border-box', borderRadius: 12, border: '1px solid var(--sand-200)', background: '#fff', color: 'var(--sand-500)', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Icon name="copy" size={16} stroke={2.2} />{t('yc.set.b.copy')}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', opacity: 0.62 }}>
            {([['yc.set.b.pageOn', 'yc.set.b.pageOnHint'], ['yc.set.b.news', 'yc.set.b.newsHint']] as const).map(([l, h], i) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: i ? '16px 0 0' : '16px 0', borderTop: '1px solid var(--sand-100)' }}>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{t(l)}</span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-500)' }}>{t(h)}</span>
                </span>
                <GreenSwitch on label={t(l)} onChange={() => { /* à venir */ }} disabled />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 16px', padding: '16px 18px', borderRadius: 18, background: 'var(--amber-50)', boxShadow: 'inset 0 0 0 1px rgba(217,119,6,.14)' }}>
            <span style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <b style={{ fontSize: 15, color: 'var(--ink)' }}>{t('yc.set.b.soonT')}</b>
              <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>{t('yc.set.b.soonS')}</span>
            </span>
            <Hv
              as="button"
              type="button"
              onClick={onNotify}
              disabled={notifyBusy}
              aria-pressed={notified}
              style={{ flex: 'none', height: 42, padding: '0 18px', borderRadius: 99, border: notified ? 0 : '1px solid var(--sand-200)', background: notified ? 'var(--green-50)' : '#fff', color: notified ? 'var(--green-700)' : 'var(--ink)', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', transition: 'background 200ms,color 200ms' }}
              hover={notified ? {} : { borderColor: 'var(--sand-300)', background: 'var(--paper)' }}
              active={{ transform: 'scale(.97)' }}
            >
              <Icon name={notified ? 'check' : 'bell'} size={16} stroke={2.4} />
              {t(notified ? 'yc.soon.notified' : 'yc.soon.notify')}
            </Hv>
          </div>
        </div>

        {/* Téléphone */}
        <div style={{ flex: '0 0 232px', margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ position: 'relative', width: 232, boxSizing: 'border-box', padding: 8, borderRadius: 36, background: 'var(--ink)', boxShadow: 'var(--shadow-md)', transform: shown ? 'none' : 'translateY(30px) rotate(2deg)', transition: `transform 700ms ${EASE} 150ms` }}>
            <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 28, background: '#fff', minHeight: 322, display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 14px 18px', boxSizing: 'border-box' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 26, borderRadius: 99, background: 'var(--sand-100)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--sand-600)', overflow: 'hidden', whiteSpace: 'nowrap', padding: '0 10px' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>yunoapp.eu/{slug}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
                <LogoTile url={f.logo} name={nameShown} size={38} radius={11} />
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, letterSpacing: '-.02em', lineHeight: 1.1, overflowWrap: 'anywhere' }}>{nameShown}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--sand-500)' }}>{subLine}</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, borderRadius: 14, background: 'var(--sand-50)' }}>
                <div style={{ height: 62, borderRadius: 9, background: 'repeating-linear-gradient(135deg,var(--sand-100) 0 8px,var(--sand-200) 8px 16px)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.set.b.poster')}</div>
                <span style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>{next?.title ?? t('yc.set.a.nextNone')}</span>
                {next && <span style={{ fontSize: 11.5, color: 'var(--sand-500)' }}>{dWeek(next.at)} · {time(next.at)}</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 14, boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t('yc.set.b.get')}</span>
                <span style={{ height: 30, borderRadius: 9, background: 'var(--sand-50)', display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: 11.5, color: 'var(--sand-400)' }}>{t('yc.set.b.email')}</span>
                <span style={{ height: 30, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 12, fontWeight: 600, display: 'grid', placeItems: 'center' }}>{t('yc.set.b.join')}</span>
              </div>
            </div>
          </div>
          <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.set.b.phone')}</span>
        </div>
      </div>
    </SecCard>
  );
}

// ── C · Règles clients ────────────────────────────────────────────────────

function StepBtn({ dir, off, onClick, label }: { dir: -1 | 1; off: boolean; onClick: () => void; label: string }) {
  return (
    <Hv
      as="button"
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={off}
      style={{ width: 36, height: 36, border: 0, borderRadius: 99, background: '#fff', color: 'var(--ink)', display: 'grid', placeItems: 'center', cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.35 : 1, boxShadow: 'var(--shadow-xs)', transition: `transform 200ms ${SPRING},opacity 200ms` }}
      hover={off ? {} : { transform: 'scale(1.08)' }}
      active={off ? {} : { transform: 'scale(.92)' }}
    >
      <Icon name={dir < 0 ? 'minus' : 'plus'} size={16} stroke={2.6} />
    </Hv>
  );
}

export function SectionRules({ delay, f, set, preview, canEdit }: { delay: number | undefined; f: SettingsForm; set: Set; preview: RulesPreview | undefined; canEdit: boolean }) {
  const { t, tp, n, lang } = useCrmT();
  const shown = delay !== undefined;
  const total = preview?.total ?? null;
  const habTarget = preview ? (preview.hab[String(f.perHab)]?.[String(f.mois)]?.[f.nHab - 1] ?? 0) : null;
  const reactTarget = preview ? (preview.lapsed[String(f.mois)] ?? 0) : null;
  const hNum = useTween(habTarget, shown, (delay ?? 0) + 350);
  const rNum = useTween(reactTarget, shown, (delay ?? 0) + 350);
  const hShare = total ? Math.min(100, (hNum / total) * 100) : 0;
  const reactW = ((f.mois - 2) / 10) * 100;
  const sinceSix = (h: number) => (((h - 18) % 24) + 24) % 24;
  const nightW = Math.min(100, (sinceSix(f.jour) / 24) * 100);
  const nightMark = (sinceSix(1) / 24) * 100;
  const hl = (h: number) => hourLabel(h, lang);
  const step = (d: number) => {
    const v = Math.min(6, Math.max(2, f.nHab + d));
    if (v !== f.nHab) set('nHab', v);
  };
  const block = { display: 'flex', flexWrap: 'wrap' as const, gap: '20px 28px', alignItems: 'stretch', padding: '24px 0', borderTop: '1px solid var(--sand-100)' };
  const big = { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 46, lineHeight: 1, letterSpacing: '-.04em', fontVariantNumeric: 'tabular-nums' as const };

  return (
    <SecCard id="c" delay={delay} gap={6}>
      <SecHead id="c" title={t('yc.set.c.t')} sub={t('yc.set.c.s')} mb={14} />
      <fieldset disabled={!canEdit} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Habitué */}
        <div style={block}>
          <div style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <span style={{ fontSize: 17, fontWeight: 600 }}>{t('yc.set.hab.q')}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 12px', fontSize: 15, color: 'var(--sand-600)' }}>
              <span>{t('yc.set.hab.a')}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: 4, borderRadius: 99, background: 'var(--sand-100)' }}>
                <StepBtn dir={-1} off={!canEdit || f.nHab <= 2} onClick={() => step(-1)} label={t('yc.set.hab.minus')} />
                <span style={{ minWidth: 34, textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em', color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{f.nHab}</span>
                <StepBtn dir={1} off={!canEdit || f.nHab >= 6} onClick={() => step(1)} label={t('yc.set.hab.plus')} />
              </span>
              <span>{t('yc.set.hab.b')}</span>
              <Seg
                label={t('yc.set.hab.b')}
                options={([6, 12, 24] as const).map((m) => ({ v: m, l: t('yc.set.months', { n: m }) }))}
                value={f.perHab}
                onChange={(v) => set('perHab', v)}
                disabled={!canEdit}
              />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 16, borderRadius: 18, background: 'var(--sand-50)' }}>
              {[1, 2, 3, 4, 5, 6].map((i) => {
                const on = i <= f.nHab;
                return (
                  <span key={i} style={{ width: 46, height: 34, boxSizing: 'border-box', borderRadius: 10, display: 'grid', placeItems: 'center', fontSize: 12.5, fontWeight: 700, background: on ? 'var(--ink)' : 'transparent', color: on ? '#fff' : 'var(--sand-400)', border: on ? '1.5px solid var(--ink)' : '1.5px dashed var(--sand-300)', opacity: shown ? 1 : 0, transform: shown ? 'scale(1)' : 'scale(.6)', transition: `background 260ms,color 260ms,border-color 260ms,opacity 500ms ${EASE} ${shown ? i * 70 + 200 : 0}ms,transform 500ms ${SPRING} ${shown ? i * 70 + 200 : 0}ms` }}>{i}</span>
                );
              })}
              <span style={{ marginLeft: 6, height: 28, padding: '0 12px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="check" size={13} stroke={3} />{t('yc.set.hab.badge')}
              </span>
            </div>
          </div>
          <div style={{ flex: '0 1 230px', minWidth: 200, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, padding: '20px 22px', borderRadius: 22, background: 'var(--sand-50)' }}>
            <span style={big}>{n(hNum)}</span>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{tp('yc.set.hab.count', Math.round(hNum))}</span>
            <div style={{ height: 8, borderRadius: 99, background: 'var(--sand-200)', overflow: 'hidden', marginTop: 4 }}>
              <div style={{ height: '100%', borderRadius: 99, background: 'var(--gradient-brand)', width: `${hShare}%`, transition: `width 600ms ${EASE}` }} />
            </div>
            <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{total === null ? ' ' : tp('yc.set.hab.of', total, { n: n(total) })}</span>
          </div>
        </div>

        {/* À réactiver */}
        <div style={block}>
          <div style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <span style={{ fontSize: 17, fontWeight: 600 }}>{t('yc.set.lapse.q')}</span>
            <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px 10px', fontSize: 15, color: 'var(--sand-600)' }}>
              <span>{t('yc.set.lapse.a')}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 28, letterSpacing: '-.03em', color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{t('yc.set.months', { n: f.mois })}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '18px 16px 14px', borderRadius: 18, background: 'var(--sand-50)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600 }}>
                <span style={{ color: 'var(--green-700)' }}>{t('yc.set.lapse.active')}</span>
                <span style={{ color: 'var(--red-600)' }}>{t('yc.set.lapse.react')}</span>
              </div>
              <div style={{ margin: '0 8px', height: 16, borderRadius: 99, background: 'var(--red-500)', overflow: 'hidden', position: 'relative' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 99, background: 'var(--green-500)', width: `${reactW}%`, transition: `width 380ms ${EASE}` }} />
              </div>
              <input
                type="range"
                min={2}
                max={12}
                step={1}
                value={f.mois}
                onChange={(e) => set('mois', parseInt(e.target.value, 10))}
                aria-label={t('yc.set.lapse.aria')}
                style={{ width: '100%', margin: '2px 0 0', accentColor: 'var(--red-500)', cursor: canEdit ? 'pointer' : 'not-allowed', height: 22 }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', margin: '0 8px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--sand-400)' }}>
                <span>{t('yc.set.lapse.min')}</span><span>4</span><span>6</span><span>8</span><span>10</span><span>{t('yc.set.lapse.max')}</span>
              </div>
            </div>
          </div>
          <div style={{ flex: '0 1 230px', minWidth: 200, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, padding: '20px 22px', borderRadius: 22, background: 'var(--red-50)' }}>
            <span style={big}>{n(rNum)}</span>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{tp('yc.set.lapse.count', Math.round(rNum))}</span>
            <span style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--sand-600)' }}>{t('yc.set.lapse.desc', { n: f.mois })}</span>
          </div>
        </div>

        {/* Fin de nuit */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '24px 0 6px', borderTop: '1px solid var(--sand-100)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px 20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 17, fontWeight: 600 }}>{t('yc.set.night.q')}</span>
              <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.set.night.s')}</span>
            </div>
            <Seg
              label={t('yc.set.night.q')}
              options={nightHours(f.jour).map((h) => ({ v: h, l: hl(h) }))}
              value={f.jour}
              onChange={(v) => set('jour', v)}
              disabled={!canEdit}
              wrap
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '18px 16px 14px', borderRadius: 18, background: 'var(--sand-50)' }}>
            <div style={{ position: 'relative', height: 16, borderRadius: 99, background: 'var(--sand-200)', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 99, background: 'var(--ink)', width: `${nightW}%`, transition: `width 420ms ${EASE}` }} />
              <div style={{ position: 'absolute', left: `${nightMark}%`, top: 3, width: 10, height: 10, marginLeft: -5, borderRadius: 99, background: 'var(--tangerine-500)', boxShadow: '0 0 0 2px #fff' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--sand-400)' }}>
              {[18, 22, 2, 6, 10, 14, 18].map((h, i) => <span key={i}>{hl(h)}</span>)}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', paddingTop: 6, fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-600)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--ink)' }} />{t('yc.set.night.fri')}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--sand-300)' }} />{t('yc.set.night.sat')}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: 99, background: 'var(--tangerine-500)' }} />{t('yc.set.night.ex', { h: hl(1) })}</span>
            </div>
          </div>
          <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.set.night.sentence', { one: hl(1), h: hl(f.jour + 1) })}</span>
        </div>
      </fieldset>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 14, borderTop: '1px solid var(--sand-100)', fontSize: 14, color: 'var(--sand-500)', flexWrap: 'wrap' }}>
        {t('yc.set.c.foot')} <Link to={CRM_ROUTES.segments} style={{ fontWeight: 600 }}>{t('yc.set.c.footLink')}</Link>
      </div>
    </SecCard>
  );
}

// ── D · Données ───────────────────────────────────────────────────────────

export type ExportState = 'idle' | 'busy' | 'done';

export function SectionData({
  delay, f, set, s, preview, exp, onExport, onDelete, canExport,
}: {
  delay: number | undefined; f: SettingsForm; set: Set; s: CrmSettings; preview: RulesPreview | undefined;
  exp: ExportState; onExport: () => void; onDelete: () => void; canExport: boolean;
}) {
  const { t, tp, n, dLong } = useCrmT();
  const small = useNarrow(520);
  const total = preview?.total ?? null;
  const erase = f.conserv === null ? 0 : (preview?.erase[String(f.conserv)] ?? null);
  const msg = f.conserv === null ? t('yc.set.ret.none')
    : erase === null ? ' '
      : erase === 0 ? t('yc.set.ret.zero')
        : tp('yc.set.ret.would', erase, { n: n(erase) });
  const msgColor = f.conserv !== null && (erase ?? 0) > 0 ? 'var(--amber-700)' : 'var(--green-700)';
  const row = { display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', justifyContent: 'space-between', gap: '14px 24px', padding: '20px 0', borderTop: '1px solid var(--sand-100)' };
  const ico = (d: string) => (
    <span style={{ flex: 'none', width: 40, height: 40, borderRadius: 12, background: 'var(--sand-50)', color: 'var(--sand-700)', display: 'grid', placeItems: 'center' }}><Icon d={d} size={19} stroke={2} /></span>
  );
  const name = s.identity?.name ?? '';

  return (
    <SecCard id="d" delay={delay} gap={6}>
      <SecHead id="d" title={t('yc.set.d.t')} sub={t('yc.set.d.s')} mb={14} />
      <div style={row}>
        <span style={{ flex: '1 1 280px', display: 'flex', alignItems: 'center', gap: 14 }}>
          {ico('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3')}
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{t('yc.set.exp.t')}</span>
            <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-500)' }}>{total === null ? ' ' : tp('yc.set.exp.s', total, { n: n(total) })}</span>
          </span>
        </span>
        <Hv
          as="button"
          type="button"
          onClick={onExport}
          disabled={!canExport}
          style={{ flex: 'none', height: 42, padding: '0 20px', borderRadius: 99, border: `1px solid ${exp === 'done' ? 'var(--green-50)' : 'var(--sand-200)'}`, background: exp === 'done' ? 'var(--green-50)' : '#fff', color: exp === 'done' ? 'var(--green-700)' : 'var(--ink)', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 9, cursor: !canExport ? 'not-allowed' : exp === 'busy' ? 'progress' : 'pointer', opacity: canExport ? 1 : 0.55, transition: 'background 200ms,border-color 200ms,color 200ms' }}
          hover={exp === 'idle' && canExport ? { background: 'var(--paper)', borderColor: 'var(--sand-300)' } : {}}
          active={canExport ? { transform: 'scale(.97)' } : {}}
        >
          {exp === 'busy' && <span style={{ width: 15, height: 15, borderRadius: 99, border: '2.5px solid var(--sand-300)', borderTopColor: 'var(--ink)', animation: 'yc-spin 700ms linear infinite' }} />}
          {exp === 'done' && <Icon name="check" size={16} stroke={2.6} />}
          {t(exp === 'busy' ? 'yc.set.exp.busy' : exp === 'done' ? 'yc.set.exp.done' : 'yc.set.exp.btn')}
        </Hv>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '20px 0', borderTop: '1px solid var(--sand-100)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {ico('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2')}
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{t('yc.set.ret.t')}</span>
            <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-500)', textWrap: 'pretty' }}>{t('yc.set.ret.s')}</span>
          </span>
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 16px', paddingLeft: small ? 0 : 54 }}>
          <Seg
            label={t('yc.set.ret.t')}
            options={[{ v: null, l: t('yc.set.ret.never') }, { v: 60 as const, l: t('yc.set.ret.years', { n: 5 }) }, { v: 36 as const, l: t('yc.set.ret.years', { n: 3 }) }, { v: 24 as const, l: t('yc.set.ret.years', { n: 2 }) }]}
            value={f.conserv}
            onChange={(v) => set('conserv', v)}
            disabled={!s.can.retention}
            px={small ? 13 : 16}
          />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 500, color: msgColor }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: 'currentColor' }} />{msg}
          </span>
        </div>
        {(s.retention_last || (s.can.edit && !s.can.retention)) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: small ? 0 : 54 }}>
            {s.retention_last && <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{tp('yc.set.ret.last', s.retention_last.erased, { n: n(s.retention_last.erased), date: dLong(s.retention_last.at) })}</span>}
            {s.can.edit && !s.can.retention && <LockNote>{t('yc.set.ret.locked')}</LockNote>}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '14px 24px', padding: '18px 20px', marginTop: 10, borderRadius: 20, background: 'var(--red-50)', boxShadow: 'inset 0 0 0 1px var(--red-100)' }}>
        <span style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--red-800)', overflowWrap: 'anywhere' }}>{t('yc.set.del.t', { name })}</span>
          <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--red-700)' }}>
            {s.deletion_requested_at ? t('yc.set.del.pending', { date: dLong(s.deletion_requested_at) }) : t('yc.set.del.s')}
          </span>
        </span>
        {!s.deletion_requested_at && (s.can.delete ? (
          <Hv
            as="button"
            type="button"
            onClick={onDelete}
            style={{ flex: 'none', height: 42, padding: '0 20px', borderRadius: 99, border: '1px solid var(--red-200)', background: '#fff', color: 'var(--red-600)', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', transition: 'background 160ms,color 160ms,border-color 160ms' }}
            hover={{ background: 'var(--red-500)', color: '#fff', borderColor: 'var(--red-500)' }}
            active={{ transform: 'scale(.97)' }}
          >
            {t('yc.set.del.btn')}
          </Hv>
        ) : (
          <span style={{ flex: 'none', height: 34, padding: '0 14px', borderRadius: 99, background: '#fff', color: 'var(--red-700)', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 7, boxShadow: 'inset 0 0 0 1px var(--red-100)' }}>
            <Icon name="lock" size={13} stroke={2.4} />{t('yc.set.del.only')}
          </span>
        ))}
      </div>
    </SecCard>
  );
}

// ── E · Ailleurs ──────────────────────────────────────────────────────────

const LINKS: { k: string; to: string; d: string }[] = [
  { k: 'email', to: CRM_ROUTES.emailSettings, d: 'M22 6 12 13 2 6M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' },
  { k: 'sms', to: CRM_ROUTES.smsSettings, d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
  { k: 'ig', to: CRM_ROUTES.instagram, d: 'M17.5 6.5h.01M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zM16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z' },
  { k: 'conn', to: CRM_ROUTES.connectors, d: 'M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z' },
  { k: 'acc', to: CRM_ROUTES.account, d: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z' },
];

export function SectionElsewhere({ delay }: { delay: number | undefined }) {
  const { t } = useCrmT();
  const shown = delay !== undefined;
  return (
    <SecCard id="e" delay={delay} gap={16} plain>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.set.e.t')}</h2>
        <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.set.e.s')}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 14 }}>
        {LINKS.map((l, i) => (
          <Hv
            key={l.k}
            as={Link}
            to={l.to}
            style={{
              boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14, padding: 20, borderRadius: 24, background: '#fff',
              boxShadow: 'inset 0 0 0 1px var(--sand-200)', color: 'var(--ink)', textDecoration: 'none',
              opacity: shown ? 1 : 0, transform: shown ? 'none' : 'translateY(18px)',
              transition: `opacity 600ms ${EASE} ${shown ? 250 + i * 90 : 0}ms,transform 300ms ${EASE},box-shadow 300ms ${EASE}`,
            }}
            hover={{ transform: 'translateY(-3px)', boxShadow: 'inset 0 0 0 1px var(--sand-300),var(--shadow-md)', color: 'var(--ink)', textDecoration: 'none' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ width: 42, height: 42, borderRadius: 13, background: 'var(--sand-50)', color: 'var(--sand-700)', display: 'grid', placeItems: 'center' }}><Icon d={l.d} size={20} stroke={2} /></span>
              <span style={{ width: 30, height: 30, borderRadius: 99, background: 'var(--sand-50)', color: 'var(--sand-600)', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={15} stroke={2.4} /></span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{t(`yc.set.e.${l.k}`)}</span>
              <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-500)' }}>{t(`yc.set.e.${l.k}S`)}</span>
            </div>
          </Hv>
        ))}
      </div>
    </SecCard>
  );
}
