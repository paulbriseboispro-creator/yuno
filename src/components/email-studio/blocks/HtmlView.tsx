import { useEffect, useMemo, useRef, useState } from 'react';
import type { EmailTheme, HtmlBlock } from '@/lib/email';
import { buildSmartData, renderSmartSection, RESPONSIVE_UTILITY_CSS, smartLang, smartNeeds } from '@/lib/email';
import { blockBgColor, blockPad, liveFor, type CanvasCtx } from './common';

/** Destinataire fictif de l'aperçu (même prénom que l'aperçu du Studio CRM). */
const SAMPLE = { email: 'camille@exemple.fr', firstName: 'Camille', lastName: 'Martin', city: 'Paris' };
const FONT = "Arial,'Helvetica Neue',Helvetica,sans-serif";

/**
 * Section sur mesure : DESSINÉE dans le canevas, avec les données live de sa
 * soirée (mêmes balises, même moteur que l'envoi — email-smart.ts). Elle vit
 * dans une iframe sans script (`sandbox` sans allow-scripts) : son HTML ne
 * peut ni casser le Studio ni y exécuter quoi que ce soit, et les règles
 * mobiles des sections (yn-col…) s'y appliquent à la largeur du canevas.
 * Les clics traversent l'iframe : le canevas sélectionne le bloc.
 */
export default function HtmlView({ block, theme, ctx, mobile }: { block: HtmlBlock; theme: EmailTheme; ctx: CanvasCtx; mobile?: boolean }) {
  const pad = blockPad(block);
  const ev = liveFor(block, ctx);
  // La soirée se lit en une passe après l'ouverture : tant qu'elle n'est pas
  // là, la section resterait dessinée avec des trous (« avec . »). Elle
  // attend donc ses données, 4 s au plus (une soirée illisible ne doit pas
  // laisser la section invisible).
  const eventId = block.eventId || ctx.fallbackEventId || '';
  const needsEvent = useMemo(() => smartNeeds(block.code || '').event, [block.code]);
  const pending = needsEvent && !!eventId && !ev;
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (!pending) return undefined;
    const t = setTimeout(() => setGaveUp(true), 4000);
    return () => clearTimeout(t);
  }, [pending]);
  const waiting = pending && !gaveUp;
  const bg = blockBgColor(block, theme);
  const html = useMemo(() => renderSmartSection(block.code || '', buildSmartData({
    event: ev || null,
    language: smartLang(ctx.language),
    recipient: SAMPLE,
    brand: { name: ctx.venueName, logoUrl: ctx.logoUrl },
    social: ctx.socialLinks,
  })), [block.code, ev, ctx.language, ctx.venueName, ctx.logoUrl, ctx.socialLinks]);

  // Les règles mobiles de l'e-mail (≤ 620 px) suivent l'APPAREIL choisi dans
  // le canevas, pas la largeur de l'iframe : la section fait 600 px de large
  // sur ordinateur, une media query s'y déclencherait et empilerait ses
  // colonnes alors que la boîte de réception d'un ordinateur ne le fait pas.
  const doc = useMemo(() => `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{margin:0;padding:0;background:transparent;font-family:${FONT};-webkit-text-size-adjust:100%;}
table{border-collapse:collapse;}img{-ms-interpolation-mode:bicubic;}a{text-decoration:none;}
${mobile ? RESPONSIVE_UTILITY_CSS : ''}
</style></head><body>${html}</body></html>`, [html, mobile]);

  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(60);
  useEffect(() => {
    const el = frame.current;
    if (!el) return undefined;
    let ro: ResizeObserver | null = null;
    const measure = () => {
      const d = el.contentDocument;
      if (!d?.body) return;
      setHeight(Math.max(24, Math.ceil(d.documentElement.scrollHeight)));
    };
    const onLoad = () => {
      measure();
      const d = el.contentDocument;
      if (d?.body && typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(measure);
        ro.observe(d.body);
      }
      // Les images arrivent après le chargement du document.
      d?.querySelectorAll('img').forEach((img) => img.addEventListener('load', measure));
    };
    el.addEventListener('load', onLoad);
    return () => { el.removeEventListener('load', onLoad); ro?.disconnect(); };
  }, [doc]);

  if (!(block.code || '').trim()) {
    return (
      <div style={{ padding: `${Math.max(pad.py, 14)}px ${Math.max(pad.px, 14)}px` }}>
        <div style={{
          fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12, color: theme.muted,
          background: theme.tile, border: `1px dashed ${theme.divider}`, borderRadius: 10, padding: 14,
        }}>HTML</div>
      </div>
    );
  }

  return (
    <div style={{ padding: `${pad.py}px ${pad.px}px`, background: bg }}>
      <iframe
        ref={frame}
        title={block.label || 'HTML'}
        srcDoc={doc}
        sandbox="allow-same-origin"
        scrolling="no"
        aria-busy={waiting || undefined}
        style={{
          display: 'block', width: '100%', height, border: 0, background: 'transparent', pointerEvents: 'none',
          opacity: waiting ? 0 : 1, transition: 'opacity .2s ease',
        }}
      />
    </div>
  );
}
