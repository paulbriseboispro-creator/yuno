/**
 * Hv — un élément dont le style change au survol et à l'appui.
 *
 * Le prototype Claude Design écrit ses états en `style-hover="…"` et
 * `style-active="…"` à côté du `style` : on garde la même grammaire pour que
 * chaque écran se transpose ligne à ligne. Les transitions sont celles du style
 * de base (le prototype les y déclare déjà).
 *
 *   <Hv as={Link} to="/crm" style={card} hover={{ translate: '0 -4px' }}>…</Hv>
 */
import { forwardRef, useState } from 'react';
import type { CSSProperties, ElementType, ComponentPropsWithoutRef, ReactElement, Ref } from 'react';

type HvOwnProps<E extends ElementType> = {
  as?: E;
  style?: CSSProperties;
  hover?: CSSProperties;
  active?: CSSProperties;
  /** Force l'état survolé (sélection clavier, ligne active…). */
  forceHover?: boolean;
  disabled?: boolean;
};

export type HvProps<E extends ElementType> = HvOwnProps<E> & Omit<ComponentPropsWithoutRef<E>, keyof HvOwnProps<E>>;

function HvInner<E extends ElementType = 'div'>(props: HvProps<E>, ref: Ref<Element>) {
  const { as, style, hover, active, forceHover, disabled, onPointerEnter, onPointerLeave, onPointerDown, onPointerUp, ...rest } = props as HvProps<'div'> & { as?: ElementType };
  const Comp = (as ?? 'div') as ElementType;
  const [h, setH] = useState(false);
  const [a, setA] = useState(false);
  const on = !disabled;
  const merged: CSSProperties = {
    ...style,
    ...(on && (h || forceHover) && hover ? hover : null),
    ...(on && a && active ? active : null),
  };
  return (
    <Comp
      ref={ref}
      style={merged}
      onPointerEnter={(e: React.PointerEvent<HTMLDivElement>) => { if (e.pointerType !== 'touch') setH(true); onPointerEnter?.(e); }}
      onPointerLeave={(e: React.PointerEvent<HTMLDivElement>) => { setH(false); setA(false); onPointerLeave?.(e); }}
      onPointerDown={(e: React.PointerEvent<HTMLDivElement>) => { setA(true); onPointerDown?.(e); }}
      onPointerUp={(e: React.PointerEvent<HTMLDivElement>) => { setA(false); onPointerUp?.(e); }}
      {...(disabled && (Comp === 'button') ? { disabled: true } : null)}
      {...rest}
    />
  );
}

export const Hv = forwardRef(HvInner) as <E extends ElementType = 'div'>(
  props: HvProps<E> & { ref?: Ref<Element> },
) => ReactElement | null;
