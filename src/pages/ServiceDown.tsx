import { Wordmark } from '@/components/brand/Wordmark';

/**
 * Écran statique de maintenance d'urgence (voir `src/lib/platformDown.ts`).
 * Aucun appel réseau, aucune dépendance au backend ni au dictionnaire i18n :
 * il doit s'afficher même quand tout le reste est en panne. Les trois langues
 * sont donc écrites ici, choisies sur la langue du navigateur (anglais par défaut).
 */

type Lang = 'en' | 'fr' | 'es';

const WORDS: Record<Lang, { title: string; body: string; retry: string }> = {
  en: {
    title: "We'll be right back",
    body: 'Yuno is temporarily unavailable while we fix a technical issue. Your tickets and reservations are safe. Please try again in a little while.',
    retry: 'Try again',
  },
  fr: {
    title: 'On revient très vite',
    body: "Yuno est momentanément indisponible, le temps de régler un problème technique. Vos billets et réservations sont en sécurité. Merci de réessayer dans un moment.",
    retry: 'Réessayer',
  },
  es: {
    title: 'Volvemos enseguida',
    body: 'Yuno no está disponible por un momento mientras resolvemos un problema técnico. Tus entradas y reservas están a salvo. Vuelve a intentarlo en un rato.',
    retry: 'Reintentar',
  },
};

function pickLang(): Lang {
  try {
    const l = (navigator.language || 'en').slice(0, 2).toLowerCase();
    if (l === 'fr' || l === 'es') return l;
  } catch {
    /* navigator indisponible : anglais */
  }
  return 'en';
}

export default function ServiceDown() {
  const w = WORDS[pickLang()];
  return (
    <main
      role="status"
      style={{
        minHeight: '100dvh',
        background: '#0A0A0A',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: '32px 24px',
        textAlign: 'center',
      }}
    >
      <Wordmark height={44} />
      <h1 style={{ fontSize: 28, lineHeight: 1.15, fontWeight: 700, margin: 0 }}>{w.title}</h1>
      <p style={{ maxWidth: 420, margin: 0, fontSize: 16, lineHeight: 1.5, color: 'rgba(255,255,255,0.65)' }}>
        {w.body}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          marginTop: 8,
          height: 48,
          padding: '0 28px',
          borderRadius: 12,
          border: 'none',
          background: '#E8192C',
          color: '#fff',
          fontSize: 16,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {w.retry}
      </button>
    </main>
  );
}
