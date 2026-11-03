/**
 * Vignette d'un e-mail : le vrai rendu (renderEmailHtml, celui de l'envoi),
 * réduit dans une iframe inerte. Le contenu est lu à la demande ; sans blocs,
 * la vignette montre l'objet sur une trame.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useCrmT } from '@/crm/i18n';
import { useEmailHtml } from './emailHtml';

export function EmailThumb({ id, subject, height = 190, scale = 0.46 }: { id: string; subject: string | null; height?: number; scale?: number }) {
  const { t } = useCrmT();
  const q = useEmailHtml(id);
  return (
    <div style={{ position: 'relative', height, overflow: 'hidden', background: 'var(--sand-100)' }}>
      {q.data ? (
        <iframe
          title={t('yc.em.preview')}
          srcDoc={q.data}
          tabIndex={-1}
          sandbox=""
          style={{ position: 'absolute', top: 0, left: '50%', width: 600, height: Math.ceil(height / scale) + 40, border: 0, transform: `translateX(-50%) scale(${scale})`, transformOrigin: 'top center', pointerEvents: 'none', background: '#fff' }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(135deg,var(--sand-50) 0 10px,var(--sand-100) 10px 20px)', display: 'grid', placeItems: 'center', padding: 24, boxSizing: 'border-box' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17, letterSpacing: '-.02em', textAlign: 'center', color: 'var(--sand-600)', textWrap: 'balance' }}>{subject || '—'}</span>
        </div>
      )}
      <div style={{ position: 'absolute', inset: 'auto 0 0 0', height: 50, background: 'linear-gradient(transparent,rgba(255,255,255,.9))' }} />
    </div>
  );
}

/**
 * Miniature d'une ligne de liste : le vrai rendu de l'e-mail (celui de
 * l'envoi, donc aussi un design HTML sur mesure), réduit à la taille de la
 * pastille. La maquette à couleurs du thème (`children`) reste dessous tant
 * que le rendu n'est pas prêt. Le contenu n'est lu qu'à l'approche de l'écran :
 * une liste de cent e-mails ne lance pas cent lectures d'un coup.
 */
export function EmailMiniThumb({ id, width = 48, height = 60, style, children }: { id: string; width?: number; height?: number; style?: CSSProperties; children?: ReactNode }) {
  const [box, setBox] = useState<HTMLSpanElement | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!box || near) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return undefined; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: '240px' });
    io.observe(box);
    return () => io.disconnect();
  }, [box, near]);
  return (
    <span ref={setBox} style={{ position: 'relative', width, height, ...style }}>
      {children}
      {near ? <MiniFrame id={id} width={width} height={height} /> : null}
    </span>
  );
}

function MiniFrame({ id, width, height }: { id: string; width: number; height: number }) {
  const { t } = useCrmT();
  const q = useEmailHtml(id);
  if (!q.data) return null;
  const scale = width / 600;
  return (
    <iframe
      title={t('yc.em.preview')}
      srcDoc={q.data}
      tabIndex={-1}
      sandbox=""
      loading="lazy"
      style={{ position: 'absolute', top: 0, left: 0, width: 600, height: Math.ceil(height / scale) + 20, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none', background: '#fff' }}
    />
  );
}
