/**
 * Fenêtre « Nouvelle automatisation » / « Modifier » / « Activer … » en trois
 * étapes, comme le prototype : Quand (le déclencheur, parmi les six recettes
 * d'un compte CRM), Quoi (le canal, le délai, l'objet), Vérifier (qui serait
 * concerné aujourd'hui, ce que ça coûte en Yunits, les garanties). Une recette
 * = un e-mail ; « Faire revenir après la 1re soirée » y ajoute un SMS, N jours
 * après l'e-mail, à qui n'a toujours pas de place (crm_automation_sms_save).
 */
import { useEffect } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Portal } from '@/crm/ui/kit';
import { EASE } from '@/crm/ui/motion';
import type { useCrmT } from '@/crm/i18n';
import type { Automations } from '@/crm/data/automations';
import { CRM_AUTO_KINDS, CRM_AUTO_META, FIRST_RETURN_SMS_DELAYS, autoState, quietSendAt, recipeHours } from '@/crm/lib/automations';
import { AU_IC, KIND_IC, chipLabel, startModal, type ModalState } from './autoFmt';
import { Flow } from './autoUi';

type T = ReturnType<typeof useCrmT>;

export function AutoModal({
  m, setM, d, T, balance, rate, smsRate, busy, onClose, onSave,
}: {
  m: ModalState; setM: (m: ModalState) => void; d: Automations; T: T; balance: number; rate: number; smsRate: number; busy: boolean;
  onClose: () => void; onSave: (m: ModalState) => void;
}) {
  const { t, tp, n } = T;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);

  const rec = d.recipes.find((x) => x.kind === m.kind);
  const st = rec ? autoState(rec) : 'none';
  const meta = CRM_AUTO_META[m.kind];
  const eligible = rec?.preview?.eligible ?? 0;
  const yu = eligible * rate;
  const left = balance - yu;
  const editing = m.mode === 'edit' || st === 'on';
  const title = m.mode === 'edit' ? t('yc.au.m.editTitle') : m.mode === 'reco' ? t('yc.au.m.recoTitle', { name: t(`yc.au.r.${m.kind}.name`) }) : t('yc.au.m.newTitle');
  const sub = t(`yc.au.m.sub${m.step}`);
  const placeholder = rec?.template_subject || t(`yc.em.tp.${meta.tpl}.subject`).replace('{{prénom}}', '…');
  const set = (patch: Partial<ModalState>) => setM({ ...m, ...patch });
  const fr = m.kind === 'first_return';
  const frDays = rec?.auto_delay_days ?? 21;
  const sms = m.sms;
  const setSms = (patch: Partial<NonNullable<ModalState['sms']>>) => sms && set({ sms: { ...sms, ...patch } });

  return (
    <Portal>
      <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center', padding: 20, boxSizing: 'border-box' }}>
        <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(26,20,18,.42)', animation: 'yc-fade 200ms both' }} />
        <div role="dialog" aria-modal="true" aria-label={title} style={{ position: 'relative', width: 'min(820px,100%)', maxHeight: 'calc(100vh - 40px)', boxSizing: 'border-box', borderRadius: 28, background: '#fff', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: `yc-pop 260ms ${EASE} both` }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '26px 28px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em', lineHeight: 1.15 }}>{title}</h2>
                <div style={{ fontSize: 14.5, color: 'var(--sand-500)', marginTop: 4 }}>{sub}</div>
              </div>
              <Hv as="button" type="button" onClick={onClose} aria-label={t('yc.common.close')} style={{ flex: 'none', width: 36, height: 36, border: 0, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-200)' }}>
                <Icon d={AU_IC.x} size={16} stroke={2.4} />
              </Hv>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {([1, 2, 3] as const).map((s) => (
                <button key={s} type="button" onClick={() => set({ step: s })} style={{ flex: '1 1 0', display: 'flex', alignItems: 'center', gap: 10, padding: 0, border: 0, background: 'none', cursor: 'pointer', textAlign: 'left', color: m.step >= s ? 'var(--ink)' : 'var(--sand-500)', minWidth: 0 }}>
                  <span style={{ flex: 'none', width: 28, height: 28, borderRadius: 99, background: m.step === s ? 'var(--ink)' : m.step > s ? 'var(--green-500)' : 'var(--sand-200)', color: m.step >= s ? '#fff' : 'var(--sand-600)', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 600, transition: 'background 200ms' }}>
                    {m.step > s ? <Icon d={AU_IC.check} size={14} stroke={3} /> : s}
                  </span>
                  <span style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{t(`yc.au.m.st${s}`)}</span>
                  <span style={{ flex: 1, height: 2, borderRadius: 2, background: m.step > s ? 'var(--green-500)' : 'var(--sand-200)', minWidth: 8 }} />
                </button>
              ))}
            </div>
            <div style={{ padding: '14px 16px', borderRadius: 16, background: 'var(--sand-50)' }}>
              <Flow key={`${m.kind}-${m.delay}`} T={T} kind={m.kind} delay={fr && rec ? recipeHours(rec) ?? m.delay : m.delay} on={false} size="modal" />
            </div>
          </div>

          <div className="yc-thin-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '4px 28px 22px' }}>
            {m.step === 1 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,230px),1fr))', gap: 12, animation: `yc-slide-r 300ms ${EASE} both` }}>
                {CRM_AUTO_KINDS.map((k) => {
                  const on = m.kind === k;
                  const r = d.recipes.find((x) => x.kind === k);
                  const s = r ? autoState(r) : 'none';
                  return (
                    <Hv
                      key={k}
                      as="button"
                      type="button"
                      aria-pressed={on}
                      onClick={() => setM({ ...startModal(d, m.mode, k, m.step, t('yc.au.fr.smsDefault')), mode: m.mode })}
                      style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, padding: 18, borderRadius: 20, border: `1.5px solid ${on ? 'var(--red-300)' : 'var(--sand-200)'}`, background: on ? 'var(--red-50)' : '#fff', textAlign: 'left', cursor: 'pointer', color: 'var(--ink)', transition: `translate 220ms ${EASE},box-shadow 220ms,border-color 200ms` }}
                      hover={{ translate: '0 -3px', boxShadow: 'var(--shadow-md)' }}
                    >
                      <span style={{ width: 42, height: 42, borderRadius: 13, background: on ? '#fff' : 'var(--sand-100)', color: on ? 'var(--red-600)' : 'var(--sand-700)', display: 'grid', placeItems: 'center' }}><Icon d={KIND_IC[k]} size={19} stroke={2} /></span>
                      <b style={{ fontSize: 16, letterSpacing: '-.01em', lineHeight: '20px', paddingRight: 24 }}>{t(`yc.au.r.${k}.trig`)}</b>
                      <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-600)' }}>{t(`yc.au.r.${k}.trigS`)}</span>
                      {(s !== 'none' || CRM_AUTO_META[k].needsScan) && (
                        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {s !== 'none' && <span style={{ height: 22, padding: '0 9px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, background: s === 'on' ? 'var(--green-50)' : 'var(--sand-100)', color: s === 'on' ? 'var(--green-700)' : 'var(--sand-600)' }}>{t(s === 'on' ? 'yc.au.m.already' : 'yc.au.m.exists')}</span>}
                          {CRM_AUTO_META[k].needsScan && <span style={{ height: 22, padding: '0 9px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, background: 'var(--sand-100)', color: 'var(--sand-600)' }}>{t('yc.au.m.scan')}</span>}
                        </span>
                      )}
                      {on && <span style={{ position: 'absolute', top: 14, right: 14, width: 22, height: 22, borderRadius: 99, background: 'var(--red-500)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon d={AU_IC.check} size={13} stroke={3} /></span>}
                    </Hv>
                  );
                })}
              </div>
            )}
            {m.step === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, animation: `yc-slide-r 300ms ${EASE} both` }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 18px', borderRadius: 18, border: '1px solid var(--sand-200)', background: '#fff' }}>
                  <b style={{ fontSize: 15 }}>{t('yc.au.m.msg')} 1</b>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 24px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.au.m.by')}</span>
                      <div style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--sand-100)', borderRadius: 99 }}>
                        <span style={{ height: 34, padding: '0 16px', borderRadius: 99, background: '#fff', boxShadow: 'var(--shadow-xs)', fontSize: 14, fontWeight: 600, color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                          {t('yc.au.m.email')}<span style={{ fontSize: 12, fontWeight: 500, color: 'var(--sand-500)' }}>{tp('yc.au.m.cost', rate, { n: n(rate) })}</span>
                        </span>
                        {/* « 1re soirée » : le SMS est le message 2, juste en dessous. */}
                        {!fr && <span aria-disabled="true" title={t('yc.au.x.smsSoon')} style={{ height: 34, padding: '0 16px', borderRadius: 99, fontSize: 14, fontWeight: 600, color: 'var(--sand-400)', display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'not-allowed' }}>
                          {t('yc.au.m.sms')}<span style={{ height: 20, padding: '0 7px', borderRadius: 99, background: '#fff', fontSize: 11.5, fontWeight: 600, color: 'var(--sand-500)', display: 'inline-flex', alignItems: 'center' }}>{t('yc.au.m.soon')}</span>
                        </span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.au.m.when')}</span>
                      {fr ? (
                        <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--sand-700)', maxWidth: 360, textWrap: 'pretty' }}>
                          {tp('yc.au.fr.when', frDays, { n: n(frDays) })}
                        </span>
                      ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {meta.delays.map((h) => {
                          const on = m.delay === h;
                          return (
                            <Hv
                              key={h}
                              as="button"
                              type="button"
                              aria-pressed={on}
                              onClick={() => set({ delay: h })}
                              style={{ height: 36, padding: '0 13px', borderRadius: 99, border: `1.5px solid ${on ? 'var(--red-400)' : 'var(--sand-200)'}`, background: on ? 'var(--red-50)' : '#fff', color: on ? 'var(--red-700)' : 'var(--sand-700)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', transition: 'background 160ms,border-color 160ms', whiteSpace: 'nowrap' }}
                              hover={on ? {} : { borderColor: 'var(--sand-400)' }}
                            >
                              {chipLabel(T, m.kind, h)}
                            </Hv>
                          );
                        })}
                      </div>
                      )}
                    </div>
                  </div>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.au.m.subject')}</span>
                    <input
                      type="text"
                      className="yc-field"
                      value={m.subject}
                      maxLength={140}
                      onChange={(e) => set({ subject: e.target.value })}
                      placeholder={placeholder}
                      style={{ height: 46, boxSizing: 'border-box', padding: '0 14px', borderRadius: 12, border: '1.5px solid var(--sand-200)', background: '#fff', fontSize: 15, color: 'var(--ink)', outline: 'none' }}
                    />
                    <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.au.m.subjectHint')}</span>
                  </label>
                </div>
                {fr && sms ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 18px', borderRadius: 18, border: '1px solid var(--sand-200)', background: '#fff' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <b style={{ fontSize: 15 }}>{t('yc.au.m.msg')} 2 · {t('yc.au.m.sms')}</b>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                        <input type="checkbox" checked={sms.on} onChange={(e) => setSms({ on: e.target.checked })} style={{ width: 18, height: 18, accentColor: 'var(--red-500)' }} />
                        {t(sms.on ? 'yc.au.fr.smsOn' : 'yc.au.fr.smsOff')}
                      </label>
                    </div>
                    <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.au.fr.smsWho')}</span>
                    {sms.on && (
                      <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.au.m.when')}</span>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {FIRST_RETURN_SMS_DELAYS.map((dd) => {
                              const on = sms.delay === dd;
                              return (
                                <Hv
                                  key={dd}
                                  as="button"
                                  type="button"
                                  aria-pressed={on}
                                  onClick={() => setSms({ delay: dd })}
                                  style={{ height: 36, padding: '0 13px', borderRadius: 99, border: `1.5px solid ${on ? 'var(--red-400)' : 'var(--sand-200)'}`, background: on ? 'var(--red-50)' : '#fff', color: on ? 'var(--red-700)' : 'var(--sand-700)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                                  hover={on ? {} : { borderColor: 'var(--sand-400)' }}
                                >
                                  {tp('yc.au.fr.smsAfter', dd, { n: n(dd) })}
                                </Hv>
                              );
                            })}
                          </div>
                        </div>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.au.fr.smsText')}</span>
                          <textarea
                            className="yc-field"
                            value={sms.body}
                            maxLength={480}
                            rows={3}
                            onChange={(e) => setSms({ body: e.target.value })}
                            style={{ boxSizing: 'border-box', padding: '12px 14px', borderRadius: 12, border: '1.5px solid var(--sand-200)', background: '#fff', fontSize: 15, lineHeight: 1.45, color: 'var(--ink)', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
                          />
                          <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.au.fr.smsHint', { n: n(smsRate) })}</span>
                        </label>
                        {rec?.sms && !rec.sms.identity_ok && (
                          <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--amber-700)' }}>{t('yc.au.fr.identity')}</span>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div style={{ height: 46, borderRadius: 16, border: '1.5px dashed var(--sand-300)', color: 'var(--sand-500)', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '0 14px', textAlign: 'center' }}>
                    <Icon d={AU_IC.plus} size={15} stroke={2.2} />{t('yc.au.m.more')}
                  </div>
                )}
              </div>
            )}
            {m.step === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: `yc-slide-r 300ms ${EASE} both` }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,230px),1fr))', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '16px 18px', borderRadius: 18, background: 'var(--sand-50)' }}>
                    <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.au.m.est')}</span>
                    <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, letterSpacing: '-.03em' }}>{n(eligible)}</b>
                    <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>
                      {eligible === 0 && rec?.preview?.next_due_at
                        ? t('yc.au.m.estNext', { d: T.dWeek(quietSendAt(rec.preview.next_due_at)) })
                        : t('yc.au.m.estS')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '16px 18px', borderRadius: 18, background: 'var(--sand-50)' }}>
                    <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.au.m.yu')}</span>
                    <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, letterSpacing: '-.03em' }}>{n(yu)}</b>
                    <span style={{ fontSize: 13, color: left < 0 ? 'var(--amber-700)' : 'var(--sand-500)' }}>{t('yc.au.m.yuS', { left: left >= 0 ? t('yc.au.m.left', { n: n(left) }) : t('yc.au.m.short') })}</span>
                  </div>
                </div>
                {fr && sms?.on && (
                  <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--sand-600)' }}>{t('yc.au.fr.smsCost', { n: n(smsRate) })}</span>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, lineHeight: 1.45, color: 'var(--sand-600)' }}>
                  {['c1', 'c2', 'c4', 'c3'].map((c) => (
                    <span key={c} style={{ display: 'flex', gap: 10 }}><Icon d={AU_IC.check} size={16} stroke={2.4} color="var(--green-700)" style={{ marginTop: 2 }} />{t(`yc.au.m.${c}`)}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 28px', borderTop: '1px solid var(--sand-100)', background: '#fff' }}>
            <div>
              {m.step > 1 && (
                <Hv as="button" type="button" onClick={() => set({ step: (m.step - 1) as 1 | 2 })} style={{ height: 46, padding: '0 20px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', color: 'var(--ink)', fontSize: 15, fontWeight: 600, cursor: 'pointer' }} hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }}>
                  {t('yc.au.m.back')}
                </Hv>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {m.step < 3 ? (
                <Hv as="button" type="button" onClick={() => set({ step: (m.step + 1) as 2 | 3 })} style={{ height: 46, padding: '0 24px', border: 0, borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'var(--sand-700)' }} active={{ transform: 'scale(.97)' }}>
                  {t('yc.au.m.next')}
                </Hv>
              ) : (
                <Hv
                  as="button"
                  type="button"
                  disabled={busy}
                  onClick={() => onSave(m)}
                  style={{ height: 46, padding: '0 6px 0 22px', borderRadius: 99, border: 0, background: 'var(--gradient-brand)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, boxShadow: 'var(--shadow-cta)', cursor: busy ? 'progress' : 'pointer', opacity: busy ? 0.7 : 1 }}
                  hover={{ filter: 'brightness(1.05)' }}
                  active={{ transform: 'scale(.97)' }}
                >
                  {t(editing ? 'yc.au.m.save' : 'yc.au.m.activate')}
                  <span style={{ width: 34, height: 34, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon d={AU_IC.check} size={15} stroke={2.6} /></span>
                </Hv>
              )}
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
