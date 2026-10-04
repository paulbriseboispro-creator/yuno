/**
 * Session de l'Admin CRM : décor du document (polices, fond) et la preuve 2FA
 * du navigateur. La preuve reprend EXACTEMENT celle de RequireMFA (clé
 * `mfaSession`, 24 h, liée à l'utilisateur) : un code vérifié ici vaut pour les
 * Consoles, et inversement. Ce n'est qu'un confort d'interface ; la porte
 * serveur reste `is_super_admin` sur chaque RPC (`_crm_admin_gate`).
 */
import { useEffect } from 'react';

const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap';
const MFA_KEY = 'mfaSession';
const MFA_MS = 24 * 60 * 60 * 1000;

export function useAdminDocument() {
  useEffect(() => {
    if (!document.getElementById('yc-fonts')) {
      const l = document.createElement('link');
      l.id = 'yc-fonts'; l.rel = 'stylesheet'; l.href = FONTS_HREF;
      document.head.appendChild(l);
    }
    const html = document.documentElement;
    const prev = [html.style.background, document.body.style.background];
    html.style.background = '#FCFAF9';
    document.body.style.background = '#FCFAF9';
    return () => { html.style.background = prev[0]; document.body.style.background = prev[1]; };
  }, []);
}

export function hasValidMfaSession(userId: string): boolean {
  try {
    const s = JSON.parse(localStorage.getItem(MFA_KEY) ?? 'null') as { userId?: string; expiresAt?: number } | null;
    return !!s && s.userId === userId && typeof s.expiresAt === 'number' && s.expiresAt > Date.now();
  } catch { return false; }
}

export function storeMfaSession(userId: string): void {
  try { localStorage.setItem(MFA_KEY, JSON.stringify({ userId, expiresAt: Date.now() + MFA_MS, verifiedAt: Date.now() })); } catch { /* stockage refusé : le code sera redemandé */ }
}
