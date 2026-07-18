/**
 * « Mon compte » — l'écran personnel d'un membre du staff club.
 *
 * Le compte pro d'un barman n'existait nulle part : il ouvrait un écran qui
 * disait « Gestion des Commandes » et c'était tout. Cette page lui donne trois
 * choses : une identité qu'il choisit, la trace de ce qu'il a fait, et le
 * visage de l'équipe avec qui il bosse.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Camera, Check, Loader2, LogOut, KeyRound, Users, Sparkles,
  ScanLine, Wine, Shirt, Crown, CalendarDays, Trash2,
} from 'lucide-react';
import { PublicPage } from '@/components/PublicPage';
import { ProBackButton } from '@/components/pro/ProBackButton';
import { LanguageSelector } from '@/components/LanguageSelector';
import { useLanguage } from '@/contexts/LanguageContext';
import { useStaffIdentity } from '@/hooks/useStaffIdentity';
import { compressImage } from '@/lib/compressImage';
import { clearStaffSession } from '@/components/RequireStaffSession';
import {
  accentTokens, greetingKey, staffInitials, isStaffRole, primaryStaffRole,
  STAFF_ACCENTS, STAFF_EMOJI_CHOICES, STAFF_ROLE_DEFS,
  type StaffAccent,
} from '@/lib/staffIdentity';

const T1     = 'rgba(255,255,255,0.96)';
const T2     = 'rgba(255,255,255,0.70)';
const T3     = 'rgba(255,255,255,0.48)';
const BORDER = 'rgba(255,255,255,0.085)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';
const C_FAINT = 'rgba(255,255,255,0.04)';

interface StaffStats {
  scans_total: number;
  scans_tonight: number;
  orders_total: number;
  orders_tonight: number;
  cloakroom_total: number;
  cloakroom_tonight: number;
  vip_items_total: number;
  vip_items_tonight: number;
  vip_upsell_total: number;
  nights_worked: number;
}

interface TeamMate {
  user_id: string;
  display_name: string | null;
  title: string | null;
  emoji: string | null;
  accent: string | null;
  avatar_url: string | null;
  roles: string[];
  staff_since: string | null;
  is_me: boolean;
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl p-4 ${className}`}
      style={{ background: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: typeof Users; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-3.5 w-3.5" style={{ color: T3 }} />
      <span style={{ color: T2, fontSize: 11.5, fontWeight: 600, letterSpacing: '0.03em', textTransform: 'uppercase' }}>
        {children}
      </span>
    </div>
  );
}

export default function StaffProfile() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { identity, loading, refresh } = useStaffIdentity();
  const fileRef = useRef<HTMLInputElement>(null);

  // Brouillon local : on n'écrit en base qu'au clic sur « Enregistrer », sinon
  // chaque frappe déclencherait un UPDATE sur `profiles`.
  const [displayName, setDisplayName] = useState('');
  const [title, setTitle] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [accent, setAccent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [stats, setStats] = useState<StaffStats | null>(null);
  const [team, setTeam] = useState<TeamMate[]>([]);

  // Hydrate le brouillon dès que l'identité arrive.
  useEffect(() => {
    if (!identity) return;
    setDisplayName(identity.displayName ?? '');
    setTitle(identity.title ?? '');
    setEmoji(identity.emoji);
    setAccent(identity.accent);
    setDirty(false);
  }, [identity]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [statsRes, teamRes] = await Promise.all([
        supabase.rpc('get_staff_self_stats', { p_days: 30 }),
        supabase.rpc('get_venue_staff_team'),
      ]);
      if (cancelled) return;
      if (statsRes.data) setStats(statsRes.data as unknown as StaffStats);
      if (teamRes.data) setTeam(teamRes.data as TeamMate[]);
    })();

    return () => { cancelled = true; };
  }, []);

  const tokens = accentTokens(accent, identity?.role ?? null);
  const roleDef = identity?.role ? STAFF_ROLE_DEFS[identity.role] : null;
  const RoleIcon = roleDef?.icon;
  const previewName = displayName.trim() || identity?.firstName || identity?.name || '';

  const markDirty = <T,>(setter: (v: T) => void) => (value: T) => {
    setter(value);
    setDirty(true);
  };

  const handleSave = useCallback(async () => {
    if (!identity) return;
    setSaving(true);
    try {
      // Les chaînes vides valent « pas de valeur » : on remet NULL pour que les
      // règles de repli (prénom, libellé du rôle) reprennent la main.
      const { error } = await supabase
        .from('profiles')
        .update({
          staff_display_name: displayName.trim() || null,
          staff_title: title.trim() || null,
          staff_emoji: emoji,
          staff_accent: accent,
        })
        .eq('id', identity.userId);

      if (error) throw error;

      toast.success(t('staffme.saved'));
      setDirty(false);
      refresh();
    } catch (err) {
      console.error('staff profile save failed', err);
      toast.error(t('staffme.saveError'));
    } finally {
      setSaving(false);
    }
  }, [identity, displayName, title, emoji, accent, refresh, t]);

  const handleAvatarPick = async (file: File) => {
    if (!identity) return;
    setUploading(true);
    try {
      const compressed = await compressImage(file, 512, 0.85);
      // Chemin stable + upsert : une seule photo par personne, pas de bucket
      // qui gonfle à chaque changement d'avis.
      const path = `${identity.userId}/avatar.jpg`;

      const { error: upErr } = await supabase.storage
        .from('staff-avatars')
        .upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from('staff-avatars').getPublicUrl(path);
      // Cache-buster : l'URL publique ne change pas d'un upload à l'autre.
      const url = `${pub.publicUrl}?v=${Date.now()}`;

      const { error: profErr } = await supabase
        .from('profiles')
        .update({ staff_avatar_url: url })
        .eq('id', identity.userId);
      if (profErr) throw profErr;

      toast.success(t('staffme.photoSaved'));
      refresh();
    } catch (err) {
      console.error('staff avatar upload failed', err);
      toast.error(t('staffme.photoError'));
    } finally {
      setUploading(false);
    }
  };

  const handleAvatarRemove = async () => {
    if (!identity) return;
    setUploading(true);
    try {
      await supabase.storage.from('staff-avatars').remove([`${identity.userId}/avatar.jpg`]);
      const { error } = await supabase
        .from('profiles')
        .update({ staff_avatar_url: null })
        .eq('id', identity.userId);
      if (error) throw error;
      refresh();
    } catch (err) {
      console.error('staff avatar remove failed', err);
      toast.error(t('staffme.photoError'));
    } finally {
      setUploading(false);
    }
  };

  const handleLogout = async () => {
    clearStaffSession();
    await supabase.auth.signOut();
    navigate('/auth', { replace: true });
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} />
      </div>
    );
  }

  // Les tuiles de stats ne montrent que les métiers réellement exercés : un
  // videur n'a pas à voir une ligne « boissons servies : 0 » toute la nuit.
  const roles = identity?.roles ?? [];
  const statTiles: { key: string; icon: typeof ScanLine; label: string; tonight: number; total: number }[] = [];
  if (stats) {
    if (roles.includes('bouncer') || roles.includes('manager') || stats.scans_total > 0) {
      statTiles.push({ key: 'scans', icon: ScanLine, label: t('staffme.stat.scans'), tonight: stats.scans_tonight, total: stats.scans_total });
    }
    if (roles.includes('barman') || stats.orders_total > 0) {
      statTiles.push({ key: 'orders', icon: Wine, label: t('staffme.stat.orders'), tonight: stats.orders_tonight, total: stats.orders_total });
    }
    if (roles.includes('cloakroom') || stats.cloakroom_total > 0) {
      statTiles.push({ key: 'cloak', icon: Shirt, label: t('staffme.stat.cloakroom'), tonight: stats.cloakroom_tonight, total: stats.cloakroom_total });
    }
    if (roles.includes('vip_host') || stats.vip_items_total > 0) {
      statTiles.push({ key: 'vip', icon: Crown, label: t('staffme.stat.vip'), tonight: stats.vip_items_tonight, total: stats.vip_items_total });
    }
  }

  return (
    <div className="min-h-screen" style={{ background: '#000', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}>
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{ background: `radial-gradient(120% 60% at 50% -10%, ${tokens.glow}, transparent 55%)` }}
      />

      <header
        className="sticky top-0 z-40 backdrop-blur-xl"
        style={{ background: 'rgba(10,10,12,0.72)', borderBottom: `1px solid ${BORDER}`, paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-2 px-3">
          <div className="flex min-w-0 items-center gap-2">
            <ProBackButton className="h-11 w-11 flex-none sm:h-9 sm:w-9" />
            <h1 className="truncate" style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
              {t('staffme.title')}
            </h1>
          </div>
          <LanguageSelector />
        </div>
      </header>

      <PublicPage variant="flow">
        <div className="relative z-10 mx-auto max-w-3xl space-y-4 px-3 py-4">

          {/* ── Carte d'identité ─────────────────────────────────────────── */}
          <Card>
            <div className="flex items-center gap-3.5">
              <div className="relative flex-none">
                <div
                  className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl"
                  style={{ background: tokens.soft, border: `1px solid ${tokens.ring}` }}
                >
                  {identity?.avatarUrl ? (
                    <img src={identity.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : emoji ? (
                    <span style={{ fontSize: 30, lineHeight: 1 }}>{emoji}</span>
                  ) : previewName ? (
                    <span style={{ color: tokens.solid, fontSize: 20, fontWeight: 700 }}>{staffInitials(previewName)}</span>
                  ) : RoleIcon ? (
                    <RoleIcon className="h-6 w-6" style={{ color: tokens.solid }} />
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full transition-transform active:scale-95"
                  style={{ background: tokens.solid, color: '#000' }}
                  aria-label={t('staffme.changePhoto')}
                >
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleAvatarPick(file);
                    e.target.value = '';
                  }}
                />
              </div>

              <div className="min-w-0 flex-1">
                <p style={{ color: T3, fontSize: 11 }}>{t(greetingKey())}</p>
                <p className="truncate" style={{ color: T1, fontSize: 19, fontWeight: 650, letterSpacing: '-0.02em' }}>
                  {previewName || t('staffme.noName')}
                </p>
                <p className="truncate" style={{ color: T2, fontSize: 12, marginTop: 2 }}>
                  {[title.trim() || (roleDef ? t(roleDef.labelKey) : null), identity?.venueName].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>

            {identity?.staffAvatarUrl && (
              <button
                type="button"
                onClick={handleAvatarRemove}
                disabled={uploading}
                className="mt-3 flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-white/[0.04]"
                style={{ color: T3, fontSize: 11 }}
              >
                <Trash2 className="h-3 w-3" />
                {t('staffme.removePhoto')}
              </button>
            )}

            {identity?.since && (
              <div className="mt-3 flex items-center gap-1.5 border-t pt-3" style={{ borderColor: BORDER }}>
                <CalendarDays className="h-3.5 w-3.5" style={{ color: T3 }} />
                <span style={{ color: T3, fontSize: 11.5 }}>
                  {t('staffme.memberSince').replace('{date}', new Date(identity.since).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}
                </span>
              </div>
            )}
          </Card>

          {/* ── Personnalisation ─────────────────────────────────────────── */}
          <Card>
            <SectionTitle icon={Sparkles}>{t('staffme.section.identity')}</SectionTitle>

            <label className="mb-1 block" style={{ color: T2, fontSize: 12 }}>{t('staffme.field.name')}</label>
            <input
              value={displayName}
              onChange={(e) => markDirty(setDisplayName)(e.target.value.slice(0, 40))}
              placeholder={identity?.firstName ?? t('staffme.field.namePlaceholder')}
              className="mb-1 w-full rounded-xl px-3 py-2.5 outline-none transition-colors"
              style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1, fontSize: 14 }}
            />
            <p className="mb-4" style={{ color: T3, fontSize: 10.5 }}>{t('staffme.field.nameHint')}</p>

            <label className="mb-1 block" style={{ color: T2, fontSize: 12 }}>{t('staffme.field.title')}</label>
            <input
              value={title}
              onChange={(e) => markDirty(setTitle)(e.target.value.slice(0, 40))}
              placeholder={roleDef ? t(roleDef.labelKey) : ''}
              className="mb-1 w-full rounded-xl px-3 py-2.5 outline-none transition-colors"
              style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1, fontSize: 14 }}
            />
            <p className="mb-4" style={{ color: T3, fontSize: 10.5 }}>{t('staffme.field.titleHint')}</p>

            <label className="mb-2 block" style={{ color: T2, fontSize: 12 }}>{t('staffme.field.emoji')}</label>
            <div className="mb-4 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => markDirty(setEmoji)(null)}
                className="flex h-9 w-9 items-center justify-center rounded-xl transition-transform active:scale-95"
                style={{
                  background: emoji === null ? tokens.soft : C_FAINT,
                  border: `1px solid ${emoji === null ? tokens.ring : BORDER}`,
                  color: T3, fontSize: 11, fontWeight: 600,
                }}
                aria-label={t('staffme.emojiNone')}
              >
                {previewName ? staffInitials(previewName) : '—'}
              </button>
              {STAFF_EMOJI_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => markDirty(setEmoji)(choice)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl transition-transform active:scale-95"
                  style={{
                    background: emoji === choice ? tokens.soft : C_FAINT,
                    border: `1px solid ${emoji === choice ? tokens.ring : BORDER}`,
                    fontSize: 17, lineHeight: 1,
                  }}
                >
                  {choice}
                </button>
              ))}
            </div>

            <label className="mb-2 block" style={{ color: T2, fontSize: 12 }}>{t('staffme.field.accent')}</label>
            <div className="flex flex-wrap gap-2">
              {STAFF_ACCENTS.map((key) => {
                const tk = accentTokens(key, identity?.role ?? null);
                const selected = (accent ?? (identity?.role ? STAFF_ROLE_DEFS[identity.role].defaultAccent : 'red')) === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => markDirty(setAccent)(key as StaffAccent)}
                    className="flex h-9 w-9 items-center justify-center rounded-full transition-transform active:scale-95"
                    style={{ background: tk.soft, border: `1.5px solid ${selected ? tk.solid : 'transparent'}` }}
                    aria-label={key}
                  >
                    <span className="h-4 w-4 rounded-full" style={{ background: tk.solid }} />
                  </button>
                );
              })}
            </div>

            <motion.button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving}
              animate={{ opacity: dirty ? 1 : 0.4 }}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 font-semibold transition-transform active:scale-[0.99]"
              style={{ background: dirty ? tokens.solid : C_FAINT, color: dirty ? '#000' : T3, fontSize: 14 }}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {t('staffme.save')}
            </motion.button>
          </Card>

          {/* ── Mes chiffres ─────────────────────────────────────────────── */}
          {statTiles.length > 0 && (
            <Card>
              <SectionTitle icon={ScanLine}>{t('staffme.section.stats')}</SectionTitle>
              <div className="grid grid-cols-2 gap-2">
                {statTiles.map(({ key, icon: Icon, label, tonight, total }) => (
                  <div key={key} className="rounded-xl p-3" style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5" style={{ color: tokens.solid }} />
                      <span className="truncate" style={{ color: T3, fontSize: 10.5 }}>{label}</span>
                    </div>
                    <p className="tabular-nums" style={{ color: T1, fontSize: 22, fontWeight: 650, lineHeight: 1.1 }}>
                      {tonight}
                    </p>
                    <p style={{ color: T3, fontSize: 10 }}>
                      {t('staffme.stat.tonight')} · {total} {t('staffme.stat.over30d')}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex items-center justify-between border-t pt-3" style={{ borderColor: BORDER }}>
                <span style={{ color: T3, fontSize: 11.5 }}>{t('staffme.stat.nights')}</span>
                <span className="tabular-nums" style={{ color: T1, fontSize: 14, fontWeight: 600 }}>
                  {stats?.nights_worked ?? 0}
                </span>
              </div>
              {(stats?.vip_upsell_total ?? 0) > 0 && (
                <div className="mt-2 flex items-center justify-between">
                  <span style={{ color: T3, fontSize: 11.5 }}>{t('staffme.stat.upsell')}</span>
                  <span className="tabular-nums" style={{ color: tokens.solid, fontSize: 14, fontWeight: 600 }}>
                    {Math.round(stats!.vip_upsell_total)} €
                  </span>
                </div>
              )}
            </Card>
          )}

          {/* ── L'équipe ─────────────────────────────────────────────────── */}
          {team.length > 1 && (
            <Card>
              <SectionTitle icon={Users}>{t('staffme.section.team')}</SectionTitle>
              <div className="space-y-2">
                {team.map((mate) => {
                  const mateRoleKeys = mate.roles.filter(isStaffRole);
                  const mateTokens = accentTokens(mate.accent, primaryStaffRole(mate.roles));
                  const mateName = mate.display_name ?? '';
                  const mateRoles = mateRoleKeys.map((r) => t(STAFF_ROLE_DEFS[r].labelKey)).join(' · ');
                  return (
                    <div key={mate.user_id} className="flex items-center gap-2.5">
                      <div
                        className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-xl"
                        style={{ background: mateTokens.soft, border: `1px solid ${mateTokens.ring}` }}
                      >
                        {mate.avatar_url ? (
                          <img src={mate.avatar_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : mate.emoji ? (
                          <span style={{ fontSize: 16, lineHeight: 1 }}>{mate.emoji}</span>
                        ) : (
                          <span style={{ color: mateTokens.solid, fontSize: 11, fontWeight: 700 }}>
                            {staffInitials(mateName)}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 550 }}>
                          {mateName}
                          {mate.is_me && (
                            <span style={{ color: T3, fontWeight: 400 }}> · {t('staffme.you')}</span>
                          )}
                        </p>
                        <p className="truncate" style={{ color: T3, fontSize: 10.5 }}>
                          {mate.title?.trim() || mateRoles}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* ── Compte ───────────────────────────────────────────────────── */}
          <Card>
            <SectionTitle icon={KeyRound}>{t('staffme.section.account')}</SectionTitle>
            <button
              type="button"
              onClick={() => navigate('/setup-pin')}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-3 transition-colors hover:bg-white/[0.03]"
              style={{ border: `1px solid ${BORDER}` }}
            >
              <KeyRound className="h-4 w-4 flex-none" style={{ color: T2 }} />
              <span className="flex-1 text-left" style={{ color: T1, fontSize: 13.5 }}>{t('staffme.changePin')}</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="mt-2 flex w-full items-center gap-2.5 rounded-xl px-3 py-3 transition-colors hover:bg-white/[0.03]"
              style={{ border: `1px solid ${BORDER}` }}
            >
              <LogOut className="h-4 w-4 flex-none" style={{ color: '#E8192C' }} />
              <span className="flex-1 text-left" style={{ color: '#E8192C', fontSize: 13.5 }}>{t('staffme.logout')}</span>
            </button>
            {identity?.email && (
              <p className="mt-3 truncate text-center" style={{ color: T3, fontSize: 10.5 }}>{identity.email}</p>
            )}
          </Card>
        </div>
      </PublicPage>
    </div>
  );
}
