/**
 * Erreur de chargement DANS une page : remplace les anciens « ces chiffres n'ont
 * pas pu être chargés ». Qualifie la cause (délai dépassé, accès refusé, pas de
 * réseau, autre), propose « Réessayer » et compte les tentatives.
 */
import { useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useCrmT } from '@/crm/i18n';
import { classifyLoadError, makeErrorRef, SUPPORT_EMAIL } from '@/crm/lib/errors';
import { YunitFace } from '@/crm/ui/YunitFace';
import { Icon } from '@/crm/ui/Icon';
import { Hv } from '@/crm/ui/Hv';
import { useOnline } from './useOnline';

const GRAD: CSSProperties = { paddingRight: '.06em', marginRight: '-.06em', background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' };

function Title({ tpl, word }: { tpl: string; word: string }) {
  const [a, b = ''] = tpl.split('\u0001');
  return <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 28, lineHeight: 1.1, letterSpacing: '-.04em', textWrap: 'balance' }}>{a}<span style={GRAD}>{word}</span>{b}</h2>;
}

export function CrmLoadError({ error, onRetry, retrying = false }: { error: unknown; onRetry: () => void; retrying?: boolean }) {
  const { t } = useCrmT();
  const online = useOnline();
  const kind = classifyLoadError(error, online);
  const ref = useMemo(() => makeErrorRef('TMO'), []);
  const attempts = useRef(0);
  const [, force] = useState(0);
  const retry = () => { attempts.current += 1; force((n) => n + 1); onRetry(); };

  const copy = {
    timeout: { mood: 'inquiet' as const, title: t('yc.er.load.timeoutTitle', { word: '\u0001' }), word: t('yc.er.load.timeoutWord'), body: t('yc.er.load.timeoutBody') },
    forbidden: { mood: 'inquiet' as const, title: t('yc.er.load.forbiddenTitle', { word: '\u0001' }), word: t('yc.er.load.forbiddenWord'), body: t('yc.er.load.forbiddenBody') },
    offline: { mood: 'endormi' as const, title: t('yc.er.load.offlineTitle').replace('.', '\u0001.'), word: t('yc.er.load.offlineTitle').replace('.', ''), body: t('yc.er.load.offlineBody') },
    generic: { mood: 'inquiet' as const, title: t('yc.er.load.genericTitle', { word: '\u0001' }), word: t('yc.er.load.genericWord'), body: t('yc.er.load.genericBody') },
  }[kind];
  // « Pas de connexion. » : le mot entier passe au dégradé, le point reste noir.
  const tpl = kind === 'offline' ? '\u0001.' : copy.title;

  return (
    <div role="alert" style={{ margin: '24px auto', maxWidth: 640, width: '100%', boxSizing: 'border-box', background: '#fff', borderRadius: 24, boxShadow: 'var(--shadow-sm), inset 0 0 0 1px var(--sand-100)', padding: '36px 28px 30px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <YunitFace mood={copy.mood} size={56} />
        {kind === 'timeout' && <span style={{ position: 'absolute', right: -6, bottom: -4, width: 22, height: 22, borderRadius: 99, background: '#fff', boxShadow: 'var(--shadow-sm)', display: 'grid', placeItems: 'center', color: 'var(--sand-600)' }}><Icon name="clock" size={12} stroke={2.4} /></span>}
      </div>
      <Title tpl={tpl} word={copy.word} />
      <p style={{ margin: '12px 0 0', fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-600)', maxWidth: 440, textWrap: 'pretty' }}>{copy.body}</p>
      {kind === 'timeout' && (
        <ol style={{ listStyle: 'none', margin: '20px 0 0', padding: '4px 16px', width: '100%', maxWidth: 440, boxSizing: 'border-box', borderRadius: 16, background: 'var(--sand-50)', textAlign: 'left' }}>
          {[t('yc.er.load.step1'), t('yc.er.load.step2')].map((s, i) => (
            <li key={s} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 0', borderTop: i ? '1px solid var(--sand-100)' : 0, fontSize: 13.5 }}>
              <span style={{ width: 20, height: 20, borderRadius: 99, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600, flex: 'none' }}>{i + 1}</span>{s}
            </li>
          ))}
          <li style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 0', borderTop: '1px solid var(--sand-100)', fontSize: 13.5 }}>
            <span style={{ width: 20, height: 20, borderRadius: 99, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600, flex: 'none' }}>3</span>
            <span>{t('yc.er.load.step3')} <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(ref)}`} style={{ color: 'var(--red-600)' }}>{t('yc.er.401.contact')}</a> · {t('yc.er.load.ref')} <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{ref}</span></span>
          </li>
        </ol>
      )}
      {kind !== 'forbidden' && (
        <Hv
          as="button" type="button" onClick={retry} disabled={retrying}
          style={{ marginTop: 22, height: 46, padding: '0 28px', borderRadius: 99, border: 0, background: 'var(--gradient-brand)', color: '#fff', fontSize: 15, fontWeight: 600, boxShadow: 'var(--shadow-cta)', cursor: retrying ? 'default' : 'pointer', opacity: retrying ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 8 }}
          hover={{ filter: 'brightness(1.05)' }} active={{ transform: 'scale(.97)' }}
        >
          <Icon name="refresh" size={16} stroke={2.2} />{t('yc.common.retry')}
        </Hv>
      )}
      {attempts.current > 0 && kind !== 'forbidden' && <span style={{ marginTop: 10, fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.er.load.attempt', { n: Math.min(attempts.current + 1, 3) })}</span>}
    </div>
  );
}
