/**
 * Un iPhone qui montre un SMS reçu (maquette « SmsPhone ») : expéditeur en
 * haut, la bulle grise, le lien en bleu souligné, les variables en pastille
 * quand on montre le texte brut. Trois tailles : lg (composer), sm (cartes),
 * xs (vignettes).
 */
import type { CSSProperties, ReactNode } from 'react';

const SCALE = { lg: 1, sm: 0.56, xs: 0.42 } as const;
const LINK = /((?:https?:\/\/)?(?:yunoapp\.eu|yuno\.club)\/l?\/?[\w-]+)/;
const LINK_OR_VAR = /((?:https?:\/\/)?(?:yunoapp\.eu|yuno\.club)\/l?\/?[\w-]+|\{\{[^}]+\}\})/;

const knob = (style: CSSProperties) => <i style={{ position: 'absolute', width: 4, borderRadius: '2.5px 0 0 2.5px', background: 'linear-gradient(90deg,#aeb2b7,#eceef1)', boxShadow: '0 0 0 .5px rgba(0,0,0,.18)', ...style }} />;

export function SmsPhone({
  text, sender, time = '18:00', size = 'lg', height = 620, raw = false, multi, today, placeholder,
}: {
  text: string; sender: string; time?: string; size?: keyof typeof SCALE; height?: number; raw?: boolean;
  /** « 2 SMS » sous la bulle quand le message en prend plusieurs. */
  multi?: string;
  /** « Aujourd'hui » dans la langue de l'écran. */
  today: string;
  /** Texte gris quand le message est vide. */
  placeholder: string;
}) {
  const sc = SCALE[size];
  const re = raw ? LINK_OR_VAR : LINK;
  const parts = (text || '').split(re).filter((s) => s !== '');
  return (
    <div aria-hidden style={{ width: Math.round(300 * sc), height: Math.round(height * sc), position: 'relative', flex: 'none' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 300, height, transform: `scale(${sc})`, transformOrigin: 'top left', fontFamily: "-apple-system,'SF Pro Text','SF Pro',system-ui,sans-serif" }}>
        {knob({ left: -4, top: 96, height: 22 })}
        {knob({ left: -4, top: 140, height: 42 })}
        {knob({ left: -4, top: 192, height: 42 })}
        {knob({ right: -4, top: 150, height: 64, borderRadius: '0 2.5px 2.5px 0', background: 'linear-gradient(270deg,#aeb2b7,#eceef1)' })}
        <div style={{ position: 'absolute', inset: 0, boxSizing: 'border-box', borderRadius: 50, padding: 5, background: 'linear-gradient(135deg,#fafbfc 0%,#d3d6da 20%,#f6f7f9 40%,#c2c6cb 58%,#f3f4f6 78%,#d0d3d8 100%)', boxShadow: '0 22px 44px -14px rgba(28,21,23,.38),0 2px 6px rgba(28,21,23,.12),inset 0 0 0 .75px rgba(255,255,255,.9)' }}>
          <div style={{ width: '100%', height: '100%', boxSizing: 'border-box', borderRadius: 45, padding: 5, background: '#0b0b0c', boxShadow: 'inset 0 0 0 1px #2a2b2e' }}>
            <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 40, overflow: 'hidden', background: '#fff', display: 'flex', flexDirection: 'column' }}>
              <div style={{ position: 'absolute', left: '50%', top: 10, marginLeft: -45, width: 90, height: 26, borderRadius: 99, background: '#000', zIndex: 3 }} />
              <div style={{ flex: 'none', height: 46, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 30px 0 34px', fontSize: 15, fontWeight: 600, letterSpacing: '-.02em', color: '#000' }}>
                <span>{time}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <svg width="17" height="11" viewBox="0 0 17 11" fill="#000"><rect x="0" y="7" width="3" height="4" rx=".8" /><rect x="4.7" y="5" width="3" height="6" rx=".8" /><rect x="9.4" y="2.5" width="3" height="8.5" rx=".8" /><rect x="14" y="0" width="3" height="11" rx=".8" /></svg>
                  <svg width="15" height="11" viewBox="0 0 15 11" fill="none" stroke="#000" strokeWidth="1.7" strokeLinecap="round"><path d="M1 4.2a9.6 9.6 0 0 1 13 0" /><path d="M3.4 6.6a6.2 6.2 0 0 1 8.2 0" /><circle cx="7.5" cy="9.2" r=".9" fill="#000" stroke="none" /></svg>
                  <svg width="25" height="12" viewBox="0 0 25 12" fill="none"><rect x=".5" y=".5" width="21" height="11" rx="3.4" stroke="#000" opacity=".4" /><rect x="2" y="2" width="18" height="8" rx="2.2" fill="#000" /><path d="M23 4v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2z" fill="#000" opacity=".45" /></svg>
                </span>
              </div>
              <div style={{ flex: 'none', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '2px 0 9px', background: 'linear-gradient(#fff,rgba(247,247,248,.96))', borderBottom: '.5px solid rgba(60,60,67,.18)' }}>
                <svg width="12" height="20" viewBox="0 0 12 20" fill="none" stroke="#007AFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: 16, top: 12 }}><path d="M10 2 2.5 10 10 18" /></svg>
                <span style={{ width: 44, height: 44, borderRadius: 99, overflow: 'hidden', position: 'relative', background: 'linear-gradient(#b4b6bd,#8f9199)', display: 'block' }}>
                  <i style={{ position: 'absolute', left: 14.5, top: 8, width: 15, height: 15, borderRadius: 99, background: '#f2f2f5', display: 'block' }} />
                  <i style={{ position: 'absolute', left: 8, top: 26, width: 28, height: 28, borderRadius: 99, background: '#f2f2f5', display: 'block' }} />
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11.5, color: '#000', letterSpacing: '-.01em' }}>
                  {sender}
                  <svg width="5" height="8" viewBox="0 0 5 8" fill="none" stroke="#8e8e93" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M.8.8 4 4 .8 7.2" /></svg>
                </span>
              </div>
              <div style={{ flex: 1, minHeight: 0, padding: '12px 14px 10px', display: 'flex', flexDirection: 'column', gap: 5, overflow: 'hidden' }}>
                <span style={{ alignSelf: 'center', fontSize: 10.5, color: '#8e8e93', textAlign: 'center', lineHeight: 1.3, marginBottom: 6 }}><b style={{ fontWeight: 600 }}>SMS</b> · {today} {time}</span>
                <div style={{ position: 'relative', alignSelf: 'flex-start', maxWidth: '82%', marginLeft: 6 }}>
                  <div style={{ position: 'relative', zIndex: 1, padding: '8px 13px 9px', borderRadius: 18, background: '#E9E9EB', fontSize: 15.5, lineHeight: 1.28, letterSpacing: '-.012em', color: '#000', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                    {parts.length === 0 ? <span style={{ color: '#8e8e93' }}>{placeholder}</span> : parts.map((p, i) => {
                      if (/^\{\{/.test(p)) return <span key={i} style={{ background: 'rgba(0,122,255,.14)', color: '#0A60C8', borderRadius: 4, padding: '0 3px', fontFamily: "'Geist Mono',ui-monospace,monospace", fontSize: '.86em' }}>{p}</span>;
                      if (LINK.test(p) && p.match(LINK)?.[0] === p) return <span key={i} style={{ color: '#007AFF', textDecoration: 'underline', textUnderlineOffset: 2 }}>{p.replace(/^https?:\/\//, '')}</span>;
                      return <span key={i}>{p}</span>;
                    })}
                  </div>
                  <i style={{ position: 'absolute', left: -5, bottom: 0, width: 18, height: 16, background: '#E9E9EB', borderBottomRightRadius: '14px 12px', zIndex: 0, display: 'block' }} />
                  <i style={{ position: 'absolute', left: -12, bottom: 0, width: 12, height: 18, background: '#fff', borderBottomRightRadius: 10, zIndex: 2, display: 'block' }} />
                </div>
                {multi && <span style={{ alignSelf: 'flex-start', fontSize: 10.5, color: '#8e8e93', paddingLeft: 12 }}>{multi}</span>}
              </div>
              <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px 8px' }}>
                <span style={{ flex: 'none', width: 32, height: 32, borderRadius: 99, background: '#E9E9EB', display: 'grid', placeItems: 'center' }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" stroke="#6b6b70" strokeWidth="1.8" strokeLinecap="round"><path d="M7 1.5v11M1.5 7h11" /></svg>
                </span>
                <span style={{ flex: 1, minWidth: 0, height: 34, boxSizing: 'border-box', borderRadius: 99, border: '1px solid rgba(60,60,67,.22)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 0 14px', fontSize: 15, color: '#a3a3a8' }}>
                  Message
                  <svg width="12" height="17" viewBox="0 0 12 17" fill="none" stroke="#8e8e93" strokeWidth="1.6" strokeLinecap="round"><rect x="3.5" y="1" width="5" height="9" rx="2.5" fill="#8e8e93" stroke="none" /><path d="M1 8a5 5 0 0 0 10 0M6 13v3" /></svg>
                </span>
              </div>
              <div style={{ flex: 'none', height: 22, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}><i style={{ width: 104, height: 4, borderRadius: 99, background: '#000', display: 'block' }} /></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Le téléphone coupé en haut d'une carte (vignette de modèle ou de SMS parti). */
export function SmsPhoneCrop({ children, h = 220, bg = 'linear-gradient(180deg,var(--sand-100),var(--sand-50))' }: { children: ReactNode; h?: number; bg?: string }) {
  return (
    <div style={{ position: 'relative', height: h, overflow: 'hidden', display: 'flex', justifyContent: 'center', paddingTop: 18, background: bg }}>
      {children}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 56, background: 'linear-gradient(180deg,transparent,#fff)', pointerEvents: 'none' }} />
    </div>
  );
}
