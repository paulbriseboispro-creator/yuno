/**
 * Lien de soirée Yuno CRM : /go/:code — REPLI de la redirection du Worker
 * (worker/goLink.ts), qui répond normalement 302 avant que l'app ne charge.
 * On n'arrive ici que si le Worker n'a pas pu joindre la base (ou en dev) :
 * on refait l'appel depuis le navigateur, puis on part sur la page Shotgun.
 *
 * Une session d'aperçu démo est en lecture seule : si le comptage est refusé,
 * on redirige quand même, sans compter.
 */
import { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { rpc } from '@/crm/lib/rpc';
import { buildGoDestination, type GoHit } from '@/crm/lib/links';

export default function CrmLinkRedirect() {
  const { code } = useParams<{ code: string }>();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      const test = new URLSearchParams(window.location.search).has('t');
      let hit: GoHit | null = null;
      try {
        hit = await rpc<GoHit | null>('crm_link_hit', { p_code: code ?? '', p_count: !test }, { timeoutMs: 8000 });
      } catch {
        try {
          hit = await rpc<GoHit | null>('crm_link_hit', { p_code: code ?? '', p_count: false }, { timeoutMs: 8000 });
        } catch {
          hit = null;
        }
      }
      const dest = hit ? buildGoDestination(hit) : null;
      window.location.replace(dest ?? '/');
    })();
  }, [code]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-black text-snow">
      <div className="text-sm tracking-wide text-white/60">Loading…</div>
    </div>
  );
}
