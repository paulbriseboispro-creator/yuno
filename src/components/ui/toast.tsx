import * as React from "react";
import * as ToastPrimitives from "@radix-ui/react-toast";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, X } from "lucide-react";

import { cn } from "@/lib/utils";

/* Toasts in-app — refonte mobile-first.
   Bannière compacte type « notification native » : pill sombre flouté, ancré
   SOUS la safe-area (jamais dans l'heure/encoche), centré, non bloquant,
   swipe vers le haut pour renvoyer. Une seule à la fois (TOAST_LIMIT=1). */

const ToastProvider = ToastPrimitives.Provider;

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      "pointer-events-none fixed left-1/2 z-[120] flex w-full max-w-[calc(100vw-24px)] -translate-x-1/2 flex-col items-center gap-2 outline-none sm:max-w-[420px]",
      "top-[calc(env(safe-area-inset-top,0px)+10px)]",
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

const toastVariants = cva(
  "group pointer-events-auto relative flex w-auto max-w-full items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3 pr-9 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.85)] backdrop-blur-xl transition-all " +
    // Swipe vertical (direction « up » posée sur le Provider)
    "data-[swipe=cancel]:translate-y-0 data-[swipe=end]:translate-y-[var(--radix-toast-swipe-end-y)] data-[swipe=move]:translate-y-[var(--radix-toast-swipe-move-y)] data-[swipe=move]:transition-none data-[swipe=end]:animate-out " +
    "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-top-4 " +
    "data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-top-4",
  {
    variants: {
      variant: {
        default: "border-white/10 bg-[#161619]/95 text-white",
        destructive:
          "destructive group border-[#E8192C]/45 bg-[#1C0C0F]/95 text-white",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> & VariantProps<typeof toastVariants>
>(({ className, variant, children, ...props }, ref) => {
  return (
    <ToastPrimitives.Root ref={ref} className={cn(toastVariants({ variant }), className)} {...props}>
      {variant === "destructive" && (
        <AlertTriangle className="h-4 w-4 shrink-0 text-[#E8192C]" strokeWidth={2.2} aria-hidden />
      )}
      {children}
    </ToastPrimitives.Root>
  );
});
Toast.displayName = ToastPrimitives.Root.displayName;

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      "inline-flex h-7 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] px-3 text-xs font-medium text-white transition-colors hover:bg-white/[0.12] focus:outline-none focus:ring-1 focus:ring-white/30 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-[#E8192C]/40 group-[.destructive]:hover:bg-[#E8192C]/15",
      className,
    )}
    {...props}
  />
));
ToastAction.displayName = ToastPrimitives.Action.displayName;

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      // Toujours visible : sur mobile il n'y a pas de hover.
      "absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-white/40 transition-colors hover:text-white focus:outline-none",
      className,
    )}
    toast-close=""
    {...props}
  >
    <X className="h-3.5 w-3.5" />
  </ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title ref={ref} className={cn("text-[13px] font-semibold leading-tight", className)} {...props} />
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description ref={ref} className={cn("text-xs leading-snug text-white/60", className)} {...props} />
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};
