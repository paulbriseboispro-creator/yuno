/**
 * Une section d'un design sur mesure (page d'inscription), rendue sur la page
 * publique et dans les aperçus de la Console.
 *
 * Trois barrières, dans cet ordre :
 *  1. `renderPageSection` (custom.ts) résout les balises (valeurs échappées) et
 *     nettoie le HTML comme le Worker l'a fait avant d'écrire ;
 *  2. DOMPurify, à chaque rendu : aucun script, aucun gestionnaire, aucun lien
 *     `javascript:`, même si la ligne en base avait été écrite autrement ;
 *  3. un Shadow DOM sous un conteneur `contain: paint` : le CSS de la section
 *     ne sort pas (il ne peut ni masquer ni recouvrir le formulaire Yuno, sa
 *     case d'accord ou le bouton), celui de la page n'entre pas.
 * Les liens s'ouvrent dans un nouvel onglet (`noopener`).
 */
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import DOMPurify from 'dompurify';
import { renderPageSection, sanitizePageCss } from './custom';

const PURIFY = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'object', 'embed', 'link', 'meta', 'base',
    'video', 'audio', 'source', 'track', 'foreignObject', 'use', 'animate', 'set', 'animateMotion', 'animateTransform', 'image', 'dialog'],
  FORBID_ATTR: ['srcset', 'formaction', 'autofocus', 'contenteditable', 'xlink:href'],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|#|\/(?!\/)|data:image\/(?:png|jpe?g|gif|webp);base64,)/i,
};

/** Tout lien sortant s'ouvre à part, sans accès à cette fenêtre (sans crochet global sur DOMPurify, partagé avec le Studio). */
function externalLinks(frag: DocumentFragment): void {
  frag.querySelectorAll('a[href]').forEach((a) => {
    if ((a.getAttribute('href') ?? '').startsWith('#')) return;
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
}

/** Le socle de chaque section : la boîte, les images qui tiennent dans la largeur. */
const BASE_CSS = ':host{display:block;position:relative}*,*::before,*::after{box-sizing:border-box}img,svg{max-width:100%}img{height:auto}a{color:inherit}';

function CustomSectionImpl({ html, css, sharedCss, data }: {
  html: string;
  css?: string;
  sharedCss?: string;
  data: Record<string, unknown>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const rendered = useMemo(() => renderPageSection(html, data), [html, data]);
  const style = useMemo(() => BASE_CSS + sanitizePageCss(sharedCss ?? '').text + sanitizePageCss(css ?? '').text, [css, sharedCss]);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    const clean = DOMPurify.sanitize(rendered, { ...PURIFY, RETURN_DOM_FRAGMENT: true });
    externalLinks(clean);
    const st = document.createElement('style');
    st.textContent = style;
    root.replaceChildren(st, clean);
  }, [rendered, style]);

  return <div ref={host} style={{ position: 'relative', contain: 'paint', isolation: 'isolate', flex: 'none' }} />;
}

const CustomSection = memo(CustomSectionImpl);
export default CustomSection;
