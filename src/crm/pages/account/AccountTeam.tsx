/**
 * Compte › Équipe et accès : les membres de l'espace et leur rôle, les
 * invitations en attente, la matrice des droits, et le volet « Inviter ».
 * Les droits viennent du serveur (crm_team_get.can_manage) : un lecteur ou un
 * éditeur voit l'équipe sans aucun bouton. L'équipe d'un club se gère depuis
 * le club (gérants, manager_permissions) : ici, lecture seule.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Modal, Sheet, Skel } from '@/crm/ui/kit';
import { EASE, SPRING } from '@/crm/ui/motion';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { useTeam, useTeamActions, type CrmRole, type TeamInvite, type TeamMember } from '@/crm/data/account';
import { Card, HeadCta } from './accountUi';

type InvRole = Exclude<CrmRole, 'owner'>;
const ORDER: CrmRole[] = ['owner', 'admin', 'editor', 'viewer'];
const PICKABLE: InvRole[] = ['admin', 'editor', 'viewer'];
/** Droits par rôle, dans l'ordre de ORDER — miroir de crmCaps et des portes serveur. */
const CAPS: [string, [boolean, boolean, boolean, boolean]][] = [
  ['yc.acc.cap.money', [true, true, false, false]],
  ['yc.acc.cap.read', [true, true, true, true]],
  ['yc.acc.cap.send', [true, true, true, false]],
  ['yc.acc.cap.yunits', [true, true, true, false]],
  ['yc.acc.cap.import', [true, true, true, false]],
  ['yc.acc.cap.team', [true, true, false, false]],
  ['yc.acc.cap.billing', [true, false, false, false]],
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}

function errCode(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? '');
  return m.includes('support_session') ? 'support' : 'err';
}

/** « à l'instant », « aujourd'hui à 18:38 », « hier à 23:12 », « il y a 6 j », « le 3 oct. ». */
function useWhen() {
  const { t, time, dShort } = useCrmT();
  return (iso: string | null): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    const ms = Date.now() - d.getTime();
    if (ms < 5 * 60_000) return t('yc.acc.w.now');
    const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((day(new Date()) - day(d)) / 86_400_000);
    if (days <= 0) return t('yc.acc.w.today', { time: time(d) });
    if (days === 1) return t('yc.acc.w.yesterday', { time: time(d) });
    if (days < 14) return t('yc.acc.w.days', { n: days });
    return t('yc.acc.w.date', { date: dShort(d) });
  };
}

export function AccountTeam({ setHeadAction }: { setHeadAction: (n: ReactNode) => void }) {
  const { t } = useCrmT();
  const q = useTeam();
  const [inviteOpen, setInviteOpen] = useState(false);
  const canManage = !!q.data?.can_manage;

  useEffect(() => {
    setHeadAction(canManage ? <HeadCta label={t('yc.acc.t.invite')} onClick={() => setInviteOpen(true)} /> : null);
    return () => setHeadAction(null);
  }, [canManage, setHeadAction, t]);

  if (q.isLoading || !q.data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Skel h={340} r={28} />
        <Skel h={72} r={28} />
      </div>
    );
  }
  return <TeamView data={q.data} canManage={canManage} inviteOpen={inviteOpen} setInviteOpen={setInviteOpen} />;
}

function TeamView({ data, canManage, inviteOpen, setInviteOpen }: { data: NonNullable<ReturnType<typeof useTeam>['data']>; canManage: boolean; inviteOpen: boolean; setInviteOpen: (v: boolean) => void }) {
  const { t, tp } = useCrmT();
  const { space } = useCrmScope();
  const toast = useCrmToast();
  const when = useWhen();
  const { setRole, remove, invite } = useTeamActions();
  const [pop, setPop] = useState<string | null>(null);
  const [hl, setHl] = useState<string | null>(null);
  const [rm, setRm] = useState<TeamMember | null>(null);
  const [matrix, setMatrix] = useState(false);
  const hlTimer = useRef<number>();
  const flashRow = (id: string) => { setHl(id); window.clearTimeout(hlTimer.current); hlTimer.current = window.setTimeout(() => setHl(null), 1800); };
  useEffect(() => () => window.clearTimeout(hlTimer.current), []);

  const nameOf = (m: TeamMember) => m.name || m.email || '—';
  const firstOf = (m: TeamMember) => (m.name || m.email || '').split(/[\s@]/)[0];

  const pickRole = async (m: TeamMember, role: InvRole) => {
    setPop(null);
    if (m.role === role) return;
    try {
      await setRole.mutateAsync({ memberId: m.id, role });
      flashRow(m.id);
      toast(t('yc.acc.t.roleSet', { name: firstOf(m), role: t(`yc.acc.role.${role}`).toLowerCase() }));
    } catch (e) {
      toast(t(errCode(e) === 'support' ? 'yc.acc.t.support' : 'yc.acc.t.err'));
    }
  };
  const doRemove = async () => {
    if (!rm) return;
    const m = rm;
    try {
      await remove.mutateAsync(m.id);
      setRm(null);
      toast(t('yc.acc.t.removed', { name: firstOf(m) }));
    } catch (e) {
      setRm(null);
      toast(t(errCode(e) === 'support' ? 'yc.acc.t.support' : 'yc.acc.t.err'));
    }
  };
  const resend = async (v: TeamInvite) => {
    const code = await invite.mutateAsync({ email: v.email, role: v.role as InvRole, resend: true }).catch(() => 'error');
    if (code) toast(t(code === 'demo_invite_real' ? 'yc.acc.i.demo' : 'yc.acc.i.err'));
    else { flashRow(v.id); toast(t('yc.acc.t.resent', { email: v.email })); }
  };
  const cancelInv = async (v: TeamInvite) => {
    try {
      await remove.mutateAsync(v.id);
      toast(t('yc.acc.t.canceled'));
    } catch (e) {
      toast(t(errCode(e) === 'support' ? 'yc.acc.t.support' : 'yc.acc.t.err'));
    }
  };

  const taken = useMemo(() => new Set([...data.members.map((m) => (m.email ?? '').toLowerCase()), ...data.invites.map((v) => v.email.toLowerCase())]), [data]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {pop && <div onClick={() => setPop(null)} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />}
      <Card gap={8} style={{ position: 'relative', zIndex: pop ? 30 : 'auto', animation: `yc-rise 700ms ${EASE} 40ms both` }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px' }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.acc.t.members')}</h2>
          <span style={{ fontSize: 14, color: 'var(--sand-500)', fontVariantNumeric: 'tabular-nums' }}>{tp('yc.acc.t.count', data.members.length)}</span>
        </div>
        {!canManage && (
          <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-500)' }}>{t(data.kind === 'venue' ? 'yc.acc.t.venueNote' : 'yc.acc.t.readOnly')}</span>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 6 }}>
          {data.members.map((m, i) => {
            const rOpen = pop === `role:${m.id}`;
            const mOpen = pop === `more:${m.id}`;
            const editable = canManage && m.role !== 'owner' && !m.you;
            const seen = m.you ? t('yc.acc.t.online') : m.last_seen_at ? t('yc.acc.t.seen', { when: when(m.last_seen_at) }) : t('yc.acc.t.never');
            return (
              <Hv
                key={m.id}
                style={{ position: 'relative', zIndex: rOpen || mOpen ? 24 : 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', padding: '14px 12px', margin: '0 -12px', borderRadius: 16, background: hl === m.id ? 'var(--green-50)' : 'transparent', transition: 'background 700ms ease', animation: `yc-rise 560ms ${EASE} ${i * 70}ms both` }}
                hover={{ background: hl === m.id ? 'var(--green-50)' : 'var(--sand-50)' }}
              >
                <div style={{ flex: '1 1 230px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span style={{ position: 'relative', flex: 'none', width: 44, height: 44, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-700)', display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 600 }}>
                    {m.avatar_url ? <img src={m.avatar_url} alt="" style={{ width: 44, height: 44, borderRadius: 99, objectFit: 'cover', display: 'block' }} /> : initials(nameOf(m))}
                    {m.you && <span style={{ position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 99, background: 'var(--green-500)', border: '2px solid #fff' }} />}
                  </span>
                  <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(m)}</span>
                      {m.you && <span style={{ flex: 'none', height: 20, padding: '0 8px', borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{t('yc.acc.t.you')}</span>}
                    </span>
                    {m.email && m.name && <span style={{ fontSize: 13.5, color: 'var(--sand-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</span>}
                  </span>
                </div>
                <span style={{ flex: 'none', fontSize: 13, color: m.you ? 'var(--green-700)' : 'var(--sand-500)', minWidth: 112 }}>{seen}</span>
                <div style={{ position: 'relative', flex: 'none' }}>
                  {editable ? (
                    <Hv
                      as="button"
                      type="button"
                      onClick={() => setPop(rOpen ? null : `role:${m.id}`)}
                      aria-haspopup="listbox"
                      aria-expanded={rOpen}
                      style={{ height: 38, minWidth: 158, padding: '0 12px 0 16px', borderRadius: 99, border: `1px solid ${rOpen ? 'var(--ink)' : 'var(--sand-200)'}`, background: '#fff', fontSize: 14, fontWeight: 600, color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer', transition: `border-color 140ms,transform 200ms ${SPRING}` }}
                      hover={{ borderColor: rOpen ? 'var(--ink)' : 'var(--sand-300)' }}
                      active={{ transform: 'scale(.97)' }}
                    >
                      {t(`yc.acc.role.${m.role}`)}
                      <Icon name="chevronDown" size={15} stroke={2.4} style={{ color: 'var(--sand-500)', transform: `rotate(${rOpen ? 180 : 0}deg)`, transition: `transform 320ms ${EASE}` }} />
                    </Hv>
                  ) : (
                    <span title={m.role === 'owner' ? t('yc.acc.t.ownerLock') : undefined} style={{ height: 38, minWidth: 158, padding: '0 14px 0 16px', boxSizing: 'border-box', borderRadius: 99, background: 'var(--sand-50)', color: 'var(--sand-600)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      {t(`yc.acc.role.${m.role}`)}
                      {m.role === 'owner' && <Icon name="lock" size={14} stroke={2.2} />}
                    </span>
                  )}
                  {rOpen && (
                    <div role="listbox" style={{ position: 'absolute', top: 46, right: 0, zIndex: 25, width: 'min(320px,calc(100vw - 48px))', boxSizing: 'border-box', padding: 6, borderRadius: 18, background: '#fff', boxShadow: 'var(--shadow-md),0 0 0 1px var(--sand-200)', transformOrigin: 'top right', animation: `yc-pop 220ms ${EASE} both` }}>
                      {PICKABLE.map((k) => {
                        const on = m.role === k;
                        return (
                          <Hv key={k} as="button" type="button" role="option" aria-selected={on} onClick={() => void pickRole(m, k)} style={{ width: '100%', padding: '10px 12px', border: 0, borderRadius: 12, background: on ? 'var(--sand-50)' : 'transparent', display: 'flex', alignItems: 'flex-start', gap: 12, textAlign: 'left', cursor: 'pointer', transition: 'background 140ms' }} hover={{ background: 'var(--sand-50)' }}>
                            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>{t(`yc.acc.role.${k}`)}</span>
                              <span style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--sand-500)' }}>{t(`yc.acc.role.${k}D`)}</span>
                            </span>
                            {on && <Icon name="check" size={16} stroke={2.6} style={{ flex: 'none', marginTop: 2, color: 'var(--red-500)' }} />}
                          </Hv>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div style={{ position: 'relative', flex: 'none', width: 38 }}>
                  {editable && (
                    <Hv as="button" type="button" onClick={() => setPop(mOpen ? null : `more:${m.id}`)} aria-label={t('yc.acc.t.more')} aria-haspopup="menu" style={{ width: 38, height: 38, padding: 0, border: 0, borderRadius: 99, background: 'none', color: 'var(--sand-500)', display: 'grid', placeItems: 'center', cursor: 'pointer', transition: 'background 140ms,color 140ms' }} hover={{ background: 'var(--sand-100)', color: 'var(--ink)' }}>
                      <Icon name="more" size={18} stroke={2.2} />
                    </Hv>
                  )}
                  {mOpen && (
                    <div role="menu" style={{ position: 'absolute', top: 46, right: 0, zIndex: 25, width: 230, boxSizing: 'border-box', padding: 6, borderRadius: 18, background: '#fff', boxShadow: 'var(--shadow-md),0 0 0 1px var(--sand-200)', transformOrigin: 'top right', animation: `yc-pop 220ms ${EASE} both` }}>
                      <Hv as="button" type="button" role="menuitem" onClick={() => { setPop(null); setRm(m); }} style={{ width: '100%', height: 42, padding: '0 12px', border: 0, borderRadius: 12, background: 'none', display: 'flex', alignItems: 'center', gap: 12, fontSize: 14.5, fontWeight: 500, color: 'var(--red-600)', cursor: 'pointer', textAlign: 'left' }} hover={{ background: 'var(--red-50)' }}>
                        <Icon d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 8l5 5M22 8l-5 5" size={17} stroke={2} />
                        {t('yc.acc.t.remove')}
                      </Hv>
                    </div>
                  )}
                </div>
              </Hv>
            );
          })}
        </div>
      </Card>

      {data.invites.length > 0 && (
        <Card gap={8} style={{ animation: `yc-rise 700ms ${EASE} 130ms both` }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px' }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.acc.t.pending')}</h2>
            <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{tp('yc.acc.t.invCount', data.invites.length)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 6 }}>
            {data.invites.map((v, i) => (
              <Hv key={v.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', padding: '14px 12px', margin: '0 -12px', borderRadius: 16, background: hl === v.id || hl === v.email ? 'var(--green-50)' : 'transparent', transition: 'background 700ms ease', animation: `yc-rise 560ms ${EASE} ${i * 70}ms both` }} hover={{ background: hl === v.id || hl === v.email ? 'var(--green-50)' : 'var(--sand-50)' }}>
                <span style={{ flex: 'none', width: 44, height: 44, boxSizing: 'border-box', borderRadius: 99, border: '1.5px dashed var(--sand-300)', color: 'var(--sand-500)', display: 'grid', placeItems: 'center' }}><Icon name="mail" size={18} stroke={2} /></span>
                <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.email}</span>
                  <span style={{ fontSize: 13.5, color: v.expired ? 'var(--amber-700)' : 'var(--sand-500)' }}>
                    {v.expired ? t('yc.acc.t.expired', { role: t(`yc.acc.role.${v.role}`) }) : t('yc.acc.t.invited', { role: t(`yc.acc.role.${v.role}`), when: when(v.created_at) })}
                  </span>
                </div>
                {canManage && (
                  <>
                    <Hv as="button" type="button" onClick={() => void resend(v)} disabled={invite.isPending} style={{ height: 36, padding: '0 14px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', transition: `border-color 140ms,transform 200ms ${SPRING}` }} hover={{ borderColor: 'var(--sand-300)' }} active={{ transform: 'scale(.97)' }}>{t('yc.acc.t.resend')}</Hv>
                    <Hv as="button" type="button" onClick={() => void cancelInv(v)} style={{ height: 36, padding: '0 12px', border: 0, borderRadius: 99, background: 'none', fontSize: 13.5, fontWeight: 600, color: 'var(--sand-600)', cursor: 'pointer' }} hover={{ color: 'var(--red-600)', background: 'var(--red-50)' }}>{t('yc.acc.t.cancelInv')}</Hv>
                  </>
                )}
              </Hv>
            ))}
          </div>
        </Card>
      )}

      <Card gap={0} style={{ padding: 'clamp(8px,1vw,12px) clamp(20px,2.4vw,32px)', animation: `yc-rise 700ms ${EASE} 220ms both` }}>
        <button type="button" onClick={() => setMatrix((x) => !x)} aria-expanded={matrix} style={{ width: '100%', minHeight: 64, padding: 0, border: 0, background: 'none', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', textAlign: 'left' }}>
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 19, letterSpacing: '-.02em', color: 'var(--ink)' }}>{t('yc.acc.t.matrix')}</span>
            <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{t('yc.acc.t.matrixS')}</span>
          </span>
          <span style={{ flex: 'none', width: 36, height: 36, borderRadius: 99, background: 'var(--sand-50)', color: 'var(--ink)', display: 'grid', placeItems: 'center' }}>
            <Icon name="chevronDown" size={16} stroke={2.4} style={{ transform: `rotate(${matrix ? 180 : 0}deg)`, transition: `transform 320ms ${EASE}` }} />
          </span>
        </button>
        <div style={{ display: 'grid', gridTemplateRows: matrix ? '1fr' : '0fr', opacity: matrix ? 1 : 0, transition: `grid-template-rows 480ms ${EASE},opacity 320ms ease` }}>
          <div style={{ overflow: 'hidden', minHeight: 0 }}>
            <div className="yc-noscroll" style={{ overflowX: 'auto', padding: '4px 0 20px' }}>
              <div style={{ minWidth: 560, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,1.7fr) repeat(4,minmax(0,1fr))', gap: 8, padding: '10px 0', borderTop: '1px solid var(--sand-100)' }}>
                  <span />
                  {ORDER.map((r) => <span key={r} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--sand-500)', textAlign: 'center' }}>{t(`yc.acc.role.${r}`)}</span>)}
                </div>
                {CAPS.map(([k, cells]) => (
                  <div key={k} style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,1.7fr) repeat(4,minmax(0,1fr))', gap: 8, alignItems: 'center', padding: '11px 0', borderTop: '1px solid var(--sand-100)' }}>
                    <span style={{ fontSize: 14, color: 'var(--sand-700)' }}>{t(k)}</span>
                    {cells.map((ok, j) => (
                      <span key={j} style={{ display: 'grid', placeItems: 'center' }}>
                        {ok ? <span style={{ width: 22, height: 22, borderRadius: 99, background: 'var(--green-50)', color: 'var(--green-700)', display: 'grid', placeItems: 'center' }}><Icon name="check" size={12} stroke={3} /></span> : <span style={{ width: 10, height: 2, borderRadius: 2, background: 'var(--sand-300)' }} />}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} spaceName={space.name} taken={taken} onSent={flashRow} />

      <Modal open={!!rm} onClose={() => setRm(null)} width={460} label={rm ? t('yc.acc.t.rmT', { name: firstOf(rm) }) : undefined} blur>
        {rm && (
          <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em', lineHeight: 1.1 }}>{t('yc.acc.t.rmT', { name: firstOf(rm) })}</h2>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.acc.t.rmB', { space: space.name })}</p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 }}>
              <Hv as="button" type="button" onClick={() => setRm(null)} style={{ height: 46, padding: '0 20px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', color: 'var(--ink)', transition: `transform 200ms ${SPRING}` }} hover={{ background: 'var(--paper)' }} active={{ transform: 'scale(.97)' }}>{t('yc.acc.t.keep')}</Hv>
              <Hv as="button" type="button" onClick={() => void doRemove()} disabled={remove.isPending} style={{ height: 46, padding: '0 22px', border: 0, borderRadius: 99, background: 'var(--red-500)', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, transition: `transform 200ms ${SPRING},filter 160ms` }} hover={{ filter: 'brightness(1.1)' }} active={{ transform: 'scale(.97)' }}>
                {remove.isPending && <span style={{ width: 14, height: 14, borderRadius: 99, border: '2.2px solid rgba(255,255,255,.35)', borderTopColor: '#fff', animation: 'yc-spin 700ms linear infinite' }} />}
                {t('yc.acc.t.rmBtn')}
              </Hv>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function InviteSheet({ open, onClose, spaceName, taken, onSent }: { open: boolean; onClose: () => void; spaceName: string; taken: Set<string>; onSent: (id: string) => void }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const { invite } = useTeamActions();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvRole>('editor');
  const [touched, setTouched] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setEmail(''); setRole('editor'); setTouched(false); setServerErr(null);
    const id = window.setTimeout(() => inputRef.current?.focus(), 420);
    return () => window.clearTimeout(id);
  }, [open]);

  const em = email.trim().toLowerCase();
  const emOk = EMAIL_RE.test(em);
  const dup = taken.has(em) || serverErr === 'dup';
  const bad = touched && !!em && (!emOk || dup);
  const busy = invite.isPending;
  const canSend = emOk && !dup && !busy;
  const ri = ORDER.indexOf(role);

  const send = async () => {
    if (!canSend) { setTouched(true); return; }
    const code = await invite.mutateAsync({ email: em, role }).catch(() => 'error');
    if (!code) {
      onClose();
      onSent(em);
      toast(t('yc.acc.i.sent', { email: em }));
      return;
    }
    if (code === 'already_member' || code === 'already_invited') { setServerErr('dup'); setTouched(true); return; }
    toast(t(code === 'demo_invite_real' ? 'yc.acc.i.demo' : 'yc.acc.i.err'));
  };

  return (
    <Sheet open={open} onClose={onClose} width={480} label={t('yc.acc.i.t', { space: spaceName })}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '28px 28px 8px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em', lineHeight: 1.1 }}>{t('yc.acc.i.t', { space: spaceName })}</h2>
            <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--sand-500)' }}>{t('yc.acc.i.s')}</span>
          </div>
          <Hv as="button" type="button" onClick={onClose} aria-label={t('yc.acc.close')} style={{ flex: 'none', width: 40, height: 40, border: 0, borderRadius: 99, background: 'var(--sand-50)', color: 'var(--sand-600)', cursor: 'pointer', display: 'grid', placeItems: 'center', transition: `background 140ms,transform 200ms ${SPRING}` }} hover={{ background: 'var(--sand-100)' }} active={{ transform: 'scale(.92)' }}>
            <Icon name="x" size={16} stroke={2.4} />
          </Hv>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 28px 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sand-700)' }}>{t('yc.acc.i.email')}</span>
            <input
              ref={inputRef}
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setTouched(true); setServerErr(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
              autoComplete="off"
              placeholder={t('yc.acc.i.ph')}
              className="yc-field"
              style={{ width: '100%', height: 50, boxSizing: 'border-box', padding: '0 14px', borderRadius: 12, border: `1px solid ${bad ? 'var(--red-400)' : 'var(--sand-200)'}`, boxShadow: bad ? '0 0 0 3px var(--red-100)' : 'none', background: '#fff', fontSize: 15, color: 'var(--ink)', outline: 0, transition: 'border-color 160ms,box-shadow 160ms' }}
            />
            <span style={{ fontSize: 12.5, color: bad ? 'var(--red-600)' : 'var(--sand-500)' }}>{bad ? t(dup ? 'yc.acc.i.dup' : 'yc.acc.i.bad') : t('yc.acc.i.hint')}</span>
          </label>
          <div role="radiogroup" aria-label={t('yc.acc.i.role')} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sand-700)' }}>{t('yc.acc.i.role')}</span>
            {PICKABLE.map((k) => {
              const on = role === k;
              return (
                <Hv key={k} as="button" type="button" role="radio" aria-checked={on} onClick={() => setRole(k)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', border: 0, borderRadius: 16, background: on ? '#fff' : 'transparent', boxShadow: on ? 'inset 0 0 0 2px var(--ink)' : 'inset 0 0 0 1px var(--sand-200)', textAlign: 'left', cursor: 'pointer', transition: `box-shadow 200ms,background 200ms,transform 200ms ${SPRING}` }} hover={{ background: on ? '#fff' : 'var(--sand-50)' }} active={{ transform: 'scale(.99)' }}>
                  <span style={{ flex: 'none', width: 20, height: 20, borderRadius: 99, boxSizing: 'border-box', border: `2px solid ${on ? 'var(--ink)' : 'var(--sand-300)'}`, display: 'grid', placeItems: 'center', transition: 'border-color 200ms' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 99, background: 'var(--ink)', transform: `scale(${on ? 1 : 0})`, transition: `transform 280ms ${SPRING}` }} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{t(`yc.acc.role.${k}`)}</span>
                    <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-500)' }}>{t(`yc.acc.role.${k}D`)}</span>
                  </span>
                </Hv>
              );
            })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 16px', borderRadius: 16, background: 'var(--sand-50)' }}>
            {CAPS.map(([k, cells]) => {
              const ok = cells[ri];
              return (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', fontSize: 14, color: ok ? 'var(--ink)' : 'var(--sand-400)', transition: 'color 240ms' }}>
                  <span style={{ flex: 'none', width: 20, height: 20, borderRadius: 99, display: 'grid', placeItems: 'center', background: ok ? 'var(--green-50)' : 'transparent', color: ok ? 'var(--green-700)' : 'var(--sand-300)', transition: 'background 240ms,color 240ms' }}>
                    {ok ? <Icon name="check" size={11} stroke={3.2} /> : <span style={{ width: 8, height: 2, borderRadius: 2, background: 'currentColor' }} />}
                  </span>
                  {t(k)}
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '16px 28px', borderTop: '1px solid var(--sand-100)', background: 'var(--sand-50)' }}>
          <Hv as="button" type="button" onClick={onClose} style={{ height: 46, padding: '0 20px', border: 0, borderRadius: 99, background: 'none', fontSize: 15, fontWeight: 600, color: 'var(--sand-700)', cursor: 'pointer' }} hover={{ background: 'var(--sand-100)' }}>{t('yc.acc.cancel')}</Hv>
          <Hv
            as="button"
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            style={{ height: 48, padding: '0 6px 0 22px', border: 0, borderRadius: 99, background: canSend || busy ? 'var(--gradient-brand)' : 'var(--sand-100)', color: canSend || busy ? '#fff' : 'var(--sand-500)', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10, boxShadow: canSend || busy ? 'var(--shadow-cta)' : 'none', cursor: canSend ? 'pointer' : 'not-allowed', transition: `transform 200ms ${SPRING},filter 160ms,background 200ms` }}
            hover={canSend ? { filter: 'brightness(1.05)', transform: 'translateY(-1px)' } : {}}
            active={canSend ? { transform: 'scale(.97)' } : {}}
          >
            {t(busy ? 'yc.acc.i.sending' : 'yc.acc.i.send')}
            <span style={{ width: 36, height: 36, borderRadius: 99, background: canSend || busy ? '#fff' : 'var(--sand-200)', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}>
              {busy ? <span style={{ width: 16, height: 16, borderRadius: 99, border: '2.4px solid var(--red-200)', borderTopColor: 'var(--red-500)', animation: 'yc-spin 700ms linear infinite' }} /> : <Icon name="send" size={16} stroke={2.2} />}
            </span>
          </Hv>
        </div>
      </div>
    </Sheet>
  );
}
